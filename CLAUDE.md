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
- `tools/gothic-preview.mjs` — regenerates `src/pkjs/preview.js`, the settings
  page's text-size samples, by rendering them with the firmware's own Gothic
  glyphs out of a `pebbleos` checkout. Run it only when the sample text or the
  offered sizes change; the output is committed.

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
- **Touch exists but a drag gets the app closed by the firmware.** It is exposed
  as `embedded:sensor/Touch/pebble` (not `pebble/touch`). The driver posts a
  `TouchEvent_PositionUpdate` for every coordinate change, and the app's event
  queue holds 32 (`MAX_TO_APP_EVENTS`) with a zero-timeout send. When it
  overflows, `event_service` closes third-party apps outright:
  `app_manager_close_current_app(false)` in `services/event_service/service.c`,
  under `#ifndef CONFIG_RELEASE`. That is why the app vanishes with no
  `fxAbort` and no reboot, and why dragging *slowly* is the reliable repro — it
  lasts longer, so more events pile up. Throttling in JS cannot help: the
  callback runs per event regardless, and XS is too slow to drain 32 in time.
  Buttons scroll instead.
- **The JS machine's default 32K static block is too small** for a reply of a
  few kilobytes plus the wrapped lines drawn from it — XS dies with `fxAbort
  memory full`, which no JS `try` can catch. `mdbl.c` asks for a bigger machine
  through `ModdableCreationRecord`; going over the static block makes the
  runtime allocate from the app heap, and it never grows after that, so the
  sizes must carry headroom. `moddable.c` is explicit about it: ask for more
  than `staticSize` and it sets `incrementalChunkSize` and
  `incrementalHeapCount` to zero.
- **Every element of a normal array costs a slot**, and a slot is 16 bytes
  (`xs.h`: `void *data[4]`), so `JS_SLOT_BYTES` 24K is 1536 slots for the whole
  program. That is why `wrap.js` returns a `Uint16Array` of start/end indices
  instead of substrings: a typed array lives in one chunk and costs one slot no
  matter how many lines it holds, and only the handful of lines being drawn is
  ever cut out of the text. The older string version died on an 8K reply at any
  font size — `split(" ")` alone held 1121 substrings alive at once, several
  times more than the wrapped lines it produced. Measured on hardware after the
  change: 8000 bytes at 36px wraps to 640 lines and draws.
- **The RAM budget is knowable, not guesswork.** `Kconfig`
  (`APP_RAM_EMERY_SEGMENT_SIZE`) gives emery 135168 bytes, and `app_manager.c`
  hands a Moddable app 4096 fewer, so 128K; `pebble build` prints what is left
  (`Free RAM available (heap)`).
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

**`console.log` from the watch-side mod does reach `pebble logs`**, at least
over `--cloudpebble`, tagged with its origin rather than `pkjs>`:

```
[18:55:57] xsHost.c:141> [watch] channel open
```

It travels as an `AppLogMessage` on endpoint 2006, a different path from the
phone's own logging, so only lines logged after the tool attaches show up —
anything printed during app start is gone by the time logs connect. For that
window, draw with `show()` instead.

That same path caps a log line at 90 bytes (`gTransmitBuffer`), splitting it
mid-character, which is exactly what crashes the libpebble2 reader on Cyrillic.

`pebble install --logs` reads logs through libpebble2, which **crashes on
non-ASCII cut mid-character** by the log buffer. Never log a transcript, a
response body, or anything else user-supplied verbatim — pass it through
`safe()` in `src/pkjs/index.js`, or log a length instead.

## Style

- Comments explain *why*, never *what*.
- No dependencies. The settings page is a `data:` URI so nothing needs hosting;
  header parsing is a few lines rather than a library.
