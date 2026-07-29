# Voice Relay

A Pebble watchapp that listens on launch, sends what you said to an HTTP
endpoint of your choice, and shows the reply on the watch.

Written in JavaScript for [Alloy](https://developer.repebble.com) (Moddable XS
on the watch) plus PebbleKit JS on the phone. Targets **emery** — which is what
obelix / Core 2 Duo builds report as.

## Flow

1. Launching the app starts dictation immediately.
2. **Select** ends the recording; the phone-side JS gets the transcript.
3. The phone POSTs `{"text": "..."}` to your endpoint with your headers.
4. The endpoint answers `{"response": "..."}` and the text appears on the watch.

**Select** starts a new recording, **Up/Down** scroll a long reply, **Back**
exits.

## Settings

In the Pebble phone app, open the app's settings:

- **Endpoint URL** — where the transcript is POSTed.
- **Headers** — one per line, `Name: value`. For example
  `Authorization: Bearer sk-...`.

The settings page is generated locally as a `data:` URI, so there is nothing to
host.

**Test** posts the word `test` to the URL in the form, using the headers in the
form, and prints the status and body below the button. It neither saves the
settings nor involves the watch — the request goes straight from the phone's
browser, so the endpoint has to allow cross-origin requests (send
`Access-Control-Allow-Origin` and handle the `OPTIONS` preflight) for this to
work. The watch's own requests are not subject to that.

## Endpoint contract

```
POST <your url>
Content-Type: application/json
<your headers>

{"text": "what the watch heard"}
```

```
200 OK
{"response": "what to show on the watch"}
```

Any non-2xx status, a timeout (30 s), or a body that is not JSON with a
`response` field shows an error on the watch instead.

## Build

```bash
npm run build            # tests, then compile
npm run check            # tests only
npm run install:watch    # compile and install over the CloudPebble connection
npm run install:phone    # same, straight to PEBBLE_PHONE on the local network
```

`pebble` lives in this repo's own `.venv`; `npm run setup` recreates it on a
fresh checkout, and the SDK downloads itself on first use. Always keep the
connection flag the scripts pass — a bare `pebble install` exits with "No pebble
connection specified" unless `PEBBLE_PHONE` or `PEBBLE_CLOUDPEBBLE` is exported,
which will not be the case when the command runs from an IDE.

## Icons

`tools/make-icons.py` draws all of them, so the shape is edited in one place:

```bash
.venv/bin/python tools/make-icons.py
```

- `resources/images/menu-icon.png` — 25×25, launcher icon. Pebble uses it as a
  mask, so the script snaps it to fully opaque or fully transparent pixels.
- `store/icon-80.png`, `store/icon-144.png` — the two sizes the appstore wants.

## Publishing

The store lives at `appstore-api.repebble.com` and the CLI talks to it:

```bash
.venv/bin/pebble login
.venv/bin/pebble publish --icon-small store/icon-80.png --icon-large store/icon-144.png
```

Run without arguments and it prompts for name, description, category and icon
paths. Screenshots are captured automatically from an emulator — including
animated rollovers, which is why launching one takes a while. Nothing goes live
until `--is-published` is passed, so a first run is safe to inspect.

Emulator screenshots of this app only ever show the idle screen — dictation
cannot run without a phone — so capture from the watch instead:

```bash
npm run screenshot -- store/screen-reply.png
```

Take it while a reply is on screen, not while recording: the image travels over
the same Bluetooth link as the audio, so capturing mid-dictation ends the
session.

## Testing

`npm run check` covers the parts that can be tested off-device: word wrapping,
header parsing, the settings page wiring, and every branch of the phone-side
relay driven through fake host objects.

The rest needs real hardware with a connected phone: speech recognition runs
through the phone, and the emulator has none. Calling
`dictation_session_start()` in the emulator closes the app outright — this
happens with a plain C app too, so it is an emulator limitation rather than
something in this code.

## What is deliberately not here

- **Sending audio instead of a transcript.** Apps cannot get raw microphone
  data; the only microphone API on the watch (`dictation`, both in C and in
  Alloy JS) hands back already-transcribed text. Raw PCM would also need
  roughly 16 KB/s over a link that carries a few KB/s.
- **Spoken replies.** The speaker API can stream PCM, but that PCM would have
  to arrive over AppMessage — a few seconds of speech takes minutes to
  transfer.
- **Stopping by tapping the screen.** The watch has a touchscreen and Alloy
  exposes it, but recording happens inside the system's modal dictation window,
  where stop-with-result is bound to Select. The API an app can call
  (`dictation.stop()`) kills the session without returning a transcript.
