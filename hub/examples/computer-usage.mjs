#!/usr/bin/env node
// A provider: every minute, records the frontmost macOS app and its window title as a `computer.usage` record.
//
//   node hub/bin/hub.mjs pair --name "Computer usage" --kind service --scopes write --kinds 'computer.*' --token
//   HUB=http://localhost:8787 TOKEN=fxh_… node hub/examples/computer-usage.mjs        (--once for a single reading)
//
// Window titles need Accessibility permission for the terminal (System Settings → Privacy & Security); without it only
// the app name is recorded. Ids are deterministic (host + minute), so a retry or a restart never duplicates a minute.
import { execFile } from 'node:child_process';
import { hostname } from 'node:os';

const HUB = process.env.HUB ?? 'http://localhost:8787';
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error('set TOKEN (see the comment at the top of this file)');
  process.exit(1);
}
const HOST = hostname().replace(/\.local$/, '').replace(/[^A-Za-z0-9._-]/g, '-');

const SCRIPT = `tell application "System Events"
  set p to first application process whose frontmost is true
  set appName to name of p
  set winTitle to ""
  try
    set winTitle to name of front window of p
  end try
end tell
return appName & linefeed & winTitle`;

const frontmost = () =>
  new Promise((resolve) =>
    execFile('osascript', ['-e', SCRIPT], { timeout: 10000 }, (err, out) => {
      if (err) return resolve(null);
      const [app, title = ''] = out.trimEnd().split('\n');
      resolve({ app, title });
    }),
  );

async function record() {
  const f = await frontmost();
  if (!f?.app) return;
  const now = Date.now() / 1000;
  const minute = Math.floor(now / 60) * 60;
  const body = {
    kind: 'computer.usage',
    time: minute,
    end: minute + 60,
    created: now,
    updated: now,
    text: f.title ? `${f.app} — ${f.title}` : f.app,
    data: { app: f.app, title: f.title || null, host: HOST, seconds: 60 },
  };
  const res = await fetch(`${HUB}/v1/records/usage:${HOST}:${minute}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((e) => ({ ok: false, status: e.message }));
  console.log(`${new Date(minute * 1000).toLocaleTimeString()}  ${body.text}  → ${res.status}`);
}

await record();
if (!process.argv.includes('--once')) {
  // on every minute boundary (plus a second, so the reading belongs to the minute it describes)
  setTimeout(function tick() {
    record();
    setTimeout(tick, 60000 - (Date.now() % 60000) + 1000);
  }, 60000 - (Date.now() % 60000) + 1000);
}
