// Tes chat per booking (BE-10) dengan MySQL sungguhan. Hanya jalan jika DB_TEST=1.
// Membuat customer, provider, layanan, dan dua booking uji dengan id acak, lalu menghapus
// semuanya lagi. Data lain tidak disentuh.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createTestCategory, deleteTestCategory } = require('./helpers/testCategory');

test(
  'chat booking: migrasi, riwayat, kirim, dibaca, inbox',
  { skip: process.env.DB_TEST !== '1' },
  async (t) => {
    const knex = require('knex')(require('../knexfile'));
    const db = require('../src/config/db');
    const createApp = require('../src/app');
    const { signToken } = require('../src/utils/token');

    const suffix = randomUUID().slice(0, 8);
    const ids = {
      customer: randomUUID(),
      stranger: randomUUID(),
      providerUser: randomUUID(),
      provider: randomUUID(),
      service: randomUUID(),
      active: randomUUID(),
      done: randomUUID(),
    };

    t.after(async () => {
      // booking_messages ikut terhapus lewat ON DELETE CASCADE.
      await knex('booking_status_history').whereIn('booking_id', [ids.active, ids.done]).del();
      await knex('bookings').whereIn('id', [ids.active, ids.done]).del();
      await knex('services').where({ id: ids.service }).del();
      await knex('provider_profiles').where({ id: ids.provider }).del();
      await knex('users').whereIn('id', [ids.customer, ids.stranger, ids.providerUser]).del();
      await deleteTestCategory(knex, suffix);
      await knex.destroy();
      await db.closePool();
    });

    await knex.migrate.latest();
    const category = await createTestCategory(knex, suffix);
    const user = (id, role, name, n) => ({
      id,
      role,
      full_name: name,
      email: `uji-chat-${n}-${suffix}@djc.test`,
      phone: `+62812999900${n}`,
      password_hash: 'x',
    });
    await knex('users').insert([
      user(ids.customer, 'customer', 'Uji Pelanggan Chat', 21),
      user(ids.stranger, 'customer', 'Uji Orang Lain', 22),
      user(ids.providerUser, 'provider', 'Uji Penyedia Chat', 23),
    ]);
    await knex('provider_profiles').insert({
      id: ids.provider,
      user_id: ids.providerUser,
      display_name: 'Uji Penyedia Chat',
      disability_type: 'tunarungu',
      alumni_reg_no: `UJI-C-${suffix}`,
      city: 'Kota Bandung',
      address_detail: 'Jl. Uji No. 3',
      lat: -6.9,
      lng: 107.6,
      public_lat: -6.9,
      public_lng: 107.6,
      verification_status: 'verified',
    });
    await knex('services').insert({
      id: ids.service,
      provider_id: ids.provider,
      category_id: category.id,
      title: 'Uji chat',
      pricing_type: 'fixed',
      price_amount: 50000,
      service_mode: 'at_provider',
    });
    const booking = (id, status, code) => ({
      id,
      code: `UJI-${code}-${suffix}`,
      customer_id: ids.customer,
      provider_id: ids.provider,
      service_id: ids.service,
      scheduled_date: '2026-11-09',
      start_time: '10:00',
      service_mode: 'at_provider',
      pricing_type_snapshot: 'fixed',
      unit_price_snapshot: 50000,
      quantity: 1,
      estimated_total: 50000,
      final_total: status === 'completed' ? 50000 : null,
      status,
    });
    await knex('bookings').insert([
      booking(ids.active, 'accepted', 'A'),
      booking(ids.done, 'completed', 'D'),
    ]);

    const app = createApp();
    const as = (id, role) => `Bearer ${signToken({ id, role }).token}`;
    const asCustomer = as(ids.customer, 'customer');
    const asProvider = as(ids.providerUser, 'provider');
    const url = `/api/v1/bookings/${ids.active}/messages`;

    for (let i = 1; i <= 4; i += 1) {
      const res = await request(app)
        .post(url)
        .set('Authorization', i % 2 ? asCustomer : asProvider)
        .send({ message_text: `Pesan ${i} <b>tebal</b>` });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.message_text, `Pesan ${i} tebal`);
    }

    const page1 = await request(app).get(`${url}?limit=3`).set('Authorization', asProvider);
    assert.equal(page1.status, 200, JSON.stringify(page1.body));
    assert.equal(page1.body.data.provider_disability_type, 'tunarungu');
    assert.deepEqual(
      page1.body.data.messages.map((m) => m.message_text),
      ['Pesan 2 tebal', 'Pesan 3 tebal', 'Pesan 4 tebal'],
    );
    assert.equal(page1.body.meta.has_more, true);
    const page2 = await request(app)
      .get(`${url}?limit=3&before_id=${page1.body.meta.next_before_id}`)
      .set('Authorization', asProvider);
    assert.deepEqual(
      page2.body.data.messages.map((m) => m.message_text),
      ['Pesan 1 tebal'],
    );
    assert.equal(page2.body.meta.has_more, false);

    const stranger = await request(app).get(url).set('Authorization', as(ids.stranger, 'customer'));
    assert.equal(stranger.status, 403);

    const closed = await request(app)
      .post(`/api/v1/bookings/${ids.done}/messages`)
      .set('Authorization', asCustomer)
      .send({ message_text: 'Halo?' });
    assert.equal(closed.status, 400);
    assert.equal(closed.body.error.code, 'CHAT_READ_ONLY');

    // Inbox customer: booking aktif dengan 2 pesan provider belum dibaca; booking selesai tanpa
    // pesan tidak muncul.
    const inbox = await request(app).get('/api/v1/chat/inbox').set('Authorization', asCustomer);
    assert.equal(inbox.status, 200, JSON.stringify(inbox.body));
    assert.equal(inbox.body.meta.total_items, 1);
    const [item] = inbox.body.data;
    assert.equal(item.booking.id, ids.active);
    assert.equal(item.unread_count, 2);
    assert.equal(item.last_message.message_text, 'Pesan 4 tebal');
    assert.equal(item.counterpart.disability_type, 'tunarungu');

    const read = await request(app).patch(`${url}/read`).set('Authorization', asCustomer);
    assert.equal(read.status, 200);
    assert.equal(read.body.data.count, 2);
    const rows = await knex('booking_messages')
      .where({ booking_id: ids.active })
      .orderBy('created_at');
    assert.deepEqual(
      rows.map((r) => [r.sender_role, Boolean(r.is_read), r.read_at !== null]),
      [
        ['customer', false, false],
        ['provider', true, true],
        ['customer', false, false],
        ['provider', true, true],
      ],
    );
    const after = await request(app).get('/api/v1/chat/inbox').set('Authorization', asCustomer);
    assert.equal(after.body.data[0].unread_count, 0);
    const providerInbox = await request(app)
      .get('/api/v1/chat/inbox')
      .set('Authorization', asProvider);
    assert.equal(providerInbox.body.data[0].unread_count, 2);
    assert.equal(providerInbox.body.data[0].counterpart.name, 'Uji Pelanggan Chat');

    // Constraint skema.
    await assert.rejects(
      knex('booking_messages').insert({
        id: randomUUID(),
        booking_id: ids.active,
        sender_id: null,
        sender_role: 'customer',
        message_text: 'tanpa pengirim',
      }),
      /booking_messages_sender_check/,
    );
    await assert.rejects(
      knex('booking_messages').insert({
        id: randomUUID(),
        booking_id: ids.active,
        sender_id: ids.customer,
        sender_role: 'customer',
        message_text: 'x',
        is_read: true,
      }),
      /booking_messages_read_check/,
    );
    await assert.rejects(
      knex('booking_messages').insert({
        id: randomUUID(),
        booking_id: ids.active,
        sender_id: ids.customer,
        sender_role: 'customer',
        message_text: '   ',
      }),
      /booking_messages_text_check/,
    );
  },
);
