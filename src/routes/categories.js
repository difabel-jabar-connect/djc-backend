const express = require('express');
const { z } = require('zod');
const { requireAuth, requireRole, requireActiveUser } = require('../middlewares/auth');
const { ApiError, sendSuccess } = require('../utils/response');
const { validate } = require('../utils/validate');

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Servis Elektronik" → "servis-elektronik" (huruf beraksen jadi huruf biasa). */
function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

const fields = {
  name: z
    .string('Nama kategori wajib diisi.')
    .trim()
    .min(2, 'Nama kategori minimal 2 karakter.')
    .max(50, 'Nama kategori maksimal 50 karakter.'),
  slug: z
    .string('Slug harus berupa teks.')
    .trim()
    .toLowerCase()
    .max(60, 'Slug maksimal 60 karakter.')
    .regex(
      SLUG_PATTERN,
      'Slug hanya boleh huruf kecil, angka, dan tanda hubung, mis. servis-elektronik.',
    ),
  icon: z.string('Ikon harus berupa teks.').trim().max(50, 'Ikon maksimal 50 karakter.').nullable(),
  sort_order: z
    .number('Urutan harus berupa angka.')
    .int('Urutan harus bilangan bulat.')
    .min(0, 'Urutan minimal 0.')
    .max(32767, 'Urutan maksimal 32767.'),
  is_active: z.boolean('is_active harus true atau false.'),
};

const createSchema = z.object({
  name: fields.name,
  slug: fields.slug.optional(),
  icon: fields.icon.optional(),
  sort_order: fields.sort_order.optional(),
  is_active: fields.is_active.optional(),
});

const updateSchema = z
  .object({
    name: fields.name.optional(),
    slug: fields.slug.optional(),
    icon: fields.icon.optional(),
    sort_order: fields.sort_order.optional(),
    is_active: fields.is_active.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Kirim minimal satu field yang ingin diubah.',
  });

const idSchema = z.uuid();

function conflict() {
  return new ApiError(409, 'CONFLICT', 'Kategori dengan nama atau slug ini sudah ada.');
}

// Duplikat yang lolos pengecekan awal (dua request bersamaan) ditangkap dari index unik slug.
async function guardDuplicate(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw conflict();
    throw error;
  }
}

/** C1 GET /categories (publik). */
function createCategoriesRouter({ categories }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const list = await categories.listActive();
    return sendSuccess(
      res,
      list.map(({ id, name, slug, icon, sort_order: sortOrder }) => ({
        id,
        name,
        slug,
        icon,
        sort_order: sortOrder,
      })),
    );
  });

  return router;
}

/** POST /admin/categories dan PUT /admin/categories/:id (khusus admin, SP1-06). */
function createAdminCategoriesRouter({ categories, users }) {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'), requireActiveUser({ users }));

  router.post('/', async (req, res) => {
    const body = validate(createSchema, req.body);
    const slug = body.slug ?? slugify(body.name);
    if (!slug) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Data yang dikirim belum valid.', [
        { field: 'slug', message: 'Slug tidak bisa dibuat dari nama ini. Isi slug secara manual.' },
      ]);
    }
    if (await categories.findConflict({ name: body.name, slug })) throw conflict();

    const category = await guardDuplicate(() =>
      categories.create(
        {
          name: body.name,
          slug,
          icon: body.icon ?? null,
          sortOrder: body.sort_order ?? 0,
          isActive: body.is_active ?? true,
        },
        { adminId: req.auth.userId },
      ),
    );
    return sendSuccess(res, category, { status: 201 });
  });

  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const body = validate(updateSchema, req.body);

    // ID yang bukan UUID pasti tidak ada, jadi langsung 404 tanpa query.
    const current = idSchema.safeParse(id).success ? await categories.findById(id) : null;
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Kategori tidak ditemukan.');

    const name = body.name ?? current.name;
    const slug = body.slug ?? current.slug;
    if (
      (body.name !== undefined || body.slug !== undefined) &&
      (await categories.findConflict({ name, slug, excludeId: id }))
    ) {
      throw conflict();
    }

    const changes = {};
    if (body.name !== undefined) changes.name = body.name;
    if (body.slug !== undefined) changes.slug = body.slug;
    if (body.icon !== undefined) changes.icon = body.icon;
    if (body.sort_order !== undefined) changes.sortOrder = body.sort_order;
    if (body.is_active !== undefined) changes.isActive = body.is_active;

    const category = await guardDuplicate(() =>
      categories.update(id, changes, { adminId: req.auth.userId }),
    );
    return sendSuccess(res, category);
  });

  return router;
}

module.exports = { createCategoriesRouter, createAdminCategoriesRouter, slugify };
