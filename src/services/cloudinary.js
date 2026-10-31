const crypto = require('node:crypto');
const env = require('../config/env');

// Upload gambar ke Cloudinary lewat Upload API bertanda tangan (tanpa SDK tambahan).
// Gambar disimpan sebagai WebP, dibatasi maks 1200 px, dengan kompresi kualitas otomatis
// supaya ukurannya kecil (target < 300 KB, NFR-PERF-02).
const MAX_DIMENSION = 1200;
const TRANSFORMATION = `c_limit,w_${MAX_DIMENSION},h_${MAX_DIMENSION}/q_auto:good`;

/** Tanda tangan Cloudinary: SHA-1 dari parameter terurut + API secret. */
function sign(params, apiSecret) {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto
    .createHash('sha1')
    .update(payload + apiSecret)
    .digest('hex');
}

/**
 * `fetchImpl` dapat diganti saat testing supaya tes tidak memanggil Cloudinary,
 * mis. createCloudinary({ config, fetchImpl: fakeFetch }).
 */
function createCloudinary({
  config = env.cloudinary,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  const configured = Boolean(config.cloudName && config.apiKey && config.apiSecret);

  /**
   * Mengunggah gambar (data URI base64) ke folder `folder`. Mengembalikan URL HTTPS
   * dan metadata, atau melempar error berisi alasan (tanpa secret) untuk log server.
   */
  async function uploadImage({ dataUri, folder }) {
    const params = {
      folder,
      format: 'webp',
      timestamp: Math.floor(Date.now() / 1000),
      transformation: TRANSFORMATION,
    };
    const body = new URLSearchParams({
      ...params,
      file: dataUri,
      api_key: config.apiKey,
      signature: sign(params, config.apiSecret),
    });

    const res = await fetchImpl(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`,
      { method: 'POST', body },
    );
    const result = await res.json().catch(() => ({}));
    if (!res.ok || typeof result.secure_url !== 'string') {
      throw new Error(
        `upload Cloudinary gagal (${res.status} ${result.error?.message ?? ''})`.trim(),
      );
    }
    return {
      url: result.secure_url,
      publicId: result.public_id,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      format: result.format,
    };
  }

  return { configured, uploadImage };
}

module.exports = { createCloudinary, sign };
