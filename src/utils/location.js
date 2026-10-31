// Koordinat publik provider (keputusan #8 data-model): koordinat asli dibulatkan ke
// 2 desimal (sekitar 1,1 km) di server. Hanya hasil ini yang boleh dikirim ke publik.

/** -6.238321 → -6.24, 106.975612 → 106.98. */
function fuzzCoordinate(value) {
  if (value === null || value === undefined) return null;
  return Number((Math.round(Number(value) * 100) / 100).toFixed(2));
}

module.exports = { fuzzCoordinate };
