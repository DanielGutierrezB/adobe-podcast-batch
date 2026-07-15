// enhance.js — wrapper de escritorio sobre el cliente compartido de Phonos.
// El motor real vive en premiere-plugin/js/phonos.js (único para app y panel CEP).

const fs = require('fs');
const path = require('path');
const { enhanceToFile, STATES, AUDIO_EXTS } = require('./premiere-plugin/js/phonos');

// Procesa un archivo y lo deja en Enhanced/ junto al original.
// - cleanVoice 100 → la voz limpia sale directo en Enhanced/<nombre>.wav
// - cleanVoice <100 → la mezcla queda en Enhanced/ y la voz 100% limpia
//   se guarda además en Enhanced/Clean voice/.
// opts: { token, model, cleanVoice, ffmpeg, onStatus }
async function enhanceFile(inPath, opts = {}) {
  const name = path.basename(inPath);
  const stem = path.basename(name, path.extname(name));
  const outDir = path.join(path.dirname(inPath), 'Enhanced');
  const outPath = path.join(outDir, `${stem}.wav`);
  const wantBlend = Number(opts.cleanVoice) < 100 && opts.ffmpeg;
  return enhanceToFile(inPath, outPath, {
    ...opts,
    codec: 'pcm_s16le',
    saveCleanTo: wantBlend ? path.join(outDir, 'Clean voice', `${stem}.wav`) : null,
  });
}

// lista audios de una carpeta (no recursivo)
function listAudios(dir) {
  return fs.readdirSync(dir)
    .filter(f => AUDIO_EXTS.has(path.extname(f).toLowerCase()))
    .filter(f => !path.basename(f, path.extname(f)).endsWith('_enhanced'))
    .map(f => path.join(dir, f));
}

module.exports = { enhanceFile, listAudios, AUDIO_EXTS, STATES };
