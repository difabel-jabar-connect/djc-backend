// Tes ulasan (R1) dan auto-cancel 24 jam tanpa MySQL: repository diganti versi in-memory.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const createApp = require('../src/app');
const { createAutoCancel, REASON, TIMEOUT_MS } = require('../src/services/autoCancel');
const { signToken } = require('../src/utils/token');

const customer = { id: randomUUID(), role: 'customer', status: 'active' };
const otherCustomer = { id: randomUUID(), role: 'customer', status: 'active' };
const providerUser = { id: randomUUID(), role: 'provider', status: 'active' };
const PROVIDER_ID = randomUUID();
const bearer = (user) => `Bearer ${signToken(user).token}`;

function bookingRow(status, extra = {}) {
  return {
    id: randomUUID(),
    code: 'DJC-UJI',
    status,
    customer_id: customer.id,
    provider_id: PROVIDER_ID,
    provider_user_id: providerUser.id,
    service_id: randomUUID(),
    service_title: 'Layanan uji',
    provider_display_name: 'Deni',
    customer_full_name: 'Budi Santoso',
    scheduled_date: '2026-11-02',
    start_time: '09:00:00',
    service_mode: 'at_provider',
    pricing_type_snapshot: 'fixed',
    unit_price_snapshot: 50000,
    quantity: 1,
    estimated_total: 50000,
    has_review: 0,
    was_accepted: 1,
    history: [],
    ...extra,
  };
}

function setup(rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const saved = [];
  const bookings = {
    async findById(id) {
      return byId.get(id) ?? null;
    },
  };
  const reviews = {
    saved,
    async createForBooking(review) {
      if (saved.some((r) => r.bookingId === review.bookingId)) {
        throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
      }
      saved.push(review);
      byId.get(review.bookingId).has_review = 1;
      return {
        id: randomUUID(),
        booking_id: review.bookingId,
        rating: review.rating,
        comment: review.comment,
        is_hidden: false,
      };
    },
  };
  const users = {
    async findById(id) {
      return [customer, otherCustomer, providerUser].find((user) => user.id === id) ?? null;
    },
  };
  return { app: createApp({ bookings, reviews, users }), reviews };
}

const review = (app, user, id, body, path = 'reviews') =>
  request(app).post(`/api/v1/bookings/${id}/${path}`).set('Authorization', bearer(user)).send(body);

test('customer pemilik memberi ulasan untuk pesanan completed; can_review berubah false', async () => {
  const row = bookingRow('completed');
  const { app, reviews } = setup([row]);

  const before = await request(app)
    .get(`/api/v1/bookings/${row.id}`)
    .set('Authorization', bearer(customer));
  assert.equal(before.body.data.can_review, true);

  const res = await review(app, customer, row.id, { rating: 5, comment: '  Cepat dan rapi.  ' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.rating, 5);
  assert.deepEqual(reviews.saved[0], {
    bookingId: row.id,
    customerId: customer.id,
    providerId: PROVIDER_ID,
    rating: 5,
    comment: 'Cepat dan rapi.',
  });

  const after = await request(app)
    .get(`/api/v1/bookings/${row.id}`)
    .set('Authorization', bearer(customer));
  assert.equal(after.body.data.can_review, false);
});

test('ulasan ganda ditolak 409 CONFLICT (juga lewat alias /review)', async () => {
  const row = bookingRow('completed');
  const { app } = setup([row]);

  assert.equal((await review(app, customer, row.id, { rating: 4 })).status, 201);
  const again = await review(app, customer, row.id, { rating: 3 }, 'review');
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'CONFLICT');
});

test('ulasan hanya untuk pesanan completed: status lain 409 INVALID_TRANSITION', async () => {
  for (const status of ['requested', 'accepted', 'in_progress', 'rejected', 'cancelled']) {
    const row = bookingRow(status);
    const { app } = setup([row]);
    const res = await review(app, customer, row.id, { rating: 5 });
    assert.equal(res.status, 409, status);
    assert.equal(res.body.error.code, 'INVALID_TRANSITION');
  }
});

test('ulasan: customer lain 404, provider 403, rating di luar 1–5 atau komentar terlalu panjang 400', async () => {
  const row = bookingRow('completed');
  const { app } = setup([row]);

  assert.equal((await review(app, otherCustomer, row.id, { rating: 5 })).status, 404);
  assert.equal((await review(app, providerUser, row.id, { rating: 5 })).status, 403);
  for (const body of [
    {},
    { rating: 0 },
    { rating: 6 },
    { rating: 4.5 },
    { rating: 5, comment: 'x'.repeat(1001) },
  ]) {
    const res = await review(app, customer, row.id, body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
  }
});

test('can_review hanya true untuk customer pemilik, status completed, belum diulas', async () => {
  const completed = bookingRow('completed');
  const reviewed = bookingRow('completed', { has_review: 1 });
  const accepted = bookingRow('accepted');
  const { app } = setup([completed, reviewed, accepted]);
  const canReview = async (user, row) =>
    (await request(app).get(`/api/v1/bookings/${row.id}`).set('Authorization', bearer(user))).body
      .data.can_review;

  assert.equal(await canReview(customer, completed), true);
  assert.equal(await canReview(customer, reviewed), false);
  assert.equal(await canReview(customer, accepted), false);
  assert.equal(await canReview(providerUser, completed), false);
});

test('auto-cancel: batas 24 jam dihitung dari jam sekarang dan alasan sistem dikirim', async () => {
  const now = new Date('2026-11-02T03:00:00Z');
  const calls = [];
  const autoCancel = createAutoCancel({
    now: () => now,
    logger: { info() {}, error() {} },
    bookings: {
      async cancelExpiredRequested(args) {
        calls.push(args);
        return ['b1', 'b2'];
      },
    },
  });

  assert.deepEqual(await autoCancel.runOnce(), ['b1', 'b2']);
  assert.equal(TIMEOUT_MS, 24 * 60 * 60 * 1000);
  assert.equal(calls[0].createdBefore.toISOString(), '2026-11-01T03:00:00.000Z');
  assert.equal(
    calls[0].reason,
    'Batas waktu konfirmasi 24 jam terlampaui (dibatalkan otomatis oleh sistem)',
  );
  assert.equal(REASON, calls[0].reason);
});

test('auto-cancel: putaran yang sedang berjalan tidak tumpang tindih, error tidak menghentikan interval', async () => {
  let release;
  let count = 0;
  const errors = [];
  const autoCancel = createAutoCancel({
    logger: { info() {}, error: (message) => errors.push(message) },
    bookings: {
      cancelExpiredRequested() {
        count += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });

  const first = autoCancel.runOnce();
  assert.deepEqual(
    await autoCancel.runOnce(),
    [],
    'putaran kedua dilewati selama yang pertama berjalan',
  );
  release([]);
  await first;
  assert.equal(count, 1);

  const failing = createAutoCancel({
    logger: { info() {}, error: (message) => errors.push(message) },
    bookings: {
      async cancelExpiredRequested() {
        throw new Error('database mati');
      },
    },
  });
  failing.start(60_000);
  await new Promise((resolve) => setImmediate(resolve));
  failing.stop();
  assert.match(errors[0], /database mati/);
});
