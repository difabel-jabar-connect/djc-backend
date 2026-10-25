// admin_actions: jejak audit aksi admin, append-only. target_type + target_id
// polimorfik tanpa FK fisik.
//
// Tambahan dari data-model.md: `create_category` (FR-ADM-03 meminta admin bisa
// menambah kategori, enum asli hanya punya update_category).

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE admin_actions (
      id          CHAR(36)    NOT NULL,
      admin_id    CHAR(36)    NOT NULL,
      action      ENUM(
                    'verify_provider', 'reject_provider', 'hide_review', 'unhide_review',
                    'suspend_user', 'activate_user', 'create_category', 'update_category'
                  ) NOT NULL,
      target_type ENUM('user', 'provider_profile', 'review', 'category') NOT NULL,
      target_id   CHAR(36)    NOT NULL,
      note        TEXT        NULL,
      created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      KEY admin_actions_target_index (target_type, target_id, created_at),
      KEY admin_actions_admin_created_index (admin_id, created_at),
      CONSTRAINT admin_actions_admin_id_foreign
        FOREIGN KEY (admin_id) REFERENCES users (id),
      CONSTRAINT admin_actions_note_check CHECK (
        action NOT IN ('reject_provider', 'hide_review')
        OR (note IS NOT NULL AND CHAR_LENGTH(TRIM(note)) > 0)
      )
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('admin_actions');
