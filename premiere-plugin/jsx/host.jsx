// host.jsx — ExtendScript para Premiere Pro (patrones probados de Editor Pro)
var TICKS_PER_SECOND = 254016000000;
var YELLOW_LABEL = 7; // etiqueta de color (7 = Mango/amarillo). 0-15 si hay que ajustar.

function _json(o) { return (typeof JSON !== 'undefined') ? JSON.stringify(o) : _stringify(o); }

// primera pista de audio SIN clips (para reusar sin mover nada); -1 si no hay
function _firstEmptyAudioTrack(seq) {
  for (var i = 0; i < seq.audioTracks.numTracks; i++) {
    try { if (seq.audioTracks[i].clips.numItems === 0) return i; } catch (e) {}
  }
  return -1;
}

// ── Secuencias del proyecto ──
function ppGetSequences() {
  try {
    var proj = app.project;
    var out = [];
    var active = proj.activeSequence ? proj.activeSequence.sequenceID : null;
    for (var i = 0; i < proj.sequences.numSequences; i++) {
      var s = proj.sequences[i];
      out.push({ index: i, id: String(s.sequenceID), name: s.name, active: (s.sequenceID === active) });
    }
    return _json({ ok: true, sequences: out });
  } catch (e) { return _json({ ok: false, error: String(e) }); }
}

// ── Secuencias ABIERTAS en la línea de tiempo (técnica de Editor Pro) ──
function ppGetOpenSequences() {
  try {
    var proj = app.project;
    // mapa id → nombre de todas las secuencias
    var names = {};
    for (var i = 0; i < proj.sequences.numSequences; i++) {
      var s = proj.sequences[i];
      names[String(s.sequenceID)] = s.name;
    }
    var activeId = proj.activeSequence ? proj.activeSequence.sequenceID : null;
    if (!activeId) return _json({ ok: true, sequences: [] });

    app.enableQE();
    // descubrir tabs abiertos cerrando el activo y registrando su id
    var openIds = [];
    var safety = 200;
    while (safety-- > 0) {
      var cur = app.project.activeSequence;
      if (!cur) break;
      var cid = cur.sequenceID, dup = false;
      for (var d = 0; d < openIds.length; d++) { if (openIds[d] === cid) { dup = true; break; } }
      if (dup) break;
      openIds.push(cid);
      try { qe.project.getActiveSequence().close(); $.sleep(80); } catch (e) { break; }
    }
    // reabrir en orden inverso para preservar el orden de tabs
    for (var r = openIds.length - 1; r >= 0; r--) { try { app.project.openSequence(openIds[r]); $.sleep(50); } catch (e2) {} }
    if (activeId) { $.sleep(100); try { app.project.openSequence(activeId); } catch (e3) {} }

    var out = [];
    for (var o = 0; o < openIds.length; o++) {
      var id = openIds[o];
      out.push({ id: String(id), name: names[String(id)] || ('Secuencia ' + id), active: (id === activeId) });
    }
    return _json({ ok: true, sequences: out });
  } catch (e) { return _json({ ok: false, error: String(e) }); }
}

// Carpeta del proyecto (para dejar los audios en Audio_Process al lado).
function ppGetProjectDir() {
  try {
    var p = app.project.path;
    if (!p || p === '') return _json({ ok: false, error: 'Proyecto sin guardar' });
    var f = new File(p);
    return _json({ ok: true, dir: f.parent.fsName });
  } catch (e) { return _json({ ok: false, error: String(e) }); }
}

function _activate(id) {
  var proj = app.project;
  for (var i = 0; i < proj.sequences.numSequences; i++) {
    if (String(proj.sequences[i].sequenceID) === String(id)) {
      try { app.project.openSequence(proj.sequences[i].sequenceID); } catch (e1) {}
      try { app.project.activeSequence = proj.sequences[i]; } catch (e2) {}
      return proj.sequences[i];
    }
  }
  return null;
}

// ── Preset WAV: usa uno cacheado o lo genera del exporter WAV ──
function _findOrCreatePreset() {
  // 1) cache persistente
  var base = Folder.userData ? Folder.userData.fsName : Folder.temp.fsName;
  var cached = base + '/APEnhance_wav_preset.epr';
  if (new File(cached).exists) return cached;

  // 2) presets del sistema (SIN abrir Media Encoder)
  var years = ['2026', '2025', '2024', '2023'];
  for (var y = 0; y < years.length; y++) {
    var sp = '/Applications/Adobe Media Encoder ' + years[y] + '/Adobe Media Encoder ' + years[y] + '.app/Contents/MediaIO/systempresets';
    var fold = new Folder(sp);
    if (fold.exists) {
      var files = fold.getFiles('*.epr');
      // preferir uno WAV
      for (var f = 0; f < files.length; f++) {
        var fn = files[f].name.toLowerCase();
        if (fn.indexOf('wav') >= 0 || fn.indexOf('waveform') >= 0 || fn.indexOf('uncompressed') >= 0) return files[f].fsName;
      }
    }
  }

  // 3) último recurso: generar con el encoder (abre AME una vez, se cachea)
  try {
    app.encoder.launchEncoder(); $.sleep(500);
    var ex = app.encoder.getExporters();
    for (var i = 0; i < ex.length; i++) {
      var n = (ex[i].name || '').toLowerCase();
      if (n.indexOf('wav') >= 0 || n.indexOf('waveform') >= 0) {
        var ps = ex[i].getPresets();
        if (ps.length > 0) { ps[0].writeToFile(cached); return cached; }
      }
    }
  } catch (e) {}
  return null;
}

// ── Exportar audio de una secuencia a WAV ──
function ppExportAudio(seqId, outPath) {
  try {
    var seq = _activate(seqId);
    if (!seq) return _json({ ok: false, error: 'Secuencia no encontrada' });
    var preset = _findOrCreatePreset();
    if (!preset) return _json({ ok: false, error: 'NO_PRESET' });
    var existing = new File(outPath); if (existing.exists) existing.remove();
    app.project.activeSequence.exportAsMediaDirect(outPath, preset, 0); // 0 = secuencia entera
    if (!new File(outPath).exists) return _json({ ok: false, error: 'La exportación no generó archivo' });
    return _json({ ok: true, outPath: outPath });
  } catch (e) { return _json({ ok: false, error: String(e) }); }
}

// ── Colocar el WAV procesado en un track nuevo desde el inicio + mutear el resto ──
function ppPlaceEnhanced(seqId, wavPath, muteOthers) {
  try {
    var seq = _activate(seqId);
    if (!seq) return _json({ ok: false, error: 'Secuencia no encontrada' });

    var bin = _getOrCreateBin('Audio_Process');
    var mediaFile = new File(wavPath);
    if (!mediaFile.exists) return _json({ ok: false, error: 'No existe el WAV: ' + wavPath });

    var before = bin.children ? bin.children.numItems : 0;
    app.project.importFiles([mediaFile.fsName], true, bin, false);
    var item = null;
    for (var w = 0; w < 30; w++) {
      $.sleep(250);
      if (bin.children && bin.children.numItems > before) { item = bin.children[bin.children.numItems - 1]; }
      if (item) break;
    }
    if (!item) return _json({ ok: false, error: 'No se encontró el clip importado' });

    var dbg = [];
    var aT = seq.audioTracks;
    function lastUsedIdx() { var L = -1; for (var u = 0; u < aT.numTracks; u++) { try { if (aT[u].clips.numItems > 0) L = u; } catch (e) {} } return L; }
    function firstEmptyAbove(from) { for (var i = from; i < aT.numTracks; i++) { try { if (aT[i].clips.numItems === 0) return i; } catch (e) {} } return -1; }
    function anyEmptyFromBottom() { for (var i = aT.numTracks - 1; i >= 0; i--) { try { if (aT[i].clips.numItems === 0) return i; } catch (e) {} } return -1; }

    var lastUsed = lastUsedIdx();
    dbg.push('tracksAntes=' + aT.numTracks + ' ultimoConClips=' + lastUsed);

    // 1) ¿ya hay una pista vacía por encima del contenido? (A3 vacío) → usarla, sin tocar nada
    var idx = firstEmptyAbove(lastUsed + 1);

    // 2) si no, crear una MONO al final. Firma real:
    //    addTracks(nVideo, despVideo, nAudio, tipoCanal[0=mono,1=stereo,2=5.1], despAudio, nSubmix)
    if (idx < 0) {
      var before = aT.numTracks;
      try {
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        try { qeSeq.addTracks(0, 0, 1, 0, before, 0); }   // 1 audio MONO, después del último (append)
        catch (e1) { try { qeSeq.addTracks(0, 0, 1, 0, before); } catch (e2) { qeSeq.addTracks(0, 0, 1); } }
        $.sleep(600);
      } catch (eQE) { dbg.push('addTracks err:' + eQE); }
      dbg.push('addTracks ' + before + '->' + aT.numTracks + ' (mono,append)');
      // la nueva pista vacía (preferir la de índice más alto = la del final)
      idx = anyEmptyFromBottom();
    }
    if (idx < 0) return _json({ ok: false, error: 'no encontré pista vacía', debug: dbg });
    dbg.push('idx=' + idx + ' vacio=' + (aT[idx].clips.numItems === 0));

    var track = aT[idx];
    // solo colocar en pista VACÍA (nunca pisar/correr contenido)
    try { track.overwriteClip(item, '0'); }
    catch (eOw) { return _json({ ok: false, error: 'overwrite: ' + eOw, debug: dbg }); }

    try { item.setColorLabel(YELLOW_LABEL); } catch (eCol) {}

    if (muteOthers) {
      for (var m = 0; m < aT.numTracks; m++) { try { aT[m].setMute(m === idx ? 0 : 1); } catch (e4) {} }
    }
    return _json({ ok: true, track: idx, totalTracks: aT.numTracks, debug: dbg });
  } catch (e) { return _json({ ok: false, error: String(e) }); }
}

function _getOrCreateBin(name) {
  var root = app.project.rootItem;
  for (var i = 0; i < root.children.numItems; i++) {
    var c = root.children[i];
    if (c.type === ProjectItemType.BIN && c.name === name) return c;
  }
  try { return root.createBin(name); } catch (e) { return root; }
}

function _stringify(o) {
  if (o === null) return 'null';
  if (typeof o === 'object') {
    var p = [];
    if (o instanceof Array) { for (var i = 0; i < o.length; i++) p.push(_stringify(o[i])); return '[' + p.join(',') + ']'; }
    for (var k in o) p.push('"' + k + '":' + _stringify(o[k]));
    return '{' + p.join(',') + '}';
  }
  if (typeof o === 'string') return '"' + o.replace(/"/g, '\\"') + '"';
  return String(o);
}
