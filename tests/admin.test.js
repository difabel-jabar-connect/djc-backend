// Tes endpoint admin (BE-09) tanpa MySQL: repository admin diganti versi in-memory yang
// mencatat setiap aksi admin.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const createApp = require('../src/app');
const { signToken } = require('../src/utils/token');

const admin = {
  id: randomUUID(),
  role: 'admin',
  status: 'active',
  full_name: 'Andi',
  email: 'admin@djc.test',
};
const otherAdmin = {
  id: randomUUID(),
  role: 'admin',
  status: 'active',
  full_name: 'Admin 2',
  email: 'a2@djc.test',
};
const suspendedAdmin = {
  id: randomUUID(),
  role: 'admin',
  status: 'suspended',
  full_name: 'Admin 3',
  email: 'a3@djc.test',
};
const customer = {
  id: randomUUID(),
  role: 'customer',
  status: 'active',
  full_name: 'Budi',
  email: 'budi@djc.test',
};
const provider = {
  id: randomUUID(),
  role: 'provider',
  status: 'active',
  full_name: 'Deni',
  email: 'deni@djc.test',
};
const bearer = (user) => `Bearer ${signToken(user).token}`;

function fakeAdmin() {
  const userRows = new Map(
    [admin, otherAdmin, suspendedAdmin, customer, provider].map((u) => [u.id, { ...u }]),
  );
  const profiles = new Map();
  const reviews = new Map();
  const actions = [];
  const complete = {
    id: randomUUID(),
    verification_status: 'pending',
    address_detail: 'Jl. A',
    lat: -6.2,
  };
  const noLocation = {
    id: randomUUID(),
    verification_status: 'pending',
    address_detail: null,
    lat: null,
  };
  profiles.set(complete.id, complete).set(noLocation.id, noLocation);
  const review = { id: randomUUID(), provider_id: complete.id, rating: 1, is_hidden: false };
  reviews.set(review.id, review);
  return {
    users: {
      async findById(id) {
        return userRows.get(id) ?? null;
      },
    },
    repo: {
      actions,
      complete,
      noLocation,
      review,
      created: [],
      async dashboard() {
        return {
          users: [
            { role: 'customer', status: 'active', total: 3 },
            { role: 'provider', status: 'active', total: 5 },
            { role: 'provider', status: 'suspended', total: 1 },
            { role: 'admin', status: 'active', total: 1 },
          ],
          providers: [
            { verification_status: 'verified', total: 4 },
            { verification_status: 'pending', total: 2 },
          ],
          bookings: [
            { status: 'requested', total: 2 },
            { status: 'completed', total: 3 },
          ],
          reviews: { total: 4, hidden: '1', average: '4.3' },
        };
      },
      listCalls: [],
      async listProviders(query) {
        this.listCalls.push(['providers', query]);
        return {
          total: 13,
          items: [
            {
              id: complete.id,
              user_id: provider.id,
              display_name: 'Deni',
              alumni_reg_no: 'ALM-001',
              city: 'Kota Bekasi',
              district: null,
              has_location: 1,
              verification_status: 'pending',
              verified_at: null,
              rating_avg: '0.0',
              rating_count: 0,
              created_at: '2026-10-20T00:00:00.000Z',
              full_name: 'Deni',
              email: 'deni@djc.test',
              phone: '+6281200000001',
              user_status: 'active',
              password_hash: 'tidak-boleh-terkirim',
            },
          ],
        };
      },
      async listReviews(query) {
        this.listCalls.push(['reviews', query]);
        return {
          total: 1,
          items: [
            {
              id: review.id,
              booking_id: randomUUID(),
              booking_code: 'DJC-7K2M9QXA',
              rating: 1,
              comment: 'Buruk',
              is_hidden: 0,
              hidden_reason: null,
              created_at: '2026-10-21T00:00:00.000Z',
              provider_id: complete.id,
              provider_name: 'Deni',
              customer_id: customer.id,
              customer_name: 'Budi',
            },
          ],
        };
      },
      async listUsers(query) {
        this.listCalls.push(['users', query]);
        return { total: 0, items: [] };
      },
      async listBookings(query) {
        this.listCalls.push(['bookings', query]);
        return {
          total: 1,
          items: [
            {
              id: 'b1',
              code: 'DJC-7K2M9QXA',
              status: 'completed',
              scheduled_date: new Date('2026-11-27T00:00:00.000Z'),
              start_time: '10:00:00',
              service_mode: 'at_customer',
              location_area: 'Coblong',
              location_address: 'Jl. Rahasia No. 1',
              pricing_type_snapshot: 'starting_from',
              estimated_total: '75000.00',
              final_total: '150000.00',
              cancelled_by: null,
              status_reason: null,
              created_at: '2026-11-26T05:00:00.000Z',
              updated_at: '2026-11-26T06:00:00.000Z',
              service_id: 's1',
              service_title: 'Servis TV',
              category_id: 'c1',
              category_name: 'Servis Elektronik',
              provider_id: complete.id,
              provider_name: 'Deni',
              provider_city: 'Kota Bekasi',
              customer_id: customer.id,
              customer_name: 'Budi',
              customer_phone: '+6281200000010',
            },
          ],
        };
      },
      async listAdminActions(query) {
        this.listCalls.push(['audit', query]);
        return {
          total: 1,
          items: [
            {
              id: 'a1',
              action: 'suspend_user',
              target_type: 'user',
              target_id: customer.id,
              note: 'Melanggar aturan',
              created_at: '2026-11-26T06:00:00.000Z',
              admin_id: admin.id,
              admin_name: 'Andi',
            },
          ],
        };
      },
      async findUser(id) {
        return userRows.get(id) ?? null;
      },
      async findProviderProfile(id) {
        return profiles.get(id) ?? null;
      },
      async createProvider(input) {
        if ([...userRows.values()].some((u) => u.email === input.email)) {
          throw Object.assign(new Error('Duplicate'), { code: 'ER_DUP_ENTRY' });
        }
        this.created.push(input);
        actions.push({ action: 'create_provider', adminId: input.adminId });
        return { userId: randomUUID(), profileId: randomUUID() };
      },
      async setVerification({ adminId, profileId, status, note }) {
        Object.assign(profiles.get(profileId), {
          verification_status: status,
          verified_by: adminId,
        });
        actions.push({
          action: status === 'verified' ? 'verify_provider' : 'reject_provider',
          adminId,
          note,
        });
        return { id: profileId, verification_status: status, verified_by: adminId };
      },
      async findReview(id) {
        return reviews.get(id) ? { ...reviews.get(id) } : null;
      },
      async setReviewHidden({ adminId, review: target, hidden, reason }) {
        Object.assign(reviews.get(target.id), { is_hidden: hidden, hidden_reason: reason });
        actions.push({ action: hidden ? 'hide_review' : 'unhide_review', adminId, reason });
        return { ...reviews.get(target.id) };
      },
      async setUserStatus({ adminId, user, status, reason }) {
        userRows.get(user.id).status = status;
        actions.push({
          action: status === 'suspended' ? 'suspend_user' : 'activate_user',
          adminId,
          reason,
        });
        return status === 'suspended' ? 2 : 0;
      },
    },
  };
}

function setup() {
  const { users, repo } = fakeAdmin();
  return { app: createApp({ users, admin: repo }), repo };
}

test('endpoint admin: 401 tanpa token, 403 untuk customer/provider, 403 admin suspended saat menulis', async () => {
  const { app, repo } = setup();

  assert.equal((await request(app).get('/api/v1/admin/dashboard')).status, 401);
  for (const user of [customer, provider]) {
    const res = await request(app)
      .get('/api/v1/admin/dashboard')
      .set('Authorization', bearer(user));
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  }
  const write = await request(app)
    .put(`/api/v1/admin/providers/${repo.complete.id}/verify`)
    .set('Authorization', bearer(suspendedAdmin))
    .send({ status: 'verified' });
  assert.equal(write.status, 403);
  assert.equal(write.body.error.code, 'ACCOUNT_SUSPENDED');
});

test('GET /admin/dashboard merangkum user, provider, booking, dan ulasan', async () => {
  const { app } = setup();

  const res = await request(app).get('/api/v1/admin/dashboard').set('Authorization', bearer(admin));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, {
    users: { total: 10, customers: 3, providers: 6, admins: 1, suspended: 1 },
    providers: { pending: 2, verified: 4, rejected: 0 },
    bookings: {
      total: 5,
      requested: 2,
      accepted: 0,
      in_progress: 0,
      completed: 3,
      rejected: 0,
      cancelled: 0,
    },
    reviews: { total: 4, hidden: 1, average_rating: 4.3 },
  });
});

test('POST /admin/providers membuat akun mitra dengan password ter-hash; email ganda 409', async () => {
  const { app, repo } = setup();
  const body = {
    name: 'Rina Marlina',
    email: ' Rina.Baru@DJC.test ',
    phone: '+6281234567000',
    password: 'Rahasia123',
    alumni_reg_no: 'PPSGHD-2026-010',
    city: 'Kota Cimahi',
  };

  const res = await request(app)
    .post('/api/v1/admin/providers')
    .set('Authorization', bearer(admin))
    .send(body);
  assert.equal(res.status, 201);
  assert.equal(res.body.data.user.role, 'provider');
  assert.equal(res.body.data.user.email, 'rina.baru@djc.test');
  assert.equal(res.body.data.user.must_change_password, true);
  assert.equal(res.body.data.provider_profile.verification_status, 'pending');
  assert.ok(await bcrypt.compare('Rahasia123', repo.created[0].passwordHash));
  assert.equal(repo.created[0].adminId, admin.id);
  assert.equal(repo.actions.at(-1).action, 'create_provider');

  const duplicate = await request(app)
    .post('/api/v1/admin/providers')
    .set('Authorization', bearer(admin))
    .send({ ...body, email: 'deni@djc.test' });
  assert.equal(duplicate.status, 409);

  const invalid = await request(app)
    .post('/api/v1/admin/providers')
    .set('Authorization', bearer(admin))
    .send({ ...body, alumni_reg_no: '', city: '' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body.error.details.map((d) => d.field).sort(), [
    'alumni_reg_no',
    'city',
  ]);
});

test('verifikasi mitra: verified butuh alamat+koordinat, rejected wajib catatan, aksi dicatat', async () => {
  const { app, repo } = setup();
  const verify = (id, body) =>
    request(app)
      .put(`/api/v1/admin/providers/${id}/verify`)
      .set('Authorization', bearer(admin))
      .send(body);

  const noLocation = await verify(repo.noLocation.id, { status: 'verified' });
  assert.equal(noLocation.status, 400);
  assert.match(noLocation.body.error.message, /alamat dan koordinat/);

  assert.equal((await verify(repo.noLocation.id, { status: 'rejected' })).status, 400);
  assert.equal(
    (await verify(repo.noLocation.id, { status: 'rejected', note: 'Pendek' })).status,
    400,
  );
  const rejected = await verify(repo.noLocation.id, {
    status: 'rejected',
    note: 'Nomor alumni tidak ditemukan di arsip.',
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.verification_status, 'rejected');

  const verified = await verify(repo.complete.id, { status: 'verified' });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.data.verified_by, admin.id);

  assert.deepEqual(
    repo.actions.map((a) => a.action),
    ['reject_provider', 'verify_provider'],
  );
  assert.equal((await verify(randomUUID(), { status: 'verified' })).status, 404);
  assert.equal((await verify('bukan-uuid', { status: 'verified' })).status, 404);
  assert.equal((await verify(repo.complete.id, { status: 'pending' })).status, 400);
});

test('moderasi ulasan: sembunyikan wajib alasan, tampilkan lagi, status sama 409', async () => {
  const { app, repo } = setup();
  const moderate = (body) =>
    request(app)
      .put(`/api/v1/admin/reviews/${repo.review.id}/moderate`)
      .set('Authorization', bearer(admin))
      .send(body);

  assert.equal((await moderate({ is_hidden: true })).status, 400);
  const hidden = await moderate({ is_hidden: true, reason: 'Mengandung kata kasar.' });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.data.is_hidden, true);
  assert.equal((await moderate({ is_hidden: true, reason: 'Mengandung kata kasar.' })).status, 409);
  const shown = await moderate({ is_hidden: false });
  assert.equal(shown.body.data.is_hidden, false);
  assert.deepEqual(
    repo.actions.map((a) => a.action),
    ['hide_review', 'unhide_review'],
  );
});

test('suspend: wajib alasan, tidak bisa diri sendiri atau admin lain, booking aktif ikut dibatalkan', async () => {
  const { app, repo } = setup();
  const put = (user, path, body) =>
    request(app)
      .put(`/api/v1/admin/users/${user.id}/${path}`)
      .set('Authorization', bearer(admin))
      .send(body);

  assert.equal((await put(customer, 'suspend', {})).status, 400);

  const self = await put(admin, 'suspend', { reason: 'Uji menonaktifkan diri sendiri' });
  assert.equal(self.status, 403);
  assert.equal(
    (await put(otherAdmin, 'suspend', { reason: 'Uji menonaktifkan admin lain' })).status,
    403,
  );

  const suspended = await put(provider, 'suspend', { reason: 'Melanggar ketentuan layanan.' });
  assert.equal(suspended.status, 200);
  assert.equal(suspended.body.data.user.status, 'suspended');
  assert.equal(suspended.body.data.cancelled_bookings, 2);
  assert.equal(
    (await put(provider, 'suspend', { reason: 'Melanggar ketentuan layanan.' })).status,
    409,
  );

  const activated = await put(provider, 'activate', {});
  assert.equal(activated.status, 200);
  assert.equal(activated.body.data.user.status, 'active');
  assert.deepEqual(
    repo.actions.map((a) => a.action),
    ['suspend_user', 'activate_user'],
  );
});

test('GET /admin/providers: daftar mitra dengan nomor alumni, filter status, dan meta halaman', async () => {
  const { app, repo } = setup();

  const res = await request(app)
    .get('/api/v1/admin/providers?status=pending&q=deni&page=2&limit=5')
    .set('Authorization', bearer(admin));

  assert.equal(res.status, 200);
  assert.deepEqual(repo.listCalls[0], [
    'providers',
    { status: 'pending', q: 'deni', page: 2, limit: 5 },
  ]);
  assert.deepEqual(res.body.meta, { page: 2, limit: 5, total_items: 13, total_pages: 3 });
  assert.deepEqual(res.body.data[0], {
    id: repo.complete.id,
    display_name: 'Deni',
    alumni_reg_no: 'ALM-001',
    city: 'Kota Bekasi',
    district: null,
    has_location: true,
    verification_status: 'pending',
    verified_at: null,
    rating_avg: 0,
    rating_count: 0,
    created_at: '2026-10-20T00:00:00.000Z',
    user: {
      id: provider.id,
      name: 'Deni',
      email: 'deni@djc.test',
      phone: '+6281200000001',
      status: 'active',
    },
  });

  const bad = await request(app)
    .get('/api/v1/admin/providers?status=aktif&limit=100')
    .set('Authorization', bearer(admin));
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.map((d) => d.field).sort(), ['limit', 'status']);
});

test('GET /admin/reviews: termasuk ulasan tersembunyi, filter hidden dan provider_id', async () => {
  const { app, repo } = setup();

  const res = await request(app)
    .get(`/api/v1/admin/reviews?hidden=false&provider_id=${repo.complete.id}`)
    .set('Authorization', bearer(admin));

  assert.equal(res.status, 200);
  assert.deepEqual(repo.listCalls[0], [
    'reviews',
    { hidden: false, providerId: repo.complete.id, page: 1, limit: 12 },
  ]);
  assert.equal(res.body.data[0].is_hidden, false);
  assert.deepEqual(res.body.data[0].provider, { id: repo.complete.id, display_name: 'Deni' });
  assert.deepEqual(res.body.data[0].customer, { id: customer.id, name: 'Budi' });
  assert.equal(res.body.data[0].booking_code, 'DJC-7K2M9QXA');

  const bad = await request(app)
    .get('/api/v1/admin/reviews?hidden=ya&provider_id=123')
    .set('Authorization', bearer(admin));
  assert.equal(bad.status, 400);
});

test('GET /admin/users: hasil kosong tetap 200, hanya admin', async () => {
  const { app, repo } = setup();

  const res = await request(app)
    .get('/api/v1/admin/users?role=provider&status=suspended&q=')
    .set('Authorization', bearer(admin));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    data: [],
    meta: { page: 1, limit: 12, total_items: 0, total_pages: 0 },
  });
  assert.deepEqual(repo.listCalls[0], [
    'users',
    { role: 'provider', status: 'suspended', q: undefined, page: 1, limit: 12 },
  ]);

  for (const path of ['/providers', '/reviews', '/users']) {
    const forbidden = await request(app)
      .get(`/api/v1/admin${path}`)
      .set('Authorization', bearer(customer));
    assert.equal(forbidden.status, 403, path);
  }
});

test('GET /admin/bookings: semua pesanan lintas akun tanpa kontak, filter status/tanggal/q', async () => {
  const { app, repo } = setup();

  const res = await request(app)
    .get(
      '/api/v1/admin/bookings?status=completed,cancelled&q=DJC&date_from=2026-11-01&date_to=2026-11-30&limit=20',
    )
    .set('Authorization', bearer(admin));

  assert.equal(res.status, 200);
  assert.deepEqual(repo.listCalls[0], [
    'bookings',
    {
      statuses: ['completed', 'cancelled'],
      q: 'DJC',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
      page: 1,
      limit: 20,
    },
  ]);
  assert.deepEqual(res.body.meta, { page: 1, limit: 20, total_items: 1, total_pages: 1 });
  const [item] = res.body.data;
  assert.equal(item.code, 'DJC-7K2M9QXA');
  assert.equal(item.scheduled_date, '2026-11-27');
  assert.equal(item.start_time, '10:00');
  assert.equal(item.estimated_total, 75000);
  assert.equal(item.final_total, 150000);
  assert.deepEqual(item.category, { id: 'c1', name: 'Servis Elektronik' });
  assert.deepEqual(item.customer, { id: customer.id, name: 'Budi' });
  assert.doesNotMatch(
    JSON.stringify(res.body),
    /Rahasia|\+6281200000010/,
    'alamat & HP tidak dikirim',
  );

  for (const query of [
    'status=aktif',
    'date_from=27-11-2026',
    'date_from=2026-12-01&date_to=2026-11-01',
    'limit=51',
  ]) {
    const bad = await request(app)
      .get(`/api/v1/admin/bookings?${query}`)
      .set('Authorization', bearer(admin));
    assert.equal(bad.status, 400, query);
  }
  for (const user of [customer, provider]) {
    const forbidden = await request(app)
      .get('/api/v1/admin/bookings')
      .set('Authorization', bearer(user));
    assert.equal(forbidden.status, 403);
  }
});

test('GET /admin/audit: jejak aksi admin terbaru dulu, filter aksi dan target', async () => {
  const { app, repo } = setup();

  const res = await request(app)
    .get(`/api/v1/admin/audit?action=suspend_user&target_type=user&target_id=${customer.id}`)
    .set('Authorization', bearer(admin));

  assert.equal(res.status, 200);
  assert.deepEqual(repo.listCalls[0], [
    'audit',
    {
      action: 'suspend_user',
      targetType: 'user',
      targetId: customer.id,
      adminId: undefined,
      page: 1,
      limit: 12,
    },
  ]);
  assert.deepEqual(res.body.data[0], {
    id: 'a1',
    action: 'suspend_user',
    target_type: 'user',
    target_id: customer.id,
    note: 'Melanggar aturan',
    created_at: '2026-11-26T06:00:00.000Z',
    admin: { id: admin.id, name: 'Andi' },
  });

  const bad = await request(app)
    .get('/api/v1/admin/audit?action=hapus_semua&admin_id=123')
    .set('Authorization', bearer(admin));
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.map((d) => d.field).sort(), ['action', 'admin_id']);

  const forbidden = await request(app)
    .get('/api/v1/admin/audit')
    .set('Authorization', bearer(provider));
  assert.equal(forbidden.status, 403);
});
