const env = require('../config/env');
const { verifyGoogleToken } = require('../utils/googleToken');

// Login dengan Google lewat OAuth 2.0 authorization code flow, dua cara:
// - redirect: frontend membuka GET /auth/google, Google mengembalikan ke /auth/google/callback;
// - popup (Google Identity Services): frontend mengirim `code` ke POST /auth/google dan
//   penukarannya memakai redirect_uri "postmessage".
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Request ke Google tidak boleh menggantung tanpa batas.
const FETCH_TIMEOUT_MS = 10_000;

/**
 * `fetchImpl` dan `verifyIdToken` dapat diganti saat testing supaya tes tidak memanggil
 * Google, mis. createGoogleOAuth({ config, fetchImpl: fakeFetch, verifyIdToken: fake }).
 */
function createGoogleOAuth({
  config = env.google,
  fetchImpl = (...args) => fetch(...args),
  verifyIdToken = verifyGoogleToken,
} = {}) {
  const configured = Boolean(config.clientId && config.clientSecret);

  function authorizationUrl(state) {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `${AUTH_URL}?${params}`;
  }

  /**
   * Menukar `code` dengan token Google lalu memverifikasi id_token-nya. Mengembalikan
   * { email, name } atau melempar error berisi alasan (tanpa secret) untuk log server.
   */
  async function profileFromCode(code, { redirectUri = config.redirectUri } = {}) {
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || typeof body.id_token !== 'string') {
      throw new Error(`penukaran code gagal (${res.status} ${body.error ?? 'tanpa id_token'})`);
    }

    const profile = await verifyIdToken(body.id_token, { clientId: config.clientId });
    if (!profile) throw new Error('id_token tidak valid atau email belum diverifikasi');
    return profile;
  }

  return { configured, authorizationUrl, profileFromCode };
}

module.exports = { createGoogleOAuth };
