const { randomUUID } = require('node:crypto');
const db = require('../config/db');
const { fuzzCoordinate } = require('../utils/location');

// mysql2 mengembalikan DECIMAL sebagai string dan TIME sebagai "HH:MM:SS".
const toNumber = (value) => (value === null || value === undefined ? null : Number(value));
const toHourMinute = (value) => (value ? String(value).slice(0, 5) : null);

function parsePrefs(value) {
  if (value === null || value === undefined) return [];
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function listSlots(providerId) {
  const [rows] = await db.getPool().query(
    `SELECT day_of_week, start_time, end_time FROM provider_availability
       WHERE provider_id = ? ORDER BY day_of_week, start_time`,
    [providerId],
  );
  return rows.map((row) => ({
    day_of_week: row.day_of_week,
    start_time: toHourMinute(row.start_time),
    end_time: toHourMinute(row.end_time),
  }));
}

/**
 * Profil publik (P3): hanya provider `verified` dengan akun `active`. Tidak pernah memuat
 * `lat`, `lng`, `address_detail`, `alumni_reg_no`, atau `disability_type`.
 */
async function findPublicById(id) {
  const pool = db.getPool();
  const [rows] = await pool.query(
    `SELECT p.id, p.display_name, p.photo_url, p.photo_alt, p.bio, p.communication_prefs,
            p.city, p.district, p.public_lat, p.public_lng, p.service_radius_km,
            p.rating_avg, p.rating_count
     FROM provider_profiles p JOIN users u ON u.id = p.user_id
     WHERE p.id = ? AND p.verification_status = 'verified' AND u.status = 'active'
     LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;

  const [skills] = await pool.query(
    `SELECT s.name, s.slug FROM provider_skills ps JOIN skills s ON s.id = ps.skill_id
     WHERE ps.provider_id = ? ORDER BY s.name`,
    [id],
  );
  const [services] = await pool.query(
    `SELECT sv.id, sv.title, c.name AS category_name, c.slug AS category_slug,
            sv.pricing_type, sv.price_amount, sv.min_hours, sv.duration_estimate_min,
            sv.service_mode
     FROM services sv JOIN categories c ON c.id = sv.category_id
     WHERE sv.provider_id = ? AND sv.is_active = TRUE AND c.is_active = TRUE
     ORDER BY sv.created_at`,
    [id],
  );
  const [portfolio] = await pool.query(
    `SELECT id, title, item_type, image_url, image_alt FROM portfolio_items
     WHERE provider_id = ? ORDER BY sort_order, created_at`,
    [id],
  );

  return {
    id: row.id,
    display_name: row.display_name,
    photo_url: row.photo_url,
    photo_alt: row.photo_alt,
    bio: row.bio,
    communication_prefs: parsePrefs(row.communication_prefs),
    city: row.city,
    district: row.district,
    public_lat: toNumber(row.public_lat),
    public_lng: toNumber(row.public_lng),
    service_radius_km: row.service_radius_km,
    rating_avg: toNumber(row.rating_avg),
    rating_count: row.rating_count,
    skills,
    services: services.map((service) => ({
      id: service.id,
      title: service.title,
      category: { name: service.category_name, slug: service.category_slug },
      pricing_type: service.pricing_type,
      price_amount: Number(service.price_amount),
      min_hours: service.min_hours,
      duration_estimate_min: service.duration_estimate_min,
      service_mode: service.service_mode,
    })),
    availability: await listSlots(id),
    portfolio,
  };
}

/** Profil lengkap milik provider sendiri, termasuk data privat (alamat, koordinat asli). */
async function findOwnByUserId(userId) {
  const [rows] = await db.getPool().query(
    `SELECT p.id, p.display_name, p.photo_url, p.photo_alt, p.bio, p.communication_prefs,
            p.disability_type, p.alumni_reg_no, p.address_detail, p.city, p.district,
            p.lat, p.lng, p.public_lat, p.public_lng, p.service_radius_km,
            p.verification_status, p.rating_avg, p.rating_count, u.phone
     FROM provider_profiles p JOIN users u ON u.id = p.user_id
     WHERE p.user_id = ? LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    communication_prefs: parsePrefs(row.communication_prefs),
    lat: toNumber(row.lat),
    lng: toNumber(row.lng),
    public_lat: toNumber(row.public_lat),
    public_lng: toNumber(row.public_lng),
    rating_avg: toNumber(row.rating_avg),
  };
}

const PROFILE_COLUMNS = [
  'display_name',
  'bio',
  'communication_prefs',
  'disability_type',
  'address_detail',
  'city',
  'district',
  'service_radius_km',
];

/**
 * Mengubah profil provider. Jika `lat`/`lng` berubah, `public_lat`/`public_lng` dihitung
 * ulang di sini (pembulatan 2 desimal) supaya koordinat publik tidak pernah tertinggal.
 * `phone` disimpan di tabel users.
 */
async function updateProfile({ profileId, userId }, changes) {
  const sets = [];
  const values = [];
  for (const column of PROFILE_COLUMNS) {
    if (changes[column] === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(
      column === 'communication_prefs' && changes[column] !== null
        ? JSON.stringify(changes[column])
        : changes[column],
    );
  }
  if (changes.lat !== undefined) {
    sets.push('lat = ?', 'lng = ?', 'public_lat = ?', 'public_lng = ?');
    values.push(changes.lat, changes.lng, fuzzCoordinate(changes.lat), fuzzCoordinate(changes.lng));
  }

  const connection = await db.getPool().getConnection();
  try {
    await connection.beginTransaction();
    if (sets.length) {
      await connection.query(`UPDATE provider_profiles SET ${sets.join(', ')} WHERE id = ?`, [
        ...values,
        profileId,
      ]);
    }
    if (changes.phone !== undefined) {
      await connection.query('UPDATE users SET phone = ? WHERE id = ?', [changes.phone, userId]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return findOwnByUserId(userId);
}

async function listAvailability(profileId) {
  return listSlots(profileId);
}

/** Mengganti seluruh jadwal mingguan provider dalam satu transaksi. */
async function replaceAvailability(profileId, slots) {
  const connection = await db.getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM provider_availability WHERE provider_id = ?', [profileId]);
    for (const slot of slots) {
      await connection.query(
        `INSERT INTO provider_availability (id, provider_id, day_of_week, start_time, end_time)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), profileId, slot.day_of_week, slot.start_time, slot.end_time],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return listSlots(profileId);
}

async function updatePhoto(profileId, { url, alt }) {
  await db
    .getPool()
    .query('UPDATE provider_profiles SET photo_url = ?, photo_alt = ? WHERE id = ?', [
      url,
      alt,
      profileId,
    ]);
}

const PORTFOLIO_COLUMNS = 'id, title, description, item_type, image_url, image_alt, sort_order';

async function listPortfolio(profileId) {
  const [rows] = await db.getPool().query(
    `SELECT ${PORTFOLIO_COLUMNS} FROM portfolio_items
       WHERE provider_id = ? ORDER BY sort_order, created_at`,
    [profileId],
  );
  return rows;
}

/** Menambah karya portofolio di urutan paling akhir. */
async function createPortfolioItem(
  profileId,
  { title, description, itemType, imageUrl, imageAlt },
) {
  const pool = db.getPool();
  const id = randomUUID();
  const [[{ next }]] = await pool.query(
    'SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM portfolio_items WHERE provider_id = ?',
    [profileId],
  );
  await pool.query(
    `INSERT INTO portfolio_items
       (id, provider_id, title, description, item_type, image_url, image_alt, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, profileId, title, description, itemType, imageUrl, imageAlt, next],
  );
  const [rows] = await pool.query(`SELECT ${PORTFOLIO_COLUMNS} FROM portfolio_items WHERE id = ?`, [
    id,
  ]);
  return rows[0];
}

/** Menghapus karya milik provider ini saja. Mengembalikan true jika ada yang terhapus. */
async function deletePortfolioItem(profileId, itemId) {
  const [result] = await db
    .getPool()
    .query('DELETE FROM portfolio_items WHERE id = ? AND provider_id = ?', [itemId, profileId]);
  return result.affectedRows > 0;
}

module.exports = {
  findPublicById,
  findOwnByUserId,
  updateProfile,
  listAvailability,
  replaceAvailability,
  updatePhoto,
  listPortfolio,
  createPortfolioItem,
  deletePortfolioItem,
};
