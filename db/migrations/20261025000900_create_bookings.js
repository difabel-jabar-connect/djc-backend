// bookings: titik temu customer, service, dan provider. Lifecycle 6 status:
// requested -> accepted -> in_progress -> completed, ditambah rejected dan cancelled.
// Transisi status ditegakkan API; tabel ini menjaga invariant yang tidak boleh dilanggar.
//
// - FK komposit (service_id, provider_id) memastikan provider_id = services.provider_id.
// - UNIQUE (id, customer_id, provider_id) menjadi target FK komposit dari reviews.
// - INDEX (status, created_at) untuk auto-cancel `requested` setelah 24 jam (DEC-TIMEOUT).

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE bookings (
      id                    CHAR(36)     NOT NULL,
      code                  VARCHAR(20)  NOT NULL,
      customer_id           CHAR(36)     NOT NULL,
      provider_id           CHAR(36)     NOT NULL,
      service_id            CHAR(36)     NOT NULL,
      scheduled_date        DATE         NOT NULL,
      start_time            TIME         NOT NULL,
      service_mode          ENUM('at_customer', 'at_provider') NOT NULL,
      location_area         VARCHAR(100) NULL,
      location_address      TEXT         NULL,
      location_lat          DECIMAL(9,6) NULL,
      location_lng          DECIMAL(9,6) NULL,
      customer_note         TEXT         NULL,
      pricing_type_snapshot ENUM('fixed', 'starting_from', 'hourly') NOT NULL,
      unit_price_snapshot   BIGINT       NOT NULL,
      quantity              DECIMAL(4,1) NOT NULL,
      estimated_total       BIGINT       NOT NULL,
      actual_quantity       DECIMAL(4,1) NULL,
      final_total           BIGINT       NULL,
      status                ENUM('requested', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled')
                            NOT NULL DEFAULT 'requested',
      cancelled_by          ENUM('customer', 'provider', 'admin', 'system') NULL,
      status_reason         TEXT         NULL,
      created_at            DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at            DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY bookings_code_unique (code),
      UNIQUE KEY bookings_id_customer_provider_unique (id, customer_id, provider_id),
      KEY bookings_status_created_index (status, created_at),
      KEY bookings_customer_status_index (customer_id, status),
      KEY bookings_provider_status_index (provider_id, status),
      KEY bookings_service_provider_index (service_id, provider_id),
      CONSTRAINT bookings_customer_id_foreign
        FOREIGN KEY (customer_id) REFERENCES users (id),
      CONSTRAINT bookings_provider_id_foreign
        FOREIGN KEY (provider_id) REFERENCES provider_profiles (id),
      CONSTRAINT bookings_service_provider_foreign
        FOREIGN KEY (service_id, provider_id) REFERENCES services (id, provider_id),
      CONSTRAINT bookings_location_check CHECK (
        (service_mode = 'at_customer' AND location_area IS NOT NULL AND location_address IS NOT NULL)
        OR (service_mode = 'at_provider' AND location_area IS NULL AND location_address IS NULL
            AND location_lat IS NULL AND location_lng IS NULL)
      ),
      CONSTRAINT bookings_location_pair_check
        CHECK ((location_lat IS NULL) = (location_lng IS NULL)),
      CONSTRAINT bookings_customer_note_length_check
        CHECK (customer_note IS NULL OR CHAR_LENGTH(customer_note) <= 500),
      CONSTRAINT bookings_unit_price_check CHECK (unit_price_snapshot > 0),
      CONSTRAINT bookings_quantity_check CHECK (
        quantity > 0 AND (pricing_type_snapshot = 'hourly' OR quantity = 1)
      ),
      CONSTRAINT bookings_estimated_total_check CHECK (estimated_total > 0),
      CONSTRAINT bookings_actual_quantity_check CHECK (
        actual_quantity IS NULL OR (pricing_type_snapshot = 'hourly' AND actual_quantity > 0)
      ),
      CONSTRAINT bookings_completed_totals_check CHECK (
        status <> 'completed'
        OR (final_total IS NOT NULL AND (pricing_type_snapshot <> 'hourly' OR actual_quantity IS NOT NULL))
      ),
      CONSTRAINT bookings_final_total_check CHECK (
        final_total IS NULL
        OR (final_total > 0 AND (pricing_type_snapshot <> 'starting_from' OR final_total >= unit_price_snapshot))
      ),
      CONSTRAINT bookings_cancelled_by_check CHECK (
        (status = 'cancelled' AND cancelled_by IS NOT NULL)
        OR (status <> 'cancelled' AND cancelled_by IS NULL)
      ),
      CONSTRAINT bookings_status_reason_check CHECK (
        status_reason IS NOT NULL
        OR NOT (status = 'rejected' OR (status = 'cancelled' AND cancelled_by IN ('provider', 'admin', 'system')))
      )
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('bookings');
