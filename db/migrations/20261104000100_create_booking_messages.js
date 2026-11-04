// booking_messages: chat customer ↔ provider per booking (BE-10, issue #32).
// Disesuaikan dengan skema yang ada: id UUID CHAR(36) dan waktu DATETIME(6) UTC
// (issue memakai INT dan TIMESTAMP). sender_id NULL = pesan sistem.
// Pesan ikut terhapus jika booking-nya dihapus (ON DELETE CASCADE, sesuai issue).

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE booking_messages (
      id           CHAR(36)      NOT NULL,
      booking_id   CHAR(36)      NOT NULL,
      sender_id    CHAR(36)      NULL,
      sender_role  ENUM('customer', 'provider', 'system') NOT NULL,
      message_text VARCHAR(1000) NOT NULL,
      is_read      BOOLEAN       NOT NULL DEFAULT FALSE,
      read_at      DATETIME(6)   NULL,
      created_at   DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      KEY booking_messages_booking_created_index (booking_id, created_at),
      KEY booking_messages_sender_id_index (sender_id),
      CONSTRAINT booking_messages_booking_id_foreign
        FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
      CONSTRAINT booking_messages_sender_id_foreign
        FOREIGN KEY (sender_id) REFERENCES users (id),
      CONSTRAINT booking_messages_text_check CHECK (CHAR_LENGTH(TRIM(message_text)) > 0),
      CONSTRAINT booking_messages_sender_check
        CHECK ((sender_role = 'system') = (sender_id IS NULL)),
      CONSTRAINT booking_messages_read_check CHECK (is_read = (read_at IS NOT NULL))
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('booking_messages');
