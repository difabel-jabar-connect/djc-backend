const env = require('../config/env');
const userRepository = require('../repositories/userRepository');
const { ApiError } = require('../utils/response');
const { COOKIE_NAME, verifyToken } = require('../utils/token');

function readToken(req) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return req.cookies?.[COOKIE_NAME];
}

// NFR-SEC-05: akses yang ditolak dicatat ke log server.
function logDenied(req, status, role) {
  if (env.isTest) return;
  console.warn(
    JSON.stringify({
      event: 'access_denied',
      status,
      method: req.method,
      route: req.originalUrl,
      ip: req.ip,
      role: role ?? null,
      at: new Date().toISOString(),
    }),
  );
}

/** Wajib login. Mengisi req.auth = { userId, role } dari cookie djc_token atau header Bearer. */
function requireAuth(req, res, next) {
  const token = readToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload?.sub) {
    logDenied(req, 401);
    return next(new ApiError(401, 'UNAUTHENTICATED', 'Silakan masuk terlebih dahulu.'));
  }
  req.auth = { userId: payload.sub, role: payload.role };
  return next();
}

/** Hanya peran tertentu, mis. requireRole('admin'). Dipasang setelah requireAuth. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.auth?.role)) {
      logDenied(req, 403, req.auth?.role);
      return next(new ApiError(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke fitur ini.'));
    }
    return next();
  };
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Akun `suspended` hanya boleh membaca (API-03, SP1-05). Aksi tulis (POST/PUT/PATCH/DELETE)
 * ditolak 403 ACCOUNT_SUSPENDED. Status dicek ulang ke database supaya suspend berlaku
 * langsung tanpa menunggu token kedaluwarsa. Dipasang setelah requireAuth, mis.
 * router.post('/bookings', requireAuth, requireActiveUser(), createBooking).
 */
function requireActiveUser({ users = userRepository } = {}) {
  return async (req, res, next) => {
    if (READ_METHODS.has(req.method)) return next();

    const user = await users.findById(req.auth?.userId);
    if (!user) {
      logDenied(req, 401, req.auth?.role);
      return next(new ApiError(401, 'UNAUTHENTICATED', 'Silakan masuk terlebih dahulu.'));
    }
    if (user.status === 'suspended') {
      logDenied(req, 403, user.role);
      return next(
        new ApiError(
          403,
          'ACCOUNT_SUSPENDED',
          'Akun Anda sedang dinonaktifkan. Anda hanya dapat melihat data.',
        ),
      );
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole, requireActiveUser };
