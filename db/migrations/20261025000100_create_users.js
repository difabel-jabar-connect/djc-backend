// users: satu tabel untuk tiga peran (customer, provider, admin), satu akun satu peran.
// Spesifikasi: docs/technical/data-model.md bagian "users".

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE users (
      id            CHAR(36)     NOT NULL,
      role          ENUM('customer', 'provider', 'admin') NOT NULL,
      full_name     VARCHAR(100) NOT NULL,
      email         VARCHAR(255) NOT NULL,
      phone         VARCHAR(20)  NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      status        ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
      created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY users_email_unique (email),
      KEY users_role_status_index (role, status),
      CONSTRAINT users_full_name_check CHECK (CHAR_LENGTH(TRIM(full_name)) >= 2)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('users');
