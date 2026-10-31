// Cache JSON di Redis untuk data publik yang jarang berubah, mis. daftar kategori.
// Tanpa Redis (atau saat Redis putus) setiap pemanggilan langsung membaca sumber datanya.
const env = require('../config/env');

/**
 * `remember(key, ttlSeconds, load)` mengembalikan isi cache atau hasil `load()` lalu menyimpannya;
 * `forget(key)` menghapus cache setelah data sumber berubah.
 */
function createCache({ redis, prefix = env.redis.prefix, logger = console }) {
  const fullKey = (key) => `${prefix}cache:${key}`;
  const warn = (error) => logger.warn(`[cache] ${error.message}`);

  async function remember(key, ttlSeconds, load) {
    if (redis?.isReady) {
      try {
        const hit = await redis.get(fullKey(key));
        if (hit !== null) return JSON.parse(hit);
      } catch (error) {
        warn(error);
      }
    }

    const value = await load();
    if (redis?.isReady) {
      try {
        await redis.set(fullKey(key), JSON.stringify(value), { EX: ttlSeconds });
      } catch (error) {
        warn(error);
      }
    }
    return value;
  }

  // Jika Redis sedang putus, cache lama hilang sendiri setelah TTL-nya habis.
  async function forget(key) {
    if (!redis?.isReady) return;
    try {
      await redis.del(fullKey(key));
    } catch (error) {
      warn(error);
    }
  }

  return { remember, forget };
}

module.exports = { createCache };
