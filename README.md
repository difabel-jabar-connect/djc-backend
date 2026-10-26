# djc-backend

REST API Difabel Jabar Connect, marketplace jasa berbasis lokasi bagi alumni penyandang disabilitas di Jawa Barat. Node.js + Express dengan database MySQL 8, di-deploy ke Railway, sesuai keputusan stack Week 1 (`docs/project-management/meeting-notes/2026-10-04-week-1-decisions.md` dan `docs/technical/stack-comparison.md` di repository dokumentasi [deonaja/difabel-jabar-connect](https://github.com/deonaja/difabel-jabar-connect)).

Status: repository disiapkan melalui deonaja/difabel-jabar-connect#13; fondasi Express/MySQL dan API contract ditambahkan melalui deonaja/difabel-jabar-connect#15. Yang sudah ada: `GET /api/v1/health`, auth (register, login, logout, me, lupa/reset kata sandi), dan kategori (daftar publik, kelola admin); endpoint fitur mengikuti [`docs/api-contract.md`](docs/api-contract.md).

Baca [CONTRIBUTING.md](CONTRIBUTING.md) sebelum membuat branch atau pull request.

## Kebutuhan

- Node.js 20 atau lebih baru (`node -v`)
- **MySQL 8** (disarankan 8.4 LTS). Railway juga memakai MySQL 8, jadi lokal sebaiknya sama.

> Jangan pakai MySQL bawaan XAMPP. XAMPP berisi **MariaDB**, bukan MySQL 8; beberapa fitur yang dipakai model data (CHECK constraint, JSON, foreign key komposit) perilakunya bisa berbeda dengan server Railway.

### Cara pasang MySQL 8 di Windows (pilih satu)

1. **MySQL Installer resmi**: unduh "MySQL Community Server 8.4 LTS" dari <https://dev.mysql.com/downloads/mysql/>, pilih setup "Server only", catat password `root`.
2. **Docker Desktop** (jika sudah terpasang):

   ```bash
   docker run -d --name djc-mysql -p 3306:3306 \
     -e MYSQL_ROOT_PASSWORD=rootpass \
     -e MYSQL_DATABASE=difabel_jabar_connect \
     -e MYSQL_USER=djc -e MYSQL_PASSWORD=djcpass \
     mysql:8.4
   ```

### Buat database dan user (jika pakai MySQL Installer)

Buka MySQL Shell / MySQL Workbench sebagai `root`, lalu:

```sql
CREATE DATABASE difabel_jabar_connect CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'djc'@'localhost' IDENTIFIED BY 'djcpass';
GRANT ALL PRIVILEGES ON difabel_jabar_connect.* TO 'djc'@'localhost';
FLUSH PRIVILEGES;
```

## Setup lokal

```bash
npm install
cp .env.example .env      # Windows CMD: copy .env.example .env
```

Isi `.env` sesuai MySQL kamu (`DB_USER`, `DB_PASSWORD`, `DB_NAME`). Isi juga `JWT_SECRET` dengan string acak panjang, misalnya hasil `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Jika kosong, server development memakai secret acak sementara sehingga semua sesi hilang setiap restart; di production server menolak jalan.

Repository ini memakai akhir baris LF di semua OS (`.gitattributes`). Jika kamu meng-clone sebelum file itu ada dan `npm run format:check` gagal di Windows, pastikan tidak ada perubahan yang belum di-commit, lalu jalankan sekali `git rm -r --cached . -q` dan `git reset --hard` untuk checkout ulang dengan LF (file `.env` tidak ikut terhapus).

Cek koneksi database:

```bash
npm run db:check
# Koneksi MySQL berhasil (djc@127.0.0.1:3306/difabel_jabar_connect), versi server 8.4.x.
```

Jalankan API:

```bash
npm run dev               # auto-restart saat file berubah
```

Buka <http://localhost:5000/api/v1/health>:

```json
{ "data": { "status": "ok", "database": "up", "timestamp": "..." } }
```

Jika MySQL mati, endpoint yang sama mengembalikan HTTP 503 dengan `"database": "down"`.

## Auth

| Endpoint                            | Fungsi                                                          |
| ----------------------------------- | --------------------------------------------------------------- |
| `POST /api/v1/auth/register`        | Daftar akun customer (akun mitra dibuat admin, `role` lain 403) |
| `POST /api/v1/auth/login`           | Masuk, JWT dikirim di cookie HttpOnly `djc_token` dan di body   |
| `POST /api/v1/auth/logout`          | Menghapus cookie                                                |
| `GET /api/v1/auth/me`               | User yang sedang login, plus status verifikasi untuk provider   |
| `POST /api/v1/auth/password/forgot` | Minta tautan reset kata sandi (berlaku 30 menit)                |
| `POST /api/v1/auth/password/reset`  | Simpan kata sandi baru dengan token dari tautan                 |

Request dan respons memakai `name` untuk nama lengkap (kolom `users.full_name`). Sesi berlaku 24 jam, atau 7 hari jika login dengan `"remember": true`. Login gagal 10 kali dari IP yang sama dalam 15 menit dikunci sementara (429). Detail request dan respons ada di API contract bagian 4.

Jika SMTP di `.env` belum diisi, link reset muncul di terminal backend (`[mailer] Reset kata sandi untuk …`).

### Kirim email lewat Gmail

1. Pakai akun Gmail khusus proyek (bukan email pribadi) dan aktifkan Verifikasi 2 Langkah.
2. Buka Google Account → Security → App passwords, buat App Password, salin kode 16 karakternya.
3. Isi di `.env`: `SMTP_USER` (alamat Gmail), `SMTP_PASS` (App Password), dan opsional `MAIL_FROM`, mis. `"Difabel Jabar Connect <alamat@gmail.com>"`. `SMTP_HOST=smtp.gmail.com` dan `SMTP_PORT=465` sudah ada di `.env.example`.
4. Restart backend (Ctrl+C, lalu `npm run dev`) setelah mengubah `.env`.

Gmail membatasi sekitar 500 email per hari. Penyedia email final masih menunggu STK-OPN-03. Paket Railway yang lebih rendah bisa memblokir SMTP keluar; jika begitu, production perlu API email berbasis HTTP (mis. Resend atau Brevo) di balik fungsi `sendPasswordReset` yang sama di `src/services/mailer.js`.

Coba dari terminal setelah `npm run db:seed` (PowerShell: pakai `curl.exe`):

```bash
curl -c cookie.txt -H "Content-Type: application/json" \
  -d '{"email":"budi@djc.test","password":"Demo12345"}' \
  http://localhost:5000/api/v1/auth/login
curl -b cookie.txt http://localhost:5000/api/v1/auth/me
```

Router fitur lain melindungi endpoint dengan middleware dari `src/middlewares/auth.js`:

```js
const { requireAuth, requireRole, requireActiveUser } = require('../middlewares/auth');
router.post('/bookings', requireAuth, requireRole('customer'), requireActiveUser(), createBooking);
// req.auth berisi { userId, role }
```

`requireActiveUser()` menolak aksi tulis (POST/PUT/PATCH/DELETE) dari akun `suspended` dengan `403 ACCOUNT_SUSPENDED`; GET tetap boleh. Pasang di setiap route tulis.

## Perintah

| Perintah                                    | Fungsi                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| `npm run dev`                               | Menjalankan API dengan auto-restart (`node --watch`) |
| `npm start`                                 | Menjalankan API (production)                         |
| `npm run db:check`                          | Mengecek koneksi MySQL dari `.env`                   |
| `npm run db:migrate`                        | Menjalankan migrasi yang belum jalan (knex)          |
| `npm run db:rollback`                       | Membatalkan batch migrasi terakhir                   |
| `npm run db:fresh`                          | Rollback semua lalu migrasi ulang dari nol           |
| `npm run db:make-migration -- nama_migrasi` | Membuat file migrasi baru di `db/migrations/`        |
| `npm run db:seed`                           | Mengisi data dummy dari `db/seeds/`                  |
| `npm test`                                  | Menjalankan test (Node test runner + Supertest)      |
| `npm run lint` / `npm run lint:fix`         | ESLint                                               |
| `npm run format` / `npm run format:check`   | Prettier                                             |

Tes yang memakai MySQL sungguhan (koneksi, skema, seeder, auth) ikut dijalankan jika `DB_TEST=1`. Tes seeder mengisi ulang database dengan data dummy.

```bash
DB_TEST=1 npm test            # PowerShell: $env:DB_TEST=1; npm test
```

## Kategori

| Endpoint                           | Fungsi                                                             |
| ---------------------------------- | ------------------------------------------------------------------ |
| `GET /api/v1/categories`           | Kategori aktif, urut `sort_order` (publik, tanpa token)            |
| `POST /api/v1/admin/categories`    | Admin menambah kategori; slug dibuat dari nama jika tidak dikirim  |
| `PUT /api/v1/admin/categories/:id` | Admin mengubah kategori atau menonaktifkannya (`is_active: false`) |

Nama atau slug yang sudah dipakai ditolak `409`. Setiap perubahan admin dicatat di `admin_actions`. Coba dengan akun demo `admin@djc.test` / `Demo12345`.

## Database: migrasi dan data dummy

Skema 12 tabel mengikuti `docs/technical/data-model.md` di repository dokumentasi (SP1-02): UUID `CHAR(36)`, waktu `DATETIME(6)` UTC, uang `BIGINT` rupiah, dan semua CHECK constraint. Satu file migrasi per tabel di `db/migrations/`.

```bash
npm run db:migrate            # buat semua tabel
npm run db:seed               # HAPUS semua data lalu isi data dummy
npm run db:fresh              # drop semua tabel lalu migrasi ulang dari nol
```

Data dummy (SP1-09) berisi 10 user, 6 provider di 6 kota, 8 kategori, 8 layanan, 7 booking (satu per status), dan 2 review. ID-nya tetap sama setiap seed ulang, dan tanggal booking dihitung dari hari ini.

Semua akun demo memakai password `Demo12345` (ganti lewat `SEED_PASSWORD` di `.env`):

| Peran                       | Email                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| Admin                       | `admin@djc.test`                                                   |
| Customer                    | `budi@djc.test`, `ani@djc.test`, `citra@djc.test`                  |
| Provider verified           | `deni@djc.test`, `siti@djc.test`, `asep@djc.test`, `rina@djc.test` |
| Provider pending / rejected | `yusuf@djc.test` / `dewi@djc.test`                                 |

Di `NODE_ENV=production` seeder menolak jalan kecuali `SEED_FORCE=1`, supaya data asli tidak terhapus tanpa sengaja.

## Package yang dipakai

| Package              | Untuk apa                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `express`            | Web framework REST API                                                                                    |
| `mysql2`             | Driver MySQL 8                                                                                            |
| `knex`               | Migrasi dan seeder (`db/migrations`, `db/seeds`), sesuai kewajiban migration + seeder di keputusan Week 1 |
| `dotenv`             | Membaca `.env`                                                                                            |
| `cors`, `helmet`     | Izin origin frontend dan header keamanan dasar                                                            |
| `cookie-parser`      | Membaca cookie JWT `djc_token` (API contract 1.4)                                                         |
| `jsonwebtoken`       | Membuat dan memverifikasi JWT                                                                             |
| `bcryptjs`           | Hash password (NFR-SEC-01, salt rounds 10); JS murni, tidak perlu build tools di Windows                  |
| `zod`                | Validasi body dan query request                                                                           |
| `express-rate-limit` | Membatasi percobaan login berulang                                                                        |

Dev: `eslint`, `prettier`, `supertest` (test HTTP), dan test runner bawaan Node (`node --test`).

## Struktur folder

```
djc-backend/
├── docs/api-contract.md       # API contract Draft v0.1
├── src/
│   ├── app.js                 # Membuat app Express (dipakai server dan test)
│   ├── server.js              # Menjalankan app.listen
│   ├── config/
│   │   ├── env.js             # Membaca .env
│   │   └── db.js              # Pool koneksi mysql2 + ping
│   ├── routes/
│   │   ├── index.js           # Router /api/v1
│   │   ├── health.js          # GET /api/v1/health
│   │   ├── auth.js            # /api/v1/auth: register, login, logout, me, reset kata sandi
│   │   └── categories.js      # /api/v1/categories (publik), /api/v1/admin/categories
│   ├── middlewares/
│   │   ├── auth.js            # requireAuth, requireRole, requireActiveUser
│   │   ├── notFound.js        # 404 berformat standar
│   │   └── errorHandler.js    # Error berformat standar
│   ├── repositories/          # Query SQL per tabel (userRepository.js, categoryRepository.js)
│   ├── utils/
│   │   ├── response.js        # sendSuccess, ApiError
│   │   ├── token.js           # JWT dan cookie djc_token
│   │   └── validate.js        # Validasi body dengan zod
│   └── scripts/check-db.js    # npm run db:check
├── db/
│   ├── migrations/            # Migrasi knex, satu file per tabel
│   └── seeds/                 # Seeder data dummy
├── knexfile.js                # Konfigurasi knex, membaca .env
├── tests/                     # *.test.js
├── .env.example
├── eslint.config.js
└── .prettierrc.json
```

Fitur baru ditambahkan sebagai router di `src/routes/` dan didaftarkan di `src/routes/index.js`.

## Format respons

Sukses: `{ "data": ..., "meta": { ...pagination } }`
Error: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }`

Untuk melempar error dari route: `throw new ApiError(404, 'NOT_FOUND', 'Provider tidak ditemukan.')`. Express 5 meneruskan error dari fungsi `async` ke error handler secara otomatis.

Daftar kode error lengkap ada di [`docs/api-contract.md`](docs/api-contract.md) bagian 1.3.
