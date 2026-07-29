var keys = require('message_keys');
var parseHeaders = require('./headers');
var configPage = require('./config');

var SETTINGS = 'voiceRelaySettings';

function settings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS)) || {};
  } catch (e) {
    return {};
  }
}

function reply(text) {
  var payload = {};
  payload[keys.reply] = text;
  Pebble.sendAppMessage(payload);
}

function fail(text) {
  var payload = {};
  payload[keys.error] = text;
  Pebble.sendAppMessage(payload);
}

function relay(text) {
  var config = settings();
  if (!config.url) {
    fail('No endpoint set.\n\nOpen app settings on the phone.');
    return;
  }

  var xhr = new XMLHttpRequest();
  xhr.open('POST', config.url);
  xhr.timeout = 30000;
  xhr.setRequestHeader('Content-Type', 'application/json');

  var headers = parseHeaders(config.headers);
  Object.keys(headers).forEach(function (name) {
    xhr.setRequestHeader(name, headers[name]);
  });

  xhr.onload = function () {
    if (xhr.status < 200 || xhr.status >= 300) {
      fail('HTTP ' + xhr.status);
      return;
    }
    try {
      reply(JSON.parse(xhr.responseText).response || 'Empty response.');
    } catch (e) {
      fail('Response was not JSON.');
    }
  };
  xhr.ontimeout = function () {
    fail('Request timed out.');
  };
  xhr.onerror = function () {
    fail('Network error.');
  };

  xhr.send(JSON.stringify({ text: text }));
}

Pebble.addEventListener('appmessage', function (e) {
  var text = e.payload.text || e.payload[keys.text];
  if (text) {
    relay(text);
  }
});

Pebble.addEventListener('showConfiguration', function () {
  Pebble.openURL(configPage(settings()));
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (e.response) {
    localStorage.setItem(SETTINGS, decodeURIComponent(e.response));
  }
});
