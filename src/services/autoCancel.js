// Auto-cancel booking `requested` yang tidak direspons provider dalam 24 jam sejak dibuat
// (DEC-TIMEOUT, BE-08). Berjalan sebagai interval di proses server; tanpa paket tambahan.
const TIMEOUT_MS = 24 * 60 * 60 * 1000;
const REASON = 'Batas waktu konfirmasi 24 jam terlampaui (dibatalkan otomatis oleh sistem)';

/**
 * `now` dapat diganti saat testing, mis. createAutoCancel({ bookings, now: () => fixedDate }).
 * `runOnce()` menjalankan satu kali pengecekan; `start(intervalMs)` menjalankannya langsung
 * lalu berulang; `stop()` menghentikan interval.
 */
function createAutoCancel({ bookings, now = () => new Date(), logger = console }) {
  let timer = null;
  let running = false;

  async function runOnce() {
    // Satu putaran sekaligus: putaran berikutnya dilewati jika yang sebelumnya belum selesai.
    if (running) return [];
    running = true;
    try {
      const createdBefore = new Date(now().getTime() - TIMEOUT_MS);
      const ids = await bookings.cancelExpiredRequested({ createdBefore, reason: REASON });
      if (ids.length) logger.info(`[auto-cancel] ${ids.length} pesanan dibatalkan otomatis.`);
      return ids;
    } finally {
      running = false;
    }
  }

  async function safeRun() {
    try {
      await runOnce();
    } catch (error) {
      logger.error(`[auto-cancel] gagal: ${error.message}`);
    }
  }

  function start(intervalMs) {
    if (timer) return;
    safeRun();
    timer = setInterval(safeRun, intervalMs);
    // Interval tidak menahan proses tetap hidup saat server ditutup.
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { runOnce, start, stop };
}

module.exports = { createAutoCancel, TIMEOUT_MS, REASON };
