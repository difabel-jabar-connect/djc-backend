// Tes foto profil dan portofolio dengan MySQL sungguhan (Cloudinary tetap palsu).
// Hanya jalan jika DB_TEST=1. Data uji memakai id acak dan dihapus lagi setelah tes.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test(
  'foto profil dan portofolio provider ke database',
  { skip: process.env.DB_TEST !== '1' },
  async (t) => {
    const knex = require('knex')(require('../knexfile'));
    const db = require('../src/config/db');
    const createApp = require('../src/app');
    const { signToken } = require('../src/utils/token');

    const suffix = randomUUID().slice(0, 8);
    const userId = randomUUID();
    const profileId = randomUUID();

    t.after(async () => {
      await knex('portfolio_items').where({ provider_id: profileId }).del();
      await knex('provider_profiles').where({ id: profileId }).del();
      await knex('users').where({ id: userId }).del();
      await knex.destroy();
      await db.closePool();
    });

    await knex.migrate.latest();
    await knex('users').insert({
      id: userId,
      role: 'provider',
      full_name: 'Uji Media',
      email: `uji-media-${suffix}@djc.test`,
      phone: '+6281299990011',
      password_hash: 'x',
    });
    await knex('provider_profiles').insert({
      id: profileId,
      user_id: userId,
      display_name: 'Uji Media',
      alumni_reg_no: `UJI-${suffix}`,
      city: 'Kota Bandung',
    });

    let uploads = 0;
    const cloudinary = {
      configured: true,
      async uploadImage({ folder }) {
        uploads += 1;
        return { url: `https://res.cloudinary.com/demo/image/upload/${folder}/${uploads}.webp` };
      },
    };
    const app = createApp({ cloudinary });
    const auth = `Bearer ${signToken({ id: userId, role: 'provider' }).token}`;

    const photo = await request(app)
      .put('/api/v1/provider/photo')
      .set('Authorization', auth)
      .send({ image: PNG, image_alt: 'Foto uji' });
    assert.equal(photo.status, 200);
    const stored = await knex('provider_profiles').where({ id: profileId }).first();
    assert.equal(stored.photo_url, photo.body.data.photo_url);
    assert.equal(stored.photo_alt, 'Foto uji');

    for (const title of ['Karya pertama', 'Karya kedua']) {
      const created = await request(app)
        .post('/api/v1/provider/portfolio')
        .set('Authorization', auth)
        .send({ image: PNG, image_alt: `Gambar ${title}`, title, item_type: 'physical_product' });
      assert.equal(created.status, 201);
    }

    const list = await request(app).get('/api/v1/provider/portfolio').set('Authorization', auth);
    assert.deepEqual(
      list.body.data.map((item) => [item.title, item.sort_order]),
      [
        ['Karya pertama', 0],
        ['Karya kedua', 1],
      ],
    );

    const removed = await request(app)
      .delete(`/api/v1/provider/portfolio/${list.body.data[0].id}`)
      .set('Authorization', auth);
    assert.equal(removed.status, 200);
    assert.equal(
      await knex('portfolio_items')
        .where({ provider_id: profileId })
        .count('* as n')
        .first()
        .then((r) => Number(r.n)),
      1,
    );

    // CHECK portfolio_items_image_alt_check: teks alternatif kosong ditolak database juga.
    await assert.rejects(
      knex('portfolio_items').insert({
        id: randomUUID(),
        provider_id: profileId,
        title: 'Tanpa alt',
        item_type: 'work_result',
        image_url: 'https://res.cloudinary.com/demo/x.webp',
        image_alt: '   ',
      }),
      /portfolio_items_image_alt_check/,
    );
  },
);
