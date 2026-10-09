// Fuzz: random windows, zones, depth ranges and cursor times; the timeline must never throw
// and must keep every drawn number finite.
import { withApp } from '../browse.mjs';
await withApp(
  async ({ page, url, errors }) => {
    await page.goto(url('?t=1791460800&view=timeline'));
    await page.waitForTimeout(800);
    const res = await page.evaluate(async () => {
      const f = window.__fractonica;
      const inst = f.instances.timeline;
      const api = inst.api;
      const zones = ['UTC', 'Europe/Berlin', 'Asia/Kolkata', 'Pacific/Auckland', 'America/Sao_Paulo', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'America/St_Johns', 'Africa/Casablanca'];
      let seed = 12345;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      const frames = (n) => new Promise((res) => { let i = 0; const g = () => (++i >= n ? res() : requestAnimationFrame(g)); requestAnimationFrame(g); });
      const nan = [];
      const ctx2d = document.querySelector('.tl-canvas').getContext('2d');
      // watch for NaN / Infinity reaching the canvas
      for (const m of ['moveTo', 'lineTo', 'fillRect', 'strokeRect', 'arc', 'rect', 'fillText', 'arcTo']) {
        const o = ctx2d[m].bind(ctx2d);
        ctx2d[m] = (...a) => {
          if (a.some((v) => typeof v === 'number' && !Number.isFinite(v))) nan.push(m + ':' + a.join(','));
          return o(...a);
        };
      }
      const L = f.model.tMax - f.model.tMin;
      for (let i = 0; i < 700; i++) {
        if (i % 25 === 0) {
          f.store.set({ zone: zones[Math.floor(rnd() * zones.length)] });
          const a = 1 + Math.floor(rnd() * 14);
          const b = Math.min(14, a + Math.floor(rnd() * 14));
          f.store.set({ minDepth: a, maxDepth: b, selectedLevel: Math.floor(rnd() * 14) });
          f.store.setTime(f.model.tMin + rnd() * L);
          if (rnd() < 0.2) f.store.setRate((rnd() - 0.5) * 1e6);
          else f.store.pause();
        }
        const span = Math.exp(Math.log(2) + rnd() * (Math.log(4.2e10) - Math.log(2)));
        const c = f.model.tMin - 1e9 + rnd() * (L + 2e9);
        api.setWindow({ c, span });
        await frames(1);
      }
      return { nan: nan.slice(0, 5), nanCount: nan.length, failed: !!inst.__failed };
    });
    console.log(res);
    console.log(errors.filter((e) => /timeline|pageerror/i.test(e)));
  },
  { viewport: { width: 1300, height: 900 } },
);

// ---- random input: mouse, wheel and keys on the real canvas -------------------------------------------
await withApp(
  async ({ page, url, errors }) => {
    await page.goto(url('?t=1791460800&view=timeline&zone=Europe/Berlin'));
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('.tl-canvas').scrollIntoView({ block: 'center' }));
    const box = await page.locator('.tl-canvas').boundingBox();
    let seed = 777;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const keys = ['+', '-', 'ArrowLeft', 'ArrowRight', 'Home', 'Enter', 'f', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'];
    await page.evaluate(() => document.querySelector('.tl-canvas').focus());
    for (let i = 0; i < 500; i++) {
      const x = box.x + rnd() * box.width;
      const y = box.y + rnd() * box.height;
      const r = rnd();
      if (r < 0.25) await page.mouse.click(x, y);
      else if (r < 0.4) await page.mouse.dblclick(x, y);
      else if (r < 0.6) {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + (rnd() - 0.5) * 300, y + (rnd() - 0.5) * 50, { steps: 3 });
        await page.mouse.up();
      } else if (r < 0.8) {
        await page.mouse.move(x, y);
        await page.mouse.wheel((rnd() - 0.5) * 100, (rnd() - 0.5) * 800);
      } else if (r < 0.95) await page.keyboard.press(keys[Math.floor(rnd() * keys.length)]);
      else await page.click(['[data-preset="all"]', '[data-preset="day"]', '[data-act="fit"]', '[data-act="follow"]', '[data-act="centre"]', '[data-act="in"]', '[data-act="out"]'][Math.floor(rnd() * 7)]);
      if (i % 50 === 0) await page.waitForTimeout(60);
    }
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => { const inst = window.__fractonica.instances.timeline; return { failed: !!inst.__failed, w: inst.api.window }; });
    console.log('random input:', st.failed ? 'RENDER FAILED' : 'ok', st.w);
    console.log(errors.filter((e) => /timeline|pageerror/i.test(e)));
  },
  { viewport: { width: 1300, height: 900 } },
);
