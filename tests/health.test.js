process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../src/app');

test('GET /api/v1/health mengembalikan status ok saat database terhubung', async () => {
  const app = createApp({ pingDb: async () => ({ version: '8.4.0' }) });

  const res = await request(app).get('/api/v1/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'ok');
  assert.equal(res.body.data.database, 'up');
  assert.ok(!Number.isNaN(Date.parse(res.body.data.timestamp)));
});

test('GET /api/v1/health mengembalikan 503 saat database tidak terhubung', async () => {
  const app = createApp({
    pingDb: async () => {
      throw new Error('ECONNREFUSED');
    },
  });

  const res = await request(app).get('/api/v1/health');

  assert.equal(res.status, 503);
  assert.equal(res.body.data.status, 'degraded');
  assert.equal(res.body.data.database, 'down');
});

test('endpoint yang tidak ada mengembalikan error 404 berformat standar', async () => {
  const app = createApp({ pingDb: async () => ({}) });

  const res = await request(app).get('/api/v1/tidak-ada');

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.equal(typeof res.body.error.message, 'string');
});

test('body JSON rusak mengembalikan 400 INVALID_JSON', async () => {
  const app = createApp({ pingDb: async () => ({}) });

  const res = await request(app)
    .post('/api/v1/health')
    .set('Content-Type', 'application/json')
    .send('{"rusak":');

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_JSON');
});

test('CORS mengizinkan origin frontend lokal', async () => {
  const app = createApp({ pingDb: async () => ({}) });

  const res = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');

  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal(res.headers['access-control-allow-credentials'], 'true');
});
