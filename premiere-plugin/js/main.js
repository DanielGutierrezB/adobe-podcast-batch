// main.js — panel CEP (una sola lista, estilo DMG)
var cs = new CSInterface();
var _require = (typeof require !== 'undefined') ? require : (window.cep_node ? window.cep_node.require : null);

var APP_VERSION = '1.1.0';
var UPDATE_REPO = 'DanielGutierrezB/adobe-podcast-batch';
var pathN, fsN, osN, cp, enhanceToFile, EXT, FFMPEG;
var token = null;
var latestAsset = null;
var queue = [];            // [{id, name, done, error, state}]
var logLines = [];

function $(id) { return document.getElementById(id); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function ts() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
function log(msg) { var line = '[' + ts() + '] ' + msg; logLines.push(line); try { console.log(line); } catch (e) {} }
// notificación visible abajo (además de loguear)
function notify(msg, type) { try { var t = $('toast'); if (t) { t.setAttribute('data-type', type || 'info'); var el = $('toastText'); if (el) el.textContent = msg; } } catch (e) {} log(msg); }

// ── módulos node + info de entorno al log ──
try {
  if (!_require) throw new Error('Node no habilitado (require indefinido)');
  pathN = _require('path'); fsN = _require('fs'); osN = _require('os'); cp = _require('child_process');
  EXT = cs.getSystemPath(SystemPath.EXTENSION);
  FFMPEG = pathN.join(EXT, 'bin', osN.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  try { fsN.chmodSync(FFMPEG, 0o755); } catch (e) {}
  enhanceToFile = _require(pathN.join(EXT, 'js', 'enhance.js')).enhanceToFile;
  log('Panel iniciado.');
  try {
    var hostEnv = JSON.parse(cs.getHostEnvironment());
    log('Host: ' + hostEnv.appName + ' ' + hostEnv.appVersion + ' | ext=' + EXT);
  } catch (e) {}
  log('OS: ' + osN.platform() + ' ' + osN.release() + ' | node=' + (process && process.version) + ' | ffmpeg=' + FFMPEG);
} catch (e) { log('⚠️ Error cargando módulos: ' + (e && e.message ? e.message : e)); }

function evalES(code) { return new Promise(function (res) { cs.evalScript(code, res); }); }
function esStr(s) { return JSON.stringify(String(s)); }
function safeName(s) { return String(s).replace(/[^a-zA-Z0-9_\-\. áéíóúñÁÉÍÓÚÑ]/g, '_'); }

// ── token persistente ──
function tokenFile() { return pathN.join(osN.homedir(), '.adobe-podcast-premiere-token'); }
function saveToken(t) { try { fsN.writeFileSync(tokenFile(), t, 'utf8'); } catch (e) {} }
function loadToken() { try { return fsN.readFileSync(tokenFile(), 'utf8').trim(); } catch (e) { return null; } }
function clearToken() { try { fsN.unlinkSync(tokenFile()); } catch (e) {} }
function markConnected(kind) {
  $('dot').classList.add('on');
  $('connText').textContent = 'Conectado' + (kind ? ' (' + kind + ')' : '');
  $('connectBtn').textContent = 'Reconectar'; $('logoutBtn').style.display = '';
}

// ── login Adobe ──
var authPoll = null;
function connect() {
  log('Login iframe: abriendo…');
  var f = $('adobeFrame'); $('loginWrap').style.display = 'block'; $('connectBtn').textContent = 'Logueate abajo…';
  f.src = 'https://podcast.adobe.com/en/enhance';
  if (authPoll) clearInterval(authPoll);
  authPoll = setInterval(function () {
    try {
      var w = f.contentWindow;
      var t = w && w.adobeIMS && w.adobeIMS.getAccessToken && w.adobeIMS.getAccessToken();
      var tok = t && (t.token || t.tokenValue);
      if (tok && tok.indexOf('eyJ') === 0) {
        clearInterval(authPoll); token = tok; saveToken(tok);
        $('loginWrap').style.display = 'none'; f.src = 'about:blank';
        markConnected(); $('configPanel').style.display = 'none'; notify('Conectado a Adobe.', 'success');
      }
    } catch (e) {}
  }, 1500);
}
function cancelLogin() { if (authPoll) clearInterval(authPoll); $('adobeFrame').src = 'about:blank'; $('loginWrap').style.display = 'none'; $('connectBtn').textContent = token ? 'Reconectar' : 'Conectar con Adobe (iframe)'; }
function useManualToken() {
  var v = ($('tokenInput').value || '').trim();
  if (v.indexOf('eyJ') !== 0) { notify('Ese texto no parece un token (debe empezar con eyJ).', 'error'); return; }
  token = v; saveToken(v); $('tokenInput').value = '';
  markConnected('manual'); $('configPanel').style.display = 'none'; notify('Conectado (token guardado).', 'success');
}
function openAdobe() {
  try { window.cep.util.openURLInDefaultBrowser('https://podcast.adobe.com/en/enhance'); }
  catch (e) { try { cs.openURLInDefaultBrowser('https://podcast.adobe.com/en/enhance'); } catch (e2) { log('Abrí a mano: podcast.adobe.com/enhance'); } }
}
function toggleConfig() { var p = $('configPanel'); p.style.display = (p.style.display === 'none') ? 'block' : 'none'; }
function logout() { token = null; clearToken(); $('dot').classList.remove('on'); $('connText').textContent = 'Desconectado'; $('connectBtn').textContent = 'Conectar con Adobe (iframe)'; $('logoutBtn').style.display = 'none'; log('Sesión cerrada.'); }
function downloadLog() {
  try {
    var out = pathN.join(osN.homedir(), 'Downloads', 'podcast-enhance-log.md');
    fsN.writeFileSync(out, '# Adobe Podcast Enhance — log\n\n```\n' + logLines.join('\n') + '\n```\n');
    notify('Log descargado en Descargas/podcast-enhance-log.md', 'success');
  } catch (e) { notify('No pude guardar el log: ' + (e.message || e), 'error'); }
}

// ── actualización auto-contenida (GitHub → descarga ZXP → descomprime → reload) ──
function verNum(v) { return String(v).replace(/^v/, '').split('.').map(function (n) { return parseInt(n, 10) || 0; }); }
function isNewer(remote, local) { var a = verNum(remote), b = verNum(local); for (var i = 0; i < 3; i++) { if ((a[i] || 0) > (b[i] || 0)) return true; if ((a[i] || 0) < (b[i] || 0)) return false; } return false; }
async function checkUpdate() {
  try {
    var r = await fetch('https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest', { headers: { 'accept': 'application/vnd.github+json' } });
    if (!r.ok) { log('checkUpdate: HTTP ' + r.status); return; }
    var j = await r.json();
    var tag = j.tag_name || '';
    var asset = (j.assets || []).filter(function (a) { return /\.zxp$/i.test(a.name || ''); })[0];
    if (asset) latestAsset = asset.browser_download_url;
    log('checkUpdate: local=' + APP_VERSION + ' remoto=' + tag + ' zxp=' + (asset ? asset.name : 'no'));
    if (isNewer(tag, APP_VERSION) && asset) {
      $('updateBtn').classList.add('has-update');
      $('updateBtn').setAttribute('data-tip', '¡Nueva versión ' + tag + ' disponible! Tocá para actualizar.');
      $('versionLabel').textContent = 'v' + APP_VERSION + ' → ' + tag.replace(/^v/, '');
      notify('Actualización disponible: ' + tag + '. Tocá ⟳ para instalarla.', 'info');
    }
  } catch (e) { log('checkUpdate err: ' + (e.message || e)); }
}
function reloadPanel() { try { window.location.reload(); } catch (e) { try { location.href = location.href; } catch (e2) {} } }
function unzipInto(zip, dir) {
  return new Promise(function (res, rej) {
    var cmd, args;
    if (osN.platform() === 'win32') { cmd = 'tar'; args = ['-xf', zip, '-C', dir]; }
    else { cmd = '/usr/bin/ditto'; args = ['-x', '-k', zip, dir]; }
    cp.execFile(cmd, args, { maxBuffer: 1 << 27 }, function (err, so, se) { err ? rej(new Error(se || err.message)) : res(); });
  });
}
async function doUpdate() {
  var btn = $('updateBtn'), ic = btn.querySelector('.upic');
  ic.classList.add('spinning'); btn.disabled = true;
  try {
    if (btn.classList.contains('has-update') && latestAsset) {
      notify('Descargando actualización…', 'info');
      var buf = Buffer.from(await (await fetch(latestAsset)).arrayBuffer());
      var tmpZxp = pathN.join(osN.tmpdir(), 'ape_update_' + Date.now() + '.zxp');
      fsN.writeFileSync(tmpZxp, buf);
      log('update: descargado ' + buf.length + ' bytes → descomprimiendo en ' + EXT);
      await unzipInto(tmpZxp, EXT);
      try { fsN.unlinkSync(tmpZxp); } catch (e) {}
      notify('Actualizado ✓ Recargando panel…', 'success');
      setTimeout(reloadPanel, 900);
    } else {
      notify('Recargando panel…', 'info');
      setTimeout(reloadPanel, 300);
    }
  } catch (e) { notify('Update falló: ' + (e.message || e) + ' — recargo igual.', 'warn'); setTimeout(reloadPanel, 1000); }
}

// ── seleccionar todo ──
function toggleSelectAll() {
  var on = $('selectAll').checked;
  [].slice.call(document.querySelectorAll('#queueList input[type=checkbox]')).forEach(function (c) { c.checked = on; });
  updateSelBtns();
}

// ── límite de créditos: hora del reporte + contador persistente ──
var limitTimer = null;
function limitFile() { return pathN.join(osN.homedir(), '.adobe-podcast-premiere-limit'); }
function saveLimit(retryAtMs, reportedMs) { try { fsN.writeFileSync(limitFile(), JSON.stringify({ retryAt: retryAtMs, reported: reportedMs })); } catch (e) {} }
function loadLimit() { try { return JSON.parse(fsN.readFileSync(limitFile(), 'utf8')); } catch (e) { return null; } }
function clearLimit() { try { fsN.unlinkSync(limitFile()); } catch (e) {} }
function hhmm(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function showLimit(retryAtMs, reportedMs) {
  var b = $('limitBanner'), t = $('limitText');
  b.hidden = false;
  if (limitTimer) clearInterval(limitTimer);
  function tick() {
    var rem = Math.max(0, retryAtMs - Date.now());
    if (rem <= 0) { clearInterval(limitTimer); limitTimer = null; b.hidden = true; clearLimit(); return; }
    var m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000);
    t.textContent = 'Sin créditos de Adobe (reportado ' + hhmm(reportedMs) + '). Reintentá en ' + m + ':' + pad(s) + '.';
  }
  tick(); limitTimer = setInterval(tick, 1000);
}
function triggerLimit(secs) {
  var now = Date.now();
  var retryAt = now + (secs && secs > 0 ? secs * 1000 : 3600 * 1000); // fallback 1h
  saveLimit(retryAt, now);
  showLimit(retryAt, now);
}

// ── cola persistente por proyecto ──
async function projectQueueFile() {
  try { var pd = JSON.parse(await evalES('ppGetProjectDir()')); if (!pd.ok) return null; return { dir: pathN.join(pd.dir, 'Audio_Process'), file: pathN.join(pd.dir, 'Audio_Process', 'queue.json') }; }
  catch (e) { return null; }
}
async function saveProjectQueue() {
  var p = await projectQueueFile(); if (!p) return;
  try { fsN.mkdirSync(p.dir, { recursive: true }); fsN.writeFileSync(p.file, JSON.stringify(queue.map(function (q) { return { id: q.id, name: q.name, done: !!q.done }; }), null, 2)); }
  catch (e) { log('⚠️ no pude guardar la cola: ' + (e.message || e)); }
}
async function loadProjectQueue() {
  var p = await projectQueueFile(); if (!p) return;
  try { if (fsN.existsSync(p.file)) { var arr = JSON.parse(fsN.readFileSync(p.file, 'utf8')); queue = arr.map(function (x) { return { id: x.id, name: x.name, done: !!x.done }; }); renderQueue(); log('Cola del proyecto restaurada (' + queue.length + ').'); } }
  catch (e) {}
}

// ── cargar secuencias abiertas directo a la lista ──
async function loadSequences() {
  log('Cargar secuencias: consultando abiertas…');
  var raw = await evalES('ppGetOpenSequences()');
  var r; try { r = JSON.parse(raw); } catch (e) { log('✗ respuesta no-JSON: ' + String(raw).slice(0, 200)); notify('Error al leer secuencias (ver log).', 'error'); return; }
  if (!r.ok) { log('✗ ppGetOpenSequences: ' + r.error); notify('Error: ' + r.error, 'error'); return; }
  var added = 0;
  r.sequences.forEach(function (s) {
    if (queue.filter(function (q) { return q.id === s.id; }).length) return;
    queue.push({ id: s.id, name: s.name, done: false }); added++;
  });
  log('Abiertas=' + r.sequences.length + ' | agregadas=' + added + ' | nombres=[' + r.sequences.map(function (s) { return s.name; }).join(', ') + ']');
  notify(added ? ('Cargadas ' + added + ' secuencia' + (added === 1 ? '' : 's') + '.') : 'No hay secuencias nuevas para cargar.', added ? 'success' : 'info');
  renderQueue(); saveProjectQueue();
}

function renderQueue() {
  var ul = $('queueList'); ul.innerHTML = '';
  queue.forEach(function (q) {
    var li = document.createElement('li');
    li.setAttribute('data-id', q.id);
    li.className = q.done ? 'done' : (q.error ? 'err' : '');
    li.innerHTML = '<input type="checkbox" data-id="' + q.id + '"/><span class="name">' + q.name + '</span>' +
      '<span class="st">' + (q.state || (q.done ? '✓ listo' : 'en espera')) + '</span>';
    ul.appendChild(li);
  });
  $('queueEmpty').style.display = queue.length ? 'none' : 'block';
  var pend = queue.filter(function (q) { return !q.done; }).length;
  $('queueCount').textContent = queue.length + ' secuencia' + (queue.length === 1 ? '' : 's') + (queue.length ? ' · ' + pend + ' pend.' : '');
  $('runBtn').disabled = pend === 0; $('runBtn').textContent = '▶ Procesar' + (pend ? ' (' + pend + ')' : '');
  updateSelBtns();
}
function updateSelBtns() {
  var total = document.querySelectorAll('#queueList input[type=checkbox]').length;
  var n = document.querySelectorAll('#queueList input:checked').length;
  var rb = $('reprocessBtn'); if (rb) { rb.disabled = n === 0; rb.title = 'Reprocesar seleccionadas' + (n ? ' (' + n + ')' : ''); }
  var xb = $('removeSelBtn'); if (xb) { xb.disabled = n === 0; xb.title = 'Quitar seleccionadas' + (n ? ' (' + n + ')' : ''); }
  var sa = $('selectAll'); if (sa) sa.checked = (total > 0 && n === total);
}
function setSt(id, txt, cls) {
  var q = queue.filter(function (x) { return x.id === id; })[0]; if (q) q.state = txt;
  var li = document.querySelector('#queueList li[data-id="' + id + '"]');
  if (li) { li.className = (cls === 'done' ? 'done' : (cls === 'err' ? 'err' : (cls || ''))); li.querySelector('.st').textContent = txt; }
}
function checkedIds() { return [].slice.call(document.querySelectorAll('#queueList input:checked')).map(function (c) { return c.getAttribute('data-id'); }); }
function removeSelected() { var ids = checkedIds(); queue = queue.filter(function (q) { return ids.indexOf(q.id) < 0; }); log('Quitadas ' + ids.length + ' de la cola.'); renderQueue(); saveProjectQueue(); }
function clearDone() { var b = queue.length; queue = queue.filter(function (q) { return !q.done; }); log('Limpiar finalizados: -' + (b - queue.length)); renderQueue(); saveProjectQueue(); }
function clearAll() { queue = []; log('Cola vaciada.'); renderQueue(); saveProjectQueue(); }

// ── procesar ──
function run() { var p = queue.filter(function (q) { return !q.done; }); if (!p.length) { log('No hay pendientes.'); return; } processItems(p); }
function reprocess() { var ids = checkedIds(); var items = queue.filter(function (q) { return ids.indexOf(q.id) >= 0; }); if (!items.length) { log('Nada seleccionado para reprocesar.'); return; } items.forEach(function (q) { q.done = false; }); log('Reprocesar ' + items.length + '.'); processItems(items); }

async function processItems(pending) {
  if (!token) { notify('Conectate a Adobe primero (⚙️).', 'error'); return; }
  if (!enhanceToFile) { notify('Motor de audio no cargó (ver log).', 'error'); return; }
  var outDir, pd; try { pd = JSON.parse(await evalES('ppGetProjectDir()')); } catch (e) { pd = { ok: false }; }
  if (pd.ok) { outDir = pathN.join(pd.dir, 'Audio_Process'); try { fsN.mkdirSync(outDir, { recursive: true }); } catch (e) {} }
  else { outDir = osN.tmpdir(); log('⚠️ Proyecto sin guardar → carpeta temporal.'); }
  var cleanVoice = Number($('cleanVoice').value), muteOthers = $('muteOthers').checked ? 1 : 0;
  log('── Procesando ' + pending.length + ' | vozLimpia=' + cleanVoice + '% | mutearOtras=' + muteOthers + ' | salida=' + outDir);
  notify('Procesando ' + pending.length + ' secuencia' + (pending.length === 1 ? '' : 's') + '…', 'info');
  $('runBtn').disabled = true; $('reprocessBtn').disabled = true;
  var okN = 0, errN = 0, stopped = false;

  for (var i = 0; i < pending.length; i++) {
    var it = pending[i]; it.done = false; it.error = false;
    var id = it.id, nm = safeName(it.name);
    var tmpExport = pathN.join(osN.tmpdir(), 'ppx_' + id + '_' + Date.now() + '.wav');
    var finalOut = pathN.join(outDir, nm + '.wav');
    log('▶ ' + nm + ' (id ' + id + ')');
    notify('(' + (i + 1) + '/' + pending.length + ') ' + it.name + ' — exportando…', 'info');
    try {
      setSt(id, 'exportando…', 'work');
      var ex = JSON.parse(await evalES('ppExportAudio(' + esStr(id) + ', ' + esStr(tmpExport) + ')'));
      if (!ex.ok) { it.error = true; errN++; setSt(id, ex.error === 'NO_PRESET' ? 'sin preset WAV' : 'error export', 'err'); log('  ✗ export: ' + ex.error); notify('⚠ ' + it.name + ': error al exportar.', 'error'); continue; }
      log('  · exportado: ' + tmpExport);
      setSt(id, 'procesando…', 'work'); notify('(' + (i + 1) + '/' + pending.length + ') ' + it.name + ' — limpiando voz…', 'info');
      await enhanceToFile(tmpExport, finalOut, { token: token, cleanVoice: cleanVoice, ffmpeg: FFMPEG, onStatus: (function (x) { return function (st, pct) { setSt(x, st + (pct ? ' ' + pct + '%' : ''), 'work'); }; })(id) });
      log('  · enhance ok: ' + finalOut);
      setSt(id, 'colocando…', 'work');
      var pl = JSON.parse(await evalES('ppPlaceEnhanced(' + esStr(id) + ', ' + esStr(finalOut) + ', ' + muteOthers + ')'));
      if (pl.debug) log('  · ' + pl.debug.join(' | '));
      if (!pl.ok) { it.error = true; errN++; setSt(id, 'error', 'err'); log('  ✗ place: ' + pl.error); notify('⚠ ' + it.name + ': error al colocar.', 'error'); continue; }
      it.done = true; okN++; setSt(id, '✓ listo', 'done'); log('  ✓ colocado en track ' + pl.track + ' / ' + pl.totalTracks);
      notify('✓ ' + it.name + ' lista (track ' + pl.track + ').', 'success');
    } catch (e) {
      it.error = true; errN++;
      if (e.code === 'LIMIT') { setSt(id, 'sin créditos', 'err'); log('  ⏳ Sin créditos' + (e.retrySeconds ? ' (~' + Math.ceil(e.retrySeconds / 60) + ' min)' : '') + ' retryAt=' + (e.retryAt || '?')); triggerLimit(e.retrySeconds); notify('⏳ Sin créditos de Adobe — mirá el contador arriba.', 'warn'); stopped = true; break; }
      if (e.code === 'AUTH') { setSt(id, 'sesión expiró', 'err'); log('  ✗ Sesión expirada.'); notify('Sesión expirada — reconectá (⚙️).', 'error'); stopped = true; break; }
      setSt(id, 'error', 'err'); log('  ✗ ' + (e.message || e)); notify('⚠ ' + it.name + ': ' + (e.message || e), 'error');
    } finally { try { fsN.unlinkSync(tmpExport); } catch (e) {} }
  }
  $('runBtn').disabled = false; renderQueue(); saveProjectQueue();
  log('── Fin. ok=' + okN + ' err=' + errN + (stopped ? ' (detenido)' : '') + ' | ' + outDir);
  if (stopped) { /* toast ya puesto por LIMIT/AUTH */ }
  else notify('Terminado: ' + okN + ' lista' + (okN === 1 ? '' : 's') + (errN ? ', ' + errN + ' con error' : '') + '.', errN ? 'warn' : 'success');
}

// ── handlers ──
$('gearBtn').addEventListener('click', toggleConfig);
$('updateBtn').addEventListener('click', doUpdate);
$('dlLogBtn').addEventListener('click', downloadLog);
$('connectBtn').addEventListener('click', connect);
$('loginCancel').addEventListener('click', cancelLogin);
$('useTokenBtn').addEventListener('click', useManualToken);
$('openAdobeBtn').addEventListener('click', openAdobe);
$('logoutBtn').addEventListener('click', logout);
$('loadBtn').addEventListener('click', loadSequences);
$('runBtn').addEventListener('click', run);
$('reprocessBtn').addEventListener('click', reprocess);
$('removeSelBtn').addEventListener('click', removeSelected);
$('clearDoneBtn').addEventListener('click', clearDone);
$('selectAll').addEventListener('change', toggleSelectAll);
$('queueList').addEventListener('change', updateSelBtns);
$('cleanVoice').addEventListener('input', function () { $('cleanVal').textContent = $('cleanVoice').value + '%'; });

// ── tooltip propio (hover) para elementos con data-tip ──
(function () {
  var tip = document.createElement('div'); tip.className = 'tip'; document.body.appendChild(tip);
  var cur = null;
  function show(el) {
    var txt = el.getAttribute('data-tip'); if (!txt) return;
    tip.textContent = txt; tip.classList.add('show');
    var r = el.getBoundingClientRect();
    var top = r.bottom + 6, left = r.left;
    tip.style.top = top + 'px'; tip.style.left = '0px';
    var tw = tip.offsetWidth;
    if (left + tw > window.innerWidth - 8) left = window.innerWidth - 8 - tw;
    if (left < 8) left = 8;
    if (top + tip.offsetHeight > window.innerHeight - 4) top = r.top - tip.offsetHeight - 6;
    tip.style.top = top + 'px'; tip.style.left = left + 'px';
  }
  function hide() { tip.classList.remove('show'); cur = null; }
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el && el !== cur) { cur = el; show(el); }
  });
  document.addEventListener('mouseout', function (e) {
    var el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el && el === cur) hide();
  });
})();

renderQueue();
(function () {
  var saved = loadToken && loadToken();
  if (saved && saved.indexOf('eyJ') === 0) { token = saved; markConnected('guardado'); log('Sesión restaurada.'); }
  else { $('configPanel').style.display = 'block'; }
})();
try { $('versionLabel').textContent = 'v' + APP_VERSION; } catch (e) {}
try { loadProjectQueue(); } catch (e) {}
try { setTimeout(checkUpdate, 1200); } catch (e) {}
// restaurar contador de límite si sigue vigente
(function () { var l = loadLimit && loadLimit(); if (l && l.retryAt && l.retryAt > Date.now()) { showLimit(l.retryAt, l.reported || Date.now()); log('Límite activo restaurado.'); } })();
