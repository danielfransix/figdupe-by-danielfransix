import { toBinary } from '@divriots/c2d-sdk';

var LINK_URL = 'ws://localhost:7331';

var dot   = document.getElementById('dot');
var label = document.getElementById('label');
var sub   = document.getElementById('sub');
var hint  = document.getElementById('hint');

var ws            = null;
var retryTimer    = null;
var retryAttempt  = 0;
var pendingMsgs   = [];
var fileInfo      = null; // { fileKey, fileName } from code.js

// ── OS detection ──────────────────────────────────────────────────────────
var platform = (navigator.platform  || '').toUpperCase();
var ua       = (navigator.userAgent || '').toUpperCase();
var isMac    = platform.includes('MAC')     || ua.includes('MAC');
var isWin    = platform.includes('WIN')     || ua.includes('WINDOWS');

if (isMac) {
  document.getElementById('osMac').classList.add('active');
  document.getElementById('actionMac').classList.add('active');
} else if (isWin) {
  document.getElementById('osWin').classList.add('active');
  document.getElementById('actionWin').classList.add('active');
} else {
  document.getElementById('osMac').classList.add('active');
  document.getElementById('actionMac').classList.add('active');
  document.getElementById('osWin').classList.add('active');
  document.getElementById('actionWin').classList.add('active');
}

// ── State helpers ─────────────────────────────────────────────────────────
function setState(state, text, detail) {
  dot.className    = 'dot ' + state;
  label.textContent = text;
  if (detail !== undefined) sub.textContent = detail;
}

// ── WebSocket ─────────────────────────────────────────────────────────────
function connect() {
  clearTimeout(retryTimer);
  if (ws) { try { ws.close(); } catch (_) {} }

  setState('connecting', 'Connecting…', 'Waiting for figdupe server…');
  hint.classList.add('visible');

  ws = new WebSocket(LINK_URL);

  ws.onopen = function() {
    retryAttempt = 0;
    ws.send(JSON.stringify({ type: 'register', role: 'plugin', ...(fileInfo || {}) }));
    pendingMsgs.forEach(function(m) { ws.send(JSON.stringify(m)); });
    pendingMsgs = [];
  };

  ws.onmessage = function(event) {
    var msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'registered') {
      var detail = fileInfo ? fileInfo.fileName + ' · ready for commands' : 'Linked · ready for commands';
      setState('connected', 'Connected', detail);
      hint.classList.remove('visible');
      return;
    }

    // If it's a command to create C2D tree, intercept and convert images to binary before sending to code.js!
    if (msg.command === 'create_c2d_tree' && msg.params && msg.params.images) {
      try {
        msg.params.images = toBinary(msg.params.images);
      } catch (e) {
        console.error("Failed to convert images to binary:", e);
      }
    }

    // Forward all other messages (commands) to code.js
    parent.postMessage({ pluginMessage: msg }, '*');
  };

  ws.onerror = function() {
    setState('error', 'Server not running', 'Start the server first');
    hint.classList.add('visible');
  };

  ws.onclose = function() {
    if (dot.className.includes('connected')) {
      setState('connecting', 'Reconnecting…', 'Server stopped');
      hint.classList.add('visible');
    }
    clearTimeout(retryTimer);
    // Exponential backoff with jitter: 2.5s → 5s → 10s → 20s → 30s max
    var delay = Math.min(30000, 2500 * Math.pow(2, retryAttempt)) + Math.floor(Math.random() * 500);
    retryAttempt++;
    retryTimer = setTimeout(connect, delay);
  };
}

// Results from code.js → WebSocket → server → AI client
window.onmessage = function(event) {
  var msg = event.data && event.data.pluginMessage;
  if (!msg) return;

  // File identity sent by code.js on plugin load
  if (msg.type === 'file_info') {
    fileInfo = { fileKey: msg.fileKey, fileName: msg.fileName };
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'register', role: 'plugin', fileKey: msg.fileKey, fileName: msg.fileName }));
    }
    return;
  }

  if (msg.type === 'open_url') {
    parent.postMessage({ pluginMessage: msg }, '*');
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    if (pendingMsgs.length >= 10) {
      pendingMsgs.shift();
      setState('connecting', 'Reconnecting…', 'Buffer full — some messages may be lost');
    }
    pendingMsgs.push(msg);
  }
};

document.getElementById('xLink').addEventListener('click', function() {
  parent.postMessage({ pluginMessage: { type: 'open_url', url: 'https://x.com/danielfransix' } }, '*');
});
document.getElementById('coffeeLink').addEventListener('click', function() {
  parent.postMessage({ pluginMessage: { type: 'open_url', url: 'https://danielfransix.short.gy/buy-coffee' } }, '*');
});

// Resize plugin window to fit content
function sendSize() {
  parent.postMessage({ pluginMessage: { type: 'resize', w: 440, h: document.body.offsetHeight } }, '*');
}
if (window.ResizeObserver) {
  new ResizeObserver(sendSize).observe(document.body);
} else {
  sendSize();
}

connect();
