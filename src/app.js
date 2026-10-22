const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const env = require('./config/env');
const db = require('./config/db');
const createApiRouter = require('./routes');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

// deps dapat diganti saat testing, mis. createApp({ pingDb: async () => {} }).
function createApp({ pingDb = db.ping } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api/v1', createApiRouter({ pingDb }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
