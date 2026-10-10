// Pure-mode screenshots of every tab: node tools/probes/pure-shots.mjs [prefix]
import { withApp } from '../browse.mjs';
const prefix = process.argv[2] ?? 'pure';
await withApp(async ({ page, url, errors, shot }) => {
  for (const tab of ['rings', 'timeline', 'wave', 'calendar', 'sound']) {
    await page.goto(url(`?pure=1&t=1791460800&view=${tab}${tab === 'wave' ? '&solar=1' : ''}`));
    await page.waitForTimeout(1300);
    await shot(`${prefix}-${tab}.png`);
  }
  console.log(errors.length ? errors : 'no errors');
}, { viewport: { width: 1440, height: 900 } });
