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
 * Membuat user. Untuk provider, profil `pending` dibuat dalam transaksi yang sama.
 * Melempar error mysql2 ER_DUP_ENTRY jika email sudah dipakai.
 */
async function createUser({ role, fullName, email, phone, passwordHash, provider }) {
  const connection = await db.getPool().getConnection();
  const user = { id: randomUUID(), role, full_name: fullName, email, phone, status: 'active' };
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO users (id, role, full_name, email, phone, password_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user.id, role, fullName, email, phone, passwordHash],
    );
    if (role === 'provider') {
      await connection.query(
        `INSERT INTO provider_profiles (id, user_id, display_name, alumni_reg_no, city)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), user.id, fullName, provider.alumniRegNo, provider.city],
      );
    }
    await connection.commit();
    return user;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updatePassword(id, passwordHash) {
  await db.getPool().query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
}

module.exports = { findByEmail, findById, findProviderProfileByUserId, createUser, updatePassword };
