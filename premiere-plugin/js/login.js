// login.js — ventana modal de login de Adobe (extensión .login del bundle).
// Al ser una ventana top-level propia (ModalDialog CEP), los clics y el teclado
// llegan directo a la página de Adobe: Premiere no intercepta sus shortcuts.
// Cuando aparece el token lo persiste, se lo avisa al panel por CSEvent y se cierra.
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
