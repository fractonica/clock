// Screenshots of the timeline view (element only) at several instants / viewports.
//   node tools/checks/check-timeline-shots.mjs [prefix] [only-name-substring]
import { withApp } from '../browse.mjs';

const T = { tMin: -11253795486.968, tMax: 28005212035.816 };
const win = (c, span) => `(async () => { window.__fractonica.instances.timeline.api.setWindow({ c: ${c}, span: ${span} }); })()`;
const D = 86400;
const scenarios = [
  { name: 'vecA', q: '?t=1791460800&view=timeline&zone=UTC', w: 1440, h: 900 },
  { name: 'vecA-mobile', q: '?t=1791460800&view=timeline&zone=UTC', w: 390, h: 844 },
  { name: 'all', q: '?t=1791460800&view=timeline&zone=UTC', w: 1440, h: 900, js: `window.__fractonica.instances.timeline.api.setPreset('all')` },
  { name: 'century', q: '?t=946684800&view=timeline&zone=UTC', w: 1440, h: 900, js: `window.__fractonica.instances.timeline.api.setPreset('century')` },
  { name: 'decade', q: '?t=946684800&view=timeline&zone=UTC', w: 1440, h: 900, js: `window.__fractonica.instances.timeline.api.setPreset('decade')` },
  { name: 'year', q: '?t=1791460800&view=timeline&zone=Europe/Berlin', w: 1440, h: 900, js: `window.__fractonica.instances.timeline.api.setPreset('year')` },
  { name: 'month', q: '?t=1791460800&view=timeline&zone=Europe/Berlin', w: 1440, h: 900, js: `window.__fractonica.instances.timeline.api.setPreset('month')` },
  { name: 'week', q: '?t=1791460800&view=timeline&zone=Europe/Berlin', w: 1440, h: 900, js: `window.__fractonica.instances.timeline.api.setPreset('week')` },
  { name: 'day', q: '?t=1791460800&view=timeline&zone=Europe/Berlin', w: 1440, h: 900, js: `window.__fractonica.instances.timeline.api.setPreset('day')` },
  { name: 'sec', q: '?t=1791460800&view=timeline&zone=UTC', w: 1440, h: 900, js: win(1791460800, 8) },
  { name: 'dst-spring', q: '?t=1774767600&view=timeline&zone=Europe/Berlin', w: 1440, h: 900, js: win(1774767600, 4 * D) },
  { name: 'dst-autumn', q: '?t=1792888800&view=timeline&zone=Europe/Berlin', w: 1440, h: 900, js: win(1792888800, 4 * D) },
  { name: 'edge-start', q: `?t=${T.tMin + 5}&view=timeline&zone=UTC`, w: 1440, h: 900, js: win(T.tMin + 5, 3 * 365.25 * D) },
  { name: 'edge-end', q: `?t=${T.tMax - 5}&view=timeline&zone=UTC`, w: 1440, h: 900, js: win(T.tMax - 5, 3 * 365.25 * D) },
  { name: 'y2061', q: '?t=2886085800&view=timeline&zone=UTC', w: 1440, h: 900 },
  { name: 'live', q: '?view=timeline', w: 1440, h: 900 },
  { name: 'lapse', q: '?t=1791460800&view=timeline&rate=3600&zone=UTC', w: 1440, h: 900 },
];
const prefix = process.argv[2] ?? 'tl';
const only = process.argv[3];
for (const sc of scenarios) {
  if (only && !sc.name.includes(only)) continue;
  await withApp(
    async ({ page, url, errors }) => {
      await page.goto(url(sc.q));
      await page.waitForTimeout(700);
      await page.addStyleTag({ content: '.topbar{position:static!important} .toast{display:none}' });
      if (sc.js) await page.evaluate(sc.js);
      await page.waitForTimeout(500);
      const out = `tools/out/${prefix}-${sc.name}.png`;
      await page.locator('#view-timeline').screenshot({ path: out });
      const mine = errors.filter((e) => /timeline/i.test(e) || /pageerror/.test(e));
      console.log(out, mine.length ? mine : 'clean');
    },
    { viewport: { width: sc.w, height: sc.h }, deviceScaleFactor: sc.dpr ?? 1 },
  );
}
