# fx-worker — the Fractonica Hub embedding worker

Turns the hub's records into vectors for semantic search with **EmbeddingGemma 2** (`google/embeddinggemma-2`):
text, photos, voice notes and videos in one 768-dimension space (Matryoshka: the first 512/256/128 dimensions,
re-normalised, still work). It is an ordinary hub client with the `worker` scope that only makes outbound HTTP
requests, so it can run on the same Mac as the hub or on another machine. The contract is `hub/API.md`, sections
"Search and vectors" and "Worker protocol".

## Install

Needs [uv](https://docs.astral.sh/uv/) and ffmpeg (`brew install ffmpeg`, which also gives you `ffprobe`). uv
fetches Python 3.12, PyTorch 2.14, transformers ≥ 5.18 and sentence-transformers ≥ 6.1 (the model card asks for
≥ 6.1; older versions lose the order of interleaved media).

```sh
cd hub/worker
uv sync
uv run fx-worker selftest      # loads the model, picks the device, checks a query finds the right entry
```

The weights (2.8 GB) come from the Hugging Face cache (`~/.cache/huggingface/hub`). If they are not there the
first start downloads them; when they are, the worker runs offline (`HF_HUB_OFFLINE` is set for it).

## Pair

On the hub, make a pairing code for a worker (or use the web UI):

```sh
node hub/bin/hub.mjs pair --name "Studio worker" --kind worker --scopes worker,read
```

Then, on the worker's machine:

```sh
uv run fx-worker login --hub http://192.168.1.20:8787 --code K7QF-2MXD
```

This redeems the code (`POST /v1/pair`, kind `worker`) and saves the hub and token to
`~/.config/fractonica-hub/worker.json` (mode 0600). Pairing again from the same machine replaces the token of the
same client (the file keeps a stable install id). The `read` scope is needed to download the blobs it embeds.

## Run

```sh
uv run fx-worker                                              # hub and token from the config file
uv run fx-worker --hub http://localhost:8787 --token fxh_…    # or explicitly
FX_HUB=http://localhost:8787 FX_TOKEN=fxh_… uv run fx-worker  # or from the environment
```

Flags win over the environment, the environment over the config file (whose token is only used for its own hub).

| flag | env | default | |
|---|---|---|---|
| `--hub URL` | `FX_HUB` | config file | hub base URL |
| `--token T` | `FX_TOKEN` | config file | worker token |
| `--modalities L` | `FX_MODALITIES` | `text,image,audio,video` | encoders to load; `text,image` saves ~1 GB. Video needs image. |
| `--device D` | `FX_DEVICE` | `auto` | `auto`, `mps`, `cpu`, `cuda` |
| `--dtype P` | `FX_DTYPE` | `auto` | `auto`, `bf16`, `fp32` (fp16 is never used: the model overflows it) |
| `--no-selfcheck` | | off | trust `--device`/`--dtype` without comparing to CPU fp32 |
| `--max N` | | 8 | most jobs leased per poll (fewer when records are slow, see below) |
| `--wait S` | | 25 | long-poll seconds |
| `--model ID` | `FX_MODEL` | `google/embeddinggemma-2` | |
| `-v` | | | debug logging |

Other commands: `fx-worker login …`, `fx-worker selftest`, `fx-worker bench` (the numbers below).

### As a launchd agent (starts at login, restarts if it dies)

`~/Library/LaunchAgents/com.fractonica.hub-worker.plist` (adjust the two paths to your `uv` and checkout):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>com.fractonica.hub-worker</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/dimas/.local/bin/uv</string>
    <string>run</string>
    <string>--project</string>
    <string>/Users/dimas/projects/fractonica-clock/hub/worker</string>
    <string>fx-worker</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <!-- ffmpeg/ffprobe live in Homebrew's bin, which launchd's PATH lacks -->
    <key>PATH</key>            <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>ThrottleInterval</key>  <integer>30</integer>
  <key>StandardOutPath</key>   <string>/Users/dimas/Library/Logs/fx-worker.log</string>
  <key>StandardErrorPath</key> <string>/Users/dimas/Library/Logs/fx-worker.log</string>
</dict>
</plist>
```

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.fractonica.hub-worker.plist
launchctl kickstart -k gui/$(id -u)/com.fractonica.hub-worker   # restart after an update
launchctl bootout gui/$(id -u)/com.fractonica.hub-worker        # stop and unload
tail -f ~/Library/Logs/fx-worker.log
```

It runs as a GUI-session agent (not a system daemon) because Metal (MPS) is only available to processes of the
logged-in user. It reads the token from `~/.config/fractonica-hub/worker.json`, so run `fx-worker login` first.

## What it does

- **Heartbeat** every 30 s (`model`, `device`, `modalities`, plus `dtype` and `version`), from its own thread.
- **Long-polls** `GET /v1/worker/jobs?wait=25&max=N`. N adapts: it takes about 10 s worth of records at the
  measured speed (1 … `--max`), so a search arriving meanwhile waits little and no job outlives its 120 s lease.
- **`embed.query`**: all query jobs of one poll go through the model in one batch, with the `SearchQuery` prompt
  (`task: search result | query: …`). `task: "document"` gets the `Document` prompt (`title: none | text: …`)
  unless the input already starts with `title:`. Parts are `"0"`, `"1"`, … in input order.
- **`embed.record`**: downloads each medium with the worker's token (only to the hub's own origin), decodes it
  and makes
  - `record`: the hub's composed `text` followed by one placeholder per medium in `media` order — `<|image|>` per
    photo, `<|audio|>` per audio, `<|video|>` per video — in a single 8,192-token sequence;
  - `blob:<hash>` for each photo, audio and video on its own.
- Vectors are 768-d float32, L2-normalised, little-endian, base64.

Decoding: images (JPEG, PNG, HEIC/HEIF via pillow-heif, …) are turned upright from EXIF and bounded to 1536 px
(the processor makes ~280 soft tokens of them). Audio goes through ffmpeg to mono 16 kHz float32. Video is
decoded by ffmpeg to at most 32 frames, 1 per second, spread evenly over the clip, at most 768 px (ffmpeg applies
the rotation of phone videos); a "video" with no picture is embedded as audio.

Budget (8,192 tokens; image 282 incl. markers, video 142 per frame, audio 25/s): text is kept unless it alone
would crowd out the media, then photos are kept whole, and audio and video share what is left — all scaled down by
one factor (audio keeps its first seconds, video keeps evenly spread frames). The plan is checked against the
processor's real sequence length before running the model. A single audio clip may be up to ~325 s (the
feature extractor's default 30 s cut is lifted); longer ones keep their first ~325 s.

Posters: when a video decodes, its poster adds nothing and is left out. When it does not (or the video encoder is
not loaded), the poster stands in for it: in the video's place in `record`, and as `blob:<video hash>`.

Errors are reported per job:

| situation | report |
|---|---|
| a medium cannot be decoded, but there is text or other media | success without it (logged) |
| nothing decodable and no text; malformed job; unknown job type or task | `retry: false` |
| blob download fails (network, 5xx); model or out-of-memory error | `retry: true` |
| blob `404`/`410`/`413` | that medium is left out, as undecodable |

Network trouble and hub restarts: polls back off exponentially (0.5 … 60 s, with jitter; `Retry-After` is
honoured on 429/503), a refused token (401/403) is logged and retried every 60 s, and results are re-posted on
network errors and 5xx for as long as the lease could hold. `SIGTERM`/Ctrl-C stop it; unfinished jobs go back to
the queue when their lease runs out.

## Device and precision

`--device auto` tries MPS bf16, then MPS fp32, then CPU fp32. A candidate is kept only if it agrees with CPU fp32
on fixed probes for every loaded modality (a query, a titled document, a drawn picture, a chirp, a three-frame
video): cosine > 0.99 on each, all finite. The CPU fp32 reference vectors are computed once per model file and
cached in `~/.cache/fractonica-hub/`.

On the M1 Max, MPS bf16 agrees with CPU fp32 to cosine ≥ 0.9999 on all probes (query 0.99998, document 0.99996,
image 0.99998, audio 0.99989, video 0.99995; MPS fp32 gives 1.00000), uses ~40% of the memory of fp32 and is as
fast, so it is the choice. CPU fp32 is 4–6× slower.

## Performance (Apple M1 Max, 64 GB, macOS 26; `uv run fx-worker bench`)

| | MPS bf16 (chosen) | CPU fp32 |
|---|---|---|
| process start → ready | ~13 s: ~10 s Python imports, 2.4 s weights, ~1.5 s self-check | ~12 s |
| memory after load, all encoders | RSS 1.0 GB + 2.6 GB Metal | RSS 3.6 GB (peak 4.7) |
| memory after load, `text,image` / `text` | RSS 0.9 GB + 1.5 / 1.1 GB Metal | |
| memory while embedding media | RSS 1.6 GB + 3.2 GB Metal | RSS 5.0 GB (peak 5.7) |
| text query, one | 63 ms | 97 ms |
| text queries, batch of 8 | 51 ms (6 ms each) | 239 ms |
| journal text, ~300 tokens | 69 ms | 305 ms |
| photo, 12 MP JPEG | 163 ms decode + 423 ms embed | 139 + 2167 ms |
| photo, 12 MP HEIC | 1.2 s decode + 421 ms embed | 1.2 s + 2.6 s |
| audio, 60 s (1,500 tokens) | 100 ms decode + 736 ms embed | 142 ms + 4.5 s |
| video, 10 s 1080p (10 frames) | 345 ms decode + 1.7 s embed | 450 ms + 9.0 s |
| record: text + 2 photos + 60 s audio + 10 s video (3,285 tokens), with its 4 blob parts | 6.6 s | 31.8 s |
| one full context (8,000 tokens, e.g. 320 s of audio) | 7.6 s | |

## Tests

```sh
uv run pytest                    # everything, ~75 s: loads the model once
uv run pytest -m "not model"     # the job loop only, ~8 s, with a fake model
```

`tests/mock_hub.py` implements the worker endpoints of the API (pair, jobs with leases and query-first order,
finish, heartbeat, blobs with bearer auth and Range) and checks the shape of every result (768 float32, unit
length). The loop tests cover batching, query-before-record order, JPEG/HEIC/audio/video records, posters,
undecodable files (`retry: false`), model failures (`retry: true`), injected 5xx with `Retry-After`, a hub restart
mid long-poll, a wrong token, and `fx-worker login`. The model tests check that a moon query ranks a moon entry
above a grocery list, "a red apple" ranks a drawn apple above a blue sky, "train delay" ranks a `say` clip of "the
train was late again" above an unrelated one, that 512- and 256-d truncation keeps those rankings, that an oversize
record is trimmed to the context, and a full record through the mock hub with the real model.

For a manual run: `uv run python tests/mock_hub.py --port 8787 --token fxh_dev` and, in another shell,
`uv run fx-worker --hub http://127.0.0.1:8787 --token fxh_dev`.
