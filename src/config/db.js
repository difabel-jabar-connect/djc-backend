const mysql = require('mysql2/promise');
const env = require('./env');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      database: env.db.database,
      connectionLimit: env.db.connectionLimit,
      waitForConnections: true,
      // Semua waktu disimpan dalam UTC (lihat docs/technical/data-model.md).
      timezone: 'Z',
      dateStrings: false,
      connectTimeout: 5000,
    });
    // Sesi MySQL juga UTC supaya DEFAULT CURRENT_TIMESTAMP(6) tidak ikut zona waktu
    // server (MySQL di laptop Windows biasanya WIB).
    pool.on('connection', (connection) => {
      connection.query("SET time_zone = '+00:00'");
    });
  }
  return pool;
}

async function ping() {
  const [rows] = await getPool().query('SELECT VERSION() AS version');
  return { version: rows[0].version };
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { getPool, ping, closePool };
