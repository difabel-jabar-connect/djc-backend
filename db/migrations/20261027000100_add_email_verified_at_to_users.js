// users.email_verified_at: kapan kepemilikan email terbukti (daftar lewat Google atau
// reset kata sandi lewat tautan email). Login Google hanya untuk akun yang sudah terverifikasi,
// supaya akun yang didaftarkan orang lain memakai email kita tidak bisa diambil alih.

exports.up = (knex) =>
  knex.raw(`
    ALTER TABLE users
      ADD COLUMN email_verified_at DATETIME(6) NULL AFTER status
  `);

exports.down = (knex) => knex.raw('ALTER TABLE users DROP COLUMN email_verified_at');
