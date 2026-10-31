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

module.exports = { createForBooking, lockProvider, recomputeProviderRating };
