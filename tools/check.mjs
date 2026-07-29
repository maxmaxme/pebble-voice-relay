/* Self-checks for the logic worth checking. Run: node tools/check.mjs */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
import wrap from "../src/embeddedjs/wrap.js";

const require = createRequire(import.meta.url);

// Kept because the fakes below replace the global console.
const report = console.log.bind(console);

/* --- wrap.js: one char per pixel keeps expectations obvious --- */

const measure = (s) => s.length;

assert.deepEqual(wrap("hello", 10, measure), ["hello"]);
assert.deepEqual(wrap("hello there world", 11, measure), ["hello there", "world"]);
assert.deepEqual(wrap("a\nb", 10, measure), ["a", "b"]);
assert.deepEqual(wrap("aaaaaaaa", 3, measure), ["aaa", "aaa", "aa"]);
assert.deepEqual(wrap("hi aaaaaa", 3, measure), ["hi", "aaa", "aaa"]);
assert.deepEqual(wrap("", 10, measure), [""]);

/* --- headers.js --- */

const parseHeaders = require("../src/pkjs/headers.js");

assert.deepEqual(parseHeaders("Authorization: Bearer x"), { Authorization: "Bearer x" });
assert.deepEqual(parseHeaders("A: 1\nB: 2"), { A: "1", B: "2" });
assert.deepEqual(parseHeaders("A: http://x:8080/y"), { A: "http://x:8080/y" });
assert.deepEqual(parseHeaders("junk\n\n: novalue\nA: 1"), { A: "1" });
assert.deepEqual(parseHeaders(undefined), {});

/* --- config.js: the page is assembled as a string, so check its wiring --- */

const configPage = require("../src/pkjs/config.js");
const page = decodeURIComponent(
  configPage({ url: "https://x/y", headers: "A: 1" }).replace("data:text/html;charset=utf-8,", "")
);

assert.match(page, /fetch\(/, "Test must post from the page itself");
assert.doesNotMatch(page, /close\(true\)/, "Test must not close the settings page");
assert.match(page, /pebblejs:\/\/close#/, "Save must hand settings back to pkjs");
assert.match(page, /"https:\/\/x\/y"/, "saved url must be prefilled");

/* --- pkjs/index.js: the branchy part, driven through fake host objects --- */

const KEYS = { text: 10000, reply: 10001, error: 10002 };

function loadPkjs(xhrFactory) {
  const sent = [];
  const logged = [];
  const listeners = {};
  const store = {};

  const realLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    request === "message_keys" ? KEYS : realLoad(request, parent, isMain);

  const globals = {
    console: { log: (line) => logged.push(line) },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = v;
      },
    },
    XMLHttpRequest: xhrFactory,
    Pebble: {
      addEventListener: (event, fn) => {
        listeners[event] = fn;
      },
      sendAppMessage: (payload, ok) => {
        sent.push(payload);
        ok?.();
      },
      openURL: () => {},
    },
  };

  // Left installed on purpose: the listeners run after this returns, and each
  // loadPkjs call replaces them with its own.
  Object.assign(globalThis, globals);

  try {
    delete require.cache[require.resolve("../src/pkjs/index.js")];
    require("../src/pkjs/index.js");
  } finally {
    Module._load = realLoad;
  }

  return { sent, logged, fire: (event, e) => listeners[event](e), store };
}

function fakeXhr({ status, body, fail }) {
  const calls = [];
  function Xhr() {
    this.headers = {};
    calls.push(this);
  }
  Xhr.prototype.open = function (method, url) {
    this.method = method;
    this.url = url;
  };
  Xhr.prototype.setRequestHeader = function (name, value) {
    this.headers[name] = value;
  };
  Xhr.prototype.send = function (payload) {
    this.body = payload;
    if (fail) {
      this.status = 0;
      this.onerror();
      return;
    }
    this.status = status;
    this.responseText = body;
    this.onload();
  };
  Xhr.calls = calls;
  return Xhr;
}

function configure(app, url) {
  app.fire("webviewclosed", {
    response: encodeURIComponent(JSON.stringify({ url, headers: "Authorization: Bearer t" })),
  });
}

// The handshake must be answered, or the watch can never send anything.
{
  const app = loadPkjs(fakeXhr({ status: 200, body: "{}" }));
  app.fire("appmessage", { payload: { 15025: 1 } });
  assert.deepEqual(app.sent, [{ 15025: 1 }], "handshake must be echoed back");
}

// A transcript with no endpoint configured reports that, and sends no request.
{
  const Xhr = fakeXhr({ status: 200, body: "{}" });
  const app = loadPkjs(Xhr);
  app.fire("appmessage", { payload: { 10000: "hello" } });
  assert.equal(Xhr.calls.length, 0, "must not call out without a url");
  assert.equal(Object.keys(app.sent[0])[0], String(KEYS.error));
}

// The happy path: transcript out, reply back.
{
  const Xhr = fakeXhr({ status: 200, body: JSON.stringify({ response: "hi there" }) });
  const app = loadPkjs(Xhr);
  configure(app, "https://example.com/voice");
  app.fire("appmessage", { payload: { 10000: "привет" } });

  assert.equal(Xhr.calls.length, 1);
  assert.equal(Xhr.calls[0].method, "POST");
  assert.equal(Xhr.calls[0].url, "https://example.com/voice");
  assert.equal(Xhr.calls[0].headers["Content-Type"], "application/json");
  assert.equal(Xhr.calls[0].headers.Authorization, "Bearer t");
  assert.deepEqual(JSON.parse(Xhr.calls[0].body), { text: "привет" });
  assert.deepEqual(app.sent[0], { [KEYS.reply]: "hi there" });
}

// A non-2xx reply carries the server's own explanation to the watch.
{
  const app = loadPkjs(fakeXhr({ status: 415, body: '{"error":"Expected form data"}' }));
  configure(app, "https://example.com/voice");
  app.fire("appmessage", { payload: { 10000: "hello" } });

  const shown = app.sent[0][KEYS.error];
  assert.match(shown, /^HTTP 415/);
  assert.match(shown, /Expected form data/);
}

// 200 with a body that is not JSON must not look like a reply.
{
  const app = loadPkjs(fakeXhr({ status: 200, body: "<html>nope</html>" }));
  configure(app, "https://example.com/voice");
  app.fire("appmessage", { payload: { 10000: "hello" } });
  assert.deepEqual(app.sent[0], { [KEYS.error]: "Response was not JSON." });
}

// A transport failure is reported rather than swallowed.
{
  const app = loadPkjs(fakeXhr({ fail: true }));
  configure(app, "https://example.com/voice");
  app.fire("appmessage", { payload: { 10000: "hello" } });
  assert.deepEqual(app.sent[0], { [KEYS.error]: "Network error." });
}

// Logs must stay ASCII: libpebble2 crashes on a multi-byte char cut in half.
{
  const app = loadPkjs(fakeXhr({ status: 500, body: "ошибка сервера" }));
  configure(app, "https://пример.рф/voice");
  app.fire("appmessage", { payload: { 10000: "привет" } });

  for (const line of app.logged) {
    assert.match(line, /^[\x20-\x7e]*$/, "log line must be ASCII: " + line);
  }
  assert.ok(
    app.logged.some((l) => /transcript: 6 chars/.test(l)),
    "transcript must be logged as a length, never verbatim"
  );
}

report("ok");
