const crypto = require('node:crypto');
const db = require('../config/db');

const { randomUUID } = crypto;

// Kolom booking beserta data layanan, provider, dan customer untuk serializer di route.
// Kontak dan alamat dibaca di sini, tetapi hanya dikirim ke lawan transaksi saat status
// mengizinkan (aturan buka-tutup di src/routes/bookings.js, BE-07).
const COLUMNS = `b.id, b.code, b.status, b.customer_id, b.provider_id, b.service_id,
  b.scheduled_date, b.start_time, b.service_mode, b.location_area, b.location_address,
  b.location_lat, b.location_lng, b.customer_note, b.pricing_type_snapshot,
  b.unit_price_snapshot, b.quantity, b.estimated_total, b.actual_quantity, b.final_total,
  b.cancelled_by, b.status_reason, b.created_at, b.updated_at,
  sv.title AS service_title,
  p.user_id AS provider_user_id, p.display_name AS provider_display_name,
  p.city AS provider_city, p.district AS provider_district,
  p.address_detail AS provider_address_detail, pu.phone AS provider_phone,
  cu.full_name AS customer_full_name, cu.phone AS customer_phone,
  EXISTS (SELECT 1 FROM booking_status_history h
          WHERE h.booking_id = b.id AND h.to_status = 'accepted') AS was_accepted`;

const FROM = `FROM bookings b
  JOIN services sv ON sv.id = b.service_id
  JOIN provider_profiles p ON p.id = b.provider_id
  JOIN users pu ON pu.id = p.user_id
  JOIN users cu ON cu.id = b.customer_id`;

/** Layanan yang boleh dipesan: aktif, kategori aktif, provider verified dengan akun aktif. */
async function findBookableService(serviceId) {
  const [rows] = await db.getPool().query(
    `SELECT sv.id, sv.provider_id, sv.pricing_type, sv.price_amount, sv.min_hours,
            sv.service_mode
     FROM services sv
     JOIN categories c ON c.id = sv.category_id
     JOIN provider_profiles p ON p.id = sv.provider_id
     JOIN users u ON u.id = p.user_id
     WHERE sv.id = ? AND sv.is_active = TRUE AND c.is_active = TRUE
       AND p.verification_status = 'verified' AND u.status = 'active'
     LIMIT 1`,
    [serviceId],
  );
  return rows[0] ?? null;
}

/** Slot jadwal provider di satu hari (0 = Minggu), jam berformat "HH:mm". */
async function listSlotsForDay(providerId, dayOfWeek) {
  const [rows] = await db.getPool().query(
    `SELECT start_time, end_time FROM provider_availability
       WHERE provider_id = ? AND day_of_week = ? ORDER BY start_time`,
    [providerId, dayOfWeek],
  );
  return rows.map((row) => ({
    start_time: String(row.start_time).slice(0, 5),
    end_time: String(row.end_time).slice(0, 5),
  }));
}

async function findProviderProfileId(userId) {
  const [rows] = await db
    .getPool()
    .query('SELECT id FROM provider_profiles WHERE user_id = ? LIMIT 1', [userId]);
  return rows[0]?.id ?? null;
}

// Kode booking yang mudah dibaca, mis. DJC-7K2M9QXA (tanpa huruf mirip 0/O, 1/I).
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function generateCode() {
  const bytes = crypto.randomBytes(8);
  return `DJC-${Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')}`;
}

function insertHistory(connection, { bookingId, from, to, changedBy, reason }) {
  return connection.query(
    `INSERT INTO booking_status_history (id, booking_id, from_status, to_status, changed_by, reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), bookingId, from, to, changedBy, reason],
  );
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

/** Membuat booking `requested` dan baris pertama riwayat status dalam satu transaksi. */
async function create(booking, { changedBy }) {
  const id = randomUUID();
  await inTransaction(async (connection) => {
    // Kode unik dibuat acak; bentrok (sangat jarang) dicoba ulang.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await connection.query(
          `INSERT INTO bookings
             (id, code, customer_id, provider_id, service_id, scheduled_date, start_time,
              service_mode, location_area, location_address, location_lat, location_lng,
              customer_note, pricing_type_snapshot, unit_price_snapshot, quantity, estimated_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            generateCode(),
            booking.customerId,
            booking.providerId,
            booking.serviceId,
            booking.scheduledDate,
            booking.startTime,
            booking.serviceMode,
            booking.locationArea,
            booking.locationAddress,
            booking.locationLat,
            booking.locationLng,
            booking.customerNote,
            booking.pricingType,
            booking.unitPrice,
            booking.quantity,
            booking.estimatedTotal,
          ],
        );
        break;
      } catch (error) {
        if (
          error.code !== 'ER_DUP_ENTRY' ||
          !/bookings_code_unique/.test(error.message) ||
          attempt >= 4
        ) {
          throw error;
        }
      }
    }
    await insertHistory(connection, {
      bookingId: id,
      from: null,
      to: 'requested',
      changedBy,
      reason: null,
    });
  });
  return findById(id);
}

async function findById(id) {
  const pool = db.getPool();
  const [rows] = await pool.query(`SELECT ${COLUMNS} ${FROM} WHERE b.id = ? LIMIT 1`, [id]);
  if (!rows[0]) return null;
  const [history] = await pool.query(
    `SELECT h.from_status, h.to_status, h.reason, h.created_at, u.role AS changed_by_role
     FROM booking_status_history h LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.booking_id = ? ORDER BY h.created_at, h.id`,
    [id],
  );
  return { ...rows[0], history };
}

/**
 * Daftar booking milik customer (`customerId`) atau provider (`providerId`), urut jadwal
 * terbaru. Mengembalikan { items, total }.
 */
async function list({ customerId, providerId, statuses, page, limit }) {
  const where = [];
  const params = [];
  if (customerId) {
    where.push('b.customer_id = ?');
    params.push(customerId);
  }
  if (providerId) {
    where.push('b.provider_id = ?');
    params.push(providerId);
  }
  if (statuses?.length) {
    where.push(`b.status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pool = db.getPool();
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${FROM} ${clause}`, params);
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} ${FROM} ${clause}
     ORDER BY b.scheduled_date DESC, b.start_time DESC, b.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );
  return { items: rows, total: Number(total) };
}

/**
 * Mengubah status booking dalam transaksi: mengunci baris, memanggil `decide(current)`
 * untuk validasi dan perubahan kolom, lalu menulis riwayat. `decide` boleh melempar error
 * (mis. INVALID_TRANSITION) supaya validasi memakai status terbaru, bukan yang dibaca
 * sebelum transaksi.
 */
async function transition(id, { to, changedBy, decide }) {
  await inTransaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT id, status, pricing_type_snapshot, unit_price_snapshot, estimated_total,
              scheduled_date
       FROM bookings WHERE id = ? FOR UPDATE`,
      [id],
    );
    const current = rows[0];
    const { changes = {}, reason = null } = decide(current);
    const sets = ['status = ?'];
    const values = [to];
    for (const [column, value] of Object.entries(changes)) {
      sets.push(`${column} = ?`);
      values.push(value);
    }
    await connection.query(`UPDATE bookings SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
    await insertHistory(connection, { bookingId: id, from: current.status, to, changedBy, reason });
  });
  return findById(id);
}

module.exports = {
  findBookableService,
  listSlotsForDay,
  findProviderProfileId,
  create,
  findById,
  list,
  transition,
};
