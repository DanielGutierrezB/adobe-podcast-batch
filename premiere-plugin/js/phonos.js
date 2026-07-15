// phonos.js — cliente ÚNICO de Adobe Podcast Enhance Speech (endpoint interno "phonos").
// Lo comparten la app de escritorio (Electron) y el panel CEP de Premiere:
//   - Escritorio: require('./premiere-plugin/js/phonos.js') desde enhance.js.
//   - Panel CEP:  require(EXT + '/js/phonos.js') con --enable-nodejs.
// Necesita `fetch` global (Node 18+ o CEF con --disable-web-security).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const BASE = 'https://phonos-server-flex.adobe.io';

// Contrato de estados del pipeline (viajan por IPC/eventos hasta la UI).
const STATES = {
  SUBIENDO: 'subiendo',
  PROCESANDO: 'procesando',
  DESCARGANDO: 'descargando',
  LISTO: 'listo',
  ERROR: 'error',
  ESPERANDO: 'esperando',   // pausado por límite de créditos
  EN_COLA: 'en cola',
  EN_ESPERA: 'en espera',
};

const MIME = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.aiff': 'audio/aiff', '.aif': 'audio/aiff', '.mp4': 'audio/mp4',
  '.mov': 'audio/mp4', '.caf': 'audio/x-caf',
};
const AUDIO_EXTS = new Set(Object.keys(MIME));

const nowMs = () => String(Date.now());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

// Procesa `inPath` con Enhance Speech y escribe el resultado en `outPath`.
// opts: {
//   token,                — obligatorio, token IMS de Adobe
//   model = 'v2',
//   cleanVoice = 100,     — % de voz limpia (<100 = blend local con el original)
//   ffmpeg = null,        — ruta al binario ffmpeg (necesario para el blend)
//   codec = 'pcm_s16le',  — códec del WAV cuando hay blend
//   saveCleanTo = null,   — ruta extra donde guardar la voz 100% limpia (solo si hay blend)
//   onStatus(state, pct)
// }
// Devuelve { ok, outPath, cleanVoice } o lanza Error (e.code: 'LIMIT' | 'AUTH').
async function enhanceToFile(inPath, outPath, opts = {}) {
  const {
    token,
    model = 'v2',
    cleanVoice = 100,
    ffmpeg = null,
    codec = 'pcm_s16le',
    saveCleanTo = null,
    onStatus = () => {},
  } = opts;
  const cleanPct = Math.max(0, Math.min(100, Number(cleanVoice)));

  if (!token) throw new Error('Falta el token de Adobe');
  if (!fs.existsSync(inPath)) throw new Error('No existe el archivo: ' + inPath);

  const name = path.basename(inPath);
  const ext = path.extname(name).toLowerCase();
  const mime = MIME[ext] || 'audio/mpeg';
  const data = fs.readFileSync(inPath);
  const checksum = crypto.createHash('md5').update(data).digest('base64');
  const trackId = crypto.randomUUID();
  const H = baseHeaders(token);

  // 1) direct upload URL
  onStatus(STATES.SUBIENDO);
  const duRes = await fetch(`${BASE}/rails/active_storage/direct_uploads`, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({
      blob: { filename: name, content_type: mime, byte_size: data.length, checksum },
    }),
  });
  if (duRes.status === 429) throw makeLimitError(await safeJson(duRes));
  if (duRes.status === 401) throw makeAuthError();
  if (!duRes.ok) throw new Error(`direct_upload ${duRes.status}: ${await safeText(duRes)}`);
  const du = await duRes.json();

  // 2) PUT del archivo al storage — SOLO los headers firmados por S3 (SigV4),
  //    cualquier header extra rompe la firma (SignatureDoesNotMatch).
  const putRes = await fetch(du.direct_upload.url, {
    method: 'PUT', headers: du.direct_upload.headers, body: data,
  });
  if (!(putRes.status >= 200 && putRes.status < 300)) {
    throw new Error(`upload ${putRes.status}: ${await safeText(putRes)}`);
  }

  // 3) crear track de enhance
  onStatus(STATES.PROCESANDO);
  const ctRes = await fetch(`${BASE}/api/v1/enhance_speech_tracks?time=${nowMs()}`, {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ id: trackId, track_name: name, model_version: model, signed_id: du.signed_id }),
  });
  if (ctRes.status === 429) throw makeLimitError(await safeJson(ctRes));
  if (ctRes.status === 401) throw makeAuthError();
  if (!ctRes.ok) throw new Error(`create_track ${ctRes.status}: ${await safeText(ctRes)}`);
  // Adobe reporta créditos/límite en el objeto `limits` de la respuesta
  const ctJson = await safeJson(ctRes);
  if (ctJson && ctJson.limits && ctJson.limits['is_limited?']) throw makeLimitError(ctJson);

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
    } else if (r.status === 429) {
      throw makeLimitError(await safeJson(r));
    } else if (r.status === 401) {
      throw makeAuthError();
    } else { // 204 = sigue procesando; otros status transitorios se reintentan
      onStatus(STATES.PROCESANDO, Math.min(95, Math.round((i / maxAttempts) * 100)));
      await sleep(delay);
    }
  }
  if (!downloadUrl) throw new Error('Timeout esperando el procesamiento');

  // 5) descargar la voz limpia (enhanced)
  onStatus(STATES.DESCARGANDO);
  const cleanBuf = await downloadBuf(downloadUrl);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const wantBlend = cleanPct < 100 && ffmpeg;
  if (!wantBlend) {
    fs.writeFileSync(outPath, cleanBuf);
    onStatus(STATES.LISTO, 100);
    return { ok: true, outPath, cleanVoice: 100 };
  }

  if (saveCleanTo) {
    fs.mkdirSync(path.dirname(saveCleanTo), { recursive: true });
    fs.writeFileSync(saveCleanTo, cleanBuf);
  }

  // Blend dry/wet contra el ORIGINAL LOCAL (inPath) — no hace falta bajarlo de Adobe.
  const tClean = path.join(os.tmpdir(), `ape_${trackId}_clean.wav`);
  fs.writeFileSync(tClean, cleanBuf);
  try {
    await blend(ffmpeg, tClean, inPath, cleanPct / 100, outPath, codec);
  } finally {
    try { fs.unlinkSync(tClean); } catch {}
  }
  onStatus(STATES.LISTO, 100);
  return { ok: true, outPath, cleanVoice: cleanPct };
}

async function downloadBuf(url) {
  const r = await fetch(url, { method: 'GET' });
  if (!r.ok) throw new Error(`download ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// Mezcla dry/wet: salida = wClean*limpia + (1-wClean)*original (alineadas, mono 48k).
function blend(ffmpeg, cleanPath, origPath, wClean, outPath, codec) {
  const w0 = wClean.toFixed(3), w1 = (1 - wClean).toFixed(3);
  const args = ['-y', '-i', cleanPath, '-i', origPath, '-filter_complex',
    `[0:a]aresample=48000,aformat=channel_layouts=mono[a];[1:a]aresample=48000,aformat=channel_layouts=mono[b];[a][b]amix=inputs=2:weights=${w0} ${w1}:normalize=0:duration=first[out]`,
    '-map', '[out]', '-c:a', codec, outPath];
  return new Promise((res, rej) => {
    execFile(ffmpeg, args, { maxBuffer: 1 << 26 }, (err, _so, se) => {
      if (err) rej(new Error('ffmpeg: ' + (se || err.message).toString().slice(0, 200)));
      else res();
    });
  });
}

async function safeText(res) {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}
async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

function makeAuthError() {
  const e = new Error('Token expirado o inválido (401). Reconectá con Adobe.');
  e.code = 'AUTH';
  return e;
}

// Error marcado como límite de créditos, con segundos de espera.
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

module.exports = { enhanceToFile, STATES, MIME, AUDIO_EXTS };
