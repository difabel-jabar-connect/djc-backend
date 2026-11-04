// Tes chat per booking (BE-10, issue #32) tanpa MySQL: repository chat diganti versi
// in-memory. Bagian Socket.io memakai server HTTP sungguhan di port acak.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { io: connect } = require('socket.io-client');
const createApp = require('../src/app');
const { signToken } = require('../src/utils/token');
const { createChatHub, sanitizeText } = require('../src/services/chat');
const { attachChatSocket, parseCookies } = require('../src/realtime/chatSocket');

const customer = { id: randomUUID(), role: 'customer', status: 'active' };
const otherCustomer = { id: randomUUID(), role: 'customer', status: 'active' };
const providerUser = { id: randomUUID(), role: 'provider', status: 'active' };
const otherProviderUser = { id: randomUUID(), role: 'provider', status: 'active' };
const admin = { id: randomUUID(), role: 'admin', status: 'active' };
const suspended = { id: randomUUID(), role: 'customer', status: 'suspended' };
const PROVIDER_ID = randomUUID();

const bearer = (user) => `Bearer ${signToken(user).token}`;

function fakeUsers() {
  const rows = new Map(
    [customer, otherCustomer, providerUser, otherProviderUser, admin, suspended].map((u) => [
      u.id,
      u,
    ]),
  );
  return { findById: async (id) => rows.get(id) ?? null };
}

/** Repository chat in-memory dengan aturan urutan dan unread yang sama seperti versi MySQL. */
function fakeChat() {
  const bookings = new Map();
  const messages = [];
  let clock = Date.parse('2026-11-04T01:00:00Z');

  const addBooking = (status, { customerId = customer.id } = {}) => {
    const booking = {
      id: randomUUID(),
      code: `DJC-${bookings.size + 1}`,
      status,
      customer_id: customerId,
      provider_id: PROVIDER_ID,
      provider_user_id: providerUser.id,
      provider_disability_type: 'tunarungu',
    };
    bookings.set(booking.id, booking);
    return booking;
  };

  const repo = {
    addBooking,
    messages,
    findBooking: async (id) => bookings.get(id) ?? null,
    findMessage: async (bookingId, id) =>
      messages.find((m) => m.booking_id === bookingId && m.id === id) ?? null,
    listMessages: async (bookingId, { limit, before }) => {
      const all = messages.filter(
        (m) => m.booking_id === bookingId && (!before || m.created_at < before.created_at),
      );
      const page = all.slice(-limit);
      return { items: page, hasMore: all.length > limit };
    },
    createMessage: async ({ bookingId, senderId, senderRole, text }) => {
      clock += 1000;
      const message = {
        id: randomUUID(),
        booking_id: bookingId,
        sender_id: senderId,
        sender_role: senderRole,
        message_text: text,
        is_read: false,
        read_at: null,
        created_at: new Date(clock),
      };
      messages.push(message);
      return message;
    },
    markRead: async (bookingId, readerId, readAt) => {
      let count = 0;
      for (const m of messages) {
        if (m.booking_id === bookingId && !m.is_read && m.sender_id !== readerId) {
          m.is_read = true;
          m.read_at = readAt;
          count += 1;
        }
      }
      return { count, readAt };
    },
    inbox: async ({ userId, role }) => {
      const mine = [...bookings.values()].filter((b) =>
        role === 'customer' ? b.customer_id === userId : b.provider_user_id === userId,
      );
      const items = mine.map((b) => {
        const own = messages.filter((m) => m.booking_id === b.id);
        const last = own.at(-1);
        return {
          booking_id: b.id,
          code: b.code,
          status: b.status,
          service_title: 'Servis kipas',
          provider_display_name: 'Siti Rahmawati',
          provider_disability_type: b.provider_disability_type,
          customer_full_name: 'Budi Santoso',
          was_accepted: b.status !== 'requested',
          last_id: last?.id,
          last_sender_id: last?.sender_id,
          last_sender_role: last?.sender_role,
          last_text: last?.message_text,
          last_created_at: last?.created_at,
          unread_count: own.filter((m) => !m.is_read && m.sender_id !== userId).length,
        };
      });
      return { items, total: items.length };
    },
  };
  return repo;
}

function setup() {
  const chat = fakeChat();
  const chatHub = createChatHub();
  const users = fakeUsers();
  const app = createApp({ chat, chatHub, users, pingDb: async () => ({}) });
  return { app, chat, chatHub, users };
}

test('sanitizeText membuang tag HTML, script, dan karakter kontrol', () => {
  assert.equal(sanitizeText('<script>alert(1)</script>Halo <b>Pak</b>'), 'Halo Pak');
  assert.equal(sanitizeText('<scr<b>ipt>x'), 'x');
  assert.equal(sanitizeText('  aku <3 kamu\u0000  '), 'aku <3 kamu');
  assert.equal(sanitizeText('baris 1\r\nbaris 2'), 'baris 1\nbaris 2');
  assert.equal(sanitizeText('<img src=x onerror=alert(1)>'), '');
});

test('parseCookies membaca cookie djc_token dari header handshake', () => {
  assert.deepEqual(parseCookies('a=1; djc_token=abc%20d'), { a: '1', djc_token: 'abc d' });
});

test('riwayat pesan: otorisasi partisipan dan data aksesibilitas', async () => {
  const { app, chat } = setup();
  const booking = chat.addBooking('accepted');
  const url = `/api/v1/bookings/${booking.id}/messages`;

  assert.equal((await request(app).get(url)).status, 401);
  for (const user of [otherCustomer, otherProviderUser]) {
    const res = await request(app).get(url).set('Authorization', bearer(user));
    assert.equal(res.status, 403, 'bukan partisipan');
    assert.equal(res.body.error.code, 'FORBIDDEN');
  }
  const missing = await request(app)
    .get(`/api/v1/bookings/${randomUUID()}/messages`)
    .set('Authorization', bearer(customer));
  assert.equal(missing.status, 404);
  const invalid = await request(app)
    .get('/api/v1/bookings/bukan-uuid/messages')
    .set('Authorization', bearer(customer));
  assert.equal(invalid.status, 404);

  for (const user of [customer, providerUser, admin]) {
    const res = await request(app).get(url).set('Authorization', bearer(user));
    assert.equal(res.status, 200, user.role);
    assert.equal(res.body.data.provider_disability_type, 'tunarungu');
    assert.deepEqual(res.body.data.messages, []);
    assert.equal(res.body.data.booking.can_send, user.role !== 'admin');
  }
});

test('kirim pesan: validasi, sanitasi, read-only, admin, dan akun suspended', async () => {
  const { app, chat } = setup();
  const active = chat.addBooking('in_progress');
  const url = `/api/v1/bookings/${active.id}/messages`;

  const sent = await request(app)
    .post(url)
    .set('Authorization', bearer(customer))
    .send({ message_text: '<script>alert(1)</script>Halo <b>Bu Siti</b>' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.data.message_text, 'Halo Bu Siti');
  assert.equal(sent.body.data.sender_role, 'customer');
  assert.equal(sent.body.data.sender_id, customer.id);
  assert.equal(sent.body.data.is_read, false);

  const reply = await request(app)
    .post(url)
    .set('Authorization', bearer(providerUser))
    .send({ message_text: 'Baik Pak.' });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.data.sender_role, 'provider');

  for (const [body, why] of [
    [{}, 'tanpa message_text'],
    [{ message_text: '   ' }, 'kosong'],
    [{ message_text: '<b></b>' }, 'kosong setelah sanitasi'],
    [{ message_text: 'a'.repeat(1001) }, 'lebih dari 1000 karakter'],
  ]) {
    const res = await request(app).post(url).set('Authorization', bearer(customer)).send(body);
    assert.equal(res.status, 400, why);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR', why);
  }
  const max = await request(app)
    .post(url)
    .set('Authorization', bearer(customer))
    .send({ message_text: 'a'.repeat(1000) });
  assert.equal(max.status, 201, 'tepat 1000 karakter boleh');

  const asAdmin = await request(app)
    .post(url)
    .set('Authorization', bearer(admin))
    .send({ message_text: 'Halo' });
  assert.equal(asAdmin.status, 403);

  const stranger = await request(app)
    .post(url)
    .set('Authorization', bearer(otherCustomer))
    .send({ message_text: 'Halo' });
  assert.equal(stranger.status, 403);

  const mine = chat.addBooking('accepted', { customerId: suspended.id });
  const frozen = await request(app)
    .post(`/api/v1/bookings/${mine.id}/messages`)
    .set('Authorization', bearer(suspended))
    .send({ message_text: 'Halo' });
  assert.equal(frozen.status, 403);
  assert.equal(frozen.body.error.code, 'ACCOUNT_SUSPENDED');
  const frozenRead = await request(app)
    .get(`/api/v1/bookings/${mine.id}/messages`)
    .set('Authorization', bearer(suspended));
  assert.equal(frozenRead.status, 200, 'akun suspended tetap boleh membaca');

  for (const status of ['completed', 'cancelled', 'rejected']) {
    const closed = chat.addBooking(status);
    const res = await request(app)
      .post(`/api/v1/bookings/${closed.id}/messages`)
      .set('Authorization', bearer(customer))
      .send({ message_text: 'Masih bisa?' });
    assert.equal(res.status, 400, status);
    assert.equal(res.body.error.code, 'CHAT_READ_ONLY', status);
  }
  for (const status of ['requested', 'accepted']) {
    const open = chat.addBooking(status);
    const res = await request(app)
      .post(`/api/v1/bookings/${open.id}/messages`)
      .set('Authorization', bearer(providerUser))
      .send({ message_text: 'Halo' });
    assert.equal(res.status, 201, status);
  }
});

test('paginasi riwayat dengan limit dan before_id', async () => {
  const { app, chat } = setup();
  const booking = chat.addBooking('accepted');
  const url = `/api/v1/bookings/${booking.id}/messages`;
  for (let i = 1; i <= 5; i += 1) {
    await request(app)
      .post(url)
      .set('Authorization', bearer(customer))
      .send({ message_text: `Pesan ${i}` });
  }

  const first = await request(app).get(`${url}?limit=2`).set('Authorization', bearer(providerUser));
  assert.deepEqual(
    first.body.data.messages.map((m) => m.message_text),
    ['Pesan 4', 'Pesan 5'],
  );
  assert.equal(first.body.meta.has_more, true);

  const second = await request(app)
    .get(`${url}?limit=2&before_id=${first.body.meta.next_before_id}`)
    .set('Authorization', bearer(providerUser));
  assert.deepEqual(
    second.body.data.messages.map((m) => m.message_text),
    ['Pesan 2', 'Pesan 3'],
  );

  const bad = await request(app)
    .get(`${url}?before_id=${randomUUID()}`)
    .set('Authorization', bearer(providerUser));
  assert.equal(bad.status, 400);
  const tooMany = await request(app)
    .get(`${url}?limit=500`)
    .set('Authorization', bearer(providerUser));
  assert.equal(tooMany.status, 400);
});

test('tandai dibaca hanya pesan yang diterima, lalu inbox menghitung unread', async () => {
  const { app, chat } = setup();
  const booking = chat.addBooking('accepted');
  const url = `/api/v1/bookings/${booking.id}/messages`;
  await request(app)
    .post(url)
    .set('Authorization', bearer(customer))
    .send({ message_text: 'Satu' });
  await request(app).post(url).set('Authorization', bearer(customer)).send({ message_text: 'Dua' });
  await request(app)
    .post(url)
    .set('Authorization', bearer(providerUser))
    .send({ message_text: 'Balasan' });

  const inbox = await request(app).get('/api/v1/chat/inbox').set('Authorization', bearer(customer));
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.data[0].unread_count, 1);
  assert.equal(inbox.body.data[0].counterpart.role, 'provider');
  assert.equal(inbox.body.data[0].counterpart.disability_type, 'tunarungu');
  assert.equal(inbox.body.data[0].last_message.message_text, 'Balasan');
  assert.equal(inbox.body.data[0].can_send, true);

  const read = await request(app).patch(`${url}/read`).set('Authorization', bearer(providerUser));
  assert.equal(read.status, 200);
  assert.equal(read.body.data.count, 2);
  assert.equal(read.body.data.reader_role, 'provider');
  assert.deepEqual(
    chat.messages.map((m) => [m.message_text, m.is_read]),
    [
      ['Satu', true],
      ['Dua', true],
      ['Balasan', false],
    ],
  );

  const providerInbox = await request(app)
    .get('/api/v1/chat/inbox')
    .set('Authorization', bearer(providerUser));
  assert.equal(providerInbox.body.data[0].unread_count, 0);
  assert.equal(providerInbox.body.data[0].counterpart.name, 'Budi Santoso');

  assert.equal(
    (await request(app).patch(`${url}/read`).set('Authorization', bearer(admin))).status,
    403,
  );
  assert.equal(
    (await request(app).get('/api/v1/chat/inbox').set('Authorization', bearer(admin))).status,
    403,
  );
  assert.equal((await request(app).get('/api/v1/chat/inbox')).status, 401);
});

// --- Socket.io ---

async function startSocketServer() {
  const ctx = setup();
  const server = ctx.app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const io = attachChatSocket(server, {
    chatHub: ctx.chatHub,
    chat: ctx.chat,
    users: ctx.users,
    corsOrigins: ['http://localhost:5173'],
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  const client = (options) => {
    const socket = connect(url, { transports: ['websocket'], reconnection: false, ...options });
    clients.push(socket);
    return socket;
  };
  const close = async () => {
    for (const socket of clients) socket.disconnect();
    await new Promise((resolve) => io.close(resolve));
  };
  return { ...ctx, url, client, close };
}

const connected = (socket) =>
  new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
const emit = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));
const next = (socket, event) => new Promise((resolve) => socket.once(event, resolve));
const tokenOf = (user) => signToken(user).token;

test('socket: handshake wajib login (auth token atau cookie djc_token)', async (t) => {
  const ctx = await startSocketServer();
  t.after(ctx.close);

  const anonymous = ctx.client();
  const error = await new Promise((resolve) => anonymous.once('connect_error', resolve));
  assert.equal(error.data?.code, 'UNAUTHENTICATED');

  const viaCookie = ctx.client({ extraHeaders: { cookie: `djc_token=${tokenOf(customer)}` } });
  await connected(viaCookie);
  const viaAuth = ctx.client({ auth: { token: tokenOf(providerUser) } });
  await connected(viaAuth);
});

test('socket: room, pesan real-time, typing, read receipt, dan read-only', async (t) => {
  const ctx = await startSocketServer();
  t.after(ctx.close);
  const booking = ctx.chat.addBooking('accepted');
  const done = ctx.chat.addBooking('completed');

  const alice = ctx.client({ auth: { token: tokenOf(customer) } });
  const bob = ctx.client({ auth: { token: tokenOf(providerUser) } });
  const eve = ctx.client({ auth: { token: tokenOf(otherCustomer) } });
  await Promise.all([connected(alice), connected(bob), connected(eve)]);

  const denied = await emit(eve, 'join_room', { booking_id: booking.id });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'FORBIDDEN');
  const sneaky = await emit(eve, 'send_message', { booking_id: booking.id, text: 'Halo' });
  assert.equal(sneaky.error.code, 'FORBIDDEN', 'bukan partisipan tidak bisa kirim');

  const joined = await emit(alice, 'join_room', { booking_id: booking.id });
  assert.deepEqual(joined.data, { booking_id: booking.id, status: 'accepted', can_send: true });
  assert.equal((await emit(bob, 'join_room', { booking_id: booking.id })).ok, true);

  // send_message → kedua peserta menerima new_message; penerima juga dapat inbox_updated.
  const bobReceives = next(bob, 'new_message');
  const bobInbox = next(bob, 'inbox_updated');
  const aliceEcho = next(alice, 'new_message');
  const ack = await emit(alice, 'send_message', {
    booking_id: booking.id,
    text: 'Halo <i>Bu</i>, sudah di jalan?',
  });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  const received = await bobReceives;
  assert.equal(received.message_text, 'Halo Bu, sudah di jalan?');
  assert.equal(received.sender_role, 'customer');
  assert.equal((await aliceEcho).id, received.id);
  assert.equal((await bobInbox).booking_id, booking.id);

  // typing → hanya peserta lain yang menerima user_typing.
  let aliceSawOwnTyping = false;
  alice.on('user_typing', () => {
    aliceSawOwnTyping = true;
  });
  const typing = next(bob, 'user_typing');
  await emit(alice, 'typing', { booking_id: booking.id, is_typing: true });
  assert.deepEqual(await typing, {
    booking_id: booking.id,
    user_id: customer.id,
    role: 'customer',
    is_typing: true,
  });
  assert.equal(aliceSawOwnTyping, false);
  const typingElsewhere = await emit(eve, 'typing', { booking_id: booking.id, is_typing: true });
  assert.equal(typingElsewhere.ok, false);

  // mark_read → pengirim menerima messages_read.
  const receipt = next(alice, 'messages_read');
  const marked = await emit(bob, 'mark_read', { booking_id: booking.id });
  assert.equal(marked.data.count, 1);
  const readEvent = await receipt;
  assert.equal(readEvent.reader_id, providerUser.id);
  assert.equal(readEvent.count, 1);
  assert.equal(ctx.chat.messages[0].is_read, true);

  // Pesan dari REST ikut di-broadcast ke room.
  const fromRest = next(alice, 'new_message');
  const res = await request(ctx.url)
    .post(`/api/v1/bookings/${booking.id}/messages`)
    .set('Authorization', bearer(providerUser))
    .send({ message_text: 'Sudah, 10 menit lagi sampai.' });
  assert.equal(res.status, 201);
  assert.equal((await fromRest).message_text, 'Sudah, 10 menit lagi sampai.');

  // Booking selesai: boleh gabung dan baca, kirim ditolak 400 CHAT_READ_ONLY.
  const doneJoin = await emit(alice, 'join_room', { booking_id: done.id });
  assert.equal(doneJoin.data.can_send, false);
  const closed = await emit(alice, 'send_message', { booking_id: done.id, text: 'Halo?' });
  assert.equal(closed.ok, false);
  assert.equal(closed.error.code, 'CHAT_READ_ONLY');

  // Tanpa ack, error dikirim sebagai chat_error.
  const chatError = next(alice, 'chat_error');
  alice.emit('send_message', { booking_id: done.id, text: 'Tanpa ack' });
  const errorEvent = await chatError;
  assert.equal(errorEvent.event, 'send_message');
  assert.equal(errorEvent.code, 'CHAT_READ_ONLY');
});
