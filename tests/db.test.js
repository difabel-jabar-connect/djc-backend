// Tes koneksi ke MySQL sungguhan. Hanya jalan jika DB_TEST=1, agar `npm test`
// tetap lulus di mesin yang belum menyalakan MySQL.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

test('koneksi MySQL 8 sesuai .env', { skip: process.env.DB_TEST !== '1' }, async () => {
  const db = require('../src/config/db');
  try {
    const { version } = await db.ping();
    assert.match(version, /^8\./);
  } finally {
    await db.closePool();
  }
});
