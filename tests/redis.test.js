// Tes integrasi Redis tanpa server Redis: client diganti versi in-memory.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const createApp = require('../src/app');
const { createCache } = require('../src/services/cache');
const { signToken } = require('../src/utils/token');

function fakeRedis({ ready = true } = {}) {
  const data = new Map();
  return {
    data,
    isReady: ready,
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async set(key, value) {
      data.set(key, value);
      return 'OK';
    },
    async del(key) {
      return data.delete(key) ? 1 : 0;
    },
    async ping() {
      if (!this.isReady) throw new Error('The client is closed');
      return 'PONG';
    },
    async sendCommand() {
      throw new Error('The client is closed');
    },
  };
}

const silent = { warn() {}, info() {}, error() {} };

test('cache menyimpan hasil load dan memakai isinya pada panggilan berikutnya', async () => {
  const redis = fakeRedis();
  const cache = createCache({ redis, prefix: 't:', logger: silent });
  let loads = 0;
  const load = async () => {
    loads += 1;
    return [{ id: 1 }];
  };

  assert.deepEqual(await cache.remember('k', 60, load), [{ id: 1 }]);
  assert.deepEqual(await cache.remember('k', 60, load), [{ id: 1 }]);
  assert.equal(loads, 1);

  await cache.forget('k');
  await cache.remember('k', 60, load);
  assert.equal(loads, 2);
});

test('cache langsung membaca sumber data saat Redis tidak siap', async () => {
  const cache = createCache({ redis: fakeRedis({ ready: false }), logger: silent });
  let loads = 0;
  const load = async () => {
    loads += 1;
    return 'x';
  };

  await cache.remember('k', 60, load);
  await cache.remember('k', 60, load);
  assert.equal(loads, 2);
});

test('GET /categories memakai cache dan cache dihapus setelah admin menambah kategori', async () => {
  const admin = { id: randomUUID(), role: 'admin', status: 'active' };
  const rows = [];
  let listCalls = 0;
  const categories = {
    async listActive() {
      listCalls += 1;
      return rows.filter((row) => row.is_active);
    },
    async findConflict() {
      return null;
    },
    async create({ name, slug, icon, sortOrder, isActive }) {
      const row = {
        id: randomUUID(),
        name,
        slug,
        icon,
        sort_order: sortOrder,
        is_active: isActive,
      };
      rows.push(row);
      return row;
    },
  };
  const users = { findById: async (id) => (id === admin.id ? admin : null) };
  const redis = fakeRedis();
  const app = createApp({
    categories,
    users,
    redis,
    cache: createCache({ redis, logger: silent }),
  });

  assert.equal((await request(app).get('/api/v1/categories')).body.data.length, 0);
  await request(app).get('/api/v1/categories');
  assert.equal(listCalls, 1);

  const created = await request(app)
    .post('/api/v1/admin/categories')
    .set('Authorization', `Bearer ${signToken(admin).token}`)
    .send({ name: 'Servis Elektronik' });
  assert.equal(created.status, 201);

  const after = await request(app).get('/api/v1/categories');
  assert.equal(after.body.data.length, 1);
  assert.equal(listCalls, 2);
});

test('rate limit login tetap berlaku di memori saat Redis putus', async () => {
  const users = {
    async findByEmail() {
      return null;
    },
  };
  const app = createApp({ users, redis: fakeRedis({ ready: false }), loginLimit: 1 });
  const wrong = { email: 'budi@djc.test', password: 'salah12345' };

  assert.equal((await request(app).post('/api/v1/auth/login').send(wrong)).status, 401);
  assert.equal((await request(app).post('/api/v1/auth/login').send(wrong)).status, 429);
});

test('health melaporkan status Redis', async () => {
  const pingDb = async () => ({});

  const disabled = await request(createApp({ pingDb })).get('/api/v1/health');
  assert.equal(disabled.body.data.redis, 'disabled');
  assert.equal(disabled.body.data.status, 'ok');

  const up = await request(createApp({ pingDb, redis: fakeRedis() })).get('/api/v1/health');
  assert.equal(up.body.data.redis, 'up');
  assert.equal(up.body.data.status, 'ok');

  const down = await request(createApp({ pingDb, redis: fakeRedis({ ready: false }) })).get(
    '/api/v1/health',
  );
  assert.equal(down.status, 200);
  assert.equal(down.body.data.redis, 'down');
  assert.equal(down.body.data.status, 'degraded');
});
