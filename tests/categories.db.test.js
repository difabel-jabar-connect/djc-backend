// Tes kategori dengan MySQL sungguhan. Hanya jalan jika DB_TEST=1.
// Admin, kategori, dan admin_actions uji memakai id acak dan dihapus lagi setelah tes;
// data lain (termasuk hasil seeder) tidak disentuh.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');

test(
  'kategori publik dan kelola kategori admin ke database',
  { skip: process.env.DB_TEST !== '1' },
  async (t) => {
    const knex = require('knex')(require('../knexfile'));
    const db = require('../src/config/db');
    const createApp = require('../src/app');
    const { signToken } = require('../src/utils/token');

    const suffix = randomUUID().slice(0, 8);
    const adminId = randomUUID();
    const createdIds = [];

    t.after(async () => {
      await knex('admin_actions').where({ admin_id: adminId }).del();
      await knex('categories').whereIn('id', createdIds).del();
      await knex('users').where({ id: adminId }).del();
      await knex.destroy();
      await db.closePool();
    });

    await knex.migrate.latest();
    await knex('users').insert({
      id: adminId,
      role: 'admin',
      full_name: 'Uji Admin',
      email: `uji-admin-${suffix}@djc.test`,
      phone: '+6281299990009',
      password_hash: 'x',
    });
    const app = createApp();
    const auth = `Bearer ${signToken({ id: adminId, role: 'admin' }).token}`;

    const created = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', auth)
      .send({ name: `Uji Kategori ${suffix}`, sort_order: 99 });
    assert.equal(created.status, 201);
    createdIds.push(created.body.data.id);
    assert.equal(created.body.data.slug, `uji-kategori-${suffix}`);
    assert.equal(created.body.data.is_active, true);

    const list = await request(app).get('/api/v1/categories');
    assert.equal(list.status, 200);
    assert.ok(list.body.data.some((category) => category.id === created.body.data.id));

    const duplicate = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', auth)
      .send({ name: `uji kategori ${suffix}` });
    assert.equal(duplicate.status, 409);

    const updated = await request(app)
      .put(`/api/v1/admin/categories/${created.body.data.id}`)
      .set('Authorization', auth)
      .send({ is_active: false });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.is_active, false);

    const afterHide = await request(app).get('/api/v1/categories');
    assert.ok(!afterHide.body.data.some((category) => category.id === created.body.data.id));

    const actions = await knex('admin_actions')
      .where({ admin_id: adminId, target_type: 'category', target_id: created.body.data.id })
      .orderBy('created_at')
      .pluck('action');
    assert.deepEqual(actions, ['create_category', 'update_category']);
  },
);
