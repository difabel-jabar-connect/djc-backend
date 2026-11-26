const { randomUUID } = require('node:crypto');
const db = require('../config/db');

/**
 * Mengunci baris provider di awal transaksi yang mengubah review-nya. Tanpa ini, dua
 * review untuk provider yang sama bisa deadlock: INSERT memegang shared lock baris
 * provider (foreign key), lalu keduanya meminta exclusive lock saat rating di-update.
 */
async function lockProvider(connection, providerId) {
  await connection.query('SELECT id FROM provider_profiles WHERE id = ? FOR UPDATE', [providerId]);
}

/**
 * Menghitung ulang rating_avg dan rating_count provider dari review yang tidak
 * disembunyikan. Dipanggil di dalam transaksi yang sama dengan perubahan review
 * (dipakai juga untuk moderasi ulasan di BE-09).
 */
async function recomputeProviderRating(connection, providerId) {
  await connection.query(
    `UPDATE provider_profiles p
     JOIN (
       SELECT COUNT(*) AS total, COALESCE(ROUND(AVG(rating), 1), 0) AS average
       FROM reviews WHERE provider_id = ? AND is_hidden = FALSE
     ) r
     SET p.rating_count = r.total, p.rating_avg = r.average
     WHERE p.id = ?`,
    [providerId, providerId],
  );
}

/**
 * Menyimpan review untuk satu booking lalu menghitung ulang rating provider dalam satu
 * transaksi. Melempar error mysql2 ER_DUP_ENTRY jika booking sudah punya review.
 */
async function createForBooking({ bookingId, customerId, providerId, rating, comment }) {
  const connection = await db.getPool().getConnection();
  const id = randomUUID();
  try {
    await connection.beginTransaction();
    await lockProvider(connection, providerId);
    await connection.query(
      `INSERT INTO reviews (id, booking_id, customer_id, provider_id, rating, comment)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, bookingId, customerId, providerId, rating, comment],
    );
    await recomputeProviderRating(connection, providerId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const [rows] = await db
    .getPool()
    .query(
      'SELECT id, booking_id, rating, comment, is_hidden, created_at FROM reviews WHERE id = ?',
      [id],
    );
  return { ...rows[0], is_hidden: Boolean(rows[0].is_hidden) };
}

/**
 * Daftar ulasan milik satu provider, terbaru dulu, beserta nama pengulas dan judul layanan.
 * `includeHidden: false` untuk profil publik (ulasan yang disembunyikan admin tidak pernah
 * ikut); `true` untuk dasbor provider sendiri. Mengembalikan { items, total }.
 */
async function listByProvider(providerId, { includeHidden = false, page = 1, limit = 10 } = {}) {
  const pool = db.getPool();
  const where = `r.provider_id = ?${includeHidden ? '' : ' AND r.is_hidden = FALSE'}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM reviews r WHERE ${where}`, [
    providerId,
  ]);
  const [rows] = await pool.query(
    `SELECT r.id, r.rating, r.comment, r.is_hidden, r.hidden_reason, r.created_at,
            c.full_name AS customer_name, sv.title AS service_title, b.code AS booking_code
     FROM reviews r
     JOIN users c ON c.id = r.customer_id
     JOIN bookings b ON b.id = r.booking_id
     JOIN services sv ON sv.id = b.service_id
     WHERE ${where}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ? OFFSET ?`,
    [providerId, limit, (page - 1) * limit],
  );
  return { items: rows, total: Number(total) };
}

/** true jika provider tampil publik (verified dan akunnya aktif). */
async function isPublicProvider(providerId) {
  const [rows] = await db.getPool().query(
    `SELECT 1 FROM provider_profiles p JOIN users u ON u.id = p.user_id
     WHERE p.id = ? AND p.verification_status = 'verified' AND u.status = 'active' LIMIT 1`,
    [providerId],
  );
  return rows.length > 0;
}

module.exports = {
  createForBooking,
  listByProvider,
  isPublicProvider,
  lockProvider,
  recomputeProviderRating,
};
