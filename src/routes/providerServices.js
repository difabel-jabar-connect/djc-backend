const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole, requireActiveUser } = require('../middlewares/auth');
const { ApiError, sendSuccess } = require('../utils/response');
const { validate } = require('../utils/validate');

const PRICING_TYPES = ['fixed', 'starting_from', 'hourly'];
const SERVICE_MODES = ['at_customer', 'at_provider', 'both'];

const idSchema = z.uuid();

const positiveInt = (label, max) =>
  z
    .number(`${label} harus berupa angka.`)
    .int(`${label} harus bilangan bulat.`)
    .min(1, `${label} minimal 1.`)
    .max(max, `${label} maksimal ${max}.`);

// Semua field boleh dikirim sebagian saat PUT; POST memakai versi wajib di bawah.
const fields = {
  category_id: z.uuid('category_id harus berupa UUID kategori.'),
  title: z
    .string('Judul layanan harus berupa teks.')
    .trim()
    .min(3, 'Judul layanan minimal 3 karakter.')
    .max(120, 'Judul layanan maksimal 120 karakter.'),
  description: z
    .string('Deskripsi harus berupa teks.')
    .trim()
    .max(2000, 'Deskripsi maksimal 2000 karakter.')
    .transform((value) => value || null)
    .nullable(),
  pricing_type: z.enum(PRICING_TYPES, 'Model harga: fixed, starting_from, atau hourly.'),
  price_amount: positiveInt('Harga', 1_000_000_000),
  min_hours: positiveInt('Minimal jam', 24).nullable(),
  duration_estimate_min: positiveInt('Estimasi durasi (menit)', 1440).nullable(),
  service_mode: z.enum(SERVICE_MODES, 'Moda layanan: at_customer, at_provider, atau both.'),
  is_active: z.boolean('is_active harus true atau false.'),
};

const createSchema = z.object({
  ...fields,
  description: fields.description.optional(),
  min_hours: fields.min_hours.optional(),
  duration_estimate_min: fields.duration_estimate_min.optional(),
  is_active: fields.is_active.optional(),
});

const updateSchema = z
  .object(fields)
  .partial()
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    'Kirim minimal satu field yang ingin diubah.',
  );

const validationError = (field, message) =>
  new ApiError(400, 'VALIDATION_ERROR', 'Data yang dikirim belum valid.', [{ field, message }]);

/**
 * Tarif per jam wajib punya minimal jam; model lain tidak boleh punya
 * (sama dengan CHECK services_min_hours_check). Mengembalikan nilai min_hours final.
 */
function resolveMinHours(pricingType, minHours, minHoursSent) {
  if (pricingType === 'hourly') {
    if (minHours === null || minHours === undefined) {
      throw validationError('min_hours', 'Minimal jam wajib diisi untuk tarif per jam.');
    }
    return minHours;
  }
  if (minHoursSent && minHours !== null) {
    throw validationError('min_hours', 'Minimal jam hanya untuk tarif per jam (hourly).');
  }
  return null;
}

/** SP2-07: /provider/services, katalog layanan milik provider yang sedang login. */
function createProviderServicesRouter({ providers, services, categories, users }) {
  const router = express.Router();
  router.use(requireAuth, requireRole('provider'), requireActiveUser({ users }));

  async function ownProfile(req) {
    const profile = await providers.findOwnByUserId(req.auth.userId);
    if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Profil penyedia jasa belum dibuat.');
    return profile;
  }

  async function assertActiveCategory(categoryId) {
    const category = await categories.findById(categoryId);
    if (!category || !category.is_active) {
      throw validationError('category_id', 'Kategori tidak ditemukan atau sedang nonaktif.');
    }
  }

  async function ownService(profileId, id) {
    const service = idSchema.safeParse(id).success ? await services.findOwn(profileId, id) : null;
    if (!service) throw new ApiError(404, 'NOT_FOUND', 'Layanan tidak ditemukan.');
    return service;
  }

  router.get('/', async (req, res) => {
    const profile = await ownProfile(req);
    return sendSuccess(res, await services.listOwn(profile.id));
  });

  router.get('/:id', async (req, res) => {
    const profile = await ownProfile(req);
    return sendSuccess(res, await ownService(profile.id, req.params.id));
  });

  router.post('/', async (req, res) => {
    const body = validate(createSchema, req.body);
    const profile = await ownProfile(req);
    await assertActiveCategory(body.category_id);

    const created = await services.createOwn(profile.id, {
      ...body,
      min_hours: resolveMinHours(body.pricing_type, body.min_hours, body.min_hours !== undefined),
    });
    return sendSuccess(res, created, { status: 201 });
  });

  router.put('/:id', async (req, res) => {
    const body = validate(updateSchema, req.body);
    const profile = await ownProfile(req);
    const current = await ownService(profile.id, req.params.id);

    // Pindah kategori hanya ke kategori aktif. Kategori lama yang sudah dinonaktifkan admin
    // tetap boleh dipertahankan supaya provider masih bisa mengubah field lain.
    if (body.category_id !== undefined && body.category_id !== current.category.id) {
      await assertActiveCategory(body.category_id);
    }

    const pricingType = body.pricing_type ?? current.pricing_type;
    const minHoursSent = body.min_hours !== undefined;
    const minHours = resolveMinHours(
      pricingType,
      minHoursSent ? body.min_hours : current.min_hours,
      minHoursSent,
    );

    const updated = await services.updateOwn(profile.id, current.id, {
      ...body,
      min_hours: minHours,
    });
    return sendSuccess(res, updated);
  });

  return router;
}

module.exports = { createProviderServicesRouter, PRICING_TYPES, SERVICE_MODES };
