// Tes endpoint admin dengan MySQL sungguhan. Hanya jalan jika DB_TEST=1.
// Membuat admin, customer, provider, layanan, booking, dan ulasan uji dengan id acak, lalu
// menghapus semuanya lagi (termasuk admin_actions). Data lain tidak disentuh.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');

test(
  'admin: buat mitra, verifikasi, moderasi, suspend ke database',
  { skip: process.env.DB_TEST !== '1' },
  async (t) => {
    const knex = require('knex')(require('../knexfile'));
    const db = require('../src/config/db');
    const createApp = require('../src/app');
    const { signToken } = require('../src/utils/token');

    const suffix = randomUUID().slice(0, 8);
    const ids = {
      admin: randomUUID(),
      customer: randomUUID(),
      providerUser: randomUUID(),
      provider: randomUUID(),
      service: randomUUID(),
      review: randomUUID(),
    };
    const createdEmail = `uji-mitra-baru-${suffix}@djc.test`;

    t.after(async () => {
      const createdUser = await knex('users').where({ email: createdEmail }).first();
      const userIds = [ids.admin, ids.customer, ids.providerUser, createdUser?.id].filter(Boolean);
      const profileIds = await knex('provider_profiles').whereIn('user_id', userIds).pluck('id');
      const bookingIds = await knex('bookings').whereIn('provider_id', profileIds).pluck('id');
      await knex('admin_actions').where({ admin_id: ids.admin }).del();
      await knex('reviews').whereIn('booking_id', bookingIds).del();
      await knex('booking_status_history').whereIn('booking_id', bookingIds).del();
      await knex('bookings').whereIn('id', bookingIds).del();
      await knex('services').whereIn('provider_id', profileIds).del();
      await knex('provider_profiles').whereIn('id', profileIds).del();
      await knex('users').whereIn('id', userIds).del();
      await knex.destroy();
      await db.closePool();
    });

    await knex.migrate.latest();
    const category = await knex('categories').where({ is_active: true }).first();
    const user = (id, role, name) => ({
      id,
      role,
      full_name: name,
      email: `uji-${role}-${id.slice(0, 8)}@djc.test`,
      phone: '+6281299990017',
      password_hash: 'x',
    });
    await knex('users').insert([
      user(ids.admin, 'admin', 'Uji Admin'),
      user(ids.customer, 'customer', 'Uji Pelanggan'),
      user(ids.providerUser, 'provider', 'Uji Mitra'),
    ]);
    await knex('provider_profiles').insert({
      id: ids.provider,
      user_id: ids.providerUser,
      display_name: 'Uji Mitra',
      alumni_reg_no: `UJI-A-${suffix}`,
      city: 'Kota Bandung',
      address_detail: 'Jl. Uji Admin No. 1',
      lat: -6.9,
      lng: 107.6,
      public_lat: -6.9,
      public_lng: 107.6,
    });
    await knex('services').insert({
      id: ids.service,
      provider_id: ids.provider,
      category_id: category.id,
      title: 'Uji admin',
      pricing_type: 'fixed',
      price_amount: 50000,
      service_mode: 'at_provider',
    });
    const booking = (status) => ({
      id: randomUUID(),
      code: `DJC-A${randomUUID().slice(0, 8).toUpperCase()}`,
      customer_id: ids.customer,
      provider_id: ids.provider,
      service_id: ids.service,
      scheduled_date: '2026-11-09',
      start_time: '09:00',
      service_mode: 'at_provider',
      pricing_type_snapshot: 'fixed',
      unit_price_snapshot: 50000,
      quantity: 1,
      estimated_total: 50000,
      status,
      ...(status === 'completed' ? { final_total: 50000 } : {}),
    });
    const done = booking('completed');
    const open1 = booking('requested');
    const open2 = booking('accepted');
    await knex('bookings').insert([done, open1, open2]);
    await knex('reviews').insert({
      id: ids.review,
      booking_id: done.id,
      customer_id: ids.customer,
      provider_id: ids.provider,
      rating: 1,
      comment: 'Ulasan uji',
    });
    await knex('provider_profiles')
      .where({ id: ids.provider })
      .update({ rating_avg: 1, rating_count: 1 });

    const app = createApp();
    const auth = `Bearer ${signToken({ id: ids.admin, role: 'admin' }).token}`;
    const call = (method, url, body) =>
      request(app)[method](`/api/v1/admin${url}`).set('Authorization', auth).send(body);

    const dashboard = await call('get', '/dashboard');
    assert.equal(dashboard.status, 200);
    assert.ok(dashboard.body.data.users.admins >= 1);

    // Admin membuat akun mitra; tercatat create_provider.
    const created = await call('post', '/providers', {
      name: 'Uji Mitra Baru',
      email: createdEmail,
      phone: '+6281299990018',
      password: 'Rahasia123',
      alumni_reg_no: `UJI-N-${suffix}`,
      city: 'Kota Bogor',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const newProfile = created.body.data.provider_profile.id;
    assert.equal(
      (await knex('provider_profiles').where({ id: newProfile }).first()).verification_status,
      'pending',
    );

    // Mitra baru belum punya lokasi: tidak bisa diverifikasi (CHECK database).
    assert.equal(
      (await call('put', `/providers/${newProfile}/verify`, { status: 'verified' })).status,
      400,
    );
    const verified = await call('put', `/providers/${ids.provider}/verify`, { status: 'verified' });
    assert.equal(verified.status, 200);
    const verifiedRow = await knex('provider_profiles').where({ id: ids.provider }).first();
    assert.equal(verifiedRow.verification_status, 'verified');
    assert.equal(verifiedRow.verified_by, ids.admin);
    assert.ok(verifiedRow.verified_at);

    // Moderasi: ulasan disembunyikan → rating provider dihitung ulang (tidak ada ulasan tampil).
    const hidden = await call('put', `/reviews/${ids.review}/moderate`, {
      is_hidden: true,
      reason: 'Mengandung kata kasar.',
    });
    assert.equal(hidden.status, 200);
    let profile = await knex('provider_profiles').where({ id: ids.provider }).first();
    assert.equal(profile.rating_count, 0);
    assert.equal(Number(profile.rating_avg), 0);
    await call('put', `/reviews/${ids.review}/moderate`, { is_hidden: false });
    profile = await knex('provider_profiles').where({ id: ids.provider }).first();
    assert.equal(profile.rating_count, 1);

    // Suspend provider: booking requested/accepted dibatalkan berantai oleh admin.
    const suspended = await call('put', `/users/${ids.providerUser}/suspend`, {
      reason: 'Melanggar ketentuan layanan.',
    });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.data.cancelled_bookings, 2);
    for (const id of [open1.id, open2.id]) {
      const row = await knex('bookings').where({ id }).first();
      assert.equal(row.status, 'cancelled');
      assert.equal(row.cancelled_by, 'admin');
      assert.ok(row.status_reason);
    }
    assert.equal((await knex('bookings').where({ id: done.id }).first()).status, 'completed');
    assert.equal((await knex('users').where({ id: ids.providerUser }).first()).status, 'suspended');
    assert.equal(
      (await call('put', `/users/${ids.admin}/suspend`, { reason: 'Uji diri sendiri saja' }))
        .status,
      403,
    );

    const actions = await knex('admin_actions')
      .where({ admin_id: ids.admin })
      .orderBy('created_at')
      .pluck('action');
    assert.deepEqual(actions, [
      'create_provider',
      'verify_provider',
      'hide_review',
      'unhide_review',
      'suspend_user',
    ]);
  },
);
