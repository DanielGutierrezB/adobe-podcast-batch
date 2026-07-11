// renderer.js — lógica de la UI
const $ = (id) => document.getElementById(id);
let queue = [];          // [{ path, name, state, pct, error, el }]
let connected = false;
let processing = false;
let settings = { mix: { speech: 80, music: 0, background: 0 }, model: 'v2' };
let limitTimer = null;

const basename = (p) => p.split('/').pop();

async function init() {
  settings = await window.api.getSettings();
  ['speech', 'music', 'background'].forEach(k => {
    $(k).value = settings.mix[k];
    $(k + 'Val').textContent = settings.mix[k] + '%';
    $(k).addEventListener('input', () => {
      settings.mix[k] = Number($(k).value);
      $(k + 'Val').textContent = $(k).value + '%';
      window.api.saveSettings(settings);
    });
  });
  refreshConn(await window.api.tokenStatus());

  $('connectBtn').onclick = onConnect;
  $('addFiles').onclick = async () => addToQueue(await window.api.pickFiles());
  $('addFolder').onclick = async () => addToQueue(await window.api.pickFolder());
  $('clearBtn').onclick = () => { if (!processing) { queue = []; renderAll(); } };
  $('startBtn').onclick = start;
  $('stopBtn').onclick = () => { window.api.stopBatch(); $('stopBtn').textContent = 'Deteniendo…'; };

  // eventos desde main
  window.api.onStatus(({ filePath, state, pct }) => updateItem(filePath, { state, pct }));
  window.api.onDone(({ filePath, ok, error }) => {
    updateItem(filePath, ok ? { state: 'listo', pct: 100 } : { state: 'error', error });
    bumpOverall();
  });
  window.api.onConn((r) => refreshConn(r));
  window.api.onAuthExpired(() => { connected = false; refreshConn({ connected: false }); });
  window.api.onLimit(({ seconds }) => showLimit(seconds));
  window.api.onLimitClear(() => hideLimit());

  setupDrop();
  renderAll();
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
    if (!queue.find(q => q.path === p)) queue.push({ path: p, name: basename(p), state: 'en espera', pct: 0 });
  }
  renderAll();
}
function updateStart() { $('startBtn').disabled = processing || !connected || queue.length === 0; }

let doneCount = 0, totalToDo = 0;
async function start() {
  if (processing) return;
  const pending = queue.filter(q => q.state !== 'listo');
  if (!pending.length) return;
  processing = true; doneCount = 0; totalToDo = pending.length;
  $('stopBtn').style.display = ''; $('stopBtn').textContent = '■ Detener';
  updateStart();
  pending.forEach(it => { it.state = 'en cola'; it.error = null; renderItem(it); });
  await window.api.startBatch({ files: pending.map(p => p.path), mix: settings.mix, model: settings.model });
  processing = false;
  $('stopBtn').style.display = 'none';
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
  if (s === 'listo') return 'done';
  if (s === 'error') return 'error';
  if (['subiendo', 'procesando', 'descargando', 'en cola', 'esperando'].includes(s)) return 'working';
  return '';
}
function stateIcon(s) {
  return { 'listo': '✅', 'error': '⚠️', 'subiendo': '↑', 'procesando': '⚙️', 'descargando': '↓',
    'en cola': '…', 'esperando': '⏳', 'en espera': '•' }[s] || '•';
}
function itemHTML(it) {
  const label = it.error ? 'error' : (it.state === 'procesando' && it.pct ? `procesando ${it.pct}%` : it.state);
  return `<span class="ico">${stateIcon(it.state)}</span>
    <span class="name" title="${it.path}">${it.name}</span>
    <span class="state">${label}</span>`;
}
function renderItem(it) {
  if (!it.el) return renderAll();
  it.el.className = 'item ' + stateClass(it.state);
  it.el.innerHTML = itemHTML(it);
  if (it.error) it.el.querySelector('.state').title = it.error;
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
    li.innerHTML = itemHTML(it);
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
    const paths = [...e.dataTransfer.files].map(f => f.path).filter(Boolean);
    if (paths.length) addToQueue(paths);
  });
}

init();
