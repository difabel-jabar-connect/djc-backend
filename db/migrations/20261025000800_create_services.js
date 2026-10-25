// services: layanan yang ditawarkan provider. Satu layanan satu kategori.
// UNIQUE (id, provider_id) dipakai FK komposit dari bookings supaya
// bookings.provider_id selalu sama dengan provider pemilik service.

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE services (
      id                    CHAR(36)     NOT NULL,
      provider_id           CHAR(36)     NOT NULL,
      category_id           CHAR(36)     NOT NULL,
      title                 VARCHAR(120) NOT NULL,
      description           TEXT         NULL,
      pricing_type          ENUM('fixed', 'starting_from', 'hourly') NOT NULL,
      price_amount          BIGINT       NOT NULL,
      min_hours             SMALLINT     NULL,
      duration_estimate_min SMALLINT     NULL,
      service_mode          ENUM('at_customer', 'at_provider', 'both') NOT NULL,
      is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
      created_at            DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at            DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY services_id_provider_unique (id, provider_id),
      KEY services_provider_active_index (provider_id, is_active),
      KEY services_category_active_index (category_id, is_active),
      CONSTRAINT services_provider_id_foreign
        FOREIGN KEY (provider_id) REFERENCES provider_profiles (id),
      CONSTRAINT services_category_id_foreign
        FOREIGN KEY (category_id) REFERENCES categories (id),
      CONSTRAINT services_price_amount_check CHECK (price_amount > 0),
      CONSTRAINT services_min_hours_check CHECK (
        (pricing_type = 'hourly' AND min_hours IS NOT NULL AND min_hours > 0)
        OR (pricing_type <> 'hourly' AND min_hours IS NULL)
      ),
      CONSTRAINT services_duration_check
        CHECK (duration_estimate_min IS NULL OR duration_estimate_min > 0)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('services');
