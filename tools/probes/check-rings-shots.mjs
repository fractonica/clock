// Screenshots of the rings view at several instants / viewports (element shots, sticky header neutralised).
// usage: node tools/checks/check-rings-shots.mjs [desktop|mobile|wide|all]
import path from 'node:path';
import { withApp, outDir } from '../browse.mjs';

const which = process.argv[2] ?? 'all';
const TMIN = -11253795486.968;
const TMAX = 28005212035.816;
const instants = {
  A: '1791460800',
  y2000: '946684800',
  y2061: '2886085800',
  tMinPlus5: String(TMIN + 5),
  tMaxMinus5: String(TMAX - 5),
  tMaxPlus10: String(TMAX + 10),
  live: null,
  lapse: '1791460800&rate=3600',
};
const sets = {
  desktop: { viewport: { width: 1440, height: 900 }, dsf: 1 },
  mobile: { viewport: { width: 390, height: 844 }, dsf: 2 },
  wide: { viewport: { width: 1920, height: 1080 }, dsf: 1 },
};
for (const [setName, cfg] of Object.entries(sets)) {
  if (which !== 'all' && which !== setName) continue;
  await withApp(async ({ page, url, errors }) => {
    for (const [name, t] of Object.entries(instants)) {
      const q = `?view=rings&zone=UTC${t ? '&t=' + t : ''}`;
      await page.goto(url(q));
      await page.addStyleTag({ content: '.topbar{position:static!important}' });
      await page.waitForTimeout(700);
      const file = path.join(outDir, `rings-${setName}-${name}.png`);
      await page.locator('.rings').screenshot({ path: file });
      console.log(file);
    }
    console.log(setName, 'own errors:', errors.filter((e) => /rings/.test(e)));
  }, { viewport: cfg.viewport, deviceScaleFactor: cfg.dsf });
}
