// user_addresses: alamat tersimpan pelanggan (Akun Saya dan langkah Detail Pesanan).
// Titik peta (lat/lng) wajib karena alamat dipilih lewat pin. Paling banyak satu alamat
// utama per pengguna: dijaga di repository (src/repositories/addressRepository.js) dalam
// satu transaksi. Alamat ikut terhapus jika akunnya dihapus.

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE user_addresses (
      id           CHAR(36)      NOT NULL,
      user_id      CHAR(36)      NOT NULL,
      label        VARCHAR(30)   NOT NULL,
      address_text VARCHAR(300)  NOT NULL,
      detail       VARCHAR(120)  NULL,
      area         VARCHAR(100)  NULL,
      lat          DECIMAL(9, 6) NOT NULL,
      lng          DECIMAL(9, 6) NOT NULL,
      is_primary   BOOLEAN       NOT NULL DEFAULT FALSE,
      created_at   DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at   DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      KEY user_addresses_user_id_index (user_id, is_primary),
      CONSTRAINT user_addresses_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT user_addresses_label_check CHECK (CHAR_LENGTH(TRIM(label)) >= 2),
      CONSTRAINT user_addresses_text_check CHECK (CHAR_LENGTH(TRIM(address_text)) >= 10),
      CONSTRAINT user_addresses_lat_check CHECK (lat BETWEEN -90 AND 90),
      CONSTRAINT user_addresses_lng_check CHECK (lng BETWEEN -180 AND 180)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('user_addresses');
