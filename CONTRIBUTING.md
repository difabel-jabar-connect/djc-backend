# Panduan Kontribusi

Aturan ini mengikuti usulan `docs/project-management/repository-governance.md` di repository dokumentasi dan dapat berubah setelah review PM.

## Alur kerja

1. Ambil issue berstatus `Ready` dan pindahkan ke `In Progress`. Setiap anggota maksimal memiliki satu issue `In Progress`.
2. Buat branch dari `main` terbaru sesuai aturan naming.
3. Push branch, lalu buka pull request ke `main`. Draft PR boleh dipakai selama pekerjaan berjalan.
4. Isi template PR dan tulis `Addresses`, bukan `Closes`, agar merge tidak menutup issue secara otomatis.
5. Tunggu minimal satu approval dari code owner selain penulis, lalu selesaikan seluruh percakapan review.
6. Penulis PR melakukan squash merge. Branch terhapus otomatis setelah merge.
7. Tulis handoff review di issue dan pindahkan kartu ke `Review`. PM yang menutup issue setelah review tim.

Branch `main` dilindungi ruleset `protect-main`: direct push, force push, dan penghapusan branch ditolak.

## Naming branch

Format: `<tipe>/issue-<nomor>-<ringkasan>`

| Tipe | Dipakai untuk | Contoh |
| --- | --- | --- |
| `feat` | Fitur baru atau perubahan perilaku aplikasi | `feat/issue-15-health-endpoint` |
| `fix` | Perbaikan bug | `fix/issue-31-login-redirect` |
| `docs` | Dokumentasi | `docs/issue-15-setup-guide` |
| `chore` | Konfigurasi, dependency, tooling, dan CI | `chore/issue-15-eslint-config` |

- Gunakan huruf kecil dengan kata dipisah tanda hubung; ringkasan cukup tiga sampai lima kata.
- Pekerjaan tanpa issue memakai `<tipe>/<ringkasan>` dan menjelaskan alasannya di deskripsi PR.

## Commit dan judul PR

Gunakan format Conventional Commits: `<tipe>(<scope opsional>): <ringkasan>`, misalnya `feat(backend): add health endpoint`. Judul PR wajib memakai format yang sama karena squash merge menjadikan judul PR sebagai pesan commit di `main`.

## Referensi issue

Issue saat ini dilacak di repository dokumentasi. Dari repository ini, rujuk issue dengan format lengkap, misalnya `Addresses deonaja/difabel-jabar-connect#15`.

## Secret

- Jangan commit `.env`, password, token, atau API key. Simpan nilainya di environment variable layanan.
- Catat nama variabel baru di `.env.example` tanpa nilai rahasia.
- GitHub memblokir push yang terdeteksi berisi secret. Jika secret terlanjur ter-push, segera ganti secret tersebut di layanan terkait dan laporkan di issue.
