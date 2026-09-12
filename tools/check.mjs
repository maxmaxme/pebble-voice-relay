/* Self-checks for the logic worth checking. Run: node tools/check.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import Module from "node:module";
import wrap from "../src/embeddedjs/wrap.js";

const require = createRequire(import.meta.url);

// Kept because the fakes below replace the global console.
const report = console.log.bind(console);

/* --- wrap.js: one char per pixel keeps expectations obvious --- */

const measure = (s) => s.length;

// wrap() returns index pairs; cutting them is the watch's job, and the test's.
function lines(text, width) {
  const spans = wrap(text, width, measure);
  const out = [];
  for (let i = 0; i < spans.length; i += 2) {
    out.push(text.slice(spans[i], spans[i + 1]));
  }
  return out;
}

assert.deepEqual(lines("hello", 10), ["hello"]);
assert.deepEqual(lines("hello there world", 11), ["hello there", "world"]);
assert.deepEqual(lines("a\nb", 10), ["a", "b"]);
assert.deepEqual(lines("aaaaaaaa", 3), ["aaa", "aaa", "aa"]);
assert.deepEqual(lines("hi aaaaaa", 3), ["hi", "aaa", "aaa"]);
assert.deepEqual(lines("", 10), [""]);
assert.deepEqual(lines("a\n\nb", 10), ["a", "", "b"], "a blank line must survive");

/* The whole point of the index pairs: no per-line string, and no array of
   words either. An 8K reply used to hold over a thousand substrings alive at
   once, which is what killed the app on the watch. */
{
  const long = "lorem ipsum dolor sit amet consectetur adipiscing ".repeat(160);
  const spans = wrap(long, 188, (s) => s.length * 6);
  assert.ok(spans instanceof Uint16Array, "wrap must not go back to returning strings");
  assert.equal(spans.length % 2, 0, "spans come in start/end pairs");
  assert.ok(spans.length / 2 > 200, "the sample must actually wrap to many lines");
  // Spans are Uint16: past 65535 the indices would wrap and point at the wrong
  // characters, so the tail is dropped instead.
  const huge = "word ".repeat(14000);
  const capped = wrap(huge, 40, (s) => s.length);
  for (let i = 0; i < capped.length; i += 2) {
    assert.ok(capped[i] <= capped[i + 1], "no span may run backwards");
  }
  assert.ok(capped[capped.length - 1] <= 65535, "no span may address past the Uint16 limit");
  // Every line has to be reconstructible and within the budget.
  for (let i = 0; i < spans.length; i += 2) {
    assert.ok(spans[i] <= spans[i + 1], "a span must not run backwards");
    assert.ok(long.slice(spans[i], spans[i + 1]).length * 6 <= 188 || spans[i + 1] - spans[i] <= 1);
  }
}

/* --- headers.js --- */

const parseHeaders = require("../src/pkjs/headers.js");

assert.deepEqual(parseHeaders("Authorization: Bearer x"), { Authorization: "Bearer x" });
assert.deepEqual(parseHeaders("A: 1\nB: 2"), { A: "1", B: "2" });
assert.deepEqual(parseHeaders("A: http://x:8080/y"), { A: "http://x:8080/y" });
assert.deepEqual(parseHeaders("junk\n\n: novalue\nA: 1"), { A: "1" });
assert.deepEqual(parseHeaders(undefined), {});

/* --- main.js: it runs only on the watch, so at least catch dangling names.
   A missing constant there is a fatal TypeError that kills the app. --- */

const watchSource = readFileSync(new URL("../src/embeddedjs/main.js", import.meta.url), "utf8");
const declared = new Set(
  [...watchSource.matchAll(/(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
);
const imported = new Set([...watchSource.matchAll(/import\s+(\w+)/g)].map((m) => m[1]));
const shouty = new Set([...watchSource.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)].map((m) => m[1]));

for (const name of shouty) {
  assert.ok(
    declared.has(name) || imported.has(name),
    "main.js uses " + name + " without declaring it"
  );
}

/* --- trim.js: the inbox budget is bytes, strings are UTF-16 --- */

const trim = require("../src/pkjs/trim.js");

assert.equal(trim("hello", 10), "hello");
assert.equal(trim("hello", 5), "hello");
assert.equal(trim("hello", 4), "hell...");
// Cyrillic is two bytes per character, so eight bytes hold four of them.
assert.equal(trim("привет", 8), "прив...");
assert.equal(trim("привет", 12), "привет");
// A surrogate pair costs four bytes and must never be cut in half.
assert.equal(trim("ab😀", 5), "ab...");
assert.equal(trim("ab😀", 6), "ab😀");
assert.equal(trim("", 10), "");

/* --- config.js: the page is assembled as a string, so check its wiring --- */

const configPage = require("../src/pkjs/config.js");
const page = decodeURIComponent(
  configPage({ url: "https://x/y", headers: "A: 1" }).replace("data:text/html;charset=utf-8,", "")
);

assert.match(page, /fetch\(/, "Test must post from the page itself");
assert.doesNotMatch(page, /close\(true\)/, "Test must not close the settings page");
assert.match(page, /pebblejs:\/\/close#/, "Save must hand settings back to pkjs");
assert.match(page, /"https:\/\/x\/y"/, "saved url must be prefilled");
assert.match(page, /previews\[size\.value\]/, "the preview must follow the picked size");
assert.match(page, /size: Number\(size\.value\)/, "Save must hand the size back to pkjs");

/* --- pkjs/index.js: the branchy part, driven through fake host objects --- */

const KEYS = { text: 10000, reply: 10001, error: 10002, size: 10003 };

function loadPkjs(xhrFactory, { nack = false } = {}) {
  const sent = [];
  const opened = [];
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
      sendAppMessage: (payload, ok, fail) => {
        sent.push(payload);
        // Refuse the first delivery only, so the fallback path can be observed.
        if (nack && sent.length === 1) {
          fail?.({ error: "nack" });
        } else {
          ok?.();
        }
      },
      openURL: (url) => {
        opened.push(url);
      },
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

  return { sent, opened, logged, fire: (event, e) => listeners[event](e), store };
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

function configure(app, url, size) {
  app.fire("webviewclosed", {
    response: encodeURIComponent(
      JSON.stringify({ url, headers: "Authorization: Bearer t", size })
    ),
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
  assert.equal(JSON.parse(Xhr.calls[0].body).text, "привет");
  assert.deepEqual(app.sent[0], { [KEYS.reply]: "hi there", [KEYS.size]: 24 });
}

/* Every dictation in one app run carries the same conversation id, so the
   endpoint can chain the turns; a relaunch starts a new one. */
{
  const Xhr = fakeXhr({ status: 200, body: JSON.stringify({ response: "ok" }) });
  const app = loadPkjs(Xhr);
  configure(app, "https://example.com/voice");
  app.fire("appmessage", { payload: { 10000: "first" } });
  app.fire("appmessage", { payload: { 10000: "second" } });

  const ids = Xhr.calls.map((c) => JSON.parse(c.body).conversation_id);
  assert.equal(typeof ids[0], "string");
  assert.ok(ids[0].length > 0, "conversation id must not be empty");
  assert.equal(ids[0], ids[1], "one conversation per app run");

  const relaunched = fakeXhr({ status: 200, body: JSON.stringify({ response: "ok" }) });
  const app2 = loadPkjs(relaunched);
  configure(app2, "https://example.com/voice");
  app2.fire("appmessage", { payload: { 10000: "third" } });
  assert.notEqual(
    JSON.parse(relaunched.calls[0].body).conversation_id,
    ids[0],
    "a relaunch must start a new conversation"
  );
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
  assert.deepEqual(app.sent[0], { [KEYS.error]: "Response was not JSON.", [KEYS.size]: 24 });
}

// A transport failure is reported rather than swallowed.
{
  const app = loadPkjs(fakeXhr({ fail: true }));
  configure(app, "https://example.com/voice");
  app.fire("appmessage", { payload: { 10000: "hello" } });
  assert.deepEqual(app.sent[0], { [KEYS.error]: "Network error.", [KEYS.size]: 24 });
}

// A reply too long for the watch inbox is trimmed rather than dropped.
{
  const long = "x".repeat(9000);
  const app = loadPkjs(fakeXhr({ status: 200, body: JSON.stringify({ response: long }) }));
  configure(app, "https://example.com/voice");
  app.fire("appmessage", { payload: { 10000: "hello" } });

  const shown = app.sent[0][KEYS.reply];
  assert.equal(shown.length, 8003, "ASCII fills the whole byte budget");
  assert.ok(shown.endsWith("..."), "trimming must be visible");
}

// A rejected delivery tells the watch, instead of leaving it on "Sending...".
{
  const app = loadPkjs(fakeXhr({ status: 200, body: JSON.stringify({ response: "hi" }) }), {
    nack: true,
  });
  configure(app, "https://example.com/voice");
  app.fire("appmessage", { payload: { 10000: "hello" } });

  assert.deepEqual(app.sent[0], { [KEYS.reply]: "hi", [KEYS.size]: 24 });
  assert.deepEqual(app.sent[1], {
    [KEYS.error]: "The watch could not accept the reply.",
    [KEYS.size]: 24,
  });
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

/* Text size: the saved setting rides along with every message, and a reply may
   override it. Only the sizes the firmware ships may reach the watch. */
for (const [saved, replied, expected, why] of [
  [36, undefined, 36, "the configured size must be sent"],
  [36, 16, 18, "16 rounds up to the nearest shipped size"],
  [undefined, 200, 36, "an absurd size is clamped, not passed through"],
]) {
  const body = JSON.stringify({ response: "hi", size: replied });
  const app = loadPkjs(fakeXhr({ status: 200, body }));
  configure(app, "https://example.com/voice", saved);
  app.fire("appmessage", { payload: { 10000: "hello" } });
  assert.equal(app.sent[0][KEYS.size], expected, why);
}

/* The picker can only offer sizes it has a preview for, so a size saved when
   the shipped list was different has to be snapped before the page sees it —
   an option value nothing matches leaves the select blank and saves 0. */
{
  const app = loadPkjs(fakeXhr({ status: 200, body: "{}" }));
  configure(app, "https://example.com/voice", 40);
  app.fire("showConfiguration", {});

  const shown = decodeURIComponent(app.opened[0]);
  assert.match(shown, /var saved = \{[^}]*"size":36/, "40 must arrive as a size the page offers");
  assert.match(shown, new RegExp('<option value="36"'), "and that size must be an option");
}

/* --- the shipped size list is written down once per build target --- */

function shippedSizes(source, where) {
  const found = source.match(/SIZES = \[([^\]]+)\]/);
  assert.ok(found, where + " must declare SIZES as a one-line array");
  return found[1].split(",").map((s) => Number(s.trim()));
}

const SHIPPED = shippedSizes(watchSource, "main.js");
assert.deepEqual(
  shippedSizes(readFileSync(new URL("../src/pkjs/index.js", import.meta.url), "utf8"), "index.js"),
  SHIPPED,
  "watch and phone must agree on the shipped sizes"
);

/* The previews are generated and drive the settings picker, so a size added
   without rerunning tools/gothic-preview.mjs would vanish from the page. */
const previews = require("../src/pkjs/preview.js");
assert.deepEqual(Object.keys(previews).map(Number), SHIPPED, "every size needs a preview");
for (const size of SHIPPED) {
  assert.match(previews[size], /^data:image\/png;base64,/, size + " preview must be a PNG");
  assert.match(page, new RegExp('<option value="' + size + '"'), size + " must be offered");
}

report("ok");
