// Tes ulasan, hitung ulang rating, dan auto-cancel dengan MySQL sungguhan. Hanya jalan jika
// DB_TEST=1. Semua data uji (user, provider, layanan, booking, riwayat, review) memakai id
// acak dan dihapus lagi. Auto-cancel hanya menyentuh booking uji yang dibuat bertanggal
// tahun 2000, sehingga booking lain (termasuk data demo) tidak ikut dibatalkan.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createTestCategory, deleteTestCategory } = require('./helpers/testCategory');

test(
  'ulasan, rating provider, dan auto-cancel ke database',
  { skip: process.env.DB_TEST !== '1' },
  async (t) => {
    const knex = require('knex')(require('../knexfile'));
    const db = require('../src/config/db');
    const createApp = require('../src/app');
    const bookingRepository = require('../src/repositories/bookingRepository');
    const { REASON } = require('../src/services/autoCancel');
    const { signToken } = require('../src/utils/token');

    const suffix = randomUUID().slice(0, 8);
    const ids = {
      customer: randomUUID(),
      providerUser: randomUUID(),
      provider: randomUUID(),
      service: randomUUID(),
    };

    t.after(async () => {
      const bookingIds = await knex('bookings').where({ provider_id: ids.provider }).pluck('id');
      await knex('reviews').whereIn('booking_id', bookingIds).del();
      await knex('booking_status_history').whereIn('booking_id', bookingIds).del();
      await knex('bookings').whereIn('id', bookingIds).del();
      await knex('services').where({ id: ids.service }).del();
      await knex('provider_profiles').where({ id: ids.provider }).del();
      await knex('users').whereIn('id', [ids.customer, ids.providerUser]).del();
      await deleteTestCategory(knex, suffix);
      await knex.destroy();
      await db.closePool();
    });

    await knex.migrate.latest();
    const category = await createTestCategory(knex, suffix);
    await knex('users').insert([
      {
        id: ids.customer,
        role: 'customer',
        full_name: 'Uji Pengulas',
        email: `uji-pengulas-${suffix}@djc.test`,
        phone: '+6281299990015',
        password_hash: 'x',
      },
      {
        id: ids.providerUser,
        role: 'provider',
        full_name: 'Uji Diulas',
        email: `uji-diulas-${suffix}@djc.test`,
        phone: '+6281299990016',
        password_hash: 'x',
      },
    ]);
    await knex('provider_profiles').insert({
      id: ids.provider,
      user_id: ids.providerUser,
      display_name: 'Uji Diulas',
      alumni_reg_no: `UJI-R-${suffix}`,
      city: 'Kota Bandung',
    });
    await knex('services').insert({
      id: ids.service,
      provider_id: ids.provider,
      category_id: category.id,
      title: 'Uji ulasan',
      pricing_type: 'fixed',
      price_amount: 50000,
      service_mode: 'at_provider',
    });

    const booking = (status, extra = {}) => ({
      id: randomUUID(),
      code: `DJC-U${randomUUID().slice(0, 8).toUpperCase()}`,
      customer_id: ids.customer,
      provider_id: ids.provider,
      service_id: ids.service,
      scheduled_date: '2026-11-02',
      start_time: '09:00',
      service_mode: 'at_provider',
      pricing_type_snapshot: 'fixed',
      unit_price_snapshot: 50000,
      quantity: 1,
      estimated_total: 50000,
      status,
      ...(status === 'completed' ? { final_total: 50000 } : {}),
      ...extra,
    });
    const done1 = booking('completed');
    const done2 = booking('completed');
    const accepted = booking('accepted');
    const old = booking('requested', { created_at: '2000-01-01 00:00:00.000000' });
    const fresh = booking('requested');
    await knex('bookings').insert([done1, done2, accepted, old, fresh]);

    const app = createApp();
    const auth = `Bearer ${signToken({ id: ids.customer, role: 'customer' }).token}`;
    const post = (id, body) =>
      request(app).post(`/api/v1/bookings/${id}/reviews`).set('Authorization', auth).send(body);

    assert.equal((await post(done1.id, { rating: 5, comment: 'Mantap' })).status, 201);
    let profile = await knex('provider_profiles').where({ id: ids.provider }).first();
    assert.equal(Number(profile.rating_avg), 5);
    assert.equal(profile.rating_count, 1);

    assert.equal((await post(done2.id, { rating: 2 })).status, 201);
    profile = await knex('provider_profiles').where({ id: ids.provider }).first();
    assert.equal(Number(profile.rating_avg), 3.5);
    assert.equal(profile.rating_count, 2);

    const duplicate = await post(done1.id, { rating: 1 });
    assert.equal(duplicate.status, 409);
    assert.equal((await post(accepted.id, { rating: 4 })).status, 409);
    assert.equal(
      await knex('reviews')
        .where({ provider_id: ids.provider })
        .count('* as n')
        .first()
        .then((r) => Number(r.n)),
      2,
    );

    const detail = await request(app)
      .get(`/api/v1/bookings/${done1.id}`)
      .set('Authorization', auth);
    assert.equal(detail.body.data.can_review, false);

    // Ulasan bersamaan untuk provider yang sama tidak boleh deadlock (review #24): baris
    // provider dikunci lebih dulu, jadi semuanya tersimpan bergantian.
    const reviewRepository = require('../src/repositories/reviewRepository');
    const concurrent = Array.from({ length: 6 }, () => booking('completed'));
    await knex('bookings').insert(concurrent);
    await Promise.all(
      concurrent.map((row, index) =>
        reviewRepository.createForBooking({
          bookingId: row.id,
          customerId: ids.customer,
          providerId: ids.provider,
          rating: index % 2 ? 5 : 3,
          comment: null,
        }),
      ),
    );
    profile = await knex('provider_profiles').where({ id: ids.provider }).first();
    assert.equal(profile.rating_count, 8);
    assert.equal(Number(profile.rating_avg), 3.9);

    // Auto-cancel hanya untuk booking requested yang dibuat sebelum batas waktu.
    const cancelled = await bookingRepository.cancelExpiredRequested({
      createdBefore: new Date('2000-01-02T00:00:00Z'),
      reason: REASON,
    });
    assert.deepEqual(cancelled, [old.id]);
    const oldRow = await knex('bookings').where({ id: old.id }).first();
    assert.equal(oldRow.status, 'cancelled');
    assert.equal(oldRow.cancelled_by, 'system');
    assert.equal(oldRow.status_reason, REASON);
    const history = await knex('booking_status_history').where({ booking_id: old.id }).first();
    assert.equal(history.from_status, 'requested');
    assert.equal(history.to_status, 'cancelled');
    assert.equal(history.changed_by, null);
    assert.equal((await knex('bookings').where({ id: fresh.id }).first()).status, 'requested');

    const asCustomer = await request(app)
      .get(`/api/v1/bookings/${old.id}`)
      .set('Authorization', auth);
    assert.equal(asCustomer.body.data.history.at(-1).changed_by_role, 'system');
  },
);
