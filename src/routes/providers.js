const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole, requireActiveUser } = require('../middlewares/auth');
const { ApiError, sendSuccess } = require('../utils/response');
const { validate } = require('../utils/validate');

const COMMUNICATION_PREFS = ['chat', 'call', 'video_call', 'bisindo'];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const idSchema = z.uuid();

const nullableText = (max, label) =>
  z
    .string(`${label} harus berupa teks.`)
    .trim()
    .max(max, `${label} maksimal ${max} karakter.`)
    .transform((value) => value || null)
    .nullable();

const profileSchema = z
  .object({
    display_name: z
      .string('Nama tampil harus berupa teks.')
      .trim()
      .min(2, 'Nama tampil minimal 2 karakter.')
      .max(100, 'Nama tampil maksimal 100 karakter.'),
    bio: nullableText(500, 'Bio'),
    communication_prefs: z
      .array(
        z.enum(COMMUNICATION_PREFS, 'Preferensi komunikasi: chat, call, video_call, atau bisindo.'),
        'Preferensi komunikasi harus berupa daftar.',
      )
      .max(COMMUNICATION_PREFS.length)
      .refine(
        (list) => new Set(list).size === list.length,
        'Preferensi komunikasi tidak boleh ganda.',
      ),
    disability_type: nullableText(50, 'Jenis disabilitas'),
    phone: z
      .string('Nomor telepon harus berupa teks.')
      .trim()
      .regex(/^\+62\d{8,13}$/, 'Nomor telepon harus diawali +62, contoh +6281234567890.'),
    address_detail: nullableText(500, 'Alamat'),
    city: z
      .string('Kota harus berupa teks.')
      .trim()
      .min(2, 'Kota minimal 2 karakter.')
      .max(50, 'Kota maksimal 50 karakter.'),
    district: nullableText(50, 'Kecamatan'),
    lat: z.number('Latitude harus berupa angka.').min(-90).max(90).nullable(),
    lng: z.number('Longitude harus berupa angka.').min(-180).max(180).nullable(),
    service_radius_km: z
      .number('Radius layanan harus berupa angka.')
      .int('Radius layanan harus bilangan bulat.')
      .min(1, 'Radius layanan minimal 1 km.')
      .max(500, 'Radius layanan maksimal 500 km.')
      .nullable(),
  })
  .partial()
  .superRefine((data, ctx) => {
    if (!Object.values(data).some((value) => value !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: 'Kirim minimal satu field yang ingin diubah.',
      });
    }
    // Koordinat asli selalu dikirim berpasangan supaya koordinat publik dihitung dari titik yang sama.
    if (
      (data.lat === undefined) !== (data.lng === undefined) ||
      (data.lat === null) !== (data.lng === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['lat'],
        message: 'lat dan lng wajib dikirim bersamaan.',
      });
    }
  });

const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

const availabilitySchema = z
  .object({
    availability: z
      .array(
        z.object({
          day_of_week: z
            .number('Hari harus berupa angka 0–6.')
            .int('Hari harus berupa angka 0–6.')
            .min(0, 'Hari harus berupa angka 0–6 (0 = Minggu).')
            .max(6, 'Hari harus berupa angka 0–6 (0 = Minggu).'),
          start_time: z
            .string('Jam mulai wajib diisi.')
            .regex(TIME_PATTERN, 'Jam mulai berformat HH:mm.'),
          end_time: z
            .string('Jam selesai wajib diisi.')
            .regex(TIME_PATTERN, 'Jam selesai berformat HH:mm.'),
        }),
        'availability harus berupa daftar jadwal.',
      )
      .max(28, 'Maksimal 28 slot jadwal per minggu.'),
  })
  .superRefine(({ availability }, ctx) => {
    availability.forEach((slot, index) => {
      if (toMinutes(slot.end_time) <= toMinutes(slot.start_time)) {
        ctx.addIssue({
          code: 'custom',
          path: ['availability', index, 'end_time'],
          message: 'Jam selesai harus lebih besar dari jam mulai.',
        });
      }
    });
    // Slot di hari yang sama tidak boleh tumpang tindih.
    const sorted = availability
      .map((slot, index) => ({ ...slot, index }))
      .sort(
        (a, b) =>
          a.day_of_week - b.day_of_week || toMinutes(a.start_time) - toMinutes(b.start_time),
      );
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (
        previous.day_of_week === current.day_of_week &&
        toMinutes(current.start_time) < toMinutes(previous.end_time)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['availability', current.index, 'start_time'],
          message: 'Jadwal di hari yang sama tidak boleh tumpang tindih.',
        });
      }
    }
  });

/** P3 GET /providers/:id (publik, hanya koordinat kasar). */
function createProvidersRouter({ providers }) {
  const router = express.Router();

  router.get('/:id', async (req, res) => {
    const profile = idSchema.safeParse(req.params.id).success
      ? await providers.findPublicById(req.params.id)
      : null;
    if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Penyedia jasa tidak ditemukan.');
    return sendSuccess(res, profile);
  });

  return router;
}

/** /provider/profile dan /provider/availability milik provider yang sedang login (SP1-07). */
function createProviderSelfRouter({ providers, users }) {
  const router = express.Router();
  router.use(requireAuth, requireRole('provider'), requireActiveUser({ users }));

  async function ownProfile(req) {
    const profile = await providers.findOwnByUserId(req.auth.userId);
    if (!profile) throw new ApiError(404, 'NOT_FOUND', 'Profil penyedia jasa belum dibuat.');
    return profile;
  }

  router.get('/profile', async (req, res) => sendSuccess(res, await ownProfile(req)));

  router.put('/profile', async (req, res) => {
    const body = validate(profileSchema, req.body);
    const current = await ownProfile(req);

    // Provider terverifikasi tampil di publik, jadi alamat dan koordinatnya tidak boleh dikosongkan
    // (sama dengan CHECK provider_profiles_verified_complete_check).
    if (
      current.verification_status === 'verified' &&
      (body.address_detail === null || body.lat === null)
    ) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Data yang dikirim belum valid.', [
        {
          field: body.address_detail === null ? 'address_detail' : 'lat',
          message: 'Alamat dan koordinat wajib ada untuk penyedia jasa yang sudah terverifikasi.',
        },
      ]);
    }

    const profile = await providers.updateProfile(
      { profileId: current.id, userId: req.auth.userId },
      body,
    );
    return sendSuccess(res, profile);
  });

  router.get('/availability', async (req, res) => {
    const profile = await ownProfile(req);
    return sendSuccess(res, await providers.listAvailability(profile.id));
  });

  router.put('/availability', async (req, res) => {
    const body = validate(availabilitySchema, req.body);
    const profile = await ownProfile(req);
    return sendSuccess(res, await providers.replaceAvailability(profile.id, body.availability));
  });

  return router;
}

module.exports = { createProvidersRouter, createProviderSelfRouter };
