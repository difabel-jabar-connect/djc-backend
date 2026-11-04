const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middlewares/auth');
const { ApiError, sendSuccess } = require('../utils/response');
const { validate } = require('../utils/validate');
const { createChatService, toMessage, OPEN_STATUSES } = require('../services/chat');
const { shortName } = require('./bookings');

// Chat per booking (BE-10, issue #32). Socket.io memakai service yang sama
// (src/realtime/chatSocket.js); setiap pesan dari REST juga di-broadcast ke room booking.

const historySchema = z.object({
  limit: z.coerce.number().int().min(1, 'Minimal 1.').max(100, 'Maksimal 100 pesan.').optional(),
  before_id: z.string().optional(),
});

const sendSchema = z.object({
  message_text: z.string('Pesan wajib diisi.').max(5000, 'Pesan terlalu panjang.'),
});

const inboxSchema = z.object({
  page: z.coerce.number().int().min(1, 'Halaman minimal 1.').max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(50, 'Maksimal 50 per halaman.').optional(),
});

/** Satu baris inbox dari sudut pandang `viewer` ('customer' | 'provider'). */
function toInboxItem(row, viewer) {
  const isCustomer = viewer === 'customer';
  // Nama lengkap customer untuk provider mengikuti aturan BE-07 (lihat contactAccess).
  const fullCustomerName = ['accepted', 'in_progress'].includes(row.status) || row.was_accepted;
  return {
    booking: {
      id: row.booking_id,
      code: row.code,
      status: row.status,
      service_title: row.service_title,
    },
    counterpart: isCustomer
      ? {
          role: 'provider',
          name: row.provider_display_name,
          photo_url: row.provider_photo_url ?? null,
          photo_alt: row.provider_photo_alt ?? null,
          disability_type: row.provider_disability_type ?? null,
        }
      : {
          role: 'customer',
          name: fullCustomerName ? row.customer_full_name : shortName(row.customer_full_name),
        },
    last_message: row.last_id
      ? {
          id: row.last_id,
          sender_id: row.last_sender_id,
          sender_role: row.last_sender_role,
          message_text: row.last_text,
          created_at: row.last_created_at,
        }
      : null,
    unread_count: Number(row.unread_count),
    can_send: OPEN_STATUSES.includes(row.status),
  };
}

function serviceFrom(deps) {
  return (
    deps.chatService ??
    createChatService({ chat: deps.chat, users: deps.users, hub: deps.chatHub, now: deps.now })
  );
}

/** /bookings/:id/messages */
function createBookingMessagesRouter(deps) {
  const service = serviceFrom(deps);
  const router = express.Router({ mergeParams: true });
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const query = validate(historySchema, req.query);
    const limit = query.limit ?? 50;
    const result = await service.history(req.params.id, req.auth, {
      limit,
      beforeId: query.before_id || undefined,
    });
    const { hasMore, ...data } = result;
    return sendSuccess(res, data, {
      meta: {
        limit,
        has_more: hasMore,
        next_before_id: hasMore ? (data.messages[0]?.id ?? null) : null,
      },
    });
  });

  router.post('/', async (req, res) => {
    const body = validate(sendSchema, req.body);
    const message = await service.send(req.params.id, req.auth, body.message_text);
    return sendSuccess(res, message, { status: 201 });
  });

  router.patch('/read', async (req, res) => {
    const result = await service.markRead(req.params.id, req.auth);
    return sendSuccess(res, result);
  });

  return router;
}

/** /chat/inbox */
function createChatRouter({ chat }) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/inbox', async (req, res) => {
    if (!['customer', 'provider'].includes(req.auth.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Inbox hanya untuk pelanggan dan penyedia jasa.');
    }
    const query = validate(inboxSchema, req.query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { items, total } = await chat.inbox({
      userId: req.auth.userId,
      role: req.auth.role,
      activeStatuses: OPEN_STATUSES,
      page,
      limit,
    });
    return sendSuccess(
      res,
      items.map((row) => toInboxItem(row, req.auth.role)),
      { meta: { page, limit, total_items: total, total_pages: Math.ceil(total / limit) } },
    );
  });

  return router;
}

module.exports = { createBookingMessagesRouter, createChatRouter, toInboxItem, toMessage };
