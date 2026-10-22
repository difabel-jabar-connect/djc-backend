const env = require('./config/env');
const db = require('./config/db');
const createApp = require('./app');

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`API berjalan di http://localhost:${env.port}/api/v1 (${env.nodeEnv})`);
});

async function shutdown(signal) {
  console.log(`${signal} diterima, menutup server...`);
  server.close(async () => {
    await db.closePool();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
