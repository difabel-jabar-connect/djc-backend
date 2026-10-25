// provider_availability: slot mingguan provider (0 = Minggu). Libur/cuti belum dimodelkan.

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE provider_availability (
      id          CHAR(36) NOT NULL,
      provider_id CHAR(36) NOT NULL,
      day_of_week SMALLINT NOT NULL,
      start_time  TIME     NOT NULL,
      end_time    TIME     NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY provider_availability_slot_unique (provider_id, day_of_week, start_time),
      CONSTRAINT provider_availability_provider_id_foreign
        FOREIGN KEY (provider_id) REFERENCES provider_profiles (id) ON DELETE CASCADE,
      CONSTRAINT provider_availability_day_check CHECK (day_of_week BETWEEN 0 AND 6),
      CONSTRAINT provider_availability_time_check CHECK (end_time > start_time)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('provider_availability');
