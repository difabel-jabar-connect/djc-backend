// Tes pencabutan sesi (tokenBlacklist) tanpa Redis: memakai fallback in-memory.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { createTokenBlacklist, issuedBefore } = require('../src/services/tokenBlacklist');
const { signToken } = require('../src/utils/token');

const user = { id: randomUUID(), role: 'customer' };
const payloadOf = (token) => jwt.decode(token);

test('revokeToken mencabut satu token, token lain milik user yang sama tetap berlaku', async () => {
  const blacklist = createTokenBlacklist();
  const a = payloadOf(signToken(user).token);
  const b = payloadOf(signToken(user).token);
  await blacklist.revokeToken(a);
  assert.equal(await blacklist.isRevoked(a), true);
  assert.equal(await blacklist.isRevoked(b), false);
});

test('revokeAllForUser mencabut token lama, tapi login sesudahnya di detik yang sama tetap berlaku', async () => {
  const blacklist = createTokenBlacklist();
  const before = payloadOf(signToken(user).token);
  await new Promise((resolve) => setTimeout(resolve, 2));
  await blacklist.revokeAllForUser(user.id);
  await new Promise((resolve) => setTimeout(resolve, 2));
  const after = payloadOf(signToken(user).token);

  assert.equal(await blacklist.isRevoked(before), true);
  assert.equal(await blacklist.isRevoked(after), false, 'token baru tidak ikut dicabut');
});

test('revokeAllForUser menghormati exceptJti (sesi yang sedang ganti kata sandi)', async () => {
  const blacklist = createTokenBlacklist();
  await new Promise((resolve) => setTimeout(resolve, 2));
  const kept = signToken(user);
  await blacklist.revokeAllForUser(user.id, { exceptJti: kept.jti });
  assert.equal(await blacklist.isRevoked(payloadOf(kept.token)), false);
});

test('issuedBefore: token lama tanpa iat_ms dibandingkan per detik', () => {
  const record = { epochSec: 1000, epochMs: 1_000_500 };
  assert.equal(issuedBefore({ iat: 1000 }, record), true);
  assert.equal(issuedBefore({ iat: 1001 }, record), false);
  assert.equal(issuedBefore({ iat: 1000, iat_ms: 1_000_400 }, record), true);
  assert.equal(issuedBefore({ iat: 1000, iat_ms: 1_000_600 }, record), false);
  assert.equal(issuedBefore({ iat: 999, jti: 'x' }, { ...record, exceptJti: 'x' }), false);
});
