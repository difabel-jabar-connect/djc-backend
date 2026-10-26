const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole, requireActiveUser } = require('../middlewares/auth');
const { ApiError, sendSuccess } = require('../utils/response');
const { validate } = require('../utils/validate');

const STATUSES = ['requested', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled'];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_LABELS = {
  requested: 'menunggu konfirmasi',
  accepted: 'diterima',
  in_progress: 'sedang dikerjakan',
  completed: 'selesai',
  rejected: 'ditolak',
  cancelled: 'dibatalkan',
};

/** Tanggal hari ini di WIB (jadwal booking memakai waktu lokal Jawa Barat). */
function todayInJakarta(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
}

/** DATE dari mysql2 (Date UTC tengah malam) atau string → "YYYY-MM-DD". */
function dateOnly(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

const dayOfWeek = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

/** "Budi Santoso" → "Budi S." (customer belum dikenal provider sebelum booking diterima). */
function shortName(fullName) {
  const words = String(fullName).trim().split(/\s+/);
  return words.length > 1 ? `${words[0]} ${words.at(-1)[0].toUpperCase()}.` : words[0];
}

/**
 * Bentuk booking untuk respons (B3). Kontak (telepon) dan alamat lawan transaksi belum
 * dibuka di sini; aturan buka-tutup kontak sesuai status adalah BE-07. Customer pemilik
 * dan admin melihat lokasi yang diisi customer sendiri; provider hanya `location.area`.
 */
function toBooking(row, viewer) {
  const seesOwnLocation = viewer === 'customer' || viewer === 'admin';
  const booking = {
    id: row.id,
    code: row.code,
    status: row.status,
    service: { id: row.service_id, title: row.service_title },
    provider: {
      id: row.provider_id,
      display_name: row.provider_display_name,
      city: row.provider_city,
      district: row.provider_district,
      phone: null,
      address_detail: null,
    },
    customer: {
      name: viewer === 'provider' ? shortName(row.customer_full_name) : row.customer_full_name,
      phone: null,
    },
    scheduled_date: dateOnly(row.scheduled_date),
    start_time: String(row.start_time).slice(0, 5),
    service_mode: row.service_mode,
    location: {
      area: row.location_area,
      address: seesOwnLocation ? row.location_address : null,
      lat: seesOwnLocation ? toNumber(row.location_lat) : null,
      lng: seesOwnLocation ? toNumber(row.location_lng) : null,
    },
    customer_note: row.customer_note,
    pricing_type_snapshot: row.pricing_type_snapshot,
    unit_price_snapshot: Number(row.unit_price_snapshot),
    quantity: Number(row.quantity),
    estimated_total: Number(row.estimated_total),
    actual_quantity: toNumber(row.actual_quantity),
    final_total: toNumber(row.final_total),
    cancelled_by: row.cancelled_by,
    status_reason: row.status_reason,
    // Ulasan dibuat di BE-08.
    can_review: false,
    created_at: row.created_at,
  };
  if (row.history) {
    booking.history = row.history.map((entry) => ({
      from_status: entry.from_status,
      to_status: entry.to_status,
      changed_by_role: entry.changed_by_role ?? 'system',
      reason: entry.reason,
      created_at: entry.created_at,
    }));
  }
  return booking;
}

const reasonSchema = (min) =>
  z
    .string('Alasan wajib diisi.')
    .trim()
    .min(min, `Alasan minimal ${min} karakter.`)
    .max(500, 'Alasan maksimal 500 karakter.');

const createSchema = z
  .object({
    service_id: z.uuid('service_id harus berupa UUID layanan.'),
    scheduled_date: z
      .string('Tanggal wajib diisi.')
      .regex(DATE_PATTERN, 'Tanggal berformat YYYY-MM-DD.')
      .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Tanggal tidak valid.'),
    start_time: z
      .string('Jam mulai wajib diisi.')
      .regex(TIME_PATTERN, 'Jam mulai berformat HH:mm.'),
    service_mode: z.enum(
      ['at_customer', 'at_provider'],
      'Mode layanan: at_customer atau at_provider.',
    ),
    quantity: z
      .number('Jumlah jam harus berupa angka.')
      .positive('Jumlah jam harus lebih dari 0.')
      .max(999, 'Jumlah jam terlalu besar.')
      .refine((value) => Number.isInteger(value * 2), 'Jumlah jam kelipatan 0,5.')
      .optional(),
    location_area: z.string().trim().min(3, 'Area lokasi minimal 3 karakter.').max(100).optional(),
    location_address: z
      .string()
      .trim()
      .min(5, 'Alamat minimal 5 karakter.')
      .max(500, 'Alamat maksimal 500 karakter.')
      .optional(),
    location_lat: z.number('Latitude harus berupa angka.').min(-90).max(90).optional(),
    location_lng: z.number('Longitude harus berupa angka.').min(-180).max(180).optional(),
    customer_note: z.string().trim().max(500, 'Catatan maksimal 500 karakter.').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.service_mode === 'at_customer') {
      for (const field of ['location_area', 'location_address']) {
        if (!data[field]) {
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: 'Wajib diisi untuk layanan di lokasi customer.',
          });
        }
      }
    }
    if ((data.location_lat === undefined) !== (data.location_lng === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['location_lat'],
        message: 'location_lat dan location_lng wajib dikirim bersamaan.',
      });
    }
  });

const listSchema = z.object({
  status: z
    .preprocess(
      (value) => (value === '' || value === undefined ? undefined : String(value).split(',')),
      z
        .array(z.enum(STATUSES, `Status tidak dikenal. Pilihan: ${STATUSES.join(', ')}.`))
        .optional(),
    )
    .optional(),
  page: z.coerce.number().int().min(1, 'Halaman minimal 1.').max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(50, 'Maksimal 50 per halaman.').optional(),
});

const idSchema = z.uuid();

function invalidTransition(current, action) {
  return new ApiError(
    409,
    'INVALID_TRANSITION',
    `Pesanan yang ${STATUS_LABELS[current]} tidak bisa ${action}.`,
  );
}

/** B1–B3 dan transisi status S1–S5 (BE-06). Auto-cancel 24 jam ada di BE-08. */
function createBookingsRouter({ bookings, users, now = () => new Date() }) {
  const router = express.Router();
  router.use(requireAuth, requireActiveUser({ users }));

  /** Booking yang boleh dilihat pemanggil beserta perannya di booking itu, atau 404. */
  async function loadForViewer(req) {
    const row = idSchema.safeParse(req.params.id).success
      ? await bookings.findById(req.params.id)
      : null;
    const viewer =
      row &&
      ((req.auth.role === 'admin' && 'admin') ||
        (req.auth.role === 'customer' && row.customer_id === req.auth.userId && 'customer') ||
        (req.auth.role === 'provider' && row.provider_user_id === req.auth.userId && 'provider'));
    // Booking milik orang lain dijawab 404, bukan 403 (API-07).
    if (!viewer) throw new ApiError(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.');
    return { row, viewer };
  }

  // B1 POST /bookings
  router.post('/', requireRole('customer'), async (req, res) => {
    const body = validate(createSchema, req.body);
    const service = await bookings.findBookableService(body.service_id);
    if (!service) throw new ApiError(404, 'NOT_FOUND', 'Layanan tidak ditemukan.');

    const fieldError = (field, message) =>
      new ApiError(400, 'VALIDATION_ERROR', 'Data yang dikirim belum valid.', [{ field, message }]);

    if (body.scheduled_date < todayInJakarta(now())) {
      throw fieldError('scheduled_date', 'Tanggal pesanan tidak boleh di masa lalu.');
    }
    if (service.service_mode !== 'both' && service.service_mode !== body.service_mode) {
      throw fieldError('service_mode', 'Mode layanan ini tidak tersedia untuk penyedia jasa ini.');
    }

    const slots = await bookings.listSlotsForDay(
      service.provider_id,
      dayOfWeek(body.scheduled_date),
    );
    const start = toMinutes(body.start_time);
    if (
      !slots.some((slot) => start >= toMinutes(slot.start_time) && start < toMinutes(slot.end_time))
    ) {
      throw fieldError('start_time', 'Jam yang dipilih berada di luar jam operasional penyedia.');
    }

    let quantity = 1;
    if (service.pricing_type === 'hourly') {
      if (body.quantity === undefined) throw fieldError('quantity', 'Jumlah jam wajib diisi.');
      if (service.min_hours && body.quantity < service.min_hours) {
        throw fieldError('quantity', `Minimal ${service.min_hours} jam untuk layanan ini.`);
      }
      quantity = body.quantity;
    }

    const atCustomer = body.service_mode === 'at_customer';
    const unitPrice = Number(service.price_amount);
    const booking = await bookings.create(
      {
        customerId: req.auth.userId,
        providerId: service.provider_id,
        serviceId: service.id,
        scheduledDate: body.scheduled_date,
        startTime: body.start_time,
        serviceMode: body.service_mode,
        locationArea: atCustomer ? body.location_area : null,
        locationAddress: atCustomer ? body.location_address : null,
        locationLat: atCustomer ? (body.location_lat ?? null) : null,
        locationLng: atCustomer ? (body.location_lng ?? null) : null,
        customerNote: body.customer_note || null,
        pricingType: service.pricing_type,
        unitPrice,
        quantity,
        estimatedTotal: Math.round(unitPrice * quantity),
      },
      { changedBy: req.auth.userId },
    );
    return sendSuccess(res, toBooking(booking, 'customer'), { status: 201 });
  });

  // B2 GET /bookings
  router.get('/', requireRole('customer', 'provider'), async (req, res) => {
    const query = validate(listSchema, req.query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const owner =
      req.auth.role === 'customer'
        ? { customerId: req.auth.userId }
        : { providerId: await bookings.findProviderProfileId(req.auth.userId) };
    if (owner.providerId === null) {
      return sendSuccess(res, [], { meta: { page, limit, total_items: 0, total_pages: 0 } });
    }

    const { items, total } = await bookings.list({ ...owner, statuses: query.status, page, limit });
    return sendSuccess(
      res,
      items.map((row) => toBooking(row, req.auth.role)),
      { meta: { page, limit, total_items: total, total_pages: Math.ceil(total / limit) } },
    );
  });

  // B3 GET /bookings/:id
  router.get('/:id', async (req, res) => {
    const { row, viewer } = await loadForViewer(req);
    return sendSuccess(res, toBooking(row, viewer));
  });

  /**
   * Mendaftarkan aksi status di PUT (issue #11) dan POST (api-contract.md bagian 8).
   * `handle` menerima { viewer, body } dan mengembalikan { to, decide } untuk transition().
   */
  function action(name, handle) {
    const handler = async (req, res) => {
      const { row, viewer } = await loadForViewer(req);
      if (viewer === 'admin') {
        throw new ApiError(403, 'FORBIDDEN', 'Admin tidak bisa mengubah status pesanan di sini.');
      }
      const { to, decide } = handle({ viewer, body: req.body ?? {}, row });
      const updated = await bookings.transition(row.id, {
        to,
        changedBy: req.auth.userId,
        decide,
      });
      return sendSuccess(res, toBooking(updated, viewer));
    };
    router.put(`/:id/${name}`, handler);
    router.post(`/:id/${name}`, handler);
  }

  const providerOnly = (viewer, what) => {
    if (viewer !== 'provider') {
      throw new ApiError(403, 'FORBIDDEN', `Hanya penyedia jasa yang bisa ${what} pesanan.`);
    }
  };
  const requireStatus = (current, allowed, what) => {
    if (!allowed.includes(current.status)) throw invalidTransition(current.status, what);
  };

  // S1 accept: requested → accepted
  action('accept', ({ viewer }) => {
    providerOnly(viewer, 'menerima');
    return {
      to: 'accepted',
      decide: (current) => {
        requireStatus(current, ['requested'], 'diterima');
        return {};
      },
    };
  });

  // S2 reject: requested → rejected, alasan wajib
  action('reject', ({ viewer, body }) => {
    providerOnly(viewer, 'menolak');
    const { reason } = validate(z.object({ reason: reasonSchema(10) }), body);
    return {
      to: 'rejected',
      decide: (current) => {
        requireStatus(current, ['requested'], 'ditolak');
        return { changes: { status_reason: reason }, reason };
      },
    };
  });

  // S3 start: accepted → in_progress, mulai paling cepat di tanggal jadwal (WIB)
  action('start', ({ viewer }) => {
    providerOnly(viewer, 'memulai');
    return {
      to: 'in_progress',
      decide: (current) => {
        requireStatus(current, ['accepted'], 'dimulai');
        if (todayInJakarta(now()) < dateOnly(current.scheduled_date)) {
          throw new ApiError(
            400,
            'VALIDATION_ERROR',
            'Pesanan baru bisa dimulai pada tanggal jadwalnya.',
          );
        }
        return {};
      },
    };
  });

  // S4 complete: in_progress → completed, total akhir menurut tipe harga
  action('complete', ({ viewer, body }) => {
    providerOnly(viewer, 'menyelesaikan');
    const input = validate(
      z.object({
        final_total: z.number('Total akhir harus berupa angka.').int().positive().optional(),
        actual_quantity: z
          .number('Jumlah jam aktual harus berupa angka.')
          .positive('Jumlah jam aktual harus lebih dari 0.')
          .max(999)
          .refine((value) => Number.isInteger(value * 2), 'Jumlah jam kelipatan 0,5.')
          .optional(),
      }),
      body,
    );
    return {
      to: 'completed',
      decide: (current) => {
        requireStatus(current, ['in_progress'], 'diselesaikan');
        const unitPrice = Number(current.unit_price_snapshot);
        const fieldError = (field, message) =>
          new ApiError(400, 'VALIDATION_ERROR', 'Data yang dikirim belum valid.', [
            { field, message },
          ]);
        if (current.pricing_type_snapshot === 'hourly') {
          if (input.actual_quantity === undefined) {
            throw fieldError(
              'actual_quantity',
              'Jumlah jam aktual wajib diisi untuk layanan per jam.',
            );
          }
          return {
            changes: {
              actual_quantity: input.actual_quantity,
              final_total: Math.round(unitPrice * input.actual_quantity),
            },
          };
        }
        if (current.pricing_type_snapshot === 'starting_from') {
          if (input.final_total === undefined) {
            throw fieldError('final_total', 'Total akhir wajib diisi untuk harga "mulai dari".');
          }
          if (input.final_total < unitPrice) {
            throw fieldError(
              'final_total',
              `Total akhir minimal ${unitPrice} (harga awal layanan).`,
            );
          }
          return { changes: { final_total: input.final_total } };
        }
        return { changes: { final_total: Number(current.estimated_total) } };
      },
    };
  });

  // S5 cancel: customer dari requested/accepted; provider hanya dari accepted dengan alasan
  action('cancel', ({ viewer, body }) => {
    const reason =
      viewer === 'provider'
        ? validate(z.object({ reason: reasonSchema(10) }), body).reason
        : validate(
            z.object({
              reason: reasonSchema(1)
                .optional()
                .or(z.literal('').transform(() => undefined)),
            }),
            body,
          ).reason;
    return {
      to: 'cancelled',
      decide: (current) => {
        requireStatus(
          current,
          viewer === 'provider' ? ['accepted'] : ['requested', 'accepted'],
          'dibatalkan',
        );
        return {
          changes: { cancelled_by: viewer, status_reason: reason ?? null },
          reason: reason ?? null,
        };
      },
    };
  });

  return router;
}

module.exports = { createBookingsRouter, shortName, todayInJakarta };
