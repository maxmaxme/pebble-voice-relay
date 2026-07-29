/* Settings page as a self-contained data: URI — nothing to host. */
module.exports = function configPage(saved) {
  var html =
    '<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Voice Relay</title>' +
    '<style>body{font:16px -apple-system,system-ui,sans-serif;margin:16px}' +
    'label{display:block;margin:16px 0 4px;font-weight:600}' +
    'input,textarea{width:100%;box-sizing:border-box;padding:8px;font:inherit}' +
    'button{margin-top:12px;padding:12px;width:100%;font:inherit}' +
    'p{color:#666;font-size:14px;margin:4px 0 0}' +
    '#result{white-space:pre-wrap;word-break:break-word;background:#f2f2f2;' +
    'padding:8px;margin-top:12px;font:13px ui-monospace,monospace}</style>' +
    '<label for="url">Endpoint URL</label>' +
    '<input id="url" type="url" placeholder="https://example.com/voice">' +
    '<p>Receives <code>{"text": "..."}</code>, must answer <code>{"response": "..."}</code>.</p>' +
    '<label for="headers">Headers</label>' +
    '<textarea id="headers" rows="5" placeholder="Authorization: Bearer ..."></textarea>' +
    '<p>One per line, <code>Name: value</code>.</p>' +
    '<button id="test">Test</button>' +
    '<p>Posts the word "test" using the fields above, without saving them.</p>' +
    '<button id="save">Save</button>' +
    '<div id="result" hidden></div>' +
    '<script>' +
    'var saved = ' + JSON.stringify(saved || {}) + ';' +
    'var url = document.getElementById("url");' +
    'var headers = document.getElementById("headers");' +
    'var result = document.getElementById("result");' +
    'url.value = saved.url || "";' +
    'headers.value = saved.headers || "";' +
    'function say(text) { result.hidden = false; result.textContent = text; }' +
    'function parseHeaders(text) {' +
    '  var out = {};' +
    '  (text || "").split("\\n").forEach(function (line) {' +
    '    var i = line.indexOf(":");' +
    '    if (i < 1) return;' +
    '    var name = line.slice(0, i).trim();' +
    '    if (name) out[name] = line.slice(i + 1).trim();' +
    '  });' +
    '  return out;' +
    '}' +
    'document.getElementById("test").onclick = function () {' +
    '  if (!url.value.trim()) return say("Enter a URL first.");' +
    '  say("Posting \\"test\\"...");' +
    '  var h = parseHeaders(headers.value);' +
    '  h["Content-Type"] = "application/json";' +
    '  fetch(url.value.trim(), { method: "POST", headers: h,' +
    '    body: JSON.stringify({ text: "test" }) })' +
    '    .then(function (r) { return r.text().then(function (body) {' +
    '      var shown;' +
    '      try {' +
    '        var parsed = JSON.parse(body);' +
    '        shown = parsed.response !== undefined' +
    '          ? "response: " + parsed.response' +
    '          : "no \\"response\\" field:\\n" + body;' +
    '      } catch (e) { shown = "not JSON:\\n" + body; }' +
    '      say("HTTP " + r.status + "\\n\\n" + shown);' +
    '    }); })' +
    '    .catch(function (e) { say("Request failed: " + e.message); });' +
    '};' +
    'document.getElementById("save").onclick = function () {' +
    '  location.href = "pebblejs://close#" + encodeURIComponent(JSON.stringify(' +
    '    { url: url.value.trim(), headers: headers.value }));' +
    '};' +
    '<\/script>';

  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
};
