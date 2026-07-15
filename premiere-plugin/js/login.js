// login.js — ventana de login de Adobe (extensión .login del bundle, tipo ModalDialog).
// window.open() no está soportado en CEP (Adobe lo bloquea por diseño); la vía
// oficial para flujos de login/SSO es una extensión separada declarada en el
// manifest, que CEP abre como ventana nativa propia (no pasa por el
// bloqueador de popups de Chromium). Acá adentro sí podemos usar un iframe
// porque no hace falta que el usuario clickee nada del panel — todo el
// documento es esta ventana.
var cs = new CSInterface();
var _require = (typeof require !== 'undefined') ? require : (window.cep_node ? window.cep_node.require : null);
var TOKEN_EVENT = 'com.danielgutierrez.adobepodcastpremiere.tokenReady';

function $(id) { return document.getElementById(id); }

function saveTokenFile(tok) {
  try {
    var pathN = _require('path'), fsN = _require('fs'), osN = _require('os');
    fsN.writeFileSync(pathN.join(osN.homedir(), '.adobe-podcast-premiere-token'), tok, 'utf8');
  } catch (e) {}
}

function broadcastToken(tok) {
  try {
    var ev = new CSEvent(TOKEN_EVENT, 'APPLICATION');
    ev.data = tok;
    cs.dispatchEvent(ev);
  } catch (e) {}
}

function closeSelf() {
  try { cs.closeExtension(); } catch (e) { try { window.close(); } catch (e2) {} }
}

var poll = setInterval(function () {
  try {
    var w = $('adobeFrame').contentWindow;
    var t = w && w.adobeIMS && w.adobeIMS.getAccessToken && w.adobeIMS.getAccessToken();
    var tok = t && (t.token || t.tokenValue);
    if (tok && tok.indexOf('eyJ') === 0) {
      clearInterval(poll);
      $('status').textContent = 'Conectado ✓';
      saveTokenFile(tok);
      broadcastToken(tok);
      setTimeout(closeSelf, 600);
    }
  } catch (e) {}
}, 1500);

$('cancelBtn').addEventListener('click', function () { clearInterval(poll); closeSelf(); });
