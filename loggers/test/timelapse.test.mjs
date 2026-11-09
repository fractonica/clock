import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrCamera, parseJpegBlock } from '../lib/camera.js';
import { clockText, dateText, FLAVON_SECONDS, flavonAt, flavonStart, nextFlavon, parseEvery, PER_HELION, segmentOf, spanName } from '../lib/clock.js';
import { Hub } from '../lib/hub.js';
import { agentPlist } from '../lib/launchd.js';
import { readFrames, Timelapse } from '../lib/timelapse.js';
import { assTime, makeVideo, stampsAss } from '../lib/video.js';
import { startHub } from '../../hub/lib/server.js';

const tmp = (t, prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** A JPEG of w×h made by ffmpeg (a test pattern, its frame `i`). */
const jpegs = new Map();
function jpeg(w = 320, h = 240, i = 0) {
  const key = `${w}x${h}@${i}`;
  if (!jpegs.has(key)) {
    jpegs.set(key, execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=1`, '-vf', `select=eq(n\\,${i})`, '-frames:v', '1', '-f', 'mjpeg', 'pipe:1']));
  }
  return jpegs.get(key);
}

test('the clock: Flavons, spans and their names', () => {
  assert.equal(PER_HELION, 2340);
  assert.ok(Math.abs(FLAVON_SECONDS - 7.773) < 0.001);
  const t = 1794230835.04;
  const n = flavonAt(t);
  assert.ok(flavonStart(n) <= t && t < flavonStart(n + 1));
  assert.equal(nextFlavon(t), n + 1);
  assert.equal(nextFlavon(flavonStart(n + 1) - 0.0005), n + 2, 'a boundary a hair ahead counts as passed');
  assert.ok(Math.abs(flavonStart(n + 1) - flavonStart(n) - FLAVON_SECONDS) < 0.01);

  assert.deepEqual(parseEvery('helion'), { flavons: 2340, name: 'Helion' });
  assert.deepEqual(parseEvery('Preon'), { flavons: 65, name: 'Preon' });
  assert.deepEqual(parseEvery('65'), { flavons: 65, name: 'Preon' });
  assert.deepEqual(parseEvery('13λ'), { flavons: 13, name: '13 Flavons' });
  assert.deepEqual(parseEvery('1'), { flavons: 1, name: '1 Flavon' });
  for (const bad of ['0', '2341', 'day', '', '1.5']) assert.equal(parseEvery(bad), null, bad);

  // spans count from the Helion's start: a Preon is ι 0λ … 64λ, and none crosses a Helion
  const seg = segmentOf(n, 65);
  assert.equal(seg.end - seg.start, 65);
  assert.ok(seg.start <= n && n < seg.end);
  assert.match(clockText(seg.start), / 0λ$/);
  assert.match(clockText(seg.end - 1), / 64λ$/);
  assert.equal(spanName(seg, parseEvery('preon')), `Preon ${clockText(seg.start, 'iota')}`);
  const helion = segmentOf(n, 2340);
  assert.equal(helion.start % 2340, 0);
  assert.match(clockText(helion.start), /η 0ι 0λ$/);
  assert.equal(spanName(helion, parseEvery('helion')), `Helion ${clockText(helion.start, 'eta')}`);
  assert.ok(Math.abs(flavonStart(helion.end) - flavonStart(helion.start) - 18189) < 2, 'a Helion is about 5 h 03 min');
  const tail = segmentOf(helion.start + 2339, 7);
  assert.deepEqual(tail, { start: helion.start + 2338, end: helion.start + 2340 }, 'the last span of a Helion is cut short');
  assert.match(dateText(n), /^α\d+ β\d+ γ\d+ δ\d+ ε\d+$/);
});

test('stamps: an event per run of frames, never starting or ending on a frame', () => {
  assert.equal(assTime(62.345), '0:01:02.35');
  assert.equal(assTime(3725), '1:02:05.00');
  const ass = stampsAss([{ first: 0, last: 2, left: 'a\nb', right: '12:00:00' }, { first: 3, last: 3, left: 'c{x}' }], { width: 640, height: 480, fps: 30 });
  const ev = ass.split('\n').filter((l) => l.startsWith('Dialogue'));
  assert.deepEqual(ev, [
    'Dialogue: 0,0:00:00.00,0:00:00.08,Stamp,,0,0,0,,a\\Nb',
    'Dialogue: 0,0:00:00.00,0:00:00.08,Stamp,,0,0,0,,{\\an3}12:00:00',
    'Dialogue: 0,0:00:00.08,0:00:00.12,Stamp,,0,0,0,,cx',
  ]);
  assert.match(ass, /PlayResX: 640\nPlayResY: 480/);
});

test('the video: a frame per Flavon, missed ones held, other sizes scaled, a poster', async (t) => {
  const dir = tmp(t, 'fx-tl-video-');
  const frames = [0, 1, 4, 5].map((i) => {
    const big = i === 4;
    const file = join(dir, `${100 + i}.jpg`);
    writeFileSync(file, jpeg(big ? 640 : 320, big ? 480 : 240, i));
    return { n: 100 + i, file, width: big ? 640 : 320, height: big ? 480 : 240 };
  });
  const stamped = [];
  const v = await makeVideo({ frames, dir, fps: 10, stamp: (n) => (stamped.push(n), { left: `n ${n}`, right: 'r' }) });
  assert.deepEqual([v.width, v.height, v.frames, v.shown], [320, 240, 6, 4]);
  assert.equal(v.duration, 0.6);
  assert.deepEqual(stamped, [100, 101, 104, 105], 'one stamp per frame taken (a held one keeps its own)');
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames,pix_fmt', '-of', 'json', v.video])).streams[0];
  assert.deepEqual([probe.codec_name, probe.width, probe.height, Number(probe.nb_read_frames), probe.pix_fmt], ['h264', 320, 240, 6, 'yuv420p']);
  assert.ok(readFileSync(v.poster).subarray(0, 2).equals(Buffer.from([0xff, 0xd8])));
  assert.equal(existsSync(join(dir, 'video.tmp')), false, 'its work folder is gone');
});

// ---- a stand-in for the hardware hub: camera_snap over REST, and /app/stream (a minimal WebSocket) ---------------
async function fakeFrHub(home, { busy = () => false } = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const input = JSON.parse(body || '{}');
    calls.push({ path: req.url, input });
    res.setHeader('Content-Type', 'application/json');
    if (req.url !== '/api/v1/op/camera_snap') return res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'unknown op' } }));
    if (busy()) return res.end(JSON.stringify({ ok: false, error: { code: 'DEVICE_BUSY', message: 'cam-esp32 cam is streaming already' } }));
    assert.ok(input.out.startsWith(home), 'the hub writes under FR_HOME only');
    mkdirSync(join(input.out, '..'), { recursive: true });
    writeFileSync(input.out, jpeg(320, 240, calls.length));
    res.end(JSON.stringify({ ok: true, data: { job_id: 'j_1', status: 'completed', result: { path: input.out, bytes: jpeg(320, 240, calls.length).length, width: 320, height: 240 } } }));
  });
  const hellos = [];
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (op, payload) => {
      const len = payload.length;
      const head = len < 126 ? Buffer.from([0x80 | op, len]) : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255]) : (() => {
        const b = Buffer.alloc(10);
        b[0] = 0x80 | op;
        b[1] = 127;
        b.writeBigUInt64BE(BigInt(len), 2);
        return b;
      })();
      socket.write(Buffer.concat([head, payload]));
    };
    socket.on('data', (buf) => {
      if ((buf[0] & 0x0f) !== 1) return socket.end();
      const len = buf[1] & 0x7f; // the hello is short
      const mask = buf.subarray(2, 6);
      const text = Buffer.from(buf.subarray(6, 6 + len).map((x, i) => x ^ mask[i % 4])).toString();
      hellos.push(JSON.parse(text));
      send(1, Buffer.from(JSON.stringify({ t: 'stream.welcome', v: 1, device: '80f3da6144d4', alias: 'cam-esp32', instance: 'cam', stream: { kind: 'jpeg', format: 'mjpg1' } })));
      const j = jpeg(640, 480, 7);
      const head = Buffer.alloc(24);
      head.writeUInt32LE(5, 0);
      head.writeUInt32LE(9, 4);
      head.writeUInt16LE(640, 12);
      head.writeUInt16LE(480, 14);
      head.writeUInt32LE(j.length, 20);
      send(2, Buffer.concat([head, j]));
    });
    socket.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, hellos, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) };
}

test('the camera: a snap moved out of FR_HOME, or the live view\'s next frame while it streams', async (t) => {
  const home = tmp(t, 'fx-tl-home-');
  const dir = tmp(t, 'fx-tl-cam-');
  let busy = false;
  const fr = await fakeFrHub(home, { busy: () => busy });
  t.after(() => fr.close());
  writeFileSync(join(home, 'secrets.json'), JSON.stringify({ app_token: 'tok-1', wifi: 'never read' }));
  const cam = new FrCamera({ api: fr.url, device: 'cam-esp32', home, frameSize: 'xga', timeout: 3000 });

  const a = await cam.capture(join(dir, 'a.jpg'));
  assert.deepEqual(a, { via: 'snap', width: 320, height: 240, bytes: readFileSync(join(dir, 'a.jpg')).length });
  assert.equal(fr.calls[0].input.frame_size, 'xga');
  assert.deepEqual(readdirSync(join(home, 'captures', 'cam-esp32', 'timelapse')), [], 'moved, not copied');

  busy = true;
  const b = await cam.capture(join(dir, 'b.jpg'));
  assert.deepEqual([b.via, b.width, b.height], ['live', 640, 480]);
  assert.ok(readFileSync(join(dir, 'b.jpg')).equals(jpeg(640, 480, 7)));
  assert.deepEqual(fr.hellos, [{ t: 'stream.hello', v: 1, token: 'tok-1', device: 'cam-esp32' }], 'joined without starting a stream');

  const down = new FrCamera({ api: 'http://127.0.0.1:9', device: 'cam-esp32', home });
  await assert.rejects(down.capture(join(dir, 'c.jpg')), (e) => e.code === 'HUB_DOWN');
  assert.throws(() => parseJpegBlock(new Uint8Array(30)), /no whole JPEG/);
});

// ---- the logger against a real hub ---------------------------------------------------------------------------------
async function pairedLogger(t) {
  const dir = tmp(t, 'fx-tl-hub-');
  const h = await startHub({ dir, port: 0, host: '127.0.0.1', publicUrl: 'http://hub.test:8787', noBonjour: true });
  t.after(() => h.close());
  const admin = new Hub(h.url, h.hub.createClient({ name: 'Admin', kind: 'browser', scopes: ['read', 'write', 'search', 'admin'] }).token);
  const code = await admin.request('POST', '/v1/pairings', { name: 'Timelapse', kind: 'worker', scopes: ['write'], kinds: ['journal.entry', 'worker.status'] });
  const paired = await new Hub(h.url).redeem(code.code, { name: 'Timelapse · cam-esp32', platform: 'test', device: 'logger:timelapse:cam-esp32:test' });
  assert.equal(paired.client.kind, 'worker');
  return { h, admin, paired, hub: new Hub(h.url, paired.token) };
}

/** A camera that hands out test frames, failing when told. */
function fakeCamera() {
  const cam = { device: 'cam-esp32', fail: null, n: 0 };
  cam.capture = async (file) => {
    if (cam.fail) throw new Error(cam.fail);
    const j = jpeg(320, 240, cam.n++ % 5);
    writeFileSync(file, j);
    return { via: 'snap', width: 320, height: 240, bytes: j.length };
  };
  return cam;
}

test('the timelapse: a frame each Flavon, a record each span (once), its status, a restart going on with its span', async (t) => {
  const { admin, paired, hub } = await pairedLogger(t);
  const dir = tmp(t, 'fx-tl-data-');
  const every = parseEvery('5');
  const n0 = segmentOf(flavonAt(1794230835), 5).start;
  let now = flavonStart(n0);
  const logs = [];
  const camera = fakeCamera();
  const make = () => new Timelapse({ hub, camera, dir, every, fps: 10, clientId: paired.client.id, name: 'Timelapse · cam-esp32', zone: 'Europe/Kyiv',
    log: (m) => logs.push(m), now: () => now, heartbeat: 3600, retry: 3600 });
  const tl = make();
  t.after(() => tl.stop());
  await tl.writeStatus();

  // the span n0 … n0+4: four frames, one missed
  for (const i of [0, 1, 2, 3, 4]) {
    now = flavonStart(n0 + i) + 0.05;
    camera.fail = i === 2 ? 'the hardware hub did not answer' : null;
    await tl.flavon(n0 + i, flavonStart(n0 + i));
  }
  assert.ok(logs.some((l) => l.includes('no frame (the hardware hub did not answer)')));
  assert.ok(logs.some((l) => l.includes('frames coming again')));
  assert.equal(readFrames(join(dir, 'frames', String(n0))).length, 4);

  // the next span's first Flavon closes it
  now = flavonStart(n0 + 5) + 0.05;
  await tl.flavon(n0 + 5, flavonStart(n0 + 5));
  await tl.closing;
  const id = `timelapse.cam-esp32.${n0}`;
  const r = await admin.request('GET', `/v1/records/${id}`);
  assert.equal(r.kind, 'journal.entry');
  assert.equal(r.source, paired.client.id);
  assert.equal(r.time, Math.ceil(flavonStart(n0) * 1000) / 1000);
  assert.equal(r.end, Math.ceil(flavonStart(n0 + 5) * 1000) / 1000);
  assert.equal(r.fx.clock, clockText(n0), 'read in its own Flavon, not the one before');
  assert.equal(r.zone, 'Europe/Kyiv');
  assert.deepEqual(r.tags, ['timelapse']);
  assert.equal(r.data.emoji, '🎞️');
  assert.equal(r.data.title, `Timelapse · ${clockText(n0)}`);
  assert.deepEqual(r.data.timelapse, { camera: 'cam-esp32', every: 5, start: flavonStart(n0), end: flavonStart(n0 + 5), frames: 4, missed: 1, fps: 10 });
  assert.match(r.data.markdown, /^4 frames from cam-esp32, one each Flavon \(1 missed\)/);
  const [video, poster] = r.blobs;
  assert.deepEqual([video.role, video.name, video.type, video.width, video.height, video.duration, video.poster], ['video', 'timelapse', 'video/mp4', 320, 240, 0.5, poster.hash]);
  assert.deepEqual([poster.role, poster.type], ['poster', 'image/jpeg']);
  const blob = await fetch(`${hub.base}/v1/blobs/${video.hash}`, { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(blob.status, 200);
  assert.equal(existsSync(join(dir, 'frames', String(n0))), false, 'its frames are gone once recorded');

  // its status
  const s = await admin.request('GET', `/v1/records/worker.status.${paired.client.id}`);
  assert.equal(s.kind, 'worker.status');
  assert.equal(s.data.worker, 'timelapse');
  assert.equal(s.data.records, 1);
  assert.equal(s.data.last.record, id);
  assert.deepEqual([s.data.frames, s.data.missed], [5, 1]);
  assert.deepEqual(s.data.every, { flavons: 5, name: '5 Flavons' });
  assert.equal(s.data.camera.state, 'ok');
  assert.equal(s.data.span.frames, 1);

  // a restart mid-span goes on with it; the span it was down at the end of is closed when it starts
  now = flavonStart(n0 + 6) + 0.05;
  await tl.flavon(n0 + 6, flavonStart(n0 + 6));
  await tl.stop();
  now = flavonStart(n0 + 12) + 0.05; // n0+5 … n0+9 ended while it was down
  const again = make();
  t.after(() => again.stop());
  await again.writeStatus();
  again.closeEnded();
  await again.closing;
  const r2 = await admin.request('GET', `/v1/records/timelapse.cam-esp32.${n0 + 5}`);
  assert.equal(r2.data.timelapse.frames, 2);
  assert.equal(r2.data.timelapse.missed, 0, 'the Flavons after it stopped are not missed: the span is shorter');
  assert.equal(r2.end, Math.ceil(flavonStart(n0 + 7) * 1000) / 1000, 'it ends with its last frame');

  // a span with one frame (started on its last Flavon) makes no record
  now = flavonStart(n0 + 14) + 0.05;
  await again.flavon(n0 + 14, flavonStart(n0 + 14));
  now = flavonStart(n0 + 15) + 0.05;
  await again.flavon(n0 + 15, flavonStart(n0 + 15));
  await again.closing;
  assert.ok(logs.some((l) => l.endsWith('one frame, no record')));
  await assert.rejects(admin.request('GET', `/v1/records/timelapse.cam-esp32.${n0 + 10}`), (e) => e.status === 404);

  // a span closed twice makes one record: the second finds it done
  const before = (await admin.request('GET', '/v1/kinds')).kinds.find((k) => k.kind === 'journal.entry').count;
  again.closeEnded();
  await again.closing;
  assert.equal((await admin.request('GET', '/v1/kinds')).kinds.find((k) => k.kind === 'journal.entry').count, before);
});

test('the timelapse: a record the hub does not take waits on disk and goes when the hub is back', async (t) => {
  const { admin, paired } = await pairedLogger(t);
  const dir = tmp(t, 'fx-tl-retry-');
  const every = parseEvery('3');
  const n0 = segmentOf(flavonAt(1794230900), 3).start;
  let now = flavonStart(n0);
  const logs = [];
  const away = new Hub('http://127.0.0.1:9', paired.token);
  const tl = new Timelapse({ hub: away, camera: fakeCamera(), dir, every, fps: 10, clientId: paired.client.id, name: 'T', log: (m) => logs.push(m), now: () => now, retry: 3600, heartbeat: 3600 });
  t.after(() => tl.stop());
  for (const i of [0, 1, 2, 3]) {
    now = flavonStart(n0 + i);
    await tl.flavon(n0 + i, now);
  }
  await tl.closing;
  assert.ok(logs.some((l) => /no record yet \(the hub at .* did not answer/.test(l)));
  assert.equal(readFrames(join(dir, 'frames', String(n0))).length, 3, 'its frames wait');
  tl.hub = new Hub(away.base.replace('127.0.0.1:9', new URL(admin.base).host), paired.token);
  tl.closeEnded();
  await tl.closing;
  assert.equal((await admin.request('GET', `/v1/records/timelapse.cam-esp32.${n0}`)).data.timelapse.frames, 3);
});

test('in the background: a LaunchAgent plist macOS reads', { skip: process.platform !== 'darwin' }, (t) => {
  const dir = tmp(t, 'fx-tl-agent-');
  const file = join(dir, 'agent.plist');
  writeFileSync(file, agentPlist({ label: 'app.fractonica.logger.timelapse.cam-esp32', args: ['/usr/local/bin/node', '/x/timelapse.mjs', 'run', '--every', 'preon', '--name', 'a & <b>'],
    cwd: '/x', path: '/opt/homebrew/bin:/usr/bin', log: '/x/logger.log' }));
  execFileSync('plutil', ['-lint', file]);
  const p = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', file]));
  assert.deepEqual(p.ProgramArguments.slice(-2), ['--name', 'a & <b>']);
  assert.deepEqual([p.RunAtLoad, p.KeepAlive.SuccessfulExit, p.EnvironmentVariables.PATH], [true, false, '/opt/homebrew/bin:/usr/bin']);
});
