// The timelapse logger: a frame from a camera at every Flavon's start (the clock's own, lib/clock.js), and at the end
// of each span (a Helion, or `every` Flavons) a video of the span's frames written to the hub as a journal entry.
//
// Frames wait on disk, a folder per span (`frames/<its first Flavon>/`: `<Flavon>.jpg`, `frames.jsonl`, `span.json`),
// so a restart goes on with the span it was in and a span the logger was down at the end of is closed when it starts
// again; a span whose record the hub did not take (away, say) is tried again every minute. The record's id is the
// span's (`timelapse.<camera>.<first Flavon>`), so a retry never makes a second one. Its status
// (`worker.status.<client id>`) says it is alive every `heartbeat` seconds, and after each record and each change in
// the camera.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clockText, dateText, FLAVON_SECONDS, flavonStart, nextFlavon, PER_HELION, segmentOf, spanName } from './clock.js';
import { makeVideo } from './video.js';

export const KIND_STATUS = 'worker.status';
const KIND_ENTRY = 'journal.entry';

export class Timelapse {
  /**
   * @param {object} o
   * @param {import('./hub.js').Hub} o.hub
   * @param {{ device: string, capture(file: string): Promise<{via, width, height, bytes}> }} o.camera
   * @param {string} o.dir             its folder (frames/, state.json)
   * @param {{flavons:number, name:string}} o.every   a record each (lib/clock.js parseEvery)
   */
  constructor({ hub, camera, dir, every, fps = 30, stamp = true, keepFrames = false, clientId, name, version = '1.0.0',
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone, heartbeat = 600, retry = 60, log = () => {},
    now = () => Date.now() / 1000, encode = makeVideo, earthTime = null } = {}) {
    Object.assign(this, { hub, camera, dir, every, fps, stamp, keepFrames, clientId, name, version, zone, heartbeat, retry, log, now, encode });
    this.earthTime = earthTime ?? ((t) => new Date(t * 1000).toLocaleTimeString('en-GB', { timeZone: zone }));
    this.framesDir = join(dir, 'frames');
    this.stateFile = join(dir, 'state.json');
    mkdirSync(this.framesDir, { recursive: true });
    const state = existsSync(this.stateFile) ? JSON.parse(readFileSync(this.stateFile, 'utf8')) : {};
    this.done = new Set(state.done ?? []);
    this.last = state.last ?? null;
    this.records = state.records ?? 0;
    this.started = this.now();
    this.span = null;
    this.taken = 0;
    this.missed = 0;
    this.camState = 'starting';
    this.camProblem = null;
    this.lastFlavon = null;
    this.closing = Promise.resolve();
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

  /** Flavon n began at `at`: its frame, and the span before closed when this one opens a new span. */
  async flavon(n, at) {
    this.lastFlavon = n;
    const seg = segmentOf(n, this.every.flavons);
    if (this.span?.start !== seg.start) {
      if (this.span) this.close(this.span);
      this.span = this.open(seg);
    }
    const file = join(this.spanDir(seg.start), `${n}.jpg`);
    const t0 = this.now();
    try {
      const f = await this.camera.capture(file);
      appendFileSync(join(this.spanDir(seg.start), 'frames.jsonl'),
        `${JSON.stringify({ n, at: t0, late: +(t0 - at).toFixed(3), ms: Math.round((this.now() - t0) * 1000), via: f.via, width: f.width, height: f.height, bytes: f.bytes })}\n`);
      this.taken++;
      this.span.frames++;
      this.cameraIs('ok', null, f.via);
    } catch (e) {
      rmSync(file, { force: true });
      this.missed++;
      this.span.missed++;
      this.cameraIs('failing', e.message);
    }
  }

  cameraIs(state, problem, via = null) {
    const was = this.camState;
    this.camState = state;
    this.camProblem = problem;
    if (via) this.via = via;
    if (state === was) return;
    if (state === 'ok') this.log(`${this.camera.device}: frames coming${was === 'failing' ? ' again' : ''}${via === 'live' ? ' (from its live view)' : ''}`);
    else this.log(`${this.camera.device}: no frame (${problem}); trying every Flavon`);
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
    const frames = readFrames(dir).length;
    this.log(`${spanName(seg, this.every)}: ${frames ? `${frames} frames so far, going on` : 'taking a frame each Flavon'} until ${this.earthTime(flavonStart(seg.end))}`);
    return { ...seg, frames, missed: 0 };
  }

  /** Spans on disk that have ended and have no record yet: closed one after another. */
  closeEnded() {
    const now = this.now();
    for (const name of readdirSync(this.framesDir)) {
      const start = Number(name);
      if (!Number.isInteger(start) || this.span?.start === start || this.closingNow?.has(start)) continue;
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
    this.closingNow ??= new Set();
    if (this.closingNow.has(seg.start)) return;
    this.closingNow.add(seg.start);
    this.closing = this.closing.then(() => this.record(seg)).catch((e) => {
      this.log(`${spanName(seg, seg.every ?? this.every)}: no record yet (${e.message}); trying again in ${this.retry} s`);
    }).finally(() => this.closingNow.delete(seg.start));
  }

  // ---- the record --------------------------------------------------------------------------------------------------

  async record(seg) {
    const dir = this.spanDir(seg.start);
    const every = seg.every ?? this.every;
    const frames = readFrames(dir).filter((f) => f.n >= seg.start && f.n < seg.end && existsSync(f.file));
    const name = spanName(seg, every);
    if (frames.length < 2) {
      // a span it started on the last Flavon of, or the camera away all along: no video worth the name
      this.log(`${name}: ${frames.length ? 'one frame' : 'no frames'}, no record`);
      this.finish(seg.start);
      return;
    }
    const v = await this.encode({
      frames, dir, fps: this.fps,
      stamp: this.stamp ? (n) => ({ left: `${dateText(n)}\n${clockText(n)}`, right: this.earthTime(flavonStart(n)) }) : null,
    });
    const video = await this.hub.upload(v.video, 'video/mp4');
    const poster = await this.hub.upload(v.poster, 'image/jpeg');
    const first = frames[0].n;
    const last = frames.at(-1).n;
    // Flavons without a frame between its first and last (held in the video); a span the logger started in the middle
    // of, or stopped before the end of, is simply shorter
    const missed = last - first + 1 - frames.length;
    const t = this.now();
    const record = {
      id: `timelapse.${this.camera.device}.${seg.start}`,
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
        markdown: `${frames.length} frames from ${this.camera.device}, one each Flavon${missed ? ` (${missed} missed)` : ''}, played at ${this.fps} a second.`,
        timelapse: {
          camera: this.camera.device, every: every.flavons, start: flavonStart(seg.start), end: flavonStart(seg.end),
          frames: frames.length, missed, fps: this.fps,
        },
      },
      blobs: [
        { ...video, role: 'video', name: 'timelapse', width: v.width, height: v.height, duration: +v.duration.toFixed(3), poster: poster.hash },
        { ...poster, role: 'poster', width: v.width, height: v.height },
      ],
    };
    try {
      await this.hub.put(record);
    } catch (e) {
      if (e.status !== 409) throw e; // 409: the hub has it already, edited since (a device's change wins)
    }
    this.records++;
    this.last = { record: record.id, title: record.data.title, at: t, start: record.time, end: record.end, frames: frames.length, missed, duration: v.duration, bytes: video.size };
    this.log(`${name}: recorded, ${frames.length} frames${missed ? ` (${missed} missed)` : ''}, ${v.duration.toFixed(1)} s of video, ${(video.size / 1e6).toFixed(1)} MB`);
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
      for (const f of ['timelapse.mp4', 'poster.jpg']) rmSync(join(dir, f), { force: true });
      writeFileSync(join(dir, 'recorded.json'), JSON.stringify({ record: this.last?.record ?? null, at: this.now() }));
    }
  }

  // ---- its status --------------------------------------------------------------------------------------------------

  statusRecord() {
    const t = this.now();
    const seg = this.span;
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
        text: `A frame from ${this.camera.device} each Flavon, a video each ${this.every.name}`,
        camera: { device: this.camera.device, state: this.camState, problem: this.camProblem, via: this.via ?? null },
        every: { flavons: this.every.flavons, name: this.every.name },
        fps: this.fps,
        span: seg ? { name: spanName(seg, this.every), start: flavonStart(seg.start), end: flavonStart(seg.end), frames: seg.frames, missed: seg.missed } : null,
        last: this.last,
        frames: this.taken,
        missed: this.missed,
        records: this.records,
      },
    };
  }

  async writeStatus() {
    await this.hub.put(this.statusRecord());
  }
}

const ceilMs = (t) => Math.ceil(t * 1000) / 1000;

/** A span's frames on disk, by Flavon (the last line for a Flavon wins). */
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
