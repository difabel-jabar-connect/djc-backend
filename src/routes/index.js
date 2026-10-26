const express = require('express');
const createHealthRouter = require('./health');
const createAuthRouter = require('./auth');
const { createProvidersRouter, createProviderSelfRouter } = require('./providers');
const { createProviderMediaRouter } = require('./providerMedia');

function createApiRouter(deps) {
  const router = express.Router();

  router.use('/health', createHealthRouter(deps));
  router.use('/auth', createAuthRouter(deps));
  router.use('/providers', createProvidersRouter(deps));
  router.use('/provider', createProviderSelfRouter(deps));
  router.use('/provider', createProviderMediaRouter(deps));

  // Endpoint fitur berikutnya (categories, bookings, reviews) ditambahkan di sini
  // mengikuti docs/api-contract.md.

  return router;
}

module.exports = createApiRouter;
