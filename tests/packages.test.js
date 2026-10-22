// Memastikan package yang disiapkan untuk fitur auth dan validasi terpasang dan bekerja.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');

test('bcryptjs dapat hash dan mencocokkan password', async () => {
  const hash = await bcrypt.hash('rahasia123', 10);
  assert.equal(await bcrypt.compare('rahasia123', hash), true);
  assert.equal(await bcrypt.compare('salah', hash), false);
});

test('jsonwebtoken dapat membuat dan memverifikasi token', () => {
  const token = jwt.sign({ sub: 'user-1', role: 'customer' }, 'secret-test', { expiresIn: '1h' });
  const payload = jwt.verify(token, 'secret-test');
  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.role, 'customer');
});

test('zod memvalidasi body request', () => {
  const schema = z.object({ email: z.email(), password: z.string().min(8) });
  assert.equal(
    schema.safeParse({ email: 'budi@example.com', password: 'rahasia123' }).success,
    true,
  );
  assert.equal(schema.safeParse({ email: 'bukan-email', password: '123' }).success, false);
});
