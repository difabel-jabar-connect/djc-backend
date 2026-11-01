const { MemoryStore } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');

/**
 * Store untuk express-rate-limit. Dengan Redis, hitungan percobaan dibagi semua instance API dan
 * tidak hilang saat server restart. Selama Redis putus (atau tanpa Redis), hitungan disimpan di
 * memori supaya batas percobaan tetap berlaku. Setiap limiter wajib memakai store dan `prefix`
 * sendiri, mis. `djc:rl:login:`.
 */
function createRateLimitStore({ redis, prefix }) {
  const memory = new MemoryStore();
  if (!redis) return memory;

  const remote = new RedisStore({
    prefix,
    sendCommand: (...args) => redis.sendCommand(args),
  });

  async function use(fn) {
    if (redis.isReady) {
      try {
        return await fn(remote);
      } catch {
        // Redis gagal di tengah jalan: lanjut ke memori di bawah.
      }
    }
    return fn(memory);
  }

  return {
    init(options) {
      memory.init(options);
      // Gagal memuat script saat Redis belum siap tidak masalah; store mencoba lagi saat dipakai.
      remote.init(options).catch(() => {});
    },
    increment: (key) => use((store) => store.increment(key)),
    decrement: (key) => use((store) => store.decrement(key)),
    resetKey: (key) => use((store) => store.resetKey(key)),
  };
}

module.exports = { createRateLimitStore };
