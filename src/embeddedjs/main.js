import Poco from "commodetto/Poco";
import Dictation from "pebble/dictation";
import Message from "pebble/message";
import Button from "pebble/button";
import wrap from "./wrap";

const PADDING = 6;

const DICTATION_ERRORS = {
  1: "Cancelled.\n\nPress Select to talk again.",
  2: "Cancelled.\n\nPress Select to talk again.",
  4: "Heard nothing.\n\nPress Select to talk again.",
  5: "No connection to the phone or the internet.",
  6: "Voice dictation is disabled for this account.",
};

const render = new Poco(screen);
const font = new render.Font("Gothic-Regular", 24);
const background = render.makeColor(255, 255, 255);
const foreground = render.makeColor(0, 0, 0);
const lineHeight = font.height + 2;
const visibleLines = Math.floor((render.height - 2 * PADDING) / lineHeight);

let lines = [];
let scroll = 0;
let pending;
let writable = false;

function draw() {
  render.begin();
  render.fillRectangle(background, 0, 0, render.width, render.height);
  for (let i = 0; i < visibleLines && scroll + i < lines.length; i++) {
    render.drawText(lines[scroll + i], font, foreground, PADDING, PADDING + i * lineHeight);
  }
  render.end();
}

function show(text) {
  lines = wrap(text, render.width - 2 * PADDING, (s) => render.getTextWidth(s, font));
  scroll = 0;
  draw();
}

function flush() {
  if (pending === undefined) {
    return;
  }
  // The channel only opens once the phone answers the module's handshake, so a
  // transcript can be queued before anything can be sent.
  if (!writable) {
    console.log("[watch] channel not open yet, transcript queued");
    show("Waiting for the phone...");
    return;
  }
  const text = pending;
  pending = undefined;
  writable = false;
  try {
    message.write(new Map([["text", text]]));
    console.log("[watch] sent " + text.length + " chars to the phone");
    show("Sending...");
  } catch (e) {
    console.log("[watch] write failed: " + e.message);
    show("Could not reach the phone.");
  }
}

const message = new Message({
  keys: ["text", "reply", "error"],
  input: 640,
  output: 640,
  onReadable() {
    const payload = message.read();
    const reply = payload.get("reply");
    const error = payload.get("error");
    console.log("[watch] got " + (reply ? "reply" : error ? "error" : "nothing"));
    show(reply ?? error ?? "Empty response.");
  },
  onWritable() {
    console.log("[watch] channel open");
    writable = true;
    flush();
  },
  onSuspend() {
    console.log("[watch] channel suspended");
    writable = false;
  },
});

let dictation;
let listening = false;

// The session only exists while the phone is reachable, so it is created
// lazily and retried on every Select press.
function listen() {
  // Button events still arrive while the system's dictation window is up, and
  // that window uses Select to stop recording — starting again there throws.
  if (listening) {
    return;
  }

  if (!dictation) {
    try {
      dictation = new Dictation({
        byteLength: 512,
        onReadable() {
          listening = false;
          const text = dictation.read();
          console.log("[watch] transcript: " + (text ? text.length + " chars" : "empty"));
          if (!text) {
            return;
          }
          pending = text;
          flush();
        },
        onError(status) {
          listening = false;
          console.log("[watch] dictation error " + status);
          show(DICTATION_ERRORS[status] ?? "Dictation failed.\n\nPress Select to talk again.");
        },
      });
      dictation.configure({ confirm: false });
    } catch (e) {
      dictation = undefined;
      console.log("[watch] cannot create session: " + e.message);
      show("Dictation is unavailable.\n\nCheck the phone connection, then press Select.");
      return;
    }
  }

  show("Listening...");
  try {
    dictation.start();
    listening = true;
    console.log("[watch] listening");
  } catch (e) {
    console.log("[watch] start failed: " + e.message);
    show("Could not start listening.\n\nPress Select to try again.");
  }
}

new Button({
  types: ["up", "down", "select"],
  onPush(pushed, type) {
    if (!pushed) {
      return;
    }
    if (type === "select") {
      console.log("[watch] app start, screen " + render.width + "x" + render.height);
listen();
      return;
    }
    const maxScroll = Math.max(0, lines.length - visibleLines);
    scroll = type === "up" ? Math.max(0, scroll - 1) : Math.min(maxScroll, scroll + 1);
    draw();
  },
});

console.log("[watch] app start, screen " + render.width + "x" + render.height);
listen();
