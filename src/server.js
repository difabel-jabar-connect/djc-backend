const env = require('./config/env');
const db = require('./config/db');
const redis = require('./config/redis');
const createApp = require('./app');
const bookingRepository = require('./repositories/bookingRepository');
const { createAutoCancel } = require('./services/autoCancel');

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`API berjalan di http://localhost:${env.port}/api/v1 (${env.nodeEnv})`);
});

// Auto-cancel booking `requested` yang lewat 24 jam (BE-08), dicek setiap beberapa menit.
const autoCancel = createAutoCancel({ bookings: bookingRepository });
if (env.bookings.autoCancelIntervalMinutes > 0) {
  autoCancel.start(env.bookings.autoCancelIntervalMinutes * 60 * 1000);
}

async function shutdown(signal) {
  console.log(`${signal} diterima, menutup server...`);
  autoCancel.stop();
  server.close(async () => {
    await Promise.all([db.closePool(), redis.close()]);
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
