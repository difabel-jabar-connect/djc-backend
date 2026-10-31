const express = require('express');
const { z } = require('zod');
const { ApiError, sendSuccess } = require('../utils/response');
const { validate } = require('../utils/validate');

const SORTS = ['newest', 'price_asc', 'price_desc', 'rating_desc'];
const MAX_LIMIT = 50;

// Query string selalu berupa teks; kosong ("?city=") dianggap tidak diisi.
const blankToUndefined = (value) => (value === '' ? undefined : value);
const optional = (schema) => z.preprocess(blankToUndefined, schema.optional());
const integer = (label, min, max) =>
  z.coerce
    .number(`${label} harus berupa angka.`)
    .int(`${label} harus bilangan bulat.`)
    .min(min, `${label} minimal ${min}.`)
    .max(max, `${label} maksimal ${max}.`);

const searchSchema = z
  .object({
    q: optional(z.string().trim().max(100, 'Kata kunci maksimal 100 karakter.')),
    category_id: optional(z.uuid('category_id harus berupa UUID kategori.')),
    category: optional(z.string().trim().max(60, 'Slug kategori maksimal 60 karakter.')),
    city: optional(z.string().trim().max(50, 'Kota maksimal 50 karakter.')),
    min_price: optional(integer('Harga minimum', 0, 1_000_000_000)),
    max_price: optional(integer('Harga maksimum', 0, 1_000_000_000)),
    min_rating: optional(
      z.coerce
        .number('Rating minimum harus berupa angka.')
        .min(0, 'Rating minimum 0–5.')
        .max(5, 'Rating minimum 0–5.'),
    ),
    day_of_week: optional(integer('Hari', 0, 6)),
    sort: optional(z.enum(SORTS, `Urutan harus salah satu dari: ${SORTS.join(', ')}.`)),
    page: optional(integer('Halaman', 1, 10_000)),
    limit: optional(integer('Jumlah per halaman', 1, MAX_LIMIT)),
  })
  .superRefine((data, ctx) => {
    if (
      data.min_price !== undefined &&
      data.max_price !== undefined &&
      data.min_price > data.max_price
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['min_price'],
        message: 'Harga minimum tidak boleh lebih besar dari harga maksimum.',
      });
    }
  });

const idSchema = z.uuid();

/** BE-05: GET /services (pencarian publik) dan GET /services/:id. */
function createServicesRouter({ services }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const query = validate(searchSchema, req.query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;

    const { items, total } = await services.search({
      q: query.q || undefined,
      categoryId: query.category_id,
      category: query.category || undefined,
      city: query.city || undefined,
      minPrice: query.min_price,
      maxPrice: query.max_price,
      minRating: query.min_rating,
      dayOfWeek: query.day_of_week,
      sort: query.sort ?? 'newest',
      page,
      limit,
    });

    return sendSuccess(res, items, {
      meta: {
        page,
        limit,
        total_items: total,
        total_pages: Math.ceil(total / limit),
      },
    });
  });

  router.get('/:id', async (req, res) => {
    const service = idSchema.safeParse(req.params.id).success
      ? await services.findPublicById(req.params.id)
      : null;
    if (!service) throw new ApiError(404, 'NOT_FOUND', 'Layanan tidak ditemukan.');
    return sendSuccess(res, service);
  });

  return router;
}

module.exports = { createServicesRouter, MAX_LIMIT };
