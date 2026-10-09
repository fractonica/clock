// Screenshots of the ladder + up next cards at the instants / viewports the brief asks for.
//   node tools/checks/check-ladder-shots.mjs            -> tools/out/ladder-*.png
import { withApp, outDir } from '../browse.mjs';
import path from 'node:path';

const MINE = /\[(ladder|upnext)\]|ui\/ladder|ui\/upnext|ladder\.css/;

async function cards(page, name, { both = true } = {}) {
  const sel = both ? ['#slot-ladder', '#slot-upnext'] : ['#slot-ladder'];
  const scrollY = await page.evaluate(() => scrollY);
  for (const [i, s] of sel.entries()) {
    const box = await page.locator(s).boundingBox();
    const file = path.join(outDir, `${name}-${i === 0 ? 'ladder' : 'upnext'}.png`);
    await page.screenshot({ path: file, fullPage: true, clip: { x: Math.max(0, box.x - 6), y: box.y + scrollY - 6, width: box.width + 12, height: box.height + 12 } });
    console.log('  ', path.relative(process.cwd(), file), Math.round(box.width) + 'x' + Math.round(box.height));
  }
}

const cases = [
  ['a-vecA', '?t=1791460800&zone=UTC&view=rings'],
  ['b-2000', '?t=946684800&zone=UTC&view=rings&sel=3'],
  ['c-2061', '?t=2886085800&zone=Europe/Kyiv&view=rings&sel=9'],
  ['d-start', '?t=-11253795481&zone=UTC&view=rings&sel=1'],
  ['e-end', '?t=28005212030&zone=UTC&view=rings&sel=7'],
];

for (const [vp, w, h, dpr] of [
  ['desktop', 1440, 900, 2],
  ['mobile', 390, 844, 2],
]) {
  await withApp(
    async ({ page, url, errors }) => {
      for (const [name, q] of cases) {
        await page.goto(url(q));
        await page.waitForTimeout(700);
        console.log(`${vp} ${name}`);
        await cards(page, `ladder-${vp}-${name}`);
      }
      const mine = errors.filter((e) => MINE.test(e));
      console.log(vp, mine.length ? mine : 'no ladder/upnext errors');
    },
    { viewport: { width: w, height: h }, deviceScaleFactor: dpr },
  );
}
