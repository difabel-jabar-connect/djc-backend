const express = require('express');
const { z } = require('zod');
const env = require('../config/env');
const { requireAuth, requireRole, requireActiveUser } = require('../middlewares/auth');
const { ApiError, sendSuccess } = require('../utils/response');
const { validate } = require('../utils/validate');

// Gambar dikirim sebagai data URI base64 di body JSON, mis. hasil FileReader.readAsDataURL.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const DATA_URI_PATTERN = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Ukuran asli (byte) dari isi base64, tanpa men-decode seluruhnya. */
function base64Bytes(base64) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

const image = z.string('Gambar wajib diunggah.').superRefine((value, ctx) => {
  const match = DATA_URI_PATTERN.exec(value);
  if (!match) {
    ctx.addIssue({
      code: 'custom',
      message: 'Gambar harus dikirim sebagai data URI base64, mis. data:image/jpeg;base64,….',
    });
    return;
  }
  if (!IMAGE_TYPES.includes(match[1])) {
    ctx.addIssue({
      code: 'custom',
      message: 'Format gambar harus JPG, PNG, WebP, GIF, atau AVIF.',
    });
  }
  if (base64Bytes(match[2]) > MAX_IMAGE_BYTES) {
    ctx.addIssue({ code: 'custom', message: 'Ukuran gambar maksimal 5 MB.' });
  }
});

// Teks alternatif wajib untuk setiap gambar (NFR-ACC-03); kosong atau hanya spasi ditolak.
const imageAlt = z
  .string('Teks alternatif gambar wajib diisi.')
  .trim()
  .min(1, 'Teks alternatif gambar wajib diisi.')
  .max(250, 'Teks alternatif gambar maksimal 250 karakter.');

const photoSchema = z.object({ image, image_alt: imageAlt });

const portfolioSchema = z.object({
  image,
  image_alt: imageAlt,
  title: z
    .string('Judul karya wajib diisi.')
    .trim()
    .min(2, 'Judul karya minimal 2 karakter.')
    .max(120, 'Judul karya maksimal 120 karakter.'),
  description: z
    .string('Deskripsi harus berupa teks.')
    .trim()
    .max(500, 'Deskripsi maksimal 500 karakter.')
    .transform((value) => value || null)
    .nullable()
    .optional(),
  item_type: z.enum(
    ['work_result', 'physical_product'],
    'Jenis karya harus work_result atau physical_product.',
  ),
});

const idSchema = z.uuid();

/** Parser JSON khusus upload: batas lebih besar karena gambar 5 MB menjadi ~6,7 MB base64. */
const uploadJson = express.json({ limit: '8mb' });

/**
 * PUT /provider/photo, GET/POST /provider/portfolio, DELETE /provider/portfolio/:id
 * (khusus provider, BE-04). Gambar diunggah ke Cloudinary lewat `cloudinary.uploadImage`.
 */
function createProviderMediaRouter({ providers, users, cloudinary }) {
  const router = express.Router();
  router.use(requireAuth, requireRole('provider'), requireActiveUser({ users }));

  async function ownProfile(req) {
    const profile = await providers.findOwnByUserId(req.auth.userId);
    if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Profil penyedia jasa belum dibuat.');
    return profile;
  }

  // Validasi (termasuk teks alternatif) selesai sebelum gambar dikirim ke Cloudinary.
  async function upload(dataUri, folder) {
    if (!cloudinary.configured) {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Upload gambar belum diaktifkan.');
    }
    try {
      return await cloudinary.uploadImage({ dataUri, folder });
    } catch (error) {
      if (!env.isTest) console.error(`[cloudinary] ${error.message}`);
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Upload gambar gagal. Silakan coba lagi.');
    }
  }

  router.put('/photo', uploadJson, async (req, res) => {
    const body = validate(photoSchema, req.body);
    const profile = await ownProfile(req);
    const uploaded = await upload(body.image, `djc/providers/${profile.id}`);
    await providers.updatePhoto(profile.id, { url: uploaded.url, alt: body.image_alt });
    return sendSuccess(res, { photo_url: uploaded.url, photo_alt: body.image_alt });
  });

  router.get('/portfolio', async (req, res) => {
    const profile = await ownProfile(req);
    return sendSuccess(res, await providers.listPortfolio(profile.id));
  });

  router.post('/portfolio', uploadJson, async (req, res) => {
    const body = validate(portfolioSchema, req.body);
    const profile = await ownProfile(req);
    const uploaded = await upload(body.image, `djc/providers/${profile.id}/portfolio`);
    const item = await providers.createPortfolioItem(profile.id, {
      title: body.title,
      description: body.description ?? null,
      itemType: body.item_type,
      imageUrl: uploaded.url,
      imageAlt: body.image_alt,
    });
    return sendSuccess(res, item, { status: 201 });
  });

  router.delete('/portfolio/:id', async (req, res) => {
    const profile = await ownProfile(req);
    const deleted =
      idSchema.safeParse(req.params.id).success &&
      (await providers.deletePortfolioItem(profile.id, req.params.id));
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', 'Karya portofolio tidak ditemukan.');
    return sendSuccess(res, { deleted: true });
  });

  return router;
}

module.exports = { createProviderMediaRouter, MAX_IMAGE_BYTES };
