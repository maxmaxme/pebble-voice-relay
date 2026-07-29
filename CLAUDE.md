# Voice Relay

A Pebble watchapp: dictate on the watch, relay the transcript to an HTTP
endpoint, show the reply. Written in JavaScript — Alloy (Moddable XS) on the
watch, PebbleKit JS on the phone.

## Layout

- `src/embeddedjs/` — runs **on the watch** under Moddable XS. `main.js` is the
  whole app; `wrap.js` is word-wrapping, kept pure so it can be tested.
- `src/pkjs/` — runs **on the phone**. `index.js` does the HTTP call,
  `config.js` builds the settings page, `headers.js` parses the header block.
- `src/c/mdbl.c` — glue that boots the JS machine. Only the memory sizes in it
  are ours; the rest is the stock template.
- `tools/check.mjs` — the test suite. Plain `node:assert`, no framework.

## Commands

```sh
npm run check            # tests
npm run build            # tests, then pebble build
npm run install:watch    # build, then install via the CloudPebble connection, with logs
npm run install:phone    # same, straight to PEBBLE_PHONE over the local network
npm run screenshot -- store/screen-reply.png   # grab the watch screen
npm run setup            # recreate .venv with pebble-tool (first checkout only)
```

`pebble` comes from this repo's own `.venv` — never call the one in the
PebbleOS checkout.

Always pass a connection flag. Bare `pebble install` fails with "No pebble
connection specified" unless `PEBBLE_PHONE` / `PEBBLE_CLOUDPEBBLE` happens to be
exported, which is not the case when the command runs from an IDE.

## Platform facts worth knowing

These were established by reading the PebbleOS firmware, not guessed:

- Target platform is **`emery`**, which is what obelix / Core 2 Duo builds
  report as (`boards/obelix/defconfig` sets `CONFIG_PLATFORM_EMERY=y`).
- **Apps cannot get raw microphone audio**, in C or in JS. The only microphone
  API returns already-transcribed text, and recognition happens through the
  phone.
- **The message channel opens late.** The watch's `pebble/message` module posts
  a handshake on key `15025` and calls `onWritable` only after the phone sends
  something back. `src/pkjs/index.js` answers that handshake — without the
  answer the watch can never send, and the app sits on "Waiting for the phone".
- **Button events reach the app while the system dictation window is open**, and
  that window uses Select to stop recording. Starting a second session there
  throws, so `main.js` guards with a `listening` flag.
- **The touchscreen is reachable**, as `embedded:sensor/Touch/pebble` (not
  `pebble/touch`). Subscribe with `onSample`, then `sample()` returns
  `[{x, y, id}]` while a finger is down and `[]` on liftoff. It cannot stop a
  recording, though — see the dictation-window note above.
- **The JS machine's default 32K static block is too small** for a reply of a
  few kilobytes plus the wrapped lines drawn from it — XS dies with `fxAbort
  memory full`, which no JS `try` can catch. `mdbl.c` asks for a bigger machine
  through `ModdableCreationRecord`; going over the static block makes the
  runtime allocate from the app heap, and it never grows after that, so the
  sizes must carry headroom.
- **Piu is not built into the firmware** — only `piu/MC`. Text has to be drawn
  with Poco, hence `wrap.js`.
- **A screenshot kills a running dictation.** The image travels over the same
  Bluetooth link as the audio, so capturing mid-recording ends the session.
  Worse, the firmware leaves its focus subscription live after a *successful*
  transcription, so the capture reports SystemAborted for a session already
  over — `main.js` ignores dictation errors that arrive while not listening.
- **Dictation cannot be tested in the emulator.** `dictation_session_start()`
  with no phone attached closes the app outright; this happens with a plain C
  app too. Test on hardware.

## Logging

`pebble install --logs` reads logs through libpebble2, which **crashes on
non-ASCII cut mid-character** by the log buffer. Never log a transcript, a
response body, or anything else user-supplied verbatim — pass it through
`safe()` in `src/pkjs/index.js`, or log a length instead.

## Style

- Comments explain *why*, never *what*.
- No dependencies. The settings page is a `data:` URI so nothing needs hosting;
  header parsing is a few lines rather than a library.
