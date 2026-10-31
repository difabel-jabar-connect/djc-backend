// Tes mailer tanpa jaringan: transport SMTP diganti versi palsu.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailer } = require('../src/services/mailer');

const link = 'http://localhost:5173/reset-kata-sandi?token=abc.def.ghi';

function fakeTransport({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async sendMail(message) {
      if (fail) throw new Error('koneksi SMTP ditolak');
      sent.push(message);
    },
  };
}

test('dengan SMTP, email reset dikirim berisi tautan di teks dan HTML', async () => {
  const transport = fakeTransport();
  const mailer = createMailer({ transport, enabled: true });

  await mailer.sendPasswordReset({ to: 'budi@djc.test', name: 'Budi Santoso', link });

  assert.equal(transport.sent.length, 1);
  const message = transport.sent[0];
  assert.equal(message.to, 'budi@djc.test');
  assert.equal(message.subject, 'Atur ulang kata sandi Difabel Jabar Connect');
  assert.ok('from' in message);
  assert.ok(message.text.includes(link));
  assert.ok(message.text.includes('30 menit'));
  assert.ok(message.html.includes(link));
  assert.match(message.html, /<html lang="id">/);
});

test('nama di email HTML di-escape', async () => {
  const transport = fakeTransport();
  const mailer = createMailer({ transport, enabled: true });

  await mailer.sendPasswordReset({
    to: 'budi@djc.test',
    name: '<script>alert(1)</script>',
    link,
  });

  const { html } = transport.sent[0];
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('gagal kirim lewat SMTP menjadi 503 SERVICE_UNAVAILABLE', async (t) => {
  t.mock.method(console, 'error', () => {});
  const mailer = createMailer({ transport: fakeTransport({ fail: true }), enabled: true });

  await assert.rejects(
    mailer.sendPasswordReset({ to: 'budi@djc.test', name: 'Budi', link }),
    (error) => error.status === 503 && error.code === 'SERVICE_UNAVAILABLE',
  );
});

test('tanpa SMTP, mailer tidak memakai transport (tautan hanya ke terminal)', async () => {
  const transport = fakeTransport();
  const mailer = createMailer({ transport, enabled: false });

  await mailer.sendPasswordReset({ to: 'budi@djc.test', name: 'Budi', link });

  assert.equal(transport.sent.length, 0);
});
