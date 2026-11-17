/**
 * Data akun yang aman dikirim ke pemiliknya sendiri. password_hash tidak pernah dikirim.
 * `name` diambil dari kolom full_name, sesuai yang dibaca frontend. `has_password` false
 * untuk akun Google yang belum membuat kata sandi sendiri (lihat migrasi 20261117000100).
 */
function toAuthUser(user) {
  return {
    id: user.id,
    role: user.role,
    name: user.full_name,
    email: user.email,
    phone: user.phone,
    avatar_url: user.avatar_url ?? null,
    has_password: user.has_password !== false && user.has_password !== 0,
    email_verified: Boolean(user.email_verified_at),
    status: user.status,
  };
}

module.exports = { toAuthUser };
