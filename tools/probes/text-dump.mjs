// Dump all visible text (incl. tooltips attrs, options, canvas text) per tab in a given mode for regression diffs.
//   node tools/probes/text-dump.mjs <outdir> [pure]
import fs from 'node:fs';
import path from 'node:path';
import { withApp } from '../browse.mjs';
import { installHooks, collect } from '../pure-scan.mjs';

const out = path.resolve(process.argv[2] ?? 'text-dump');
const pure = process.argv[3] === 'pure';
fs.mkdirSync(out, { recursive: true });
const T = 1791460800;
await withApp(async ({ page, url }) => {
  await installHooks(page);
  for (const tab of ['rings', 'timeline', 'wave', 'calendar', 'sound']) {
    for (const [name, t] of [['A', T], ['B', 946684800]]) {
      await page.goto(url(`?t=${t}&view=${tab}&zone=UTC&pure=${pure ? 1 : 0}`));
      await page.waitForTimeout(900);
      const items = await collect(page);
      const lines = [...new Set(items.map((i) => `${i.kind}\t${i.where}\t${i.text}`))].sort();
      fs.writeFileSync(path.join(out, `${tab}-${name}.txt`), lines.join('\n') + '\n');
    }
  }
  console.log('dumped to', out);
});
