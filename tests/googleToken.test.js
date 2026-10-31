// Tes verifikasi ID token Google tanpa jaringan: fetch JWKS diganti kunci RSA lokal.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { verifyGoogleToken } = require('../src/utils/googleToken');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'kunci-tes', alg: 'RS256', use: 'sig' };

function googleIdToken(payload, options = {}) {
  return jwt.sign(
    { email: 'Budi@Gmail.com', email_verified: true, name: 'Budi Santoso', ...payload },
    privateKey,
    {
      algorithm: 'RS256',
      keyid: 'kunci-tes',
      audience: 'client-id-tes',
      issuer: 'https://accounts.google.com',
      expiresIn: '5m',
      ...options,
    },
  );
}

test.beforeEach((t) => {
  t.mock.method(global, 'fetch', async () => ({
    ok: true,
    headers: new Headers({ 'cache-control': 'public, max-age=60' }),
    json: async () => ({ keys: [jwk] }),
  }));
});

const verify = (token) => verifyGoogleToken(token, { clientId: 'client-id-tes' });

test('ID token Google yang valid menghasilkan email (huruf kecil) dan nama', async () => {
  assert.deepEqual(await verify(googleIdToken()), {
    email: 'budi@gmail.com',
    name: 'Budi Santoso',
  });
});

test('ID token ditolak jika audience, issuer, kedaluwarsa, atau email belum diverifikasi', async () => {
  const rejected = [
    googleIdToken({}, { audience: 'client-lain' }),
    googleIdToken({}, { issuer: 'https://palsu.example.com' }),
    googleIdToken({}, { expiresIn: -1 }),
    googleIdToken({ email_verified: false }),
    'bukan-token',
  ];
  for (const token of rejected) {
    assert.equal(await verify(token), null);
  }
});

test('ID token yang ditandatangani kunci lain ditolak', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const forged = jwt.sign({ email: 'budi@gmail.com', email_verified: true }, other, {
    algorithm: 'RS256',
    keyid: 'kunci-tes',
    audience: 'client-id-tes',
    issuer: 'accounts.google.com',
  });
  assert.equal(await verify(forged), null);
});
