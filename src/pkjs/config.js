/* Settings page as a self-contained data: URI — nothing to host. */
module.exports = function configPage(saved) {
  var html =
    '<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Voice Relay</title>' +
    '<style>body{font:16px -apple-system,system-ui,sans-serif;margin:16px}' +
    'label{display:block;margin:16px 0 4px;font-weight:600}' +
    'input,textarea{width:100%;box-sizing:border-box;padding:8px;font:inherit}' +
    'button{margin-top:24px;padding:12px;width:100%;font:inherit}' +
    'p{color:#666;font-size:14px;margin:4px 0 0}</style>' +
    '<label for="url">Endpoint URL</label>' +
    '<input id="url" type="url" placeholder="https://example.com/voice">' +
    '<p>Receives <code>{"text": "..."}</code>, must answer <code>{"response": "..."}</code>.</p>' +
    '<label for="headers">Headers</label>' +
    '<textarea id="headers" rows="5" placeholder="Authorization: Bearer ..."></textarea>' +
    '<p>One per line, <code>Name: value</code>.</p>' +
    '<button id="save">Save</button>' +
    '<script>' +
    'var saved = ' + JSON.stringify(saved || {}) + ';' +
    'var url = document.getElementById("url");' +
    'var headers = document.getElementById("headers");' +
    'url.value = saved.url || "";' +
    'headers.value = saved.headers || "";' +
    'document.getElementById("save").onclick = function () {' +
    '  location.href = "pebblejs://close#" + encodeURIComponent(JSON.stringify(' +
    '    { url: url.value.trim(), headers: headers.value }));' +
    '};' +
    '<\/script>';

  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
};
