/**
 * Dev harness: serve the repo, drive it with headless Chromium (Playwright core
 * from the global npm install + the Playwright-cached Chromium) and collect
 * console / page errors. Used for screenshots and interaction checks.
 *
 *   import { withApp } from './tools/browse.mjs';
 *   await withApp(async ({ page, url, errors, shot }) => {
 *     await page.goto(url('?t=1791460800&view=rings'));
 *     await shot('rings.png');           // saved under tools/out/
 *   }, { viewport: { width: 1440, height: 900 } });
 *
 * CLI: node tools/browse.mjs "?t=1791460800&view=timeline" out.png [width] [height]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const outDir = path.join(root, 'tools', 'out');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
};

export function serve(dir = root, port = 0, host = '127.0.0.1') {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = path.join(dir, decodeURIComponent(u.pathname));
    if (!p.startsWith(dir)) return res.writeHead(403).end();
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    fs.readFile(p, (err, buf) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(buf);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ server, port: server.address().port }));
  });
}

function findPlaywright() {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const candidates = [
    path.join(globalRoot, '@playwright/cli/node_modules/playwright-core'),
    path.join(globalRoot, 'playwright-core'),
    path.join(globalRoot, 'playwright'),
  ];
  const hit = candidates.find((c) => fs.existsSync(c));
  if (!hit) throw new Error('playwright-core not found; set PLAYWRIGHT_CORE');
  return hit;
}

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const cache = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse() : [];
  for (const d of dirs) {
    const dir = path.join(cache, d);
    for (const sub of fs.readdirSync(dir)) {
      const exe = path.join(dir, sub, 'chrome-headless-shell');
      if (fs.existsSync(exe)) return exe;
    }
  }
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(chrome)) return chrome;
  throw new Error('No Chromium found; set CHROMIUM');
}

export async function withApp(fn, { viewport = { width: 1440, height: 900 }, deviceScaleFactor = 1, colorScheme = 'dark', args = [] } = {}) {
  const pw = await import(pathToFileURL(path.join(findPlaywright(), 'index.mjs')).href).catch(() => import(pathToFileURL(path.join(findPlaywright(), 'index.js')).href));
  const chromium = pw.chromium ?? pw.default?.chromium;
  const { server, port } = await serve();
  const browser = await chromium.launch({
    headless: true,
    executablePath: findChromium(),
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', ...args],
  });
  const context = await browser.newContext({ viewport, deviceScaleFactor, colorScheme });
  const page = await context.newPage();
  const errors = [];
  const logs = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text());
    else logs.push(m.type() + ': ' + m.text());
  });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
  });
  fs.mkdirSync(outDir, { recursive: true });
  const url = (q = '') => `http://127.0.0.1:${port}/index.html${q}`;
  const shot = async (name, opts = {}) => {
    const file = path.join(outDir, name);
    await page.screenshot({ path: file, ...opts });
    return file;
  };
  try {
    return await fn({ page, context, browser, url, errors, logs, shot, port, root });
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [query = '', out = 'shot.png', w = '1440', h = '900'] = process.argv.slice(2);
  await withApp(
    async ({ page, url, errors, shot }) => {
      await page.goto(url(query));
      await page.waitForTimeout(1200);
      console.log('saved', await shot(out));
      console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
    },
    { viewport: { width: +w, height: +h } },
  );
}
