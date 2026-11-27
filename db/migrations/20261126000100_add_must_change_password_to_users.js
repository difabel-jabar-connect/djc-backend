// Kata sandi awal mitra ditentukan admin (API-04), jadi wajib diganti pemiliknya saat
// pertama masuk (QA-02 R-10). Penanda dihapus setelah ganti atau reset kata sandi.

exports.up = (knex) =>
  knex.raw(`
    ALTER TABLE users
      ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE AFTER has_password
  `);

exports.down = (knex) => knex.raw('ALTER TABLE users DROP COLUMN must_change_password');
