// The timelapse logger: a frame from each of its cameras at every Flavon's start (the clock's own, lib/clock.js), and
// at the end of each span (a Helion, or `every` Flavons) a journal entry with a video of the span's frames from each
// camera.
//
// Frames wait on disk, a folder per span (`frames/<its first Flavon>/`: `span.json`, and a folder per camera with
// `<Flavon>.jpg` and `frames.jsonl`), so a restart goes on with the span it was in and a span the logger was down at
// the end of is closed when it starts again; a span whose record the hub did not take (away, say) is tried again
// every minute. The record's id is the logger's and the span's (`timelapse.<client id>.<first Flavon>`), so a retry
// never makes a second one. Its status (`worker.status.<client id>`) says it is alive every `heartbeat` seconds, and
// after each record and each change in a camera.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clockText, dateText, FLAVON_SECONDS, flavonStart, nextFlavon, PER_HELION, segmentOf, spanName } from './clock.js';
import { makeVideo } from './video.js';

export const KIND_STATUS = 'worker.status';
const KIND_ENTRY = 'journal.entry';
/** A camera's alias, which names its folder in a span. */
const CAMERA_RE = /^[A-Za-z0-9._:-]{1,64}$/;

export class Timelapse {
  /**
   * @param {object} o
   * @param {import('./hub.js').Hub} o.hub
   * @param {{ device: string, capture(file: string): Promise<{via, width, height, bytes}> }[]} o.cameras
   * @param {string} o.dir             its folder (frames/, state.json)
   * @param {{flavons:number, name:string}} o.every   a record each (lib/clock.js parseEvery)
   */
  constructor({ hub, cameras, dir, every, fps = 30, stamp = true, keepFrames = false, clientId, name, version = '1.0.0',
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone, heartbeat = 600, retry = 60, log = () => {},
    now = () => Date.now() / 1000, encode = makeVideo, earthTime = null, legacyCamera = null } = {}) {
    Object.assign(this, { hub, cameras, dir, every, fps, stamp, keepFrames, clientId, name, version, zone, heartbeat, retry, log, now, encode });
    for (const c of cameras) if (!CAMERA_RE.test(c.device)) throw new Error(`a camera named ${c.device}`);
    this.earthTime = earthTime ?? ((t) => new Date(t * 1000).toLocaleTimeString('en-GB', { timeZone: zone }));
    this.framesDir = join(dir, 'frames');
    this.stateFile = join(dir, 'state.json');
    mkdirSync(this.framesDir, { recursive: true });
    migrateSpans(this.framesDir, legacyCamera ?? cameras[0]?.device);
    const state = existsSync(this.stateFile) ? JSON.parse(readFileSync(this.stateFile, 'utf8')) : {};
    this.done = new Set(state.done ?? []);
    this.last = state.last ?? null;
    this.records = state.records ?? 0;
    this.started = this.now();
    this.span = null;
    // per camera: frames taken and missed since the start, its state, why it fails, where its frames come from
    this.cams = new Map(cameras.map((c) => [c.device, { taken: 0, missed: 0, state: 'starting', problem: null, via: null }]));
    this.lastFlavon = null;
    this.closing = Promise.resolve();
    this.closingNow = new Set();
    this.stopped = false;
    this.timers = [];
    this.wake = null;
  }

  // ---- running -----------------------------------------------------------------------------------------------------

  async start() {
    await this.writeStatus().catch((e) => this.log(`status: ${e.message}`));
    this.closeEnded();
    this.timers.push(setInterval(() => this.writeStatus().catch(() => {}), this.heartbeat * 1000));
    this.timers.push(setInterval(() => this.closeEnded(), this.retry * 1000));
    this.running = this.loop();
  }

  async stop() {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.wake?.();
    await this.running;
    await this.closing;
    // the hub's page shows it stopped at once, not two heartbeats later
    this.stoppedAt = this.now();
    await this.writeStatus().catch(() => {});
  }

  /** Sleeps until t (or a stop): short naps, so a Mac that slept wakes to the right Flavon, not a stale timer. */
  async until(t) {
    while (!this.stopped) {
      const left = t - this.now();
      if (left <= 0) return;
      await new Promise((r) => {
        this.wake = r;
        setTimeout(r, Math.min(left, 5) * 1000);
      });
    }
  }

  async loop() {
    while (!this.stopped) {
      let n = nextFlavon(this.now());
      if (n === null) {
        this.log('the clock has no Flavons here (outside its catalogue): stopping');
        return;
      }
      if (this.lastFlavon !== null && n <= this.lastFlavon) n = this.lastFlavon + 1;
      const at = flavonStart(n);
      await this.until(at);
      if (this.stopped) return;
      const late = this.now() - at;
      if (late > FLAVON_SECONDS / 2) continue; // woke after a sleep: the Flavons it slept through are not taken
      await this.flavon(n, at);
    }
  }

  /** Flavon n began at `at`: a frame from each camera at once, and the span before closed when this one opens a new span. */
  async flavon(n, at) {
    this.lastFlavon = n;
    const seg = segmentOf(n, this.every.flavons);
    if (this.span?.start !== seg.start) {
      if (this.span) this.close(this.span);
      this.span = this.open(seg);
    }
    const span = this.span;
    await Promise.all(this.cameras.map(async (camera) => {
      const dir = join(this.spanDir(seg.start), camera.device);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${n}.jpg`);
      const c = this.cams.get(camera.device);
      const t0 = this.now();
      try {
        const f = await camera.capture(file);
        appendFileSync(join(dir, 'frames.jsonl'),
          `${JSON.stringify({ n, at: t0, late: +(t0 - at).toFixed(3), ms: Math.round((this.now() - t0) * 1000), via: f.via, width: f.width, height: f.height, bytes: f.bytes })}\n`);
        c.taken++;
        span.frames[camera.device] = (span.frames[camera.device] ?? 0) + 1;
        this.cameraIs(camera.device, 'ok', null, f.via);
      } catch (e) {
        rmSync(file, { force: true });
        c.missed++;
        span.missed[camera.device] = (span.missed[camera.device] ?? 0) + 1;
        this.cameraIs(camera.device, 'failing', e.message);
      }
    }));
  }

  cameraIs(device, state, problem, via = null) {
    const c = this.cams.get(device);
    const was = c.state;
    c.state = state;
    c.problem = problem;
    if (via) c.via = via;
    if (state === was) return;
    if (state === 'ok') this.log(`${device}: frames coming${was === 'failing' ? ' again' : ''}${via === 'live' ? ' (from its live view)' : ''}`);
    else this.log(`${device}: no frame (${problem}); trying every Flavon`);
    this.writeStatus().catch(() => {});
  }

  spanDir(start) {
    return join(this.framesDir, String(start));
  }

  open(seg) {
    const dir = this.spanDir(seg.start);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'span.json');
    if (!existsSync(file)) writeFileSync(file, JSON.stringify({ ...seg, every: this.every }));
    const frames = Object.fromEntries(cameraDirs(dir).map((cam) => [cam, readFrames(join(dir, cam)).length]));
    const so = Object.values(frames).reduce((a, b) => a + b, 0);
    this.log(`${spanName(seg, this.every)}: ${so ? `${so} frames so far, going on` : 'taking a frame each Flavon'} until ${this.earthTime(flavonStart(seg.end))}`);
    return { ...seg, frames, missed: {} };
  }

  /** Spans on disk that have ended and have no record yet: closed one after another. */
  closeEnded() {
    const now = this.now();
    for (const name of readdirSync(this.framesDir)) {
      const start = Number(name);
      if (!Number.isInteger(start) || this.span?.start === start || this.closingNow.has(start)) continue;
      if (existsSync(join(this.spanDir(start), 'recorded.json'))) continue; // kept (--keep-frames)
      if (this.done.has(start)) {
        rmSync(this.spanDir(start), { recursive: true, force: true });
        continue;
      }
      const seg = readSpan(this.spanDir(start));
      if (seg && flavonStart(seg.end) <= now) this.close(seg);
    }
  }

  close(seg) {
    if (this.closingNow.has(seg.start)) return;
    this.closingNow.add(seg.start);
    this.closing = this.closing.then(() => this.record(seg)).catch((e) => {
      this.log(`${spanName(seg, seg.every ?? this.every)}: no record yet (${e.message}); trying again in ${this.retry} s`);
    }).finally(() => this.closingNow.delete(seg.start));
  }

  // ---- the record --------------------------------------------------------------------------------------------------

  /** The cameras' frames of a span, cameras in the logger's order (others after, by name); a camera with one frame or none is left out. */
  spanCameras(seg) {
    const dir = this.spanDir(seg.start);
    const order = this.cameras.map((c) => c.device);
    const rank = (c) => (order.includes(c) ? order.indexOf(c) : order.length);
    return cameraDirs(dir)
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((camera) => ({ camera, dir: join(dir, camera), frames: readFrames(join(dir, camera)).filter((f) => f.n >= seg.start && f.n < seg.end && existsSync(f.file)) }))
      .filter((c) => c.frames.length >= 2); // one frame (a span it started on the last Flavon of) is no video worth the name
  }

  async record(seg) {
    const every = seg.every ?? this.every;
    const name = spanName(seg, every);
    const cams = this.spanCameras(seg);
    if (!cams.length) {
      this.log(`${name}: no camera has two frames, no record`);
      this.finish(seg.start);
      return;
    }
    const blobs = [];
    const facts = [];
    for (const c of cams) {
      const v = await this.encode({
        frames: c.frames, dir: c.dir, fps: this.fps,
        stamp: this.stamp ? (n) => ({ left: `${dateText(n)}\n${clockText(n)}`, right: `${c.camera}\n${this.earthTime(flavonStart(n))}` }) : null,
      });
      const video = await this.hub.upload(v.video, 'video/mp4');
      const poster = await this.hub.upload(v.poster, 'image/jpeg');
      blobs.push(
        { ...video, role: 'video', name: c.camera, width: v.width, height: v.height, duration: +v.duration.toFixed(3), poster: poster.hash },
        { ...poster, role: 'poster', name: c.camera, width: v.width, height: v.height },
      );
      const first = c.frames[0].n;
      const last = c.frames.at(-1).n;
      // Flavons without a frame between its first and last (held in the video); a span the logger started in the
      // middle of, or stopped before the end of, is simply shorter
      facts.push({ camera: c.camera, frames: c.frames.length, missed: last - first + 1 - c.frames.length, first, last, duration: v.duration, bytes: video.size });
    }
    const first = Math.min(...facts.map((f) => f.first));
    const last = Math.max(...facts.map((f) => f.last));
    const t = this.now();
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const said = facts.map((f, i) => `${i === 0 ? plural(f.frames, 'frame') : f.frames} from ${f.camera}${f.missed ? ` (${f.missed} missed)` : ''}`);
    const record = {
      id: `timelapse.${this.clientId}.${seg.start}`,
      kind: KIND_ENTRY,
      // up to the millisecond, so a reading of the time (the hub's fx) is never the Flavon before
      time: ceilMs(flavonStart(first)),
      end: ceilMs(flavonStart(last + 1)),
      zone: this.zone,
      created: t,
      updated: t,
      tags: ['timelapse'],
      data: {
        emoji: '🎞️',
        title: `Timelapse · ${name}`,
        markdown: `${said.length > 1 ? `${said.slice(0, -1).join(', ')} and ${said.at(-1)}` : said[0]}, one each Flavon, played at ${this.fps} a second.`,
        timelapse: {
          every: every.flavons, start: flavonStart(seg.start), end: flavonStart(seg.end), fps: this.fps,
          cameras: facts.map((f) => ({ camera: f.camera, frames: f.frames, missed: f.missed, start: ceilMs(flavonStart(f.first)), end: ceilMs(flavonStart(f.last + 1)) })),
        },
      },
      blobs,
    };
    try {
      await this.hub.put(record);
    } catch (e) {
      if (e.status !== 409) throw e; // 409: the hub has it already, edited since (a device's change wins)
    }
    this.records++;
    this.last = {
      record: record.id, title: record.data.title, at: t, start: record.time, end: record.end,
      frames: facts.reduce((a, f) => a + f.frames, 0), cameras: facts.map((f) => ({ camera: f.camera, frames: f.frames, missed: f.missed })),
      duration: Math.max(...facts.map((f) => f.duration)), bytes: facts.reduce((a, f) => a + f.bytes, 0),
    };
    this.log(`${name}: recorded, ${facts.map((f) => `${f.camera} ${f.frames} frames${f.missed ? ` (${f.missed} missed)` : ''}`).join(', ')}, ${(this.last.bytes / 1e6).toFixed(1)} MB of video`);
    this.finish(seg.start);
    await this.writeStatus().catch(() => {});
  }

  finish(start) {
    this.done.add(start);
    const done = [...this.done].sort((a, b) => a - b).slice(-200);
    this.done = new Set(done);
    writeFileSync(this.stateFile, JSON.stringify({ done, last: this.last, records: this.records }, null, 2));
    const dir = this.spanDir(start);
    if (!this.keepFrames) rmSync(dir, { recursive: true, force: true });
    else if (existsSync(dir)) {
      for (const cam of cameraDirs(dir)) for (const f of ['timelapse.mp4', 'poster.jpg']) rmSync(join(dir, cam, f), { force: true });
      writeFileSync(join(dir, 'recorded.json'), JSON.stringify({ record: this.last?.record ?? null, at: this.now() }));
    }
  }

  // ---- its status --------------------------------------------------------------------------------------------------

  statusRecord() {
    const t = this.now();
    const seg = this.span;
    const devices = this.cameras.map((c) => c.device);
    const names = devices.length > 1 ? `${devices.slice(0, -1).join(', ')} and ${devices.at(-1)}` : devices[0];
    return {
      id: `${KIND_STATUS}.${this.clientId}`,
      kind: KIND_STATUS,
      time: this.started,
      created: this.started,
      updated: t,
      data: {
        name: this.name,
        worker: 'timelapse',
        version: this.version,
        started: this.started,
        seen: t,
        heartbeat: this.heartbeat,
        stopped: this.stoppedAt ?? null,
        text: `A frame from ${names} each Flavon, ${devices.length > 1 ? 'their videos' : 'a video'} each ${this.every.name}`,
        cameras: devices.map((device) => {
          const c = this.cams.get(device);
          return { device, state: c.state, problem: c.problem, via: c.via, frames: c.taken, missed: c.missed };
        }),
        every: { flavons: this.every.flavons, name: this.every.name },
        fps: this.fps,
        span: seg ? {
          name: spanName(seg, this.every), start: flavonStart(seg.start), end: flavonStart(seg.end),
          frames: Object.values(seg.frames).reduce((a, b) => a + b, 0), missed: Object.values(seg.missed).reduce((a, b) => a + b, 0),
          cameras: seg.frames,
        } : null,
        last: this.last,
        frames: [...this.cams.values()].reduce((a, c) => a + c.taken, 0),
        missed: [...this.cams.values()].reduce((a, c) => a + c.missed, 0),
        records: this.records,
      },
    };
  }

  async writeStatus() {
    await this.hub.put(this.statusRecord());
  }
}

const ceilMs = (t) => Math.ceil(t * 1000) / 1000;

/**
 * Spans the first version kept (one camera, its frames in the span's own folder) moved into the camera's folder, so a
 * span it was taking goes on and its record has them.
 */
export function migrateSpans(framesDir, camera) {
  if (!camera || !CAMERA_RE.test(camera)) return;
  for (const name of readdirSync(framesDir)) {
    const dir = join(framesDir, name);
    if (!Number.isInteger(Number(name)) || !existsSync(join(dir, 'frames.jsonl'))) continue;
    mkdirSync(join(dir, camera), { recursive: true });
    for (const f of readdirSync(dir)) {
      if (f === 'frames.jsonl' || /^\d+\.jpg$/.test(f)) renameSync(join(dir, f), join(dir, camera, f));
    }
  }
}

/** The cameras that have a folder in a span's. */
function cameraDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && CAMERA_RE.test(e.name)).map((e) => e.name);
}

/** A camera's frames in a span, by Flavon (the last line for a Flavon wins). */
export function readFrames(dir) {
  const file = join(dir, 'frames.jsonl');
  if (!existsSync(file)) return [];
  const by = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    try {
      const f = JSON.parse(line);
      if (Number.isInteger(f.n) && f.width > 0 && f.height > 0) by.set(f.n, { ...f, file: join(dir, `${f.n}.jpg`) });
    } catch {}
  }
  return [...by.values()].sort((a, b) => a.n - b.n);
}

function readSpan(dir) {
  try {
    const s = JSON.parse(readFileSync(join(dir, 'span.json'), 'utf8'));
    return Number.isInteger(s.start) && Number.isInteger(s.end) && s.end > s.start && s.end - s.start <= PER_HELION ? s : null;
  } catch {
    return null;
  }
}
