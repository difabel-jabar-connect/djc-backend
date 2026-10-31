const express = require('express');
const createHealthRouter = require('./health');
const createAuthRouter = require('./auth');

function createApiRouter(deps) {
  const router = express.Router();

  router.use('/health', createHealthRouter(deps));
  router.use('/auth', createAuthRouter(deps));

  // Endpoint fitur berikutnya (categories, providers, bookings, reviews) ditambahkan di sini
  // mengikuti docs/api-contract.md.

  return router;
}

module.exports = createApiRouter;
