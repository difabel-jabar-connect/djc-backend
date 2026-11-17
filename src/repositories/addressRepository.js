const { randomUUID } = require('node:crypto');
const db = require('../config/db');

// Alamat tersimpan pelanggan (tabel user_addresses). Paling banyak satu alamat utama per
// pengguna; alamat pertama otomatis jadi utama, dan bila alamat utama dihapus, alamat
// terbaru berikutnya menggantikannya. Semua perubahan "utama" berjalan dalam satu transaksi.

const COLUMNS =
  'id, user_id, label, address_text, detail, area, lat, lng, is_primary, created_at, updated_at';
const ORDER = 'ORDER BY is_primary DESC, created_at DESC, id';

async function listByUser(userId, connection = db.getPool()) {
  const [rows] = await connection.query(
    `SELECT ${COLUMNS} FROM user_addresses WHERE user_id = ? ${ORDER}`,
    [userId],
  );
  return rows;
}

async function findOwn(userId, id, connection = db.getPool()) {
  const [rows] = await connection.query(
    `SELECT ${COLUMNS} FROM user_addresses WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId],
  );
  return rows[0] ?? null;
}

async function countByUser(userId) {
  const [rows] = await db
    .getPool()
    .query('SELECT COUNT(*) AS total FROM user_addresses WHERE user_id = ?', [userId]);
  return Number(rows[0].total);
}

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

/** Kunci baris alamat milik user supaya dua permintaan bersamaan tidak membuat dua utama. */
async function lockUserRows(connection, userId) {
  const [rows] = await connection.query(
    'SELECT id, is_primary FROM user_addresses WHERE user_id = ? FOR UPDATE',
    [userId],
  );
  return rows;
}

async function clearPrimary(connection, userId) {
  await connection.query(
    'UPDATE user_addresses SET is_primary = FALSE WHERE user_id = ? AND is_primary = TRUE',
    [userId],
  );
}

/** Menambah alamat. `isPrimary` diabaikan (selalu TRUE) untuk alamat pertama. */
async function create(userId, address) {
  return inTransaction(async (connection) => {
    const existing = await lockUserRows(connection, userId);
    const isPrimary = address.isPrimary || existing.length === 0;
    if (isPrimary) await clearPrimary(connection, userId);
    const id = randomUUID();
    await connection.query(
      `INSERT INTO user_addresses
         (id, user_id, label, address_text, detail, area, lat, lng, is_primary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        address.label,
        address.addressText,
        address.detail ?? null,
        address.area ?? null,
        address.lat,
        address.lng,
        isPrimary,
      ],
    );
    return findOwn(userId, id, connection);
  });
}

const UPDATE_COLUMNS = {
  label: 'label',
  addressText: 'address_text',
  detail: 'detail',
  area: 'area',
  lat: 'lat',
  lng: 'lng',
};

/**
 * Mengubah alamat milik user. `isPrimary: true` menjadikannya utama; alamat utama tidak bisa
 * dilepas begitu saja (`false` diabaikan) supaya selalu ada satu alamat utama.
 * Mengembalikan null jika alamat tidak ditemukan atau bukan milik user.
 */
async function update(userId, id, changes) {
  return inTransaction(async (connection) => {
    await lockUserRows(connection, userId);
    if (!(await findOwn(userId, id, connection))) return null;

    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(UPDATE_COLUMNS)) {
      if (changes[key] === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(changes[key]);
    }
    if (changes.isPrimary === true) {
      await clearPrimary(connection, userId);
      sets.push('is_primary = TRUE');
    }
    if (sets.length) {
      await connection.query(
        `UPDATE user_addresses SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
        [...values, id, userId],
      );
    }
    return findOwn(userId, id, connection);
  });
}

/** Menghapus alamat. Jika yang dihapus alamat utama, alamat terbaru menjadi utama. */
async function remove(userId, id) {
  return inTransaction(async (connection) => {
    await lockUserRows(connection, userId);
    const address = await findOwn(userId, id, connection);
    if (!address) return false;
    await connection.query('DELETE FROM user_addresses WHERE id = ? AND user_id = ?', [id, userId]);
    if (address.is_primary) {
      await connection.query(
        `UPDATE user_addresses SET is_primary = TRUE
         WHERE user_id = ? ORDER BY created_at DESC, id LIMIT 1`,
        [userId],
      );
    }
    return true;
  });
}

module.exports = { listByUser, findOwn, countByUser, create, update, remove };
