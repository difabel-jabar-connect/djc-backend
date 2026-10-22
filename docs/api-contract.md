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

Seluruh endpoint di dokumen ini berstatus `Proposed` sampai direview. Yang sudah diimplementasikan pada fondasi backend hanya `GET /api/v1/health`.

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

| HTTP | `code`                | Kapan                                                         |
| ---- | --------------------- | ------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`    | Field wajib kosong, format salah, nilai di luar aturan        |
| 400  | `INVALID_JSON`        | Body bukan JSON valid                                         |
| 401  | `UNAUTHENTICATED`     | Belum login atau token tidak valid/kedaluwarsa                |
| 401  | `INVALID_CREDENTIALS` | Email atau password salah                                     |
| 403  | `FORBIDDEN`           | Peran tidak sesuai atau bukan pemilik data                    |
| 403  | `ACCOUNT_SUSPENDED`   | Akun `suspended` mencoba aksi tulis                           |
| 404  | `NOT_FOUND`           | Data tidak ada, atau ada tetapi tidak boleh dilihat pemanggil |
| 409  | `CONFLICT`            | Data bentrok, mis. email sudah terdaftar, review sudah ada    |
| 409  | `INVALID_TRANSITION`  | Transisi status booking tidak diizinkan dari status sekarang  |
| 413  | `PAYLOAD_TOO_LARGE`   | Body terlalu besar                                            |
| 500  | `INTERNAL_ERROR`      | Kesalahan server                                              |
| 503  | –                     | Health check saat database tidak terhubung                    |

Untuk data yang tidak boleh dilihat (mis. booking milik orang lain), API mengembalikan **404**, bukan 403, agar keberadaan data tidak bocor.

### 1.4 Autentikasi (usulan untuk STK-04)

STK-04 di `stack-comparison.md` menyerahkan kontrak autentikasi ke issue fondasi backend ini. Pemakaian JWT sudah disepakati tim (review PM di deonaja/difabel-jabar-connect#11). Usulan detailnya:

- Login mengembalikan JWT di **cookie `HttpOnly`** bernama `djc_token` (`SameSite=Lax`, `Secure` di production, umur 7 hari). Frontend memanggil API dengan `credentials: 'include'`.
- Header `Authorization: Bearer <token>` tetap diterima untuk Postman dan testing.
- Payload JWT: `sub` (user id), `role`, `exp`. Status akun **dicek ulang ke database** pada setiap aksi tulis, sehingga suspend berlaku langsung.
- Password di-hash dengan bcrypt, salt rounds 10 (NFR-SEC-01).

Catatan untuk review Full-stack: frontend di Vercel dan API di Railway berbeda domain. Cookie lintas domain butuh `SameSite=None; Secure`, atau frontend memakai proxy/rewrite Vercel ke API. Pilihan final dicatat saat proof of deployment (SP1-10).

### 1.5 Peran

| Label                       | Arti                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Publik                      | Tanpa login                                                                          |
| Login                       | Semua peran yang sudah login, termasuk akun `suspended` (baca saja)                  |
| Customer / Provider / Admin | Hanya peran tersebut                                                                 |
| Pihak booking               | Customer atau provider pada booking yang sama, mengikuti access matrix di data model |

Aturan akun suspended mengikuti data model: tetap bisa login dan membaca data miliknya, tetapi semua `POST`, `PUT`, `PATCH`, `DELETE` ditolak dengan `403 ACCOUNT_SUSPENDED`.

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
| A1  | POST   | `/auth/register`         | Publik               | Akun             | Proposed            |
| A2  | POST   | `/auth/login`            | Publik               | Akun             | Proposed            |
| A3  | POST   | `/auth/logout`           | Login                | Akun             | Proposed            |
| A4  | GET    | `/auth/me`               | Login                | Akun             | Proposed            |
| C1  | GET    | `/categories`            | Publik               | Search           | Proposed            |
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

|             |                                               |
| ----------- | --------------------------------------------- |
| Tujuan      | Mendaftarkan akun customer atau provider baru |
| Peran       | Publik                                        |
| Requirement | FR-CUST-01, FR-PROV-01, US-CUST-01            |
| Layar       | `/register`                                   |

Request body:

| Field           | Tipe                     | Wajib         | Aturan                                     |
| --------------- | ------------------------ | ------------- | ------------------------------------------ |
| `role`          | `customer` \| `provider` | ya            | Admin tidak bisa daftar lewat endpoint ini |
| `full_name`     | string                   | ya            | 2–100 karakter                             |
| `email`         | string                   | ya            | Format email, unik                         |
| `phone`         | string                   | ya            | Format `+62…`, maks 20 karakter            |
| `password`      | string                   | ya            | Minimal 8 karakter                         |
| `alumni_reg_no` | string                   | jika provider | Nomor alumni UPTD PPSGHD                   |

```json
{
  "role": "customer",
  "full_name": "Budi Santoso",
  "email": "budi@example.com",
  "phone": "+6281234567890",
  "password": "rahasia123"
}
```

Registrasi tidak langsung login; frontend mengarahkan ke `/login` dengan pesan sukses (US-CUST-01).

Sukses `201`:

```json
{
  "data": {
    "user": {
      "id": "0b6c…",
      "role": "customer",
      "full_name": "Budi Santoso",
      "email": "budi@example.com",
      "status": "active"
    }
  }
}
```

Untuk `role = provider`, server juga membuat `provider_profiles` dengan `verification_status = pending`; provider belum tampil publik sampai diverifikasi admin.

Error: `400 VALIDATION_ERROR`, `409 CONFLICT` ("Email ini sudah terdaftar. Silakan masuk atau gunakan email lain.").

> **Proposed:** provider mendaftar sendiri lalu diverifikasi admin. Dokumen requirement belum tegas: US-CUST-01 hanya mengatur registrasi customer, FR-PROV-01 dan alur provider dimulai dari "Provider Login", sedangkan US-ADM-01 menyebut "akun provider baru berstatus pending". Alternatifnya akun provider dibuat oleh admin. Perlu konfirmasi Product.

### A2 `POST /auth/login`

|             |                                      |
| ----------- | ------------------------------------ |
| Tujuan      | Masuk dan mendapatkan sesi           |
| Peran       | Publik                               |
| Requirement | FR-CUST-01, FR-PROV-01, SP1-03       |
| Layar       | `/login`, lalu redirect sesuai peran |

Request: `{ "email": "budi@example.com", "password": "rahasia123" }`

Sukses `200` + `Set-Cookie: djc_token=…; HttpOnly`:

```json
{
  "data": {
    "user": { "id": "0b6c…", "role": "customer", "full_name": "Budi Santoso", "status": "active" },
    "token": "eyJhbGciOi…"
  }
}
```

`token` di body hanya untuk klien yang memakai header Bearer; frontend cukup memakai cookie.

Error: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS` ("Email atau password salah.").

### A3 `POST /auth/logout`

Peran: Login. Menghapus cookie sesi. Sukses `200`: `{ "data": { "logged_out": true } }`. Error: `401 UNAUTHENTICATED`.

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
      "full_name": "Deni Setiawan",
      "email": "deni@example.com",
      "phone": "+62…",
      "status": "active"
    },
    "provider_profile": { "id": "7f1a…", "verification_status": "verified" }
  }
}
```

`provider_profile` hanya ada untuk provider. Error: `401 UNAUTHENTICATED`.

---

## 5. Kategori

### C1 `GET /categories`

|             |                                                                   |
| ----------- | ----------------------------------------------------------------- |
| Tujuan      | Daftar kategori untuk homepage, filter pencarian, dan filter peta |
| Peran       | Publik                                                            |
| Requirement | FR-CUST-02, FR-ADM-03, SP1-06                                     |
| Layar       | Homepage, `/services`, peta                                       |

Hanya kategori `is_active = true`, urut `sort_order`.

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

| Area                                 | Endpoint rencana                                                                     | Issue/backlog         |
| ------------------------------------ | ------------------------------------------------------------------------------------ | --------------------- |
| Admin kategori                       | `POST /admin/categories`, `PATCH /admin/categories/:id`                              | SP1-06                |
| Profil provider                      | `GET`/`PUT /provider/profile`, `PUT /provider/location`                              | SP1-07                |
| Jadwal, layanan, portofolio provider | `/provider/availability`, `/provider/services`, `/provider/portfolio`                | FR-PROV-04–06, SP1-08 |
| Admin verifikasi dan moderasi        | `/admin/providers/:id/verify`, `/admin/reviews/:id/hide`, `/admin/users/:id/suspend` | FR-ADM-01–06          |
| Email reset/verifikasi               | Menunggu STK-OPN-03                                                                  | –                     |
| Payment sandbox                      | Stretch goal                                                                         | STR-01                |

---

## 12. Keputusan dan pertanyaan untuk review

| ID     | Pertanyaan                                     | Usulan draft                                                                                                                         | Reviewer      | Status     |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ---------- |
| API-01 | Mekanisme token (STK-04)                       | JWT sudah disepakati tim (review PM di deonaja/difabel-jabar-connect#11). Usulan penyimpanan: cookie HttpOnly, Bearer tetap diterima | Full-stack    | `Proposed` |
| API-08 | Auto-cancel booking `requested` setelah 24 jam | Ikut review PM di deonaja/difabel-jabar-connect#11; keputusan #3 data model diperbarui                                               | PM + SE       | `Proposed` |
| API-02 | Cookie lintas domain Vercel ↔ Railway          | `SameSite=None; Secure` atau rewrite Vercel; diputuskan di SP1-10                                                                    | Full-stack    | `Proposed` |
| API-03 | Login akun suspended                           | Boleh login, baca saja (ikut data model dan SP1-05; bertentangan dengan system flow 2.1 dan US-ADM-04)                               | SE            | `Proposed` |
| API-04 | Pendaftaran provider                           | Daftar sendiri, status `pending` sampai diverifikasi admin                                                                           | SE + Product  | `Proposed` |
| API-05 | Pencarian per provider atau per layanan        | Per provider (`GET /providers`); tambah `GET /services` jika UI butuh                                                                | SE + Frontend | `Proposed` |
| API-06 | Bentuk endpoint transisi status                | Satu endpoint per aksi (`/accept`, `/reject`, …)                                                                                     | Full-stack    | `Proposed` |
| API-07 | Data milik orang lain                          | `404`, bukan `403`                                                                                                                   | SE            | `Proposed` |
