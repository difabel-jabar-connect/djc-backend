const { randomUUID } = require('node:crypto');
const db = require('../config/db');

const USER_COLUMNS = 'id, role, full_name, email, phone, password_hash, status';

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
 * terpisah. Melempar error mysql2 ER_DUP_ENTRY jika email sudah dipakai.
 */
async function createUser({ fullName, email, phone, passwordHash }) {
  const user = {
    id: randomUUID(),
    role: 'customer',
    full_name: fullName,
    email,
    phone,
    status: 'active',
  };
  await db.getPool().query(
    `INSERT INTO users (id, role, full_name, email, phone, password_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [user.id, user.role, fullName, email, phone, passwordHash],
  );
  return user;
}

async function updatePassword(id, passwordHash) {
  await db.getPool().query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
}

module.exports = { findByEmail, findById, findProviderProfileByUserId, createUser, updatePassword };
