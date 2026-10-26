#!/usr/bin/env node
// Fractonica Hub command line: serve, pair, clients, revoke. See hub/README.md.
import { parseArgs } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHub } from '../lib/server.js';
import { openHub, CLIENT_KINDS } from '../lib/hub.js';
import { lanAddress, advertise } from '../lib/lan.js';
import { qrText } from '../web/qr.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = `Fractonica Hub

  hub serve   [--port 8787] [--host 0.0.0.0] [--data hub/data] [--public-url http://host:port] [--no-bonjour]
  hub pair    --name NAME [--kind device|service|worker|browser] [--scopes read,write,search] [--kinds '*']
              [--ttl 600] [--token]      --token: make the client now and print its token instead of a code
  hub clients
  hub revoke  CLIENT_ID

  all commands take --data DIR (default: hub/data next to this script)`;

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === '--help' || cmd === '-h') rest.length = 0;
const { values: o, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    port: { type: 'string' }, host: { type: 'string' }, data: { type: 'string' }, 'public-url': { type: 'string' },
    'no-bonjour': { type: 'boolean' }, name: { type: 'string' }, kind: { type: 'string' }, scopes: { type: 'string' },
    kinds: { type: 'string' }, ttl: { type: 'string' }, token: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
});
const dataDir = o.data ? resolve(o.data) : join(HERE, '..', 'data');
const list = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const fmtTime = (t) => (t ? new Date(t * 1000).toLocaleString() : '—');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

async function serve() {
  const port = o.port ? Number(o.port) : 8787;
  let h;
  try {
    h = await startHub({ dir: dataDir, port, host: o.host ?? '0.0.0.0', publicUrl: o['public-url'] });
  } catch (e) {
    die(e.code === 'EADDRINUSE' ? `Port ${port} is in use; pass --port.` : String(e.stack ?? e));
  }
  const lan = lanAddress();
  console.log(`Fractonica Hub ${h.hub.info().hub.version}  ·  data ${dataDir}`);
  console.log(`  this Mac   http://localhost:${h.port}`);
  if (lan) console.log(`  LAN        http://${lan}:${h.port}`);
  const code = h.hub.setupCode();
  if (code) {
    console.log(`\nNo admin yet. Open this once to make this browser the hub's admin (valid 7 days, single use):\n`);
    console.log(`  http://localhost:${h.port}/#setup=${code}\n`);
  }
  const stopBonjour = o['no-bonjour'] ? () => {} : advertise(h.port);
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    stopBonjour();
    await h.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function pair() {
  if (!o.name) die('pair needs --name');
  const kind = o.kind ?? 'device';
  if (!CLIENT_KINDS.includes(kind)) die(`--kind must be one of ${CLIENT_KINDS.join(', ')}`);
  const scopes = list(o.scopes) ?? (kind === 'worker' ? ['worker'] : kind === 'browser' ? ['read', 'write', 'search', 'admin'] : undefined);
  const kinds = list(o.kinds);
  const hub = openHub(dataDir, {
    publicUrl: () => o['public-url'] ?? `http://${lanAddress() ?? 'localhost'}:${hub.getMeta('port') ?? 8787}`,
  });
  try {
    if (o.token) {
      const { client, token } = hub.createClient({ name: o.name, kind, scopes, kinds });
      console.log(`client  ${client.id}  ${client.name}  (${client.kind}; scopes ${client.scopes.join(',')}; kinds ${client.kinds.join(',')})`);
      console.log(`token   ${token}`);
      console.log('\nKeep the token secret; the hub stores only its hash. Revoke with: hub revoke ' + client.id);
      return;
    }
    const p = hub.createPairing({ name: o.name, kind, scopes, kinds, ttl: o.ttl ? Number(o.ttl) : undefined });
    const base = o['public-url'] ?? `http://${lanAddress() ?? 'localhost'}:${hub.getMeta('port') ?? 8787}`;
    console.log(`code     ${p.code}   (expires ${fmtTime(p.expires)}, single use)`);
    if (kind === 'browser') {
      const link = `${base}/#setup=${p.code}`;
      console.log(`open     ${link}\n`);
      console.log(qrText(link));
    } else {
      console.log(`link     ${p.link}\n`);
      console.log(qrText(p.link));
      console.log(`\nA script redeems the code with:\n  curl -X POST ${base}/v1/pair -H 'Content-Type: application/json' \\\n    -d '{"code":"${p.code}","name":${JSON.stringify(o.name)},"kind":"${kind}"}'`);
    }
  } finally {
    hub.close();
  }
}

function clients() {
  const hub = openHub(dataDir);
  try {
    const rows = hub.listClients();
    if (!rows.length) return console.log('no clients yet');
    for (const c of rows) {
      console.log(
        `${c.id}  ${c.revoked ? '[revoked] ' : ''}${c.name}  · ${c.kind} · ${c.scopes.join(',')} · kinds ${c.kinds.join(',')} · ${c.records} records · seen ${fmtTime(c.lastSeen)}`,
      );
    }
  } finally {
    hub.close();
  }
}

function revoke() {
  const id = positionals[0];
  if (!id) die('revoke needs a client id (see: hub clients)');
  const hub = openHub(dataDir);
  try {
    const c = hub.revokeClient(id);
    console.log(`revoked ${c.id} (${c.name}); its records stay`);
  } catch (e) {
    die(e.message);
  } finally {
    hub.close();
  }
}

if (o.help || !cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') console.log(USAGE);
else if (cmd === 'serve') await serve();
else if (cmd === 'pair') pair();
else if (cmd === 'clients') clients();
else if (cmd === 'revoke') revoke();
else die(`unknown command ${cmd}\n\n${USAGE}`);
