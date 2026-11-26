// Tes profil provider, jadwal, dan pembulatan lokasi tanpa MySQL: repository diganti
// versi in-memory.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const createApp = require('../src/app');
const { fuzzCoordinate } = require('../src/utils/location');
const { signToken } = require('../src/utils/token');

function fakeUsers(...list) {
  const rows = new Map(list.map((user) => [user.id, user]));
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
  };
}

/** Repository provider palsu dengan satu profil milik `providerUser`. */
function fakeProviders({ userId, verification = 'pending', userStatus = 'active' } = {}) {
  const profile = {
    id: randomUUID(),
    user_id: userId,
    display_name: 'Deni Setiawan',
    bio: null,
    communication_prefs: [],
    disability_type: 'tunadaksa',
    alumni_reg_no: 'PPSGHD-001',
    address_detail: 'Jl. Melati No. 5',
    city: 'Kota Bekasi',
    district: null,
    lat: -6.2383,
    lng: 106.9756,
    public_lat: -6.24,
    public_lng: 106.98,
    service_radius_km: null,
    verification_status: verification,
    rating_avg: 0,
    rating_count: 0,
    phone: '+6281200000020',
  };
  let slots = [];
  return {
    profile,
    async findPublicById(id) {
      if (id !== profile.id || profile.verification_status !== 'verified') return null;
      if (userStatus !== 'active') return null;
      // Sama dengan repository asli: hanya field berlabel Publik.
      const publicFields = Object.fromEntries(
        [
          'id',
          'display_name',
          'bio',
          'communication_prefs',
          'city',
          'district',
          'public_lat',
          'public_lng',
          'service_radius_km',
          'rating_avg',
          'rating_count',
        ].map((key) => [key, profile[key]]),
      );
      return { ...publicFields, skills: [], services: [], availability: slots, portfolio: [] };
    },
    async findOwnByUserId(id) {
      return id === profile.user_id ? { ...profile } : null;
    },
    async updateProfile({ profileId }, changes) {
      assert.equal(profileId, profile.id);
      Object.assign(profile, changes);
      if (changes.lat !== undefined) {
        profile.public_lat = fuzzCoordinate(changes.lat);
        profile.public_lng = fuzzCoordinate(changes.lng);
      }
      return { ...profile };
    },
    async listAvailability() {
      return slots;
    },
    async replaceAvailability(profileId, next) {
      slots = [...next].sort(
        (a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time),
      );
      return slots;
    },
  };
}

const providerUser = { id: randomUUID(), role: 'provider', status: 'active' };
const customerUser = { id: randomUUID(), role: 'customer', status: 'active' };
const bearer = (user) => `Bearer ${signToken(user).token}`;

/** Repository ulasan palsu: dua ulasan tampil dan satu disembunyikan admin. */
function fakeReviews(providers) {
  const rows = [
    {
      rating: 5,
      comment: 'Rapi',
      is_hidden: 0,
      hidden_reason: null,
      customer_name: 'Budi Santoso',
    },
    { rating: 4, comment: null, is_hidden: 0, hidden_reason: null, customer_name: 'Ani' },
    {
      rating: 1,
      comment: 'Kasar <script>',
      is_hidden: 1,
      hidden_reason: 'Bahasa tidak sopan',
      customer_name: 'Citra Pratiwi',
    },
  ].map((row, i) => ({
    ...row,
    id: randomUUID(),
    created_at: `2026-11-2${5 - i}T00:00:00.000Z`,
    service_title: 'Servis kipas',
    booking_code: `DJC-REV0000${i}`,
  }));
  const calls = [];
  return {
    calls,
    async isPublicProvider(id) {
      return Boolean(await providers.findPublicById(id));
    },
    async listByProvider(providerId, options) {
      calls.push([providerId, options]);
      const items = rows.filter((row) => options.includeHidden || !row.is_hidden);
      const start = (options.page - 1) * options.limit;
      return { items: items.slice(start, start + options.limit), total: items.length };
    },
  };
}

function setup(options = {}) {
  const providers = fakeProviders({ userId: providerUser.id, ...options });
  const reviews = fakeReviews(providers);
  const users = fakeUsers(providerUser, customerUser, ...(options.extraUsers ?? []));
  return { providers, reviews, app: createApp({ providers, reviews, users }) };
}

test('fuzzCoordinate membulatkan koordinat ke 2 desimal (~1,1 km)', () => {
  assert.equal(fuzzCoordinate(-6.238321), -6.24);
  assert.equal(fuzzCoordinate(106.975612), 106.98);
  assert.equal(fuzzCoordinate(-6.2349), -6.23);
  assert.equal(fuzzCoordinate(0), 0);
  assert.equal(fuzzCoordinate(null), null);
});

test('GET /providers/:id publik hanya untuk provider verified dan tanpa data privat', async () => {
  const { providers, app } = setup({ verification: 'verified' });

  const res = await request(app).get(`/api/v1/providers/${providers.profile.id}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.display_name, 'Deni Setiawan');
  assert.equal(res.body.data.public_lat, -6.24);
  assert.equal(res.body.data.public_lng, 106.98);
  for (const field of [
    'lat',
    'lng',
    'address_detail',
    'alumni_reg_no',
    'disability_type',
    'phone',
  ]) {
    assert.equal(res.body.data[field], undefined, `${field} tidak boleh dikirim ke publik`);
  }
});

test('GET /providers/:id 404 untuk provider belum verified, id asing, atau bukan UUID', async () => {
  const { providers, app } = setup({ verification: 'pending' });

  for (const id of [providers.profile.id, randomUUID(), 'bukan-uuid']) {
    const res = await request(app).get(`/api/v1/providers/${id}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  }
});

test('provider melihat dan mengubah profilnya; koordinat publik dihitung ulang', async () => {
  const { app } = setup();

  const own = await request(app)
    .get('/api/v1/provider/profile')
    .set('Authorization', bearer(providerUser));
  assert.equal(own.status, 200);
  assert.equal(own.body.data.address_detail, 'Jl. Melati No. 5', 'pemilik melihat alamat lengkap');

  const res = await request(app)
    .put('/api/v1/provider/profile')
    .set('Authorization', bearer(providerUser))
    .send({
      bio: 'Servis kipas dan rice cooker.',
      communication_prefs: ['chat', 'bisindo'],
      district: 'Bekasi Timur',
      lat: -6.238321,
      lng: 106.975612,
      service_radius_km: 10,
      phone: '+6281299998888',
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.bio, 'Servis kipas dan rice cooker.');
  assert.deepEqual(res.body.data.communication_prefs, ['chat', 'bisindo']);
  assert.equal(res.body.data.lat, -6.238321);
  assert.equal(res.body.data.public_lat, -6.24);
  assert.equal(res.body.data.public_lng, 106.98);
  assert.equal(res.body.data.phone, '+6281299998888');
});

test('validasi profil: lat tanpa lng, preferensi tidak dikenal, body kosong ditolak 400', async () => {
  const { app } = setup();
  const put = (body) =>
    request(app)
      .put('/api/v1/provider/profile')
      .set('Authorization', bearer(providerUser))
      .send(body);

  const halfCoords = await put({ lat: -6.2 });
  assert.equal(halfCoords.status, 400);
  assert.equal(halfCoords.body.error.details[0].field, 'lat');

  const badPref = await put({ communication_prefs: ['telepati'] });
  assert.equal(badPref.status, 400);

  const empty = await put({});
  assert.equal(empty.status, 400);

  const longBio = await put({ bio: 'x'.repeat(501) });
  assert.equal(longBio.status, 400);
});

test('provider verified tidak bisa mengosongkan alamat atau koordinat', async () => {
  const { app } = setup({ verification: 'verified' });
  const put = (body) =>
    request(app)
      .put('/api/v1/provider/profile')
      .set('Authorization', bearer(providerUser))
      .send(body);

  const noAddress = await put({ address_detail: '' });
  assert.equal(noAddress.status, 400);
  assert.equal(noAddress.body.error.details[0].field, 'address_detail');

  const noCoords = await put({ lat: null, lng: null });
  assert.equal(noCoords.status, 400);
  assert.equal(noCoords.body.error.details[0].field, 'lat');
});

test('jadwal ketersediaan: simpan, urutkan, dan baca ulang', async () => {
  const { app } = setup();

  const res = await request(app)
    .put('/api/v1/provider/availability')
    .set('Authorization', bearer(providerUser))
    .send({
      availability: [
        { day_of_week: 3, start_time: '08:00', end_time: '12:00' },
        { day_of_week: 1, start_time: '13:00', end_time: '17:00' },
        { day_of_week: 1, start_time: '08:00', end_time: '12:00' },
      ],
    });
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.data.map((slot) => `${slot.day_of_week} ${slot.start_time}`),
    ['1 08:00', '1 13:00', '3 08:00'],
  );

  const list = await request(app)
    .get('/api/v1/provider/availability')
    .set('Authorization', bearer(providerUser));
  assert.equal(list.body.data.length, 3);
});

test('validasi jadwal: end_time > start_time, hari 0–6, format HH:mm, tidak tumpang tindih', async () => {
  const { app } = setup();
  const put = (availability) =>
    request(app)
      .put('/api/v1/provider/availability')
      .set('Authorization', bearer(providerUser))
      .send({ availability });

  const reversed = await put([{ day_of_week: 1, start_time: '17:00', end_time: '08:00' }]);
  assert.equal(reversed.status, 400);
  assert.equal(reversed.body.error.details[0].field, 'availability.0.end_time');

  const badDay = await put([{ day_of_week: 7, start_time: '08:00', end_time: '10:00' }]);
  assert.equal(badDay.status, 400);

  const badFormat = await put([{ day_of_week: 1, start_time: '8:00', end_time: '10:00' }]);
  assert.equal(badFormat.status, 400);

  const overlap = await put([
    { day_of_week: 2, start_time: '08:00', end_time: '12:00' },
    { day_of_week: 2, start_time: '11:00', end_time: '14:00' },
  ]);
  assert.equal(overlap.status, 400);
  assert.equal(overlap.body.error.details[0].field, 'availability.1.start_time');
});

test('endpoint /provider: 401 tanpa token, 403 untuk customer, 403 untuk provider suspended', async () => {
  const suspended = { id: randomUUID(), role: 'provider', status: 'suspended' };
  const { app } = setup({ extraUsers: [suspended] });

  assert.equal((await request(app).get('/api/v1/provider/profile')).status, 401);

  const asCustomer = await request(app)
    .get('/api/v1/provider/profile')
    .set('Authorization', bearer(customerUser));
  assert.equal(asCustomer.status, 403);
  assert.equal(asCustomer.body.error.code, 'FORBIDDEN');

  const suspendedWrite = await request(app)
    .put('/api/v1/provider/availability')
    .set('Authorization', bearer(suspended))
    .send({ availability: [] });
  assert.equal(suspendedWrite.status, 403);
  assert.equal(suspendedWrite.body.error.code, 'ACCOUNT_SUSPENDED');
});

test('GET /providers/:id/reviews: ulasan publik tanpa yang disembunyikan, nama pengulas disingkat', async () => {
  const { app, providers, reviews } = setup({ verification: 'verified' });

  const res = await request(app).get(`/api/v1/providers/${providers.profile.id}/reviews?limit=5`);
  assert.equal(res.status, 200);
  assert.deepEqual(reviews.calls[0], [
    providers.profile.id,
    { includeHidden: false, page: 1, limit: 5 },
  ]);
  assert.deepEqual(res.body.meta, { page: 1, limit: 5, total_items: 2, total_pages: 1 });
  assert.deepEqual(
    res.body.data.map((r) => [r.reviewer_name, r.rating, r.comment]),
    [
      ['Budi S.', 5, 'Rapi'],
      ['Ani', 4, null],
    ],
  );
  for (const key of ['is_hidden', 'hidden_reason', 'booking_code']) {
    assert.equal(key in res.body.data[0], false, `${key} tidak dikirim ke publik`);
  }
  assert.doesNotMatch(JSON.stringify(res.body), /Santoso|Bahasa tidak sopan/);

  assert.equal(
    (await request(app).get(`/api/v1/providers/${providers.profile.id}/reviews?limit=51`)).status,
    400,
  );
});

test('GET /providers/:id/reviews 404 untuk penyedia yang belum verified atau id tidak valid', async () => {
  const { app, providers } = setup({ verification: 'pending' });
  assert.equal(
    (await request(app).get(`/api/v1/providers/${providers.profile.id}/reviews`)).status,
    404,
  );
  assert.equal((await request(app).get('/api/v1/providers/abc/reviews')).status, 404);
});

test('GET /provider/reviews: penyedia membaca semua ulasannya termasuk yang disembunyikan', async () => {
  const { app, reviews } = setup({ verification: 'verified' });

  const res = await request(app)
    .get('/api/v1/provider/reviews')
    .set('Authorization', bearer(providerUser));
  assert.equal(res.status, 200);
  assert.deepEqual(reviews.calls[0][1], { includeHidden: true, page: 1, limit: 10 });
  assert.equal(res.body.data.length, 3);
  const hidden = res.body.data.find((r) => r.is_hidden);
  assert.equal(hidden.hidden_reason, 'Bahasa tidak sopan');
  assert.equal(hidden.reviewer_name, 'Citra P.');
  assert.match(hidden.booking_code, /^DJC-/);

  const forbidden = await request(app)
    .get('/api/v1/provider/reviews')
    .set('Authorization', bearer(customerUser));
  assert.equal(forbidden.status, 403);
  assert.equal((await request(app).get('/api/v1/provider/reviews')).status, 401);
});
