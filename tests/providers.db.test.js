// Tes profil provider dan jadwal dengan MySQL sungguhan. Hanya jalan jika DB_TEST=1.
// Akun, profil, dan jadwal uji memakai id acak dan dihapus lagi setelah tes; data lain
// (termasuk hasil seeder) tidak disentuh.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');

test(
  'profil provider, koordinat publik, dan jadwal ke database',
  { skip: process.env.DB_TEST !== '1' },
  async (t) => {
    const knex = require('knex')(require('../knexfile'));
    const db = require('../src/config/db');
    const createApp = require('../src/app');
    const { signToken } = require('../src/utils/token');

    const suffix = randomUUID().slice(0, 8);
    const userId = randomUUID();
    const profileId = randomUUID();
    const inactiveCategoryId = randomUUID();

    t.after(async () => {
      await knex('services').where({ provider_id: profileId }).del();
      await knex('categories').where({ id: inactiveCategoryId }).del();
      await knex('provider_availability').where({ provider_id: profileId }).del();
      await knex('provider_profiles').where({ id: profileId }).del();
      await knex('users').where({ id: userId }).del();
      await knex.destroy();
      await db.closePool();
    });

    await knex.migrate.latest();
    await knex('users').insert({
      id: userId,
      role: 'provider',
      full_name: 'Uji Penyedia',
      email: `uji-provider-${suffix}@djc.test`,
      phone: '+6281299990010',
      password_hash: 'x',
    });
    await knex('provider_profiles').insert({
      id: profileId,
      user_id: userId,
      display_name: 'Uji Penyedia',
      alumni_reg_no: `UJI-${suffix}`,
      city: 'Kota Bekasi',
      address_detail: 'Jl. Uji No. 1',
      lat: -6.2,
      lng: 107,
      public_lat: -6.2,
      public_lng: 107,
      verification_status: 'verified',
    });

    const app = createApp();
    const auth = `Bearer ${signToken({ id: userId, role: 'provider' }).token}`;

    const updated = await request(app)
      .put('/api/v1/provider/profile')
      .set('Authorization', auth)
      .send({
        bio: 'Uji bio',
        communication_prefs: ['chat', 'bisindo'],
        lat: -6.238321,
        lng: 106.975612,
      });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.lat, -6.238321);
    assert.equal(updated.body.data.public_lat, -6.24);
    assert.deepEqual(updated.body.data.communication_prefs, ['chat', 'bisindo']);

    const stored = await knex('provider_profiles').where({ id: profileId }).first();
    assert.equal(Number(stored.public_lat), -6.24);
    assert.equal(Number(stored.public_lng), 106.98);

    const slots = await request(app)
      .put('/api/v1/provider/availability')
      .set('Authorization', auth)
      .send({
        availability: [
          { day_of_week: 1, start_time: '08:00', end_time: '16:00' },
          { day_of_week: 6, start_time: '09:00', end_time: '12:00' },
        ],
      });
    assert.equal(slots.status, 200);
    assert.deepEqual(slots.body.data, [
      { day_of_week: 1, start_time: '08:00', end_time: '16:00' },
      { day_of_week: 6, start_time: '09:00', end_time: '12:00' },
    ]);

    // Layanan aktif dari kategori nonaktif tidak tampil di profil publik (sama dengan L1).
    const activeCategory = await knex('categories').where({ is_active: true }).first();
    await knex('categories').insert({
      id: inactiveCategoryId,
      name: `Uji Nonaktif ${suffix}`,
      slug: `uji-nonaktif-${suffix}`,
      is_active: false,
    });
    const service = (categoryId, title) => ({
      id: randomUUID(),
      provider_id: profileId,
      category_id: categoryId,
      title,
      pricing_type: 'fixed',
      price_amount: 50000,
      service_mode: 'at_provider',
    });
    await knex('services').insert([
      service(activeCategory.id, 'Uji kategori aktif'),
      service(inactiveCategoryId, 'Uji kategori nonaktif'),
    ]);

    const publicProfile = await request(app).get(`/api/v1/providers/${profileId}`);
    assert.equal(publicProfile.status, 200);
    assert.equal(publicProfile.body.data.public_lat, -6.24);
    assert.equal(publicProfile.body.data.public_lng, 106.98);
    assert.equal(publicProfile.body.data.availability.length, 2);
    assert.deepEqual(
      publicProfile.body.data.services.map((item) => item.title),
      ['Uji kategori aktif'],
    );
    for (const field of ['lat', 'lng', 'address_detail', 'alumni_reg_no', 'disability_type']) {
      assert.equal(publicProfile.body.data[field], undefined, `${field} tidak boleh publik`);
    }

    // CHECK provider_profiles_verified_complete_check: provider verified wajib punya lokasi.
    await assert.rejects(
      knex('provider_profiles').where({ id: profileId }).update({ address_detail: null }),
      /provider_profiles_verified_complete_check/,
    );
  },
);
