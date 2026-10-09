// Visual check for the ladder / upnext cards.
//   node tools/checks/check-ladder.mjs [query] [out.png] [width] [height] [selector] [dpr]
import { withApp, outDir } from '../browse.mjs';
import path from 'node:path';

const [query = '?t=1791460800&zone=UTC&view=rings', out = 'ladder-desktop.png', w = '1440', h = '900', selector = '#slot-ladder', dpr = '1'] = process.argv.slice(2);
await withApp(
  async ({ page, url, errors }) => {
    await page.goto(url(query));
    await page.waitForTimeout(900);
    const box = await page.locator(selector).boundingBox();
    await page.screenshot({ path: path.join(outDir, out), fullPage: true, clip: { x: box.x - 6, y: box.y + (await page.evaluate(() => scrollY)) - 6, width: box.width + 12, height: box.height + 12 } });
    console.log('saved tools/out/' + out, Math.round(box.width) + 'x' + Math.round(box.height));
    const mine = errors.filter((e) => /\[(ladder|upnext)\]|ui\/ladder|ui\/upnext|ladder\.css/.test(e));
    console.log(mine.length ? mine : 'no ladder/upnext errors');
  },
  { viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr },
);
