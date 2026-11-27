// provider_payment_accounts: tujuan pembayaran milik penyedia jasa (rekening bank, e-wallet,
// atau gambar QRIS). Hanya ditampilkan ke pelanggan pemilik pesanan saat pesanannya
// diterima/berjalan (aturan buka-tutup di src/routes/bookings.js), tidak di profil publik.
// Ikut terhapus jika profil penyedia dihapus.

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE provider_payment_accounts (
      id             CHAR(36)     NOT NULL,
      provider_id    CHAR(36)     NOT NULL,
      type           ENUM('bank', 'ewallet', 'qris') NOT NULL,
      provider_name  VARCHAR(50)  NOT NULL,
      account_number VARCHAR(40)  NULL,
      account_holder VARCHAR(100) NULL,
      qris_image_url VARCHAR(500) NULL,
      created_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      KEY provider_payment_accounts_provider_index (provider_id, type),
      CONSTRAINT provider_payment_accounts_provider_id_foreign
        FOREIGN KEY (provider_id) REFERENCES provider_profiles (id) ON DELETE CASCADE,
      CONSTRAINT provider_payment_accounts_name_check
        CHECK (CHAR_LENGTH(TRIM(provider_name)) >= 2),
      CONSTRAINT provider_payment_accounts_fields_check CHECK (
        (type = 'qris' AND qris_image_url IS NOT NULL
          AND account_number IS NULL)
        OR (type <> 'qris' AND qris_image_url IS NULL
          AND account_number IS NOT NULL AND account_holder IS NOT NULL)
      )
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('provider_payment_accounts');
