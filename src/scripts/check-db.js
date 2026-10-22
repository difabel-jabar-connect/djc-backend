// Cek koneksi MySQL memakai nilai di .env: `npm run db:check`.
const env = require('../config/env');
const db = require('../config/db');

async function main() {
  const target = `${env.db.user}@${env.db.host}:${env.db.port}/${env.db.database}`;
  try {
    const { version } = await db.ping();
    console.log(`Koneksi MySQL berhasil (${target}), versi server ${version}.`);
    if (!version.startsWith('8.')) {
      console.warn('Peringatan: tim memakai MySQL 8. Versi server ini berbeda.');
    }
    process.exitCode = 0;
  } catch (err) {
    console.error(`Koneksi MySQL gagal (${target}): ${err.code || err.message}`);
    process.exitCode = 1;
  } finally {
    await db.closePool();
  }
}

main();
