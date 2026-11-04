const { z } = require('zod');
const { ApiError } = require('../utils/response');

// Logika chat per booking (BE-10, issue #32), dipakai bersama oleh REST (src/routes/chat.js)
// dan Socket.io (src/realtime/chatSocket.js) supaya aturan aksesnya sama persis.
//
// - Membaca: customer pemilik booking, provider penerima booking, atau admin.
// - Mengirim dan menandai dibaca: hanya customer/provider booking itu, akun aktif.
// - Kirim pesan hanya saat booking masih berjalan. Status di issue memakai nama
//   pending/confirmed; di skema kita itu requested/accepted (+ in_progress).
//   Selesai, ditolak, atau dibatalkan → read-only (400).

const OPEN_STATUSES = ['requested', 'accepted', 'in_progress'];
const MAX_LENGTH = 1000;

const idSchema = z.uuid();

const room = (bookingId) => `booking:${bookingId}`;
const userRoom = (userId) => `user:${userId}`;

/**
 * Membersihkan teks pesan: buang tag HTML/script dan karakter kontrol (kecuali baris baru
 * dan tab), lalu trim. Frontend tetap wajib menampilkan pesan sebagai teks biasa.
 */
function sanitizeText(value) {
  let text = String(value ?? '');
  // Isi <script>/<style> ikut dibuang, bukan hanya tag-nya.
  text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  // Diulang sampai stabil supaya tag bersarang seperti "<scr<b>ipt>" tidak tersisa.
  for (let previous; previous !== text;) {
    previous = text;
    text = text.replace(/<\/?[a-z!][^<>]*>/gi, '');
  }
  // eslint-disable-next-line no-control-regex -- memang membuang karakter kontrol.
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return text.replace(/\r\n?/g, '\n').trim();
}

function validationError(field, message) {
  return new ApiError(400, 'VALIDATION_ERROR', 'Data yang dikirim belum valid.', [
    { field, message },
  ]);
}

function toMessage(row) {
  return {
    id: row.id,
    booking_id: row.booking_id,
    sender_id: row.sender_id,
    sender_role: row.sender_role,
    message_text: row.message_text,
    is_read: Boolean(row.is_read),
    read_at: row.read_at ?? null,
    created_at: row.created_at,
  };
}

/** Penghubung ke Socket.io. Sebelum attach(io) (mis. saat tes REST), emit tidak melakukan apa-apa. */
function createChatHub() {
  let io = null;
  return {
    attach(server) {
      io = server;
    },
    toBooking(bookingId, event, payload) {
      io?.to(room(bookingId)).emit(event, payload);
    },
    toUser(userId, event, payload) {
      io?.to(userRoom(userId)).emit(event, payload);
    },
  };
}

function createChatService({ chat, users, hub, now = () => new Date() }) {
  /**
   * Booking beserta peran pemanggil di booking itu ('customer' | 'provider' | 'admin').
   * Booking tidak ada → 404; ada tapi bukan partisipan → 403 (sesuai issue #32).
   */
  async function access(bookingId, auth) {
    const booking = idSchema.safeParse(bookingId).success
      ? await chat.findBooking(bookingId)
      : null;
    if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.');
    const viewer =
      (auth.role === 'admin' && 'admin') ||
      (auth.role === 'customer' && booking.customer_id === auth.userId && 'customer') ||
      (auth.role === 'provider' && booking.provider_user_id === auth.userId && 'provider');
    if (!viewer) {
      throw new ApiError(403, 'FORBIDDEN', 'Anda bukan peserta percakapan pesanan ini.');
    }
    return { booking, viewer };
  }

  /** Aksi tulis: hanya customer/provider booking ini dengan akun aktif. */
  async function writer(bookingId, auth) {
    const result = await access(bookingId, auth);
    if (result.viewer === 'admin') {
      throw new ApiError(403, 'FORBIDDEN', 'Admin hanya dapat membaca percakapan.');
    }
    const user = await users.findById(auth.userId);
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Silakan masuk terlebih dahulu.');
    if (user.status === 'suspended') {
      throw new ApiError(
        403,
        'ACCOUNT_SUSPENDED',
        'Akun Anda sedang dinonaktifkan. Anda hanya dapat melihat data.',
      );
    }
    return result;
  }

  const canSend = (booking, viewer) => viewer !== 'admin' && OPEN_STATUSES.includes(booking.status);

  async function history(bookingId, auth, { limit = 50, beforeId } = {}) {
    const { booking, viewer } = await access(bookingId, auth);
    let before = null;
    if (beforeId) {
      before = idSchema.safeParse(beforeId).success
        ? await chat.findMessage(booking.id, beforeId)
        : null;
      if (!before) throw validationError('before_id', 'Pesan acuan tidak ditemukan.');
    }
    const { items, hasMore } = await chat.listMessages(booking.id, { limit, before });
    return {
      booking: {
        id: booking.id,
        code: booking.code,
        status: booking.status,
        can_send: canSend(booking, viewer),
      },
      // Data aksesibilitas mitra, mis. "tunarungu" → pelanggan disarankan chat teks.
      provider_disability_type: booking.provider_disability_type ?? null,
      messages: items.map(toMessage),
      hasMore,
    };
  }

  async function send(bookingId, auth, rawText) {
    const text = sanitizeText(rawText);
    if (!text) throw validationError('message_text', 'Pesan tidak boleh kosong.');
    if ([...text].length > MAX_LENGTH) {
      throw validationError('message_text', `Pesan maksimal ${MAX_LENGTH} karakter.`);
    }
    const { booking, viewer } = await writer(bookingId, auth);
    if (!canSend(booking, viewer)) {
      throw new ApiError(
        400,
        'CHAT_READ_ONLY',
        'Pesanan sudah tidak aktif, percakapan hanya bisa dibaca.',
      );
    }
    const message = toMessage(
      await chat.createMessage({
        bookingId: booking.id,
        senderId: auth.userId,
        senderRole: viewer,
        text,
      }),
    );
    hub.toBooking(booking.id, 'new_message', message);
    // Untuk badge/daftar inbox di halaman lain yang tidak bergabung ke room booking.
    for (const userId of [booking.customer_id, booking.provider_user_id]) {
      hub.toUser(userId, 'inbox_updated', { booking_id: booking.id, message });
    }
    return message;
  }

  async function markRead(bookingId, auth) {
    const { booking, viewer } = await writer(bookingId, auth);
    const { count, readAt } = await chat.markRead(booking.id, auth.userId, now());
    const payload = {
      booking_id: booking.id,
      reader_id: auth.userId,
      reader_role: viewer,
      read_at: readAt,
      count,
    };
    if (count > 0) hub.toBooking(booking.id, 'messages_read', payload);
    return payload;
  }

  return { access, history, send, markRead, canSend, OPEN_STATUSES };
}

module.exports = {
  createChatService,
  createChatHub,
  sanitizeText,
  toMessage,
  room,
  userRoom,
  OPEN_STATUSES,
  MAX_LENGTH,
};
