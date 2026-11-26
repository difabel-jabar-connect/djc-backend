const express = require('express');
const { z } = require('zod');

// Gambar dikirim sebagai data URI base64 di body JSON, mis. hasil FileReader.readAsDataURL.
// Dipakai upload foto/portofolio provider dan foto profil di Akun Saya.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const DATA_URI_PATTERN = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Ukuran asli (byte) dari isi base64, tanpa men-decode seluruhnya. */
function base64Bytes(base64) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Memastikan magic bytes awal hasil decode cocok dengan MIME gambar (OWASP A04/A08). */
function matchesMagicBytes(mime, base64) {
  const head = Buffer.from(base64.slice(0, 32), 'base64');
  if (head.length < 4) return false;
  switch (mime) {
    case 'image/jpeg':
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/png':
      return (
        head.length >= 8 &&
        head[0] === 0x89 &&
        head[1] === 0x50 &&
        head[2] === 0x4e &&
        head[3] === 0x47 &&
        head[4] === 0x0d &&
        head[5] === 0x0a &&
        head[6] === 0x1a &&
        head[7] === 0x0a
      );
    case 'image/gif':
      return (
        head.length >= 6 &&
        (head.subarray(0, 6).toString('ascii') === 'GIF87a' ||
          head.subarray(0, 6).toString('ascii') === 'GIF89a')
      );
    case 'image/webp':
      return (
        head.length >= 12 &&
        head.subarray(0, 4).toString('ascii') === 'RIFF' &&
        head.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    case 'image/avif':
      return (
        head.length >= 12 &&
        head.subarray(4, 8).toString('ascii') === 'ftyp' &&
        ['avif', 'avis', 'mif1'].includes(head.subarray(8, 12).toString('ascii'))
      );
    default:
      return false;
  }
}

const image = z.string('Gambar wajib diunggah.').superRefine((value, ctx) => {
  const match = DATA_URI_PATTERN.exec(value);
  if (!match) {
    ctx.addIssue({
      code: 'custom',
      message: 'Gambar harus dikirim sebagai data URI base64, mis. data:image/jpeg;base64,….',
    });
    return;
  }
  if (!IMAGE_TYPES.includes(match[1])) {
    ctx.addIssue({
      code: 'custom',
      message: 'Format gambar harus JPG, PNG, WebP, GIF, atau AVIF.',
    });
    return;
  }
  if (base64Bytes(match[2]) > MAX_IMAGE_BYTES) {
    ctx.addIssue({ code: 'custom', message: 'Ukuran gambar maksimal 5 MB.' });
    return;
  }
  if (!matchesMagicBytes(match[1], match[2])) {
    ctx.addIssue({
      code: 'custom',
      message: 'Isi file tidak sesuai dengan format gambar yang dipilih.',
    });
  }
});

/** Parser JSON khusus upload: batas lebih besar karena gambar 5 MB menjadi ~6,7 MB base64. */
const uploadJson = express.json({ limit: '8mb' });

/**
 * Menghapus gambar lama di Cloudinary setelah datanya diganti atau dihapus (QA-02 R-07).
 * Best effort: kegagalan hanya dicatat, permintaan pengguna tetap berhasil.
 */
async function discardImage(cloudinary, url) {
  if (!url || typeof cloudinary?.destroyImage !== 'function') return;
  try {
    await cloudinary.destroyImage(url);
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') console.warn(`[cloudinary] ${error.message}`);
  }
}

module.exports = { image, uploadJson, discardImage, MAX_IMAGE_BYTES };
