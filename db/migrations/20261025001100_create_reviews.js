// reviews: maksimal satu review per booking `completed` (status dicek API).
// FK komposit (booking_id, customer_id, provider_id) memastikan atribusi review
// selalu sama dengan booking-nya. Review tersembunyi tidak dihitung di rating_avg.

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE reviews (
      id            CHAR(36)    NOT NULL,
      booking_id    CHAR(36)    NOT NULL,
      customer_id   CHAR(36)    NOT NULL,
      provider_id   CHAR(36)    NOT NULL,
      rating        SMALLINT    NOT NULL,
      comment       TEXT        NULL,
      is_hidden     BOOLEAN     NOT NULL DEFAULT FALSE,
      hidden_by     CHAR(36)    NULL,
      hidden_reason TEXT        NULL,
      created_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY reviews_booking_id_unique (booking_id),
      KEY reviews_provider_visible_index (provider_id, is_hidden, created_at),
      KEY reviews_customer_id_index (customer_id),
      CONSTRAINT reviews_booking_foreign
        FOREIGN KEY (booking_id, customer_id, provider_id)
        REFERENCES bookings (id, customer_id, provider_id),
      CONSTRAINT reviews_customer_id_foreign
        FOREIGN KEY (customer_id) REFERENCES users (id),
      CONSTRAINT reviews_provider_id_foreign
        FOREIGN KEY (provider_id) REFERENCES provider_profiles (id),
      CONSTRAINT reviews_hidden_by_foreign
        FOREIGN KEY (hidden_by) REFERENCES users (id),
      CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
      CONSTRAINT reviews_comment_length_check
        CHECK (comment IS NULL OR CHAR_LENGTH(comment) <= 1000),
      CONSTRAINT reviews_hidden_reason_check
        CHECK (is_hidden = FALSE OR hidden_reason IS NOT NULL)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('reviews');
