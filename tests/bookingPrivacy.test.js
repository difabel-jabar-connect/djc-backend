// Tes privasi kontak dan alamat booking (BE-07): untuk setiap status dan setiap pihak,
// kontak/alamat lawan transaksi hanya terbuka saat accepted/in_progress.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const createApp = require('../src/app');
const { contactAccess } = require('../src/routes/bookings');
const { signToken } = require('../src/utils/token');

const STATUSES = ['requested', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled'];
const OPEN = new Set(['accepted', 'in_progress']);

const customer = { id: randomUUID(), role: 'customer', status: 'active' };
const providerUser = { id: randomUUID(), role: 'provider', status: 'active' };
const admin = { id: randomUUID(), role: 'admin', status: 'active' };
const PROVIDER_ID = randomUUID();

const SECRET = {
  customerPhone: '+6281200000099',
  providerPhone: '+6281300000088',
  customerAddress: 'Jl. Rahasia Customer No. 7',
  providerAddress: 'Jl. Rahasia Penyedia No. 9',
};

/** Satu baris booking lengkap (seperti hasil repository) dengan status dan mode tertentu. */
function bookingRow({ status, mode, wasAccepted = false }) {
  return {
    id: randomUUID(),
    code: 'DJC-UJI',
    status,
    customer_id: customer.id,
    provider_id: PROVIDER_ID,
    service_id: randomUUID(),
    service_title: 'Layanan uji',
    provider_user_id: providerUser.id,
    provider_display_name: 'Deni Setiawan',
    provider_city: 'Kota Bekasi',
    provider_district: 'Bekasi Timur',
    provider_address_detail: SECRET.providerAddress,
    provider_phone: SECRET.providerPhone,
    customer_full_name: 'Budi Santoso',
    customer_phone: SECRET.customerPhone,
    was_accepted: wasAccepted ? 1 : 0,
    scheduled_date: '2026-11-09',
    start_time: '09:00:00',
    service_mode: mode,
    location_area: mode === 'at_customer' ? 'Bekasi Timur, Kota Bekasi' : null,
    location_address: mode === 'at_customer' ? SECRET.customerAddress : null,
    location_lat: mode === 'at_customer' ? '-6.238321' : null,
    location_lng: mode === 'at_customer' ? '106.975612' : null,
    customer_note: null,
    pricing_type_snapshot: 'fixed',
    unit_price_snapshot: 50000,
    quantity: '1.0',
    estimated_total: 50000,
    actual_quantity: null,
    final_total: null,
    cancelled_by: status === 'cancelled' ? 'customer' : null,
    status_reason: null,
    history: [],
  };
}

function appWith(rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const bookings = {
    async findById(id) {
      return byId.get(id) ?? null;
    },
    async findProviderProfileId(userId) {
      return userId === providerUser.id ? PROVIDER_ID : null;
    },
    async list({ customerId, providerId }) {
      const items = rows.filter(
        (row) =>
          (!customerId || row.customer_id === customerId) &&
          (!providerId || row.provider_id === providerId),
      );
      return { items, total: items.length };
    },
  };
  const users = {
    async findById(id) {
      return [customer, providerUser, admin].find((user) => user.id === id) ?? null;
    },
  };
  return createApp({ bookings, users });
}

const bearer = (user) => `Bearer ${signToken(user).token}`;
const leaks = (body) =>
  Object.values(SECRET).filter((value) => JSON.stringify(body).includes(value));

test('contactAccess: tabel buka-tutup untuk setiap status, pihak, dan mode layanan', () => {
  for (const status of STATUSES) {
    const open = OPEN.has(status);
    for (const mode of ['at_customer', 'at_provider']) {
      const row = { status, service_mode: mode, was_accepted: 0 };

      const asProvider = contactAccess(row, 'provider');
      assert.equal(asProvider.customerPhone, open, `provider/${status}/${mode}: telepon customer`);
      assert.equal(
        asProvider.customerLocation,
        open,
        `provider/${status}/${mode}: alamat customer`,
      );
      assert.equal(asProvider.providerPhone, true, 'provider selalu melihat teleponnya sendiri');

      const asCustomer = contactAccess(row, 'customer');
      assert.equal(asCustomer.providerPhone, open, `customer/${status}/${mode}: telepon provider`);
      assert.equal(
        asCustomer.providerAddress,
        open && mode === 'at_provider',
        `customer/${status}/${mode}: alamat provider`,
      );
      assert.equal(asCustomer.customerLocation, true, 'customer selalu melihat alamatnya sendiri');

      const asAdmin = contactAccess(row, 'admin');
      assert.deepEqual(
        [
          asAdmin.providerPhone,
          asAdmin.providerAddress,
          asAdmin.customerPhone,
          asAdmin.customerLocation,
        ],
        [false, false, false, false],
        `admin/${status}/${mode}: tanpa kontak/alamat`,
      );
    }
  }
});

test('nama customer untuk provider: inisial saat requested, lengkap setelah pernah diterima', () => {
  assert.equal(
    contactAccess({ status: 'requested', was_accepted: 0 }, 'provider').customerFullName,
    false,
  );
  assert.equal(
    contactAccess({ status: 'accepted', was_accepted: 1 }, 'provider').customerFullName,
    true,
  );
  assert.equal(
    contactAccess({ status: 'completed', was_accepted: 1 }, 'provider').customerFullName,
    true,
  );
  assert.equal(
    contactAccess({ status: 'cancelled', was_accepted: 1 }, 'provider').customerFullName,
    true,
  );
  assert.equal(
    contactAccess({ status: 'cancelled', was_accepted: 0 }, 'provider').customerFullName,
    false,
  );
  assert.equal(
    contactAccess({ status: 'rejected', was_accepted: 0 }, 'provider').customerFullName,
    false,
  );
});

test('GET /bookings/:id: tidak ada kebocoran kontak/alamat lawan transaksi di luar accepted/in_progress', async () => {
  for (const status of STATUSES) {
    for (const mode of ['at_customer', 'at_provider']) {
      const row = bookingRow({
        status,
        mode,
        wasAccepted: status !== 'requested' && status !== 'rejected',
      });
      const app = appWith([row]);
      const open = OPEN.has(status);

      const forProvider = (
        await request(app)
          .get(`/api/v1/bookings/${row.id}`)
          .set('Authorization', bearer(providerUser))
      ).body.data;
      assert.equal(
        forProvider.customer.phone,
        open ? SECRET.customerPhone : null,
        `provider/${status}/${mode}`,
      );
      assert.equal(
        forProvider.location.address,
        open && mode === 'at_customer' ? SECRET.customerAddress : null,
        `provider/${status}/${mode}: alamat`,
      );
      assert.equal(forProvider.location.lat, open && mode === 'at_customer' ? -6.238321 : null);

      const forCustomer = (
        await request(app).get(`/api/v1/bookings/${row.id}`).set('Authorization', bearer(customer))
      ).body.data;
      assert.equal(
        forCustomer.provider.phone,
        open ? SECRET.providerPhone : null,
        `customer/${status}/${mode}`,
      );
      assert.equal(
        forCustomer.provider.address_detail,
        open && mode === 'at_provider' ? SECRET.providerAddress : null,
        `customer/${status}/${mode}: alamat provider`,
      );

      const forAdmin = (
        await request(app).get(`/api/v1/bookings/${row.id}`).set('Authorization', bearer(admin))
      ).body.data;
      assert.deepEqual(leaks(forAdmin), [], `admin/${status}/${mode}: tidak ada data privat`);
    }
  }
});

test('requested: provider hanya melihat area dan nama singkat, tidak ada data privat customer', async () => {
  const row = bookingRow({ status: 'requested', mode: 'at_customer' });
  const app = appWith([row]);

  const body = (
    await request(app).get(`/api/v1/bookings/${row.id}`).set('Authorization', bearer(providerUser))
  ).body;
  assert.equal(body.data.customer.name, 'Budi S.');
  assert.equal(body.data.location.area, 'Bekasi Timur, Kota Bekasi');
  assert.deepEqual(
    leaks(body).filter((value) => value !== SECRET.providerPhone),
    [],
    'tidak ada telepon atau alamat customer',
  );
});

test('GET /bookings (daftar) memakai aturan yang sama dengan detail', async () => {
  const rows = STATUSES.map((status) =>
    bookingRow({ status, mode: 'at_customer', wasAccepted: OPEN.has(status) }),
  );
  const app = appWith(rows);

  const list = (
    await request(app).get('/api/v1/bookings').set('Authorization', bearer(providerUser))
  ).body.data;
  assert.equal(list.length, STATUSES.length);
  for (const item of list) {
    const open = OPEN.has(item.status);
    assert.equal(item.customer.phone, open ? SECRET.customerPhone : null, `daftar/${item.status}`);
    assert.equal(
      item.location.address,
      open ? SECRET.customerAddress : null,
      `daftar/${item.status}`,
    );
  }

  const customerList = (
    await request(app).get('/api/v1/bookings').set('Authorization', bearer(customer))
  ).body.data;
  for (const item of customerList) {
    assert.equal(item.provider.phone, OPEN.has(item.status) ? SECRET.providerPhone : null);
    assert.equal(
      item.location.address,
      SECRET.customerAddress,
      'customer melihat alamatnya sendiri',
    );
  }
});
