const env = require('../config/env');

const DEFAULT_USER_REVOKE_TTL_SECONDS = 7 * 24 * 60 * 60;

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
    const epochSec = Math.floor(Date.now() / 1000);
    prune();
    const record = { epochSec, exceptJti, expiresAtMs: Date.now() + ttlSeconds * 1000 };
    userRevokedBefore.set(userId, record);
    if (redis) {
      try {
        await redis.set(userKey(userId), JSON.stringify({ epochSec, exceptJti }), {
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
      if (
        memUser &&
        memUser.expiresAtMs > nowMs &&
        payload.iat <= memUser.epochSec &&
        (!memUser.exceptJti || payload.jti !== memUser.exceptJti)
      ) {
        return true;
      }
      if (redis) {
        try {
          const raw = await redis.get(userKey(payload.sub));
          if (raw !== null) {
            const parsed = raw.startsWith('{') ? JSON.parse(raw) : { epochSec: Number(raw) };
            if (
              payload.iat <= parsed.epochSec &&
              (!parsed.exceptJti || payload.jti !== parsed.exceptJti)
            ) {
              return true;
            }
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

module.exports = { createTokenBlacklist };
