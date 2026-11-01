const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const env = require('./config/env');
const db = require('./config/db');
const redisClient = require('./config/redis');
const userRepository = require('./repositories/userRepository');
const providerRepository = require('./repositories/providerRepository');
const categoryRepository = require('./repositories/categoryRepository');
const serviceRepository = require('./repositories/serviceRepository');
const bookingRepository = require('./repositories/bookingRepository');
const reviewRepository = require('./repositories/reviewRepository');
const adminRepository = require('./repositories/adminRepository');
const defaultMailer = require('./services/mailer');
const { createCloudinary } = require('./services/cloudinary');
const { createCache } = require('./services/cache');
const { createGoogleOAuth } = require('./services/googleOAuth');
const createApiRouter = require('./routes');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

// deps dapat diganti saat testing, mis. createApp({ pingDb: async () => {} }).
function createApp({
  pingDb = db.ping,
  users = userRepository,
  providers = providerRepository,
  categories = categoryRepository,
  services = serviceRepository,
  bookings = bookingRepository,
  reviews = reviewRepository,
  admin = adminRepository,
  mailer = defaultMailer,
  cloudinary = createCloudinary(),
  googleOAuth = createGoogleOAuth(),
  // Tes memakai null (tanpa Redis) supaya hitungan rate limit tidak terbawa antar-tes.
  redis = env.isTest ? null : redisClient.getClient(),
  pingRedis = redis ? () => redis.ping() : null,
  cache = createCache({ redis }),
  now,
  loginLimit,
  resetLimit,
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  // Di Railway, API berada di belakang satu proxy; dibutuhkan agar IP klien (rate limit) benar.
  app.set('trust proxy', env.isProduction ? 1 : false);
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );
  // Endpoint upload gambar memakai parser JSON sendiri dengan batas lebih besar
  // (src/routes/providerMedia.js); endpoint lain tetap dibatasi 1 MB.
  const jsonBody = express.json({ limit: '1mb' });
  const uploadPaths = /^\/api\/v1\/provider\/(photo|portfolio)\/?$/;
  app.use((req, res, next) => (uploadPaths.test(req.path) ? next() : jsonBody(req, res, next)));
  app.use(cookieParser());

  app.use(
    '/api/v1',
    createApiRouter({
      pingDb,
      users,
      providers,
      categories,
      services,
      bookings,
      reviews,
      admin,
      mailer,
      cloudinary,
      googleOAuth,
      redis,
      pingRedis,
      cache,
      now,
      loginLimit,
      resetLimit,
    }),
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
