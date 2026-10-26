const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const env = require('../config/env');
const { requireAuth, requireRole, requireActiveUser } = require('../middlewares/auth');
const { ApiError, sendSuccess } = require('../utils/response');
const { validate } = require('../utils/validate');

const BOOKING_STATUSES = [
  'requested',
  'accepted',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
];

const idSchema = z.uuid();
const note = (min, label) =>
  z
    .string(`${label} wajib diisi.`)
    .trim()
    .min(min, `${label} minimal ${min} karakter.`)
    .max(1000, `${label} maksimal 1000 karakter.`);

const createProviderSchema = z.object({
  name: z
    .string('Nama lengkap wajib diisi.')
    .trim()
    .min(2, 'Nama lengkap minimal 2 karakter.')
    .max(100, 'Nama lengkap maksimal 100 karakter.'),
  email: z
    .string('Email wajib diisi.')
    .trim()
    .toLowerCase()
    .max(255, 'Email maksimal 255 karakter.')
    .pipe(z.email('Format email tidak valid.')),
  phone: z
    .string('Nomor telepon wajib diisi.')
    .trim()
    .regex(/^\+62\d{8,13}$/, 'Nomor telepon harus diawali +62, contoh +6281234567890.'),
  password: z
    .string('Kata sandi awal wajib diisi.')
    .min(8, 'Kata sandi minimal 8 karakter.')
    .max(72, 'Kata sandi maksimal 72 karakter.'),
  alumni_reg_no: z
    .string('Nomor alumni wajib diisi.')
    .trim()
    .min(1, 'Nomor alumni wajib diisi.')
    .max(50, 'Nomor alumni maksimal 50 karakter.'),
  city: z
    .string('Kota wajib diisi.')
    .trim()
    .min(2, 'Kota minimal 2 karakter.')
    .max(50, 'Kota maksimal 50 karakter.'),
});

const verifySchema = z
  .object({
    status: z.enum(['verified', 'rejected'], 'Status verifikasi: verified atau rejected.'),
    note: z.string().trim().max(1000, 'Catatan maksimal 1000 karakter.').optional(),
  })
  .superRefine((data, ctx) => {
    // FR-ADM-02: penolakan wajib menyertakan catatan untuk mitra.
    if (data.status === 'rejected' && (!data.note || data.note.length < 10)) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Catatan penolakan wajib diisi, minimal 10 karakter.',
      });
    }
  });

const moderateSchema = z
  .object({
    is_hidden: z.boolean('is_hidden harus true atau false.'),
    reason: z.string().trim().max(1000, 'Alasan maksimal 1000 karakter.').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.is_hidden && (!data.reason || data.reason.length < 10)) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Alasan menyembunyikan ulasan wajib diisi, minimal 10 karakter.',
      });
    }
  });

const suspendSchema = z.object({ reason: note(10, 'Alasan penangguhan') });
const activateSchema = z.object({ reason: note(1, 'Catatan').optional() });

/** Mengubah hasil GROUP BY menjadi objek { nilai: jumlah } dengan semua kunci terisi. */
function countBy(rows, key, keys) {
  const result = Object.fromEntries(keys.map((name) => [name, 0]));
  for (const row of rows) result[row[key]] = (result[row[key]] ?? 0) + Number(row.total);
  return result;
}

const notFound = (what) => new ApiError(404, 'NOT_FOUND', `${what} tidak ditemukan.`);

/** BE-09: dasbor admin, verifikasi mitra, moderasi ulasan, penangguhan akun. */
function createAdminRouter({ admin, users }) {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'), requireActiveUser({ users }));

  async function load(find, id, what) {
    const row = idSchema.safeParse(id).success ? await find(id) : null;
    if (!row) throw notFound(what);
    return row;
  }

  // GET /admin/dashboard
  router.get('/dashboard', async (req, res) => {
    const data = await admin.dashboard();
    const byRole = countBy(data.users, 'role', ['customer', 'provider', 'admin']);
    const byStatus = countBy(data.users, 'status', ['active', 'suspended']);
    const bookings = countBy(data.bookings, 'status', BOOKING_STATUSES);
    return sendSuccess(res, {
      users: {
        total: byStatus.active + byStatus.suspended,
        customers: byRole.customer,
        providers: byRole.provider,
        admins: byRole.admin,
        suspended: byStatus.suspended,
      },
      providers: countBy(data.providers, 'verification_status', [
        'pending',
        'verified',
        'rejected',
      ]),
      bookings: { total: Object.values(bookings).reduce((a, b) => a + b, 0), ...bookings },
      reviews: {
        total: Number(data.reviews.total),
        hidden: Number(data.reviews.hidden),
        average_rating: Number(data.reviews.average),
      },
    });
  });

  // POST /admin/providers — akun mitra dibuat admin (API-04)
  router.post('/providers', async (req, res) => {
    const body = validate(createProviderSchema, req.body);
    const passwordHash = await bcrypt.hash(body.password, env.auth.bcryptSaltRounds);
    let created;
    try {
      created = await admin.createProvider({
        adminId: req.auth.userId,
        fullName: body.name,
        email: body.email,
        phone: body.phone,
        passwordHash,
        alumniRegNo: body.alumni_reg_no,
        city: body.city,
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw new ApiError(409, 'CONFLICT', 'Email ini sudah terdaftar.');
      }
      throw error;
    }
    return sendSuccess(
      res,
      {
        user: {
          id: created.userId,
          role: 'provider',
          name: body.name,
          email: body.email,
          phone: body.phone,
          status: 'active',
        },
        provider_profile: { id: created.profileId, verification_status: 'pending' },
      },
      { status: 201 },
    );
  });

  // PUT /admin/providers/:id/verify
  router.put('/providers/:id/verify', async (req, res) => {
    const body = validate(verifySchema, req.body);
    const profile = await load(admin.findProviderProfile, req.params.id, 'Penyedia jasa');
    if (body.status === 'verified' && (!profile.address_detail || profile.lat === null)) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Penyedia jasa belum bisa diverifikasi: alamat dan koordinat lokasi belum dilengkapi.',
      );
    }
    try {
      const updated = await admin.setVerification({
        adminId: req.auth.userId,
        profileId: profile.id,
        status: body.status,
        note: body.note || null,
      });
      return sendSuccess(res, updated);
    } catch (error) {
      // Lokasi dikosongkan tepat sebelum diverifikasi: CHECK database tetap menolak.
      if (/provider_profiles_verified_complete_check/.test(error.message)) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'Penyedia jasa belum bisa diverifikasi: alamat dan koordinat lokasi belum dilengkapi.',
        );
      }
      throw error;
    }
  });

  // PUT /admin/reviews/:id/moderate
  router.put('/reviews/:id/moderate', async (req, res) => {
    const body = validate(moderateSchema, req.body);
    const review = await load(admin.findReview, req.params.id, 'Ulasan');
    if (review.is_hidden === body.is_hidden) {
      throw new ApiError(
        409,
        'CONFLICT',
        body.is_hidden ? 'Ulasan ini sudah disembunyikan.' : 'Ulasan ini sudah ditampilkan.',
      );
    }
    const updated = await admin.setReviewHidden({
      adminId: req.auth.userId,
      review,
      hidden: body.is_hidden,
      reason: body.reason || null,
    });
    return sendSuccess(res, updated);
  });

  async function changeUserStatus(req, res, status, schema) {
    const body = validate(schema, req.body ?? {});
    const user = await load(admin.findUser, req.params.id, 'Pengguna');
    if (user.id === req.auth.userId) {
      throw new ApiError(403, 'FORBIDDEN', 'Admin tidak bisa mengubah status akunnya sendiri.');
    }
    if (user.role === 'admin') {
      throw new ApiError(403, 'FORBIDDEN', 'Status akun admin lain tidak bisa diubah dari sini.');
    }
    if (user.status === status) {
      throw new ApiError(
        409,
        'CONFLICT',
        status === 'suspended' ? 'Akun ini sudah dinonaktifkan.' : 'Akun ini sudah aktif.',
      );
    }
    const cancelledBookings = await admin.setUserStatus({
      adminId: req.auth.userId,
      user,
      status,
      reason: body.reason || null,
    });
    return sendSuccess(res, {
      user: { id: user.id, role: user.role, name: user.full_name, email: user.email, status },
      cancelled_bookings: cancelledBookings,
    });
  }

  // PUT /admin/users/:id/suspend dan /activate
  router.put('/users/:id/suspend', (req, res) =>
    changeUserStatus(req, res, 'suspended', suspendSchema),
  );
  router.put('/users/:id/activate', (req, res) =>
    changeUserStatus(req, res, 'active', activateSchema),
  );

  return router;
}

module.exports = { createAdminRouter };
