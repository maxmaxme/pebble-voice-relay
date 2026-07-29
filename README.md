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
pebble build
```

`pebble` comes from the PebbleOS repo's virtualenv
(`pebbleos/.venv/bin/pebble`), which pulls its own SDK on first use.

Run the self-checks for the word-wrap and header parsing:

```bash
node tools/check.mjs
```

## Testing

The full flow needs real hardware with a connected phone: speech recognition
runs through the phone, and the emulator has no phone. Calling
`dictation_session_start()` in the emulator closes the app outright — this
happens with a plain C app too, so it is an emulator limitation rather than
something in this code.

```bash
pebble install --phone <watch-ip>
```

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
