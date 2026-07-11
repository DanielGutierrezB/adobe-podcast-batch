// enhance.js — motor Adobe Podcast para el panel CEP.
// Red: fetch de CEF (con --disable-web-security). Archivos: Node (fs/crypto/child_process).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const BASE = 'https://phonos-server-flex.adobe.io';
const nowMs = () => String(Date.now());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function baseHeaders(token) {
  const auth = /^bearer /i.test(token) ? token : 'Bearer ' + token;
  return {
    'accept': '*/*', 'authorization': auth,
    'origin': 'https://podcast.adobe.com', 'referer': 'https://podcast.adobe.com/',
    'x-api-key': 'phonos-server-prod', 'x-cookie-settings': 'C0001,C0002,C0003,C0004',
  };
}

// Procesa un WAV y escribe el resultado en outPath.
// opts: { token, cleanVoice=100, ffmpeg, onStatus }
async function enhanceToFile(inPath, outPath, opts) {
  opts = opts || {};
  const token = opts.token;
  const cleanPct = Math.max(0, Math.min(100, Number(opts.cleanVoice == null ? 100 : opts.cleanVoice)));
  const ffmpeg = opts.ffmpeg;
  const onStatus = opts.onStatus || function () {};
  if (!token) throw new Error('Falta el token de Adobe');

  const name = path.basename(inPath);
  const data = fs.readFileSync(inPath);
  const checksum = crypto.createHash('md5').update(data).digest('base64');
  const trackId = crypto.randomUUID();
  const H = baseHeaders(token);

  onStatus('subiendo');
  const du = await (await fetch(BASE + '/rails/active_storage/direct_uploads', {
    method: 'POST', headers: Object.assign({}, H, { 'content-type': 'application/json' }),
    body: JSON.stringify({ blob: { filename: name, content_type: 'audio/wav', byte_size: data.length, checksum } }),
  })).json();

  const put = await fetch(du.direct_upload.url, { method: 'PUT', headers: du.direct_upload.headers, body: data });
  if (!(put.status >= 200 && put.status < 300)) throw new Error('upload ' + put.status);

  onStatus('procesando');
  const ct = await fetch(BASE + '/api/v1/enhance_speech_tracks?time=' + nowMs(), {
    method: 'POST', headers: Object.assign({}, H, { 'content-type': 'application/json' }),
    body: JSON.stringify({ id: trackId, track_name: name, model_version: 'v2', signed_id: du.signed_id }),
  });
  if (ct.status === 429) throw limitError(await ct.json());
  const ctj = await ct.json();
  if (ctj && ctj.limits && ctj.limits['is_limited?']) throw limitError(ctj);

  let url = null;
  for (let i = 1; i <= 120; i++) {
    const r = await fetch(BASE + '/api/v1/enhance_speech_tracks/' + trackId + '/enhanced_audio?time=' + nowMs(), { headers: H });
    if (r.status === 200) { const j = await r.json(); url = j.url; if (url) break; }
    else if (r.status === 429) throw limitError(await r.json());
    else if (r.status === 401) { const e = new Error('Sesión expirada'); e.code = 'AUTH'; throw e; }
    onStatus('procesando', Math.min(95, Math.round(i / 120 * 100)));
    await sleep(3000);
  }
  if (!url) throw new Error('Timeout esperando el procesamiento');

  onStatus('descargando');
  const cleanBuf = Buffer.from(await (await fetch(url)).arrayBuffer());

  if (cleanPct >= 100 || !ffmpeg) {
    fs.writeFileSync(outPath, cleanBuf);
    return { ok: true, outPath: outPath, cleanVoice: 100 };
  }
  // blend dry/wet local: clean% + original%
  const tmp = os.tmpdir();
  const tClean = path.join(tmp, 'pp_' + trackId + '_clean.wav');
  fs.writeFileSync(tClean, cleanBuf);
  try {
    await blend(ffmpeg, tClean, inPath, cleanPct / 100, outPath);
  } finally { try { fs.unlinkSync(tClean); } catch (e) {} }
  return { ok: true, outPath: outPath, cleanVoice: cleanPct };
}

function blend(ffmpeg, cleanPath, origPath, wClean, outPath) {
  const w0 = wClean.toFixed(3), w1 = (1 - wClean).toFixed(3);
  const args = ['-y', '-i', cleanPath, '-i', origPath, '-filter_complex',
    '[0:a]aresample=48000,aformat=channel_layouts=mono[a];[1:a]aresample=48000,aformat=channel_layouts=mono[b];[a][b]amix=inputs=2:weights=' + w0 + ' ' + w1 + ':normalize=0:duration=first[out]',
    '-map', '[out]', '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '1', outPath];
  return new Promise((res, rej) => {
    execFile(ffmpeg, args, { maxBuffer: 1 << 26 }, (err, so, se) => err ? rej(new Error('ffmpeg: ' + se)) : res());
  });
}

function limitError(json) {
  const lim = (json && json.limits) || {};
  let secs = lim.time_remaining != null ? Number(lim.time_remaining) : null;
  if (secs == null && lim.retry_at_time) secs = Math.max(0, Math.round((new Date(lim.retry_at_time).getTime() - Date.now()) / 1000));
  const e = new Error('Sin créditos de Adobe'); e.code = 'LIMIT'; e.retrySeconds = secs;
  return e;
}

module.exports = { enhanceToFile };
