// Tes booking dan transisi status tanpa MySQL: repository booking diganti versi in-memory
// yang menjalankan `decide` sama seperti repository asli.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const createApp = require('../src/app');
const { shortName, todayInJakarta } = require('../src/routes/bookings');
const { signToken } = require('../src/utils/token');

const customer = {
  id: randomUUID(),
  role: 'customer',
  status: 'active',
  full_name: 'Budi Santoso',
};
const otherCustomer = { id: randomUUID(), role: 'customer', status: 'active', full_name: 'Ani' };
const providerUser = { id: randomUUID(), role: 'provider', status: 'active' };
const otherProviderUser = { id: randomUUID(), role: 'provider', status: 'active' };
const admin = { id: randomUUID(), role: 'admin', status: 'active' };
const suspended = { id: randomUUID(), role: 'customer', status: 'suspended', full_name: 'S' };
const PROVIDER_ID = randomUUID();
const OTHER_PROVIDER_ID = randomUUID();

// "Hari ini" tetap untuk tes: Senin 2 November 2026 pukul 10.00 WIB.
const NOW = new Date('2026-11-02T03:00:00Z');
const MONDAY = '2026-11-02';
const NEXT_MONDAY = '2026-11-09';

const SERVICES = {
  fixed: {
    id: randomUUID(),
    pricing_type: 'fixed',
    price_amount: 50000,
    min_hours: null,
    service_mode: 'both',
  },
  hourly: {
    id: randomUUID(),
    pricing_type: 'hourly',
    price_amount: 40000,
    min_hours: 2,
    service_mode: 'at_customer',
  },
  from: {
    id: randomUUID(),
    pricing_type: 'starting_from',
    price_amount: 75000,
    min_hours: null,
    service_mode: 'at_provider',
  },
};

const bearer = (user) => `Bearer ${signToken(user).token}`;

function fakeUsers() {
  const rows = new Map(
    [customer, otherCustomer, providerUser, otherProviderUser, admin, suspended].map((u) => [
      u.id,
      u,
    ]),
  );
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
  };
}

function fakeBookings() {
  const rows = new Map();
  const names = new Map([customer, otherCustomer, suspended].map((u) => [u.id, u.full_name]));
  const owners = new Map([
    [PROVIDER_ID, providerUser.id],
    [OTHER_PROVIDER_ID, otherProviderUser.id],
  ]);
  const withHistory = (row) => (row ? { ...row, history: [...row.history] } : null);
  return {
    rows,
    async findBookableService(id) {
      const service = Object.values(SERVICES).find((s) => s.id === id);
      return service ? { ...service, provider_id: PROVIDER_ID } : null;
    },
    async listSlotsForDay(providerId, day) {
      // Provider buka Senin–Sabtu 08:00–16:00, Minggu tutup.
      return day === 0 ? [] : [{ start_time: '08:00', end_time: '16:00' }];
    },
    async findProviderProfileId(userId) {
      return [...owners].find(([, user]) => user === userId)?.[0] ?? null;
    },
    async create(booking, { changedBy }) {
      const row = {
        id: randomUUID(),
        code: `DJC-${rows.size + 1}`,
        status: 'requested',
        customer_id: booking.customerId,
        provider_id: booking.providerId,
        service_id: booking.serviceId,
        service_title: 'Layanan uji',
        provider_user_id: owners.get(booking.providerId),
        provider_display_name: 'Deni',
        provider_city: 'Kota Bekasi',
        provider_district: null,
        customer_full_name: names.get(booking.customerId),
        scheduled_date: booking.scheduledDate,
        start_time: `${booking.startTime}:00`,
        service_mode: booking.serviceMode,
        location_area: booking.locationArea,
        location_address: booking.locationAddress,
        location_lat: booking.locationLat,
        location_lng: booking.locationLng,
        customer_note: booking.customerNote,
        pricing_type_snapshot: booking.pricingType,
        unit_price_snapshot: booking.unitPrice,
        quantity: booking.quantity,
        estimated_total: booking.estimatedTotal,
        actual_quantity: null,
        final_total: null,
        cancelled_by: null,
        status_reason: null,
        history: [
          { from_status: null, to_status: 'requested', changed_by_role: 'customer', reason: null },
        ],
        changedBy,
      };
      rows.set(row.id, row);
      return withHistory(row);
    },
    async findById(id) {
      return withHistory(rows.get(id));
    },
    async list({ customerId, providerId, statuses, page, limit }) {
      const items = [...rows.values()].filter(
        (row) =>
          (!customerId || row.customer_id === customerId) &&
          (!providerId || row.provider_id === providerId) &&
          (!statuses || statuses.includes(row.status)),
      );
      return { items: items.slice((page - 1) * limit, page * limit), total: items.length };
    },
    async transition(id, { to, changedBy, decide }) {
      const row = rows.get(id);
      const { changes = {}, reason = null } = decide({ ...row });
      const role = [customer, otherCustomer, providerUser, otherProviderUser].find(
        (u) => u.id === changedBy,
      ).role;
      row.history.push({ from_status: row.status, to_status: to, changed_by_role: role, reason });
      Object.assign(row, changes, { status: to });
      return withHistory(row);
    },
  };
}

function setup() {
  const bookings = fakeBookings();
  const app = createApp({ bookings, users: fakeUsers(), now: () => NOW });
  return { app, bookings };
}

const fixedBody = {
  service_id: SERVICES.fixed.id,
  scheduled_date: MONDAY,
  start_time: '09:00',
  service_mode: 'at_provider',
};

async function createBooking(app, body = fixedBody, user = customer) {
  const res = await request(app)
    .post('/api/v1/bookings')
    .set('Authorization', bearer(user))
    .send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
}

const act = (app, user, id, name, body = {}, method = 'put') =>
  request(app)
    [method](`/api/v1/bookings/${id}/${name}`)
    .set('Authorization', bearer(user))
    .send(body);

test('helper: nama singkat dan tanggal WIB', () => {
  assert.equal(shortName('Budi Santoso'), 'Budi S.');
  assert.equal(shortName('Ani'), 'Ani');
  assert.equal(todayInJakarta(new Date('2026-11-01T18:00:00Z')), '2026-11-02');
});

test('B1 customer membuat booking requested dengan snapshot harga dan riwayat', async () => {
  const { app } = setup();

  const booking = await createBooking(app, {
    service_id: SERVICES.hourly.id,
    scheduled_date: NEXT_MONDAY,
    start_time: '13:30',
    service_mode: 'at_customer',
    quantity: 3,
    location_area: 'Bekasi Timur, Kota Bekasi',
    location_address: 'Jl. Melati No. 10',
    customer_note: 'Rumah pagar hijau.',
  });

  assert.equal(booking.status, 'requested');
  assert.equal(booking.pricing_type_snapshot, 'hourly');
  assert.equal(booking.unit_price_snapshot, 40000);
  assert.equal(booking.quantity, 3);
  assert.equal(booking.estimated_total, 120000);
  assert.equal(booking.location.address, 'Jl. Melati No. 10', 'customer melihat alamatnya sendiri');
  assert.equal(booking.provider.phone, null);
  assert.deepEqual(
    booking.history.map((h) => [h.from_status, h.to_status]),
    [[null, 'requested']],
  );
});

test('B1 validasi: tanggal lampau, di luar jam, mode tidak tersedia, jam minimum, lokasi', async () => {
  const { app } = setup();
  const post = (body) =>
    request(app).post('/api/v1/bookings').set('Authorization', bearer(customer)).send(body);
  const hourly = {
    service_id: SERVICES.hourly.id,
    scheduled_date: MONDAY,
    start_time: '09:00',
    service_mode: 'at_customer',
    quantity: 3,
    location_area: 'Bekasi Timur',
    location_address: 'Jl. Melati No. 10',
  };
  const cases = [
    [{ ...fixedBody, scheduled_date: '2026-11-01' }, 'scheduled_date'],
    [{ ...fixedBody, start_time: '16:00' }, 'start_time'],
    [{ ...fixedBody, scheduled_date: '2026-11-08' }, 'start_time'],
    [
      {
        ...hourly,
        service_mode: 'at_provider',
        location_area: undefined,
        location_address: undefined,
      },
      'service_mode',
    ],
    [{ ...hourly, quantity: 1 }, 'quantity'],
    [{ ...hourly, quantity: undefined }, 'quantity'],
    [{ ...hourly, location_address: undefined }, 'location_address'],
    [{ ...fixedBody, start_time: '9:00' }, 'start_time'],
  ];
  for (const [body, field] of cases) {
    const res = await post(body);
    assert.equal(res.status, 400, `${field}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error.details[0].field, field);
  }

  assert.equal((await post({ ...fixedBody, service_id: randomUUID() })).status, 404);
});

test('B1 hanya customer aktif: provider 403, customer suspended 403, tanpa login 401', async () => {
  const { app } = setup();
  const post = (user) => {
    const req = request(app).post('/api/v1/bookings').send(fixedBody);
    return user ? req.set('Authorization', bearer(user)) : req;
  };

  assert.equal((await post()).status, 401);
  assert.equal((await post(providerUser)).status, 403);
  const res = await post(suspended);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'ACCOUNT_SUSPENDED');
});

test('B2/B3 akses: pemilik melihat, pihak lain 404, admin boleh melihat', async () => {
  const { app } = setup();
  const booking = await createBooking(app);
  await createBooking(app, fixedBody, otherCustomer);

  const mine = await request(app).get('/api/v1/bookings').set('Authorization', bearer(customer));
  assert.equal(mine.body.data.length, 1);
  assert.deepEqual(mine.body.meta, { page: 1, limit: 12, total_items: 1, total_pages: 1 });

  const forProvider = await request(app)
    .get('/api/v1/bookings')
    .set('Authorization', bearer(providerUser));
  assert.equal(forProvider.body.data.length, 2);
  assert.equal(forProvider.body.data[0].customer.name, 'Budi S.', 'provider melihat nama singkat');

  const filtered = await request(app)
    .get('/api/v1/bookings?status=accepted,completed')
    .set('Authorization', bearer(providerUser));
  assert.equal(filtered.body.data.length, 0);

  const otherProvider = await request(app)
    .get('/api/v1/bookings')
    .set('Authorization', bearer(otherProviderUser));
  assert.equal(otherProvider.body.data.length, 0);

  for (const user of [otherCustomer, otherProviderUser]) {
    const res = await request(app)
      .get(`/api/v1/bookings/${booking.id}`)
      .set('Authorization', bearer(user));
    assert.equal(res.status, 404);
  }
  const asAdmin = await request(app)
    .get(`/api/v1/bookings/${booking.id}`)
    .set('Authorization', bearer(admin));
  assert.equal(asAdmin.status, 200);
  assert.equal(
    (await request(app).get('/api/v1/bookings/bukan-uuid').set('Authorization', bearer(customer)))
      .status,
    404,
  );
  assert.equal(
    (await request(app).get('/api/v1/bookings?status=aneh').set('Authorization', bearer(customer)))
      .status,
    400,
  );
});

test('alur lengkap requested → accepted → in_progress → completed tercatat di riwayat', async () => {
  const { app } = setup();
  const booking = await createBooking(app);

  assert.equal((await act(app, providerUser, booking.id, 'accept')).body.data.status, 'accepted');
  assert.equal(
    (await act(app, providerUser, booking.id, 'start', {}, 'post')).body.data.status,
    'in_progress',
  );
  const done = await act(app, providerUser, booking.id, 'complete');
  assert.equal(done.status, 200);
  assert.equal(done.body.data.status, 'completed');
  assert.equal(done.body.data.final_total, 50000, 'fixed: final_total = estimated_total');

  const detail = await request(app)
    .get(`/api/v1/bookings/${booking.id}`)
    .set('Authorization', bearer(customer));
  assert.deepEqual(
    detail.body.data.history.map((h) => `${h.from_status}->${h.to_status}:${h.changed_by_role}`),
    [
      'null->requested:customer',
      'requested->accepted:provider',
      'accepted->in_progress:provider',
      'in_progress->completed:provider',
    ],
  );
});

test('state machine: lompat status ditolak 409 INVALID_TRANSITION', async () => {
  const { app } = setup();
  const booking = await createBooking(app);

  for (const name of ['start', 'complete']) {
    const res = await act(app, providerUser, booking.id, name);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'INVALID_TRANSITION');
  }
  await act(app, providerUser, booking.id, 'accept');
  assert.equal((await act(app, providerUser, booking.id, 'accept')).status, 409);
  assert.equal(
    (await act(app, providerUser, booking.id, 'reject', { reason: 'Kapasitas penuh hari itu' }))
      .status,
    409,
  );
});

test('reject wajib alasan minimal 10 karakter dan tersimpan sebagai status_reason', async () => {
  const { app } = setup();
  const booking = await createBooking(app);

  assert.equal((await act(app, providerUser, booking.id, 'reject')).status, 400);
  assert.equal(
    (await act(app, providerUser, booking.id, 'reject', { reason: 'Penuh' })).status,
    400,
  );

  const res = await act(app, providerUser, booking.id, 'reject', {
    reason: 'Kapasitas penuh di jam tersebut',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'rejected');
  assert.equal(res.body.data.status_reason, 'Kapasitas penuh di jam tersebut');
  assert.equal(res.body.data.history.at(-1).reason, 'Kapasitas penuh di jam tersebut');
});

test('start hanya pada atau setelah tanggal jadwal (WIB)', async () => {
  const { app } = setup();
  const booking = await createBooking(app, { ...fixedBody, scheduled_date: NEXT_MONDAY });
  await act(app, providerUser, booking.id, 'accept');

  const res = await act(app, providerUser, booking.id, 'start');
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /tanggal jadwal/);
});

test('complete: hourly wajib actual_quantity, starting_from wajib final_total ≥ harga awal', async () => {
  const { app } = setup();
  const toInProgress = async (body) => {
    const booking = await createBooking(app, body);
    await act(app, providerUser, booking.id, 'accept');
    await act(app, providerUser, booking.id, 'start');
    return booking;
  };

  const hourly = await toInProgress({
    service_id: SERVICES.hourly.id,
    scheduled_date: MONDAY,
    start_time: '09:00',
    service_mode: 'at_customer',
    quantity: 2,
    location_area: 'Bekasi Timur',
    location_address: 'Jl. Melati No. 10',
  });
  assert.equal((await act(app, providerUser, hourly.id, 'complete')).status, 400);
  const hourlyDone = await act(app, providerUser, hourly.id, 'complete', { actual_quantity: 2.5 });
  assert.equal(hourlyDone.body.data.actual_quantity, 2.5);
  assert.equal(hourlyDone.body.data.final_total, 100000);

  const from = await toInProgress({ ...fixedBody, service_id: SERVICES.from.id });
  assert.equal((await act(app, providerUser, from.id, 'complete')).status, 400);
  const tooLow = await act(app, providerUser, from.id, 'complete', { final_total: 50000 });
  assert.equal(tooLow.status, 400);
  assert.equal(tooLow.body.error.details[0].field, 'final_total');
  const fromDone = await act(app, providerUser, from.id, 'complete', { final_total: 110000 });
  assert.equal(fromDone.body.data.final_total, 110000);
});

test('cancel: customer dari requested/accepted; provider hanya dari accepted dengan alasan', async () => {
  const { app } = setup();

  const first = await createBooking(app);
  const byCustomer = await act(app, customer, first.id, 'cancel');
  assert.equal(byCustomer.status, 200);
  assert.equal(byCustomer.body.data.cancelled_by, 'customer');

  const second = await createBooking(app);
  assert.equal(
    (await act(app, providerUser, second.id, 'cancel', { reason: 'Ada keperluan mendadak' }))
      .status,
    409,
  );
  await act(app, providerUser, second.id, 'accept');
  assert.equal((await act(app, providerUser, second.id, 'cancel')).status, 400);
  const byProvider = await act(app, providerUser, second.id, 'cancel', {
    reason: 'Ada keperluan mendadak',
  });
  assert.equal(byProvider.status, 200);
  assert.equal(byProvider.body.data.cancelled_by, 'provider');
  assert.equal(byProvider.body.data.status_reason, 'Ada keperluan mendadak');

  const third = await createBooking(app);
  await act(app, providerUser, third.id, 'accept');
  await act(app, providerUser, third.id, 'start');
  assert.equal(
    (await act(app, customer, third.id, 'cancel')).status,
    409,
    'in_progress tidak bisa dibatalkan',
  );
});

test('peran salah: customer tidak bisa accept (403), provider lain dan admin tidak bisa mengubah', async () => {
  const { app } = setup();
  const booking = await createBooking(app);

  const res = await act(app, customer, booking.id, 'accept');
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  assert.equal((await act(app, otherProviderUser, booking.id, 'accept')).status, 404);
  assert.equal((await act(app, admin, booking.id, 'accept')).status, 403);
});
