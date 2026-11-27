// Pembayaran langsung ke penyedia jasa tanpa payment gateway (feedback revisi 2026-11-27):
// - `cod`      : bayar tunai di tempat;
// - `transfer` : transfer ke rekening bank / e-wallet penyedia;
// - `qris`     : scan QRIS milik penyedia.
// Uang tidak lewat aplikasi, jadi aplikasi hanya mencatat metode dan status lunas. Penyedia
// yang menandai lunas (POST /bookings/:id/confirm-payment), paid_at terisi saat itu.

exports.up = (knex) =>
  knex.raw(`
    ALTER TABLE bookings
      ADD COLUMN payment_method ENUM('cod', 'transfer', 'qris') NOT NULL DEFAULT 'cod'
        AFTER final_total,
      ADD COLUMN payment_status ENUM('unpaid', 'paid') NOT NULL DEFAULT 'unpaid'
        AFTER payment_method,
      ADD COLUMN paid_at DATETIME(6) NULL AFTER payment_status,
      ADD CONSTRAINT bookings_paid_at_check
        CHECK ((payment_status = 'paid') = (paid_at IS NOT NULL))
  `);

exports.down = (knex) =>
  knex.raw(`
    ALTER TABLE bookings
      DROP CHECK bookings_paid_at_check,
      DROP COLUMN paid_at,
      DROP COLUMN payment_status,
      DROP COLUMN payment_method
  `);
