// provider_skills: penghubung provider dan keterampilan; pasangan (provider_id, skill_id) unik.

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE provider_skills (
      provider_id CHAR(36) NOT NULL,
      skill_id    CHAR(36) NOT NULL,
      PRIMARY KEY (provider_id, skill_id),
      KEY provider_skills_skill_id_index (skill_id),
      CONSTRAINT provider_skills_provider_id_foreign
        FOREIGN KEY (provider_id) REFERENCES provider_profiles (id) ON DELETE CASCADE,
      CONSTRAINT provider_skills_skill_id_foreign
        FOREIGN KEY (skill_id) REFERENCES skills (id) ON DELETE CASCADE
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('provider_skills');
