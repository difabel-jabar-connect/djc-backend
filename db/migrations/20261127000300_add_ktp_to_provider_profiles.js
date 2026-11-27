// Foto KTP penyedia jasa untuk verifikasi admin (feedback revisi 2026-11-27).
// KTP adalah data pribadi: gambarnya diunggah ke Cloudinary sebagai `authenticated`
// (tidak bisa dibuka tanpa URL bertanda tangan), dan di sini hanya disimpan public_id-nya.
// URL bertanda tangan dibuat per permintaan admin (GET /admin/providers/:id/ktp) dan setiap
// akses dicatat di admin_actions sebagai `view_provider_ktp`.

const ACTIONS = [
  'verify_provider',
  'reject_provider',
  'hide_review',
  'unhide_review',
  'suspend_user',
  'activate_user',
  'create_category',
  'update_category',
  'create_provider',
];

const enumOf = (values) => `ENUM(${values.map((value) => `'${value}'`).join(', ')})`;

exports.up = async (knex) => {
  await knex.raw(`
    ALTER TABLE provider_profiles
      ADD COLUMN ktp_public_id   VARCHAR(255) NULL AFTER alumni_reg_no,
      ADD COLUMN ktp_uploaded_at DATETIME(6)  NULL AFTER ktp_public_id,
      ADD CONSTRAINT provider_profiles_ktp_pair_check
        CHECK ((ktp_public_id IS NULL) = (ktp_uploaded_at IS NULL))
  `);
  await knex.raw(
    `ALTER TABLE admin_actions MODIFY action ${enumOf([...ACTIONS, 'view_provider_ktp'])} NOT NULL`,
  );
};

// Gagal jika sudah ada baris `view_provider_ktp`; hapus baris itu dulu.
exports.down = async (knex) => {
  await knex.raw(`ALTER TABLE admin_actions MODIFY action ${enumOf(ACTIONS)} NOT NULL`);
  await knex.raw(`
    ALTER TABLE provider_profiles
      DROP CHECK provider_profiles_ktp_pair_check,
      DROP COLUMN ktp_uploaded_at,
      DROP COLUMN ktp_public_id
  `);
};
