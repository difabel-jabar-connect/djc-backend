# Difabel Jabar Connect — API Contract

## Kendali dokumen

| Atribut         | Nilai                                                                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pemilik dokumen | Backend (deonaja/difabel-jabar-connect#15)                                                                                                                                                                                             |
| Pemeriksa       | Software Engineering (kesesuaian requirement dan flow), Full-stack (integrasi Express dan React/Vite)                                                                                                                                  |
| Versi           | Draft v0.1                                                                                                                                                                                                                             |
| Status          | `Proposed`                                                                                                                                                                                                                             |
| Target          | Baseline v1 setelah review SE dan Full-stack, paling lambat 25 Oktober 2026                                                                                                                                                            |
| Acuan           | Di repository dokumentasi [deonaja/difabel-jabar-connect](https://github.com/deonaja/difabel-jabar-connect): `docs/technical/data-model.md`, `docs/requirements/*` (deonaja/difabel-jabar-connect#11), notulen Week 1 (4 Oktober 2026) |

Kontrak ini hanya mencakup **core flow** `Search → Provider → Location → Booking → Review` beserta autentikasi. Endpoint pengelolaan provider, admin, dan Cloudinary didaftar di bagian akhir sebagai rencana, belum dirinci.

Seluruh endpoint di dokumen ini berstatus `Proposed` sampai direview. Yang sudah diimplementasikan: `GET /api/v1/health`, auth A1–A8, dan kategori C1–C3.

---

## 1. Konvensi

### 1.1 URL dan versi

- Base URL lokal: `http://localhost:5000/api/v1`
- Semua endpoint diawali `/api/v1`. Perubahan yang merusak kompatibilitas memakai `/api/v2`.
- Path memakai kata benda jamak dan `kebab-case`; field JSON memakai `snake_case`, sama dengan kolom database.
- ID berupa UUID v4 (string 36 karakter).

### 1.2 Format respons

Sukses:

```json
{
  "data": { "...": "..." },
  "meta": { "page": 1, "per_page": 12, "total": 40, "total_pages": 4 }
}
```

`meta` hanya ada pada respons daftar yang memakai pagination.

Error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Data yang dikirim belum valid.",
    "details": [{ "field": "email", "message": "Format email tidak valid." }]
  }
}
```

`message` ditulis dalam bahasa Indonesia dan aman ditampilkan ke pengguna. `details` hanya ada untuk error validasi.

### 1.3 Kode error umum

| HTTP | `code`                | Kapan                                                          |
| ---- | --------------------- | -------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`    | Field wajib kosong, format salah, nilai di luar aturan         |
| 400  | `INVALID_JSON`        | Body bukan JSON valid                                          |
| 401  | `UNAUTHENTICATED`     | Belum login atau token tidak valid/kedaluwarsa                 |
| 401  | `INVALID_CREDENTIALS` | Email atau password salah                                      |
| 403  | `FORBIDDEN`           | Peran tidak sesuai atau bukan pemilik data                     |
| 403  | `ACCOUNT_SUSPENDED`   | Akun `suspended` mencoba aksi tulis                            |
| 404  | `NOT_FOUND`           | Data tidak ada, atau ada tetapi tidak boleh dilihat pemanggil  |
| 409  | `CONFLICT`            | Data bentrok, mis. email sudah terdaftar, review sudah ada     |
| 409  | `INVALID_TRANSITION`  | Transisi status booking tidak diizinkan dari status sekarang   |
| 410  | `TOKEN_EXPIRED`       | Tautan reset kata sandi rusak, kedaluwarsa, atau sudah dipakai |
| 413  | `PAYLOAD_TOO_LARGE`   | Body terlalu besar                                             |
| 429  | `TOO_MANY_REQUESTS`   | Terlalu banyak percobaan dari IP yang sama (lihat A2, A5)      |
| 500  | `INTERNAL_ERROR`      | Kesalahan server                                               |
| 503  | `SERVICE_UNAVAILABLE` | Layanan pendukung belum tersedia, mis. email reset (A5)        |
| 503  | –                     | Health check saat database tidak terhubung                     |

Untuk data yang tidak boleh dilihat (mis. booking milik orang lain), API mengembalikan **404**, bukan 403, agar keberadaan data tidak bocor.

### 1.4 Autentikasi (usulan untuk STK-04)

STK-04 di `stack-comparison.md` menyerahkan kontrak autentikasi ke issue fondasi backend ini. Pemakaian JWT sudah disepakati tim (review PM di deonaja/difabel-jabar-connect#11). Usulan detailnya:

- Login mengembalikan JWT di **cookie `HttpOnly`** bernama `djc_token` (`SameSite=Lax`, `Secure` di production). Frontend memanggil API dengan `credentials: 'include'`.
- Umur sesi 24 jam (NFR-SEC-02, `JWT_EXPIRES_IN=1d`) dan cookie-nya cookie sesi, hilang saat browser ditutup. Jika login dengan `remember: true` ("Ingat saya"), token berlaku 7 hari (`JWT_REMEMBER_EXPIRES_IN=7d`) dan cookie disimpan sampai waktu yang sama.
- Header `Authorization: Bearer <token>` tetap diterima untuk Postman dan testing.
- Payload JWT: `sub` (user id), `role`, `exp`. Status akun **dicek ulang ke database** pada setiap aksi tulis (middleware `requireActiveUser`), sehingga suspend berlaku langsung.
- Password di-hash dengan bcrypt, salt rounds 10 (NFR-SEC-01).

Catatan untuk review Full-stack: frontend di Vercel dan API di Railway berbeda domain. Cookie lintas domain butuh `SameSite=None; Secure`, atau frontend memakai proxy/rewrite Vercel ke API. Pilihan final dicatat saat proof of deployment (SP1-10).

### 1.5 Peran

| Label                       | Arti                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Publik                      | Tanpa login                                                                          |
| Login                       | Semua peran yang sudah login, termasuk akun `suspended` (baca saja)                  |
| Customer / Provider / Admin | Hanya peran tersebut                                                                 |
| Pihak booking               | Customer atau provider pada booking yang sama, mengikuti access matrix di data model |

Aturan akun suspended mengikuti data model: tetap bisa login dan membaca data miliknya, tetapi semua `POST`, `PUT`, `PATCH`, `DELETE` ditolak dengan `403 ACCOUNT_SUSPENDED` ("Akun Anda sedang dinonaktifkan. Anda hanya dapat melihat data."). Middleware `requireActiveUser` dipasang setelah `requireAuth` di setiap route tulis; logout tidak memakainya supaya akun suspended tetap bisa keluar.

> **Perlu dicek SE:** `03-system-flow.md` bagian 2.1 menulis login akun suspended langsung ditolak 403, dan `04-user-stories.md` US-ADM-04 menulis "sesi token pengguna diblokir". Sebaliknya `data-model.md` (acuan implementasi) dan backlog SP1-05 menulis akun suspended tetap bisa login dan membaca, hanya aksi tulis yang ditolak. Kontrak ini mengikuti data model dan SP1-05.

### 1.6 Waktu, uang, dan pagination

- Waktu dikirim sebagai ISO 8601 UTC, mis. `2026-10-20T02:00:00.000Z`. Frontend menampilkan dalam WIB.
- `scheduled_date` berformat `YYYY-MM-DD`, `start_time` berformat `HH:mm` (waktu lokal WIB sesuai jadwal provider).
- Uang berupa integer rupiah, mis. `75000`.
- Pagination: `page` (default 1) dan `per_page` (default 12, maks 50).

---

## 2. Ringkasan endpoint core flow

| #   | Method | Path                     | Peran                | Flow             | Status implementasi |
| --- | ------ | ------------------------ | -------------------- | ---------------- | ------------------- |
| H1  | GET    | `/health`                | Publik               | Monitoring       | Sudah ada           |
| A1  | POST   | `/auth/register`         | Publik               | Akun             | Sudah ada           |
| A2  | POST   | `/auth/login`            | Publik               | Akun             | Sudah ada           |
| A3  | POST   | `/auth/logout`           | Login                | Akun             | Sudah ada           |
| A4  | GET    | `/auth/me`               | Login                | Akun             | Sudah ada           |
| A5  | POST   | `/auth/password/forgot`  | Publik               | Akun             | Sudah ada           |
| A6  | POST   | `/auth/password/reset`   | Publik               | Akun             | Sudah ada           |
| A7  | GET    | `/auth/google`           | Publik               | Akun             | Sudah ada           |
| A7  | GET    | `/auth/google/callback`  | Publik (dari Google) | Akun             | Sudah ada           |
| A8  | POST   | `/auth/google`           | Publik               | Akun             | Sudah ada           |
| C1  | GET    | `/categories`            | Publik               | Search           | Sudah ada           |
| C2  | POST   | `/admin/categories`      | Admin                | Kelola kategori  | Sudah ada           |
| C3  | PUT    | `/admin/categories/:id`  | Admin                | Kelola kategori  | Sudah ada           |
| P1  | GET    | `/providers`             | Publik               | Search           | Proposed            |
| P2  | GET    | `/providers/map`         | Publik               | Location         | Proposed            |
| P3  | GET    | `/providers/:id`         | Publik               | Provider         | Proposed            |
| P4  | GET    | `/providers/:id/reviews` | Publik               | Provider, Review | Proposed            |
| B1  | POST   | `/bookings`              | Customer             | Booking          | Proposed            |
| B2  | GET    | `/bookings`              | Customer, Provider   | Booking          | Proposed            |
| B3  | GET    | `/bookings/:id`          | Pihak booking, Admin | Booking          | Proposed            |
| S1  | POST   | `/bookings/:id/accept`   | Provider             | Status booking   | Proposed            |
| S2  | POST   | `/bookings/:id/reject`   | Provider             | Status booking   | Proposed            |
| S3  | POST   | `/bookings/:id/start`    | Provider             | Status booking   | Proposed            |
| S4  | POST   | `/bookings/:id/complete` | Provider             | Status booking   | Proposed            |
| S5  | POST   | `/bookings/:id/cancel`   | Customer, Provider   | Status booking   | Proposed            |
| R1  | POST   | `/bookings/:id/review`   | Customer             | Review           | Proposed            |

Semua path di bawah ditulis relatif terhadap `/api/v1`.

---

## 3. Health

### H1 `GET /health`

|              |                                                    |
| ------------ | -------------------------------------------------- |
| Tujuan       | Memastikan API berjalan dan database terhubung     |
| Peran        | Publik                                             |
| Query / body | –                                                  |
| Dipakai oleh | Frontend saat setup (SP1-01), health check Railway |

Sukses `200`:

```json
{ "data": { "status": "ok", "database": "up", "timestamp": "2026-10-12T10:40:04.372Z" } }
```

Database mati `503`:

```json
{ "data": { "status": "degraded", "database": "down", "timestamp": "2026-10-12T10:40:07.396Z" } }
```

---

## 4. Auth

### A1 `POST /auth/register`

|             |                                 |
| ----------- | ------------------------------- |
| Tujuan      | Mendaftarkan akun customer baru |
| Peran       | Publik                          |
| Requirement | FR-CUST-01, US-CUST-01          |
| Layar       | `/register`                     |

Pendaftaran mandiri hanya untuk customer. Akun mitra (provider) dibuat oleh admin (API-04, lihat bagian 11 dan 12).

Request body:

| Field      | Tipe       | Wajib | Aturan                                                 |
| ---------- | ---------- | ----- | ------------------------------------------------------ |
| `role`     | `customer` | tidak | Default `customer`; nilai lain ditolak `403 FORBIDDEN` |
| `name`     | string     | ya    | Nama lengkap, 2–100 karakter (kolom `users.full_name`) |
| `email`    | string     | ya    | Format email, unik, disimpan huruf kecil               |
| `phone`    | string     | ya    | Format `+62` diikuti 8–13 digit                        |
| `password` | string     | ya    | 8–72 karakter (batas bcrypt)                           |

```json
{
  "role": "customer",
  "name": "Budi Santoso",
  "email": "budi@example.com",
  "phone": "+6281234567890",
  "password": "rahasia123"
}
```

Nama field mengikuti form Daftar di frontend: request dan semua respons auth memakai `name`, yang disimpan di kolom `users.full_name`. Field lain diabaikan.

Registrasi tidak langsung login; frontend mengarahkan ke `/login` dengan pesan sukses (US-CUST-01).

Sukses `201`:

```json
{
  "data": {
    "user": {
      "id": "0b6c…",
      "role": "customer",
      "name": "Budi Santoso",
      "email": "budi@example.com",
      "phone": "+6281234567890",
      "status": "active"
    }
  }
}
```

Error: `400 VALIDATION_ERROR`, `403 FORBIDDEN` untuk `role` selain `customer` ("Akun mitra dibuat oleh admin. Silakan hubungi pengelola."), `409 CONFLICT` ("Email ini sudah terdaftar. Silakan masuk atau gunakan email lain.").

### A2 `POST /auth/login`

|             |                                      |
| ----------- | ------------------------------------ |
| Tujuan      | Masuk dan mendapatkan sesi           |
| Peran       | Publik                               |
| Requirement | FR-CUST-01, FR-PROV-01, SP1-03       |
| Layar       | `/login`, lalu redirect sesuai peran |

Request: `{ "email": "budi@example.com", "password": "rahasia123", "remember": true }`

`remember` opsional (boolean, default `false`), lihat umur sesi di 1.4.

Sukses `200` + `Set-Cookie: djc_token=…; HttpOnly`:

```json
{
  "data": {
    "user": {
      "id": "0b6c…",
      "role": "customer",
      "name": "Budi Santoso",
      "email": "budi@example.com",
      "phone": "+6281234567890",
      "status": "active"
    },
    "token": "eyJhbGciOi…",
    "expires_at": "2026-10-27T02:00:00.000Z"
  }
}
```

`token` di body hanya untuk klien yang memakai header Bearer; frontend cukup memakai cookie. Akun `suspended` tetap bisa login (1.5), `user.status` memberi tahu frontend untuk menampilkan mode baca saja.

Error: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS` ("Email atau kata sandi salah.", sama untuk email tidak terdaftar dan kata sandi salah), `429 TOO_MANY_REQUESTS` setelah 10 login gagal dari IP yang sama dalam 15 menit (login berhasil tidak dihitung).

### A3 `POST /auth/logout`

Peran: Login, termasuk akun `suspended`. Menghapus cookie sesi. Sukses `200`: `{ "data": { "logged_out": true } }`. Error: `401 UNAUTHENTICATED`.

JWT tidak disimpan di server, jadi token yang sudah disalin klien Bearer tetap berlaku sampai `expires_at`. Daftar blokir token belum dibuat; suspend tetap berlaku lewat pengecekan status di setiap aksi tulis (1.4).

### A4 `GET /auth/me`

|        |                                                                  |
| ------ | ---------------------------------------------------------------- |
| Tujuan | Mengambil user yang sedang login (dipakai Auth Context frontend) |
| Peran  | Login                                                            |
| Layar  | Semua halaman yang butuh status login                            |

Sukses `200`:

```json
{
  "data": {
    "user": {
      "id": "0b6c…",
      "role": "provider",
      "name": "Deni Setiawan",
      "email": "deni@example.com",
      "phone": "+62…",
      "status": "active"
    },
    "provider_profile": { "id": "7f1a…", "verification_status": "verified" }
  }
}
```

`provider_profile` hanya ada untuk provider (`null` jika profilnya belum ada). Error: `401 UNAUTHENTICATED`, juga jika akun pemilik token sudah dihapus (cookie ikut dihapus).

### A5 `POST /auth/password/forgot`

|        |                                             |
| ------ | ------------------------------------------- |
| Tujuan | Meminta tautan reset kata sandi lewat email |
| Peran  | Publik                                      |
| Layar  | `/lupa-kata-sandi`, lalu layar "Cek email"  |

Request: `{ "email": "budi@example.com" }`. Sukses `200`: `{ "data": { "sent": true } }`.

Tautan berbentuk `<FRONTEND_URL>/reset-kata-sandi?token=…` dan berlaku 30 menit (`RESET_TOKEN_EXPIRES_IN`). Token ditandatangani bersama hash kata sandi user, jadi otomatis tidak berlaku setelah kata sandi diganti (sekali pakai).

Email dikirim lewat SMTP jika `SMTP_HOST`, `SMTP_USER`, dan `SMTP_PASS` diisi (sementara Gmail + App Password; penyedia final menunggu STK-OPN-03). Jika SMTP belum diisi, di development tautan ditulis ke terminal backend dan di production endpoint ini mengembalikan `503 SERVICE_UNAVAILABLE`. Gagal kirim lewat SMTP juga `503`.

Error: `400 VALIDATION_ERROR`, `404 NOT_FOUND` ("Email tidak terdaftar.", layar menampilkan ajakan daftar; register 409 sudah memberi tahu email mana yang terdaftar, jadi tidak ada kebocoran baru), `429 TOO_MANY_REQUESTS` setelah 5 permintaan dari IP yang sama dalam 15 menit, `503 SERVICE_UNAVAILABLE`.

### A6 `POST /auth/password/reset`

|        |                                             |
| ------ | ------------------------------------------- |
| Tujuan | Menyimpan kata sandi baru dari tautan email |
| Peran  | Publik (pemegang token reset)               |
| Layar  | `/reset-kata-sandi?token=…`                 |

Request: `{ "token": "eyJhbGciOi…", "password": "SandiBaru123" }` (`password` 8–72 karakter, sama dengan register). Sukses `200`: `{ "data": { "password_reset": true } }`, cookie sesi ikut dihapus sehingga user masuk ulang dengan kata sandi baru.

Error: `400 VALIDATION_ERROR`, `410 TOKEN_EXPIRED` ("Tautan reset sudah tidak berlaku. Silakan minta tautan baru.") untuk token rusak, kedaluwarsa, atau sudah dipakai.

### A7 `GET /auth/google` dan `GET /auth/google/callback`

|             |                                                                                    |
| ----------- | ---------------------------------------------------------------------------------- |
| Tujuan      | Masuk dengan akun Google (OAuth 2.0 authorization code flow)                       |
| Peran       | Publik                                                                             |
| Requirement | MVP (permintaan tim, 26 Okt 2026)                                                  |
| Layar       | Tombol "Masuk dengan Google" di `/login` dan "Daftar dengan Google" di `/register` |

Bukan endpoint JSON: browser dibuka langsung ke URL ini, lalu server mengarahkan (302) ke Google dan kembali ke frontend.

1. `GET /auth/google?redirect=/bookings`: `redirect` opsional, hanya path internal frontend (diawali `/`, bukan `//`). Server membuat `state` acak, menyimpannya bersama `redirect` di cookie HttpOnly `djc_oauth` (10 menit, `SameSite=Lax`, path `/api/v1/auth/google`), lalu 302 ke `https://accounts.google.com/o/oauth2/v2/auth` dengan `client_id`, `redirect_uri` (`GOOGLE_REDIRECT_URI`), `response_type=code`, `scope=openid email profile`, `state`, dan `prompt=select_account`.
2. Google mengembalikan browser ke `GET /auth/google/callback?code=…&state=…`. Server mencocokkan `state` dengan cookie (lalu menghapus cookie itu), menukar `code` ke `https://oauth2.googleapis.com/token` memakai `GOOGLE_CLIENT_SECRET`, dan memverifikasi `id_token` dengan kunci publik Google (RS256, `aud` = `GOOGLE_CLIENT_ID`, `iss` = `accounts.google.com`, `email_verified = true`).

Hasil redirect ke frontend (`FRONTEND_URL`):

| Kondisi                                                                            | Redirect                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Email sudah terdaftar                                                              | `<redirect atau halaman awal peran>?google=success` + cookie `djc_token` |
| Email belum terdaftar                                                              | `/register?google=not_registered&email=…&name=…`                         |
| `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` belum diisi                              | `/login?google_error=unavailable`                                        |
| State tidak cocok, error dari Google, penukaran code gagal, `id_token` tidak valid | `/login?google_error=failed` (alasan dicatat di log server)              |

Halaman awal peran sama dengan frontend: customer `/`, provider `/dashboard/provider`, admin `/admin`. Cookie `djc_token` sama dengan login biasa tanpa "Ingat saya" (cookie sesi, token 24 jam); akun `suspended` tetap boleh masuk. Akun **tidak** dibuat otomatis karena register butuh nomor telepon yang tidak diberikan Google.

Saat deploy lintas domain (Vercel ↔ Railway), cookie `djc_token` dari callback ikut keputusan cookie yang sama dengan login biasa (API-02), dan `GOOGLE_REDIRECT_URI` diisi URL callback di Railway.

**Catatan untuk frontend:** frontend saat ini memakai popup (A8). Alur redirect ini tetap tersedia:

- `onClick` tombol Google yang sudah ada cukup `window.location.href = \`${API_BASE}/auth/google?redirect=${encodeURIComponent(next ?? '')}\``.
- Setelah kembali dengan `?google=success`, panggil `GET /auth/me` untuk memuat user (cookie sudah terpasang, tetapi sesi di `sessionStorage` belum terisi).
- Baca `google_error` (`unavailable` atau `failed`) di halaman Masuk untuk menampilkan pesan, dan `google=not_registered` beserta `email`/`name` di halaman Daftar untuk mengisi awal form.

### A8 `POST /auth/google`

|             |                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Tujuan      | Masuk/daftar dengan Google lewat popup Google Identity Services (alur yang dipakai frontend)         |
| Peran       | Publik                                                                                               |
| Requirement | MVP (permintaan tim, 26 Okt 2026)                                                                    |
| Layar       | Tombol "Masuk dengan Google" di `/login` dan "Daftar dengan Google" di `/register` (`useGoogleAuth`) |

Frontend membuka popup `google.accounts.oauth2.initCodeClient` (`ux_mode: 'popup'`) dengan `VITE_GOOGLE_CLIENT_ID`, lalu mengirim `code` sekali pakai ke endpoint ini. Server menukar `code` ke `https://oauth2.googleapis.com/token` dengan `redirect_uri: 'postmessage'` dan `GOOGLE_CLIENT_SECRET`, lalu memverifikasi `id_token` sama seperti A7 (`aud` = `GOOGLE_CLIENT_ID`, `email_verified = true`). **`VITE_GOOGLE_CLIENT_ID` frontend dan `GOOGLE_CLIENT_ID` backend harus OAuth client yang sama**, dan origin frontend (`http://localhost:5173`, domain Vercel) didaftarkan di _Authorized JavaScript origins_.

Request:

```json
{ "code": "4/0Ab…", "intent": "login", "role": "customer", "phone": "+6281234567890" }
```

- `intent` wajib: `login` atau `register`.
- `register`: `phone` wajib (format sama dengan A1, kolom `users.phone` wajib dan Google tidak memberikannya). Hanya customer: `role` selain `customer` ditolak `403 FORBIDDEN` "Akun mitra dibuat oleh admin. Silakan hubungi pengelola." (API-04). `city`/`category` diabaikan. Nama diambil dari profil Google; kata sandi diisi acak (pemilik bisa membuatnya lewat Lupa Kata Sandi).

Sukses `200` (login) atau `201` (register), cookie `djc_token` sama dengan login tanpa "Ingat saya":

```json
{
  "data": {
    "user": {
      "id": "uuid",
      "role": "customer",
      "name": "Budi Santoso",
      "email": "budi@gmail.com",
      "phone": "+6281234567890",
      "status": "active"
    }
  }
}
```

| Kondisi                                               | Respons                   |
| ----------------------------------------------------- | ------------------------- |
| Body tidak valid, `phone` kosong saat `register`      | `400 VALIDATION_ERROR`    |
| `code` ditolak Google atau `id_token` tidak valid     | `401 INVALID_CREDENTIALS` |
| `register` dengan `role` mitra                        | `403 FORBIDDEN`           |
| `login`, email belum terdaftar                        | `404 NOT_FOUND`           |
| `register`, email sudah terdaftar                     | `409 CONFLICT`            |
| Percobaan gagal 10 kali per IP dalam 15 menit         | `429 TOO_MANY_REQUESTS`   |
| `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` belum diisi | `503 SERVICE_UNAVAILABLE` |

---

## 5. Kategori

### C1 `GET /categories`

|             |                                                                   |
| ----------- | ----------------------------------------------------------------- |
| Tujuan      | Daftar kategori untuk homepage, filter pencarian, dan filter peta |
| Peran       | Publik                                                            |
| Requirement | FR-CUST-02, FR-ADM-03, SP1-06                                     |
| Layar       | Homepage, `/services`, peta                                       |

Hanya kategori `is_active = true`, urut `sort_order` lalu `name`. Tidak perlu token.

Sukses `200`:

```json
{
  "data": [
    {
      "id": "c1…",
      "name": "Servis Elektronik",
      "slug": "servis-elektronik",
      "icon": "plug",
      "sort_order": 2
    }
  ]
}
```

Error: tidak ada selain `500`.

### C2 `POST /admin/categories`

|             |                                       |
| ----------- | ------------------------------------- |
| Tujuan      | Admin menambah kategori layanan       |
| Peran       | Admin (akun aktif, bukan `suspended`) |
| Requirement | FR-ADM-03, SP1-06                     |
| Layar       | Dasbor admin, tabel kategori          |

Request body:

| Field        | Tipe    | Wajib | Aturan                                                                          |
| ------------ | ------- | ----- | ------------------------------------------------------------------------------- |
| `name`       | string  | ya    | 2–50 karakter, unik tanpa beda huruf besar/kecil                                |
| `slug`       | string  | tidak | Huruf kecil, angka, tanda hubung, maks 60, unik. Jika kosong dibuat dari `name` |
| `icon`       | string  | tidak | Nama ikon, maks 50, boleh `null`                                                |
| `sort_order` | integer | tidak | 0–32767, default `0`                                                            |
| `is_active`  | boolean | tidak | Default `true`                                                                  |

```json
{ "name": "Pijat & Refleksi", "icon": "spa", "sort_order": 9 }
```

Sukses `201`: objek kategori lengkap, termasuk `is_active`, mis. `{ "data": { "id": "…", "name": "Pijat & Refleksi", "slug": "pijat-refleksi", "icon": "spa", "sort_order": 9, "is_active": true } }`.

Aksi dicatat ke `admin_actions` (`create_category`, `target_type = category`) dalam transaksi yang sama.

Error: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN` (bukan admin), `403 ACCOUNT_SUSPENDED`, `409 CONFLICT` ("Kategori dengan nama atau slug ini sudah ada.").

### C3 `PUT /admin/categories/:id`

|             |                                                            |
| ----------- | ---------------------------------------------------------- |
| Tujuan      | Admin mengubah kategori atau mengaktifkan/menonaktifkannya |
| Peran       | Admin (akun aktif, bukan `suspended`)                      |
| Requirement | FR-ADM-03, SP1-06                                          |

Body berisi field C2 yang ingin diubah saja (minimal satu); slug tidak ikut berubah saat nama diganti kecuali dikirim. `{ "is_active": false }` menyembunyikan kategori dari C1. Sukses `200`: objek kategori terbaru. Aksi dicatat sebagai `update_category` beserta kolom yang diubah.

Error: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `403 ACCOUNT_SUSPENDED`, `404 NOT_FOUND`, `409 CONFLICT`.

---

## 6. Pencarian dan detail provider

Semua endpoint di bagian ini hanya menampilkan provider dengan `verification_status = verified` **dan** `users.status = active`. Field yang dikirim hanya yang berlabel Publik; `lat`, `lng`, `address_detail`, `alumni_reg_no`, dan `disability_type` tidak pernah dikirim.

### P1 `GET /providers`

|             |                                                                           |
| ----------- | ------------------------------------------------------------------------- |
| Tujuan      | Mencari provider berdasarkan kata kunci, kategori, kota, dan keterampilan |
| Peran       | Publik                                                                    |
| Requirement | FR-CUST-02, US-CUST-02                                                    |
| Layar       | `/services` (halaman pencarian/katalog)                                   |

Query:

| Param              | Contoh              | Keterangan                                               |
| ------------------ | ------------------- | -------------------------------------------------------- |
| `q`                | `servis kipas`      | Cocok ke nama layanan, `display_name`, atau keterampilan |
| `category`         | `servis-elektronik` | Slug kategori                                            |
| `city`             | `Kota Bekasi`       | Kota provider                                            |
| `skill`            | `servis-elektronik` | Slug keterampilan                                        |
| `page`, `per_page` | `1`, `12`           | Pagination                                               |

Sukses `200`:

```json
{
  "data": [
    {
      "id": "7f1a…",
      "display_name": "Deni Setiawan",
      "photo_url": "https://res.cloudinary.com/…/p1.webp",
      "photo_alt": "Foto Deni tersenyum di bengkel servis",
      "city": "Kota Bekasi",
      "district": "Bekasi Timur",
      "rating_avg": 5.0,
      "rating_count": 1,
      "skills": [{ "name": "Servis elektronik", "slug": "servis-elektronik" }],
      "categories": [{ "name": "Servis Elektronik", "slug": "servis-elektronik" }],
      "starting_price": { "pricing_type": "fixed", "price_amount": 50000 }
    }
  ],
  "meta": { "page": 1, "per_page": 12, "total": 1, "total_pages": 1 }
}
```

Hasil kosong tetap `200` dengan `data: []`, dipakai frontend untuk Empty State. Error: `400 VALIDATION_ERROR` (mis. `per_page` > 50).

> **Perlu dicek SE:** `02-user-flow.md` menyebut `/api/v1/services/search`, sedangkan issue deonaja/difabel-jabar-connect#15 menyebut pencarian provider. Draft ini mengembalikan kartu provider. Jika UI butuh kartu per layanan, tambah `GET /services` dengan query yang sama.

### P2 `GET /providers/map`

|             |                                                            |
| ----------- | ---------------------------------------------------------- |
| Tujuan      | Data marker peta Leaflet, ringan dan hanya koordinat kasar |
| Peran       | Publik                                                     |
| Requirement | FR-CUST-03, FR-CUST-04, FR-PROV-03, NFR-PERF-03            |
| Layar       | Peta sebaran (homepage/halaman peta)                       |

Query: `category`, `city` (opsional). Tanpa pagination, karena jumlah provider MVP kecil.

Sukses `200`:

```json
{
  "data": [
    {
      "id": "7f1a…",
      "display_name": "Deni Setiawan",
      "public_lat": -6.24,
      "public_lng": 106.98,
      "rating_avg": 5.0,
      "photo_url": "https://res.cloudinary.com/…/p1.webp",
      "photo_alt": "Foto Deni tersenyum di bengkel servis",
      "primary_skill": "Servis elektronik",
      "starting_price": 50000
    }
  ]
}
```

### P3 `GET /providers/:id`

|             |                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Tujuan      | Profil lengkap provider: bio, keterampilan, layanan, jadwal, portofolio, preferensi komunikasi |
| Peran       | Publik                                                                                         |
| Requirement | FR-CUST-05, US-CUST-04, SP1-07                                                                 |
| Layar       | `/provider/:id`                                                                                |

Sukses `200`:

```json
{
  "data": {
    "id": "7f1a…",
    "display_name": "Deni Setiawan",
    "photo_url": "https://res.cloudinary.com/…/p1.webp",
    "photo_alt": "Foto Deni tersenyum di bengkel servis",
    "bio": "Servis kipas, rice cooker, dan setrika.",
    "communication_prefs": ["chat", "bisindo"],
    "city": "Kota Bekasi",
    "district": "Bekasi Timur",
    "public_lat": -6.24,
    "public_lng": 106.98,
    "service_radius_km": 10,
    "rating_avg": 5.0,
    "rating_count": 1,
    "skills": [{ "name": "Servis elektronik", "slug": "servis-elektronik" }],
    "services": [
      {
        "id": "s2…",
        "title": "Ganti kabel dan stop kontak",
        "category": { "name": "Servis Elektronik", "slug": "servis-elektronik" },
        "pricing_type": "fixed",
        "price_amount": 50000,
        "min_hours": null,
        "duration_estimate_min": 60,
        "service_mode": "at_customer"
      }
    ],
    "availability": [{ "day_of_week": 1, "start_time": "08:00", "end_time": "16:00" }],
    "portfolio": [
      {
        "id": "pf1…",
        "title": "Perbaikan kipas angin",
        "item_type": "work_result",
        "image_url": "https://res.cloudinary.com/…/pf1.webp",
        "image_alt": "Kipas angin berdiri yang sudah diperbaiki di atas meja kerja"
      }
    ]
  }
}
```

Hanya layanan `is_active = true` yang dikirim. Error: `404 NOT_FOUND` jika provider tidak ada, belum verified, atau suspended.

### P4 `GET /providers/:id/reviews`

|             |                               |
| ----------- | ----------------------------- |
| Tujuan      | Ulasan publik provider        |
| Peran       | Publik                        |
| Requirement | FR-CUST-05, FR-PROV-11        |
| Layar       | `/provider/:id` bagian ulasan |

Query: `page`, `per_page`. Hanya review `is_hidden = false`; nama reviewer berupa nama depan + inisial.

Sukses `200`:

```json
{
  "data": [
    {
      "id": "r1…",
      "rating": 5,
      "comment": "Cepat, rapi, penjelasannya jelas.",
      "reviewer_name": "Citra P.",
      "created_at": "2026-10-20T08:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "per_page": 12, "total": 1, "total_pages": 1 }
}
```

Error: `404 NOT_FOUND`.

---

## 7. Booking

Field kontak dan alamat di respons booking mengikuti **access matrix** di `data-model.md`. Ringkasnya, serializer server mengisi atau mengosongkan field berikut menurut status dan siapa yang meminta:

| Field respons                                                                        | `requested`                     | `accepted`, `in_progress` | `completed`, `rejected`, `cancelled`                                 |
| ------------------------------------------------------------------------------------ | ------------------------------- | ------------------------- | -------------------------------------------------------------------- |
| `customer.name` (dilihat provider)                                                   | Nama depan + inisial            | Nama lengkap              | Nama lengkap jika pernah `accepted`, selain itu nama depan + inisial |
| `customer.phone` / `provider.phone` (untuk lawan transaksi)                          | `null`                          | Terisi                    | `null`                                                               |
| `location.address`, `location.lat`, `location.lng` (`at_customer`, dilihat provider) | `null`, hanya `location.area`   | Terisi                    | `null`, hanya `location.area`                                        |
| `provider.address_detail` (`at_provider`, dilihat customer)                          | `null`, hanya `city`/`district` | Terisi                    | `null`                                                               |

### B1 `POST /bookings`

|             |                                     |
| ----------- | ----------------------------------- |
| Tujuan      | Customer membuat permintaan booking |
| Peran       | Customer (`active`)                 |
| Requirement | FR-CUST-06, FR-CUST-07, US-CUST-05  |
| Layar       | Form booking dari `/provider/:id`   |

Request body:

| Field                          | Tipe                           | Wajib              | Aturan                                               |
| ------------------------------ | ------------------------------ | ------------------ | ---------------------------------------------------- |
| `service_id`                   | uuid                           | ya                 | Layanan aktif milik provider `verified` dan `active` |
| `scheduled_date`               | `YYYY-MM-DD`                   | ya                 | Tidak di masa lalu                                   |
| `start_time`                   | `HH:mm`                        | ya                 | Di dalam slot `provider_availability` hari tersebut  |
| `service_mode`                 | `at_customer` \| `at_provider` | ya                 | Diizinkan oleh `services.service_mode`               |
| `quantity`                     | number                         | jika hourly        | Jam, ≥ `min_hours`; selain hourly selalu 1           |
| `location_area`                | string                         | jika `at_customer` | Kecamatan dan kota                                   |
| `location_address`             | string                         | jika `at_customer` | Alamat lengkap                                       |
| `location_lat`, `location_lng` | number                         | tidak              | Hanya `at_customer`                                  |
| `customer_note`                | string                         | tidak              | Maks 500 karakter                                    |

```json
{
  "service_id": "s5…",
  "scheduled_date": "2026-10-20",
  "start_time": "09:00",
  "service_mode": "at_customer",
  "quantity": 3,
  "location_area": "Bekasi Timur, Kota Bekasi",
  "location_address": "Jl. Melati No. 10, RT 02/RW 05",
  "customer_note": "Rumah pagar hijau."
}
```

Server mengisi `code`, `provider_id`, `pricing_type_snapshot`, `unit_price_snapshot`, `estimated_total`, dan menulis baris pertama `booking_status_history`. Klien tidak boleh mengirim field tersebut.

Sukses `201`: objek booking seperti B3.

Error:

| HTTP | `code`              | Contoh pesan                                                                                     |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------ |
| 400  | `VALIDATION_ERROR`  | "Jam yang dipilih berada di luar jam operasional penyedia." / "Minimal 2 jam untuk layanan ini." |
| 401  | `UNAUTHENTICATED`   | "Silakan masuk dengan akun Customer untuk memesan layanan ini."                                  |
| 403  | `FORBIDDEN`         | Pemanggil bukan customer                                                                         |
| 403  | `ACCOUNT_SUSPENDED` | "Akun Anda sedang ditangguhkan."                                                                 |
| 404  | `NOT_FOUND`         | Layanan tidak ada, nonaktif, atau provider tidak publik                                          |

### B2 `GET /bookings`

|             |                                                                                      |
| ----------- | ------------------------------------------------------------------------------------ |
| Tujuan      | Daftar booking milik pemanggil (customer: yang ia buat; provider: yang masuk ke dia) |
| Peran       | Customer, Provider                                                                   |
| Requirement | FR-CUST-08, FR-PROV-07                                                               |
| Layar       | Riwayat pesanan customer, dasbor pesanan provider                                    |

Query: `status` (opsional, bisa koma: `requested,accepted`), `page`, `per_page`. Urut `scheduled_date` terbaru.

Sukses `200`: array ringkas booking (tanpa riwayat status) + `meta`. Field kontak mengikuti access matrix.

### B3 `GET /bookings/:id`

|             |                                            |
| ----------- | ------------------------------------------ |
| Tujuan      | Detail satu booking beserta riwayat status |
| Peran       | Pihak booking, Admin                       |
| Requirement | FR-CUST-08, FR-CUST-10, US-CUST-06         |
| Layar       | Detail pesanan customer dan provider       |

Contoh sukses `200`, dilihat customer saat status `accepted`, mode `at_customer`:

```json
{
  "data": {
    "id": "b1…",
    "code": "DJC-0001",
    "status": "accepted",
    "service": { "id": "s5…", "title": "Bersih-bersih rumah" },
    "provider": {
      "id": "p3…",
      "display_name": "Asep Kurniawan",
      "city": "Kota Bogor",
      "district": "Bogor Tengah",
      "phone": "+6281…",
      "address_detail": null
    },
    "customer": { "name": "Budi Santoso", "phone": "+6281…" },
    "scheduled_date": "2026-10-20",
    "start_time": "09:00",
    "service_mode": "at_customer",
    "location": {
      "area": "Bekasi Timur, Kota Bekasi",
      "address": "Jl. Melati No. 10, RT 02/RW 05",
      "lat": null,
      "lng": null
    },
    "customer_note": "Rumah pagar hijau.",
    "pricing_type_snapshot": "hourly",
    "unit_price_snapshot": 40000,
    "quantity": 3,
    "estimated_total": 120000,
    "actual_quantity": null,
    "final_total": null,
    "cancelled_by": null,
    "status_reason": null,
    "can_review": false,
    "history": [
      {
        "from_status": null,
        "to_status": "requested",
        "changed_by_role": "customer",
        "reason": null,
        "created_at": "2026-10-12T03:00:00.000Z"
      },
      {
        "from_status": "requested",
        "to_status": "accepted",
        "changed_by_role": "provider",
        "reason": null,
        "created_at": "2026-10-12T05:00:00.000Z"
      }
    ]
  }
}
```

Error: `401 UNAUTHENTICATED`, `404 NOT_FOUND` (termasuk booking milik orang lain).

---

## 8. Status booking

Setiap aksi di bawah memvalidasi status sekarang, peran, kepemilikan, dan status akun pemanggil, lalu menulis satu baris `booking_status_history` dalam satu transaksi database. Transisi yang tidak ada di tabel lifecycle data model ditolak `409 INVALID_TRANSITION`.

Semua aksi mengembalikan `200` dengan objek booking terbaru (bentuk B3). Error umum untuk semua aksi: `401 UNAUTHENTICATED`, `403 ACCOUNT_SUSPENDED`, `404 NOT_FOUND`, `409 INVALID_TRANSITION`.

| #   | Endpoint                      | Dari → Ke                      | Peran                                                    | Body                                              | Validasi khusus                                             | Requirement / layar                             |
| --- | ----------------------------- | ------------------------------ | -------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| S1  | `POST /bookings/:id/accept`   | requested → accepted           | Provider pemilik                                         | –                                                 | –                                                           | FR-PROV-07, US-PROV-05; dasbor pesanan provider |
| S2  | `POST /bookings/:id/reject`   | requested → rejected           | Provider pemilik                                         | `{ "reason": "Kapasitas penuh di jam tersebut" }` | `reason` wajib, minimal 10 karakter (`02-user-flow.md` 3.2) | FR-PROV-07, US-PROV-05                          |
| S3  | `POST /bookings/:id/start`    | accepted → in_progress         | Provider pemilik                                         | –                                                 | Hari ini ≥ `scheduled_date` (WIB)                           | FR-PROV-08                                      |
| S4  | `POST /bookings/:id/complete` | in_progress → completed        | Provider pemilik                                         | Lihat bawah                                       | Lihat bawah                                                 | FR-PROV-08, FR-PROV-09, US-PROV-06              |
| S5  | `POST /bookings/:id/cancel`   | requested/accepted → cancelled | Customer pemilik; provider pemilik hanya dari `accepted` | `{ "reason": "…" }`                               | `reason` wajib jika provider                                | FR-CUST-09, FR-PROV-10                          |

Body S4 `complete` menurut tipe harga:

| `pricing_type_snapshot` | Body                        | Perhitungan server                                                |
| ----------------------- | --------------------------- | ----------------------------------------------------------------- |
| `fixed`                 | `{}`                        | `final_total = estimated_total`                                   |
| `starting_from`         | `{ "final_total": 110000 }` | Wajib ≥ `unit_price_snapshot`, jika kurang `400 VALIDATION_ERROR` |
| `hourly`                | `{ "actual_quantity": 3 }`  | Wajib > 0; `final_total = unit_price_snapshot × actual_quantity`  |

Pembatalan oleh sistem tidak punya endpoint publik. Ada dua pemicu:

- Aksi admin `suspend_user`: booking `requested`/`accepted` milik akun tersebut dibatalkan.
- **Batas waktu respons (usulan dari review PM di deonaja/difabel-jabar-connect#11):** booking `requested` yang tidak direspons provider dalam 24 jam otomatis menjadi `cancelled` dengan `cancelled_by = system` dan `status_reason` terisi. Ini mengubah keputusan #3 di `data-model.md` (sebelumnya: tetap `requested` tanpa batas waktu), sehingga data model perlu diperbarui setelah deonaja/difabel-jabar-connect#11 diterima. Mekanisme pemicunya (job terjadwal atau pengecekan saat booking dibaca) ditentukan saat implementasi booking.

---

## 9. Review

### R1 `POST /bookings/:id/review`

|             |                                                                        |
| ----------- | ---------------------------------------------------------------------- |
| Tujuan      | Customer memberi rating dan ulasan setelah layanan selesai             |
| Peran       | Customer pemilik booking (`active`)                                    |
| Requirement | FR-CUST-11, US-CUST-07                                                 |
| Layar       | Detail pesanan customer, form ulasan (muncul jika `can_review = true`) |

Request: `{ "rating": 5, "comment": "Cepat, rapi, penjelasannya jelas." }`

| Field     | Aturan                       |
| --------- | ---------------------------- |
| `rating`  | Integer 1–5, wajib           |
| `comment` | Maks 1000 karakter, opsional |

`customer_id` dan `provider_id` diisi server dari booking. Server menghitung ulang `rating_avg` dan `rating_count` provider dalam transaksi yang sama.

Sukses `201`:

```json
{
  "data": {
    "id": "r1…",
    "booking_id": "b4…",
    "rating": 5,
    "comment": "Cepat, rapi, penjelasannya jelas.",
    "is_hidden": false,
    "created_at": "2026-10-20T08:00:00.000Z"
  }
}
```

Error: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 ACCOUNT_SUSPENDED`, `404 NOT_FOUND`, `409 INVALID_TRANSITION` (booking belum `completed`), `409 CONFLICT` (booking sudah diulas).

---

## 10. Hubungan Flow → Layar → Endpoint

| Flow     | Layar                                                                           | Endpoint          |
| -------- | ------------------------------------------------------------------------------- | ----------------- |
| Akun     | `/register`, `/login`, header/navbar                                            | A1, A2, A3, A4    |
| Search   | Homepage, `/services`                                                           | C1, P1            |
| Location | Peta sebaran                                                                    | C1, P2            |
| Provider | `/provider/:id`                                                                 | P3, P4            |
| Booking  | Form booking, riwayat pesanan customer, dasbor pesanan provider, detail pesanan | B1, B2, B3, S1–S5 |
| Review   | Detail pesanan customer, `/provider/:id`                                        | R1, P4            |

---

## 11. Di luar kontrak core flow (rencana, belum dirinci)

| Area                                 | Endpoint rencana                                                                                                     | Issue/backlog         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Admin membuat akun mitra             | `POST /admin/providers`: akun provider + `provider_profiles` `pending`, wajib `alumni_reg_no` dan `city`             | API-04                |
| Profil provider                      | `GET`/`PUT /provider/profile`, `PUT /provider/location`                                                              | SP1-07                |
| Jadwal, layanan, portofolio provider | `/provider/availability`, `/provider/services`, `/provider/portfolio`                                                | FR-PROV-04–06, SP1-08 |
| Admin verifikasi dan moderasi        | `/admin/providers/:id/verify`, `/admin/reviews/:id/hide`, `/admin/users/:id/suspend`                                 | FR-ADM-01–06          |
| Email reset/verifikasi               | Reset sudah ada (A5–A6, SMTP atau tautan di terminal); penyedia email final dan verifikasi email menunggu STK-OPN-03 | –                     |
| Payment sandbox                      | Stretch goal                                                                                                         | STR-01                |

---

## 12. Keputusan dan pertanyaan untuk review

| ID     | Pertanyaan                                     | Usulan draft                                                                                                                         | Reviewer      | Status       |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------ |
| API-01 | Mekanisme token (STK-04)                       | JWT sudah disepakati tim (review PM di deonaja/difabel-jabar-connect#11). Usulan penyimpanan: cookie HttpOnly, Bearer tetap diterima | Full-stack    | `Proposed`   |
| API-08 | Auto-cancel booking `requested` setelah 24 jam | Ikut review PM di deonaja/difabel-jabar-connect#11; keputusan #3 data model diperbarui                                               | PM + SE       | `Proposed`   |
| API-02 | Cookie lintas domain Vercel ↔ Railway          | `SameSite=None; Secure` atau rewrite Vercel; diputuskan di SP1-10                                                                    | Full-stack    | `Proposed`   |
| API-03 | Login akun suspended                           | Boleh login, baca saja (ikut data model dan SP1-05; bertentangan dengan system flow 2.1 dan US-ADM-04)                               | SE            | `Proposed`   |
| API-04 | Pendaftaran provider                           | Akun mitra dibuat admin (keputusan tim, 26 Okt 2026); endpoint admin menyusul. `POST /auth/register` hanya untuk customer            | SE + Product  | `Diputuskan` |
| API-05 | Pencarian per provider atau per layanan        | Per provider (`GET /providers`); tambah `GET /services` jika UI butuh                                                                | SE + Frontend | `Proposed`   |
| API-06 | Bentuk endpoint transisi status                | Satu endpoint per aksi (`/accept`, `/reject`, …)                                                                                     | Full-stack    | `Proposed`   |
| API-07 | Data milik orang lain                          | `404`, bukan `403`                                                                                                                   | SE            | `Proposed`   |
