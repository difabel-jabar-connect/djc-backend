const nodemailer = require('nodemailer');
const env = require('../config/env');
const { ApiError } = require('../utils/response');

// Penyedia email final belum diputuskan (STK-OPN-03). Jika SMTP_* diisi (mis. Gmail +
// App Password), email dikirim lewat SMTP. Jika kosong, di development tautan ditulis
// ke terminal backend, dan di production permintaan ditolak 503.

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

// '30m' → '30 menit'; format lain ditampilkan apa adanya.
function describeDuration(value) {
  const match = /^(\d+)\s*([mhd])$/.exec(String(value));
  if (!match) return String(value);
  return `${match[1]} ${{ m: 'menit', h: 'jam', d: 'hari' }[match[2]]}`;
}

function passwordResetMessage({ name, link }) {
  const minutes = describeDuration(env.auth.resetTokenExpiresIn);
  const text = [
    `Halo ${name},`,
    '',
    'Kami menerima permintaan untuk mengatur ulang kata sandi akun Difabel Jabar Connect Anda.',
    'Buka tautan berikut untuk membuat kata sandi baru:',
    link,
    '',
    `Tautan berlaku ${minutes} dan hanya bisa dipakai sekali.`,
    'Jika Anda tidak meminta reset kata sandi, abaikan email ini. Kata sandi Anda tidak berubah.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="id">
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;padding:24px;border-radius:8px">
      <h1 style="font-size:22px;margin:0 0 16px">Atur ulang kata sandi</h1>
      <p>Halo ${escapeHtml(name)},</p>
      <p>Kami menerima permintaan untuk mengatur ulang kata sandi akun Difabel Jabar Connect Anda.</p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(link)}" style="display:inline-block;background:#0b5394;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Buat kata sandi baru</a>
      </p>
      <p>Jika tombol tidak bisa dibuka, salin tautan ini ke browser:<br><a href="${escapeHtml(link)}" style="color:#0b5394;word-break:break-all">${escapeHtml(link)}</a></p>
      <p>Tautan berlaku ${escapeHtml(minutes)} dan hanya bisa dipakai sekali.</p>
      <p>Jika Anda tidak meminta reset kata sandi, abaikan email ini. Kata sandi Anda tidak berubah.</p>
    </div>
  </body>
</html>`;

  return { subject: 'Atur ulang kata sandi Difabel Jabar Connect', text, html };
}

let defaultTransport;
function getTransport() {
  defaultTransport ??= nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    secure: env.mail.secure,
    auth: { user: env.mail.user, pass: env.mail.pass },
  });
  return defaultTransport;
}

/** `transport` dapat diganti saat testing, mis. createMailer({ transport: fake, enabled: true }). */
function createMailer({ transport, enabled = env.mail.enabled } = {}) {
  async function sendPasswordReset({ to, name, link }) {
    if (!enabled) {
      if (env.isProduction) {
        throw new ApiError(
          503,
          'SERVICE_UNAVAILABLE',
          'Reset kata sandi lewat email belum tersedia.',
        );
      }
      if (!env.isTest) console.info(`[mailer] Reset kata sandi untuk ${name} <${to}>: ${link}`);
      return;
    }

    try {
      await (transport ?? getTransport()).sendMail({
        from: env.mail.from,
        to,
        ...passwordResetMessage({ name, link }),
      });
    } catch (error) {
      console.error(`[mailer] Gagal mengirim email reset: ${error.message}`);
      throw new ApiError(
        503,
        'SERVICE_UNAVAILABLE',
        'Email reset gagal dikirim. Silakan coba lagi nanti.',
      );
    }
  }

  return { sendPasswordReset };
}

module.exports = { createMailer, ...createMailer() };
