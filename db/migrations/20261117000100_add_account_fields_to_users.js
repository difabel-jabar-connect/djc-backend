// Halaman Akun Saya: foto profil pengguna dan penanda akun yang punya kata sandi sendiri.
// Akun yang dibuat lewat Google diberi hash acak (has_password = FALSE) sampai pemiliknya
// membuat kata sandi lewat Lupa Kata Sandi; ganti kata sandi hanya untuk has_password = TRUE.
// Akun Google lama tetap TRUE: pemiliknya bisa memakai Lupa Kata Sandi bila lupa.

exports.up = (knex) =>
  knex.raw(`
    ALTER TABLE users
      ADD COLUMN avatar_url   VARCHAR(500) NULL AFTER phone,
      ADD COLUMN has_password BOOLEAN      NOT NULL DEFAULT TRUE AFTER password_hash
  `);

exports.down = (knex) =>
  knex.raw('ALTER TABLE users DROP COLUMN avatar_url, DROP COLUMN has_password');
