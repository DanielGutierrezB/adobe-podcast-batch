// batch.js — orquestación del lote: N workers + compuerta compartida de límite de créditos.
// Sin dependencias de Electron: recibe todo por parámetro (testeable en Node pelado).

const { enhanceFile, STATES } = require('./enhance');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Ejecuta el lote. deps:
//   send(channel, data)   — eventos hacia la UI ('status'|'done'|'limit'|'limit-clear'|'auth-expired')
//   getToken()            — token vigente (puede cambiar tras un reauth)
//   reauth()              — Promise<token|null>, re-login silencioso
//   isCanceled()          — true si el usuario detuvo el lote
//   ffmpeg                — ruta al binario
async function runBatch({ files, cleanVoice, model, concurrency }, deps) {
  const { send, getToken, reauth, isCanceled, ffmpeg } = deps;
  const queue = [...files];
  let index = 0;

  // Compuerta ÚNICA de "sin créditos": el estado es del lote, no de cada worker.
  // El primer worker que choca con LIMIT la activa y anuncia; el resto solo espera.
  let pausedUntil = 0;

  async function waitForCredits(err) {
    const now = Date.now();
    if (now >= pausedUntil) {
      const secs = err.retrySeconds && err.retrySeconds > 0 ? err.retrySeconds : 60;
      pausedUntil = now + secs * 1000;
      send('limit', { seconds: secs, retryAt: err.retryAt });
    }
    while (Date.now() < pausedUntil) {
      if (isCanceled()) return false;
      await sleep(1000);
    }
    if (pausedUntil) { pausedUntil = 0; send('limit-clear', {}); }
    // jitter para que los workers no re-golpeen el endpoint todos a la vez
    await sleep(Math.floor(Math.random() * 1500));
    return true;
  }

  async function processWithRetry(filePath) {
    while (true) {
      if (isCanceled()) return { ok: false, error: 'cancelado' };
      try {
        return await enhanceFile(filePath, {
          token: getToken(), model: model || 'v2',
          cleanVoice: cleanVoice == null ? 100 : cleanVoice, ffmpeg,
          onStatus: (state, pct) => send('status', { filePath, state, pct }),
        });
      } catch (err) {
        if (err.code === 'LIMIT') {
          send('status', { filePath, state: STATES.ESPERANDO });
          if (!(await waitForCredits(err))) return { ok: false, error: 'cancelado' };
          continue; // reintenta el mismo archivo
        }
        if (err.code === 'AUTH') {
          const tok = await reauth();
          if (tok) continue;
          send('auth-expired', {});
          return { ok: false, error: 'Sesión expirada — reconectá con Adobe' };
        }
        return { ok: false, error: String(err.message || err) };
      }
    }
  }

  async function worker() {
    while (index < queue.length && !isCanceled()) {
      const filePath = queue[index++];
      const res = await processWithRetry(filePath);
      send('done', { filePath, ok: res.ok, outPath: res.outPath, error: res.error });
    }
  }

  const n = Math.min(concurrency, queue.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
}

module.exports = { runBatch };
