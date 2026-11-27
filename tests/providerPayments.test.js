// Tes tujuan pembayaran penyedia (rekening bank, e-wallet, QRIS) tanpa MySQL dan Cloudinary.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const createApp = require('../src/app');
const { signToken } = require('../src/utils/token');

const provider = { id: randomUUID(), role: 'provider', status: 'active' };
const otherProvider = { id: randomUUID(), role: 'provider', status: 'active' };
const customer = { id: randomUUID(), role: 'customer', status: 'active' };
const bearer = (user) => `Bearer ${signToken(user).token}`;

// PNG 1x1 piksel.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function setup() {
  const profiles = new Map(
    [provider, otherProvider].map((user) => [user.id, { id: randomUUID(), user_id: user.id }]),
  );
  const rows = [];
  const paymentAccounts = {
    rows,
    async listByProvider(providerId) {
      return rows.filter((row) => row.provider_id === providerId).map((row) => ({ ...row }));
    },
    async create(providerId, data) {
      const row = {
        id: randomUUID(),
        provider_id: providerId,
        account_number: null,
        account_holder: null,
        qris_image_url: null,
        ...data,
      };
      rows.push(row);
      return { ...row };
    },
    async findOwn(providerId, id) {
      return rows.find((row) => row.id === id && row.provider_id === providerId) ?? null;
    },
    async remove(providerId, id) {
      const index = rows.findIndex((row) => row.id === id && row.provider_id === providerId);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
  };
  const uploads = [];
  const destroyed = [];
  const cloudinary = {
    configured: true,
    uploads,
    destroyed,
    async uploadImage({ folder }) {
      uploads.push(folder);
      return { url: `https://res.cloudinary.com/demo/image/upload/${folder}/q.webp` };
    },
    async destroyImage(url) {
      destroyed.push(url);
      return true;
    },
  };
  const providers = {
    async findOwnByUserId(userId) {
      return profiles.get(userId) ?? null;
    },
  };
  const users = {
    async findById(id) {
      return [provider, otherProvider, customer].find((u) => u.id === id) ?? null;
    },
  };
  const app = createApp({ providers, paymentAccounts, cloudinary, users });
  return { app, paymentAccounts, cloudinary, profiles };
}

const post = (app, body, user = provider) =>
  request(app)
    .post('/api/v1/provider/payment-accounts')
    .set('Authorization', bearer(user))
    .send(body);

test('penyedia menambah rekening bank, e-wallet, dan QRIS lalu melihat daftarnya', async () => {
  const { app, cloudinary } = setup();

  const bank = await post(app, {
    type: 'bank',
    provider_name: 'BCA',
    account_number: '1234-5678 90',
    account_holder: 'Deni Saputra',
  });
  assert.equal(bank.status, 201, JSON.stringify(bank.body));
  assert.equal(bank.body.data.account_number, '1234567890', 'spasi dan strip dibuang');

  const ewallet = await post(app, {
    type: 'ewallet',
    provider_name: 'DANA',
    account_number: '081234567890',
    account_holder: 'Deni Saputra',
  });
  assert.equal(ewallet.status, 201);

  const qris = await post(app, { type: 'qris', image: PNG });
  assert.equal(qris.status, 201, JSON.stringify(qris.body));
  assert.match(qris.body.data.qris_image_url, /^https:\/\/res\.cloudinary\.com\//);
  assert.equal(qris.body.data.provider_name, 'QRIS');
  assert.equal(cloudinary.uploads.length, 1);

  const list = await request(app)
    .get('/api/v1/provider/payment-accounts')
    .set('Authorization', bearer(provider));
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 3);

  const others = await request(app)
    .get('/api/v1/provider/payment-accounts')
    .set('Authorization', bearer(otherProvider));
  assert.deepEqual(others.body.data, []);
});

test('validasi tujuan pembayaran dan batas 5', async () => {
  const { app } = setup();
  const cases = [
    [{ type: 'bank', provider_name: 'BCA', account_number: '12ab', account_holder: 'Deni' }],
    [{ type: 'bank', provider_name: 'BCA', account_number: '1234567890' }],
    [{ type: 'qris' }],
    [{ type: 'paypal', provider_name: 'X' }],
  ];
  for (const [body] of cases) {
    assert.equal((await post(app, body)).status, 400, JSON.stringify(body));
  }

  const valid = {
    type: 'bank',
    provider_name: 'BRI',
    account_number: '1234567890',
    account_holder: 'Deni',
  };
  for (let i = 0; i < 5; i += 1) assert.equal((await post(app, valid)).status, 201);
  assert.equal((await post(app, valid)).status, 409);
  assert.equal((await post(app, valid, customer)).status, 403);
});

test('hapus tujuan pembayaran milik sendiri saja; gambar QRIS ikut dihapus', async () => {
  const { app, cloudinary } = setup();
  const qris = (await post(app, { type: 'qris', image: PNG })).body.data;
  const del = (id, user = provider) =>
    request(app)
      .delete(`/api/v1/provider/payment-accounts/${id}`)
      .set('Authorization', bearer(user));

  assert.equal((await del(qris.id, otherProvider)).status, 404);
  assert.equal((await del('bukan-uuid')).status, 404);
  assert.equal((await del(qris.id)).status, 200);
  assert.deepEqual(cloudinary.destroyed, [qris.qris_image_url]);
  assert.equal((await del(qris.id)).status, 404);
});
