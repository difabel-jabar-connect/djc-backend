const express = require('express');
const { z } = require('zod');
const env = require('../config/env');
const { requireAuth, requireRole, requireActiveUser } = require('../middlewares/auth');
const { ApiError, sendSuccess } = require('../utils/response');
const { validate } = require('../utils/validate');
const { image, uploadJson, discardImage } = require('./imageUpload');

const MAX_ACCOUNTS = 5;
const idSchema = z.uuid();

const providerName = z
  .string('Nama bank / e-wallet wajib diisi.')
  .trim()
  .min(2, 'Nama bank / e-wallet minimal 2 karakter.')
  .max(50, 'Nama bank / e-wallet maksimal 50 karakter.');

// Rekening bank dan e-wallet: nomor (angka saja, boleh diketik dengan spasi/strip) + nama pemilik.
const accountFields = {
  provider_name: providerName,
  account_number: z
    .string('Nomor rekening wajib diisi.')
    .transform((value) => value.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\d{6,30}$/, 'Nomor rekening / e-wallet berisi 6–30 angka.')),
  account_holder: z
    .string('Nama pemilik rekening wajib diisi.')
    .trim()
    .min(2, 'Nama pemilik rekening minimal 2 karakter.')
    .max(100, 'Nama pemilik rekening maksimal 100 karakter.'),
};

const createSchema = z.discriminatedUnion(
  'type',
  [
    z.object({ type: z.literal('bank'), ...accountFields }),
    z.object({ type: z.literal('ewallet'), ...accountFields }),
    z.object({
      type: z.literal('qris'),
      provider_name: providerName.optional(),
      image,
    }),
  ],
  'Jenis pembayaran: bank, ewallet, atau qris.',
);

/**
 * /provider/payment-accounts: rekening bank, e-wallet, atau QRIS milik penyedia jasa untuk
 * pembayaran langsung (tanpa payment gateway). Pelanggan melihatnya di detail pesanan
 * setelah pesanan diterima.
 */
function createProviderPaymentsRouter({ providers, paymentAccounts, users, cloudinary }) {
  const router = express.Router();
  router.use(requireAuth, requireRole('provider'), requireActiveUser({ users }));

  async function ownProfile(req) {
    const profile = await providers.findOwnByUserId(req.auth.userId);
    if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Profil penyedia jasa belum dibuat.');
    return profile;
  }

  router.get('/', async (req, res) => {
    const profile = await ownProfile(req);
    return sendSuccess(res, await paymentAccounts.listByProvider(profile.id));
  });

  router.post('/', uploadJson, async (req, res) => {
    const body = validate(createSchema, req.body);
    const profile = await ownProfile(req);
    const existing = await paymentAccounts.listByProvider(profile.id);
    if (existing.length >= MAX_ACCOUNTS) {
      throw new ApiError(
        409,
        'CONFLICT',
        `Paling banyak ${MAX_ACCOUNTS} tujuan pembayaran. Hapus salah satu dulu.`,
      );
    }

    let data = body;
    if (body.type === 'qris') {
      if (!cloudinary.configured) {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Upload gambar belum diaktifkan.');
      }
      let uploaded;
      try {
        uploaded = await cloudinary.uploadImage({
          dataUri: body.image,
          folder: `djc/providers/${profile.id}/qris`,
        });
      } catch (error) {
        if (!env.isTest) console.error(`[cloudinary] ${error.message}`);
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Upload gambar gagal. Silakan coba lagi.');
      }
      data = {
        type: 'qris',
        provider_name: body.provider_name ?? 'QRIS',
        qris_image_url: uploaded.url,
      };
    }
    const account = await paymentAccounts.create(profile.id, data);
    return sendSuccess(res, account, { status: 201 });
  });

  router.delete('/:id', async (req, res) => {
    const profile = await ownProfile(req);
    const account = idSchema.safeParse(req.params.id).success
      ? await paymentAccounts.findOwn(profile.id, req.params.id)
      : null;
    const deleted = Boolean(account) && (await paymentAccounts.remove(profile.id, account.id));
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', 'Tujuan pembayaran tidak ditemukan.');
    await discardImage(cloudinary, account.qris_image_url);
    return sendSuccess(res, { deleted: true });
  });

  return router;
}

module.exports = { createProviderPaymentsRouter, MAX_ACCOUNTS };
