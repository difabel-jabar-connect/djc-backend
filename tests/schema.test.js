// Tes skema MySQL sungguhan: migrasi lalu cek constraint penting dari data-model.
// Hanya jalan jika DB_TEST=1. Data uji ditulis di dalam transaksi lalu di-rollback.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const skip = process.env.DB_TEST !== '1';

test('skema 12 tabel dan constraint utama', { skip }, async (t) => {
  const knex = require('knex')(require('../knexfile'));
  t.after(() => knex.destroy());

  await knex.migrate.latest();

  const [tables] = await knex.raw(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME NOT LIKE 'knex_%'`,
  );
  assert.deepEqual(tables.map((row) => row.name).sort(), [
    'admin_actions',
    'booking_status_history',
    'bookings',
    'categories',
    'portfolio_items',
    'provider_availability',
    'provider_profiles',
    'provider_skills',
    'reviews',
    'services',
    'skills',
    'users',
  ]);

  // Setiap kasus berjalan di transaksinya sendiri dan selalu di-rollback.
  async function inTransaction(fn) {
    const trx = await knex.transaction();
    try {
      return await fn(trx);
    } finally {
      await trx.rollback();
    }
  }

  async function insertBase(trx) {
    const ids = {
      customer: randomUUID(),
      providerUser: randomUUID(),
      otherProviderUser: randomUUID(),
      provider: randomUUID(),
      otherProvider: randomUUID(),
      category: randomUUID(),
      service: randomUUID(),
      booking: randomUUID(),
    };
    const user = (id, role) => ({
      id,
      role,
      full_name: `Tes ${role}`,
      email: `${id}@contoh.test`,
      phone: '+6281200000000',
      password_hash: 'x',
    });
    await trx('users').insert([
      user(ids.customer, 'customer'),
      user(ids.providerUser, 'provider'),
      user(ids.otherProviderUser, 'provider'),
    ]);
    const profile = (id, userId) => ({
      id,
      user_id: userId,
      display_name: 'Provider Tes',
      alumni_reg_no: 'ALM-TES',
      city: 'Kota Bandung',
    });
    await trx('provider_profiles').insert([
      profile(ids.provider, ids.providerUser),
      profile(ids.otherProvider, ids.otherProviderUser),
    ]);
    await trx('categories').insert({ id: ids.category, name: 'Tes', slug: `tes-${ids.category}` });
    await trx('services').insert({
      id: ids.service,
      provider_id: ids.provider,
      category_id: ids.category,
      title: 'Layanan tes',
      pricing_type: 'fixed',
      price_amount: 50000,
      service_mode: 'at_provider',
    });
    return ids;
  }

  function booking(ids, overrides = {}) {
    return {
      id: ids.booking,
      code: `DJC-T${ids.booking.slice(0, 6)}`,
      customer_id: ids.customer,
      provider_id: ids.provider,
      service_id: ids.service,
      scheduled_date: '2026-11-02',
      start_time: '09:00',
      service_mode: 'at_provider',
      pricing_type_snapshot: 'fixed',
      unit_price_snapshot: 50000,
      quantity: 1,
      estimated_total: 50000,
      ...overrides,
    };
  }

  await t.test('booking valid tersimpan dengan status requested', () =>
    inTransaction(async (trx) => {
      const ids = await insertBase(trx);
      await trx('bookings').insert(booking(ids));
      const row = await trx('bookings').where({ id: ids.booking }).first();
      assert.equal(row.status, 'requested');
    }),
  );

  await t.test('price_amount harus > 0', () =>
    inTransaction(async (trx) => {
      const ids = await insertBase(trx);
      await assert.rejects(
        trx('services').where({ id: ids.service }).update({ price_amount: 0 }),
        /services_price_amount_check/,
      );
    }),
  );

  await t.test('min_hours wajib untuk hourly', () =>
    inTransaction(async (trx) => {
      const ids = await insertBase(trx);
      await assert.rejects(
        trx('services').where({ id: ids.service }).update({ pricing_type: 'hourly' }),
        /services_min_hours_check/,
      );
    }),
  );

  await t.test('provider_id booking harus sama dengan pemilik service', () =>
    inTransaction(async (trx) => {
      const ids = await insertBase(trx);
      await assert.rejects(
        trx('bookings').insert(booking(ids, { provider_id: ids.otherProvider })),
        /bookings_service_provider_foreign/,
      );
    }),
  );

  await t.test('booking at_customer wajib punya alamat', () =>
    inTransaction(async (trx) => {
      const ids = await insertBase(trx);
      await assert.rejects(
        trx('bookings').insert(booking(ids, { service_mode: 'at_customer' })),
        /bookings_location_check/,
      );
    }),
  );

  await t.test('completed wajib final_total', () =>
    inTransaction(async (trx) => {
      const ids = await insertBase(trx);
      await assert.rejects(
        trx('bookings').insert(booking(ids, { status: 'completed' })),
        /bookings_completed_totals_check/,
      );
    }),
  );

  await t.test('rejected wajib status_reason', () =>
    inTransaction(async (trx) => {
      const ids = await insertBase(trx);
      await assert.rejects(
        trx('bookings').insert(booking(ids, { status: 'rejected' })),
        /bookings_status_reason_check/,
      );
    }),
  );

  await t.test('rating review 1 sampai 5', () =>
    inTransaction(async (trx) => {
      const ids = await insertBase(trx);
      await trx('bookings').insert(booking(ids, { status: 'completed', final_total: 50000 }));
      await assert.rejects(
        trx('reviews').insert({
          id: randomUUID(),
          booking_id: ids.booking,
          customer_id: ids.customer,
          provider_id: ids.provider,
          rating: 6,
        }),
        /reviews_rating_check/,
      );
    }),
  );

  await t.test('atribusi review harus sama dengan booking', () =>
    inTransaction(async (trx) => {
      const ids = await insertBase(trx);
      await trx('bookings').insert(booking(ids, { status: 'completed', final_total: 50000 }));
      await assert.rejects(
        trx('reviews').insert({
          id: randomUUID(),
          booking_id: ids.booking,
          customer_id: ids.customer,
          provider_id: ids.otherProvider,
          rating: 5,
        }),
        /reviews_booking_foreign/,
      );
    }),
  );

  await t.test('provider tanpa lokasi tidak bisa diverifikasi', () =>
    inTransaction(async (trx) => {
      const ids = await insertBase(trx);
      await assert.rejects(
        trx('provider_profiles')
          .where({ id: ids.provider })
          .update({ verification_status: 'verified' }),
        /provider_profiles_verified_complete_check/,
      );
    }),
  );

  await t.test('sesi koneksi memakai UTC untuk DEFAULT CURRENT_TIMESTAMP', async () => {
    const [[row]] = await knex.raw('SELECT @@session.time_zone AS tz');
    assert.equal(row.tz, '+00:00');
  });
});
