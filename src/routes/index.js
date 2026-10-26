const express = require('express');
const createHealthRouter = require('./health');
const createAuthRouter = require('./auth');
const { createProvidersRouter, createProviderSelfRouter } = require('./providers');
const { createProviderMediaRouter } = require('./providerMedia');
const { createCategoriesRouter, createAdminCategoriesRouter } = require('./categories');
const { createServicesRouter } = require('./services');

function createApiRouter(deps) {
  const router = express.Router();

  router.use('/health', createHealthRouter(deps));
  router.use('/auth', createAuthRouter(deps));
  router.use('/categories', createCategoriesRouter(deps));
  router.use('/admin/categories', createAdminCategoriesRouter(deps));
  router.use('/services', createServicesRouter(deps));
  router.use('/providers', createProvidersRouter(deps));
  router.use('/provider', createProviderSelfRouter(deps));
  router.use('/provider', createProviderMediaRouter(deps));

  // Endpoint fitur berikutnya (bookings, reviews) ditambahkan di sini
  // mengikuti docs/api-contract.md.

  return router;
}

module.exports = createApiRouter;
