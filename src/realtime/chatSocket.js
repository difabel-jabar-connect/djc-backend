const { Server } = require('socket.io');
const env = require('../config/env');
const { ApiError } = require('../utils/response');
const { COOKIE_NAME, verifyToken } = require('../utils/token');
const { createChatService, room, userRoom } = require('../services/chat');

// Socket.io untuk chat per booking (BE-10, issue #32).
//
// Handshake: token dari cookie djc_token (browser, withCredentials: true), atau
// `auth: { token }` / header Authorization Bearer untuk klien lain.
// Setiap koneksi otomatis masuk room `user:<id>` (event `inbox_updated`).
//
// Event dari klien (semua menerima callback ack opsional → { ok, data } atau { ok, error }):
//   join_room    { booking_id }               → masuk room booking:<id>
//   leave_room   { booking_id }
//   send_message { booking_id, text }         → broadcast `new_message`
//   typing       { booking_id, is_typing }    → broadcast `user_typing` (ke peserta lain)
//   mark_read    { booking_id }               → broadcast `messages_read`
// Tanpa ack, error dikirim sebagai event `chat_error`.

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[name] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

function readHandshakeToken(handshake) {
  if (typeof handshake.auth?.token === 'string' && handshake.auth.token) {
    return handshake.auth.token.replace(/^Bearer\s+/i, '');
  }
  const header = handshake.headers?.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return parseCookies(handshake.headers?.cookie)[COOKIE_NAME];
}

function errorPayload(error) {
  if (error instanceof ApiError) {
    const body = { code: error.code, message: error.message };
    if (error.details) body.details = error.details;
    return body;
  }
  console.error(error);
  return { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server.' };
}

/**
 * Memasang Socket.io ke server HTTP dan menghubungkannya ke `chatHub`, supaya pesan
 * yang dikirim lewat REST juga sampai ke klien yang tersambung.
 */
function attachChatSocket(
  httpServer,
  { chatHub, chat, users, now, corsOrigins = env.corsOrigins } = {},
) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    serveClient: false,
    // Pesan maksimal 1000 karakter; payload lebih besar dari ini pasti tidak valid.
    maxHttpBufferSize: 16 * 1024,
  });
  const service = createChatService({ chat, users, hub: chatHub, now });
  chatHub.attach(io);

  io.use((socket, next) => {
    const token = readHandshakeToken(socket.handshake);
    const payload = token ? verifyToken(token) : null;
    if (!payload?.sub) {
      const error = new Error('Silakan masuk terlebih dahulu.');
      error.data = { code: 'UNAUTHENTICATED' };
      return next(error);
    }
    socket.data.auth = { userId: payload.sub, role: payload.role };
    // bookingId → peran di booking itu, untuk room yang sudah diikuti socket ini.
    socket.data.joined = new Map();
    return next();
  });

  io.on('connection', (socket) => {
    const { auth, joined } = socket.data;
    socket.join(userRoom(auth.userId));

    const handle = (event, fn) => {
      socket.on(event, async (payload, ack) => {
        const callback = typeof payload === 'function' ? payload : ack;
        const input = payload && typeof payload === 'object' ? payload : {};
        try {
          const data = await fn(input);
          if (typeof callback === 'function') callback({ ok: true, data });
        } catch (error) {
          const body = errorPayload(error);
          if (typeof callback === 'function') callback({ ok: false, error: body });
          else socket.emit('chat_error', { event, ...body });
        }
      });
    };

    handle('join_room', async ({ booking_id: bookingId }) => {
      const { booking, viewer } = await service.access(bookingId, auth);
      await socket.join(room(booking.id));
      joined.set(booking.id, viewer);
      return {
        booking_id: booking.id,
        status: booking.status,
        can_send: service.canSend(booking, viewer),
      };
    });

    handle('leave_room', async ({ booking_id: bookingId }) => {
      await socket.leave(room(bookingId));
      joined.delete(bookingId);
      return { booking_id: bookingId };
    });

    handle('send_message', ({ booking_id: bookingId, text, message_text: messageText }) =>
      service.send(bookingId, auth, text ?? messageText),
    );

    handle('typing', async ({ booking_id: bookingId, is_typing: isTyping }) => {
      const viewer = joined.get(bookingId);
      if (!viewer || viewer === 'admin') {
        throw new ApiError(403, 'FORBIDDEN', 'Gabung ke percakapan pesanan ini terlebih dahulu.');
      }
      const payload = {
        booking_id: bookingId,
        user_id: auth.userId,
        role: viewer,
        is_typing: Boolean(isTyping),
      };
      socket.to(room(bookingId)).emit('user_typing', payload);
      return payload;
    });

    handle('mark_read', ({ booking_id: bookingId }) => service.markRead(bookingId, auth));
  });

  return io;
}

module.exports = { attachChatSocket, parseCookies, readHandshakeToken };
