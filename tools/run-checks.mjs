// Runs every headless-browser check in tools/checks/ one after another and prints a summary.
//   node tools/run-checks.mjs [name-filter]
// Needs Playwright core + a Chromium (see tools/browse.mjs). The pure-logic tests run with `npm test`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'checks');
const filter = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.endsWith('-dsp.mjs') && (!filter || f.includes(filter))).sort();
const results = [];
for (const f of files) {
  const t0 = Date.now();
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(dir, f)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const keep = (b) => (tail = (tail + b).slice(-1500));
    p.stdout.on('data', keep);
    p.stderr.on('data', keep);
    const timer = setTimeout(() => p.kill('SIGKILL'), 10 * 60 * 1000);
    p.on('close', (c) => {
      clearTimeout(timer);
      if (c) console.log(`\n--- ${f} output tail ---\n${tail}`);
      resolve(c);
    });
  });
  results.push([f, code, ((Date.now() - t0) / 1000).toFixed(0)]);
  console.log(`${code === 0 ? 'ok  ' : 'FAIL'} ${f} (${results.at(-1)[2]} s)`);
}
const failed = results.filter(([, c]) => c !== 0);
console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
