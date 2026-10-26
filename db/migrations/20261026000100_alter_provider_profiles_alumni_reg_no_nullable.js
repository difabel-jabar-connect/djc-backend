// provider_profiles.alumni_reg_no boleh NULL selama provider belum diverifikasi.
//
// Form Daftar Mitra di frontend belum punya isian nomor alumni, jadi provider bisa
// mendaftar tanpa nomor itu dan melengkapinya lewat profil (SP1-07). Admin tidak bisa
// memverifikasi provider yang belum punya nomor alumni (CHECK di bawah).
// Penyimpangan dari data-model.md (alumni_reg_no NOT NULL); dicatat di PR.

exports.up = async (knex) => {
  await knex.raw('ALTER TABLE provider_profiles MODIFY alumni_reg_no VARCHAR(50) NULL');
  await knex.raw(`
    ALTER TABLE provider_profiles
      ADD CONSTRAINT provider_profiles_alumni_before_verified_check
        CHECK (verification_status <> 'verified' OR alumni_reg_no IS NOT NULL)
  `);
};

// Gagal jika masih ada provider dengan alumni_reg_no NULL; lengkapi datanya dulu.
exports.down = async (knex) => {
  await knex.raw(
    'ALTER TABLE provider_profiles DROP CHECK provider_profiles_alumni_before_verified_check',
  );
  await knex.raw('ALTER TABLE provider_profiles MODIFY alumni_reg_no VARCHAR(50) NOT NULL');
};
