// Tes pencarian layanan dengan MySQL sungguhan. Hanya jalan jika DB_TEST=1.
// Membuat dua provider uji (verified dan pending) beserta layanannya dengan id acak, lalu
// menghapusnya lagi. Data lain (termasuk hasil seeder) hanya dibaca.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createTestCategory, deleteTestCategory } = require('./helpers/testCategory');

test(
  'pencarian dan detail layanan ke database',
  { skip: process.env.DB_TEST !== '1' },
  async (t) => {
    const knex = require('knex')(require('../knexfile'));
    const db = require('../src/config/db');
    const createApp = require('../src/app');

    const suffix = randomUUID().slice(0, 8);
    const word = `ujicari${suffix}`;
    const ids = {
      verifiedUser: randomUUID(),
      pendingUser: randomUUID(),
      verified: randomUUID(),
      pending: randomUUID(),
      cheap: randomUUID(),
      pricey: randomUUID(),
      hidden: randomUUID(),
    };

    t.after(async () => {
      await knex('services').whereIn('provider_id', [ids.verified, ids.pending]).del();
      await knex('provider_availability').whereIn('provider_id', [ids.verified, ids.pending]).del();
      await knex('provider_profiles').whereIn('id', [ids.verified, ids.pending]).del();
      await knex('users').whereIn('id', [ids.verifiedUser, ids.pendingUser]).del();
      await deleteTestCategory(knex, suffix);
      await knex.destroy();
      await db.closePool();
    });

    await knex.migrate.latest();
    const category = await createTestCategory(knex, suffix);
    await knex('users').insert(
      [ids.verifiedUser, ids.pendingUser].map((id, index) => ({
        id,
        role: 'provider',
        full_name: `Uji Cari ${index}`,
        email: `uji-cari-${index}-${suffix}@djc.test`,
        phone: '+6281299990012',
        password_hash: 'x',
      })),
    );
    await knex('provider_profiles').insert([
      {
        id: ids.verified,
        user_id: ids.verifiedUser,
        display_name: `Penyedia ${word}`,
        alumni_reg_no: `UJI-V-${suffix}`,
        city: `Kota Uji ${suffix}`,
        address_detail: 'Jl. Rahasia No. 1',
        lat: -6.238321,
        lng: 106.975612,
        public_lat: -6.24,
        public_lng: 106.98,
        verification_status: 'verified',
        rating_avg: 4.5,
      },
      {
        id: ids.pending,
        user_id: ids.pendingUser,
        display_name: `Pending ${word}`,
        alumni_reg_no: `UJI-P-${suffix}`,
        city: `Kota Uji ${suffix}`,
      },
    ]);
    await knex('provider_availability').insert({
      id: randomUUID(),
      provider_id: ids.verified,
      day_of_week: 2,
      start_time: '08:00',
      end_time: '12:00',
    });
    const service = (id, providerId, title, price, extra = {}) => ({
      id,
      provider_id: providerId,
      category_id: category.id,
      title,
      pricing_type: 'fixed',
      price_amount: price,
      service_mode: 'at_provider',
      ...extra,
    });
    await knex('services').insert([
      service(ids.cheap, ids.verified, `Murah ${word}`, 20000),
      service(ids.pricey, ids.verified, `Mahal ${word}`, 90000),
      service(ids.hidden, ids.verified, `Nonaktif ${word}`, 30000, { is_active: false }),
      service(randomUUID(), ids.pending, `Pending ${word}`, 10000),
    ]);

    const app = createApp();
    const search = (query) =>
      request(app)
        .get('/api/v1/services')
        .query({ q: word, ...query });

    const all = await search({ sort: 'price_asc' });
    assert.equal(all.status, 200);
    assert.deepEqual(
      all.body.data.map((item) => item.id),
      [ids.cheap, ids.pricey],
      'hanya layanan aktif milik provider verified',
    );
    assert.deepEqual(all.body.meta, { page: 1, limit: 12, total_items: 2, total_pages: 1 });

    const provider = all.body.data[0].provider;
    assert.equal(provider.public_lat, -6.24);
    assert.equal(provider.public_lng, 106.98);
    for (const field of ['lat', 'lng', 'address_detail', 'alumni_reg_no']) {
      assert.equal(provider[field], undefined, `${field} tidak boleh dikirim`);
    }

    const filtered = await search({
      category_id: category.id,
      city: `Kota Uji ${suffix}`,
      min_price: 50000,
      min_rating: 4,
      day_of_week: 2,
    });
    assert.deepEqual(
      filtered.body.data.map((item) => item.id),
      [ids.pricey],
    );

    assert.equal((await search({ day_of_week: 3 })).body.data.length, 0);
    assert.equal((await search({ min_rating: 4.6 })).body.data.length, 0);
    assert.equal(
      (await search({ category: category.slug, sort: 'price_desc' })).body.data[0].id,
      ids.pricey,
    );

    const paged = await search({ sort: 'price_asc', limit: 1, page: 2 });
    assert.deepEqual(paged.body.meta, { page: 2, limit: 1, total_items: 2, total_pages: 2 });
    assert.equal(paged.body.data[0].id, ids.pricey);

    // Karakter wildcard LIKE dicari sebagai huruf biasa, bukan "semua".
    assert.equal((await search({ q: '%' })).body.data.length, 0);

    const detail = await request(app).get(`/api/v1/services/${ids.cheap}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.data.provider.availability, [
      { day_of_week: 2, start_time: '08:00', end_time: '12:00' },
    ]);
    assert.equal((await request(app).get(`/api/v1/services/${ids.hidden}`)).status, 404);
  },
);
