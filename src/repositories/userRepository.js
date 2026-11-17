const { randomUUID } = require('node:crypto');
const db = require('../config/db');

const USER_COLUMNS =
  'id, role, full_name, email, phone, avatar_url, password_hash, has_password, status, email_verified_at';

async function findByEmail(email) {
  const [rows] = await db
    .getPool()
    .query(`SELECT ${USER_COLUMNS} FROM users WHERE email = ? LIMIT 1`, [email]);
  return rows[0] ?? null;
}

async function findById(id) {
  const [rows] = await db
    .getPool()
    .query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

async function findProviderProfileByUserId(userId) {
  const [rows] = await db
    .getPool()
    .query('SELECT id, verification_status FROM provider_profiles WHERE user_id = ? LIMIT 1', [
      userId,
    ]);
  return rows[0] ?? null;
}

/**
 * Membuat akun customer (pendaftaran mandiri). Akun mitra dibuat admin lewat endpoint
 * terpisah. `emailVerified` diisi true jika email sudah terbukti milik pendaftar (daftar
 * lewat Google). Melempar error mysql2 ER_DUP_ENTRY jika email sudah dipakai.
 */
async function createUser({
  fullName,
  email,
  phone,
  passwordHash,
  emailVerified = false,
  hasPassword = true,
}) {
  const user = {
    id: randomUUID(),
    role: 'customer',
    full_name: fullName,
    email,
    phone,
    avatar_url: null,
    has_password: hasPassword,
    status: 'active',
    email_verified_at: emailVerified ? new Date() : null,
  };
  await db.getPool().query(
    `INSERT INTO users (id, role, full_name, email, phone, password_hash, has_password, email_verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, user.role, fullName, email, phone, passwordHash, hasPassword, user.email_verified_at],
  );
  return user;
}

/**
 * Menyimpan kata sandi baru (reset lewat email atau ganti dari Akun Saya). Akun Google yang
 * membuat kata sandi lewat reset menjadi has_password. Reset lewat tautan email membuktikan
 * kepemilikan email, jadi email ikut terverifikasi; ganti kata sandi tidak mengubahnya.
 */
async function updatePassword(id, passwordHash, { verifyEmail = true } = {}) {
  await db
    .getPool()
    .query(
      `UPDATE users SET password_hash = ?, has_password = TRUE${
        verifyEmail ? ', email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP(6))' : ''
      } WHERE id = ?`,
      [passwordHash, id],
    );
}

const ACCOUNT_COLUMNS = { name: 'full_name', phone: 'phone' };

/** Mengubah data diri (nama, nomor telepon) dari Akun Saya. Mengembalikan user terbaru. */
async function updateAccount(id, changes) {
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(ACCOUNT_COLUMNS)) {
    if (changes[key] === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(changes[key]);
  }
  if (sets.length) {
    await db.getPool().query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
  }
  return findById(id);
}

/**
 * Mengganti email akun ber-kata sandi. Email baru belum terbukti milik pemiliknya, jadi
 * email_verified_at dikosongkan (login Google untuk email itu menunggu reset kata sandi).
 * Melempar error mysql2 ER_DUP_ENTRY jika email sudah dipakai akun lain.
 */
async function updateEmail(id, email) {
  await db
    .getPool()
    .query('UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?', [email, id]);
  return findById(id);
}

/** Foto profil (URL Cloudinary) atau null untuk menghapusnya. */
async function updateAvatar(id, url) {
  await db.getPool().query('UPDATE users SET avatar_url = ? WHERE id = ?', [url, id]);
}

module.exports = {
  findByEmail,
  findById,
  findProviderProfileByUserId,
  createUser,
  updatePassword,
  updateAccount,
  updateEmail,
  updateAvatar,
};
