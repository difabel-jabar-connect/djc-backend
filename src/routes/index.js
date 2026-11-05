const express = require('express');
const createHealthRouter = require('./health');
const createAuthRouter = require('./auth');
const { createProvidersRouter, createProviderSelfRouter } = require('./providers');
const { createProviderMediaRouter } = require('./providerMedia');
const { createCategoriesRouter, createAdminCategoriesRouter } = require('./categories');
const { createServicesRouter } = require('./services');
const { createBookingsRouter } = require('./bookings');
const { createAdminRouter } = require('./admin');
const { createBookingMessagesRouter, createChatRouter } = require('./chat');

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
  // Chat dipasang sebelum router booking. Cek akun aktif untuk kirim/tandai dibaca ada di
  // src/services/chat.js, supaya REST dan Socket.io memakai aturan yang sama.
  router.use('/bookings/:id/messages', createBookingMessagesRouter(deps));
  router.use('/chat', createChatRouter(deps));
  router.use('/bookings', createBookingsRouter(deps));
  router.use('/admin', createAdminRouter(deps));

  return router;
}

module.exports = createApiRouter;
