// Data dummy minimum sesuai docs/technical/data-model.md bagian "Data dummy minimum"
// (SP1-09): 10 user, 6 provider di 6 kota, 8 kategori, 8 keterampilan, 8 layanan,
// 7 booking (satu per status, 2 completed), 18 riwayat status, 2 review, 6 aksi admin.
//
// Seeder ini MENGHAPUS semua data di 12 tabel lalu mengisi ulang. ID dibuat
// deterministik (UUID v5 dari nama) supaya URL profil tetap sama setiap seed ulang.
// Tanggal booking dihitung relatif dari hari ini (WIB) agar status tetap masuk akal.

const { createHash } = require('node:crypto');
const bcrypt = require('bcryptjs');
const env = require('../../src/config/env');

const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'Demo12345';

// Urutan hapus: anak dulu, induk terakhir.
const TABLES = [
  'admin_actions',
  'reviews',
  'booking_status_history',
  'bookings',
  'services',
  'portfolio_items',
  'provider_availability',
  'provider_skills',
  'provider_profiles',
  'skills',
  'categories',
  'users',
];

const NAMESPACE = 'difabel-jabar-connect/seed';

/** UUID v5-style yang stabil dari sebuah kunci, mis. id('user:budi'). */
function id(key) {
  const hash = createHash('sha1').update(`${NAMESPACE}:${key}`).digest('hex');
  const variant = ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `${variant}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

/** Koordinat publik: dibulatkan 2 desimal (~1 km), keputusan #8 data-model. */
const roundCoord = (value) => Math.round(value * 100) / 100;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Tanggal kalender WIB (YYYY-MM-DD) untuk hari ini + offset hari. */
function wibDate(offsetDays, { skipSunday = false } = {}) {
  const direction = offsetDays < 0 ? -1 : 1;
  let date = new Date(Date.now() + offsetDays * DAY);
  const isSunday = (d) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', weekday: 'short' }).format(d) ===
    'Sun';
  while (skipSunday && isSunday(date)) date = new Date(date.getTime() + direction * DAY);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date);
}

const ago = (ms) => new Date(Date.now() - ms);

const ADMIN = { key: 'admin', name: 'Pengelola UPTD PPSGHD', email: 'admin@djc.test' };

const CUSTOMERS = [
  { key: 'budi', name: 'Budi Santoso', email: 'budi@djc.test' },
  { key: 'ani', name: 'Ani Wulandari', email: 'ani@djc.test' },
  { key: 'citra', name: 'Citra Pratiwi', email: 'citra@djc.test' },
];

const CATEGORIES = [
  { slug: 'kebersihan', name: 'Kebersihan' },
  { slug: 'servis-elektronik', name: 'Servis Elektronik' },
  { slug: 'jahit', name: 'Jahit' },
  { slug: 'kuliner', name: 'Kuliner' },
  { slug: 'kerajinan', name: 'Kerajinan' },
  { slug: 'desain', name: 'Desain' },
  { slug: 'terapi', name: 'Terapi' },
  { slug: 'lainnya', name: 'Lainnya' },
];

const SKILLS = [
  { slug: 'servis-elektronik', name: 'Servis elektronik' },
  { slug: 'instalasi-listrik', name: 'Instalasi listrik' },
  { slug: 'menjahit', name: 'Menjahit' },
  { slug: 'permak-pakaian', name: 'Permak pakaian' },
  { slug: 'kebersihan-rumah', name: 'Kebersihan rumah' },
  { slug: 'memasak', name: 'Memasak' },
  { slug: 'kerajinan-tangan', name: 'Kerajinan tangan' },
  { slug: 'terapi-pijat', name: 'Terapi pijat' },
];

// Koordinat = titik pusat kota (perkiraan), bukan alamat nyata.
const PROVIDERS = [
  {
    key: 'p1',
    name: 'Deni Setiawan',
    email: 'deni@djc.test',
    city: 'Kota Bekasi',
    district: 'Bekasi Selatan',
    lat: -6.2383,
    lng: 106.9756,
    status: 'verified',
    bio: 'Alumni pelatihan servis elektronik. Memperbaiki kipas angin, rice cooker, dan alat rumah tangga.',
    prefs: ['chat', 'call'],
    radius: 10,
    skills: ['servis-elektronik', 'instalasi-listrik'],
    days: [1, 2, 3, 4, 5, 6],
  },
  {
    key: 'p2',
    name: 'Siti Rahmawati',
    email: 'siti@djc.test',
    city: 'Kota Bandung',
    district: 'Coblong',
    lat: -6.9175,
    lng: 107.6191,
    status: 'verified',
    bio: 'Menerima permak dan jahit pakaian custom dari rumah. Ukuran dikonfirmasi sebelum dijahit.',
    prefs: ['chat', 'video_call', 'bisindo'],
    radius: null,
    skills: ['menjahit', 'permak-pakaian', 'kerajinan-tangan'],
    days: [1, 2, 3, 4, 5, 6],
  },
  {
    key: 'p3',
    name: 'Asep Kurniawan',
    email: 'asep@djc.test',
    city: 'Kota Bogor',
    district: 'Bogor Tengah',
    lat: -6.5971,
    lng: 106.806,
    status: 'verified',
    bio: 'Jasa bersih-bersih rumah dan kos dengan alat sendiri.',
    prefs: ['chat'],
    radius: 15,
    skills: ['kebersihan-rumah', 'memasak'],
    days: [0, 1, 2, 3, 4, 5, 6],
  },
  {
    key: 'p4',
    name: 'Rina Marlina',
    email: 'rina@djc.test',
    city: 'Kota Cimahi',
    district: 'Cimahi Tengah',
    lat: -6.8722,
    lng: 107.5425,
    status: 'verified',
    bio: 'Masak di rumah untuk acara keluarga dan kue kering kemasan buatan sendiri.',
    prefs: ['chat', 'call'],
    radius: 20,
    skills: ['memasak', 'kerajinan-tangan'],
    days: [0, 1, 2, 3, 4, 5, 6],
  },
  {
    key: 'p5',
    name: 'Yusuf Hidayat',
    email: 'yusuf@djc.test',
    city: 'Kota Tasikmalaya',
    district: 'Cihideung',
    lat: -7.3274,
    lng: 108.2207,
    status: 'pending',
    bio: 'Pengrajin anyaman bambu khas Tasikmalaya.',
    prefs: ['chat'],
    radius: null,
    skills: ['kerajinan-tangan', 'menjahit'],
    days: [],
  },
  {
    key: 'p6',
    name: 'Dewi Lestari',
    email: 'dewi@djc.test',
    city: 'Kota Cirebon',
    district: 'Kejaksan',
    lat: -6.732,
    lng: 108.5523,
    status: 'rejected',
    bio: 'Terapis pijat tradisional untuk pegal dan kelelahan.',
    prefs: ['call'],
    radius: 10,
    skills: ['terapi-pijat'],
    days: [],
  },
];

const PORTFOLIO = [
  {
    key: 'pf1',
    provider: 'p1',
    title: 'Perbaikan kipas angin',
    type: 'work_result',
    alt: 'Kipas angin berdiri yang sudah diperbaiki di atas meja kerja',
  },
  {
    key: 'pf2',
    provider: 'p2',
    title: 'Kebaya brokat custom',
    type: 'work_result',
    alt: 'Kebaya brokat warna krem pada manekin',
  },
  {
    key: 'pf3',
    provider: 'p3',
    title: 'Hasil bersih dapur',
    type: 'work_result',
    alt: 'Dapur rumah yang bersih setelah layanan kebersihan',
  },
  {
    key: 'pf4',
    provider: 'p4',
    title: 'Kue kering kemasan',
    type: 'physical_product',
    alt: 'Toples berisi kue kering nastar dengan label buatan sendiri',
  },
];

const SERVICES = [
  {
    key: 's1',
    provider: 'p1',
    category: 'servis-elektronik',
    title: 'Servis elektronik rumah tangga',
    pricing: 'starting_from',
    price: 75000,
    minHours: null,
    duration: 90,
    mode: 'at_customer',
    active: true,
  },
  {
    key: 's2',
    provider: 'p1',
    category: 'servis-elektronik',
    title: 'Ganti kabel dan stop kontak',
    pricing: 'fixed',
    price: 50000,
    minHours: null,
    duration: 60,
    mode: 'at_customer',
    active: true,
  },
  {
    key: 's3',
    provider: 'p2',
    category: 'jahit',
    title: 'Permak celana',
    pricing: 'fixed',
    price: 25000,
    minHours: null,
    duration: 60,
    mode: 'at_provider',
    active: true,
  },
  {
    key: 's4',
    provider: 'p2',
    category: 'jahit',
    title: 'Jahit baju custom',
    pricing: 'starting_from',
    price: 150000,
    minHours: null,
    duration: null,
    mode: 'both',
    active: true,
  },
  {
    key: 's5',
    provider: 'p3',
    category: 'kebersihan',
    title: 'Bersih-bersih rumah',
    pricing: 'hourly',
    price: 40000,
    minHours: 2,
    duration: null,
    mode: 'at_customer',
    active: true,
  },
  {
    key: 's6',
    provider: 'p3',
    category: 'kebersihan',
    title: 'Cuci sofa',
    pricing: 'fixed',
    price: 120000,
    minHours: null,
    duration: 120,
    mode: 'at_customer',
    active: false,
  },
  {
    key: 's7',
    provider: 'p4',
    category: 'kuliner',
    title: 'Masak di rumah',
    pricing: 'hourly',
    price: 50000,
    minHours: 3,
    duration: null,
    mode: 'at_customer',
    active: true,
  },
  {
    key: 's8',
    provider: 'p5',
    category: 'kerajinan',
    title: 'Anyaman bambu custom',
    pricing: 'starting_from',
    price: 100000,
    minHours: null,
    duration: null,
    mode: 'at_provider',
    active: true,
  },
];

const CUSTOMER_LOCATIONS = {
  budi: { area: 'Bekasi Selatan, Kota Bekasi', address: 'Jl. Contoh Raya No. 12 (alamat dummy)' },
  ani: { area: 'Coblong, Kota Bandung', address: 'Jl. Contoh Dago No. 5 (alamat dummy)' },
  citra: { area: 'Bogor Tengah, Kota Bogor', address: 'Jl. Contoh Pajajaran No. 8 (alamat dummy)' },
};

// Riwayat status per booking: [to_status, siapa (customer/provider/null = sistem), jam lalu].
const BOOKINGS = [
  {
    code: 'DJC-0001',
    customer: 'budi',
    service: 's5',
    mode: 'at_customer',
    status: 'requested',
    quantity: 3,
    date: wibDate(3),
    start: '09:00',
    note: 'Fokus bersihkan dapur dan kamar mandi.',
    history: [['requested', 'customer', 2]],
  },
  {
    code: 'DJC-0002',
    customer: 'ani',
    service: 's3',
    mode: 'at_provider',
    status: 'accepted',
    quantity: 1,
    date: wibDate(2, { skipSunday: true }),
    start: '10:00',
    note: 'Permak dua celana, dipotong 3 cm.',
    history: [
      ['requested', 'customer', 20],
      ['accepted', 'provider', 18],
    ],
  },
  {
    code: 'DJC-0003',
    customer: 'budi',
    service: 's7',
    mode: 'at_customer',
    status: 'in_progress',
    quantity: 4,
    date: wibDate(0),
    start: '13:00',
    note: 'Masak untuk arisan 15 orang.',
    history: [
      ['requested', 'customer', 72],
      ['accepted', 'provider', 70],
      ['in_progress', 'provider', 1],
    ],
  },
  {
    code: 'DJC-0004',
    customer: 'citra',
    service: 's2',
    mode: 'at_customer',
    status: 'completed',
    quantity: 1,
    date: wibDate(-7, { skipSunday: true }),
    start: '09:00',
    finalTotal: 50000,
    history: [
      ['requested', 'customer', 10 * 24],
      ['accepted', 'provider', 10 * 24 - 2],
      ['in_progress', 'provider', 7 * 24],
      ['completed', 'provider', 7 * 24 - 1],
    ],
  },
  {
    code: 'DJC-0005',
    customer: 'ani',
    service: 's1',
    mode: 'at_customer',
    status: 'completed',
    quantity: 1,
    date: wibDate(-14, { skipSunday: true }),
    start: '10:00',
    note: 'Rice cooker tidak panas.',
    finalTotal: 110000,
    history: [
      ['requested', 'customer', 16 * 24],
      ['accepted', 'provider', 16 * 24 - 3],
      ['in_progress', 'provider', 14 * 24],
      ['completed', 'provider', 14 * 24 - 2],
    ],
  },
  {
    code: 'DJC-0006',
    customer: 'citra',
    service: 's4',
    mode: 'at_provider',
    status: 'rejected',
    quantity: 1,
    date: wibDate(5, { skipSunday: true }),
    start: '10:00',
    reason: 'Kapasitas jahitan bulan ini sudah penuh.',
    history: [
      ['requested', 'customer', 30],
      ['rejected', 'provider', 26],
    ],
  },
  {
    code: 'DJC-0007',
    customer: 'budi',
    service: 's5',
    mode: 'at_customer',
    status: 'cancelled',
    cancelledBy: 'customer',
    quantity: 2,
    date: wibDate(4),
    start: '09:00',
    reason: 'Jadwal di rumah berubah.',
    history: [
      ['requested', 'customer', 50],
      ['cancelled', 'customer', 48],
    ],
  },
];

const REVIEWS = [
  { key: 'r1', booking: 'DJC-0004', rating: 5, comment: 'Cepat, rapi, penjelasannya jelas.' },
  {
    key: 'r2',
    booking: 'DJC-0005',
    rating: 1,
    comment: 'Mahal. Kalau mau lebih murah hubungi saya saja di 0812-0000-0000.',
    hiddenReason: 'Data pribadi di komentar',
  },
];

exports.seed = async function seed(knex) {
  if (env.isProduction && process.env.SEED_FORCE !== '1') {
    throw new Error('Seeder menghapus semua data. Di production jalankan dengan SEED_FORCE=1.');
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, env.auth.bcryptSaltRounds);
  const adminId = id(`user:${ADMIN.key}`);
  const providerById = Object.fromEntries(PROVIDERS.map((p) => [p.key, p]));
  const serviceByKey = Object.fromEntries(SERVICES.map((s) => [s.key, s]));
  const phone = (n) => `+6281200000${String(n).padStart(3, '0')}`;

  await knex.transaction(async (trx) => {
    for (const table of TABLES) await trx(table).del();

    await trx('users').insert([
      { ...user(ADMIN, 'admin'), phone: phone(1) },
      ...CUSTOMERS.map((c, i) => ({ ...user(c, 'customer'), phone: phone(10 + i) })),
      ...PROVIDERS.map((p, i) => ({ ...user(p, 'provider'), phone: phone(20 + i) })),
    ]);

    await trx('categories').insert(
      CATEGORIES.map((c, i) => ({
        id: id(`category:${c.slug}`),
        name: c.name,
        slug: c.slug,
        icon: c.slug,
        sort_order: i + 1,
      })),
    );

    await trx('skills').insert(
      SKILLS.map((s) => ({ id: id(`skill:${s.slug}`), name: s.name, slug: s.slug })),
    );

    await trx('provider_profiles').insert(
      PROVIDERS.map((p, i) => ({
        id: id(`provider:${p.key}`),
        user_id: id(`user:${p.key}`),
        display_name: p.name,
        bio: p.bio,
        communication_prefs: JSON.stringify(p.prefs),
        alumni_reg_no: `PPSGHD-2024-${String(i + 1).padStart(3, '0')}`,
        address_detail: `Jl. Contoh No. ${i + 1}, ${p.district}, ${p.city} (alamat dummy)`,
        city: p.city,
        district: p.district,
        lat: p.lat,
        lng: p.lng,
        public_lat: roundCoord(p.lat),
        public_lng: roundCoord(p.lng),
        service_radius_km: p.radius,
        verification_status: p.status,
        verified_by: p.status === 'verified' ? adminId : null,
        verified_at: p.status === 'verified' ? ago(20 * DAY) : null,
      })),
    );

    await trx('provider_skills').insert(
      PROVIDERS.flatMap((p) =>
        p.skills.map((slug) => ({
          provider_id: id(`provider:${p.key}`),
          skill_id: id(`skill:${slug}`),
        })),
      ),
    );

    await trx('provider_availability').insert(
      PROVIDERS.flatMap((p) =>
        p.days.map((day) => ({
          id: id(`availability:${p.key}:${day}`),
          provider_id: id(`provider:${p.key}`),
          day_of_week: day,
          start_time: '08:00',
          end_time: '17:00',
        })),
      ),
    );

    await trx('portfolio_items').insert(
      PORTFOLIO.map((item, i) => ({
        id: id(`portfolio:${item.key}`),
        provider_id: id(`provider:${item.provider}`),
        title: item.title,
        item_type: item.type,
        image_url: `https://placehold.co/800x600/webp?text=${encodeURIComponent(item.title)}`,
        image_alt: item.alt,
        sort_order: i + 1,
      })),
    );

    await trx('services').insert(
      SERVICES.map((s) => ({
        id: id(`service:${s.key}`),
        provider_id: id(`provider:${s.provider}`),
        category_id: id(`category:${s.category}`),
        title: s.title,
        description: `${s.title} oleh ${providerById[s.provider].name}.`,
        pricing_type: s.pricing,
        price_amount: s.price,
        min_hours: s.minHours,
        duration_estimate_min: s.duration,
        service_mode: s.mode,
        is_active: s.active,
      })),
    );

    for (const b of BOOKINGS) {
      const service = serviceByKey[b.service];
      const bookingId = id(`booking:${b.code}`);
      const actor = (who) =>
        who === 'customer'
          ? id(`user:${b.customer}`)
          : who === 'provider'
            ? id(`user:${service.provider}`)
            : null;
      const location = b.mode === 'at_customer' ? CUSTOMER_LOCATIONS[b.customer] : null;
      const createdAt = ago(b.history[0][2] * HOUR);
      const updatedAt = ago(b.history[b.history.length - 1][2] * HOUR);

      await trx('bookings').insert({
        id: bookingId,
        code: b.code,
        customer_id: id(`user:${b.customer}`),
        provider_id: id(`provider:${service.provider}`),
        service_id: id(`service:${b.service}`),
        scheduled_date: b.date,
        start_time: b.start,
        service_mode: b.mode,
        location_area: location?.area ?? null,
        location_address: location?.address ?? null,
        customer_note: b.note ?? null,
        pricing_type_snapshot: service.pricing,
        unit_price_snapshot: service.price,
        quantity: b.quantity,
        estimated_total: service.price * b.quantity,
        final_total: b.finalTotal ?? null,
        status: b.status,
        cancelled_by: b.cancelledBy ?? null,
        status_reason: b.reason ?? null,
        created_at: createdAt,
        updated_at: updatedAt,
      });

      await trx('booking_status_history').insert(
        b.history.map(([toStatus, who, hoursAgo], i) => ({
          id: id(`history:${b.code}:${i}`),
          booking_id: bookingId,
          from_status: i === 0 ? null : b.history[i - 1][0],
          to_status: toStatus,
          changed_by: actor(who),
          reason: ['rejected', 'cancelled'].includes(toStatus) ? (b.reason ?? null) : null,
          created_at: ago(hoursAgo * HOUR),
        })),
      );
    }

    await trx('reviews').insert(
      REVIEWS.map((r) => {
        const booking = BOOKINGS.find((b) => b.code === r.booking);
        return {
          id: id(`review:${r.key}`),
          booking_id: id(`booking:${r.booking}`),
          customer_id: id(`user:${booking.customer}`),
          provider_id: id(`provider:${serviceByKey[booking.service].provider}`),
          rating: r.rating,
          comment: r.comment,
          is_hidden: Boolean(r.hiddenReason),
          hidden_by: r.hiddenReason ? adminId : null,
          hidden_reason: r.hiddenReason ?? null,
          created_at: ago(5 * DAY),
        };
      }),
    );

    // rating_avg dan rating_count hanya menghitung review yang tidak disembunyikan.
    await trx.raw(`
      UPDATE provider_profiles p
      LEFT JOIN (
        SELECT provider_id, ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS total
        FROM reviews WHERE is_hidden = FALSE GROUP BY provider_id
      ) r ON r.provider_id = p.id
      SET p.rating_avg = COALESCE(r.avg_rating, 0), p.rating_count = COALESCE(r.total, 0)
    `);

    await trx('admin_actions').insert([
      ...['p1', 'p2', 'p3', 'p4'].map((key) => ({
        id: id(`admin-action:verify:${key}`),
        admin_id: adminId,
        action: 'verify_provider',
        target_type: 'provider_profile',
        target_id: id(`provider:${key}`),
        created_at: ago(20 * DAY),
      })),
      {
        id: id('admin-action:reject:p6'),
        admin_id: adminId,
        action: 'reject_provider',
        target_type: 'provider_profile',
        target_id: id('provider:p6'),
        note: 'Dokumen alumni belum lengkap',
        created_at: ago(19 * DAY),
      },
      {
        id: id('admin-action:hide:r2'),
        admin_id: adminId,
        action: 'hide_review',
        target_type: 'review',
        target_id: id('review:r2'),
        note: 'Data pribadi di komentar',
        created_at: ago(4 * DAY),
      },
    ]);
  });

  function user(person, role) {
    return {
      id: id(`user:${person.key}`),
      role,
      full_name: person.name,
      email: person.email,
      password_hash: passwordHash,
    };
  }
};
