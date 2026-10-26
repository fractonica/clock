# Fractonica Hub

A personal server for your records: journal entries from the Fractonica apps on every iPhone, iPad and Mac, plus
anything else you point at it (sensors, computer usage, an agent's notes). It keeps them in one place, serves them back
to every device, and searches them by meaning. The contract every client follows is [`API.md`](API.md).

- **Zero runtime dependencies**: Node 22.13+ (`node:http`, `node:sqlite`, `node:crypto`). One SQLite file and a folder
  of blobs under `hub/data/`.
- **Web UI** at `/`: a timeline grouped by Nuclide and Helion with the Earth date beside them, journal cards with
  Markdown, photos, voice notes and video, search (semantic when the worker runs, keyword otherwise), devices and
  pairing with QR codes, worker status, live updates. Dark and light.
- **Semantic search** through the embedding worker in [`worker/`](worker/README.md) (EmbeddingGemma 2), which can run on
  this Mac or on any machine that reaches the hub.

## Run

```sh
npm run hub                                   # from the repo root, = node hub/bin/hub.mjs serve
node hub/bin/hub.mjs serve --port 8787 --host 0.0.0.0 --data hub/data
```

It prints the local and LAN addresses and, on the first start, a one-time setup link:

```
Fractonica Hub 1.0.0  ·  data …/hub/data
  this Mac   http://localhost:8787
  LAN        http://192.168.1.20:8787

No admin yet. Open this once to make this browser the hub's admin (valid 7 days, single use):
  http://localhost:8787/#setup=RASX-GTJJ
```

Open the link: that browser becomes the admin (its token stays in `localStorage`). Another browser later: Devices →
Pair a device → Browser, or `node hub/bin/hub.mjs pair --name "iPad Safari" --kind browser`.

The hub advertises itself on the LAN with Bonjour as `_fractonica-hub._tcp` (via `dns-sd`, while it runs) so the apps
can find it. Other commands:

```sh
node hub/bin/hub.mjs clients                  # every client: kind, scopes, kinds, records, last seen
node hub/bin/hub.mjs revoke c_01K8…           # the token stops working; the records stay
```

## Pair a device

In the web UI: **Devices → Pair a device**, name it, pick the kind and scopes, **Make a code**. The dialog shows the
code (`K7QF-2MXD`, valid 10 minutes, single use), the `fractonica://pair?hub=…&code=…` link and its QR code. Scan it
with the iPhone, or type the code into the app. From the terminal:

```sh
node hub/bin/hub.mjs pair --name "Dimas's iPhone"                        # read, write, search; all kinds
```

The link carries the hub's LAN address, so the phone must be on the same network (and the Mac's firewall must let
Node accept connections).

## Run the worker

Semantic search needs the embedding worker; see [`worker/README.md`](worker/README.md). In short:

```sh
node hub/bin/hub.mjs pair --name "GPU box" --kind worker                 # prints a code
cd hub/worker && uv sync && uv run fx-worker login --hub http://localhost:8787 --code XXXX-XXXX
uv run fx-worker
```

Without a worker everything works except semantic search: `auto` searches fall back to keywords, and `/v1/embed`
answers `503`. The Devices page shows whether the worker is connected, its model and device, the queue and any parked
jobs (with a retry button). When the worker reports a different model, the hub drops every vector and re-embeds.

## Write a provider

A provider is anything that writes records. Make it a token with only what it needs, then `PUT` records with
deterministic ids so retries never duplicate:

```sh
node hub/bin/hub.mjs pair --name "Studio thermometer" --kind service --scopes write --kinds 'sensor.*' --token
HUB=http://localhost:8787 TOKEN=fxh_… CELSIUS=21.5 hub/examples/sensor.sh
```

(`--token` prints a token right away; without it you get a code that the script redeems with `POST /v1/pair`.)

Examples in [`examples/`](examples/):

| file | what it does |
|---|---|
| [`sensor.sh`](examples/sensor.sh) | one `curl` writing a `sensor.temperature` reading (API.md § Writing a provider) |
| [`computer-usage.mjs`](examples/computer-usage.mjs) | every minute, the frontmost macOS app and window title as `computer.usage` (`osascript`) |
| [`mcp-server.mjs`](examples/mcp-server.mjs) | a stdio MCP server with `search_records`, `list_records`, `get_record`, `add_record`, so Claude and other agents can read and write the hub |

For Claude Code: `claude mcp add fractonica-hub --env FXHUB_URL=http://localhost:8787 --env FXHUB_TOKEN=fxh_… -- node "$PWD/hub/examples/mcp-server.mjs"`.

What a record looks like, which kinds the apps know and how other kinds are shown: [`API.md`](API.md) § Records. Put
the readable part of a generic record in `text` (or `data.text`), a title in `data.title` and an emoji in `data.emoji`;
numbers and short strings in `data` are shown as a compact key/value line.

## Security

- The hub is meant for your own network. It speaks **plain HTTP**: anyone who can watch the Wi-Fi traffic can read
  records and tokens. Do not expose port 8787 to the internet. To reach it from outside, put it behind a reverse proxy
  with TLS (Caddy: `hub.example.com { reverse_proxy localhost:8787 }`) or a VPN such as Tailscale, and use that address
  when pairing (`serve --public-url https://hub.example.com`).
- Every request carries a **bearer token** (`fxh_…`, 256 random bits). The hub stores only their SHA-256; a lost token
  is revoked from Devices or with `hub revoke`. Pairing codes are single use, expire, and more than 10 wrong codes a
  minute from one address are refused.
- **Scopes** limit what a token can do (`read`, `write`, `search`, `worker`, `admin`) and **kinds** limit which
  records it sees (`sensor.*`). Give scripts the least they need.
- The web UI keeps its token in `localStorage` and passes it as `?token=` on media and live-update URLs (browsers cannot
  send headers there), so it can appear in a proxy's access log. Only the admin browser should have `admin`.
- Blobs are content-addressed and served only to clients that can read a record naming them.

## Develop

```sh
npm --prefix hub test                         # node --test hub/test/*.test.mjs (ephemeral ports, temporary data)
```

Layout: `bin/hub.mjs` (CLI) · `lib/server.js` (HTTP, SSE, static files) · `lib/hub.js` (rules: clients, pairing, records,
jobs, vectors, search) · `lib/records.js` (validation, canonical JSON, searchable text) · `lib/blobs.js` (blob files,
thumbnails with `sips`/`ffmpeg`) · `lib/fx.js` (Fractonica readings from `src/core`) · `web/` (the UI, no build step;
`qr.js` and `md.js` are small local encoders/renderers).
