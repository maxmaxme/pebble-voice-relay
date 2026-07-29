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
  if (!writable || pending === undefined) {
    return;
  }
  const text = pending;
  pending = undefined;
  writable = false;
  try {
    message.write(new Map([["text", text]]));
  } catch (e) {
    show("Could not reach the phone.");
  }
}

const message = new Message({
  keys: ["text", "reply", "error"],
  input: 640,
  output: 640,
  onReadable() {
    const payload = message.read();
    show(payload.get("reply") ?? payload.get("error") ?? "Empty response.");
  },
  onWritable() {
    writable = true;
    flush();
  },
  onSuspend() {
    writable = false;
  },
});

let dictation;

// The session only exists while the phone is reachable, so it is created
// lazily and retried on every Select press.
function listen() {
  if (!dictation) {
    try {
      dictation = new Dictation({
        byteLength: 512,
        onReadable() {
          const text = dictation.read();
          if (!text) {
            return;
          }
          show("Sending...");
          pending = text;
          flush();
        },
        onError(status) {
          show(DICTATION_ERRORS[status] ?? "Dictation failed.\n\nPress Select to talk again.");
        },
      });
      dictation.configure({ confirm: false });
    } catch (e) {
      dictation = undefined;
      show("Dictation is unavailable.\n\nCheck the phone connection, then press Select.");
      return;
    }
  }

  show("Listening...");
  dictation.start();
}

new Button({
  types: ["up", "down", "select"],
  onPush(pushed, type) {
    if (!pushed) {
      return;
    }
    if (type === "select") {
      listen();
      return;
    }
    const maxScroll = Math.max(0, lines.length - visibleLines);
    scroll = type === "up" ? Math.max(0, scroll - 1) : Math.min(maxScroll, scroll + 1);
    draw();
  },
});

listen();
