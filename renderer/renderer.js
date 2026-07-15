// renderer.js — lógica de la UI
const $ = (id) => document.getElementById(id);
const S = window.api.STATES;      // contrato de estados compartido con el motor
let queue = [];          // [{ path, name, state, pct, error, el }]
let connected = false;
let processing = false;
let settings = { cleanVoice: 80, model: 'v2' };
let limitTimer = null;
let lastOutPath = null;

const basename = (p) => p.split(/[/\\]/).pop();

async function init() {
  settings = await window.api.getSettings();
  if (settings.cleanVoice == null) settings.cleanVoice = 80;
  $('cleanVoice').value = settings.cleanVoice;
  updateCleanUI(settings.cleanVoice);
  $('cleanVoice').addEventListener('input', () => {
    settings.cleanVoice = Number($('cleanVoice').value);
    updateCleanUI(settings.cleanVoice);
    window.api.saveSettings(settings);
  });
  refreshConn(await window.api.tokenStatus());

  // restaura la cola guardada (los no-terminados vuelven a "en espera")
  try {
    const saved = await window.api.getQueue();
    queue = (saved || []).map(x => ({
      path: x.path, name: x.name || basename(x.path),
      state: x.state === S.LISTO ? S.LISTO : S.EN_ESPERA,
      pct: x.state === S.LISTO ? 100 : 0,
    }));
  } catch {}

  $('connectBtn').onclick = onConnect;
  $('addFiles').onclick = async () => addToQueue(await window.api.pickFiles());
  $('addFolder').onclick = async () => addToQueue(await window.api.pickFolder());
  $('clearBtn').onclick = () => { if (!processing) { queue = []; lastOutPath = null; $('openFolderBtn').style.display = 'none'; renderAll(); saveQueue(); } };
  $('startBtn').onclick = start;
  $('stopBtn').onclick = () => { window.api.stopBatch(); $('stopBtn').textContent = 'Deteniendo…'; };
  $('openFolderBtn').onclick = () => { if (lastOutPath) window.api.reveal(lastOutPath); };

  // eventos desde main
  window.api.onStatus(({ filePath, state, pct }) => updateItem(filePath, { state, pct }));
  window.api.onDone(({ filePath, ok, error, outPath }) => {
    updateItem(filePath, ok ? { state: S.LISTO, pct: 100, outPath } : { state: S.ERROR, error });
    if (ok && outPath) lastOutPath = outPath;
    bumpOverall();
    saveQueue();
  });
  window.api.onConn((r) => refreshConn(r));
  window.api.onAuthExpired(() => { connected = false; refreshConn({ connected: false }); });
  window.api.onLimit(({ seconds }) => showLimit(seconds));
  window.api.onLimitClear(() => hideLimit());

  // clic en un ítem terminado → abrir su carpeta
  $('queue').addEventListener('click', (e) => {
    const li = e.target.closest('.item');
    if (!li) return;
    const it = queue.find(q => q.el === li);
    if (it && it.state === S.LISTO && it.outPath) window.api.reveal(it.outPath);
  });

  setupDrop();
  renderAll();
}

function updateCleanUI(v) {
  $('cleanVal').textContent = v + '%';
  if (Number(v) >= 100) {
    $('cleanHint').innerHTML = 'Voz 100% limpia → sale directo en <code>Enhanced/</code>.';
  } else {
    $('cleanHint').innerHTML = `Mezcla ${v}% limpia + ${100 - v}% original → sale en <code>Enhanced/</code>. La voz 100% limpia se guarda en <code>Enhanced/Clean voice/</code>.`;
  }
}

async function onConnect() {
  $('connectBtn').textContent = 'Abriendo…';
  const r = await window.api.connectAdobe();
  refreshConn(r);
}
function refreshConn(r) {
  connected = !!(r && r.connected);
  $('dot').classList.toggle('on', connected);
  $('connText').textContent = connected ? (r.email || 'Conectado') : 'Desconectado';
  $('connectBtn').textContent = connected ? 'Reconectar' : 'Conectar con Adobe';
  updateStart();
}

function addToQueue(paths) {
  for (const p of paths) {
    if (!queue.find(q => q.path === p)) queue.push({ path: p, name: basename(p), state: S.EN_ESPERA, pct: 0 });
  }
  renderAll();
  saveQueue();
}
// Persiste la cola (solo path/name/estado terminal) para sobrevivir al cierre.
function saveQueue() {
  try {
    window.api.saveQueue(queue.map(q => ({
      path: q.path, name: q.name, state: q.state === S.LISTO ? S.LISTO : 'pendiente',
    })));
  } catch {}
}
function updateStart() { $('startBtn').disabled = processing || !connected || queue.length === 0; }

let doneCount = 0, totalToDo = 0;
async function start() {
  if (processing) return;
  const pending = queue.filter(q => q.state !== S.LISTO);
  if (!pending.length) return;
  processing = true; doneCount = 0; totalToDo = pending.length;
  $('stopBtn').style.display = ''; $('stopBtn').textContent = '■ Detener';
  updateStart();
  pending.forEach(it => { it.state = S.EN_COLA; it.error = null; renderItem(it); });
  await window.api.startBatch({ files: pending.map(p => p.path), cleanVoice: settings.cleanVoice, model: settings.model });
  processing = false;
  $('stopBtn').style.display = 'none';
  if (lastOutPath) $('openFolderBtn').style.display = '';
  updateStart();
}
function bumpOverall() {
  doneCount++;
  $('overallBar').style.width = totalToDo ? Math.round((doneCount / totalToDo) * 100) + '%' : '0%';
}

// ─── límite de créditos ───
function showLimit(seconds) {
  let remain = seconds;
  const tick = () => {
    if (remain <= 0) { hideLimit(); return; }
    const m = Math.floor(remain / 60), s = remain % 60;
    $('limitText').textContent = `Sin créditos de Adobe. Reanudo en ${m}:${String(s).padStart(2, '0')} …`;
    remain--;
  };
  $('limitBanner').style.display = '';
  clearInterval(limitTimer); tick(); limitTimer = setInterval(tick, 1000);
}
function hideLimit() { clearInterval(limitTimer); limitTimer = null; $('limitBanner').style.display = 'none'; }

// ─── render en sitio (sin reconstruir toda la lista) ───
function stateClass(s) {
  if (s === S.LISTO) return 'done';
  if (s === S.ERROR) return 'error';
  if ([S.SUBIENDO, S.PROCESANDO, S.DESCARGANDO, S.EN_COLA, S.ESPERANDO].includes(s)) return 'working';
  return '';
}
function stateIcon(s) {
  return {
    [S.LISTO]: '✅', [S.ERROR]: '⚠️', [S.SUBIENDO]: '↑', [S.PROCESANDO]: '⚙️',
    [S.DESCARGANDO]: '↓', [S.EN_COLA]: '…', [S.ESPERANDO]: '⏳', [S.EN_ESPERA]: '•',
  }[s] || '•';
}
// Construye el contenido del <li> con textContent (los nombres de archivo no son HTML confiable).
function fillItem(li, it) {
  li.textContent = '';
  const ico = document.createElement('span');
  ico.className = 'ico'; ico.textContent = stateIcon(it.state);
  const name = document.createElement('span');
  name.className = 'name'; name.textContent = it.name; name.title = it.path;
  const state = document.createElement('span');
  state.className = 'state';
  state.textContent = it.error ? S.ERROR : (it.state === S.PROCESANDO && it.pct ? `procesando ${it.pct}%` : it.state);
  if (it.error) state.title = it.error;
  li.append(ico, name, state);
}
function renderItem(it) {
  if (!it.el) return renderAll();
  it.el.className = 'item ' + stateClass(it.state);
  fillItem(it.el, it);
}
function updateItem(filePath, patch) {
  const it = queue.find(q => q.path === filePath);
  if (!it) return;
  Object.assign(it, patch);
  renderItem(it);
}
function renderAll() {
  $('queueCount').textContent = `${queue.length} archivo${queue.length === 1 ? '' : 's'}`;
  $('dropHint').style.display = queue.length ? 'none' : 'block';
  const ul = $('queue'); ul.innerHTML = '';
  for (const it of queue) {
    const li = document.createElement('li');
    li.className = 'item ' + stateClass(it.state);
    fillItem(li, it);
    it.el = li;
    ul.appendChild(li);
  }
  updateStart();
}

function setupDrop() {
  const b = document.body;
  b.addEventListener('dragover', (e) => { e.preventDefault(); b.classList.add('dragging'); });
  b.addEventListener('dragleave', (e) => { if (e.target === b) b.classList.remove('dragging'); });
  b.addEventListener('drop', (e) => {
    e.preventDefault(); b.classList.remove('dragging');
    // File.path no existe desde Electron 32: la ruta la resuelve el preload (webUtils)
    const paths = [...e.dataTransfer.files].map(f => window.api.pathForFile(f)).filter(Boolean);
    if (paths.length) addToQueue(paths);
  });
}

init();
