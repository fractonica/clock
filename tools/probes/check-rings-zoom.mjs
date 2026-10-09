// usage: node tools/checks/check-rings-zoom.mjs "<query>" <selector> <out.png> [w] [h] [dsf]
import { withApp } from '../browse.mjs';
const [q, sel, out, w = '1440', h = '900', dsf = '2'] = process.argv.slice(2);
await withApp(async ({ page, url, errors, shot }) => {
  await page.goto(url(q));
  await page.addStyleTag({ content: '.topbar{position:static!important}' });
  await page.waitForTimeout(900);
  const el = page.locator(sel).first();
  const file = (await import('node:path')).join((await import('./browse.mjs')).outDir, out);
  await el.screenshot({ path: file });
  console.log(file);
  const own = errors.filter((e) => /rings/.test(e));
  console.log('own errors:', own);
}, { viewport: { width: +w, height: +h }, deviceScaleFactor: +dsf });
