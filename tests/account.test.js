// Tes endpoint Akun Saya (/me) tanpa MySQL: repository user & alamat diganti versi in-memory.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const createApp = require('../src/app');
const { signToken } = require('../src/utils/token');
const { MAX_ADDRESSES } = require('../src/routes/account');

function fakeUsers(...list) {
  const rows = new Map(list.map((user) => [user.id, user]));
  return {
    rows,
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async updateAccount(id, changes) {
      const user = rows.get(id);
      if (changes.name !== undefined) user.full_name = changes.name;
      if (changes.phone !== undefined) user.phone = changes.phone;
      return user;
    },
    async updatePassword(id, passwordHash, options) {
      const user = rows.get(id);
      user.password_hash = passwordHash;
      user.has_password = true;
      user.lastPasswordOptions = options;
    },
    async updateAvatar(id, url) {
      rows.get(id).avatar_url = url;
    },
  };
}

// Meniru aturan addressRepository: satu alamat utama, alamat pertama otomatis utama.
function fakeAddresses() {
  const rows = [];
  let tick = 0;
  const own = (userId) => rows.filter((row) => row.user_id === userId);
  const sorted = (list) =>
    [...list].sort((a, b) => b.is_primary - a.is_primary || b.created_at - a.created_at);
  return {
    rows,
    async listByUser(userId) {
      return sorted(own(userId));
    },
    async countByUser(userId) {
      return own(userId).length;
    },
    async create(userId, address) {
      const isPrimary = Boolean(address.isPrimary) || own(userId).length === 0;
      if (isPrimary) own(userId).forEach((row) => (row.is_primary = false));
      const row = {
        id: randomUUID(),
        user_id: userId,
        label: address.label,
        address_text: address.addressText,
        detail: address.detail ?? null,
        area: address.area ?? null,
        lat: String(address.lat),
        lng: String(address.lng),
        is_primary: isPrimary,
        created_at: (tick += 1),
      };
      rows.push(row);
      return row;
    },
    async update(userId, id, changes) {
      const row = own(userId).find((item) => item.id === id);
      if (!row) return null;
      const columns = {
        label: 'label',
        addressText: 'address_text',
        detail: 'detail',
        area: 'area',
      };
      for (const [key, column] of Object.entries(columns)) {
        if (changes[key] !== undefined) row[column] = changes[key];
      }
      if (changes.lat !== undefined) Object.assign(row, { lat: changes.lat, lng: changes.lng });
      if (changes.isPrimary === true) {
        own(userId).forEach((item) => (item.is_primary = false));
        row.is_primary = true;
      }
      return row;
    },
    async remove(userId, id) {
      const index = rows.findIndex((row) => row.id === id && row.user_id === userId);
      if (index < 0) return false;
      const [removed] = rows.splice(index, 1);
      if (removed.is_primary) {
        const next = sorted(own(userId))[0];
        if (next) next.is_primary = true;
      }
      return true;
    },
  };
}

function fakeCloudinary({ configured = true, fail = false } = {}) {
  const uploads = [];
  return {
    uploads,
    configured,
    async uploadImage(args) {
      if (fail) throw new Error('down');
      uploads.push(args);
      return { url: `https://res.cloudinary.test/${args.folder}/foto.webp` };
    },
  };
}

async function makeUser(overrides = {}) {
  return {
    id: randomUUID(),
    role: 'customer',
    full_name: 'Budi Santoso',
    email: 'budi@djc.test',
    phone: '+6281200000010',
    avatar_url: null,
    password_hash: await bcrypt.hash('Demo12345', 4),
    has_password: true,
    status: 'active',
    email_verified_at: new Date(),
    ...overrides,
  };
}

function setup(user, extra = {}) {
  const users = fakeUsers(user);
  const addresses = fakeAddresses();
  const cloudinary = extra.cloudinary ?? fakeCloudinary();
  const app = createApp({ users, addresses, cloudinary });
  const token = signToken(user).token;
  const as = (method, path) =>
    request(app)[method](`/api/v1/me${path}`).set('Authorization', `Bearer ${token}`);
  return { app, users, addresses, cloudinary, as };
}

const address = {
  label: 'Rumah',
  address: 'Jl. Cigadung Raya No. 12, Cibeunying Kaler, Bandung',
  detail: 'Pagar hijau',
  area: 'Cibeunying Kaler',
  lat: -6.8765,
  lng: 107.6234,
};

test('semua endpoint /me wajib login', async () => {
  const app = createApp({ users: fakeUsers(), addresses: fakeAddresses() });
  for (const [method, path] of [
    ['patch', ''],
    ['put', '/password'],
    ['get', '/addresses'],
    ['post', '/addresses'],
  ]) {
    const res = await request(app)[method](`/api/v1/me${path}`).send({});
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test('PATCH /me mengubah nama dan nomor HP, validasi per field', async () => {
  const user = await makeUser();
  const { as, users } = setup(user);

  const res = await as('patch', '').send({ name: '  Budi S.  ', phone: '+6281299998888' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.name, 'Budi S.');
  assert.equal(res.body.data.user.phone, '+6281299998888');
  assert.equal(res.body.data.user.has_password, true);
  assert.equal('password_hash' in res.body.data.user, false);
  assert.equal(users.rows.get(user.id).phone, '+6281299998888');

  const bad = await as('patch', '').send({ name: 'B', phone: '0812' });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.map((d) => d.field).sort(), ['name', 'phone']);

  const empty = await as('patch', '').send({});
  assert.equal(empty.status, 400);
});

test('akun suspended hanya bisa membaca', async () => {
  const user = await makeUser({ status: 'suspended' });
  const { as } = setup(user);
  assert.equal((await as('get', '/addresses')).status, 200);
  const res = await as('patch', '').send({ name: 'Nama Baru' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'ACCOUNT_SUSPENDED');
});

test('PUT /me/password: wajib kata sandi saat ini yang benar, lalu kata sandi baru berlaku', async () => {
  const user = await makeUser();
  const { as, users } = setup(user);

  const wrong = await as('put', '/password').send({
    current_password: 'Salah12345',
    new_password: 'BaruSekali1',
  });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error.details[0].field, 'current_password');

  const same = await as('put', '/password').send({
    current_password: 'Demo12345',
    new_password: 'Demo12345',
  });
  assert.equal(same.status, 400);
  assert.equal(same.body.error.details[0].field, 'new_password');

  const short = await as('put', '/password').send({
    current_password: 'Demo12345',
    new_password: 'pendek',
  });
  assert.equal(short.status, 400);

  const ok = await as('put', '/password').send({
    current_password: 'Demo12345',
    new_password: 'BaruSekali1',
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.data, { password_changed: true });
  const saved = users.rows.get(user.id);
  assert.ok(await bcrypt.compare('BaruSekali1', saved.password_hash));
  assert.deepEqual(saved.lastPasswordOptions, { verifyEmail: false });
});

test('akun Google tanpa kata sandi diarahkan ke Lupa Kata Sandi (409 PASSWORD_NOT_SET)', async () => {
  const user = await makeUser({ has_password: false });
  const { as } = setup(user);
  const res = await as('put', '/password').send({
    current_password: 'apa-saja',
    new_password: 'BaruSekali1',
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'PASSWORD_NOT_SET');
});

test('email tidak bisa diganti dari Akun Saya (PUT /me/email tidak ada)', async () => {
  const user = await makeUser();
  const { as, users } = setup(user);
  const res = await as('put', '/email').send({
    email: 'budi.baru@djc.test',
    current_password: 'Demo12345',
  });
  assert.equal(res.status, 404);
  assert.equal(users.rows.get(user.id).email, 'budi@djc.test');
});

test('PUT/DELETE /me/photo: upload ke Cloudinary lalu simpan URL; gagal 503', async () => {
  const user = await makeUser();
  const { as, cloudinary } = setup(user);
  // PNG 1x1 valid dengan magic bytes PNG (\x89PNG\r\n\x1a\n).
  const image =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  const res = await as('put', '/photo').send({ image });
  assert.equal(res.status, 200);
  assert.match(res.body.data.user.avatar_url, /^https:\/\/res\.cloudinary\.test\/djc\/users\//);
  assert.equal(cloudinary.uploads[0].folder, `djc/users/${user.id}`);

  const bad = await as('put', '/photo').send({ image: 'bukan-gambar' });
  assert.equal(bad.status, 400);

  // Spoofed MIME: header data:image/png tapi isinya bukan magic bytes PNG.
  const spoofed = await as('put', '/photo').send({
    image: `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`,
  });
  assert.equal(spoofed.status, 400);

  const removed = await as('delete', '/photo');
  assert.equal(removed.status, 200);
  assert.equal(removed.body.data.user.avatar_url, null);

  const down = setup(await makeUser(), { cloudinary: fakeCloudinary({ fail: true }) });
  assert.equal((await down.as('put', '/photo').send({ image })).status, 503);
  const off = setup(await makeUser(), { cloudinary: fakeCloudinary({ configured: false }) });
  assert.equal((await off.as('put', '/photo').send({ image })).status, 503);
});

test('alamat: tambah (pertama otomatis utama), ganti utama, ubah, hapus utama memindahkan utama', async () => {
  const user = await makeUser();
  const { as } = setup(user);

  const first = await as('post', '/addresses').send(address);
  assert.equal(first.status, 201);
  assert.equal(first.body.data.is_primary, true);
  assert.equal(first.body.data.address, address.address);
  assert.equal(first.body.data.lat, -6.8765);

  const second = await as('post', '/addresses').send({
    label: 'Kantor',
    address: 'Jl. Asia Afrika No. 8, Sumur Bandung, Bandung',
    lat: -6.9215,
    lng: 107.6071,
    is_primary: true,
  });
  assert.equal(second.status, 201);
  assert.equal(second.body.data.is_primary, true);
  assert.equal(second.body.data.detail, null);

  let list = (await as('get', '/addresses')).body.data;
  assert.deepEqual(
    list.map((a) => [a.label, a.is_primary]),
    [
      ['Kantor', true],
      ['Rumah', false],
    ],
  );

  const edited = await as('patch', `/addresses/${first.body.data.id}`).send({
    detail: '',
    is_primary: true,
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.detail, null);
  assert.equal(edited.body.data.is_primary, true);

  const removed = await as('delete', `/addresses/${first.body.data.id}`);
  assert.equal(removed.status, 200);
  list = (await as('get', '/addresses')).body.data;
  assert.deepEqual(
    list.map((a) => [a.label, a.is_primary]),
    [['Kantor', true]],
  );
});

test('alamat: validasi, milik orang lain 404, batas jumlah alamat', async () => {
  const user = await makeUser();
  const { as, addresses } = setup(user);

  const bad = await as('post', '/addresses').send({ label: 'R', address: 'pendek', lat: 200 });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.map((d) => d.field).sort(), [
    'address',
    'label',
    'lat',
    'lng',
  ]);

  const onlyLat = await as('patch', `/addresses/${randomUUID()}`).send({ lat: -6.9 });
  assert.equal(onlyLat.status, 400);

  const strangers = await addresses.create(randomUUID(), {
    label: 'Rumah',
    addressText: 'Jl. Orang Lain No. 1, Bandung',
    lat: -6.9,
    lng: 107.6,
  });
  assert.equal(
    (await as('patch', `/addresses/${strangers.id}`).send({ label: 'Punyaku' })).status,
    404,
  );
  assert.equal((await as('delete', `/addresses/${strangers.id}`)).status, 404);
  assert.equal((await as('delete', '/addresses/bukan-uuid')).status, 404);

  for (let i = 0; i < MAX_ADDRESSES; i += 1) {
    assert.equal((await as('post', '/addresses').send(address)).status, 201);
  }
  const full = await as('post', '/addresses').send(address);
  assert.equal(full.status, 409);
});
