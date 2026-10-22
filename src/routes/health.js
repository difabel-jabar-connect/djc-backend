const express = require('express');
const { sendSuccess } = require('../utils/response');

function createHealthRouter({ pingDb }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    let database = 'up';
    try {
      await pingDb();
    } catch {
      database = 'down';
    }

    const status = database === 'up' ? 'ok' : 'degraded';
    return sendSuccess(
      res,
      { status, database, timestamp: new Date().toISOString() },
      { status: database === 'up' ? 200 : 503 },
    );
  });

  return router;
}

module.exports = createHealthRouter;
