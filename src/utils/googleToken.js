const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Verifikasi ID token Google Identity Services tanpa paket tambahan:
// kunci publik Google (JWKS) diambil lalu di-cache sesuai Cache-Control max-age.
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

let cache = { keys: new Map(), expiresAt: 0 };

async function fetchKeys() {
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) throw new Error(`Gagal mengambil kunci Google (${res.status}).`);
  const { keys } = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] ?? 3600);
  cache = {
    keys: new Map(
      keys.map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })]),
    ),
    expiresAt: Date.now() + maxAge * 1000,
  };
}

async function getKey(kid) {
  // Google merotasi kunci; kid baru yang belum dikenal memicu ambil ulang.
  if (Date.now() >= cache.expiresAt || !cache.keys.has(kid)) await fetchKeys();
  return cache.keys.get(kid) ?? null;
}

/**
 * Mengembalikan { email, name } dari ID token Google yang valid dan emailnya sudah
 * diverifikasi Google, atau null jika token tidak valid. Melempar error jika kunci
 * publik Google tidak bisa diambil.
 */
async function verifyGoogleToken(credential, { clientId = env.google.clientId } = {}) {
  const decoded = jwt.decode(credential, { complete: true });
  if (!decoded?.header?.kid) return null;

  const key = await getKey(decoded.header.kid);
  if (!key) return null;

  let payload;
  try {
    payload = jwt.verify(credential, key, {
      algorithms: ['RS256'],
      audience: clientId,
      issuer: GOOGLE_ISSUERS,
    });
  } catch {
    return null;
  }

  if (payload.email_verified !== true || typeof payload.email !== 'string') return null;
  return { email: payload.email.toLowerCase(), name: payload.name || '' };
}

module.exports = { verifyGoogleToken };
