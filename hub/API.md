# Fractonica Hub API, v1

The hub is a personal server that collects **records** from many **clients** and serves them back. The Fractonica app
on each iPhone, iPad and Mac is both a provider (it writes journal entries) and a consumer (it reads every device's
entries and searches them). Other clients can only write (a sensor logging temperature, an MCP server logging computer
usage) or only read (a dashboard, an exporter). One client, the embedding **worker**, turns records into vectors for
semantic search.

This document is the contract between the hub (`hub/`), the worker (`hub/worker/`), the apps (`ios/`) and any third
party client. Anything not written here is an implementation detail.

```
 iPhone ─┐                    ┌──────────── hub ────────────┐
 Mac ────┼── records, blobs ─▶│ records · blobs · vectors   │◀── jobs / vectors ── worker (EmbeddingGemma 2)
 sensor ─┘   (write scope)    │ clients · pairing · search  │
 iPhone ◀── changes, blobs,  ─│ web UI (browse + search)    │
 dashboard   vectors, search  └─────────────────────────────┘
```

## Conventions

- Base URL: whatever the user enters, e.g. `http://localhost:8787` or `http://192.168.1.20:8787`. Every endpoint is under
  `/v1`. The hub serves its web UI at `/`.
- JSON in and out (`Content-Type: application/json; charset=utf-8`), except blob bodies.
- Times are Unix seconds as JSON numbers (fractions allowed), UTC.
- Auth: `Authorization: Bearer <token>` on every request except `GET /v1` and `POST /v1/pair`. Where a browser cannot
  set headers (`EventSource`, `<img>`, `<audio>`, `<video>`), `GET /v1/events` and `GET`/`HEAD /v1/blobs/{hash}` also
  accept the token as `?token=`; no other endpoint does.
- Errors: a non-2xx status with
  ```json
  { "error": { "code": "conflict", "message": "human readable", "details": { } } }
  ```
  Codes: `bad_request` 400, `unauthorized` 401, `forbidden` 403 (missing scope or kind), `not_found` 404,
  `conflict` 409, `too_large` 413, `unprocessable` 422 (e.g. a record references missing blobs), `rate_limited` 429,
  `unavailable` 503 (e.g. no worker connected; has `Retry-After`).
- Lists page with an opaque or numeric `cursor`; a response says `"more": true` while there is more to read.
- Unknown JSON fields are ignored by the hub and must be ignored by clients (forward compatibility).
- CORS: the hub answers browser preflights for `/v1/*` with `Access-Control-Allow-Origin: *` (tokens are bearer, not
  cookies).

## Clients, scopes and pairing

A **client** is anything holding a token: `{ id, name, kind, platform, scopes, kinds, created, lastSeen }`.

- `kind`: `device` (an app on a phone or computer), `service` (a script, sensor, MCP server), `worker`, `browser`
  (the hub's own web UI).
- `scopes`, any of:
  - `read`: list and get records, the change feed, blobs, vectors
  - `write`: create, update and delete records; upload blobs
  - `search`: `POST /v1/search`, `POST /v1/embed`
  - `worker`: take embedding jobs and return vectors
  - `admin`: manage clients and pairing codes (the web UI)
- `kinds`: glob patterns limiting `read` and `write` to record kinds, default `["*"]`. `"journal.*"` matches
  `journal.entry`. A write of a kind outside the list is `403 forbidden`; reads silently leave such records out.

A client only ever writes records **as itself**: the hub sets `source` to the writer's client id. A client may update
or delete only records whose `source` is itself, unless it has `admin`. (Devices that reinstall keep their client id:
the app keeps its token in the Keychain.) Exception: records of kind `journal.*` can be edited by any client with
`write` on that kind, so an entry made on the iPhone can be corrected on the Mac; `source` then stays the creator and
`editor` records the last writer.

### Pairing

Pairing turns a short one-time code into a long-lived token. Codes are made in the hub's web UI or CLI.

`POST /v1/pairings` (admin) — make a code
```json
{ "name": "Dimas's iPhone", "scopes": ["read", "write", "search"], "kinds": ["*"], "ttl": 600 }
```
→ `201`
```json
{ "code": "K7QF-2MXD", "expires": 1791461400,
  "link": "fractonica://pair?hub=http%3A%2F%2F192.168.1.20%3A8787&code=K7QF-2MXD" }
```
Defaults: scopes `["read","write","search"]`, kinds `["*"]`, ttl 600 s. An optional `kind` (`device`, `service`,
`worker`, `browser`) is the default kind of the client that redeems the code. Codes are 8 characters from
`23456789ABCDEFGHJKMNPQRSTVWXYZ` shown as `XXXX-XXXX`; input is case-insensitive and ignores `-` and spaces. The `link`
uses the hub's LAN address so a phone can reach it, and is what the web UI shows as a QR code.

`POST /v1/pair` (no auth) — redeem a code
```json
{ "code": "k7qf2mxd", "name": "iPhone 17 Pro", "kind": "device", "platform": "iOS 26.1",
  "device": "6F1C0E2A-…" }
```
→ `201`
```json
{ "client": { "id": "c_01K8…", "name": "iPhone 17 Pro", "kind": "device", "scopes": ["read","write","search"], "kinds": ["*"] },
  "token": "fxh_…",
  "hub": { "id": "h_01K8…", "name": "Fractonica Hub", "version": "1.0.0" } }
```
`name` and `kind` in the redeem body win over the code's. Codes are single use and expire. `device` is the app's stable install identifier: pairing again with the same
`device` replaces that client's token instead of adding a second client. Wrong codes: `404 not_found`; more than 10
failed attempts a minute from one address: `429`.

The hub also mints codes from the command line (`hub pair --name … [--kind …] [--scopes …] [--kinds …]`): it prints the
code, the `fractonica://pair` link and its QR code; the client redeems the code with `POST /v1/pair` (`--kind worker`
defaults to the `worker` scope). For a script that cannot redeem, `--token` makes the client at once and prints its
token instead of a code. On a start with no admin client it prints a one-time setup link for the first browser,
`http://localhost:8787/#setup=<code>` (a code with every scope but `worker`, kind `browser`).

### Other client endpoints

- `GET /v1` (no auth) → `{ "hub": { "id", "name", "version" }, "api": 1, "embedding": { "model", "dim", "dims": [768,512,256,128], "worker": true|false } }`.
  Apps call it to check an address before pairing. `model` is the model of the stored vectors (`google/embeddinggemma-2`
  until a worker has reported one). The hub advertises itself with Bonjour as `_fractonica-hub._tcp` (TXT `path=/v1`).
- `GET /v1/me` → this client.
- `GET /v1/clients` (admin) → `{ "clients": [Client] }`, each with `records` (count written) and `lastSeen`.
- `PATCH /v1/clients/{id}` (admin) → rename or change scopes/kinds.
- `DELETE /v1/clients/{id}` (admin) → revoke (the token stops working; its records stay). Revoked clients stay in
  `GET /v1/clients` with a `revoked` time, so their records keep a name.

## Records

```json
{
  "id": "0b6c1d0e-6a3e-4c1e-9c55-0d1f9f8f2a11",
  "kind": "journal.entry",
  "time": 1791460800.25,
  "end": null,
  "zone": "Europe/Kyiv",
  "data": { "emoji": "🌙", "title": "Night walk", "markdown": "Saw the **moon** rise…" },
  "text": null,
  "tags": ["walk"],
  "blobs": [
    { "hash": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b", "type": "image/heic",
      "size": 1834221, "role": "photo", "width": 4032, "height": 3024 },
    { "hash": "…", "type": "audio/mp4", "size": 412001, "role": "audio", "duration": 61.4 },
    { "hash": "…", "type": "video/quicktime", "size": 22014411, "role": "video", "duration": 12.0,
      "width": 1920, "height": 1080, "poster": "…hash of a jpeg also listed with role poster…" }
  ],
  "created": 1791460800.25,
  "updated": 1791460912.8,
  "deleted": false,

  "source": "c_01K8…",
  "editor": "c_01K8…",
  "rev": 1042,
  "fx": { "stamp": "…", "clock": "34η 29ι 21λ" }
}
```

Written by the client:

| field | | |
|---|---|---|
| `id` | required | Chosen by the producer, unique per hub: `[A-Za-z0-9._:-]{1,128}`. The apps use lowercase UUIDs. A periodic logger should use a deterministic id (`cpu:studio:1791460800`) so a retry never duplicates. |
| `kind` | required | Dotted lowercase, `[a-z0-9]+(\.[a-z0-9_-]+)+`: `journal.entry`, `computer.usage`, `sensor.temperature`. |
| `time` | required | When the thing happened. The journal's timeline and the change of a record's place in it are both by `time`. |
| `end` | optional | End of a span (a focus session, a sleep). |
| `zone` | optional | IANA zone of the producer at `time`, for Earth-time display. |
| `data` | required | Kind-specific JSON object (≤ 1 MB). |
| `text` | optional | Searchable text, when the kind is not one the hub knows how to read (below). |
| `tags` | optional | Short strings. |
| `blobs` | optional | Attached files in display order: `hash` (lowercase hex SHA-256), `type` (MIME), `size`, `role` (`photo`, `video`, `audio`, `poster`, `file`, or kind-specific), optional `name`, `width`, `height`, `duration`, `poster` (hash of a still for a video, itself listed as a blob with role `poster`). |
| `created` | required | Producer clock. |
| `updated` | required | Producer clock, the version for last-writer-wins. |
| `deleted` | optional | `true` makes the record a tombstone; the hub then stores `data: {}`, `text: null`, `tags: []`, `blobs: []`. |

Set by the hub (ignored if sent): `source` (the creating client), `editor` (the last writing client), `rev` (the
hub-wide change number of its latest change, strictly increasing), `fx` (the Fractonica reading of `time`, for display:
`stamp` as the web app prints a moment, `clock` the minor clock), and on reads that want it, `vectors` (see Search).

Searchable text by kind, as a title and a body: `journal.entry` → title `emoji title`, body `markdown` (and
`data.transcript` if present); any other kind → title `data.emoji data.title`, body `text`, else `data.text`, else
`data.summary`. Empty title and body: nothing (vectors then come from media alone; no text and no media: no vectors).

### Kinds the apps know

`journal.entry` — a journal post.
```json
{ "emoji": "🌙", "title": "optional", "markdown": "CommonMark text", "transcript": "optional, of the audio" }
```
Media are the record's `blobs`: roles `photo`, `video` (with a `poster`), `audio`. Everything about the entry that is
not text lives in `blobs`; an entry with only a voice note has empty `markdown`.

An entry captured on a clock **moment** (the app prompts before every Helion quarter boundary and captures at the exact
moment) also has
```json
"capture": { "at": 1791460800.0, "level": "delta", "boundary": "node", "rarity": "epic" }
```
`at` is the boundary's exact time (the record's `time` is the same), `level` the longest period with a quarter boundary
there (`helion`, `nuclide`, `delta`, `gamma`, `beta`, `alpha`), `boundary` which one (`start`, `peak`, `node`, `valley`;
a period's end is the next one's `start`), and `rarity` follows from the level: `rare` (Helion and Nuclide, blue),
`epic` (Delta, purple), `legendary` (Gamma, yellow), `mythic` (Beta, red), `cosmic` (Alpha, rainbow). An entry without
`capture` is `common` (grey). Photos taken by the front and back cameras at once have roles `photo` with `name`
`front` and `back`.

Other kinds are shown generically by the apps and the web UI: the emoji from `data.emoji` if any, `data.title` or the
kind, the searchable text, numbers from `data` as a compact key/value list (`sensor.temperature`
`{ "celsius": 21.5, "where": "studio" }` → "celsius 21.5 · where studio"), and blobs as attachments.

### Writing

Upload blobs first (below), then the record. A record that names a blob the hub does not have is
`422 unprocessable` with `details.missing: [hash]`.

`PUT /v1/records/{id}` — create or replace one record (body: the record). Rules, in order:
1. No record with this id: stored. `201` with the stored record.
2. Stored `updated` is newer than the incoming one: not stored. `409 conflict`, `details.current` = the stored record.
   (The client should adopt it.)
3. Same `updated` and same content: nothing changes, `200` with the stored record (idempotent retry).
4. Otherwise stored, `200`. Ties of `updated` with different content go to the lexicographically greater SHA-256 of the
   canonical JSON of the written fields, so every hub and client agree; the losing side of a tie gets `409` as in 2.

   **Canonical JSON**: the object `{ id, kind, time, end, zone, data, text, tags, blobs, created, updated, deleted }`
   after normalisation (absent `end`, `zone`, `text` → `null`; absent `tags`, `blobs` → `[]`; `deleted` → `false`;
   unknown fields dropped, also inside blob entries, whose absent optional fields are left out; a tombstone as above),
   serialised with object keys sorted by UTF-16 code units at every depth, no whitespace, strings and numbers as
   ECMAScript `JSON.stringify` writes them (shortest round-trip numbers, `1` not `1.0`). The hash is lowercase hex.
   The record a write returns is exactly that normalised form, so a client can store it as is.

`POST /v1/records/batch` — up to 500 records, `{ "records": [Record] }` → `200`
```json
{ "results": [ { "id": "…", "status": 201, "record": { } },
               { "id": "…", "status": 409, "error": { "code": "conflict", "details": { "current": { } } } } ] }
```
Each item is decided as if it were its own `PUT`.

`DELETE /v1/records/{id}` → writes a tombstone (`deleted: true`, `data: {}`, `blobs: []`, `updated` = now, or the
stored `updated` + 0.001 when that is later, so the delete always wins) and returns it; `404` for an unknown id.
Devices that delete offline `PUT` the tombstone with their own `updated` instead. Tombstones stay in the change feed so every device learns of the delete; they are never listed or searched.

### Reading

`GET /v1/records/{id}` → the record (tombstones too).

`GET /v1/records` → `{ "records": [Record], "cursor": "…", "more": bool }`, newest `time` first. Query:
`kind` (repeatable, globs allowed), `source` (repeatable), `since`, `until` (by `time`), `tag`, `q` (keyword filter
over the searchable text), `limit` (default 50, max 500), `cursor`. Tombstones are left out.

`GET /v1/changes?after=<rev>` → the sync feed, oldest change first, tombstones included:
```json
{ "changes": [Record], "cursor": 1042, "more": false }
```
Query: `after` (default 0 = everything), `kind` (repeatable, globs), `limit` (default 200, max 1000), `wait` (seconds,
≤ 30: when there is nothing after `after`, hold the request until something changes or the time runs out, then answer
with an empty list). A client stores `cursor` and passes it as the next `after`. A new device reads from 0 and gets the
whole hub (filtered by its `kinds`).

`GET /v1/kinds` → `{ "kinds": [ { "kind": "journal.entry", "count": 312, "sources": [ { "id", "name", "count" } ], "first": t, "last": t } ] }`.

## Blobs

Content-addressed by SHA-256 (lowercase hex). A blob is uploaded once and shared by every record that names it.

- `POST /v1/blobs/check` (write) `{ "hashes": [...] }` → `{ "missing": [...] }`.
- `PUT /v1/blobs/{hash}` (write), body = the raw bytes, `Content-Type` = the MIME type. The hub streams to disk,
  verifies the hash (`422` on mismatch) and answers `201` (new) or `200` (already had it). Max size is the hub's
  setting (default 4 GiB; `413` above it).
- `GET /v1/blobs/{hash}` (read) → the bytes with their type, `ETag: "<hash>"`, `Cache-Control: private, max-age=31536000, immutable`,
  and `Range` support (video and audio seek).
- `GET /v1/blobs/{hash}?thumb=<px>` (read) → a JPEG whose long side is at most `px` (64 … 2048), made on demand from an
  image or a video's first frame and cached. `404` when the hub cannot make one (no `ffmpeg`/`sips`); clients then fall
  back to the original or the `poster`.

A client with `read` may fetch a blob only if some live record it can read names it; a client with `worker` may fetch
any blob a live record names (the media of its jobs). Otherwise `404`. Blobs no live record names are deleted by the
hub after a grace period (24 h from upload or from losing their last record).

## Search and vectors

The worker embeds every live record with **EmbeddingGemma 2** (`google/embeddinggemma-2`, 768 dimensions, Matryoshka:
the first 512, 256 or 128 dimensions, re-normalised, are smaller usable vectors). A record gets one or more vectors,
each a **part**:

- `record`: the whole record: its searchable text, as `title: {emoji title} | text: {text}`, interleaved with its media
  (`<|image|>` for photos and video posters, `<|audio|>` for audio, `<|video|>` for video), within the model's
  8,192-token budget (the worker trims audio and video first).
- `blob:<hash>`: one per photo, video and audio blob on its own, so a search can land on the one photo that matches.
  A video whose poster stood in for it (below) still gets `blob:<video hash>`.

Media the worker cannot decode are left out: a record's result may have fewer `blob:` parts than it has media, or only
`record`, and the hub keeps what came.

`POST /v1/search` (search)
```json
{ "query": "the night the moon was huge", "mode": "auto", "kinds": ["journal.*"], "since": null, "until": null, "limit": 20 }
```
→
```json
{ "mode": "semantic",
  "results": [ { "record": { }, "score": 0.71, "part": "record" },
               { "record": { }, "score": 0.64, "part": "blob:3a7b…" } ] }
```
`mode`: `semantic` (cosine similarity of the query's vector, embedded with the `SearchQuery` prompt, against every part;
a record's score is its best part's), `keyword` (case- and accent-insensitive word match over the searchable text,
ranked by matches and recency), `auto` (semantic when a worker is connected, else keyword; the response says which ran).
One result per record. `score` is cosine similarity in semantic mode, a 0…1 rank in keyword mode.

`POST /v1/embed` (search) — embed queries for clients that rank on their own (the apps, offline-capable):
```json
{ "inputs": ["the night the moon was huge"], "task": "query", "dim": 256 }
```
→ `{ "model": "google/embeddinggemma-2", "dim": 256, "vectors": ["<base64>"] }`. `task`: `query` (SearchQuery prompt) or
`document` (the worker prefixes each input with `title: none | text: `, the document prompt with no title). Both reach
the worker as an `embed.query` job carrying that `task`. `dim`: 768, 512, 256 or 128. `503` when no worker is
connected or it does not answer in time.

`GET /v1/vectors?after=<vrev>&dim=256` (read) — the vector feed, so a device keeps a copy of every part's vector and can
rank a query locally:
```json
{ "model": "google/embeddinggemma-2", "dim": 256,
  "vectors": [ { "record": "0b6c…", "part": "record", "vector": "<base64>", "vrev": 88 },
               { "record": "9f00…", "part": null, "vector": null, "vrev": 89 } ],
  "cursor": 89, "more": false }
```
Vectors are little-endian Float32, L2-normalised at the requested `dim`, base64-encoded. When a record changes or is
deleted its old vectors are dropped: the feed then has one entry with `part: null, vector: null` for that record
("forget every vector of this record"), followed by its new vectors when the worker has made them. When the hub's model
changes, `vrev` restarts: the hub's `GET /v1` reports the model, and a client whose stored model differs starts again
from 0. Query: `after`, `dim` (default 256), `kind` (repeatable), `limit` (default 500, max 2000).

## Worker protocol

The worker is an ordinary client with the `worker` scope. It needs only outbound HTTP, so it can run on another
machine (a GPU box) than the hub.

`GET /v1/worker/jobs?wait=25&max=8` → `{ "jobs": [Job] }`, empty after `wait` seconds with nothing to do. Taking a job
leases it for 120 s; a job not finished in time goes back to the queue. Failures are counted per job: an expired lease
counts as one, and so does an `{ "error", "retry": true }` answer; the third failure parks the job (`"retry": false`
parks it at once). Parked record jobs are shown in the web UI and go back to the queue with `POST /v1/worker/retry` or
when their record changes; a parked query job fails its `/v1/search` or `/v1/embed` with `503`. Query jobs (from
`/v1/search` and `/v1/embed`) always come before record jobs.

```json
{ "id": "j_…", "type": "embed.query", "inputs": ["…"], "task": "query" }
{ "id": "j_…", "type": "embed.record", "record": { },
  "text": "title: 🌙 Night walk | text: Saw the moon rise…",
  "media": [ { "hash": "…", "type": "image/heic", "role": "photo", "url": "/v1/blobs/…" },
             { "hash": "v…", "type": "video/quicktime", "role": "video", "url": "/v1/blobs/v…", "duration": 12.0, "poster": "p…" },
             { "hash": "p…", "type": "image/jpeg", "role": "poster", "url": "/v1/blobs/p…", "video": "v…" } ] }
```
For `embed.record` the hub has already composed the text from the kind; `media` lists the blobs to embed in record
order (`photo`, `video`, `audio`; `duration` when known), each video followed by its poster when the record lists one
(role `poster`, `video` = the video's hash). Posters: when the worker can decode the video it embeds the video and
drops the poster; when it cannot, the poster replaces the video (as `<|image|>` in `record`) and its vector is the
video's `blob:<video hash>` part. A poster never has a part of its own. Blob URLs are relative to the hub and fetched
with the worker's token.

`POST /v1/worker/jobs/{id}` — finish a job:
```json
{ "model": "google/embeddinggemma-2", "vectors": [ { "part": "record", "vector": "<base64 768 float32>" } ] }
```
or `{ "error": "message", "retry": true }`. Vectors are full 768-dimension, L2-normalised; the hub truncates and
re-normalises for smaller `dim`s. A query job's vectors are in input order with `part` `"0"`, `"1"`, ….

The answer is `200 { "ok": true }`;
`404` when the job is gone (its record changed or was deleted, or a query timed out): the worker drops it. A job leased
again after its lease ran out may still be finished by the first worker; the first answer wins.

`GET /v1/worker` (admin) → `{ connected, lastSeen, model, device, dtype, version, modalities, dim, vrev, queue: { queued, leased,
parked, queries }, vectors, records, parked: [ { job, record, kind, attempts, error } ] }` for the web UI;
`POST /v1/worker/retry` (admin) puts every parked job back in the queue.

`POST /v1/worker/heartbeat` `{ "model": "…", "device": "mps", "dtype": "bf16", "version": "…", "modalities": ["text","image","audio","video"] }`
→ `{ "ok": true }`, every 30 s while idle (other fields are ignored); the hub counts a worker as connected while its
last heartbeat or job poll is under 60 s old.

A worker gets its token like any client: `hub pair --name "GPU box" --kind worker` (scope `worker`) prints a code and a
link, and the worker redeems the code with `fx-worker login --hub URL --code XXXX-XXXX` (`POST /v1/pair`).

## Live updates

`GET /v1/events` (read) — Server-Sent Events: `event: change` with `{ "rev", "id", "kind", "deleted" }`, `event: vector`
with `{ "vrev", "record" }`, `event: worker` with `{ "connected": bool }` (also sent once on connect), `event: model`
with `{ "model" }` when the embedding model changed (vectors restart), and for admin clients `event: clients` when a
device paired. Browsers pass the token as `?token=` because
`EventSource` cannot set headers. Apps may use `GET /v1/changes?wait=` instead.

## Writing a provider

```sh
# once: make a token for the script (without --token: a code to redeem with POST /v1/pair)
node hub/bin/hub.mjs pair --name "Studio thermometer" --kind service --scopes write --kinds 'sensor.*' --token
# every minute:
curl -X PUT "$HUB/v1/records/temp:studio:$(date +%s)" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"kind\":\"sensor.temperature\",\"time\":$(date +%s),\"created\":$(date +%s),\"updated\":$(date +%s),\"data\":{\"celsius\":21.5,\"where\":\"studio\"}}"
```
