// Screenshot sweep for the calendar tab and the jump box.
//   node tools/checks/check-calendar-shots.mjs [name-prefix]
import { withApp } from '../browse.mjs';

const prefix = process.argv[2] ?? 'cal';
const mine = (e) => /calendar|jump/i.test(e);

async function sweep({ width, height, tag, panes = ['converter', 'calendar'], q = '?t=1791460800&view=calendar&zone=UTC', dsf = 1 }) {
  await withApp(
    async ({ page, url, errors, shot }) => {
      await page.goto(url(q));
      await page.waitForTimeout(900);
      const overflow = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const bad = [];
        for (const el of document.querySelectorAll('#view-calendar *, #slot-jump *')) {
          const r = el.getBoundingClientRect();
          if (r.width && r.right > vw + 1) bad.push(el.className + ' ' + Math.round(r.right));
        }
        return { vw, sw: document.documentElement.scrollWidth, bad: bad.slice(0, 8) };
      });
      console.log(tag, 'overflow', JSON.stringify(overflow));
      for (const pane of panes) {
        if (await page.locator('.cal-switch').isVisible()) await page.locator(`.cal-switch button:text-is("${pane === 'converter' ? 'Converter' : 'Calendar'}")`).click();
        await page.waitForTimeout(250);
        const loc = page.locator('#view-calendar');
        const file = `${prefix}-${tag}-${pane}.png`;
        await loc.screenshot({ path: `tools/out/${file}` });
        console.log('tools/out/' + file);
      }
      console.log(tag, 'errors:', errors.filter(mine));
    },
    { viewport: { width, height }, deviceScaleFactor: dsf },
  );
}
const only = process.argv[3];
if (!only || only === 'desktop') await sweep({ width: 1440, height: 900, tag: 'desktop' });
if (!only || only === 'wide') await sweep({ width: 1920, height: 1080, tag: 'wide', panes: ['calendar'] });
if (!only || only === 'mobile') await sweep({ width: 390, height: 844, tag: 'mobile', dsf: 2 });
