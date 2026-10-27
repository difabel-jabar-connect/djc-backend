// Tes login dengan Google (OAuth authorization code) tanpa jaringan: penukaran code
// ke Google dan verifikasi id_token diganti versi palsu.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const createApp = require('../src/app');
const { createGoogleOAuth } = require('../src/services/googleOAuth');
const { safeRedirectPath } = require('../src/routes/googleAuth');
const { verifyToken } = require('../src/utils/token');

const FRONTEND = 'http://localhost:5173';
const config = {
  clientId: 'client-id-tes',
  clientSecret: 'secret-tes',
  redirectUri: 'http://localhost:5000/api/v1/auth/google/callback',
};

function fakeUsers(...list) {
  return {
    async findByEmail(email) {
      return list.find((user) => user.email === email) ?? null;
    },
  };
}

const budi = {
  id: randomUUID(),
  role: 'customer',
  full_name: 'Budi Santoso',
  email: 'budi@gmail.com',
  status: 'active',
};

/**
 * Google palsu: penukaran code "kode-<email>" menghasilkan id_token "id:<email>", dan
 * verifier menerima id_token itu. `exchangeStatus` atau `idTokenValid` mensimulasikan gagal.
 */
function fakeGoogle({ exchangeStatus = 200, idTokenValid = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = Object.fromEntries(options.body);
    calls.push({ url, body });
    const email = body.code.replace(/^kode-/, '');
    return {
      ok: exchangeStatus === 200,
      status: exchangeStatus,
      json: async () =>
        exchangeStatus === 200 ? { id_token: `id:${email}` } : { error: 'invalid_grant' },
    };
  };
  const verifyIdToken = async (idToken, { clientId }) => {
    assert.equal(clientId, config.clientId);
    if (!idTokenValid) return null;
    return { email: idToken.replace(/^id:/, ''), name: 'Nama dari Google' };
  };
  return { calls, oauth: createGoogleOAuth({ config, fetchImpl, verifyIdToken }) };
}

function cookieFrom(res, name) {
  return (res.headers['set-cookie'] ?? []).find((cookie) => cookie.startsWith(`${name}=`));
}

/** Memulai login (GET /auth/google) lalu mengembalikan state dan cookie djc_oauth-nya. */
async function start(app, query = '') {
  const res = await request(app).get(`/api/v1/auth/google${query}`);
  const state = new URL(res.headers.location).searchParams.get('state');
  return { res, state, cookie: cookieFrom(res, 'djc_oauth').split(';')[0] };
}

test('GET /auth/google mengarahkan ke Google dengan parameter OAuth dan cookie state', async () => {
  const app = createApp({ users: fakeUsers(), googleOAuth: fakeGoogle().oauth });

  const { res, state } = await start(app, '?redirect=/bookings');

  assert.equal(res.status, 302);
  const location = new URL(res.headers.location);
  assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(location.searchParams.get('client_id'), config.clientId);
  assert.equal(location.searchParams.get('redirect_uri'), config.redirectUri);
  assert.equal(location.searchParams.get('response_type'), 'code');
  assert.equal(location.searchParams.get('scope'), 'openid email profile');
  assert.equal(location.searchParams.get('prompt'), 'select_account');
  assert.ok(state && state.length >= 20);

  const cookie = cookieFrom(res, 'djc_oauth');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/api\/v1\/auth\/google/);
});

test('GET /auth/google tanpa client id/secret kembali ke halaman Masuk (unavailable)', async () => {
  const oauth = createGoogleOAuth({ config: { ...config, clientSecret: '' } });
  const app = createApp({ users: fakeUsers(), googleOAuth: oauth });

  const res = await request(app).get('/api/v1/auth/google');

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, `${FRONTEND}/login?google_error=unavailable`);
  assert.equal(cookieFrom(res, 'djc_oauth'), undefined);
});

test('callback untuk akun terdaftar memasang cookie sesi dan kembali ke frontend', async () => {
  const google = fakeGoogle();
  const app = createApp({ users: fakeUsers(budi), googleOAuth: google.oauth });
  const { state, cookie } = await start(app, '?redirect=/bookings');

  const res = await request(app)
    .get(`/api/v1/auth/google/callback?code=kode-budi@gmail.com&state=${state}`)
    .set('Cookie', cookie);

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, `${FRONTEND}/bookings?google=success`);
  const session = cookieFrom(res, 'djc_token');
  assert.match(session, /HttpOnly/);
  assert.doesNotMatch(session, /Expires=/, 'cookie sesi seperti login tanpa "Ingat saya"');
  assert.equal(verifyToken(session.split(';')[0].slice('djc_token='.length)).sub, budi.id);
  assert.match(cookieFrom(res, 'djc_oauth'), /Expires=Thu, 01 Jan 1970/, 'cookie state dihapus');

  assert.equal(google.calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.deepEqual(google.calls[0].body, {
    code: 'kode-budi@gmail.com',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });
});

test('callback tanpa redirect mengarah ke halaman awal sesuai peran', async () => {
  const provider = { ...budi, id: randomUUID(), role: 'provider', email: 'deni@gmail.com' };
  const app = createApp({ users: fakeUsers(provider), googleOAuth: fakeGoogle().oauth });
  const { state, cookie } = await start(app);

  const res = await request(app)
    .get(`/api/v1/auth/google/callback?code=kode-deni@gmail.com&state=${state}`)
    .set('Cookie', cookie);

  assert.equal(res.headers.location, `${FRONTEND}/dashboard/provider?google=success`);
});

test('callback untuk email belum terdaftar mengarah ke Daftar dengan email dan nama', async () => {
  const app = createApp({ users: fakeUsers(), googleOAuth: fakeGoogle().oauth });
  const { state, cookie } = await start(app);

  const res = await request(app)
    .get(`/api/v1/auth/google/callback?code=kode-baru@gmail.com&state=${state}`)
    .set('Cookie', cookie);

  assert.equal(res.status, 302);
  const location = new URL(res.headers.location);
  assert.equal(location.origin + location.pathname, `${FRONTEND}/register`);
  assert.equal(location.searchParams.get('google'), 'not_registered');
  assert.equal(location.searchParams.get('email'), 'baru@gmail.com');
  assert.equal(location.searchParams.get('name'), 'Nama dari Google');
  assert.equal(cookieFrom(res, 'djc_token'), undefined);
});

test('callback gagal (state salah, error Google, penukaran gagal, id_token tidak valid)', async () => {
  const failed = `${FRONTEND}/login?google_error=failed`;
  const cases = [
    { google: fakeGoogle(), query: (state) => `code=kode-budi@gmail.com&state=${state}x` },
    { google: fakeGoogle(), query: (state) => `error=access_denied&state=${state}` },
    { google: fakeGoogle({ exchangeStatus: 400 }), query: (s) => `code=kode-x&state=${s}` },
    { google: fakeGoogle({ idTokenValid: false }), query: (s) => `code=kode-x&state=${s}` },
  ];

  for (const { google, query } of cases) {
    const app = createApp({ users: fakeUsers(budi), googleOAuth: google.oauth });
    const { state, cookie } = await start(app);
    const res = await request(app)
      .get(`/api/v1/auth/google/callback?${query(state)}`)
      .set('Cookie', cookie);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, failed);
    assert.equal(cookieFrom(res, 'djc_token'), undefined);
  }

  // Tanpa cookie state sama sekali (mis. callback dibuka langsung).
  const app = createApp({ users: fakeUsers(budi), googleOAuth: fakeGoogle().oauth });
  const res = await request(app).get('/api/v1/auth/google/callback?code=kode-x&state=apa');
  assert.equal(res.headers.location, failed);
});

test('redirect hanya menerima path internal frontend (cegah open redirect)', async () => {
  assert.equal(safeRedirectPath('/bookings?tab=aktif'), '/bookings?tab=aktif');
  for (const value of [
    '//evil.com',
    'https://evil.com',
    'evil.com',
    '/\\evil.com',
    '',
    undefined,
  ]) {
    assert.equal(safeRedirectPath(value), null, String(value));
  }

  const app = createApp({ users: fakeUsers(budi), googleOAuth: fakeGoogle().oauth });
  const { state, cookie } = await start(app, '?redirect=//evil.com');
  const res = await request(app)
    .get(`/api/v1/auth/google/callback?code=kode-budi@gmail.com&state=${state}`)
    .set('Cookie', cookie);
  assert.equal(res.headers.location, `${FRONTEND}/?google=success`);
});

// A8 POST /auth/google (popup Google Identity Services di frontend).
function fakeUserStore(...list) {
  const created = [];
  return {
    created,
    async findByEmail(email) {
      return [...list, ...created].find((user) => user.email === email) ?? null;
    },
    async createUser({ fullName, email, phone, passwordHash }) {
      const user = {
        id: randomUUID(),
        role: 'customer',
        full_name: fullName,
        email,
        phone,
        status: 'active',
      };
      created.push({ ...user, password_hash: passwordHash });
      return user;
    },
  };
}

test('POST /auth/google login: akun terdaftar dapat cookie sesi, code ditukar dengan postmessage', async () => {
  const google = fakeGoogle();
  const app = createApp({ users: fakeUserStore(budi), googleOAuth: google.oauth });

  const res = await request(app)
    .post('/api/v1/auth/google')
    .send({ code: 'kode-budi@gmail.com', intent: 'login' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.user, {
    id: budi.id,
    role: 'customer',
    name: 'Budi Santoso',
    email: 'budi@gmail.com',
    status: 'active',
  });
  const session = cookieFrom(res, 'djc_token');
  assert.match(session, /HttpOnly/);
  assert.equal(verifyToken(session.split(';')[0].slice('djc_token='.length)).sub, budi.id);
  assert.equal(google.calls[0].body.redirect_uri, 'postmessage');
  assert.equal(google.calls[0].body.client_secret, config.clientSecret);
});

test('POST /auth/google login: email belum terdaftar 404 tanpa cookie', async () => {
  const app = createApp({ users: fakeUserStore(), googleOAuth: fakeGoogle().oauth });

  const res = await request(app)
    .post('/api/v1/auth/google')
    .send({ code: 'kode-baru@gmail.com', intent: 'login' });

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.equal(cookieFrom(res, 'djc_token'), undefined);
});

test('POST /auth/google register: membuat customer dengan nama Google dan telepon dari form', async () => {
  const users = fakeUserStore();
  const app = createApp({ users, googleOAuth: fakeGoogle().oauth });

  const res = await request(app).post('/api/v1/auth/google').send({
    code: 'kode-Baru@Gmail.com',
    intent: 'register',
    role: 'customer',
    phone: '+6281234567890',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.user.role, 'customer');
  assert.equal(res.body.data.user.name, 'Nama dari Google');
  assert.equal(res.body.data.user.phone, '+6281234567890');
  assert.ok(cookieFrom(res, 'djc_token'));
  assert.equal(users.created.length, 1);
  assert.match(users.created[0].password_hash, /^\$2[aby]\$/, 'kata sandi acak ter-hash');
});

test('POST /auth/google register: email sudah ada 409, mitra 403, telepon wajib 400', async () => {
  const google = fakeGoogle();
  const app = createApp({ users: fakeUserStore(budi), googleOAuth: google.oauth });
  const send = (body) => request(app).post('/api/v1/auth/google').send(body);

  const taken = await send({
    code: 'kode-budi@gmail.com',
    intent: 'register',
    phone: '+6281234567890',
  });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error.code, 'CONFLICT');

  const mitra = await send({
    code: 'kode-mitra@gmail.com',
    intent: 'register',
    role: 'provider',
    phone: '+6281234567890',
    city: 'Kota Bandung',
    category: 'jahit',
  });
  assert.equal(mitra.status, 403);
  assert.equal(
    mitra.body.error.message,
    'Akun mitra dibuat oleh admin. Silakan hubungi pengelola.',
  );

  const noPhone = await send({ code: 'kode-baru@gmail.com', intent: 'register' });
  assert.equal(noPhone.status, 400);
  assert.equal(noPhone.body.error.details[0].field, 'phone');

  const badIntent = await send({ code: 'kode-baru@gmail.com', intent: 'masuk' });
  assert.equal(badIntent.status, 400);
  assert.equal(google.calls.length, 1, 'mitra/validasi gagal tidak menukar code ke Google');
});

test('POST /auth/google: code ditolak Google atau id_token tidak valid 401, belum dikonfigurasi 503', async () => {
  for (const google of [fakeGoogle({ exchangeStatus: 400 }), fakeGoogle({ idTokenValid: false })]) {
    const app = createApp({ users: fakeUserStore(budi), googleOAuth: google.oauth });
    const res = await request(app)
      .post('/api/v1/auth/google')
      .send({ code: 'kode-budi@gmail.com', intent: 'login' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(cookieFrom(res, 'djc_token'), undefined);
  }

  const oauth = createGoogleOAuth({ config: { ...config, clientSecret: '' } });
  const app = createApp({ users: fakeUserStore(budi), googleOAuth: oauth });
  const res = await request(app)
    .post('/api/v1/auth/google')
    .send({ code: 'kode-budi@gmail.com', intent: 'login' });
  assert.equal(res.status, 503);
});
