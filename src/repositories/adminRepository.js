const { randomUUID } = require('node:crypto');
const db = require('../config/db');
const { lockProvider, recomputeProviderRating } = require('./reviewRepository');

async function inTransaction(fn) {
  const connection = await db.getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Jejak audit append-only; selalu ditulis di transaksi yang sama dengan perubahannya. */
function logAdminAction(connection, { adminId, action, targetType, targetId, note = null }) {
  return connection.query(
    `INSERT INTO admin_actions (id, admin_id, action, target_type, target_id, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), adminId, action, targetType, targetId, note],
  );
}

/** Ringkasan metrik untuk dasbor admin (FR-ADM-01). */
async function dashboard() {
  const pool = db.getPool();
  const [users] = await pool.query(
    'SELECT role, status, COUNT(*) AS total FROM users GROUP BY role, status',
  );
  const [providers] = await pool.query(
    'SELECT verification_status, COUNT(*) AS total FROM provider_profiles GROUP BY verification_status',
  );
  const [bookings] = await pool.query(
    'SELECT status, COUNT(*) AS total FROM bookings GROUP BY status',
  );
  const [[reviews]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(is_hidden), 0) AS hidden,
            COALESCE(ROUND(AVG(CASE WHEN is_hidden = FALSE THEN rating END), 1), 0) AS average
     FROM reviews`,
  );
  return { users, providers, bookings, reviews };
}

/** COUNT + halaman data untuk daftar admin. `from` sudah berisi FROM/JOIN/WHERE. */
async function paginate({ columns, from, params, orderBy, page, limit }) {
  const pool = db.getPool();
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}`, params);
  const [rows] = await pool.query(
    `SELECT ${columns} ${from} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );
  return { items: rows, total: Number(total) };
}

function whereClause(conditions) {
  return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
}

/**
 * Daftar mitra untuk tabel verifikasi (FR-ADM-02): nomor alumni dan kontak akun ikut
 * dikirim karena admin perlu meninjaunya. Yang menunggu paling lama tampil lebih dulu.
 */
async function listProviders({ status, q, page, limit }) {
  const conditions = [];
  const params = [];
  if (status) {
    conditions.push('p.verification_status = ?');
    params.push(status);
  }
  if (q) {
    conditions.push('(p.display_name LIKE ? OR u.email LIKE ? OR p.alumni_reg_no LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  return paginate({
    columns: `p.id, p.user_id, p.display_name, p.alumni_reg_no, p.city, p.district,
              p.address_detail IS NOT NULL AND p.lat IS NOT NULL AS has_location,
              p.verification_status, p.verified_at, p.rating_avg, p.rating_count, p.created_at,
              u.full_name, u.email, u.phone, u.status AS user_status`,
    from: `FROM provider_profiles p JOIN users u ON u.id = p.user_id ${whereClause(conditions)}`,
    params,
    orderBy: 'p.created_at ASC, p.id ASC',
    page,
    limit,
  });
}

/** Daftar ulasan untuk moderasi (FR-ADM-04), termasuk yang disembunyikan. Terbaru dulu. */
async function listReviews({ hidden, providerId, page, limit }) {
  const conditions = [];
  const params = [];
  if (hidden !== undefined) {
    conditions.push('r.is_hidden = ?');
    params.push(hidden);
  }
  if (providerId) {
    conditions.push('r.provider_id = ?');
    params.push(providerId);
  }
  return paginate({
    columns: `r.id, r.booking_id, r.rating, r.comment, r.is_hidden, r.hidden_reason, r.created_at,
              r.provider_id, p.display_name AS provider_name,
              r.customer_id, c.full_name AS customer_name`,
    from: `FROM reviews r
           JOIN provider_profiles p ON p.id = r.provider_id
           JOIN users c ON c.id = r.customer_id
           ${whereClause(conditions)}`,
    params,
    orderBy: 'r.created_at DESC, r.id DESC',
    page,
    limit,
  });
}

/** Daftar akun untuk penangguhan (FR-ADM-05). password_hash tidak pernah dipilih. */
async function listUsers({ role, status, q, page, limit }) {
  const conditions = [];
  const params = [];
  if (role) {
    conditions.push('role = ?');
    params.push(role);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (q) {
    conditions.push('(full_name LIKE ? OR email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  return paginate({
    columns: 'id, role, full_name, email, phone, status, created_at',
    from: `FROM users ${whereClause(conditions)}`,
    params,
    orderBy: 'created_at DESC, id DESC',
    page,
    limit,
  });
}

async function findUser(id) {
  const [rows] = await db
    .getPool()
    .query('SELECT id, role, full_name, email, status FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] ?? null;
}

async function findProviderProfile(id) {
  const [rows] = await db.getPool().query(
    `SELECT p.id, p.user_id, p.display_name, p.verification_status, p.address_detail, p.lat
     FROM provider_profiles p WHERE p.id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Admin membuat akun mitra (keputusan API-04): user `provider` + provider_profiles
 * `pending`, dicatat `create_provider`. Melempar ER_DUP_ENTRY jika email sudah dipakai.
 */
async function createProvider({
  adminId,
  fullName,
  email,
  phone,
  passwordHash,
  alumniRegNo,
  city,
}) {
  const userId = randomUUID();
  const profileId = randomUUID();
  await inTransaction(async (connection) => {
    await connection.query(
      `INSERT INTO users (id, role, full_name, email, phone, password_hash)
       VALUES (?, 'provider', ?, ?, ?, ?)`,
      [userId, fullName, email, phone, passwordHash],
    );
    await connection.query(
      `INSERT INTO provider_profiles (id, user_id, display_name, alumni_reg_no, city)
       VALUES (?, ?, ?, ?, ?)`,
      [profileId, userId, fullName, alumniRegNo, city],
    );
    await logAdminAction(connection, {
      adminId,
      action: 'create_provider',
      targetType: 'user',
      targetId: userId,
      note: `Membuat akun mitra ${email} (nomor alumni ${alumniRegNo}).`,
    });
  });
  return { userId, profileId };
}

/**
 * Verifikasi mitra: `verified` mengisi verified_by/verified_at; `rejected` wajib catatan.
 * CHECK provider_profiles_verified_complete_check tetap menolak verifikasi tanpa lokasi.
 */
async function setVerification({ adminId, profileId, status, note }) {
  await inTransaction(async (connection) => {
    await connection.query(
      `UPDATE provider_profiles
       SET verification_status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP(6)
       WHERE id = ?`,
      [status, adminId, profileId],
    );
    await logAdminAction(connection, {
      adminId,
      action: status === 'verified' ? 'verify_provider' : 'reject_provider',
      targetType: 'provider_profile',
      targetId: profileId,
      note,
    });
  });
  const [rows] = await db.getPool().query(
    `SELECT id, display_name, verification_status, verified_by, verified_at
     FROM provider_profiles WHERE id = ?`,
    [profileId],
  );
  return rows[0];
}

async function findReview(id) {
  const [rows] = await db
    .getPool()
    .query(
      'SELECT id, booking_id, provider_id, rating, comment, is_hidden FROM reviews WHERE id = ? LIMIT 1',
      [id],
    );
  return rows[0] ? { ...rows[0], is_hidden: Boolean(rows[0].is_hidden) } : null;
}

/** Menyembunyikan/menampilkan ulasan lalu menghitung ulang rating provider (FR-ADM-04). */
async function setReviewHidden({ adminId, review, hidden, reason }) {
  await inTransaction(async (connection) => {
    await lockProvider(connection, review.provider_id);
    await connection.query(
      'UPDATE reviews SET is_hidden = ?, hidden_by = ?, hidden_reason = ? WHERE id = ?',
      [hidden, hidden ? adminId : null, hidden ? reason : null, review.id],
    );
    await recomputeProviderRating(connection, review.provider_id);
    await logAdminAction(connection, {
      adminId,
      action: hidden ? 'hide_review' : 'unhide_review',
      targetType: 'review',
      targetId: review.id,
      note: reason ?? null,
    });
  });
  return findReview(review.id);
}

/**
 * Menangguhkan atau mengaktifkan kembali akun (FR-ADM-05). Saat ditangguhkan, booking
 * `requested`/`accepted` milik akun itu (sebagai customer atau provider) dibatalkan
 * berantai dengan `cancelled_by = admin` dan riwayat status. Mengembalikan jumlah booking
 * yang dibatalkan.
 */
async function setUserStatus({ adminId, user, status, reason }) {
  return inTransaction(async (connection) => {
    await connection.query('UPDATE users SET status = ? WHERE id = ?', [status, user.id]);

    let cancelled = 0;
    if (status === 'suspended') {
      const bookingReason = `Akun ${user.role === 'provider' ? 'penyedia jasa' : 'pemesan'} dinonaktifkan oleh admin.`;
      const [rows] = await connection.query(
        `SELECT b.id, b.status FROM bookings b
         LEFT JOIN provider_profiles p ON p.id = b.provider_id
         WHERE b.status IN ('requested', 'accepted') AND (b.customer_id = ? OR p.user_id = ?)
         FOR UPDATE`,
        [user.id, user.id],
      );
      for (const row of rows) {
        await connection.query(
          `UPDATE bookings SET status = 'cancelled', cancelled_by = 'admin', status_reason = ?
           WHERE id = ?`,
          [bookingReason, row.id],
        );
        await connection.query(
          `INSERT INTO booking_status_history (id, booking_id, from_status, to_status, changed_by, reason)
           VALUES (?, ?, ?, 'cancelled', ?, ?)`,
          [randomUUID(), row.id, row.status, adminId, bookingReason],
        );
      }
      cancelled = rows.length;
    }

    await logAdminAction(connection, {
      adminId,
      action: status === 'suspended' ? 'suspend_user' : 'activate_user',
      targetType: 'user',
      targetId: user.id,
      note: reason ?? null,
    });
    return cancelled;
  });
}

module.exports = {
  dashboard,
  listProviders,
  listReviews,
  listUsers,
  findUser,
  findProviderProfile,
  createProvider,
  setVerification,
  findReview,
  setReviewHidden,
  setUserStatus,
};
