const express = require('express');
const { sendSuccess } = require('../utils/response');

/**
 * `pingRedis` null berarti Redis tidak dipakai (REDIS_URL kosong). Redis mati membuat status
 * `degraded` tetapi tetap HTTP 200, karena API masih melayani request tanpa Redis.
 */
function createHealthRouter({ pingDb, pingRedis = null }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    let database = 'up';
    try {
      await pingDb();
    } catch {
      database = 'down';
    }

    let redis = 'disabled';
    if (pingRedis) {
      try {
        await pingRedis();
        redis = 'up';
      } catch {
        redis = 'down';
      }
    }

    const status = database === 'up' && redis !== 'down' ? 'ok' : 'degraded';
    return sendSuccess(
      res,
      { status, database, redis, timestamp: new Date().toISOString() },
      { status: database === 'up' ? 200 : 503 },
    );
  });

  return router;
}

module.exports = createHealthRouter;
