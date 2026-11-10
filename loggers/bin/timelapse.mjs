#!/usr/bin/env node
// The timelapse logger: a frame from each of its cameras on the Fractonica hardware hub at every Flavon (in step with
// the clock), and each Helion a journal entry in your Fractonica Hub with a video from each camera. It is one of the
// hub's workers: paired with a code (kind worker), it writes its status there. See loggers/README.md.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, platform as os, release } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FrCamera } from '../lib/camera.js';
import { flavonStart, parseEvery, spanName } from '../lib/clock.js';
import { Hub } from '../lib/hub.js';
import { agentPlist, launchctl } from '../lib/launchd.js';
import { migrateSpans, readFrames, Timelapse } from '../lib/timelapse.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

const USAGE = `fractonica timelapse ${VERSION}: a frame from each camera each Flavon, their videos each Helion, in your journal

  node loggers/bin/timelapse.mjs CODE [--hub URL]   pair with the hub (a code for a logger: the hub's page, Devices ›
                                                     Pair a device › Logger), then run
  node loggers/bin/timelapse.mjs                    run with the saved pairing (Ctrl-C stops it; it goes on from there)
  node loggers/bin/timelapse.mjs status             the pairing, the cameras, the span it is taking, the last record
  node loggers/bin/timelapse.mjs install            run it in the background: at login, and again if it stops
  node loggers/bin/timelapse.mjs uninstall          stop running it in the background
  node loggers/bin/timelapse.mjs unpair             forget the pairing

  --camera DEVICES   the cameras on the hardware hub, by alias: --camera cam-esp32,cam-esp32-2 (or --camera given
                     for each; default cam-esp32). Each span's entry has a video from each of them.
  --every SPAN       a video and a record each: helion (default), preon, or a number of Flavons (65 is a Preon)
  --fps N            the video's frames a second (default 30: a Helion's 2340 Flavons in 78 s)
  --frame-size S     qvga, vga, svga, xga, sxga or uxga for its photos (default: the camera's own setting)
  --quality Q        JPEG quality, 4 (best) … 63 (default: the camera's own)
  --flash            light the camera's flash for each photo
  --no-stamp         leave the clock off the frames
  --keep-frames      keep each span's photos after its record (they are deleted otherwise)
  --keep-awake       keep this Mac from sleeping while it runs (a sleeping Mac takes no frames)
  --camera-hub URL   the hardware hub (default http://127.0.0.1:7420)
  --hub URL          the Fractonica Hub to pair with (default http://localhost:8787)
  --name NAME        what the hub calls it (default "Timelapse")
  --data DIR         where its pairing and frames live (default loggers/data/timelapse); another folder is another
                     logger, with a pairing of its own`;

const OPTIONS = {
  camera: { type: 'string', multiple: true }, every: { type: 'string' }, fps: { type: 'string' }, 'frame-size': { type: 'string' },
  quality: { type: 'string' }, flash: { type: 'boolean' }, 'no-stamp': { type: 'boolean' }, 'keep-frames': { type: 'boolean' },
  'keep-awake': { type: 'boolean' }, 'camera-hub': { type: 'string' }, hub: { type: 'string' }, name: { type: 'string' },
  data: { type: 'string' }, help: { type: 'boolean', short: 'h' },
};
const { values: o, positionals } = parseArgs({ allowPositionals: true, options: OPTIONS });
if (o.help) {
  console.log(USAGE);
  process.exit(0);
}

const fail = (m) => {
  console.error(m);
  process.exit(1);
};
const log = (m) => console.log(`${new Date().toLocaleTimeString('en-GB')}  ${m}`);

const cameras = [...new Set((o.camera ?? ['cam-esp32']).flatMap((c) => c.split(',')).map((c) => c.trim()).filter(Boolean))];
for (const c of cameras) if (!/^[A-Za-z0-9._:-]{1,64}$/.test(c)) fail(`--camera ${c}: a device alias or id`);
if (!cameras.length) fail('--camera: name a camera');
const every = parseEvery(o.every ?? 'helion') ?? fail(`--every ${o.every}: helion, preon, or a number of Flavons (1 … 2340)`);
const fps = Number(o.fps ?? 30);
if (!(fps >= 1 && fps <= 50)) fail(`--fps ${o.fps}: 1 … 50`);
const SIZES = ['qvga', 'vga', 'svga', 'xga', 'sxga', 'uxga'];
if (o['frame-size'] && !SIZES.includes(o['frame-size'])) fail(`--frame-size ${o['frame-size']}: ${SIZES.join(', ')}`);
const quality = o.quality === undefined ? null : Number(o.quality);
if (quality !== null && !(Number.isInteger(quality) && quality >= 4 && quality <= 63)) fail(`--quality ${o.quality}: 4 … 63`);

const DATA = o.data ? resolve(o.data) : join(ROOT, 'data', 'timelapse');
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
// the first version kept a folder per camera (loggers/data/timelapse-<camera>): the one there is becomes this logger's
// own, its pairing and the span it was taking with it
if (!o.data && !existsSync(DATA) && existsSync(join(ROOT, 'data'))) {
  const old = readdirSync(join(ROOT, 'data')).filter((d) => d.startsWith('timelapse-') && existsSync(join(ROOT, 'data', d, 'config.json')));
  if (old.length === 1) {
    const from = join(ROOT, 'data', old[0]);
    const pid = existsSync(join(from, 'logger.pid')) ? Number(readFileSync(join(from, 'logger.pid'), 'utf8')) : 0;
    if (pid && alive(pid)) fail(`the earlier version runs with ${from} (pid ${pid}): stop it (Ctrl-C where it runs), then start this one; it goes on with its span`);
    renameSync(from, DATA);
    console.log(`took over ${from} (the earlier version's pairing and frames) as ${DATA}`);
  }
}
mkdirSync(DATA, { recursive: true, mode: 0o700 });
const CONFIG = join(DATA, 'config.json');
const LOCK = join(DATA, 'logger.pid');
const readJSON = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const writeJSON = (f, v) => {
  writeFileSync(`${f}.tmp`, JSON.stringify(v, null, 2), { mode: 0o600 });
  renameSync(`${f}.tmp`, f);
};
const runningPid = () => {
  const pid = existsSync(LOCK) ? Number(readFileSync(LOCK, 'utf8')) : 0;
  return pid && pid !== process.pid && alive(pid) ? pid : 0;
};

// the default folder's agent is app.fractonica.logger.timelapse; another folder's is named after it too
const LABEL = `app.fractonica.logger.${basename(DATA).replace(/[^A-Za-z0-9.-]/g, '-')}`;
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

const [first] = positionals;
const command = ['status', 'unpair', 'run', 'install', 'uninstall'].includes(first) ? first : first ? 'pair' : 'run';
let config = readJSON(CONFIG);
if (config && existsSync(join(DATA, 'frames'))) migrateSpans(join(DATA, 'frames'), config.camera ?? cameras[0]);

if (command === 'unpair') {
  if (!config) fail('not paired');
  rmSync(CONFIG);
  console.log(`forgot the pairing with ${config.hub} (the hub still lists this logger: revoke it on the hub's page, Devices)`);
  process.exit(0);
}

if (command === 'pair') {
  const code = first.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[0-9A-Z]{8}$/.test(code)) fail(`"${first}" is no pairing code (8 letters and digits, like 7KQ2-M9XD)\n\n${USAGE}`);
  if (runningPid()) fail(`this logger runs already (pid ${runningPid()}): stop it first`);
  const base = o.hub ?? config?.hub ?? 'http://localhost:8787';
  const hub = new Hub(base);
  const info = await hub.info().catch((e) => fail(`${e.message}: give the hub's address with --hub`));
  const name = o.name ?? config?.name ?? 'Timelapse';
  const r = await hub.redeem(code, { name, platform: `${os()} ${release()} · fractonica timelapse ${VERSION}`, device: `logger:${basename(DATA)}:${hostname()}` })
    .catch((e) => fail(`pairing failed: ${e.message}${e.status === 404 ? ' (a code lasts 10 minutes and works once: make another)' : ''}`));
  const can = (kind) => r.client.scopes.includes('write') && r.client.kinds.some((k) => k === '*' || k === kind || (k.endsWith('.*') && kind.startsWith(k.slice(0, -1))));
  if (!can('journal.entry') || !can('worker.status')) {
    fail(`paired, but the code lets it write ${r.client.scopes.includes('write') ? r.client.kinds.join(', ') : 'nothing'}: a logger writes journal.entry and worker.status records. Make a code for a Logger on the hub's page (Devices › Pair a device › Logger), or:\n\n  node hub/bin/hub.mjs pair --name "${name}" --kind worker --scopes write --kinds journal.entry,worker.status`);
  }
  config = { hub: base, hubId: info.hub.id, hubName: info.hub.name, token: r.token, clientId: r.client.id, name };
  writeJSON(CONFIG, config);
  console.log(`paired with ${info.hub.name} at ${base} as "${name}" (a worker)`);
}

if (!config) fail(`not paired yet: make a code for a Logger on the hub's page (Devices › Pair a device › Logger) and run it with the code\n\n${USAGE}`);

// ---- status --------------------------------------------------------------------------------------------------------
if (command === 'status') {
  const pid = runningPid();
  console.log(`hub       ${config.hubName ?? ''} ${config.hub}  (as "${config.name}", ${config.clientId})`);
  console.log(`running   ${pid ? `yes, pid ${pid}` : 'no'}${existsSync(PLIST) ? `  (in the background: ${PLIST})` : ''}`);
  for (const camera of cameras) {
    const s = await new FrCamera({ api: o['camera-hub'], device: camera }).status().catch((e) => ({ problem: e.message }));
    console.log(`camera    ${camera}: ${s.problem ?? `${s.sensor ?? '?'}, ${s.stream ? `streaming (stream ${s.stream.stream_id}${s.stream.subscribers ? ', a live view' : ''}: frames come from it)` : 'idle'}`}`);
  }
  const framesDir = join(DATA, 'frames');
  for (const name of existsSync(framesDir) ? readdirSync(framesDir).sort() : []) {
    const span = readJSON(join(framesDir, name, 'span.json'));
    if (!span || existsSync(join(framesDir, name, 'recorded.json'))) continue;
    const ends = flavonStart(span.end);
    const dirs = readdirSync(join(framesDir, name), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    const counts = dirs.map((d) => `${d} ${readFrames(join(framesDir, name, d)).length}`).join(', ') || 'no frames yet';
    console.log(`span      ${spanName(span, span.every ?? every)} (${span.end - span.start} Flavons): ${counts}; ${ends > Date.now() / 1000 ? `ends ${new Date(ends * 1000).toLocaleTimeString('en-GB')}` : 'ended, waiting for its record'}`);
  }
  const state = readJSON(join(DATA, 'state.json'));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (state?.last) console.log(`last      ${state.last.title}: ${state.last.cameras?.map((c) => `${c.camera} ${plural(c.frames, 'frame')}`).join(', ') ?? plural(state.last.frames, 'frame')}, written ${new Date(state.last.at * 1000).toLocaleString('en-GB')} (${plural(state.records, 'record')} in all)`);
  process.exit(0);
}

// ---- in the background (a LaunchAgent) -----------------------------------------------------------------------------
const passOn = () => {
  const args = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === 'help' || k === 'hub' || k === 'name' || v === undefined || v === false) continue;
    if (k === 'camera') args.push('--camera', cameras.join(','));
    else args.push(`--${k}`, ...(v === true ? [] : [k === 'data' ? DATA : String(v)]));
  }
  return args;
};
const uid = process.getuid();

if (command === 'install') {
  if (os() !== 'darwin') fail('install sets up a macOS LaunchAgent: elsewhere, run it with your own service manager');
  const pid = runningPid();
  if (pid) fail(`it runs already (pid ${pid}): stop that one first (Ctrl-C where it runs), then install`);
  const args = [process.execPath, join(HERE, 'timelapse.mjs'), 'run', ...passOn()];
  const logFile = join(DATA, 'logger.log');
  const plist = agentPlist({ label: LABEL, args, cwd: join(ROOT, '..'), path: process.env.PATH ?? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin', log: logFile });
  mkdirSync(dirname(PLIST), { recursive: true });
  if (existsSync(PLIST)) await launchctl(['bootout', `gui/${uid}/${LABEL}`]).catch(() => {});
  writeFileSync(PLIST, plist);
  await launchctl(['bootstrap', `gui/${uid}`, PLIST]).catch((e) => fail(`launchctl: ${e.message}`));
  console.log(`runs in the background now, and at every login: ${args.slice(2).join(' ')}\n  its log  ${logFile}\n  stop it  node loggers/bin/timelapse.mjs uninstall${o.data ? ` --data ${DATA}` : ''}`);
  process.exit(0);
}

if (command === 'uninstall') {
  if (!existsSync(PLIST)) fail(`not installed (no ${PLIST})`);
  await launchctl(['bootout', `gui/${uid}/${LABEL}`]).catch(() => {});
  rmSync(PLIST);
  console.log('stopped, and it no longer starts at login (its pairing and frames stay)');
  process.exit(0);
}

// ---- run -----------------------------------------------------------------------------------------------------------
{
  const other = runningPid();
  if (other) fail(`this logger runs already with ${DATA} (pid ${other})${existsSync(PLIST) ? ', in the background (uninstall stops it)' : ': stop it first (Ctrl-C where it runs)'}`);
}
writeFileSync(LOCK, String(process.pid));
if (o['keep-awake']) spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();

const hub = new Hub(config.hub, config.token);
const cams = cameras.map((device) => new FrCamera({ api: o['camera-hub'], device, frameSize: o['frame-size'] ?? null, quality, flash: !!o.flash }));
const logger = new Timelapse({
  hub, cameras: cams, dir: DATA, every, fps, stamp: !o['no-stamp'], keepFrames: !!o['keep-frames'],
  clientId: config.clientId, name: config.name, version: VERSION, log, legacyCamera: config.camera ?? null,
});
log(`timelapse of ${cameras.join(', ')} for ${config.hubName ?? 'the hub'} at ${config.hub}: a frame each Flavon, a record each ${every.name} (${every.flavons} Flavons), ${fps} fps`);
await logger.start();

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (stopping) process.exit(1);
    stopping = true;
    log('stopping (the span goes on when it starts again)');
    await logger.stop().catch(() => {});
    rmSync(LOCK, { force: true });
    process.exit(0);
  });
}
