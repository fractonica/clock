// Regenerates the screenshots used in README.md (docs/img/*.jpg): node tools/probes/readme-shots.mjs
import { withApp } from '../browse.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const img = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'img');
fs.mkdirSync(img, { recursive: true });
const t = 1791460800; // SPEC test vector A, 2026-10-08T12:00:00Z
await withApp(async ({ page, url, errors }) => {
  for (const tab of ['rings', 'timeline', 'wave', 'calendar', 'sound']) {
    await page.goto(url(`?t=${t}&view=${tab}&zone=UTC`));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(img, `${tab}.jpg`), type: 'jpeg', quality: 84 });
  }
  console.log(errors.length ? errors : 'no errors');
}, { viewport: { width: 1440, height: 900 } });
await withApp(async ({ page, url }) => {
  await page.goto(url(`?t=${t}&view=rings&zone=UTC`));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(img, 'mobile.jpg'), type: 'jpeg', quality: 84 });
}, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
