const db = require('../config/db');

// Hanya layanan aktif dari kategori aktif, milik provider `verified` dengan akun `active`.
// Koordinat yang dipilih hanya public_lat/public_lng; lat, lng, dan alamat tidak pernah dibaca.
const VISIBLE = `sv.is_active = TRUE AND c.is_active = TRUE
  AND p.verification_status = 'verified' AND u.status = 'active'`;

const FROM = `FROM services sv
  JOIN categories c ON c.id = sv.category_id
  JOIN provider_profiles p ON p.id = sv.provider_id
  JOIN users u ON u.id = p.user_id`;

const COLUMNS = `sv.id, sv.title, sv.description, sv.pricing_type, sv.price_amount, sv.min_hours,
  sv.duration_estimate_min, sv.service_mode, sv.created_at,
  c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
  p.id AS provider_id, p.display_name, p.photo_url, p.photo_alt, p.city, p.district,
  p.public_lat, p.public_lng, p.rating_avg, p.rating_count`;

const SORTS = {
  newest: 'sv.created_at DESC, sv.id',
  price_asc: 'sv.price_amount ASC, sv.id',
  price_desc: 'sv.price_amount DESC, sv.id',
  rating_desc: 'p.rating_avg DESC, p.rating_count DESC, sv.id',
};

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

function toService(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    pricing_type: row.pricing_type,
    price_amount: Number(row.price_amount),
    min_hours: row.min_hours,
    duration_estimate_min: row.duration_estimate_min,
    service_mode: row.service_mode,
    created_at: row.created_at,
    category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
    provider: {
      id: row.provider_id,
      display_name: row.display_name,
      photo_url: row.photo_url,
      photo_alt: row.photo_alt,
      city: row.city,
      district: row.district,
      public_lat: toNumber(row.public_lat),
      public_lng: toNumber(row.public_lng),
      rating_avg: toNumber(row.rating_avg),
      rating_count: row.rating_count,
    },
  };
}

/** `%` dan `_` dari input pengguna dicari sebagai huruf biasa, bukan wildcard LIKE. */
const likePattern = (text) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

function buildFilters(filters) {
  const where = [VISIBLE];
  const params = [];

  if (filters.q) {
    // Setiap kata harus cocok dengan judul, deskripsi, nama provider, atau nama kategori.
    for (const word of filters.q.split(/\s+/).filter(Boolean)) {
      where.push(
        '(sv.title LIKE ? OR sv.description LIKE ? OR p.display_name LIKE ? OR c.name LIKE ?)',
      );
      const pattern = likePattern(word);
      params.push(pattern, pattern, pattern, pattern);
    }
  }
  if (filters.categoryId) {
    where.push('c.id = ?');
    params.push(filters.categoryId);
  }
  if (filters.category) {
    where.push('c.slug = ?');
    params.push(filters.category);
  }
  if (filters.city) {
    where.push('p.city = ?');
    params.push(filters.city);
  }
  if (filters.minPrice !== undefined) {
    where.push('sv.price_amount >= ?');
    params.push(filters.minPrice);
  }
  if (filters.maxPrice !== undefined) {
    where.push('sv.price_amount <= ?');
    params.push(filters.maxPrice);
  }
  if (filters.minRating !== undefined) {
    where.push('p.rating_avg >= ?');
    params.push(filters.minRating);
  }
  if (filters.dayOfWeek !== undefined) {
    where.push(
      'EXISTS (SELECT 1 FROM provider_availability pa WHERE pa.provider_id = p.id AND pa.day_of_week = ?)',
    );
    params.push(filters.dayOfWeek);
  }
  return { where: where.join(' AND '), params };
}

/** Pencarian layanan publik. Mengembalikan { items, total } untuk halaman yang diminta. */
async function search(filters) {
  const pool = db.getPool();
  const { where, params } = buildFilters(filters);

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${FROM} WHERE ${where}`, params);
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} ${FROM} WHERE ${where}
     ORDER BY ${SORTS[filters.sort] ?? SORTS.newest}
     LIMIT ? OFFSET ?`,
    [...params, filters.limit, (filters.page - 1) * filters.limit],
  );
  return { items: rows.map(toService), total: Number(total) };
}

/** Detail satu layanan publik beserta jadwal provider, atau null jika tidak tampil publik. */
async function findPublicById(id) {
  const pool = db.getPool();
  const [rows] = await pool.query(`SELECT ${COLUMNS} ${FROM} WHERE sv.id = ? AND ${VISIBLE}`, [id]);
  if (!rows[0]) return null;

  const service = toService(rows[0]);
  const [slots] = await pool.query(
    `SELECT day_of_week, start_time, end_time FROM provider_availability
     WHERE provider_id = ? ORDER BY day_of_week, start_time`,
    [service.provider.id],
  );
  service.provider.availability = slots.map((slot) => ({
    day_of_week: slot.day_of_week,
    start_time: String(slot.start_time).slice(0, 5),
    end_time: String(slot.end_time).slice(0, 5),
  }));
  return service;
}

module.exports = { search, findPublicById, SORTS };
