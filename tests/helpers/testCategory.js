// Kategori milik satu test DB, supaya test tidak bergantung pada data seeder dan tetap
// lulus di database yang baru di-migrate (mis. CI). Dihapus lagi di t.after.
const { randomUUID } = require('node:crypto');

async function createTestCategory(knex, suffix) {
  const category = {
    id: randomUUID(),
    name: `Uji Kategori ${suffix}`,
    slug: `uji-kategori-${suffix}`,
    is_active: true,
  };
  await knex('categories').insert(category);
  return category;
}

/** Dipanggil setelah layanan yang memakai kategori ini dihapus. */
function deleteTestCategory(knex, suffix) {
  return knex('categories')
    .where({ slug: `uji-kategori-${suffix}` })
    .del();
}

module.exports = { createTestCategory, deleteTestCategory };
