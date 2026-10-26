// Tes endpoint auth tanpa MySQL: repository user diganti versi in-memory.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const createApp = require('../src/app');
const { requireAuth, requireRole } = require('../src/middlewares/auth');
const errorHandler = require('../src/middlewares/errorHandler');
const { signToken, signResetToken } = require('../src/utils/token');

function fakeUsers() {
  const rows = new Map();
  const profiles = new Map();
  return {
    rows,
    profiles,
    async findByEmail(email) {
      return [...rows.values()].find((user) => user.email === email) ?? null;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findProviderProfileByUserId(userId) {
      return profiles.get(userId) ?? null;
    },
    async createUser({ role, fullName, email, phone, passwordHash, provider }) {
      const user = {
        id: randomUUID(),
        role,
        full_name: fullName,
        email,
        phone,
        password_hash: passwordHash,
        status: 'active',
      };
      rows.set(user.id, user);
      if (role === 'provider') {
        profiles.set(user.id, { id: randomUUID(), verification_status: 'pending', ...provider });
      }
      return user;
    },
    async updatePassword(id, passwordHash) {
      rows.get(id).password_hash = passwordHash;
    },
  };
}

// Mailer palsu: menyimpan email yang "terkirim" supaya tes bisa membaca tautannya.
function fakeMailer() {
  const sent = [];
  return {
    sent,
    async sendPasswordReset(message) {
      sent.push(message);
    },
  };
}

function resetTokenFrom(message) {
  return new URL(message.link).searchParams.get('token');
}

async function seedUser(users, overrides = {}) {
  const user = {
    id: randomUUID(),
    role: 'customer',
    full_name: 'Budi Santoso',
    email: 'budi@djc.test',
    phone: '+6281200000010',
    password_hash: await bcrypt.hash('Demo12345', 4),
    status: 'active',
    ...overrides,
  };
  users.rows.set(user.id, user);
  return user;
}

const customer = {
  role: 'customer',
  full_name: 'Budi Santoso',
  email: 'Budi@Contoh.id ',
  phone: '+6281234567890',
  password: 'rahasia123',
};

function tokenCookie(res) {
  return (res.headers['set-cookie'] ?? []).find((cookie) => cookie.startsWith('djc_token='));
}

test('register customer mengembalikan 201 tanpa password_hash', async () => {
  const users = fakeUsers();
  const res = await request(createApp({ users })).post('/api/v1/auth/register').send(customer);

  assert.equal(res.status, 201);
  assert.equal(res.body.data.user.email, 'budi@contoh.id');
  assert.equal(res.body.data.user.role, 'customer');
  assert.equal(res.body.data.user.status, 'active');
  assert.equal(res.body.data.user.password_hash, undefined);
  assert.equal(tokenCookie(res), undefined, 'registrasi tidak langsung login');

  const stored = [...users.rows.values()][0];
  assert.ok(await bcrypt.compare('rahasia123', stored.password_hash));
});

test('register provider membuat profil pending dan wajib nomor alumni + kota', async () => {
  const users = fakeUsers();
  const app = createApp({ users });

  const missing = await request(app)
    .post('/api/v1/auth/register')
    .send({ ...customer, role: 'provider' });
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.body.error.details.map((d) => d.field).sort(), [
    'alumni_reg_no',
    'city',
  ]);

  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ ...customer, role: 'provider', alumni_reg_no: 'PPSGHD-001', city: 'Kota Bandung' });
  assert.equal(res.status, 201);
  const profile = users.profiles.get(res.body.data.user.id);
  assert.equal(profile.verification_status, 'pending');
  assert.equal(profile.city, 'Kota Bandung');
});

test('register menolak data tidak valid dengan detail per field', async () => {
  const res = await request(createApp({ users: fakeUsers() }))
    .post('/api/v1/auth/register')
    .send({ role: 'admin', full_name: 'B', email: 'bukan-email', phone: '0812', password: '123' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(res.body.error.details.map((d) => d.field).sort(), [
    'email',
    'full_name',
    'password',
    'phone',
    'role',
  ]);
});

test('register email yang sudah terdaftar mengembalikan 409', async () => {
  const users = fakeUsers();
  await seedUser(users, { email: 'budi@contoh.id' });

  const res = await request(createApp({ users })).post('/api/v1/auth/register').send(customer);

  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CONFLICT');
});

test('login berhasil memasang cookie HttpOnly dan mengembalikan token', async () => {
  const users = fakeUsers();
  await seedUser(users);

  const res = await request(createApp({ users }))
    .post('/api/v1/auth/login')
    .send({ email: 'BUDI@djc.test', password: 'Demo12345' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.full_name, 'Budi Santoso');
  assert.equal(typeof res.body.data.token, 'string');
  const cookie = tokenCookie(res);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Expires=/, 'tanpa "Ingat saya" cookie hilang saat browser ditutup');

  const expiresIn = Date.parse(res.body.data.expires_at) - Date.now();
  assert.ok(expiresIn > 23 * 3600e3 && expiresIn <= 24 * 3600e3, 'sesi biasa 24 jam');
});

test('login dengan remember memasang cookie 7 hari', async () => {
  const users = fakeUsers();
  await seedUser(users);

  const res = await request(createApp({ users }))
    .post('/api/v1/auth/login')
    .send({ email: 'budi@djc.test', password: 'Demo12345', remember: true });

  assert.equal(res.status, 200);
  assert.match(tokenCookie(res), /Expires=/);
  const expiresIn = Date.parse(res.body.data.expires_at) - Date.now();
  assert.ok(expiresIn > 6.9 * 24 * 3600e3, 'sesi "Ingat saya" 7 hari');
});

test('login gagal mengembalikan 401 INVALID_CREDENTIALS untuk password salah atau email asing', async () => {
  const users = fakeUsers();
  await seedUser(users);
  const app = createApp({ users });

  for (const body of [
    { email: 'budi@djc.test', password: 'salah12345' },
    { email: 'tidakada@djc.test', password: 'Demo12345' },
  ]) {
    const res = await request(app).post('/api/v1/auth/login').send(body);
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(tokenCookie(res), undefined);
  }
});

test('akun suspended tetap bisa login (baca saja)', async () => {
  const users = fakeUsers();
  await seedUser(users, { status: 'suspended' });

  const res = await request(createApp({ users }))
    .post('/api/v1/auth/login')
    .send({ email: 'budi@djc.test', password: 'Demo12345' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.user.status, 'suspended');
});

test('login gagal berulang dibatasi 429', async () => {
  const users = fakeUsers();
  await seedUser(users);
  const app = createApp({ users, loginLimit: 2 });
  const wrong = { email: 'budi@djc.test', password: 'salah12345' };

  assert.equal((await request(app).post('/api/v1/auth/login').send(wrong)).status, 401);
  assert.equal((await request(app).post('/api/v1/auth/login').send(wrong)).status, 401);
  const blocked = await request(app).post('/api/v1/auth/login').send(wrong);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'TOO_MANY_REQUESTS');
});

test('me membaca sesi dari cookie maupun header Bearer', async () => {
  const users = fakeUsers();
  await seedUser(users);
  const app = createApp({ users });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'budi@djc.test', password: 'Demo12345' });

  const viaCookie = await request(app)
    .get('/api/v1/auth/me')
    .set('Cookie', tokenCookie(login).split(';')[0]);
  assert.equal(viaCookie.status, 200);
  assert.equal(viaCookie.body.data.user.email, 'budi@djc.test');
  assert.equal(viaCookie.body.data.provider_profile, undefined);

  const viaBearer = await request(app)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${login.body.data.token}`);
  assert.equal(viaBearer.status, 200);
});

test('me untuk provider menyertakan status verifikasi', async () => {
  const users = fakeUsers();
  const app = createApp({ users });
  await request(app)
    .post('/api/v1/auth/register')
    .send({ ...customer, role: 'provider', alumni_reg_no: 'PPSGHD-001', city: 'Kota Bandung' });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'budi@contoh.id', password: 'rahasia123' });

  const res = await request(app)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${login.body.data.token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.provider_profile.verification_status, 'pending');
});

test('me tanpa token, token rusak, atau user sudah tidak ada mengembalikan 401', async () => {
  const users = fakeUsers();
  const app = createApp({ users });
  const ghost = signToken({ id: randomUUID(), role: 'customer' }).token;

  for (const auth of [null, 'Bearer rusak', `Bearer ${ghost}`]) {
    const req = request(app).get('/api/v1/auth/me');
    if (auth) req.set('Authorization', auth);
    const res = await req;
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHENTICATED');
  }
});

test('logout menghapus cookie dan wajib login', async () => {
  const users = fakeUsers();
  await seedUser(users);
  const app = createApp({ users });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'budi@djc.test', password: 'Demo12345' });

  const res = await request(app)
    .post('/api/v1/auth/logout')
    .set('Cookie', tokenCookie(login).split(';')[0]);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.logged_out, true);
  assert.match(tokenCookie(res), /djc_token=;/);
  assert.match(tokenCookie(res), /Expires=Thu, 01 Jan 1970/);

  const anonymous = await request(app).post('/api/v1/auth/logout');
  assert.equal(anonymous.status, 401);
});

test('requireRole menolak peran lain dengan 403 FORBIDDEN', async () => {
  const app = express();
  app.get('/admin', requireAuth, requireRole('admin'), (req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  const customerToken = signToken({ id: randomUUID(), role: 'customer' }).token;
  const adminToken = signToken({ id: randomUUID(), role: 'admin' }).token;

  const denied = await request(app).get('/admin').set('Authorization', `Bearer ${customerToken}`);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'FORBIDDEN');

  const allowed = await request(app).get('/admin').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(allowed.status, 200);
});

test('lupa kata sandi mengirim tautan reset berisi token', async () => {
  const users = fakeUsers();
  const mailer = fakeMailer();
  await seedUser(users);

  const res = await request(createApp({ users, mailer }))
    .post('/api/v1/auth/password/forgot')
    .send({ email: ' Budi@djc.test' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.sent, true);
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].to, 'budi@djc.test');
  assert.match(mailer.sent[0].link, /\/reset-kata-sandi\?token=/);
  assert.ok(resetTokenFrom(mailer.sent[0]));
});

test('lupa kata sandi: email asing 404, email tidak valid 400', async () => {
  const mailer = fakeMailer();
  const app = createApp({ users: fakeUsers(), mailer });

  const unknown = await request(app)
    .post('/api/v1/auth/password/forgot')
    .send({ email: 'tidakada@djc.test' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'NOT_FOUND');

  const invalid = await request(app)
    .post('/api/v1/auth/password/forgot')
    .send({ email: 'bukan-email' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
  assert.equal(mailer.sent.length, 0);
});

test('reset kata sandi mengganti password dan tautan hanya sekali pakai', async () => {
  const users = fakeUsers();
  const mailer = fakeMailer();
  await seedUser(users);
  const app = createApp({ users, mailer });
  await request(app).post('/api/v1/auth/password/forgot').send({ email: 'budi@djc.test' });
  const token = resetTokenFrom(mailer.sent[0]);

  const res = await request(app)
    .post('/api/v1/auth/password/reset')
    .send({ token, password: 'SandiBaru123' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.password_reset, true);

  const login = (password) =>
    request(app).post('/api/v1/auth/login').send({ email: 'budi@djc.test', password });
  assert.equal((await login('SandiBaru123')).status, 200);
  assert.equal((await login('Demo12345')).status, 401);

  const reused = await request(app)
    .post('/api/v1/auth/password/reset')
    .send({ token, password: 'SandiLain123' });
  assert.equal(reused.status, 410);
  assert.equal(reused.body.error.code, 'TOKEN_EXPIRED');
});

test('reset kata sandi menolak token rusak atau kedaluwarsa dengan 410', async () => {
  const users = fakeUsers();
  const user = await seedUser(users);
  const app = createApp({ users, mailer: fakeMailer() });
  const valid = signResetToken(user);
  const tampered = `${valid.slice(0, -2)}${valid.endsWith('aa') ? 'bb' : 'aa'}`;
  const expired = signResetToken(user, { expiresIn: -1 });
  const loginToken = signToken(user).token;

  for (const token of ['rusak', tampered, expired, loginToken]) {
    const res = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'SandiBaru123' });
    assert.equal(res.status, 410);
    assert.equal(res.body.error.code, 'TOKEN_EXPIRED');
  }
});

test('reset kata sandi menolak password pendek dengan 400', async () => {
  const users = fakeUsers();
  const user = await seedUser(users);

  const res = await request(createApp({ users, mailer: fakeMailer() }))
    .post('/api/v1/auth/password/reset')
    .send({ token: signResetToken(user), password: '123' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.details[0].field, 'password');
});

test('permintaan lupa kata sandi berulang dibatasi 429', async () => {
  const users = fakeUsers();
  await seedUser(users);
  const app = createApp({ users, mailer: fakeMailer(), resetLimit: 2 });
  const forgot = () =>
    request(app).post('/api/v1/auth/password/forgot').send({ email: 'budi@djc.test' });

  assert.equal((await forgot()).status, 200);
  assert.equal((await forgot()).status, 200);
  const blocked = await forgot();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'TOO_MANY_REQUESTS');
});
