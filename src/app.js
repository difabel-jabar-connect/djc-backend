const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const env = require('./config/env');
const db = require('./config/db');
const redisClient = require('./config/redis');
const userRepository = require('./repositories/userRepository');
const addressRepository = require('./repositories/addressRepository');
const providerRepository = require('./repositories/providerRepository');
const categoryRepository = require('./repositories/categoryRepository');
const serviceRepository = require('./repositories/serviceRepository');
const bookingRepository = require('./repositories/bookingRepository');
const reviewRepository = require('./repositories/reviewRepository');
const adminRepository = require('./repositories/adminRepository');
const chatRepository = require('./repositories/chatRepository');
const defaultMailer = require('./services/mailer');
const { createCloudinary } = require('./services/cloudinary');
const { createCache } = require('./services/cache');
const { createGoogleOAuth } = require('./services/googleOAuth');
const { createChatHub } = require('./services/chat');
const { createRateLimitStore } = require('./services/rateLimitStore');
const { createTokenBlacklist } = require('./services/tokenBlacklist');
const { ApiError } = require('./utils/response');
const createApiRouter = require('./routes');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const PUBLIC_CACHEABLE_GET = /^\/api\/v1\/(health|categories)\/?$/;

// deps dapat diganti saat testing, mis. createApp({ pingDb: async () => {} }).
function createApp({
  pingDb = db.ping,
  users = userRepository,
  addresses = addressRepository,
  providers = providerRepository,
  categories = categoryRepository,
  services = serviceRepository,
  bookings = bookingRepository,
  reviews = reviewRepository,
  admin = adminRepository,
  chat = chatRepository,
  // Penghubung ke Socket.io; server.js memasang io ke hub yang sama (src/realtime/chatSocket.js).
  chatHub = createChatHub(),
  mailer = defaultMailer,
  cloudinary = createCloudinary(),
  googleOAuth = createGoogleOAuth(),
  // Tes memakai null (tanpa Redis) supaya hitungan rate limit tidak terbawa antar-tes.
  redis = env.isTest ? null : redisClient.getClient(),
  pingRedis = redis ? () => redis.ping() : null,
  cache = createCache({ redis }),
  tokenBlacklist = createTokenBlacklist({ redis }),
  now,
  loginLimit,
  registerLimit,
  resetLimit,
  apiLimit = env.isTest ? 0 : 300,
} = {}) {
  const app = express();

  app.locals.tokenBlacklist = tokenBlacklist;
  app.disable('x-powered-by');
  // Di Railway, API berada di belakang satu proxy; dibutuhkan agar IP klien (rate limit) benar.
  app.set('trust proxy', env.isProduction ? 1 : false);
  // Header keamanan eksplisit (OWASP A05): cegah clickjacking, kebocoran Referer, & CORP lintas-situs.
  app.use(
    helmet({
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      frameguard: { action: 'deny' },
    }),
  );
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );
  // Endpoint upload gambar memakai parser JSON sendiri dengan batas lebih besar
  // (src/routes/imageUpload.js); endpoint lain tetap dibatasi 1 MB.
  const jsonBody = express.json({ limit: '1mb' });
  const uploadPaths = /^\/api\/v1\/(provider\/(photo|portfolio)|me\/photo)\/?$/;
  app.use((req, res, next) => (uploadPaths.test(req.path) ? next() : jsonBody(req, res, next)));
  app.use(cookieParser());

  // OWASP A02: cegah caching browser/proxy untuk respons API sensitif/terautentikasi.
  app.use('/api/v1', (req, res, next) => {
    if (!(req.method === 'GET' && PUBLIC_CACHEABLE_GET.test(req.originalUrl.split('?')[0]))) {
      res.set('Cache-Control', 'no-store, private');
      res.set('Pragma', 'no-cache');
    }
    next();
  });

  // OWASP A04: batas permintaan API global per IP (15 menit).
  if (apiLimit > 0) {
    app.use(
      '/api/v1',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: apiLimit,
        store: createRateLimitStore({ redis, prefix: `${env.redis.prefix}rl:api:` }),
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: (req, res, next) =>
          next(
            new ApiError(
              429,
              'TOO_MANY_REQUESTS',
              'Terlalu banyak permintaan. Silakan coba lagi beberapa saat lagi.',
            ),
          ),
      }),
    );
  }

  app.use(
    '/api/v1',
    createApiRouter({
      pingDb,
      users,
      addresses,
      providers,
      categories,
      services,
      bookings,
      reviews,
      admin,
      chat,
      chatHub,
      mailer,
      cloudinary,
      googleOAuth,
      redis,
      pingRedis,
      cache,
      tokenBlacklist,
      now,
      loginLimit,
      registerLimit,
      resetLimit,
    }),
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
