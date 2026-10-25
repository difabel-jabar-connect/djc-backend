// portfolio_items: pajangan hasil kerja atau produk fisik. Tanpa harga/stok (OOS-04).

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE portfolio_items (
      id          CHAR(36)     NOT NULL,
      provider_id CHAR(36)     NOT NULL,
      title       VARCHAR(120) NOT NULL,
      description TEXT         NULL,
      item_type   ENUM('work_result', 'physical_product') NOT NULL,
      image_url   VARCHAR(500) NOT NULL,
      image_alt   VARCHAR(250) NOT NULL,
      sort_order  SMALLINT     NOT NULL DEFAULT 0,
      created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      KEY portfolio_items_provider_order_index (provider_id, sort_order),
      CONSTRAINT portfolio_items_provider_id_foreign
        FOREIGN KEY (provider_id) REFERENCES provider_profiles (id) ON DELETE CASCADE,
      CONSTRAINT portfolio_items_image_alt_check CHECK (CHAR_LENGTH(TRIM(image_alt)) > 0),
      CONSTRAINT portfolio_items_description_length_check
        CHECK (description IS NULL OR CHAR_LENGTH(description) <= 500)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('portfolio_items');
