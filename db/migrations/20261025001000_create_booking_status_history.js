// booking_status_history: satu baris per transisi status, append-only.
// from_status NULL = booking baru dibuat; changed_by NULL = sistem (auto-cancel, suspend).

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE booking_status_history (
      id          CHAR(36)    NOT NULL,
      booking_id  CHAR(36)    NOT NULL,
      from_status ENUM('requested', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled') NULL,
      to_status   ENUM('requested', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled') NOT NULL,
      changed_by  CHAR(36)    NULL,
      reason      TEXT        NULL,
      created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      KEY booking_status_history_booking_created_index (booking_id, created_at),
      CONSTRAINT booking_status_history_booking_id_foreign
        FOREIGN KEY (booking_id) REFERENCES bookings (id),
      CONSTRAINT booking_status_history_changed_by_foreign
        FOREIGN KEY (changed_by) REFERENCES users (id),
      CONSTRAINT booking_status_history_transition_check
        CHECK (from_status IS NULL OR from_status <> to_status)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('booking_status_history');
