// Tes alur auth dengan MySQL sungguhan. Hanya jalan jika DB_TEST=1.
// Akun uji memakai email acak dan dihapus lagi setelah tes, data lain tidak disentuh.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
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
      name: 'Uji Pelanggan',
      email: customerEmail.toUpperCase(),
      phone: '+6281299990001',
      password: 'RahasiaUji1',
    });
    assert.equal(customer.status, 201);
    assert.equal(customer.body.data.user.email, customerEmail);

    const duplicate = await request(app).post('/api/v1/auth/register').send({
      role: 'customer',
      name: 'Uji Ganda',
      email: customerEmail,
      phone: '+6281299990002',
      password: 'RahasiaUji1',
    });
    assert.equal(duplicate.status, 409);

    // Mitra tidak bisa daftar sendiri (akun mitra dibuat admin).
    const selfProvider = await request(app).post('/api/v1/auth/register').send({
      role: 'provider',
      name: 'Uji Penyedia',
      email: providerEmail,
      phone: '+6281299990003',
      password: 'RahasiaUji1',
      city: 'Kota Bekasi',
      category: 'kebersihan',
    });
    assert.equal(selfProvider.status, 403);
    assert.equal(await knex('users').where({ email: providerEmail }).first(), undefined);

    // Akun mitra disiapkan langsung di database seperti yang nanti dilakukan endpoint admin.
    const providerUserId = randomUUID();
    const profile = { id: randomUUID(), verification_status: 'pending' };
    await knex('users').insert({
      id: providerUserId,
      role: 'provider',
      full_name: 'Uji Penyedia',
      email: providerEmail,
      phone: '+6281299990003',
      password_hash: await bcrypt.hash('RahasiaUji1', 4),
    });
    await knex('provider_profiles').insert({
      id: profile.id,
      user_id: providerUserId,
      display_name: 'Uji Penyedia',
      alumni_reg_no: `UJI-${suffix}`,
      city: 'Kota Bekasi',
    });

    const stored = await knex('users').where({ email: customerEmail }).first();
    assert.notEqual(stored.password_hash, 'RahasiaUji1');
    assert.equal(stored.email_verified_at, null, 'daftar lewat form belum memverifikasi email');

    // Reset kata sandi lewat tautan email ikut memverifikasi email.
    const users = require('../src/repositories/userRepository');
    await users.updatePassword(stored.id, stored.password_hash);
    assert.ok((await users.findById(stored.id)).email_verified_at);

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
    assert.equal(login.body.data.user.name, 'Uji Penyedia');

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
