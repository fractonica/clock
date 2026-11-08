#!/usr/bin/env node
// fractonica-dispatch: rings the app's moments on your phones as calls. It pairs with your Fractonica Hub using a
// code from the app (Moments › Settings › Calls), follows the call schedule each phone keeps there, and sends each call
// at its first ring as an APNs VoIP push, which the phone rings as a call. See dispatch/README.md.
import { parseArgs } from 'node:util';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, platform as os, release } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApnsClient, keyIdFromFile, loadKey } from '../lib/apns.js';
import { Dispatcher } from '../lib/dispatcher.js';
import { Hub } from '../lib/hub.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

const USAGE = `fractonica-dispatch ${VERSION}: rings the app's moments on your phones as calls

  node dispatch/bin/dispatch.mjs CODE [--hub URL]   pair with the hub (CODE from the app: Moments › Settings › Calls ›
                                                     Pair a Dispatch), then run
  node dispatch/bin/dispatch.mjs                    run with the saved pairing
  node dispatch/bin/dispatch.mjs status             the pairing, the APNs key, the phones and their next calls
  node dispatch/bin/dispatch.mjs test               ring every phone now, to try the setup
  node dispatch/bin/dispatch.mjs unpair             forget the pairing

  --hub URL        the hub (default http://localhost:8787)
  --apns-key FILE  your APNs auth key, AuthKey_XXXXXXXXXX.p8 (developer.apple.com › Keys, Apple Push Notifications
                   service); kept in the data folder. Without it the dispatch also looks for one in dispatch/.
  --key-id ID      the key's id, when the file is not named AuthKey_<id>.p8
  --team ID        your team id (the app tells it otherwise)
  --name NAME      what the app calls this dispatch (default: this computer's name)
  --data DIR       where the pairing and state live (default dispatch/data)`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    hub: { type: 'string' }, 'apns-key': { type: 'string' }, 'key-id': { type: 'string' }, team: { type: 'string' },
    name: { type: 'string' }, data: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    // tests only: another APNs (a stand-in server; plain http/2 for http://)
    'apns-host': { type: 'string' },
  },
});
if (o.help) {
  console.log(USAGE);
  process.exit(0);
}

const DATA = o.data ? resolve(o.data) : join(ROOT, 'data');
mkdirSync(DATA, { recursive: true, mode: 0o700 });
const CONFIG = join(DATA, 'config.json');
const STATE = join(DATA, 'state.json');
const readJSON = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const writeJSON = (f, v) => {
  writeFileSync(`${f}.tmp`, JSON.stringify(v, null, 2), { mode: 0o600 });
  renameSync(`${f}.tmp`, f);
};
const log = (m) => console.log(`${new Date().toLocaleTimeString()}  ${m}`);
const fail = (m) => {
  console.error(m);
  process.exit(1);
};

const [first] = positionals;
const command = ['status', 'test', 'unpair', 'run'].includes(first) ? first : first ? 'pair' : 'run';
let config = readJSON(CONFIG);

if (command === 'unpair') {
  if (!config) fail('not paired');
  rmSync(CONFIG);
  rmSync(STATE, { force: true });
  console.log(`forgot the pairing with ${config.hub} (the hub still lists this dispatch: revoke it on the hub's page)`);
  process.exit(0);
}

if (command === 'pair') {
  const code = first.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[0-9A-Z]{8}$/.test(code)) fail(`"${first}" is no pairing code (8 letters and digits, like 7KQ2-M9XD)\n\n${USAGE}`);
  const base = o.hub ?? config?.hub ?? 'http://localhost:8787';
  const hub = new Hub(base);
  const info = await hub.info().catch((e) => fail(`${e.message}: give the hub's address with --hub`));
  const name = o.name ?? config?.name ?? hostname().replace(/\.local$/, '');
  const r = await hub.redeem(code, { name, platform: `${os()} ${release()} · fractonica-dispatch ${VERSION}`, device: `dispatch:${hostname()}` })
    .catch((e) => fail(`pairing failed: ${e.message}${e.status === 404 ? ' (codes last half an hour: make a new one in the app)' : ''}`));
  config = { ...(config ?? {}), hub: base, hubId: info.hub.id, hubName: info.hub.name, token: r.token, clientId: r.client.id, name };
  // a new pairing starts the feed from the beginning
  rmSync(STATE, { force: true });
  writeJSON(CONFIG, config);
  console.log(`paired with ${info.hub.name} at ${base} as "${name}"`);
}

if (!config) fail(`not paired yet: run it with a code from the app (Moments › Settings › Calls › Pair a Dispatch)\n\n${USAGE}`);

// ---- the APNs key: --apns-key, else one kept in the data folder, else one dropped into dispatch/ ----------------------
function findKey() {
  if (o['apns-key']) {
    const file = resolve(o['apns-key']);
    if (!existsSync(file)) fail(`no file at ${file}`);
    return file;
  }
  if (config.apns?.file && existsSync(join(DATA, config.apns.file))) return join(DATA, config.apns.file);
  for (const dir of [DATA, ROOT]) {
    const found = readdirSync(dir).filter((f) => /^AuthKey_[A-Z0-9]{10}\.p8$/i.test(f));
    if (found.length) return join(dir, found.sort()[0]);
  }
  return null;
}

let apns = null, apnsProblem = null;
const keyFile = findKey();
if (keyFile) {
  try {
    const key = loadKey(keyFile);
    const keyId = o['key-id'] ?? keyIdFromFile(keyFile) ?? config.apns?.keyId;
    if (!keyId) throw new Error(`the key's id is not in its file name (${basename(keyFile)}): give it with --key-id`);
    // kept in the data folder, readable by you alone
    const kept = `AuthKey_${keyId}.p8`;
    if (resolve(keyFile) !== join(DATA, kept)) {
      copyFileSync(keyFile, join(DATA, kept));
      chmodSync(join(DATA, kept), 0o600);
    }
    config.apns = { file: kept, keyId, teamId: o.team ?? config.apns?.teamId ?? null };
    writeJSON(CONFIG, config);
    const hosts = o['apns-host'] ? { production: o['apns-host'], development: o['apns-host'] } : undefined;
    apns = new ApnsClient({ key, keyId, teamId: config.apns.teamId ?? undefined, hosts });
  } catch (e) {
    apnsProblem = `APNs key: ${e.message}`;
  }
} else {
  apnsProblem = 'no APNs key';
}

const hub = new Hub(config.hub, config.token);
const store = { load: () => readJSON(STATE), save: (s) => writeJSON(STATE, s) };
const dispatcher = new Dispatcher({ hub, apns, apnsProblem, store, clientId: config.clientId, name: config.name, version: VERSION, log });

if (command === 'status' || command === 'test') {
  // a fresh look at the schedules, without following
  try {
    const page = await hub.changes(0, { kinds: ['dispatch.calls'] });
    for (const r of page.changes ?? []) dispatcher.apply(r);
  } catch (e) {
    console.log(`(the hub: ${e.message}; the schedules held on disk)`);
  }
  if (command === 'test') {
    if (!apns) fail(`${apnsProblem}: ${keyHelp()}`);
    const results = await dispatcher.test();
    if (!results.length) console.log('no phone rings by dispatch: choose Calls in the app (Moments › Settings › Calls)');
    for (const r of results) console.log(r.ok ? `rang (${r.environment})` : `failed: ${r.status} ${r.reason}`);
    apns.close();
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  }
  console.log(`hub      ${config.hubName ?? ''} ${config.hub}  (as "${config.name}", ${config.clientId})`);
  console.log(`APNs     ${apns ? `key ${config.apns.keyId}${config.apns.teamId ? `, team ${config.apns.teamId}` : ', team from the app'}` : apnsProblem}`);
  if (!dispatcher.devices.size) console.log('phones   none yet: choose Calls in the app (Moments › Settings › Calls)');
  for (const d of dispatcher.devices.values()) {
    const next = dispatcher.pending(d)[0];
    console.log(`phone    ${d.name}: ${d.enabled ? `${dispatcher.pending(d).length} calls, next ${next ? `${new Date(next.at * 1000).toLocaleString()} ${next.title ?? ''}` : '—'}` : 'alert mode (calls off)'}`);
  }
  process.exit(0);
}

function keyHelp() {
  return `put your APNs auth key (AuthKey_XXXXXXXXXX.p8 from developer.apple.com › Certificates, IDs & Profiles › Keys, with Apple Push Notifications service) in ${ROOT} or pass --apns-key FILE, then start the dispatch again`;
}

if (!apns) log(`${apnsProblem}: ${keyHelp()}. Following the schedules meanwhile; nothing rings until then.`);
log(`fractonica-dispatch ${VERSION} · ${config.name} · hub ${config.hub}${apns ? ` · APNs key ${config.apns.keyId}` : ''}`);
await dispatcher.start();
const quit = async () => {
  log('stopping');
  await dispatcher.stop();
  process.exit(0);
};
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
