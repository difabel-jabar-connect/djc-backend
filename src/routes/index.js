const express = require('express');
const createHealthRouter = require('./health');

function createApiRouter(deps) {
  const router = express.Router();

  router.use('/health', createHealthRouter(deps));

  // Endpoint fitur (auth, categories, providers, bookings, reviews) ditambahkan di sini
  // mengikuti docs/technical/api-contract.md.

  return router;
}

module.exports = createApiRouter;
