const { randomUUID } = require('node:crypto');
const db = require('../config/db');

// Tujuan pembayaran milik penyedia jasa: rekening bank, e-wallet, atau QRIS.
const COLUMNS = `id, provider_id, type, provider_name, account_number, account_holder,
  qris_image_url, created_at, updated_at`;

function toAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    provider_name: row.provider_name,
    account_number: row.account_number,
    account_holder: row.account_holder,
    qris_image_url: row.qris_image_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Semua tujuan pembayaran milik penyedia `providerId` (id provider_profiles). */
async function listByProvider(providerId) {
  const [rows] = await db.getPool().query(
    `SELECT ${COLUMNS} FROM provider_payment_accounts
       WHERE provider_id = ? ORDER BY FIELD(type, 'qris', 'bank', 'ewallet'), created_at, id`,
    [providerId],
  );
  return rows.map(toAccount);
}

async function create(providerId, data) {
  const id = randomUUID();
  await db.getPool().query(
    `INSERT INTO provider_payment_accounts
       (id, provider_id, type, provider_name, account_number, account_holder, qris_image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      providerId,
      data.type,
      data.provider_name,
      data.account_number ?? null,
      data.account_holder ?? null,
      data.qris_image_url ?? null,
    ],
  );
  const [rows] = await db
    .getPool()
    .query(`SELECT ${COLUMNS} FROM provider_payment_accounts WHERE id = ?`, [id]);
  return toAccount(rows[0]);
}

/** Satu tujuan pembayaran milik penyedia ini saja, atau null. */
async function findOwn(providerId, id) {
  const [rows] = await db
    .getPool()
    .query(`SELECT ${COLUMNS} FROM provider_payment_accounts WHERE id = ? AND provider_id = ?`, [
      id,
      providerId,
    ]);
  return toAccount(rows[0]);
}

async function remove(providerId, id) {
  const [result] = await db
    .getPool()
    .query('DELETE FROM provider_payment_accounts WHERE id = ? AND provider_id = ?', [
      id,
      providerId,
    ]);
  return result.affectedRows > 0;
}

module.exports = { listByProvider, create, findOwn, remove };
