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
  }
  if (base64Bytes(match[2]) > MAX_IMAGE_BYTES) {
    ctx.addIssue({ code: 'custom', message: 'Ukuran gambar maksimal 5 MB.' });
  }
});

/** Parser JSON khusus upload: batas lebih besar karena gambar 5 MB menjadi ~6,7 MB base64. */
const uploadJson = express.json({ limit: '8mb' });

module.exports = { image, uploadJson, MAX_IMAGE_BYTES };
