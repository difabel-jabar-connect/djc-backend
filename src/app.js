const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const env = require('./config/env');
const db = require('./config/db');
const userRepository = require('./repositories/userRepository');
const categoryRepository = require('./repositories/categoryRepository');
const defaultMailer = require('./services/mailer');
const { createGoogleOAuth } = require('./services/googleOAuth');
const createApiRouter = require('./routes');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

// deps dapat diganti saat testing, mis. createApp({ pingDb: async () => {} }).
function createApp({
  pingDb = db.ping,
  users = userRepository,
  categories = categoryRepository,
  mailer = defaultMailer,
  googleOAuth = createGoogleOAuth(),
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
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(
    '/api/v1',
    createApiRouter({ pingDb, users, categories, mailer, googleOAuth, loginLimit, resetLimit }),
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
