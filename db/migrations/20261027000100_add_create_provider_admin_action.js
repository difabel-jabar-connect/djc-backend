// admin_actions: tambah aksi `create_provider` untuk akun mitra yang dibuat admin
// (keputusan API-04: mitra tidak mendaftar sendiri). Hanya menambah nilai enum.

const ACTIONS = [
  'verify_provider',
  'reject_provider',
  'hide_review',
  'unhide_review',
  'suspend_user',
  'activate_user',
  'create_category',
  'update_category',
];

const enumOf = (values) => `ENUM(${values.map((value) => `'${value}'`).join(', ')})`;

exports.up = (knex) =>
  knex.raw(
    `ALTER TABLE admin_actions MODIFY action ${enumOf([...ACTIONS, 'create_provider'])} NOT NULL`,
  );

// Gagal jika sudah ada baris `create_provider`; hapus atau ubah baris itu dulu.
exports.down = (knex) =>
  knex.raw(`ALTER TABLE admin_actions MODIFY action ${enumOf(ACTIONS)} NOT NULL`);
