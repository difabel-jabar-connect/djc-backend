const { randomUUID } = require('node:crypto');
const db = require('../config/db');

const COLUMNS = 'id, name, slug, icon, sort_order, is_active';

function toCategory(row) {
  return row ? { ...row, is_active: Boolean(row.is_active) } : null;
}

/** Kategori aktif untuk publik, urut sort_order lalu nama. */
async function listActive() {
  const [rows] = await db
    .getPool()
    .query(`SELECT ${COLUMNS} FROM categories WHERE is_active = TRUE ORDER BY sort_order, name`);
  return rows.map(toCategory);
}

async function findById(id) {
  const [rows] = await db
    .getPool()
    .query(`SELECT ${COLUMNS} FROM categories WHERE id = ? LIMIT 1`, [id]);
  return toCategory(rows[0]);
}

/**
 * Kategori lain yang memakai nama (tanpa beda huruf besar/kecil) atau slug yang sama.
 * `excludeId` dipakai saat update supaya kategori itu sendiri tidak dihitung.
 */
async function findConflict({ name, slug, excludeId = null }) {
  const [rows] = await db.getPool().query(
    `SELECT ${COLUMNS} FROM categories
     WHERE (LOWER(name) = LOWER(?) OR slug = ?) AND (? IS NULL OR id <> ?)
     LIMIT 1`,
    [name, slug, excludeId, excludeId],
  );
  return toCategory(rows[0]);
}

async function withAudit(fn) {
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

function logAdminAction(connection, { adminId, action, targetId, note }) {
  return connection.query(
    `INSERT INTO admin_actions (id, admin_id, action, target_type, target_id, note)
     VALUES (?, ?, ?, 'category', ?, ?)`,
    [randomUUID(), adminId, action, targetId, note],
  );
}

/** Membuat kategori dan mencatat `create_category` di admin_actions dalam satu transaksi. */
async function create({ name, slug, icon, sortOrder, isActive }, { adminId }) {
  const id = randomUUID();
  await withAudit(async (connection) => {
    await connection.query(
      `INSERT INTO categories (id, name, slug, icon, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name, slug, icon, sortOrder, isActive],
    );
    await logAdminAction(connection, {
      adminId,
      action: 'create_category',
      targetId: id,
      note: `Membuat kategori "${name}" (${slug}).`,
    });
  });
  return findById(id);
}

const UPDATABLE = {
  name: 'name',
  slug: 'slug',
  icon: 'icon',
  sortOrder: 'sort_order',
  isActive: 'is_active',
};

/** Mengubah kategori dan mencatat `update_category` di admin_actions dalam satu transaksi. */
async function update(id, changes, { adminId }) {
  const fields = Object.keys(changes).filter((key) => key in UPDATABLE);
  await withAudit(async (connection) => {
    await connection.query(
      `UPDATE categories SET ${fields.map((key) => `${UPDATABLE[key]} = ?`).join(', ')}
       WHERE id = ?`,
      [...fields.map((key) => changes[key]), id],
    );
    await logAdminAction(connection, {
      adminId,
      action: 'update_category',
      targetId: id,
      note: `Mengubah ${fields.map((key) => UPDATABLE[key]).join(', ')}.`,
    });
  });
  return findById(id);
}

module.exports = { listActive, findById, findConflict, create, update };
