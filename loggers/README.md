# Fractonica loggers

Workers that write to your [Fractonica Hub](../hub/README.md) on their own, in step with the clock. Each is a client
of kind `worker` on the hub: you pair it with a code, and its card on the hub's page (Devices) shows what it is doing
(its `worker.status` record, [`hub/API.md`](../hub/API.md)). Node 22+, no dependencies.

## Timelapse

A frame from a camera at the start of every Flavon (the clock's own, to the millisecond: the web app's `src/core`, as
the hub reads it), and at the end of each **Helion** (2340 Flavons, about 5 h 03 min) a video of them in your journal:
a `journal.entry` with the video, its poster and 🎞️ “Timelapse · Helion 33η”. The video plays a frame per Flavon
(30 a second by default: a Helion in 78 s); a Flavon it missed holds the frame before, so the video keeps the clock's
time. Every frame is stamped with the clock's date (α6 β4 γ9 δ4 ε2), its time down to the Flavon (33η 3ι 8λ) and the
Earth time.

The camera is one on the **Fractonica hardware hub** (`~/projects/fractonica-hardware`, `fr hub start`): by default
`cam-esp32`, the ESP32-CAM. Each frame is a `camera_snap` (about 200 ms). While the camera streams for someone else (a
live view in `web/cam`, say: one stream per camera), the logger takes the next frame of that stream instead, with the
hardware hub's app token (`~/.fractonica/secrets.json` `app_token`, or `FR_APP_TOKEN`). It needs `ffmpeg`
(`brew install ffmpeg`).

### Pair and run

1. On the hub's page: **Devices → Pair a device → Logger**, **Make a code** (a `worker` that may write `journal.entry`
   and `worker.status` records). Or from the terminal:

   ```sh
   node hub/bin/hub.mjs pair --name "Timelapse · cam-esp32" --kind worker --scopes write --kinds journal.entry,worker.status
   ```

2. Run it with the code, on the Mac the hardware hub runs on:

   ```sh
   node loggers/bin/timelapse.mjs XXXX-XXXX --hub http://localhost:8787
   ```

   It pairs, then runs: `Ctrl-C` stops it, and `node loggers/bin/timelapse.mjs` starts it again with the saved
   pairing.

3. **In the background:** `node loggers/bin/timelapse.mjs install` makes it a LaunchAgent: it runs now, at every
   login, and again if it stops (its log: `loggers/data/timelapse-cam-esp32/logger.log`). `uninstall` stops that.
   Options given to `install` are the ones it runs with.

A sleeping Mac takes no frames: `--keep-awake` keeps it from sleeping while the logger runs (`caffeinate -i`).

### Try it

```sh
node loggers/bin/timelapse.mjs --every preon            # a record each Preon (65 Flavons, 8 min 25 s): 65 frames
node loggers/bin/timelapse.mjs --every 13 --fps 10      # every 13 Flavons (1 min 41 s), slower
node loggers/bin/timelapse.mjs status                   # the pairing, the camera, the span it is taking, the last record
```

Spans count from the Helion's start (a Preon is ι 0λ … 64λ), so a record never crosses a Helion.

| option | |
|---|---|
| `--camera DEVICE` | the camera on the hardware hub (default `cam-esp32`); each camera is its own logger, with its own pairing and data |
| `--every SPAN` | `helion` (default), `preon`, or a number of Flavons |
| `--fps N` | the video's frames a second (default 30) |
| `--frame-size S`, `--quality Q`, `--flash` | for its photos (default: the camera's own settings; `--frame-size uxga` for 1600×1200) |
| `--no-stamp` | leave the clock off the frames |
| `--keep-frames` | keep each span's photos after its record (deleted otherwise) |
| `--keep-awake` | keep the Mac awake while it runs |
| `--camera-hub URL` | the hardware hub (default `http://127.0.0.1:7420`) |
| `--hub URL`, `--name NAME` | when pairing: the hub, and what it calls the logger (default `Timelapse · <camera>`) |
| `--data DIR` | its pairing and frames (default `loggers/data/timelapse-<camera>`) |

### What it keeps

`loggers/data/timelapse-<camera>/`: `config.json` (the pairing; its token), `frames/<span>/` (the span's photos until
its record is written: `<Flavon>.jpg`, `frames.jsonl`, `span.json`), `state.json` (the spans recorded, the last
record). A restart goes on with the span it was in; a span that ended while it was down is recorded when it starts;
a record the hub did not take (away, say) is tried again every minute, its photos waiting. The record's id is the
span's (`timelapse.<camera>.<first Flavon>`), so it is never written twice.

## Develop

```sh
npm --prefix loggers test          # the clock's spans, the video, the camera (a stand-in hardware hub), a hub round
```

Layout: `bin/timelapse.mjs` (the command) · `lib/timelapse.js` (Flavons, spans, records, status) · `lib/clock.js`
(Flavons and spans from `src/core`) · `lib/camera.js` (the hardware hub: snaps, the live view's frames) ·
`lib/video.js` (ffmpeg: the video, its stamps, the poster) · `lib/hub.js` (pairing, blobs, records).
