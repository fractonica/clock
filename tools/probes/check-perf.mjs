// Whole-app frame budget: per-module render() cost and rAF intervals per tab, live and in time-lapse.
import { withApp } from '../browse.mjs';
const scenarios = [['live', ''], ['lapse x3600', '&rate=3600'], ['lapse x1 year/s', '&rate=31557600']];
await withApp(async ({ page, url, errors }) => {
  for (const [name, q] of scenarios) {
    for (const tab of ['rings', 'timeline', 'wave', 'calendar', 'sound']) {
      await page.goto(url(`?view=${tab}${q.includes('rate') ? '&t=1791460800' : ''}${q}`));
      await page.waitForTimeout(700);
      const r = await page.evaluate(async () => {
        const f = window.__fractonica;
        const costs = {};
        for (const [id, inst] of Object.entries(f.instances)) {
          if (!inst.render) continue;
          const orig = inst.render.bind(inst);
          const c = (costs[id] = { n: 0, total: 0, max: 0 });
          inst.render = (frame, info) => { const t0 = performance.now(); orig(frame, info); const d = performance.now() - t0; c.n++; c.total += d; if (d > c.max) c.max = d; };
        }
        const frames = []; let last = performance.now();
        await new Promise((res) => { let n = 0; const loop = (t) => { frames.push(t - last); last = t; if (++n < 150) requestAnimationFrame(loop); else res(); }; requestAnimationFrame(loop); });
        frames.sort((a, b) => a - b);
        const sum = Object.values(costs).reduce((a, c) => a + (c.n ? c.total / c.n : 0), 0);
        const top = Object.entries(costs).filter(([, c]) => c.n).map(([id, c]) => [id, +(c.total / c.n).toFixed(2), +c.max.toFixed(1)]).sort((a, b) => b[1] - a[1]).slice(0, 4);
        return { median: +frames[75].toFixed(1), p95: +frames[142].toFixed(1), max: +frames[149].toFixed(1), sumRenderMs: +sum.toFixed(2), top };
      });
      console.log(name.padEnd(16), tab.padEnd(9), JSON.stringify(r));
    }
  }
  console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
});
