const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const COOKIE_NAME = 'djc_token';

let devSecret;

function getSecret() {
  if (env.auth.jwtSecret) return env.auth.jwtSecret;
  if (env.isProduction) throw new Error('JWT_SECRET wajib diisi di production.');
  if (!devSecret) {
    devSecret = crypto.randomBytes(48).toString('hex');
    if (!env.isTest) {
      console.warn('JWT_SECRET kosong: memakai secret acak sementara. Sesi hilang saat restart.');
    }
  }
  return devSecret;
}

/** Membuat JWT berisi `sub` (id user) dan `role`. */
function signToken(user, { remember = false } = {}) {
  const expiresIn = remember ? env.auth.jwtRememberExpiresIn : env.auth.jwtExpiresIn;
  const token = jwt.sign({ role: user.role }, getSecret(), { subject: user.id, expiresIn });
  const { exp } = jwt.decode(token);
  return { token, expiresAt: new Date(exp * 1000) };
}

/** Mengembalikan payload jika token valid, atau null jika tidak valid/kedaluwarsa. */
function verifyToken(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch {
    return null;
  }
}

const RESET_PURPOSE = 'password_reset';

// Secret token reset ikut password_hash user, jadi tautan otomatis tidak berlaku
// lagi setelah kata sandi diganti (sekali pakai tanpa tabel tambahan).
function resetSecret(user) {
  return `${getSecret()}:${user.password_hash}`;
}

/** Token reset kata sandi, berlaku RESET_TOKEN_EXPIRES_IN (default 30 menit). */
function signResetToken(user, { expiresIn = env.auth.resetTokenExpiresIn } = {}) {
  return jwt.sign({ purpose: RESET_PURPOSE }, resetSecret(user), {
    subject: user.id,
    expiresIn,
  });
}

/** Id user di token reset tanpa memeriksa tanda tangan; dipakai untuk mencari user-nya. */
function readResetTokenSubject(token) {
  const payload = jwt.decode(token);
  return typeof payload?.sub === 'string' ? payload.sub : null;
}

/** true jika token reset valid, belum kedaluwarsa, dan belum dipakai untuk user ini. */
function verifyResetToken(token, user) {
  try {
    const payload = jwt.verify(token, resetSecret(user), { subject: user.id });
    return payload.purpose === RESET_PURPOSE;
  } catch {
    return false;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
  };
}

/**
 * Menyimpan token di cookie HttpOnly. Tanpa "Ingat saya", cookie berlaku sampai
 * browser ditutup (token tetap kedaluwarsa sesuai JWT_EXPIRES_IN).
 */
function setTokenCookie(res, token, { remember = false, expiresAt } = {}) {
  const options = cookieOptions();
  if (remember && expiresAt) options.expires = expiresAt;
  res.cookie(COOKIE_NAME, token, options);
}

function clearTokenCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

module.exports = {
  COOKIE_NAME,
  signToken,
  verifyToken,
  signResetToken,
  readResetTokenSubject,
  verifyResetToken,
  setTokenCookie,
  clearTokenCookie,
};
