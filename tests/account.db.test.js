// Tes Akun Saya dengan MySQL sungguhan: data diri, kata sandi, dan alamat tersimpan.
// Hanya jalan jika DB_TEST=1. Akun uji memakai email acak dan dihapus lagi setelah tes.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');

test(
  'Akun Saya: ubah data diri, ganti kata sandi, dan alamat tersimpan di database',
  { skip: process.env.DB_TEST !== '1' },
  async (t) => {
    const knex = require('knex')(require('../knexfile'));
    const db = require('../src/config/db');
    const createApp = require('../src/app');
    const users = require('../src/repositories/userRepository');

    const suffix = randomUUID().slice(0, 8);
    const email = `uji-akun-${suffix}@djc.test`;
    const googleEmail = `uji-google-${suffix}@djc.test`;

    t.after(async () => {
      // Alamat ikut terhapus lewat ON DELETE CASCADE.
      await knex('users').whereIn('email', [email, googleEmail]).del();
      await knex.destroy();
      await db.closePool();
    });

    await knex.migrate.latest();
    const app = createApp();
    const agent = request.agent(app);

    const register = await agent.post('/api/v1/auth/register').send({
      name: 'Uji Akun',
      email,
      phone: '+6281299990011',
      password: 'RahasiaUji1',
    });
    assert.equal(register.status, 201);
    assert.equal(register.body.data.user.has_password, true);
    assert.equal(register.body.data.user.avatar_url, null);
    const userId = register.body.data.user.id;
    assert.equal(
      (await agent.post('/api/v1/auth/login').send({ email, password: 'RahasiaUji1' })).status,
      200,
    );

    // Data diri
    const patch = await agent
      .patch('/api/v1/me')
      .send({ name: 'Uji Akun Baru', phone: '+6281299990012' });
    assert.equal(patch.status, 200);
    const row = await knex('users').where({ id: userId }).first();
    assert.equal(row.full_name, 'Uji Akun Baru');
    assert.equal(row.phone, '+6281299990012');

    // Alamat: pertama otomatis utama, utama hanya satu, hapus utama memindahkan utama.
    const add = (body) => agent.post('/api/v1/me/addresses').send(body);
    const rumah = await add({
      label: 'Rumah',
      address: 'Jl. Cigadung Raya No. 12, Bandung',
      lat: -6.876512,
      lng: 107.623401,
    });
    assert.equal(rumah.status, 201);
    assert.equal(rumah.body.data.is_primary, true);
    assert.equal(rumah.body.data.lat, -6.876512);

    const kantor = await add({
      label: 'Kantor',
      address: 'Jl. Asia Afrika No. 8, Bandung',
      detail: 'Lantai 3',
      lat: -6.9215,
      lng: 107.6071,
      is_primary: true,
    });
    assert.equal(kantor.body.data.is_primary, true);
    const primaries = async () =>
      knex('user_addresses').where({ user_id: userId, is_primary: true }).pluck('label');
    assert.deepEqual(await primaries(), ['Kantor']);

    const list = await agent.get('/api/v1/me/addresses');
    assert.deepEqual(
      list.body.data.map((a) => a.label),
      ['Kantor', 'Rumah'],
    );

    const edit = await agent
      .patch(`/api/v1/me/addresses/${rumah.body.data.id}`)
      .send({ area: 'Cibeunying Kaler', is_primary: true });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.data.area, 'Cibeunying Kaler');
    assert.deepEqual(await primaries(), ['Rumah']);

    assert.equal((await agent.delete(`/api/v1/me/addresses/${rumah.body.data.id}`)).status, 200);
    assert.deepEqual(await primaries(), ['Kantor']);

    // Ganti kata sandi: yang lama tidak berlaku lagi.
    const changed = await agent
      .put('/api/v1/me/password')
      .send({ current_password: 'RahasiaUji1', new_password: 'RahasiaBaru2' });
    assert.equal(changed.status, 200);
    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'RahasiaUji1' });
    assert.equal(oldLogin.status, 401);
    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'RahasiaBaru2' });
    assert.equal(newLogin.status, 200);

    // Akun Google: has_password FALSE sampai kata sandi dibuat lewat reset.
    const google = await users.createUser({
      fullName: 'Uji Google',
      email: googleEmail,
      phone: '+6281299990013',
      passwordHash: 'x',
      emailVerified: true,
      hasPassword: false,
    });
    assert.equal((await users.findById(google.id)).has_password, 0);
    await users.updatePassword(google.id, 'y');
    assert.equal((await users.findById(google.id)).has_password, 1);
  },
);
