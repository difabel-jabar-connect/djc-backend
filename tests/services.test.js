// Tes pencarian layanan tanpa MySQL: repository layanan diganti versi palsu yang mencatat
// filter yang diterima.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const createApp = require('../src/app');

const SERVICE = {
  id: randomUUID(),
  title: 'Ganti kabel dan stop kontak',
  pricing_type: 'fixed',
  price_amount: 50000,
  category: { id: randomUUID(), name: 'Servis Elektronik', slug: 'servis-elektronik' },
  provider: { id: randomUUID(), display_name: 'Deni', public_lat: -6.24, public_lng: 106.98 },
};

function fakeServices({ total = 25 } = {}) {
  const calls = [];
  return {
    calls,
    async search(filters) {
      calls.push(filters);
      return { items: [SERVICE], total };
    },
    async findPublicById(id) {
      return id === SERVICE.id ? SERVICE : null;
    },
  };
}

test('GET /services tanpa filter: default halaman 1, 12 per halaman, urut terbaru', async () => {
  const services = fakeServices();

  const res = await request(createApp({ services })).get('/api/v1/services');

  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 1);
  assert.deepEqual(res.body.meta, { page: 1, limit: 12, total_items: 25, total_pages: 3 });
  assert.deepEqual(services.calls[0], {
    q: undefined,
    categoryId: undefined,
    category: undefined,
    city: undefined,
    minPrice: undefined,
    maxPrice: undefined,
    minRating: undefined,
    dayOfWeek: undefined,
    sort: 'newest',
    page: 1,
    limit: 12,
  });
});

test('GET /services meneruskan semua filter dengan tipe yang benar', async () => {
  const services = fakeServices({ total: 7 });
  const categoryId = randomUUID();

  const res = await request(createApp({ services })).get('/api/v1/services').query({
    q: ' servis kipas ',
    category_id: categoryId,
    category: 'servis-elektronik',
    city: 'Kota Bekasi',
    min_price: '10000',
    max_price: '100000',
    min_rating: '4.5',
    day_of_week: '1',
    sort: 'price_asc',
    page: '2',
    limit: '5',
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.meta, { page: 2, limit: 5, total_items: 7, total_pages: 2 });
  assert.deepEqual(services.calls[0], {
    q: 'servis kipas',
    categoryId,
    category: 'servis-elektronik',
    city: 'Kota Bekasi',
    minPrice: 10000,
    maxPrice: 100000,
    minRating: 4.5,
    dayOfWeek: 1,
    sort: 'price_asc',
    page: 2,
    limit: 5,
  });
});

test('parameter kosong (?city=&q=) diabaikan, bukan error', async () => {
  const services = fakeServices();

  const res = await request(createApp({ services })).get('/api/v1/services?city=&q=&min_price=');

  assert.equal(res.status, 200);
  assert.equal(services.calls[0].city, undefined);
  assert.equal(services.calls[0].q, undefined);
  assert.equal(services.calls[0].minPrice, undefined);
});

test('hasil kosong mengembalikan total_pages 0 dengan struktur meta standar', async () => {
  const res = await request(createApp({ services: fakeServices({ total: 0 }) })).get(
    '/api/v1/services',
  );
  assert.deepEqual(res.body.meta, { page: 1, limit: 12, total_items: 0, total_pages: 0 });
});

test('validasi query pencarian: 400 dengan detail per field', async () => {
  const app = createApp({ services: fakeServices() });
  const cases = [
    [{ sort: 'acak' }, 'sort'],
    [{ min_price: 'murah' }, 'min_price'],
    [{ min_price: '200000', max_price: '1000' }, 'min_price'],
    [{ min_rating: '6' }, 'min_rating'],
    [{ day_of_week: '7' }, 'day_of_week'],
    [{ limit: '51' }, 'limit'],
    [{ page: '0' }, 'page'],
    [{ category_id: 'bukan-uuid' }, 'category_id'],
  ];
  for (const [query, field] of cases) {
    const res = await request(app).get('/api/v1/services').query(query);
    assert.equal(res.status, 400, JSON.stringify(query));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.details[0].field, field);
  }
});

test('GET /services/:id: detail layanan, 404 untuk id asing atau bukan UUID', async () => {
  const app = createApp({ services: fakeServices() });

  const found = await request(app).get(`/api/v1/services/${SERVICE.id}`);
  assert.equal(found.status, 200);
  assert.equal(found.body.data.title, SERVICE.title);

  for (const id of [randomUUID(), 'bukan-uuid']) {
    const missing = await request(app).get(`/api/v1/services/${id}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
  }
});
