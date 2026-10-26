// Tes upload foto profil dan portofolio provider tanpa jaringan: Cloudinary diganti versi
// palsu, repository diganti versi in-memory.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { randomUUID } = crypto;
const request = require('supertest');
const createApp = require('../src/app');
const { createCloudinary, sign } = require('../src/services/cloudinary');
const { signToken } = require('../src/utils/token');

const provider = { id: randomUUID(), role: 'provider', status: 'active' };
const customer = { id: randomUUID(), role: 'customer', status: 'active' };
const bearer = (user) => `Bearer ${signToken(user).token}`;

// PNG 1x1 piksel.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function fakeUsers(...list) {
  const rows = new Map(list.map((user) => [user.id, user]));
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
  };
}

function fakeProviders() {
  const profile = { id: randomUUID(), user_id: provider.id, photo_url: null, photo_alt: null };
  const portfolio = [];
  return {
    profile,
    portfolio,
    async findOwnByUserId(userId) {
      return userId === profile.user_id ? { ...profile } : null;
    },
    async updatePhoto(profileId, { url, alt }) {
      assert.equal(profileId, profile.id);
      Object.assign(profile, { photo_url: url, photo_alt: alt });
    },
    async listPortfolio() {
      return portfolio;
    },
    async createPortfolioItem(profileId, { title, description, itemType, imageUrl, imageAlt }) {
      const item = {
        id: randomUUID(),
        title,
        description,
        item_type: itemType,
        image_url: imageUrl,
        image_alt: imageAlt,
        sort_order: portfolio.length,
      };
      portfolio.push(item);
      return item;
    },
    async deletePortfolioItem(profileId, itemId) {
      const index = portfolio.findIndex((item) => item.id === itemId);
      if (index < 0) return false;
      portfolio.splice(index, 1);
      return true;
    },
  };
}

/** Cloudinary palsu yang mencatat setiap upload. `fail` mensimulasikan error dari Cloudinary. */
function fakeCloudinary({ configured = true, fail = false } = {}) {
  const uploads = [];
  return {
    uploads,
    configured,
    async uploadImage({ dataUri, folder }) {
      uploads.push({ dataUri, folder });
      if (fail) throw new Error('upload Cloudinary gagal (401 Invalid Signature)');
      return {
        url: `https://res.cloudinary.com/demo/image/upload/${folder}/${uploads.length}.webp`,
        bytes: 1234,
        format: 'webp',
      };
    },
  };
}

function setup(cloudinaryOptions) {
  const providers = fakeProviders();
  const cloudinary = fakeCloudinary(cloudinaryOptions);
  const app = createApp({ providers, cloudinary, users: fakeUsers(provider, customer) });
  return { app, providers, cloudinary };
}

test('PUT /provider/photo mengunggah foto lalu menyimpan URL HTTPS dan teks alternatif', async () => {
  const { app, providers, cloudinary } = setup();

  const res = await request(app)
    .put('/api/v1/provider/photo')
    .set('Authorization', bearer(provider))
    .send({ image: PNG, image_alt: '  Foto Deni tersenyum di bengkel  ' });

  assert.equal(res.status, 200);
  assert.match(res.body.data.photo_url, /^https:\/\/res\.cloudinary\.com\/.+\.webp$/);
  assert.equal(res.body.data.photo_alt, 'Foto Deni tersenyum di bengkel');
  assert.equal(providers.profile.photo_url, res.body.data.photo_url);
  assert.equal(cloudinary.uploads[0].folder, `djc/providers/${providers.profile.id}`);
});

test('upload tanpa teks alternatif atau hanya spasi ditolak 400 sebelum ke Cloudinary', async () => {
  const { app, cloudinary } = setup();

  for (const body of [{ image: PNG }, { image: PNG, image_alt: '   ' }]) {
    const res = await request(app)
      .put('/api/v1/provider/photo')
      .set('Authorization', bearer(provider))
      .send(body);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.details[0].field, 'image_alt');
  }

  const portfolio = await request(app)
    .post('/api/v1/provider/portfolio')
    .set('Authorization', bearer(provider))
    .send({ image: PNG, image_alt: '', title: 'Kipas', item_type: 'work_result' });
  assert.equal(portfolio.status, 400);
  assert.ok(portfolio.body.error.details.some((detail) => detail.field === 'image_alt'));
  assert.equal(cloudinary.uploads.length, 0);
});

test('validasi gambar: bukan data URI, tipe bukan gambar, dan lebih dari 5 MB ditolak 400', async () => {
  const { app, cloudinary } = setup();
  const put = (image) =>
    request(app)
      .put('/api/v1/provider/photo')
      .set('Authorization', bearer(provider))
      .send({ image, image_alt: 'Foto' });

  assert.equal((await put('https://contoh.com/foto.jpg')).status, 400);
  assert.equal((await put('data:application/pdf;base64,JVBERi0xLjQ=')).status, 400);

  // 5 MB + 3 byte setelah di-decode (~7 MB base64): lolos parser upload, ditolak validasi.
  const tooBig = `data:image/jpeg;base64,${Buffer.alloc(5 * 1024 * 1024 + 3).toString('base64')}`;
  const big = await put(tooBig);
  assert.equal(big.status, 400);
  assert.match(big.body.error.details[0].message, /5 MB/);
  assert.equal(cloudinary.uploads.length, 0);
});

test('portofolio: tambah, lihat daftar, dan hapus karya milik sendiri', async () => {
  const { app } = setup();
  const auth = bearer(provider);

  const created = await request(app)
    .post('/api/v1/provider/portfolio')
    .set('Authorization', auth)
    .send({
      image: PNG,
      image_alt: 'Kipas angin berdiri yang sudah diperbaiki di atas meja kerja',
      title: 'Perbaikan kipas angin',
      description: 'Ganti kapasitor dan bearing.',
      item_type: 'work_result',
    });
  assert.equal(created.status, 201);
  assert.match(created.body.data.image_url, /^https:\/\//);
  assert.equal(created.body.data.item_type, 'work_result');

  const list = await request(app).get('/api/v1/provider/portfolio').set('Authorization', auth);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);

  const removed = await request(app)
    .delete(`/api/v1/provider/portfolio/${created.body.data.id}`)
    .set('Authorization', auth);
  assert.equal(removed.status, 200);

  for (const id of [created.body.data.id, 'bukan-uuid']) {
    const missing = await request(app)
      .delete(`/api/v1/provider/portfolio/${id}`)
      .set('Authorization', auth);
    assert.equal(missing.status, 404);
  }
});

test('Cloudinary belum dikonfigurasi atau gagal: 503 SERVICE_UNAVAILABLE', async () => {
  for (const options of [{ configured: false }, { fail: true }]) {
    const { app, providers } = setup(options);
    const res = await request(app)
      .put('/api/v1/provider/photo')
      .set('Authorization', bearer(provider))
      .send({ image: PNG, image_alt: 'Foto' });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(providers.profile.photo_url, null);
  }
});

test('endpoint upload: 401 tanpa token, 403 untuk customer, 403 untuk provider suspended', async () => {
  const suspended = { id: randomUUID(), role: 'provider', status: 'suspended' };
  const app = createApp({
    providers: fakeProviders(),
    cloudinary: fakeCloudinary(),
    users: fakeUsers(provider, customer, suspended),
  });
  const body = { image: PNG, image_alt: 'Foto' };

  assert.equal((await request(app).put('/api/v1/provider/photo').send(body)).status, 401);

  const asCustomer = await request(app)
    .put('/api/v1/provider/photo')
    .set('Authorization', bearer(customer))
    .send(body);
  assert.equal(asCustomer.status, 403);

  const asSuspended = await request(app)
    .post('/api/v1/provider/portfolio')
    .set('Authorization', bearer(suspended))
    .send({ ...body, title: 'Karya', item_type: 'work_result' });
  assert.equal(asSuspended.status, 403);
  assert.equal(asSuspended.body.error.code, 'ACCOUNT_SUSPENDED');
});

test('endpoint lain tetap dibatasi body JSON 1 MB', async () => {
  const { app } = setup();
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'a@b.c', password: 'x'.repeat(1.5 * 1024 * 1024) });
  assert.equal(res.status, 413);
});

test('Cloudinary: request upload bertanda tangan, format WebP, maks 1200 px', async () => {
  const calls = [];
  const cloudinary = createCloudinary({
    config: { cloudName: 'demo', apiKey: 'key123', apiSecret: 'rahasia' },
    fetchImpl: async (url, options) => {
      calls.push({ url, body: Object.fromEntries(options.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/djc/x.webp',
          public_id: 'djc/x',
          bytes: 45678,
          width: 1200,
          height: 900,
          format: 'webp',
        }),
      };
    },
  });

  const result = await cloudinary.uploadImage({ dataUri: PNG, folder: 'djc/providers/p1' });

  assert.equal(result.url, 'https://res.cloudinary.com/demo/image/upload/v1/djc/x.webp');
  const { url, body } = calls[0];
  assert.equal(url, 'https://api.cloudinary.com/v1_1/demo/image/upload');
  assert.equal(body.file, PNG);
  assert.equal(body.api_key, 'key123');
  assert.equal(body.format, 'webp');
  assert.equal(body.folder, 'djc/providers/p1');
  assert.equal(body.transformation, 'c_limit,w_1200,h_1200/q_auto:good');
  assert.equal(body.api_secret, undefined, 'secret tidak pernah dikirim');
  const expected = crypto
    .createHash('sha1')
    .update(
      `folder=${body.folder}&format=webp&timestamp=${body.timestamp}&transformation=${body.transformation}rahasia`,
    )
    .digest('hex');
  assert.equal(body.signature, expected);
  assert.equal(
    sign({ b: 2, a: 1 }, 's'),
    crypto.createHash('sha1').update('a=1&b=2s').digest('hex'),
  );
});

test('Cloudinary: respons error menjadi exception tanpa membocorkan secret', async () => {
  const cloudinary = createCloudinary({
    config: { cloudName: 'demo', apiKey: 'key123', apiSecret: 'rahasia' },
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid Signature' } }),
    }),
  });

  await assert.rejects(cloudinary.uploadImage({ dataUri: PNG, folder: 'x' }), (error) => {
    assert.match(error.message, /401 Invalid Signature/);
    assert.doesNotMatch(error.message, /rahasia/);
    return true;
  });
  assert.equal(
    createCloudinary({ config: { cloudName: 'demo', apiKey: '', apiSecret: '' } }).configured,
    false,
  );
});
