const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const env = require('../config/env');
const { requireAuth } = require('../middlewares/auth');
const createGoogleAuthRouter = require('./googleAuth');
const crypto = require('node:crypto');
const { ApiError, sendSuccess } = require('../utils/response');
const { validate } = require('../utils/validate');
const {
  signToken,
  setTokenCookie,
  clearTokenCookie,
  signResetToken,
  readResetTokenSubject,
  verifyResetToken,
} = require('../utils/token');

const email = z
  .string('Email wajib diisi.')
  .trim()
  .toLowerCase()
  .max(255, 'Email maksimal 255 karakter.')
  .pipe(z.email('Format email tidak valid.'));

const phone = z
  .string('Nomor telepon wajib diisi.')
  .trim()
  .regex(/^\+62\d{8,13}$/, 'Nomor telepon harus diawali +62, contoh +6281234567890.');

const password = z
  .string('Kata sandi wajib diisi.')
  .min(8, 'Kata sandi minimal 8 karakter.')
  .max(72, 'Kata sandi maksimal 72 karakter.');

// Field request mengikuti form Daftar di frontend: `name` disimpan ke kolom users.full_name.
// Pendaftaran mandiri hanya untuk customer; `role` lain ditolak di route (API-04).
const registerSchema = z.object({
  name: z
    .string('Nama lengkap wajib diisi.')
    .trim()
    .min(2, 'Nama lengkap minimal 2 karakter.')
    .max(100, 'Nama lengkap maksimal 100 karakter.'),
  email,
  phone,
  password,
});

// Body dari tombol Google di frontend (popup Google Identity Services). `city`/`category`
// dikirim form Mitra dan diabaikan karena pendaftaran Google hanya untuk customer.
// Daftar wajib menyertakan nomor telepon (kolom users.phone wajib, Google tidak memberikannya).
const googleSchema = z
  .object({
    code: z
      .string('Kode Google wajib diisi.')
      .min(1, 'Kode Google wajib diisi.')
      .max(2048, 'Kode Google tidak valid.'),
    intent: z.enum(['login', 'register'], 'intent harus login atau register.'),
    phone: phone.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.intent === 'register' && !body.phone) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Nomor telepon wajib diisi.' });
    }
  });

const loginSchema = z.object({
  email,
  password: z.string('Kata sandi wajib diisi.').min(1, 'Kata sandi wajib diisi.'),
  remember: z.boolean('remember harus true atau false.').optional(),
});

const forgotPasswordSchema = z.object({ email });

const resetPasswordSchema = z.object({
  token: z.string('Token reset wajib diisi.').min(1, 'Token reset wajib diisi.'),
  password,
});

/**
 * Data akun yang aman dikirim ke pemiliknya sendiri. password_hash tidak pernah dikirim.
 * `name` diambil dari kolom full_name, sesuai yang dibaca frontend.
 */
function toAuthUser(user) {
  return {
    id: user.id,
    role: user.role,
    name: user.full_name,
    email: user.email,
    phone: user.phone,
    status: user.status,
  };
}

// Dipakai saat email tidak terdaftar supaya waktu respons sama dengan password salah.
let dummyHash;
async function compareWithDummy(password) {
  dummyHash ??= await bcrypt.hash('bukan-password-siapa-pun', env.auth.bcryptSaltRounds);
  await bcrypt.compare(password, dummyHash);
}

function createAuthRouter({ users, mailer, googleOAuth, loginLimit = 10, resetLimit = 5 }) {
  const router = express.Router();

  // Membatasi permintaan tautan reset per IP: `resetLimit` kali per 15 menit.
  const forgotLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: resetLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res, next) =>
      next(
        new ApiError(
          429,
          'TOO_MANY_REQUESTS',
          'Terlalu banyak permintaan reset kata sandi. Silakan coba lagi dalam 15 menit.',
        ),
      ),
  });

  // Membatasi percobaan login GAGAL per IP: `loginLimit` kali per 15 menit.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginLimit,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res, next) =>
      next(
        new ApiError(
          429,
          'TOO_MANY_REQUESTS',
          'Terlalu banyak percobaan masuk. Silakan coba lagi dalam 15 menit.',
        ),
      ),
  });

  // A1 POST /auth/register — hanya customer. Akun mitra dibuat admin (API-04).
  router.post('/register', async (req, res) => {
    rejectNonCustomer(req.body?.role);
    const body = validate(registerSchema, req.body);

    if (await users.findByEmail(body.email)) throw emailTaken();

    const passwordHash = await bcrypt.hash(body.password, env.auth.bcryptSaltRounds);
    let user;
    try {
      user = await users.createUser({
        fullName: body.name,
        email: body.email,
        phone: body.phone,
        passwordHash,
      });
    } catch (error) {
      // Dua pendaftaran bersamaan dengan email yang sama.
      if (error.code === 'ER_DUP_ENTRY') throw emailTaken();
      throw error;
    }

    return sendSuccess(res, { user: toAuthUser(user) }, { status: 201 });
  });

  // A2 POST /auth/login
  router.post('/login', loginLimiter, async (req, res) => {
    const body = validate(loginSchema, req.body);

    const user = await users.findByEmail(body.email);
    if (!user) {
      await compareWithDummy(body.password);
      throw invalidCredentials();
    }
    if (!(await bcrypt.compare(body.password, user.password_hash))) throw invalidCredentials();

    // Akun suspended tetap boleh login untuk membaca data (data-model, SP1-05).
    const remember = body.remember === true;
    const { token, expiresAt } = signToken(user, { remember });
    setTokenCookie(res, token, { remember, expiresAt });

    return sendSuccess(res, {
      user: toAuthUser(user),
      token,
      expires_at: expiresAt.toISOString(),
    });
  });

  // A8 POST /auth/google — masuk/daftar dengan Google lewat popup: frontend mengirim
  // authorization code, backend menukarnya (redirect_uri "postmessage") dan memverifikasi id_token.
  router.post('/google', loginLimiter, async (req, res) => {
    if (req.body?.intent === 'register') rejectNonCustomer(req.body?.role);
    const body = validate(googleSchema, req.body);
    if (!googleOAuth.configured) {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Masuk dengan Google belum tersedia.');
    }

    let profile;
    try {
      profile = await googleOAuth.profileFromCode(body.code, { redirectUri: 'postmessage' });
    } catch (error) {
      if (!env.isTest) console.warn(`[google] login gagal: ${error.message}`);
      throw new ApiError(
        401,
        'INVALID_CREDENTIALS',
        'Gagal masuk dengan Google. Silakan coba lagi.',
      );
    }

    let user = await users.findByEmail(profile.email);
    let status = 200;
    if (body.intent === 'login' && !user) {
      throw new ApiError(404, 'NOT_FOUND', 'Akun Google ini belum terdaftar. Silakan daftar.');
    }
    if (body.intent === 'register') {
      if (user) throw emailTaken();
      // Akun Google tidak punya kata sandi: diisi hash acak. Pemilik bisa membuat kata sandi
      // lewat Lupa Kata Sandi bila ingin masuk dengan email.
      const passwordHash = await bcrypt.hash(
        crypto.randomBytes(32).toString('base64url'),
        env.auth.bcryptSaltRounds,
      );
      try {
        user = await users.createUser({
          fullName: (profile.name || profile.email.split('@')[0]).slice(0, 100),
          email: profile.email,
          phone: body.phone,
          passwordHash,
        });
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw emailTaken();
        throw error;
      }
      status = 201;
    }

    // Sama dengan login biasa tanpa "Ingat saya". Akun suspended tetap boleh masuk (API-03).
    const { token, expiresAt } = signToken(user);
    setTokenCookie(res, token, { expiresAt });
    return sendSuccess(res, { user: toAuthUser(user) }, { status });
  });

  // A7 GET /auth/google dan /auth/google/callback (login dengan Google, alur redirect).
  router.use('/google', createGoogleAuthRouter({ users, googleOAuth }));

  // A3 POST /auth/logout
  router.post('/logout', requireAuth, (req, res) => {
    clearTokenCookie(res);
    return sendSuccess(res, { logged_out: true });
  });

  // A4 GET /auth/me
  router.get('/me', requireAuth, async (req, res) => {
    const user = await users.findById(req.auth.userId);
    if (!user) {
      clearTokenCookie(res);
      throw new ApiError(401, 'UNAUTHENTICATED', 'Silakan masuk terlebih dahulu.');
    }

    const data = { user: toAuthUser(user) };
    if (user.role === 'provider') {
      const profile = await users.findProviderProfileByUserId(user.id);
      data.provider_profile = profile
        ? { id: profile.id, verification_status: profile.verification_status }
        : null;
    }
    return sendSuccess(res, data);
  });

  // A5 POST /auth/password/forgot
  // Email tidak terdaftar dijawab 404 karena layar Lupa Kata Sandi menampilkan
  // "Email tidak terdaftar"; percobaan dibatasi forgotLimiter.
  router.post('/password/forgot', forgotLimiter, async (req, res) => {
    const body = validate(forgotPasswordSchema, req.body);

    const user = await users.findByEmail(body.email);
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'Email tidak terdaftar.');

    const token = signResetToken(user);
    // Rute halaman reset di frontend (djc-frontend src/routes/paths.js: resetPassword).
    const link = `${env.app.frontendUrl}/reset-kata-sandi?token=${encodeURIComponent(token)}`;
    await mailer.sendPasswordReset({ to: user.email, name: user.full_name, link });

    return sendSuccess(res, { sent: true });
  });

  // A6 POST /auth/password/reset
  router.post('/password/reset', async (req, res) => {
    const body = validate(resetPasswordSchema, req.body);

    const userId = readResetTokenSubject(body.token);
    const user = userId && (await users.findById(userId));
    if (!user || !verifyResetToken(body.token, user)) {
      throw new ApiError(
        410,
        'TOKEN_EXPIRED',
        'Tautan reset sudah tidak berlaku. Silakan minta tautan baru.',
      );
    }

    const passwordHash = await bcrypt.hash(body.password, env.auth.bcryptSaltRounds);
    await users.updatePassword(user.id, passwordHash);
    clearTokenCookie(res);

    return sendSuccess(res, { password_reset: true });
  });

  return router;
}

function rejectNonCustomer(role) {
  if (role !== undefined && role !== 'customer') {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Akun mitra dibuat oleh admin. Silakan hubungi pengelola.',
    );
  }
}

function emailTaken() {
  return new ApiError(
    409,
    'CONFLICT',
    'Email ini sudah terdaftar. Silakan masuk atau gunakan email lain.',
  );
}

function invalidCredentials() {
  return new ApiError(401, 'INVALID_CREDENTIALS', 'Email atau kata sandi salah.');
}

module.exports = createAuthRouter;
