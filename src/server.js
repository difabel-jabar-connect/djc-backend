const env = require('./config/env');
const db = require('./config/db');
const redis = require('./config/redis');
const createApp = require('./app');
const bookingRepository = require('./repositories/bookingRepository');
const chatRepository = require('./repositories/chatRepository');
const userRepository = require('./repositories/userRepository');
const { createAutoCancel } = require('./services/autoCancel');
const { createChatHub } = require('./services/chat');
const { attachChatSocket } = require('./realtime/chatSocket');

// Hub yang sama dipakai REST dan Socket.io, supaya pesan dari REST ikut di-broadcast.
const chatHub = createChatHub();
const app = createApp({ chatHub });

const server = app.listen(env.port, () => {
  console.log(`API berjalan di http://localhost:${env.port}/api/v1 (${env.nodeEnv})`);
});

// Chat real-time per booking (BE-10), di port yang sama dengan API (path /socket.io).
const io = attachChatSocket(server, {
  chatHub,
  chat: chatRepository,
  users: userRepository,
});

// Auto-cancel booking `requested` yang lewat 24 jam (BE-08), dicek setiap beberapa menit.
const autoCancel = createAutoCancel({ bookings: bookingRepository });
if (env.bookings.autoCancelIntervalMinutes > 0) {
  autoCancel.start(env.bookings.autoCancelIntervalMinutes * 60 * 1000);
}

async function shutdown(signal) {
  console.log(`${signal} diterima, menutup server...`);
  autoCancel.stop();
  // io.close() juga menutup server HTTP-nya.
  io.close(async () => {
    await Promise.all([db.closePool(), redis.close()]);
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
