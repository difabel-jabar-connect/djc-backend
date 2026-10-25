// Tes seeder dengan MySQL sungguhan. Hanya jalan jika DB_TEST=1.
// Perhatian: tes ini menjalankan `db:seed`, jadi isi database diganti data dummy.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

test('seeder mengisi data dummy minimum', { skip: process.env.DB_TEST !== '1' }, async (t) => {
  const knex = require('knex')(require('../knexfile'));
  t.after(() => knex.destroy());

  await knex.migrate.latest();
  // Dijalankan dua kali untuk memastikan seed ulang tidak gagal relasi.
  await knex.seed.run();
  await knex.seed.run();

  const count = async (table) => Number((await knex(table).count({ n: '*' }))[0].n);
  const expected = {
    users: 10,
    provider_profiles: 6,
    skills: 8,
    provider_skills: 12,
    portfolio_items: 4,
    categories: 8,
    services: 8,
    bookings: 7,
    booking_status_history: 18,
    reviews: 2,
    admin_actions: 6,
  };
  for (const [table, total] of Object.entries(expected)) {
    assert.equal(await count(table), total, table);
  }

  const statuses = await knex('bookings').distinct('status').pluck('status');
  assert.deepEqual(statuses.sort(), [
    'accepted',
    'cancelled',
    'completed',
    'in_progress',
    'rejected',
    'requested',
  ]);

  const budi = await knex('users').where({ email: 'budi@djc.test' }).first();
  assert.ok(await bcrypt.compare(process.env.SEED_PASSWORD || 'Demo12345', budi.password_hash));

  const deni = await knex('provider_profiles').where({ display_name: 'Deni Setiawan' }).first();
  assert.equal(Number(deni.public_lat), -6.24);
  assert.equal(Number(deni.public_lng), 106.98);
  // R2 milik Deni disembunyikan admin, jadi hanya R1 (bintang 5) yang dihitung.
  assert.equal(Number(deni.rating_avg), 5);
  assert.equal(deni.rating_count, 1);
});
