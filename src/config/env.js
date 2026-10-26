const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toList(value) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 5000),
  corsOrigins: toList(process.env.CORS_ORIGIN || 'http://localhost:5173'),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: toInt(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'difabel_jabar_connect',
    connectionLimit: toInt(process.env.DB_CONNECTION_LIMIT, 10),
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || '',
    // Sesi biasa 24 jam (NFR-SEC-02); "Ingat saya" memakai umur yang lebih panjang.
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
    jwtRememberExpiresIn: process.env.JWT_REMEMBER_EXPIRES_IN || '7d',
    bcryptSaltRounds: toInt(process.env.BCRYPT_SALT_ROUNDS, 10),
    resetTokenExpiresIn: process.env.RESET_TOKEN_EXPIRES_IN || '30m',
  },
};

// SMTP untuk email keluar (mis. Gmail + App Password). Kosong = tautan ditulis ke terminal.
env.mail = {
  host: process.env.SMTP_HOST || '',
  port: toInt(process.env.SMTP_PORT, 465),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
};
env.mail.secure = env.mail.port === 465;
env.mail.enabled = Boolean(env.mail.host && env.mail.user && env.mail.pass);

// Upload gambar ke Cloudinary (foto profil dan portofolio provider). Kosong = upload ditolak 503.
env.cloudinary = {
  cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  apiKey: process.env.CLOUDINARY_API_KEY || '',
  apiSecret: process.env.CLOUDINARY_API_SECRET || '',
};

env.app = {
  // Alamat frontend untuk tautan di email, mis. tautan reset kata sandi.
  frontendUrl: (process.env.FRONTEND_URL || env.corsOrigins[0] || '').replace(/\/+$/, ''),
};

env.isProduction = env.nodeEnv === 'production';
env.isTest = env.nodeEnv === 'test';

module.exports = env;
