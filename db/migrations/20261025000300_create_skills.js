// skills: nama keterampilan yang dipakai ulang oleh banyak provider (filter keterampilan).

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE skills (
      id   CHAR(36)    NOT NULL,
      name VARCHAR(60) NOT NULL,
      slug VARCHAR(60) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY skills_name_unique (name),
      UNIQUE KEY skills_slug_unique (slug)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('skills');
