const crypto = require('node:crypto');
const express = require('express');
const env = require('../config/env');
const { signToken, setTokenCookie, signOAuthState, verifyOAuthState } = require('../utils/token');

// Path di frontend (djc-frontend src/routes/paths.js) tujuan redirect setelah login Google.
const FRONTEND_PATHS = {
  login: '/login',
  register: '/register',
  home: { customer: '/', provider: '/dashboard/provider', admin: '/admin' },
};

const STATE_COOKIE = 'djc_oauth';
const STATE_COOKIE_PATH = '/api/v1/auth/google';

function stateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: STATE_COOKIE_PATH,
    maxAge: 10 * 60 * 1000,
  };
}

/** Hanya path internal frontend ("/bookings"), bukan URL lain ("//evil.com", "https://…"). */
function safeRedirectPath(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  return value;
}

function frontendUrl(path, params = {}) {
  const url = new URL(path, `${env.app.frontendUrl}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** A7 GET /auth/google dan GET /auth/google/callback (OAuth authorization code flow). */
function createGoogleAuthRouter({ users, googleOAuth }) {
  const router = express.Router();

  const loginError = (res, reason) =>
    res.redirect(302, frontendUrl(FRONTEND_PATHS.login, { google_error: reason }));

  router.get('/', (req, res) => {
    if (!googleOAuth.configured) return loginError(res, 'unavailable');

    const state = crypto.randomBytes(24).toString('base64url');
    const redirect = safeRedirectPath(req.query.redirect);
    res.cookie(STATE_COOKIE, signOAuthState({ state, redirect }), stateCookieOptions());
    return res.redirect(302, googleOAuth.authorizationUrl(state));
  });

  router.get('/callback', async (req, res) => {
    const saved = verifyOAuthState(req.cookies?.[STATE_COOKIE]);
    res.clearCookie(STATE_COOKIE, { ...stateCookieOptions(), maxAge: undefined });

    const fail = (reason) => {
      if (!env.isTest) console.warn(`[google] login gagal: ${reason}`);
      return loginError(res, 'failed');
    };

    if (!googleOAuth.configured) return loginError(res, 'unavailable');
    if (req.query.error) return fail(`Google mengembalikan error ${String(req.query.error)}`);
    if (!saved || typeof req.query.state !== 'string' || req.query.state !== saved.state) {
      return fail('state tidak cocok atau kedaluwarsa');
    }
    if (typeof req.query.code !== 'string' || !req.query.code) return fail('code kosong');

    let profile;
    try {
      profile = await googleOAuth.profileFromCode(req.query.code);
    } catch (error) {
      return fail(error.message);
    }

    const user = await users.findByEmail(profile.email);
    if (!user) {
      // Akun tidak dibuat otomatis: register butuh nomor telepon yang tidak diberikan Google.
      return res.redirect(
        302,
        frontendUrl(FRONTEND_PATHS.register, {
          google: 'not_registered',
          email: profile.email,
          name: profile.name,
        }),
      );
    }

    // Sama dengan login biasa tanpa "Ingat saya": cookie sesi, token 24 jam.
    // Akun suspended tetap boleh masuk untuk membaca data (API-03).
    const { token, expiresAt } = signToken(user);
    setTokenCookie(res, token, { expiresAt });
    const target = saved.redirect ?? FRONTEND_PATHS.home[user.role] ?? FRONTEND_PATHS.home.customer;
    return res.redirect(302, frontendUrl(target, { google: 'success' }));
  });

  return router;
}

module.exports = createGoogleAuthRouter;
module.exports.safeRedirectPath = safeRedirectPath;
