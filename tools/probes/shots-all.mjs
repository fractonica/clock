// Integration screenshots: every tab at desktop + mobile. node tools/probes/shots-all.mjs [t] [prefix]
import { withApp } from '../browse.mjs';
const t = process.argv[2] ?? '1791460800';
const prefix = process.argv[3] ?? 'all';
const tabs = ['rings', 'timeline', 'wave', 'calendar', 'sound'];
for (const [name, viewport] of [['d', { width: 1440, height: 900 }], ['m', { width: 390, height: 844 }]]) {
  await withApp(async ({ page, url, errors, shot }) => {
    for (const tab of tabs) {
      await page.goto(url(`?t=${t}&view=${tab}&zone=UTC`));
      await page.waitForTimeout(900);
      await shot(`${prefix}-${name}-${tab}.png`, { fullPage: name === 'm' });
    }
    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    console.log(name, 'overflow', overflow, 'errors', errors.length ? errors : 'none');
  }, { viewport });
}
