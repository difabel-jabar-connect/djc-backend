const env = require('../config/env');

const DEFAULT_USER_REVOKE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * true jika token terbit sebelum (atau tepat saat) pencabutan massal milik user-nya.
 * Token baru membawa `iat_ms` sehingga login di detik yang sama setelah reset kata sandi
 * tidak ikut tercabut; token lama tanpa `iat_ms` dibandingkan per detik seperti sebelumnya.
 */
function issuedBefore(payload, record) {
  if (record.exceptJti && payload.jti === record.exceptJti) return false;
  if (typeof payload.iat_ms === 'number' && typeof record.epochMs === 'number') {
    return payload.iat_ms <= record.epochMs;
  }
  return payload.iat <= record.epochSec;
}

/**
 * Denylist JWT (OWASP A07) berbasis Redis dengan fallback in-memory.
 * - `revokeToken(payload)`: membatalkan satu token berdasarkan `jti` sampai `exp`.
 * - `revokeAllForUser(userId)`: membatalkan semua token milik user yang diterbitkan sebelum waktu ini
 *   (dipakai saat reset/ganti kata sandi).
 */
function createTokenBlacklist({ redis = null, prefix = env.redis.prefix } = {}) {
  const revokedJti = new Map(); // jti -> expiresAtMs
  const userRevokedBefore = new Map(); // userId -> { epochSec, expiresAtMs }

  function prune() {
    const nowMs = Date.now();
    for (const [key, exp] of revokedJti) {
      if (exp <= nowMs) revokedJti.delete(key);
    }
    for (const [key, entry] of userRevokedBefore) {
      if (entry.expiresAtMs <= nowMs) userRevokedBefore.delete(key);
    }
  }

  const jtiKey = (jti) => `${prefix}revoked:jti:${jti}`;
  const userKey = (userId) => `${prefix}revoked:user:${userId}`;

  async function revokeToken(payload) {
    if (!payload?.jti) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const ttl = Math.max(1, (payload.exp ?? nowSec + 24 * 3600) - nowSec);
    prune();
    revokedJti.set(payload.jti, Date.now() + ttl * 1000);
    if (redis) {
      try {
        await redis.set(jtiKey(payload.jti), '1', { EX: ttl });
      } catch {
        // Fallback in-memory sudah tercatat di atas.
      }
    }
  }

  async function revokeAllForUser(
    userId,
    { ttlSeconds = DEFAULT_USER_REVOKE_TTL_SECONDS, exceptJti = null } = {},
  ) {
    if (!userId) return;
    const epochMs = Date.now();
    const epochSec = Math.floor(epochMs / 1000);
    prune();
    const record = { epochSec, epochMs, exceptJti, expiresAtMs: epochMs + ttlSeconds * 1000 };
    userRevokedBefore.set(userId, record);
    if (redis) {
      try {
        await redis.set(userKey(userId), JSON.stringify({ epochSec, epochMs, exceptJti }), {
          EX: ttlSeconds,
        });
      } catch {
        // Fallback in-memory sudah tercatat di atas.
      }
    }
  }

  async function isRevoked(payload) {
    if (!payload) return false;
    const nowMs = Date.now();

    if (payload.jti) {
      const memExp = revokedJti.get(payload.jti);
      if (memExp && memExp > nowMs) return true;
      if (redis) {
        try {
          if (await redis.get(jtiKey(payload.jti))) return true;
        } catch {
          // Lanjutkan cek in-memory.
        }
      }
    }

    if (payload.sub && typeof payload.iat === 'number') {
      const memUser = userRevokedBefore.get(payload.sub);
      if (memUser && memUser.expiresAtMs > nowMs && issuedBefore(payload, memUser)) return true;
      if (redis) {
        try {
          const raw = await redis.get(userKey(payload.sub));
          if (raw !== null) {
            const parsed = raw.startsWith('{') ? JSON.parse(raw) : { epochSec: Number(raw) };
            if (issuedBefore(payload, parsed)) return true;
          }
        } catch {
          // Lanjutkan.
        }
      }
    }

    return false;
  }

  return { revokeToken, revokeAllForUser, isRevoked };
}

module.exports = { createTokenBlacklist, issuedBefore };
