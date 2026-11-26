const express = require('express');
const { z } = require('zod');
const env = require('../config/env');
const { requireAuth, requireRole, requireActiveUser } = require('../middlewares/auth');
const { ApiError, sendSuccess } = require('../utils/response');
const { validate } = require('../utils/validate');
const { image, uploadJson, discardImage, MAX_IMAGE_BYTES } = require('./imageUpload');

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
    if (profile.photo_url !== uploaded.url) await discardImage(cloudinary, profile.photo_url);
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
    const validId = idSchema.safeParse(req.params.id).success;
    const item = validId
      ? (await providers.listPortfolio(profile.id)).find((row) => row.id === req.params.id)
      : null;
    const deleted = Boolean(item) && (await providers.deletePortfolioItem(profile.id, item.id));
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', 'Karya portofolio tidak ditemukan.');
    await discardImage(cloudinary, item.image_url);
    return sendSuccess(res, { deleted: true });
  });

  return router;
}

module.exports = { createProviderMediaRouter, MAX_IMAGE_BYTES };
