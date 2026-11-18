// Tes katalog layanan provider (SP2-07) dengan MySQL sungguhan. Hanya jalan jika DB_TEST=1.
// Membuat satu provider verified dengan id acak, lalu menghapusnya lagi setelah tes.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createTestCategory, deleteTestCategory } = require('./helpers/testCategory');

test('katalog layanan provider ke database', { skip: process.env.DB_TEST !== '1' }, async (t) => {
  const knex = require('knex')(require('../knexfile'));
  const db = require('../src/config/db');
  const createApp = require('../src/app');
  const { signToken } = require('../src/utils/token');

  const suffix = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const profileId = randomUUID();

  t.after(async () => {
    await knex('services').where({ provider_id: profileId }).del();
    await knex('provider_profiles').where({ id: profileId }).del();
    await knex('users').where({ id: userId }).del();
    await deleteTestCategory(knex, suffix);
    await knex.destroy();
    await db.closePool();
  });

  await knex.migrate.latest();
  const category = await createTestCategory(knex, suffix);
  await knex('users').insert({
    id: userId,
    role: 'provider',
    full_name: 'Uji Katalog',
    email: `uji-katalog-${suffix}@djc.test`,
    phone: '+6281299990013',
    password_hash: 'x',
  });
  await knex('provider_profiles').insert({
    id: profileId,
    user_id: userId,
    display_name: `Uji Katalog ${suffix}`,
    alumni_reg_no: `UJI-K-${suffix}`,
    city: 'Kota Bandung',
    address_detail: 'Jl. Rahasia No. 2',
    lat: -6.914744,
    lng: 107.60981,
    public_lat: -6.91,
    public_lng: 107.61,
    verification_status: 'verified',
  });

  const app = createApp();
  const auth = `Bearer ${signToken({ id: userId, role: 'provider' }).token}`;

  const created = await request(app)
    .post('/api/v1/provider/services')
    .set('Authorization', auth)
    .send({
      category_id: category.id,
      title: `Les BISINDO ${suffix}`,
      pricing_type: 'hourly',
      price_amount: 75000,
      min_hours: 2,
      service_mode: 'both',
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const service = created.body.data;
  assert.equal(service.price_amount, 75000);
  assert.equal(service.min_hours, 2);
  assert.equal(service.is_active, true);
  assert.equal(service.category.slug, category.slug);

  // Langsung tampil di pencarian publik karena provider sudah verified.
  const visible = await request(app).get(`/api/v1/services/${service.id}`);
  assert.equal(visible.status, 200);

  // Ganti ke harga tetap: min_hours dikosongkan, sesuai CHECK services_min_hours_check.
  const fixed = await request(app)
    .put(`/api/v1/provider/services/${service.id}`)
    .set('Authorization', auth)
    .send({ pricing_type: 'fixed', price_amount: 120000 });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
  assert.equal(fixed.body.data.min_hours, null);
  assert.equal(fixed.body.data.price_amount, 120000);

  // Nonaktifkan: hilang dari publik, tapi baris tetap ada untuk riwayat booking.
  const off = await request(app)
    .put(`/api/v1/provider/services/${service.id}`)
    .set('Authorization', auth)
    .send({ is_active: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.data.is_active, false);
  assert.equal((await request(app).get(`/api/v1/services/${service.id}`)).status, 404);
  assert.ok(await knex('services').where({ id: service.id }).first());

  const list = await request(app).get('/api/v1/provider/services').set('Authorization', auth);
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.data.map((item) => [item.id, item.is_active]),
    [[service.id, false]],
  );
});
