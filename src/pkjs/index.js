var keys = require('message_keys');
var parseHeaders = require('./headers');
var trim = require('./trim');
var configPage = require('./config');

var SETTINGS = 'voiceRelaySettings';

// The watch's message module opens its outbound channel only after the phone
// answers this handshake key; until then it cannot send anything.
var HANDSHAKE = 15025;

function log(message) {
  console.log('[relay] ' + message);
}

/* Non-ASCII in a log line can be cut mid-character by the log buffer, which
   crashes the libpebble2 log reader. Keep log payloads plain. */
function safe(text, limit) {
  return String(text).replace(/[^\x20-\x7e]/g, '.').slice(0, limit || 200);
}

function settings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS)) || {};
  } catch (e) {
    log('settings unreadable: ' + e.message);
    return {};
  }
}

// The watch opens an 8K inbox; leave room for the dictionary framing.
var MAX_REPLY_BYTES = 8000;

/* One conversation per app launch. The endpoint chains turns that share an id,
   so a follow-up dictation ("yes, send it") is understood instead of arriving
   context-free, while relaunching the app drops a stale topic. PebbleKit JS
   starts and dies with the watchapp, so a module-level value is exactly that
   lifetime. */
var conversationId =
  'pebble-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);

function send(key, text, what) {
  var payload = {};
  payload[key] = trim(text, MAX_REPLY_BYTES);
  Pebble.sendAppMessage(payload, function () {
    log(what + ' delivered to watch');
  }, function (e) {
    log(what + ' NOT delivered: ' + JSON.stringify(e));
    if (key !== keys.error) {
      send(keys.error, 'The watch could not accept the reply.', 'error');
    }
  });
}

function relay(text) {
  var config = settings();
  log('transcript: ' + text.length + ' chars');

  if (!config.url) {
    log('no url configured');
    send(keys.error, 'No endpoint set.\n\nOpen app settings on the phone.', 'error');
    return;
  }

  var headers = parseHeaders(config.headers);
  var names = Object.keys(headers);
  log('POST ' + safe(config.url) + ' headers=' + (names.length ? safe(names.join(',')) : '(none)'));

  var xhr = new XMLHttpRequest();
  xhr.open('POST', config.url);
  xhr.timeout = 30000;
  xhr.setRequestHeader('Content-Type', 'application/json');
  Object.keys(headers).forEach(function (name) {
    xhr.setRequestHeader(name, headers[name]);
  });

  xhr.onload = function () {
    log('HTTP ' + xhr.status + ', ' + xhr.responseText.length + ' bytes');
    if (xhr.status < 200 || xhr.status >= 300) {
      log('body: ' + safe(xhr.responseText, 300));
      send(keys.error, 'HTTP ' + xhr.status + '\n\n' + xhr.responseText.slice(0, 200), 'error');
      return;
    }
    try {
      send(keys.reply, JSON.parse(xhr.responseText).response || 'Empty response.', 'reply');
    } catch (e) {
      log('body was not JSON: ' + safe(xhr.responseText, 120));
      send(keys.error, 'Response was not JSON.', 'error');
    }
  };
  xhr.ontimeout = function () {
    log('timed out after 30s');
    send(keys.error, 'Request timed out.', 'error');
  };
  xhr.onerror = function () {
    log('network error (status ' + xhr.status + ')');
    send(keys.error, 'Network error.', 'error');
  };

  xhr.send(JSON.stringify({ text: text, conversation_id: conversationId }));
}

Pebble.addEventListener('ready', function () {
  var config = settings();
  log('ready, keys text=' + keys.text + ' reply=' + keys.reply + ' error=' + keys.error);
  log(config.url ? 'endpoint: ' + safe(config.url) : 'no endpoint configured yet');
});

Pebble.addEventListener('appmessage', function (e) {
  log('appmessage in: keys ' + Object.keys(e.payload).join(','));

  if (e.payload[HANDSHAKE] !== undefined) {
    var ack = {};
    ack[HANDSHAKE] = 1;
    Pebble.sendAppMessage(ack, function () {
      log('handshake answered, watch can send now');
    }, function (err) {
      log('handshake answer failed: ' + JSON.stringify(err));
    });
    return;
  }

  var text = e.payload.text || e.payload[keys.text];
  if (text) {
    relay(text);
  } else {
    log('no transcript in payload, ignoring');
  }
});

Pebble.addEventListener('showConfiguration', function () {
  log('opening settings');
  Pebble.openURL(configPage(settings()));
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e.response) {
    log('settings closed without saving');
    return;
  }

  localStorage.setItem(SETTINGS, decodeURIComponent(e.response));
  log('settings saved: ' + safe(decodeURIComponent(e.response)));
});
