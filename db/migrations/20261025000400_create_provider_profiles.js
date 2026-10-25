// provider_profiles: data khusus provider (alumni UPTD PPSGHD), 1 : 0..1 dengan users.
//
// Penyimpangan dari data-model.md (dicatat di PR, menunggu keputusan API-04):
// address_detail, lat, lng, public_lat, public_lng boleh NULL selama profil belum
// dilengkapi, karena pendaftaran provider hanya mengirim data akun dan nomor alumni.
// Profil tanpa lokasi tidak bisa berstatus `verified`, jadi tidak pernah tampil di publik.

exports.up = (knex) =>
  knex.raw(`
    CREATE TABLE provider_profiles (
      id                  CHAR(36)     NOT NULL,
      user_id             CHAR(36)     NOT NULL,
      display_name        VARCHAR(100) NOT NULL,
      photo_url           VARCHAR(500) NULL,
      photo_alt           VARCHAR(250) NULL,
      bio                 TEXT         NULL,
      communication_prefs JSON         NULL,
      disability_type     VARCHAR(50)  NULL,
      alumni_reg_no       VARCHAR(50)  NOT NULL,
      address_detail      TEXT         NULL,
      city                VARCHAR(50)  NOT NULL,
      district            VARCHAR(50)  NULL,
      lat                 DECIMAL(9,6) NULL,
      lng                 DECIMAL(9,6) NULL,
      public_lat          DECIMAL(9,6) NULL,
      public_lng          DECIMAL(9,6) NULL,
      service_radius_km   SMALLINT     NULL,
      verification_status ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
      verified_by         CHAR(36)     NULL,
      verified_at         DATETIME(6)  NULL,
      rating_avg          DECIMAL(2,1) NOT NULL DEFAULT 0.0,
      rating_count        INT          NOT NULL DEFAULT 0,
      created_at          DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at          DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      UNIQUE KEY provider_profiles_user_id_unique (user_id),
      KEY provider_profiles_status_city_index (verification_status, city),
      CONSTRAINT provider_profiles_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users (id),
      CONSTRAINT provider_profiles_verified_by_foreign
        FOREIGN KEY (verified_by) REFERENCES users (id),
      CONSTRAINT provider_profiles_photo_alt_check
        CHECK (photo_url IS NULL OR (photo_alt IS NOT NULL AND CHAR_LENGTH(TRIM(photo_alt)) > 0)),
      CONSTRAINT provider_profiles_bio_length_check
        CHECK (bio IS NULL OR CHAR_LENGTH(bio) <= 500),
      CONSTRAINT provider_profiles_lat_lng_pair_check
        CHECK ((lat IS NULL) = (lng IS NULL)),
      CONSTRAINT provider_profiles_public_coords_check
        CHECK ((public_lat IS NULL) = (lat IS NULL) AND (public_lng IS NULL) = (lng IS NULL)),
      CONSTRAINT provider_profiles_lat_range_check
        CHECK (lat IS NULL OR (lat BETWEEN -90 AND 90 AND public_lat BETWEEN -90 AND 90)),
      CONSTRAINT provider_profiles_lng_range_check
        CHECK (lng IS NULL OR (lng BETWEEN -180 AND 180 AND public_lng BETWEEN -180 AND 180)),
      CONSTRAINT provider_profiles_radius_check
        CHECK (service_radius_km IS NULL OR service_radius_km > 0),
      CONSTRAINT provider_profiles_verified_complete_check
        CHECK (verification_status <> 'verified' OR (address_detail IS NOT NULL AND lat IS NOT NULL)),
      CONSTRAINT provider_profiles_rating_avg_check
        CHECK (rating_avg BETWEEN 0 AND 5),
      CONSTRAINT provider_profiles_rating_count_check
        CHECK (rating_count >= 0)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci
  `);

exports.down = (knex) => knex.schema.dropTableIfExists('provider_profiles');
