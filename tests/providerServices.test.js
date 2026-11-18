// Tes katalog layanan provider (SP2-07) tanpa MySQL: repository diganti versi in-memory.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const createApp = require('../src/app');
const { signToken } = require('../src/utils/token');

const providerUser = { id: randomUUID(), role: 'provider', status: 'active' };
const otherProviderUser = { id: randomUUID(), role: 'provider', status: 'active' };
const customerUser = { id: randomUUID(), role: 'customer', status: 'active' };
const suspendedProvider = { id: randomUUID(), role: 'provider', status: 'suspended' };
const bearer = (user) => `Bearer ${signToken(user).token}`;

const activeCategory = {
  id: randomUUID(),
  name: 'Servis Elektronik',
  slug: 'servis',
  is_active: true,
};
const inactiveCategory = { id: randomUUID(), name: 'Lama', slug: 'lama', is_active: false };

function setup() {
  const profiles = new Map(
    [providerUser, otherProviderUser, suspendedProvider].map((user) => [
      user.id,
      { id: randomUUID(), user_id: user.id },
    ]),
  );
  const categoryRows = new Map([activeCategory, inactiveCategory].map((c) => [c.id, c]));
  const rows = new Map();

  const view = (row) => {
    const category = categoryRows.get(row.category_id);
    const rest = { ...row };
    delete rest.category_id;
    delete rest.provider_id;
    return { ...rest, category: { ...category } };
  };

  const services = {
    rows,
    async listOwn(providerId) {
      return [...rows.values()].filter((row) => row.provider_id === providerId).map(view);
    },
    async findOwn(providerId, id) {
      const row = rows.get(id);
      return row && row.provider_id === providerId ? view(row) : null;
    },
    async createOwn(providerId, data) {
      const row = {
        id: randomUUID(),
        provider_id: providerId,
        description: null,
        min_hours: null,
        duration_estimate_min: null,
        is_active: true,
        ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
      };
      rows.set(row.id, row);
      return view(row);
    },
    async updateOwn(providerId, id, changes) {
      const row = rows.get(id);
      if (!row || row.provider_id !== providerId) return null;
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) row[key] = value;
      }
      return view(row);
    },
  };
  const providers = {
    async findOwnByUserId(userId) {
      return profiles.get(userId) ?? null;
    },
  };
  const categories = {
    async findById(id) {
      return categoryRows.get(id) ?? null;
    },
  };
  const users = {
    async findById(id) {
      return (
        [providerUser, otherProviderUser, customerUser, suspendedProvider].find(
          (u) => u.id === id,
        ) ?? null
      );
    },
  };
  return { services, app: createApp({ services, providers, categories, users }) };
}

const validService = {
  category_id: activeCategory.id,
  title: 'Servis kipas angin',
  description: 'Ganti kapasitor dan bersihkan motor.',
  pricing_type: 'fixed',
  price_amount: 50000,
  duration_estimate_min: 60,
  service_mode: 'at_customer',
};

test('provider menambah layanan lalu melihatnya di daftar miliknya', async () => {
  const { app } = setup();

  const created = await request(app)
    .post('/api/v1/provider/services')
    .set('Authorization', bearer(providerUser))
    .send(validService);

  assert.equal(created.status, 201);
  assert.equal(created.body.data.title, 'Servis kipas angin');
  assert.equal(created.body.data.is_active, true);
  assert.equal(created.body.data.min_hours, null);
  assert.equal(created.body.data.category.id, activeCategory.id);

  const list = await request(app)
    .get('/api/v1/provider/services')
    .set('Authorization', bearer(providerUser));
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);

  const detail = await request(app)
    .get(`/api/v1/provider/services/${created.body.data.id}`)
    .set('Authorization', bearer(providerUser));
  assert.equal(detail.status, 200);
});

test('tarif per jam wajib min_hours; tarif lain menolak min_hours', async () => {
  const { app } = setup();
  const post = (body) =>
    request(app)
      .post('/api/v1/provider/services')
      .set('Authorization', bearer(providerUser))
      .send({ ...validService, ...body });

  const missing = await post({ pricing_type: 'hourly' });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.details[0].field, 'min_hours');

  const extra = await post({ pricing_type: 'fixed', min_hours: 2 });
  assert.equal(extra.status, 400);
  assert.equal(extra.body.error.details[0].field, 'min_hours');

  const ok = await post({ pricing_type: 'hourly', min_hours: 2, price_amount: 40000 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.min_hours, 2);
});

test('validasi: kategori nonaktif/asing, harga nol, moda tidak dikenal ditolak 400', async () => {
  const { app } = setup();
  const post = (body) =>
    request(app)
      .post('/api/v1/provider/services')
      .set('Authorization', bearer(providerUser))
      .send({ ...validService, ...body });

  for (const category_id of [inactiveCategory.id, randomUUID()]) {
    const res = await post({ category_id });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].field, 'category_id');
  }
  assert.equal((await post({ price_amount: 0 })).status, 400);
  assert.equal((await post({ service_mode: 'online' })).status, 400);
  assert.equal((await post({ title: 'ab' })).status, 400);
  const noTitle = { ...validService };
  delete noTitle.title;
  assert.equal(
    (
      await request(app)
        .post('/api/v1/provider/services')
        .set('Authorization', bearer(providerUser))
        .send(noTitle)
    ).status,
    400,
  );
});

test('provider mengubah dan menonaktifkan layanannya', async () => {
  const { app } = setup();
  const auth = bearer(providerUser);
  const created = await request(app)
    .post('/api/v1/provider/services')
    .set('Authorization', auth)
    .send(validService);
  const url = `/api/v1/provider/services/${created.body.data.id}`;

  const toHourly = await request(app)
    .put(url)
    .set('Authorization', auth)
    .send({ pricing_type: 'hourly', min_hours: 3, price_amount: 35000 });
  assert.equal(toHourly.status, 200);
  assert.equal(toHourly.body.data.pricing_type, 'hourly');
  assert.equal(toHourly.body.data.min_hours, 3);

  // Kembali ke harga tetap: min_hours otomatis dikosongkan.
  const backToFixed = await request(app)
    .put(url)
    .set('Authorization', auth)
    .send({ pricing_type: 'starting_from' });
  assert.equal(backToFixed.status, 200);
  assert.equal(backToFixed.body.data.min_hours, null);

  const off = await request(app).put(url).set('Authorization', auth).send({ is_active: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.data.is_active, false);

  const empty = await request(app).put(url).set('Authorization', auth).send({});
  assert.equal(empty.status, 400);
});

test('hourly tanpa min_hours saat ubah model harga ditolak', async () => {
  const { app } = setup();
  const auth = bearer(providerUser);
  const created = await request(app)
    .post('/api/v1/provider/services')
    .set('Authorization', auth)
    .send(validService);

  const res = await request(app)
    .put(`/api/v1/provider/services/${created.body.data.id}`)
    .set('Authorization', auth)
    .send({ pricing_type: 'hourly' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.details[0].field, 'min_hours');
});

test('provider lain tidak bisa melihat atau mengubah layanan milik orang lain', async () => {
  const { app } = setup();
  const created = await request(app)
    .post('/api/v1/provider/services')
    .set('Authorization', bearer(providerUser))
    .send(validService);
  const url = `/api/v1/provider/services/${created.body.data.id}`;
  const other = bearer(otherProviderUser);

  assert.equal((await request(app).get(url).set('Authorization', other)).status, 404);
  assert.equal(
    (await request(app).put(url).set('Authorization', other).send({ is_active: false })).status,
    404,
  );
  const list = await request(app).get('/api/v1/provider/services').set('Authorization', other);
  assert.deepEqual(list.body.data, []);
  assert.equal(
    (await request(app).get('/api/v1/provider/services/bukan-uuid').set('Authorization', other))
      .status,
    404,
  );
});

test('tanpa login 401, customer 403, provider suspended tidak bisa menambah layanan', async () => {
  const { app } = setup();

  assert.equal((await request(app).get('/api/v1/provider/services')).status, 401);
  assert.equal(
    (await request(app).get('/api/v1/provider/services').set('Authorization', bearer(customerUser)))
      .status,
    403,
  );
  const suspended = await request(app)
    .post('/api/v1/provider/services')
    .set('Authorization', bearer(suspendedProvider))
    .send(validService);
  assert.equal(suspended.status, 403);
});
