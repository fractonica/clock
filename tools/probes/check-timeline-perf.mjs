// Measures render() cost of the timeline over ~120 frames in several situations.
import { withApp } from '../browse.mjs';
await withApp(
  async ({ page, url, errors }) => {
    await page.goto(url('?t=1791460800&view=timeline&zone=Europe/Berlin'));
    await page.waitForTimeout(800);
    const result = await page.evaluate(async () => {
      const inst = window.__fractonica.instances.timeline;
      const api = inst.api;
      const store = window.__fractonica.store;
      const orig = inst.render;
      let samples = [];
      inst.render = function (...a) {
        const t = performance.now();
        const r = orig.apply(this, a);
        samples.push(performance.now() - t);
        return r;
      };
      const frames = (n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      const stat = () => {
        const s = [...samples].sort((a, b) => a - b);
        const avg = s.reduce((x, y) => x + y, 0) / s.length;
        const out = { n: s.length, avg: +avg.toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3), max: +s[s.length - 1].toFixed(3) };
        samples = [];
        return out;
      };
      const out = {};
      // idle: nothing changes
      store.setTime(1791460800);
      api.setWindow({ c: 1791460800, span: 86400 });
      await frames(30);
      samples = [];
      await frames(120);
      out.idle = stat();
      // every frame drawn: pan at several scales
      const scales = { all: 4.1e10, century: 3.15e9, decade: 3.15e8, year: 3.15e7, month: 2.6e6, week: 6e5, day: 86400, hours6: 21600, minutes10: 600, sec20: 20 };
      for (const [name, span] of Object.entries(scales)) {
        api.setWindow({ c: 1791460800, span });
        await frames(5);
        samples = [];
        for (let i = 0; i < 120; i++) {
          api.setWindow({ c: 1791460800 + i * span * 0.004, span });
          await frames(1);
        }
        out['pan ' + name] = stat();
      }
      // continuous zoom animation (log-sweep from the whole catalogue down to 2 s and back)
      samples = [];
      for (let i = 0; i < 240; i++) {
        const u = i < 120 ? i / 119 : 1 - (i - 120) / 119;
        api.setWindow({ c: 1791460800, span: Math.exp(Math.log(4.1e10) + (Math.log(2) - Math.log(4.1e10)) * u) });
        await frames(1);
      }
      out['zoom sweep'] = stat();
      // live follow at second scale
      store.goLive();
      api.setFollow(true);
      api.setWindow({ c: store.t(), span: 20 });
      await frames(10);
      samples = [];
      await frames(120);
      out['live follow 20 s'] = stat();
      api.setWindow({ c: store.t(), span: 86400 });
      await frames(10);
      samples = [];
      await frames(120);
      out['live follow day'] = stat();
      inst.render = orig;
      return out;
    });
    console.table(result);
    console.log(errors.filter((e) => /timeline|pageerror/i.test(e)));
  },
  { viewport: { width: 1440, height: 900 } },
);
