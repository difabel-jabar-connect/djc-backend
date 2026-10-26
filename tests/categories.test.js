// Tes endpoint kategori tanpa MySQL: repository kategori dan user diganti versi in-memory.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const createApp = require('../src/app');
const { slugify } = require('../src/routes/categories');
const { signToken } = require('../src/utils/token');

function fakeUsers(...list) {
  const rows = new Map(list.map((user) => [user.id, user]));
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
  };
}

function fakeCategories(initial = []) {
  const rows = new Map(initial.map((category) => [category.id, { ...category }]));
  const actions = [];
  return {
    rows,
    actions,
    async listActive() {
      return [...rows.values()]
        .filter((category) => category.is_active)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findConflict({ name, slug, excludeId = null }) {
      return (
        [...rows.values()].find(
          (category) =>
            category.id !== excludeId &&
            (category.name.toLowerCase() === name.toLowerCase() || category.slug === slug),
        ) ?? null
      );
    },
    async create({ name, slug, icon, sortOrder, isActive }, { adminId }) {
      const category = {
        id: randomUUID(),
        name,
        slug,
        icon,
        sort_order: sortOrder,
        is_active: isActive,
      };
      rows.set(category.id, category);
      actions.push({ adminId, action: 'create_category', targetId: category.id });
      return category;
    },
    async update(id, changes, { adminId }) {
      const category = rows.get(id);
      const columns = { sortOrder: 'sort_order', isActive: 'is_active' };
      for (const [key, value] of Object.entries(changes)) category[columns[key] ?? key] = value;
      actions.push({ adminId, action: 'update_category', targetId: id });
      return category;
    },
  };
}

const admin = { id: randomUUID(), role: 'admin', status: 'active' };
const customer = { id: randomUUID(), role: 'customer', status: 'active' };
const bearer = (user) => `Bearer ${signToken(user).token}`;

const seeded = [
  {
    id: randomUUID(),
    name: 'Servis Elektronik',
    slug: 'servis-elektronik',
    icon: 'servis-elektronik',
    sort_order: 2,
    is_active: true,
  },
  {
    id: randomUUID(),
    name: 'Kebersihan',
    slug: 'kebersihan',
    icon: 'kebersihan',
    sort_order: 1,
    is_active: true,
  },
  { id: randomUUID(), name: 'Arsip', slug: 'arsip', icon: null, sort_order: 0, is_active: false },
];

function app(categories = fakeCategories(seeded), users = fakeUsers(admin, customer)) {
  return createApp({ categories, users });
}

test('GET /categories publik: hanya kategori aktif, urut sort_order', async () => {
  const res = await request(app()).get('/api/v1/categories');

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.data.map((category) => category.slug),
    ['kebersihan', 'servis-elektronik'],
  );
  assert.deepEqual(Object.keys(res.body.data[0]).sort(), [
    'icon',
    'id',
    'name',
    'slug',
    'sort_order',
  ]);
});

test('admin menambah kategori: slug dibuat dari nama dan aksi dicatat', async () => {
  const categories = fakeCategories(seeded);

  const res = await request(app(categories))
    .post('/api/v1/admin/categories')
    .set('Authorization', bearer(admin))
    .send({ name: '  Pijat & Refleksi ', icon: 'spa', sort_order: 9 });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.name, 'Pijat & Refleksi');
  assert.equal(res.body.data.slug, 'pijat-refleksi');
  assert.equal(res.body.data.is_active, true);
  assert.deepEqual(categories.actions.at(-1), {
    adminId: admin.id,
    action: 'create_category',
    targetId: res.body.data.id,
  });
});

test('admin mengubah dan menonaktifkan kategori', async () => {
  const categories = fakeCategories(seeded);
  const target = seeded[0];

  const res = await request(app(categories))
    .put(`/api/v1/admin/categories/${target.id}`)
    .set('Authorization', bearer(admin))
    .send({ name: 'Servis Elektronik & Listrik', is_active: false });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.name, 'Servis Elektronik & Listrik');
  assert.equal(res.body.data.slug, 'servis-elektronik', 'slug tidak berubah kalau tidak dikirim');
  assert.equal(res.body.data.is_active, false);
  assert.equal(categories.actions.at(-1).action, 'update_category');

  const publicList = await request(app(categories)).get('/api/v1/categories');
  assert.ok(!publicList.body.data.some((category) => category.id === target.id));
});

test('nama atau slug kategori duplikat ditolak 409 CONFLICT', async () => {
  const categories = fakeCategories(seeded);
  const api = app(categories);

  for (const body of [{ name: 'kebersihan' }, { name: 'Bersih-bersih', slug: 'kebersihan' }]) {
    const res = await request(api)
      .post('/api/v1/admin/categories')
      .set('Authorization', bearer(admin))
      .send(body);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
  }

  const rename = await request(api)
    .put(`/api/v1/admin/categories/${seeded[0].id}`)
    .set('Authorization', bearer(admin))
    .send({ name: 'Kebersihan' });
  assert.equal(rename.status, 409);
  assert.equal(categories.actions.length, 0);
});

test('endpoint admin kategori: 401 tanpa token, 403 untuk non-admin', async () => {
  const api = app();

  const anonymous = await request(api).post('/api/v1/admin/categories').send({ name: 'Baru' });
  assert.equal(anonymous.status, 401);

  const asCustomer = await request(api)
    .post('/api/v1/admin/categories')
    .set('Authorization', bearer(customer))
    .send({ name: 'Baru' });
  assert.equal(asCustomer.status, 403);
  assert.equal(asCustomer.body.error.code, 'FORBIDDEN');
});

test('admin suspended tidak bisa mengubah kategori', async () => {
  const suspendedAdmin = { id: randomUUID(), role: 'admin', status: 'suspended' };

  const res = await request(app(fakeCategories(seeded), fakeUsers(suspendedAdmin)))
    .post('/api/v1/admin/categories')
    .set('Authorization', bearer(suspendedAdmin))
    .send({ name: 'Baru' });

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'ACCOUNT_SUSPENDED');
});

test('validasi kategori: 400 dengan detail per field, 404 untuk id yang tidak ada', async () => {
  const api = app();

  const invalid = await request(api)
    .post('/api/v1/admin/categories')
    .set('Authorization', bearer(admin))
    .send({ name: 'A', slug: 'Bukan Slug', sort_order: -1, is_active: 'ya' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(invalid.body.error.details.map((detail) => detail.field).sort(), [
    'is_active',
    'name',
    'slug',
    'sort_order',
  ]);

  const empty = await request(api)
    .put(`/api/v1/admin/categories/${seeded[0].id}`)
    .set('Authorization', bearer(admin))
    .send({});
  assert.equal(empty.status, 400);

  for (const id of [randomUUID(), 'bukan-uuid']) {
    const missing = await request(api)
      .put(`/api/v1/admin/categories/${id}`)
      .set('Authorization', bearer(admin))
      .send({ name: 'Apa Saja' });
    assert.equal(missing.status, 404);
  }
});

test('slugify membuat slug dari nama', () => {
  assert.equal(slugify('Servis Elektronik'), 'servis-elektronik');
  assert.equal(slugify('  Kue & Roti  '), 'kue-roti');
  assert.equal(slugify('Café Kopi'), 'cafe-kopi');
  assert.equal(slugify('!!!'), '');
});
