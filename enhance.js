// enhance.js — motor de Adobe Podcast Enhance Speech (Node, sin dependencias)
// Reutiliza el endpoint interno "phonos" que usa la web. Node 18+ (fetch global).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = crypto;

const BASE = 'https://phonos-server-flex.adobe.io';

const MIME = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.aiff': 'audio/aiff', '.aif': 'audio/aiff', '.mp4': 'audio/mp4',
  '.mov': 'audio/mp4', '.caf': 'audio/x-caf',
};
const AUDIO_EXTS = new Set(Object.keys(MIME));

function nowMs() { return String(Date.now()); }

function baseHeaders(token) {
  const auth = /^bearer /i.test(token) ? token : `Bearer ${token}`;
  return {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'authorization': auth,
    'origin': 'https://podcast.adobe.com',
    'referer': 'https://podcast.adobe.com/',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'x-api-key': 'phonos-server-prod',
    'x-cookie-settings': 'C0001,C0002,C0003,C0004',
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Procesa un archivo. opts: { token, model, mix:{speech,music,background}, onStatus(fn) }
// Devuelve { ok, outPath } o lanza Error.
async function enhanceFile(inPath, opts = {}) {
  const {
    token,
    model = 'v2',
    mix = null,          // {speech,music,background} en 0..100 (opcional, requiere API confirmada)
    onStatus = () => {},
  } = opts;

  if (!token) throw new Error('Falta el token de Adobe');
  if (!fs.existsSync(inPath)) throw new Error('No existe el archivo: ' + inPath);

  const name = path.basename(inPath);
  const ext = path.extname(name).toLowerCase();
  const mime = MIME[ext] || 'audio/mpeg';
  const data = fs.readFileSync(inPath);
  const checksum = crypto.createHash('md5').update(data).digest('base64');
  const trackId = randomUUID();
  const H = baseHeaders(token);

  // 1) direct upload URL
  onStatus('subiendo');
  const duRes = await fetch(`${BASE}/rails/active_storage/direct_uploads`, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({
      blob: { filename: name, content_type: mime, byte_size: data.length, checksum },
    }),
  });
  if (!duRes.ok) throw new Error(`direct_upload ${duRes.status}: ${await safeText(duRes)}`);
  const du = await duRes.json();
  const signedId = du.signed_id;

  // 2) PUT del archivo al storage — SOLO los headers firmados por S3 (SigV4),
  //    cualquier header extra rompe la firma (SignatureDoesNotMatch).
  const putRes = await fetch(du.direct_upload.url, {
    method: 'PUT', headers: du.direct_upload.headers, body: data,
  });
  if (!(putRes.status >= 200 && putRes.status < 300)) {
    throw new Error(`upload ${putRes.status}: ${await safeText(putRes)}`);
  }

  // 3) crear track de enhance
  onStatus('procesando');
  const trackBody = { id: trackId, track_name: name, model_version: model, signed_id: signedId };
  if (mix) {
    // Nota: nombres tentativos hasta confirmar con captura real de la web.
    trackBody.mix = {
      speech: mix.speech / 100, music: mix.music / 100, background: mix.background / 100,
    };
  }
  const ctRes = await fetch(`${BASE}/api/v1/enhance_speech_tracks?time=${nowMs()}`, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify(trackBody),
  });
  if (ctRes.status === 429) throw makeLimitError(await safeJson(ctRes));
  if (!ctRes.ok) throw new Error(`create_track ${ctRes.status}: ${await safeText(ctRes)}`);
  // Adobe reporta créditos/limite en el objeto `limits` de la respuesta
  const ctJson = await safeJson(ctRes);
  if (ctJson && ctJson.limits && ctJson.limits['is_limited?']) {
    throw makeLimitError(ctJson);
  }

  // 4) poll hasta que esté listo
  let downloadUrl = null;
  const maxAttempts = 120, delay = 3000;
  for (let i = 1; i <= maxAttempts; i++) {
    const r = await fetch(`${BASE}/api/v1/enhance_speech_tracks/${trackId}/enhanced_audio?time=${nowMs()}`, {
      method: 'GET', headers: H,
    });
    if (r.status === 200) {
      const j = await r.json();
      downloadUrl = j.url || j.download_url || j.enhanced_audio_url ||
        Object.values(j).find(v => typeof v === 'string' && v.startsWith('http'));
      if (downloadUrl) break;
      throw new Error('respuesta 200 sin URL de descarga: ' + JSON.stringify(j).slice(0, 300));
    } else if (r.status === 204) {
      onStatus('procesando', Math.min(95, Math.round((i / maxAttempts) * 100)));
      await sleep(delay);
    } else if (r.status === 429) {
      throw makeLimitError(await safeJson(r));
    } else {
      const t = await safeText(r);
      if (r.status === 401) { const e = new Error('Token expirado o inválido (401). Reconectá con Adobe.'); e.code = 'AUTH'; throw e; }
      await sleep(delay);
    }
  }
  if (!downloadUrl) throw new Error('Timeout esperando el procesamiento');

  // 5) descargar al lado del original con sufijo _enhanced
  onStatus('descargando');
  const dl = await fetch(downloadUrl, { method: 'GET' });
  if (!dl.ok) throw new Error(`download ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());

  const dir = path.dirname(inPath);
  const stem = path.basename(name, ext);
  let outPath = path.join(dir, `${stem}_enhanced.wav`);
  // no pisar si ya existe
  let n = 2;
  while (fs.existsSync(outPath)) {
    outPath = path.join(dir, `${stem}_enhanced_${n}.wav`);
    n++;
  }
  fs.writeFileSync(outPath, buf);
  onStatus('listo', 100);
  return { ok: true, outPath };
}

async function safeText(res) {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}
async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

// Construye un Error marcado como límite de créditos, con segundos de espera.
function makeLimitError(json) {
  const lim = (json && json.limits) || {};
  let seconds = null;
  if (lim.time_remaining != null) seconds = Number(lim.time_remaining);
  else if (lim.retry_at_time) {
    const ms = new Date(lim.retry_at_time).getTime() - Date.now();
    if (!isNaN(ms)) seconds = Math.max(0, Math.round(ms / 1000));
  }
  const e = new Error('Sin créditos de Adobe por ahora');
  e.code = 'LIMIT';
  e.retrySeconds = seconds;
  e.retryAt = lim.retry_at_time || null;
  return e;
}

// lista audios de una carpeta (no recursivo)
function listAudios(dir) {
  return fs.readdirSync(dir)
    .filter(f => AUDIO_EXTS.has(path.extname(f).toLowerCase()))
    .filter(f => !path.basename(f, path.extname(f)).endsWith('_enhanced'))
    .map(f => path.join(dir, f));
}

module.exports = { enhanceFile, listAudios, AUDIO_EXTS };
