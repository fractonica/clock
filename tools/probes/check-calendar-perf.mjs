// Render cost of the calendar and jump modules in live mode and time-lapse.
import { withApp } from '../browse.mjs';
for (const [name, q, depthDeep] of [
  ['live', '?view=calendar&zone=Europe/Kyiv'],
  ['lapse 1h/s', '?t=1791460800&view=calendar&rate=3600&zone=UTC'],
  ['lapse 1mo/s', '?t=1791460800&view=calendar&rate=2629800&zone=UTC'],
  ['lapse 1y/s', '?t=1791460800&view=calendar&rate=31557600&zone=UTC'],
]) {
  await withApp(
    async ({ page, url, errors }) => {
      await page.goto(url(q));
      await page.waitForTimeout(600);
      for (const eta of ['', 'η']) {
        if (eta) await page.locator('.cal-ovseg button:text-is("η")').click();
        const r = await page.evaluate(async () => {
          const inst = window.__fractonica.instances.calendar;
          const orig = inst.render.bind(inst);
          const ds = [];
          inst.render = (f, i) => {
            const t0 = performance.now();
            orig(f, i);
            ds.push(performance.now() - t0);
          };
          await new Promise((r) => setTimeout(r, 2500));
          inst.render = orig;
          ds.sort((a, b) => a - b);
          const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
          return { frames: ds.length, avg: +avg.toFixed(3), p95: +ds[Math.floor(ds.length * 0.95)].toFixed(3), max: +ds.at(-1).toFixed(2), view: inst.monthView };
        });
        console.log(name.padEnd(12), eta || 'ε', JSON.stringify(r));
      }
      const e = errors.filter((x) => /calendar|jump|cal-/i.test(x));
      if (e.length) console.log('ERRORS', e);
    },
    { viewport: { width: 1920, height: 1080 } },
  );
}
