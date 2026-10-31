// Tes booking dan riwayat status dengan MySQL sungguhan. Hanya jalan jika DB_TEST=1.
// Membuat customer, provider, layanan, dan jadwal uji dengan id acak, lalu menghapus
// semuanya lagi (termasuk booking dan riwayatnya). Data lain tidak disentuh.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createTestCategory, deleteTestCategory } = require('./helpers/testCategory');

test(
  'booking, transisi status, dan riwayat ke database',
  { skip: process.env.DB_TEST !== '1' },
  async (t) => {
    const knex = require('knex')(require('../knexfile'));
    const db = require('../src/config/db');
    const createApp = require('../src/app');
    const { signToken } = require('../src/utils/token');

    const suffix = randomUUID().slice(0, 8);
    const ids = {
      customer: randomUUID(),
      providerUser: randomUUID(),
      provider: randomUUID(),
      hourly: randomUUID(),
      fixed: randomUUID(),
    };

    t.after(async () => {
      const bookingIds = await knex('bookings').where({ provider_id: ids.provider }).pluck('id');
      await knex('booking_status_history').whereIn('booking_id', bookingIds).del();
      await knex('bookings').whereIn('id', bookingIds).del();
      await knex('services').where({ provider_id: ids.provider }).del();
      await knex('provider_availability').where({ provider_id: ids.provider }).del();
      await knex('provider_profiles').where({ id: ids.provider }).del();
      await knex('users').whereIn('id', [ids.customer, ids.providerUser]).del();
      await deleteTestCategory(knex, suffix);
      await knex.destroy();
      await db.closePool();
    });

    await knex.migrate.latest();
    const category = await createTestCategory(knex, suffix);
    await knex('users').insert([
      {
        id: ids.customer,
        role: 'customer',
        full_name: 'Uji Pemesan',
        email: `uji-pemesan-${suffix}@djc.test`,
        phone: '+6281299990013',
        password_hash: 'x',
      },
      {
        id: ids.providerUser,
        role: 'provider',
        full_name: 'Uji Penyedia Booking',
        email: `uji-penyedia-${suffix}@djc.test`,
        phone: '+6281299990014',
        password_hash: 'x',
      },
    ]);
    await knex('provider_profiles').insert({
      id: ids.provider,
      user_id: ids.providerUser,
      display_name: 'Uji Penyedia Booking',
      alumni_reg_no: `UJI-B-${suffix}`,
      city: 'Kota Bandung',
      address_detail: 'Jl. Uji No. 2',
      lat: -6.9,
      lng: 107.6,
      public_lat: -6.9,
      public_lng: 107.6,
      verification_status: 'verified',
    });
    await knex('provider_availability').insert({
      id: randomUUID(),
      provider_id: ids.provider,
      day_of_week: 1,
      start_time: '08:00',
      end_time: '16:00',
    });
    await knex('services').insert([
      {
        id: ids.hourly,
        provider_id: ids.provider,
        category_id: category.id,
        title: 'Uji per jam',
        pricing_type: 'hourly',
        price_amount: 40000,
        min_hours: 2,
        service_mode: 'both',
      },
      {
        id: ids.fixed,
        provider_id: ids.provider,
        category_id: category.id,
        title: 'Uji harga tetap',
        pricing_type: 'fixed',
        price_amount: 50000,
        service_mode: 'at_provider',
      },
    ]);

    // Senin 2 November 2026, 10.00 WIB.
    const app = createApp({ now: () => new Date('2026-11-02T03:00:00Z') });
    const asCustomer = `Bearer ${signToken({ id: ids.customer, role: 'customer' }).token}`;
    const asProvider = `Bearer ${signToken({ id: ids.providerUser, role: 'provider' }).token}`;

    const created = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', asCustomer)
      .send({
        service_id: ids.hourly,
        scheduled_date: '2026-11-02',
        start_time: '10:00',
        service_mode: 'at_customer',
        quantity: 3,
        location_area: 'Coblong, Kota Bandung',
        location_address: 'Jl. Uji Customer No. 3',
      });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.id;
    assert.match(created.body.data.code, /^DJC-[2-9A-Z]{8}$/);
    assert.equal(created.body.data.estimated_total, 120000);

    const asProviderView = await request(app)
      .get(`/api/v1/bookings/${id}`)
      .set('Authorization', asProvider);
    assert.equal(asProviderView.body.data.customer.name, 'Uji P.');
    assert.equal(asProviderView.body.data.location.address, null, 'alamat belum dibuka (BE-07)');
    assert.equal(asProviderView.body.data.location.area, 'Coblong, Kota Bandung');

    const view = async (auth) =>
      (await request(app).get(`/api/v1/bookings/${id}`).set('Authorization', auth)).body.data;

    for (const [name, body] of [
      ['accept', {}],
      ['start', {}],
      ['complete', { actual_quantity: 2.5 }],
    ]) {
      const res = await request(app)
        .put(`/api/v1/bookings/${id}/${name}`)
        .set('Authorization', asProvider)
        .send(body);
      assert.equal(res.status, 200, `${name}: ${JSON.stringify(res.body)}`);

      // BE-07: kontak dan alamat terbuka saat accepted/in_progress, dikunci lagi saat completed.
      const open = name !== 'complete';
      const providerView = await view(asProvider);
      assert.equal(
        providerView.customer.phone,
        open ? '+6281299990013' : null,
        `${name}: telepon customer`,
      );
      assert.equal(
        providerView.location.address,
        open ? 'Jl. Uji Customer No. 3' : null,
        `${name}: alamat customer`,
      );
      assert.equal(
        providerView.customer.name,
        'Uji Pemesan',
        'nama lengkap setelah pernah diterima',
      );
      const customerView = await view(asCustomer);
      assert.equal(
        customerView.provider.phone,
        open ? '+6281299990014' : null,
        `${name}: telepon provider`,
      );
    }

    const stored = await knex('bookings').where({ id }).first();
    assert.equal(stored.status, 'completed');
    assert.equal(Number(stored.final_total), 100000);
    assert.equal(Number(stored.actual_quantity), 2.5);

    const history = await knex('booking_status_history')
      .where({ booking_id: id })
      .orderBy('created_at')
      .select('from_status', 'to_status', 'changed_by');
    assert.deepEqual(
      history.map((h) => `${h.from_status}->${h.to_status}`),
      ['null->requested', 'requested->accepted', 'accepted->in_progress', 'in_progress->completed'],
    );
    assert.equal(history[0].changed_by, ids.customer);
    assert.equal(history[1].changed_by, ids.providerUser);

    const list = await request(app)
      .get('/api/v1/bookings?status=completed')
      .set('Authorization', asCustomer);
    assert.deepEqual(
      list.body.data.map((b) => b.id),
      [id],
    );

    // Reject dan cancel menyimpan alasan dan cancelled_by sesuai CHECK database.
    const second = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', asCustomer)
      .send({
        service_id: ids.fixed,
        scheduled_date: '2026-11-09',
        start_time: '10:00',
        service_mode: 'at_provider',
      });
    const rejected = await request(app)
      .put(`/api/v1/bookings/${second.body.data.id}/reject`)
      .set('Authorization', asProvider)
      .send({ reason: 'Kapasitas penuh di jam tersebut' });
    assert.equal(rejected.status, 200);
    assert.equal(
      (await knex('bookings').where({ id: second.body.data.id }).first()).status_reason,
      'Kapasitas penuh di jam tersebut',
    );

    const third = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', asCustomer)
      .send({
        service_id: ids.fixed,
        scheduled_date: '2026-11-09',
        start_time: '11:00',
        service_mode: 'at_provider',
      });
    const cancelled = await request(app)
      .post(`/api/v1/bookings/${third.body.data.id}/cancel`)
      .set('Authorization', asCustomer)
      .send({});
    assert.equal(cancelled.status, 200);
    const cancelledRow = await knex('bookings').where({ id: third.body.data.id }).first();
    assert.equal(cancelledRow.cancelled_by, 'customer');

    // CHECK bookings_completed_totals_check menolak completed tanpa final_total.
    await assert.rejects(
      knex('bookings')
        .where({ id: third.body.data.id })
        .update({ status: 'completed', cancelled_by: null }),
      /bookings_completed_totals_check/,
    );

    // Accept menolak jadwal yang tumpang tindih (start_time + quantity jam) dengan pesanan
    // yang sudah diterima: 09:00–11:00 sudah diterima, 10:00 bentrok, 11:00 pas setelahnya.
    const book = async (startTime) => {
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', asCustomer)
        .send({
          service_id: ids.hourly,
          scheduled_date: '2026-11-16',
          start_time: startTime,
          service_mode: 'at_provider',
          quantity: 2,
        });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body.data.id;
    };
    const accept = (bookingId) =>
      request(app).put(`/api/v1/bookings/${bookingId}/accept`).set('Authorization', asProvider);
    const [nine, ten, eleven] = [await book('09:00'), await book('10:00'), await book('11:00')];
    assert.equal((await accept(nine)).status, 200);
    const clash = await accept(ten);
    assert.equal(clash.status, 409, JSON.stringify(clash.body));
    assert.equal(clash.body.error.code, 'CONFLICT');
    assert.equal((await knex('bookings').where({ id: ten }).first()).status, 'requested');
    assert.equal((await accept(eleven)).status, 200);
  },
);
