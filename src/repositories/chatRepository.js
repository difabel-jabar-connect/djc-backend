const { randomUUID } = require('node:crypto');
const db = require('../config/db');

// Chat per booking (BE-10). Aturan siapa boleh membaca/mengirim ada di src/services/chat.js.

const MESSAGE_COLUMNS = `m.id, m.booking_id, m.sender_id, m.sender_role, m.message_text,
  m.is_read, m.read_at, m.created_at`;

/** Data booking yang dibutuhkan untuk otorisasi chat, atau null. */
async function findBooking(bookingId) {
  const [rows] = await db.getPool().query(
    `SELECT b.id, b.code, b.status, b.customer_id, b.provider_id,
            p.user_id AS provider_user_id, p.disability_type AS provider_disability_type
     FROM bookings b
     JOIN provider_profiles p ON p.id = b.provider_id
     WHERE b.id = ? LIMIT 1`,
    [bookingId],
  );
  return rows[0] ?? null;
}

async function findMessage(bookingId, messageId) {
  const [rows] = await db
    .getPool()
    .query(
      `SELECT ${MESSAGE_COLUMNS} FROM booking_messages m WHERE m.booking_id = ? AND m.id = ?`,
      [bookingId, messageId],
    );
  return rows[0] ?? null;
}

/**
 * Pesan satu booking, maksimal `limit`, urut lama → baru. Dengan `before` (pesan acuan),
 * hanya pesan yang lebih lama dari pesan itu. Mengembalikan { items, hasMore }.
 */
async function listMessages(bookingId, { limit, before }) {
  const params = [bookingId];
  let cursor = '';
  if (before) {
    cursor = 'AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))';
    params.push(before.created_at, before.created_at, before.id);
  }
  params.push(limit + 1);
  const [rows] = await db.getPool().query(
    `SELECT ${MESSAGE_COLUMNS} FROM booking_messages m
     WHERE m.booking_id = ? ${cursor}
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT ?`,
    params,
  );
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit).reverse(), hasMore };
}

async function createMessage({ bookingId, senderId, senderRole, text }) {
  const id = randomUUID();
  await db.getPool().query(
    `INSERT INTO booking_messages (id, booking_id, sender_id, sender_role, message_text)
     VALUES (?, ?, ?, ?, ?)`,
    [id, bookingId, senderId, senderRole, text],
  );
  return findMessage(bookingId, id);
}

/**
 * Menandai semua pesan yang diterima `readerId` di booking ini sebagai dibaca
 * (pesan dari lawan transaksi dan pesan sistem). Mengembalikan { count, readAt }.
 */
async function markRead(bookingId, readerId, readAt) {
  const [result] = await db.getPool().query(
    `UPDATE booking_messages SET is_read = TRUE, read_at = ?
     WHERE booking_id = ? AND is_read = FALSE AND (sender_id IS NULL OR sender_id <> ?)`,
    [readAt, bookingId, readerId],
  );
  return { count: result.affectedRows, readAt };
}

/**
 * Daftar percakapan user (customer atau provider): booking yang masih berjalan atau sudah
 * punya pesan, urut aktivitas terakhir. Mengembalikan { items, total }.
 */
async function inbox({ userId, role, activeStatuses, page, limit }) {
  const owner = role === 'customer' ? 'b.customer_id = ?' : 'p.user_id = ?';
  const statusList = activeStatuses.map(() => '?').join(', ');
  const where = `${owner} AND (b.status IN (${statusList})
    OR EXISTS (SELECT 1 FROM booking_messages x WHERE x.booking_id = b.id))`;
  const whereParams = [userId, ...activeStatuses];
  const from = `FROM bookings b JOIN provider_profiles p ON p.id = b.provider_id`;

  const pool = db.getPool();
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total ${from} WHERE ${where}`,
    whereParams,
  );
  const [rows] = await pool.query(
    `SELECT b.id AS booking_id, b.code, b.status, b.created_at AS booking_created_at,
            sv.title AS service_title,
            p.display_name AS provider_display_name, p.photo_url AS provider_photo_url,
            p.photo_alt AS provider_photo_alt, p.disability_type AS provider_disability_type,
            cu.full_name AS customer_full_name,
            EXISTS (SELECT 1 FROM booking_status_history h
                    WHERE h.booking_id = b.id AND h.to_status = 'accepted') AS was_accepted,
            lm.id AS last_id, lm.sender_id AS last_sender_id, lm.sender_role AS last_sender_role,
            lm.message_text AS last_text, lm.created_at AS last_created_at,
            (SELECT COUNT(*) FROM booking_messages u
             WHERE u.booking_id = b.id AND u.is_read = FALSE
               AND (u.sender_id IS NULL OR u.sender_id <> ?)) AS unread_count
     ${from}
     JOIN services sv ON sv.id = b.service_id
     JOIN users cu ON cu.id = b.customer_id
     LEFT JOIN booking_messages lm ON lm.id = (
       SELECT l.id FROM booking_messages l WHERE l.booking_id = b.id
       ORDER BY l.created_at DESC, l.id DESC LIMIT 1)
     WHERE ${where}
     ORDER BY COALESCE(lm.created_at, b.created_at) DESC, b.id DESC
     LIMIT ? OFFSET ?`,
    [userId, ...whereParams, limit, (page - 1) * limit],
  );
  return { items: rows, total: Number(total) };
}

module.exports = { findBooking, findMessage, listMessages, createMessage, markRead, inbox };
