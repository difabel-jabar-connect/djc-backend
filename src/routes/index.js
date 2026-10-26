const express = require('express');
const createHealthRouter = require('./health');
const createAuthRouter = require('./auth');
const { createCategoriesRouter, createAdminCategoriesRouter } = require('./categories');

function createApiRouter(deps) {
  const router = express.Router();

  router.use('/health', createHealthRouter(deps));
  router.use('/auth', createAuthRouter(deps));
  router.use('/categories', createCategoriesRouter(deps));
  router.use('/admin/categories', createAdminCategoriesRouter(deps));

  // Endpoint fitur berikutnya (providers, bookings, reviews) ditambahkan di sini
  // mengikuti docs/api-contract.md.

  return router;
}

module.exports = createApiRouter;
