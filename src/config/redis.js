const { createClient } = require('redis');
const env = require('./env');

let client;

/**
 * Client Redis bersama, atau null jika REDIS_URL kosong. Koneksi dibuka di latar belakang dan
 * tersambung ulang sendiri; selama putus, pemakai Redis jatuh ke fallback (memori atau MySQL).
 */
function getClient() {
  if (!env.redis.enabled) return null;
  if (!client) {
    client = createClient({
      url: env.redis.url,
      // RESP2 supaya juga jalan di Redis lama (mis. Redis 5 bawaan Laragon) yang belum kenal HELLO 3.
      RESP: 2,
      // Perintah langsung gagal saat Redis putus, bukan antre, supaya request tidak menggantung.
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => Math.min(retries * 500, 5000),
      },
    });

    // Error yang sama tidak ditulis berulang setiap percobaan sambung ulang.
    let lastError = '';
    client.on('error', (error) => {
      if (error.message === lastError) return;
      lastError = error.message;
      console.error(`[redis] ${error.message || error.code || 'koneksi gagal'}`);
    });
    client.on('ready', () => {
      lastError = '';
      if (!env.isTest) console.log('[redis] terhubung');
    });

    client.connect().catch(() => {});
  }
  return client;
}

async function close() {
  if (!client) return;
  const current = client;
  client = undefined;
  if (current.isReady) await current.close();
  else current.destroy();
}

module.exports = { getClient, close };
