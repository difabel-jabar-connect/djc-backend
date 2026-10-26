// Tes alur auth dengan MySQL sungguhan. Hanya jalan jika DB_TEST=1.
// Akun uji memakai email acak dan dihapus lagi setelah tes, data lain tidak disentuh.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');

test(
  'register, login, me, logout ke database',
  { skip: process.env.DB_TEST !== '1' },
  async (t) => {
    const knex = require('knex')(require('../knexfile'));
    const db = require('../src/config/db');
    const createApp = require('../src/app');

    const suffix = randomUUID().slice(0, 8);
    const customerEmail = `uji-customer-${suffix}@djc.test`;
    const providerEmail = `uji-provider-${suffix}@djc.test`;

    t.after(async () => {
      const ids = await knex('users').whereIn('email', [customerEmail, providerEmail]).pluck('id');
      await knex('provider_profiles').whereIn('user_id', ids).del();
      await knex('users').whereIn('id', ids).del();
      await knex.destroy();
      await db.closePool();
    });

    await knex.migrate.latest();
    const app = createApp();

    const customer = await request(app).post('/api/v1/auth/register').send({
      role: 'customer',
      full_name: 'Uji Pelanggan',
      email: customerEmail.toUpperCase(),
      phone: '+6281299990001',
      password: 'RahasiaUji1',
    });
    assert.equal(customer.status, 201);
    assert.equal(customer.body.data.user.email, customerEmail);

    const duplicate = await request(app).post('/api/v1/auth/register').send({
      role: 'customer',
      full_name: 'Uji Ganda',
      email: customerEmail,
      phone: '+6281299990002',
      password: 'RahasiaUji1',
    });
    assert.equal(duplicate.status, 409);

    const provider = await request(app)
      .post('/api/v1/auth/register')
      .send({
        role: 'provider',
        full_name: 'Uji Penyedia',
        email: providerEmail,
        phone: '+6281299990003',
        password: 'RahasiaUji1',
        alumni_reg_no: `UJI-${suffix}`,
        city: 'Kota Bekasi',
      });
    assert.equal(provider.status, 201);

    const profile = await knex('provider_profiles')
      .where({ user_id: provider.body.data.user.id })
      .first();
    assert.equal(profile.verification_status, 'pending');
    assert.equal(profile.display_name, 'Uji Penyedia');
    assert.equal(profile.city, 'Kota Bekasi');

    const stored = await knex('users').where({ email: customerEmail }).first();
    assert.notEqual(stored.password_hash, 'RahasiaUji1');

    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: customerEmail, password: 'salah-total' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');

    const agent = request.agent(app);
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ email: providerEmail, password: 'RahasiaUji1' });
    assert.equal(login.status, 200);

    const me = await agent.get('/api/v1/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.data.user.role, 'provider');
    assert.deepEqual(me.body.data.provider_profile, {
      id: profile.id,
      verification_status: 'pending',
    });

    const logout = await agent.post('/api/v1/auth/logout');
    assert.equal(logout.status, 200);
    assert.equal((await agent.get('/api/v1/auth/me')).status, 401);
  },
);
