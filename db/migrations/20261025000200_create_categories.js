// categories: kategori layanan yang dikelola admin. Kategori nonaktif disembunyikan dari publik.

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE categories (
      id         CHAR(36)    NOT NULL,
      name       VARCHAR(50) NOT NULL,
      slug       VARCHAR(60) NOT NULL,
      icon       VARCHAR(50) NULL,
      sort_order SMALLINT    NOT NULL DEFAULT 0,
      is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
      PRIMARY KEY (id),
      UNIQUE KEY categories_slug_unique (slug),
      KEY categories_active_order_index (is_active, sort_order)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('categories');
