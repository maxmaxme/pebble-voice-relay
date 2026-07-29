import Poco from "commodetto/Poco";
import Dictation from "pebble/dictation";
import Message from "pebble/message";
import Button from "pebble/button";
import wrap from "./wrap";

const PADDING = 6;

const RETRY = "\n\nPress Select to talk again.";

// Keyed by DictationSessionStatus from the firmware. `log` names the status for
// the console, `show` is what goes on the screen.
const DICTATION_ERRORS = {
  1: { log: "rejected", show: "Cancelled." + RETRY },
  2: { log: "rejected after an error", show: "Cancelled." + RETRY },
  3: { log: "aborted by the system", show: "Recording was interrupted." + RETRY },
  4: { log: "no speech detected", show: "Heard nothing." + RETRY },
  5: { log: "no connectivity", show: "No connection to the phone or the internet." },
  6: { log: "disabled for this account", show: "Voice dictation is disabled for this account." },
  7: { log: "internal error", show: "Dictation broke internally." + RETRY },
  8: { log: "recognizer failed", show: "Could not make out the words." + RETRY },
};

const render = new Poco(screen);
const font = new render.Font("Gothic-Regular", 24);
const background = render.makeColor(255, 255, 255);
const foreground = render.makeColor(0, 0, 0);
const lineHeight = font.height + 2;
const visibleLines = Math.floor((render.height - 2 * PADDING) / lineHeight);

let lines = [];
// Scrolling is tracked in pixels rather than lines so a drag can follow the
// finger instead of snapping a line at a time.
let scrollTop = 0;
let pending;
let writable = false;

function maxScrollTop() {
  return Math.max(0, lines.length * lineHeight + 2 * PADDING - render.height);
}

function draw() {
  render.begin();
  render.fillRectangle(background, 0, 0, render.width, render.height);

  const first = Math.floor(scrollTop / lineHeight);
  const offset = PADDING - (scrollTop % lineHeight);
  // One extra line, since the top and bottom ones are usually half-visible.
  for (let i = 0; i <= visibleLines; i++) {
    const line = lines[first + i];
    if (line === undefined) {
      break;
    }
    render.drawText(line, font, foreground, PADDING, offset + i * lineHeight);
  }

  render.end();
}

function scrollByPixels(delta) {
  const wanted = Math.min(maxScrollTop(), Math.max(0, scrollTop + delta));
  if (wanted === scrollTop) {
    return;
  }
  scrollTop = wanted;
  draw();
}

function show(text) {
  // Coerce: an unhandled TypeError in here takes the whole app down, and a
  // caller passing undefined should show something instead of dying.
  const safe = typeof text === "string" ? text : String(text);
  // Release the previous wrap before building the next one: both alive at once
  // is the peak that runs the JS heap out on a long reply.
  lines = [];
  lines = wrap(safe, render.width - 2 * PADDING, (s) => render.getTextWidth(s, font));
  scrollTop = 0;
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
  // Replies are prose and easily outgrow a small buffer; the firmware allows up
  // to 8K per message, and anything larger is trimmed phone-side.
  input: 8192,
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
          // The firmware leaves its result and focus subscriptions live after a
          // successful transcription, so losing focus later (a screenshot, a
          // notification) reports SystemAborted for a session already finished.
          // Acting on that would wipe the reply off the screen.
          const known = DICTATION_ERRORS[status];
          const name = known ? known.log : "unknown status " + status;

          if (!listening) {
            console.log("[watch] ignoring dictation error, not listening: " + name);
            return;
          }
          listening = false;
          console.log("[watch] dictation error: " + name);
          show(known ? known.show : "Dictation failed (" + status + ")." + RETRY);
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

// A page, less one line of overlap so nothing is skipped between presses.
const PAGE = Math.max(1, visibleLines - 1) * lineHeight;

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
    scrollByPixels(type === "up" ? -PAGE : PAGE);
  },
});

// Drag to scroll, tracking the finger. The system dictation window owns the
// screen while recording, so touches are only read between sessions.
console.log("[watch] app start, screen " + render.width + "x" + render.height);
listen();
