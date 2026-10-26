const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const env = require('./config/env');
const db = require('./config/db');
const userRepository = require('./repositories/userRepository');
const providerRepository = require('./repositories/providerRepository');
const categoryRepository = require('./repositories/categoryRepository');
const serviceRepository = require('./repositories/serviceRepository');
const defaultMailer = require('./services/mailer');
const { createCloudinary } = require('./services/cloudinary');
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
  mailer = defaultMailer,
  cloudinary = createCloudinary(),
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
      mailer,
      cloudinary,
      loginLimit,
      resetLimit,
    }),
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
