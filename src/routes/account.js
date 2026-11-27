const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const env = require('../config/env');
const { requireAuth, requireActiveUser } = require('../middlewares/auth');
const { createRateLimitStore } = require('../services/rateLimitStore');
const { ApiError, sendSuccess } = require('../utils/response');
const { validate } = require('../utils/validate');
const { toAuthUser } = require('./authUser');
const { image, uploadJson, discardImage } = require('./imageUpload');
const { signToken, setTokenCookie } = require('../utils/token');

const MAX_ADDRESSES = 10;

const name = z
  .string('Nama lengkap harus berupa teks.')
  .trim()
  .min(2, 'Nama lengkap minimal 2 karakter.')
  .max(100, 'Nama lengkap maksimal 100 karakter.');

const phone = z
  .string('Nomor telepon harus berupa teks.')
  .trim()
  .regex(/^\+62\d{8,13}$/, 'Nomor telepon harus diawali +62, contoh +6281234567890.');

const currentPassword = z
  .string('Kata sandi saat ini wajib diisi.')
  .min(1, 'Kata sandi saat ini wajib diisi.')
  .max(72, 'Kata sandi saat ini salah.');

const accountSchema = z
  .object({ name: name.optional(), phone: phone.optional() })
  .refine((body) => body.name !== undefined || body.phone !== undefined, {
    message: 'Kirim minimal satu data yang diubah (name atau phone).',
    path: ['name'],
  });

const passwordSchema = z
  .object({
    current_password: currentPassword,
    new_password: z
      .string('Kata sandi baru wajib diisi.')
      .min(8, 'Kata sandi baru minimal 8 karakter.')
      .max(72, 'Kata sandi baru maksimal 72 karakter.'),
  })
  .refine((body) => body.new_password !== body.current_password, {
    message: 'Kata sandi baru harus berbeda dari kata sandi saat ini.',
    path: ['new_password'],
  });

const photoSchema = z.object({ image });

const optionalText = (max, label) =>
  z
    .string(`${label} harus berupa teks.`)
    .trim()
    .max(max, `${label} maksimal ${max} karakter.`)
    .transform((value) => value || null)
    .nullable();

const addressFields = {
  label: z
    .string('Label alamat wajib diisi.')
    .trim()
    .min(2, 'Label alamat minimal 2 karakter.')
    .max(30, 'Label alamat maksimal 30 karakter.'),
  address: z
    .string('Alamat lengkap wajib diisi.')
    .trim()
    .min(10, 'Alamat lengkap minimal 10 karakter.')
    .max(300, 'Alamat lengkap maksimal 300 karakter.'),
  detail: optionalText(120, 'Detail alamat'),
  area: optionalText(100, 'Area'),
  lat: z.number('Latitude harus berupa angka.').min(-90).max(90),
  lng: z.number('Longitude harus berupa angka.').min(-180).max(180),
  is_primary: z.boolean('is_primary harus true atau false.'),
};

const createAddressSchema = z.object({
  ...addressFields,
  detail: addressFields.detail.optional(),
  area: addressFields.area.optional(),
  is_primary: addressFields.is_primary.optional(),
});

const updateAddressSchema = z
  .object(Object.fromEntries(Object.entries(addressFields).map(([k, v]) => [k, v.optional()])))
  .superRefine((body, ctx) => {
    if ((body.lat === undefined) !== (body.lng === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['lat'],
        message: 'lat dan lng wajib dikirim bersamaan.',
      });
    }
    if (Object.values(body).every((value) => value === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['label'], message: 'Tidak ada data yang diubah.' });
    }
  });

const idSchema = z.uuid();

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

/** Alamat dalam bentuk respons API. */
function toAddress(row) {
  return {
    id: row.id,
    label: row.label,
    address: row.address_text,
    detail: row.detail ?? null,
    area: row.area ?? null,
    lat: toNumber(row.lat),
    lng: toNumber(row.lng),
    is_primary: Boolean(row.is_primary),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toAddressChanges(body) {
  return {
    label: body.label,
    addressText: body.address,
    detail: body.detail,
    area: body.area,
    lat: body.lat,
    lng: body.lng,
    isPrimary: body.is_primary,
  };
}

/**
 * Akun Saya (semua peran yang login): ubah data diri, kata sandi, foto profil, dan
 * alamat tersimpan. Akun suspended hanya bisa membaca (requireActiveUser).
 *   PATCH /me, PUT /me/password, PUT|DELETE /me/photo,
 *   GET|POST /me/addresses, PATCH|DELETE /me/addresses/:id
 */
function createAccountRouter({
  users,
  addresses,
  cloudinary,
  redis = null,
  tokenBlacklist = null,
  loginLimit = 10,
}) {
  const router = express.Router();
  router.use(requireAuth, requireActiveUser({ users }));

  // Salah kata sandi saat ini dibatasi seperti login gagal: `loginLimit` kali per 15 menit.
  const passwordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginLimit,
    store: createRateLimitStore({ redis, prefix: `${env.redis.prefix}rl:account-password:` }),
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res, next) =>
      next(
        new ApiError(
          429,
          'TOO_MANY_REQUESTS',
          'Terlalu banyak percobaan kata sandi. Silakan coba lagi dalam 15 menit.',
        ),
      ),
  });

  async function currentUser(req) {
    const user = await users.findById(req.auth.userId);
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Silakan masuk terlebih dahulu.');
    return user;
  }

  /** Akun Google tanpa kata sandi sendiri tidak bisa memakai fitur yang meminta kata sandi. */
  async function checkCurrentPassword(user, password) {
    if (user.has_password === false || user.has_password === 0) {
      throw new ApiError(
        409,
        'PASSWORD_NOT_SET',
        'Akun ini masuk dengan Google dan belum punya kata sandi. Buat kata sandi lewat Lupa Kata Sandi.',
      );
    }
    if (!(await bcrypt.compare(password, user.password_hash))) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Data yang dikirim belum valid.', [
        { field: 'current_password', message: 'Kata sandi saat ini salah.' },
      ]);
    }
  }

  router.patch('/', async (req, res) => {
    const body = validate(accountSchema, req.body);
    const user = await users.updateAccount(req.auth.userId, body);
    return sendSuccess(res, { user: toAuthUser(user) });
  });

  router.put('/password', passwordLimiter, async (req, res) => {
    const body = validate(passwordSchema, req.body);
    const user = await currentUser(req);
    await checkCurrentPassword(user, body.current_password);
    const passwordHash = await bcrypt.hash(body.new_password, env.auth.bcryptSaltRounds);
    await users.updatePassword(user.id, passwordHash, { verifyEmail: false });
    // Cabut semua token lama di perangkat lain, lalu terbitkan cookie baru untuk sesi ini.
    const { token, jti, expiresAt } = signToken(user);
    await tokenBlacklist?.revokeAllForUser(user.id, { exceptJti: jti });
    setTokenCookie(res, token, { expiresAt });
    return sendSuccess(res, { password_changed: true });
  });

  router.put('/photo', uploadJson, async (req, res) => {
    const body = validate(photoSchema, req.body);
    if (!cloudinary.configured) {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Upload foto belum diaktifkan.');
    }
    let uploaded;
    try {
      uploaded = await cloudinary.uploadImage({
        dataUri: body.image,
        folder: `djc/users/${req.auth.userId}`,
      });
    } catch (error) {
      if (!env.isTest) console.error(`[cloudinary] ${error.message}`);
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Upload foto gagal. Silakan coba lagi.');
    }
    const previous = (await currentUser(req)).avatar_url;
    await users.updateAvatar(req.auth.userId, uploaded.url);
    if (previous !== uploaded.url) await discardImage(cloudinary, previous);
    return sendSuccess(res, { user: toAuthUser(await currentUser(req)) });
  });

  router.delete('/photo', async (req, res) => {
    const previous = (await currentUser(req)).avatar_url;
    await users.updateAvatar(req.auth.userId, null);
    await discardImage(cloudinary, previous);
    return sendSuccess(res, { user: toAuthUser(await currentUser(req)) });
  });

  router.get('/addresses', async (req, res) => {
    const rows = await addresses.listByUser(req.auth.userId);
    return sendSuccess(res, rows.map(toAddress));
  });

  router.post('/addresses', async (req, res) => {
    const body = validate(createAddressSchema, req.body);
    if ((await addresses.countByUser(req.auth.userId)) >= MAX_ADDRESSES) {
      throw new ApiError(
        409,
        'CONFLICT',
        `Maksimal ${MAX_ADDRESSES} alamat tersimpan. Hapus alamat yang tidak dipakai dulu.`,
      );
    }
    const row = await addresses.create(req.auth.userId, toAddressChanges(body));
    return sendSuccess(res, toAddress(row), { status: 201 });
  });

  router.patch('/addresses/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const body = validate(updateAddressSchema, req.body);
    const row = await addresses.update(req.auth.userId, id, toAddressChanges(body));
    if (!row) throw addressNotFound();
    return sendSuccess(res, toAddress(row));
  });

  router.delete('/addresses/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!(await addresses.remove(req.auth.userId, id))) throw addressNotFound();
    return sendSuccess(res, { deleted: true });
  });

  return router;
}

function parseId(value) {
  if (!idSchema.safeParse(value).success) throw addressNotFound();
  return value;
}

function addressNotFound() {
  return new ApiError(404, 'NOT_FOUND', 'Alamat tidak ditemukan.');
}

module.exports = { createAccountRouter, toAddress, MAX_ADDRESSES };
