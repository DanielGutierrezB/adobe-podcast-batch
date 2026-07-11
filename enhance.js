// enhance.js — motor de Adobe Podcast Enhance Speech (Node, sin dependencias)
// Reutiliza el endpoint interno "phonos" que usa la web. Node 18+ (fetch global).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
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
    cleanVoice = 100,    // % de voz limpia (100 = solo enhanced; <100 = blend con original)
    ffmpeg = null,       // ruta al binario ffmpeg (para el blend)
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

  // 5) descargar la voz limpia (enhanced)
  onStatus('descargando');
  const cleanBuf = await downloadBuf(downloadUrl);

  const outDir = path.join(path.dirname(inPath), 'Enhanced');
  fs.mkdirSync(outDir, { recursive: true });
  const stem = path.basename(name, ext);
  const finalPath = path.join(outDir, `${stem}.wav`);

  const wantBlend = cleanPct < 100 && ffmpeg;
  if (!wantBlend) {
    // 100% (o sin ffmpeg): voz limpia directo en Enhanced/
    fs.writeFileSync(finalPath, cleanBuf);
    onStatus('listo', 100);
    return { ok: true, outPath: finalPath, cleanVoice: 100 };
  }

  // <100%: guardar la voz limpia en Enhanced/Clean voice/ y dejar la mezcla afuera
  const cleanDir = path.join(outDir, 'Clean voice');
  fs.mkdirSync(cleanDir, { recursive: true });
  fs.writeFileSync(path.join(cleanDir, `${stem}.wav`), cleanBuf);

  // bajar el original para la mezcla dry/wet
  const origMeta = await (await fetch(`${BASE}/api/v1/enhance_speech_tracks/${trackId}/original_audio?time=${nowMs()}`, { headers: H })).json();
  const origBuf = await downloadBuf(origMeta.url);

  // archivos temporales para ffmpeg
  const tmp = os.tmpdir();
  const tClean = path.join(tmp, `ape_${trackId}_clean.wav`);
  const tOrig = path.join(tmp, `ape_${trackId}_orig.bin`);
  fs.writeFileSync(tClean, cleanBuf);
  fs.writeFileSync(tOrig, origBuf);
  try {
    await blend(ffmpeg, tClean, tOrig, cleanPct / 100, finalPath);
  } finally {
    try { fs.unlinkSync(tClean); } catch {}
    try { fs.unlinkSync(tOrig); } catch {}
  }
  onStatus('listo', 100);
  return { ok: true, outPath: finalPath, cleanVoice: cleanPct };
}

async function downloadBuf(url) {
  const r = await fetch(url, { method: 'GET' });
  if (!r.ok) throw new Error(`download ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// Mezcla dry/wet: salida = wClean*limpia + (1-wClean)*original (alineadas, mono 48k).
function blend(ffmpeg, cleanPath, origPath, wClean, outPath) {
  const w0 = wClean.toFixed(3), w1 = (1 - wClean).toFixed(3);
  const args = ['-y', '-i', cleanPath, '-i', origPath, '-filter_complex',
    `[0:a]aresample=48000,aformat=channel_layouts=mono[a];[1:a]aresample=48000,aformat=channel_layouts=mono[b];[a][b]amix=inputs=2:weights=${w0} ${w1}:normalize=0:duration=first[out]`,
    '-map', '[out]', '-c:a', 'pcm_s16le', outPath];
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
