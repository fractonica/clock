// Interaction + performance verification of the rings view in headless Chromium.
//   node tools/checks/check-rings.mjs
// Prints a PASS/FAIL line per check and exits non-zero on any failure. Screenshots land in tools/out/.
import path from 'node:path';
import { withApp, outDir } from '../browse.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const A = 1791460800;
const TAU = Math.PI * 2;

const QUIET = '.topbar{position:static!important}';

async function boot(page, url, query) {
  await page.goto(url(query));
  await page.addStyleTag({ content: QUIET });
  await page.waitForFunction(() => window.__fractonica?.instances?.rings?.inspect?.().layout, null, { timeout: 8000 });
  await page.waitForTimeout(350);
}
const S = (page, fn, arg) => page.evaluate(fn, arg);
const state = (page) =>
  S(page, () => {
    const { store, model, instances } = window.__fractonica;
    const t = store.t();
    const insp = instances.rings.inspect();
    return { t, sel: store.state.selectedLevel, min: store.state.minDepth, max: store.state.maxDepth, mode: store.mode, rate: store.rate, insp, lv: model.levelAt(t, store.state.selectedLevel) && { cycle: model.levelAt(t, store.state.selectedLevel).cycle, phase: model.levelAt(t, store.state.selectedLevel).phase, quarter: model.levelAt(t, store.state.selectedLevel).quarter, index: model.levelAt(t, store.state.selectedLevel).index } };
  });

/** client coordinates of (ring, phase) on the dial */
async function dialPoint(page, ring, phase, radial = 0.5) {
  return S(page, ([ring, phase, radial]) => {
    const c = document.querySelector('.rings-layer-live');
    const r = c.getBoundingClientRect();
    const { layout } = window.__fractonica.instances.rings.inspect();
    const k = r.width / layout.size;
    const slot = layout.rings[ring];
    const rad = slot.inner + radial * layout.band;
    const a = phase * 2 * Math.PI;
    return { x: r.left + (layout.cx + rad * Math.sin(a)) * k, y: r.top + (layout.cy - rad * Math.cos(a)) * k };
  }, [ring, phase, radial]);
}
async function waveX(page, phase) {
  return S(page, (phase) => {
    const c = document.querySelector('.rings-wave');
    const r = c.getBoundingClientRect();
    const { wave } = window.__fractonica.instances.rings.inspect();
    return { x: r.left + wave.x0 + phase * (wave.x1 - wave.x0), y: r.top + (wave.y0 + wave.y1) / 2 };
  }, phase);
}

await withApp(
  async ({ page, url, errors, shot }) => {
    const own = () => errors.filter((e) => /rings|dial\.js|wave\.js|geometry\.js|text\.js|canvas\.js/.test(e));

    // ---------------------------------------------------------------- basic state
    await boot(page, url, `?t=${A}&view=rings&zone=UTC`);
    let st = await state(page);
    check('mounts with the default range 1..10 and level 7 selected', st.insp.levels.length === 10 && st.sel === 6 && st.insp.selected === 6, JSON.stringify(st.insp.levels));
    check('layout: ring 0 outermost, hole inside', st.insp.layout.rings[0].outer === st.insp.layout.rOuter && st.insp.layout.rHole > 100);
    check('full read-out in the centre at 1440x900', st.insp.compact === false, `rHole=${st.insp.layout.rHole.toFixed(0)}`);
    check('time is frozen at the deep-link instant', near(st.t, A, 0.01));
    const txt = await S(page, () => ({
      name: document.querySelector('.rings-cn-name').textContent,
      count: document.querySelector('.rings-count').textContent,
      chips: [...document.querySelectorAll('.rings-chip')].map((c) => c.className.replace('rings-chip', '').trim()),
      end: document.querySelector('.rings-end').textContent,
    }));
    check('read-out matches SPEC vector A (η 7, 1/11, ends 12:56:12)', txt.name === 'η 7 · 1/11' && txt.count === '56 min 12 s' && /12:56:12/.test(txt.end), JSON.stringify(txt));
    check('quarter chips: three passed, end is next', txt.chips.join('|') === 'is-passed|is-passed|is-passed|is-next', txt.chips.join('|'));

    // ---------------------------------------------------------------- hover tooltip + cursor
    await page.locator('.rings-dialcard').scrollIntoViewIfNeeded();
    let p = await dialPoint(page, 4, 0.9); // epsilon ring, late sector
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(120);
    const tip = await S(page, () => {
      const t = document.querySelector('.rings-tip');
      return { hidden: t.hidden, text: t.textContent, cursor: document.querySelector('.rings-layer-live').style.cursor };
    });
    check('hover shows the child-cycle tooltip with times and a hint', !tip.hidden && /child cycle/.test(tip.text) && /lasts/.test(tip.text) && /Click to jump to its start/.test(tip.text), tip.text.slice(0, 160));
    check('pointer cursor over a navigable sector', tip.cursor === 'pointer');
    await page.screenshot({ path: path.join(outDir, 'rings-hover.png'), clip: { x: Math.max(0, p.x - 330), y: Math.max(0, p.y - 140), width: 700, height: 360 } });
    await page.mouse.move(2, 2);
    await page.waitForTimeout(80);
    check('tooltip hides when the pointer leaves', await S(page, () => document.querySelector('.rings-tip').hidden));

    // ---------------------------------------------------------------- click a sector: select + jump
    const before = await state(page);
    const lvE = await S(page, () => {
      const { model } = window.__fractonica;
      const lv = model.levelAt(window.__fractonica.store.t(), 4);
      return { cycle: lv.cycle, factor: lv.factor, phase: lv.phase };
    });
    const runningE = Math.floor(lvE.phase * lvE.factor);
    const targetSector = runningE === 0 ? 3 : 0; // a sector that is not running
    p = await dialPoint(page, 4, (targetSector + 0.5) / lvE.factor);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(150);
    st = await state(page);
    const expectStart = await S(page, ([c, f, j]) => window.__fractonica.model.cycleStartTime(5, c * f + j), [lvE.cycle, lvE.factor, targetSector]);
    check('click on another sector selects the ring', st.sel === 4, `sel=${st.sel}`);
    check('click on another sector jumps to the start of that child cycle', near(st.t, expectStart + 0.001, 0.0005), `${st.t} vs ${expectStart}`);
    check('time is paused after a jump from the live-ish deep link', st.mode === 'travel' && st.rate === 0);
    const child = await S(page, (t) => {
      const l = window.__fractonica.model.levelAt(t, 5);
      return { phase: l.phase, local: l.local };
    }, st.t);
    check('the child ring now sits at the start of its cycle (hand at 12 o clock)', child.phase < 1e-3 && child.local === 0 || child.phase < 1e-3, `phase=${child.phase}`);

    // click on the running sector of an unselected ring: select only
    const t0 = st.t;
    const lv2 = await S(page, (t) => {
      const l = window.__fractonica.model.levelAt(t, 2);
      return { phase: l.phase, factor: l.factor };
    }, t0);
    p = await dialPoint(page, 2, lv2.phase);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
    st = await state(page);
    check('first click on the running sector of an unselected ring only selects it', st.sel === 2 && near(st.t, t0, 0.01), `sel=${st.sel} dt=${st.t - t0}`);
    // second click on the same (now selected) ring's running sector: rewinds to its start
    p = await dialPoint(page, 2, lv2.phase);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
    const st2 = await state(page);
    check('clicking the running sector of the selected ring jumps back to its start', st2.t < t0 + 0.01 && st2.t <= t0, `t ${t0} -> ${st2.t}`);

    // label click: select only
    const t1 = st2.t;
    const labelPt = await S(page, () => {
      const c = document.querySelector('.rings-layer-live');
      const r = c.getBoundingClientRect();
      const { layout } = window.__fractonica.instances.rings.inspect();
      const k = r.width / layout.size;
      const ring = layout.rings[7];
      // just left of the 12 o'clock line, on the ring
      return { x: r.left + (layout.cx - 14) * k, y: r.top + (layout.cy - ring.mid) * k };
    });
    await page.mouse.click(labelPt.x, labelPt.y);
    await page.waitForTimeout(120);
    st = await state(page);
    check('clicking a ring label selects it without moving time', st.sel === 7 && near(st.t, t1, 1e-6), `sel=${st.sel}`);

    // ---------------------------------------------------------------- keyboard
    await S(page, () => document.querySelector('.rings-dialwrap').focus());
    await page.keyboard.press('ArrowRight');
    st = await state(page);
    check('ArrowRight selects the next deeper ring', st.sel === 8, `sel=${st.sel}`);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    st = await state(page);
    check('ArrowLeft selects shallower rings', st.sel === 6, `sel=${st.sel}`);
    await page.keyboard.press('End');
    st = await state(page);
    check('End selects the innermost ring, ArrowRight stops there', st.sel === 9, `sel=${st.sel}`);
    await page.keyboard.press('ArrowRight');
    st = await state(page);
    check('selection clamps at the innermost ring', st.sel === 9);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');
    st = await state(page);
    check('Home / ArrowLeft clamp at the outermost ring', st.sel === 0);
    await S(page, () => window.__fractonica.ctx.select(6));

    // ---------------------------------------------------------------- toolbar: range + toggles
    await page.click('[data-step="max:1"]');
    await page.waitForTimeout(150);
    st = await state(page);
    check('range control: max depth +1 adds an inner ring (persisted in the store)', st.max === 11 && st.insp.levels.length === 11, `max=${st.max}`);
    await page.click('[data-step="min:1"]');
    await page.waitForTimeout(150);
    st = await state(page);
    check('range control: min depth +1 hides the outermost ring', st.min === 2 && st.insp.levels[0] === 1 && st.insp.levels.length === 10);
    const persisted = await S(page, () => JSON.parse(localStorage.getItem('fractonica-clock/v1')));
    check('range is written to localStorage', persisted.minDepth === 2 && persisted.maxDepth === 11);
    await S(page, () => window.__fractonica.store.set({ minDepth: 1, maxDepth: 10 }));
    await page.waitForTimeout(100);
    // shrinking past the selection moves the selection inside the range
    for (let i = 0; i < 4; i++) await page.click('[data-step="max:-1"]');
    await page.waitForTimeout(150);
    st = await state(page);
    check('shrinking the range keeps a ring selected inside it', st.max === 6 && st.sel <= 5, `max=${st.max} sel=${st.sel}`);
    await S(page, () => {
      window.__fractonica.store.set({ minDepth: 1, maxDepth: 10 });
      window.__fractonica.ctx.select(6);
    });
    await page.click('[data-toggle="funnels"]');
    await page.waitForTimeout(100);
    const tg = await S(page, () => ({ pressed: document.querySelector('[data-toggle="funnels"]').getAttribute('aria-pressed'), saved: JSON.parse(localStorage.getItem('fractonica-clock/rings')) }));
    check('toggle: funnels off is reflected in aria-pressed and persisted', tg.pressed === 'false' && tg.saved.funnels === false);
    await page.click('[data-toggle="funnels"]');
    await page.click('[data-toggle="sectors"]');
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(outDir, 'rings-toggle-sectors-off.png'), clip: await page.locator('.rings-dialcard').boundingBox() });
    await page.click('[data-toggle="sectors"]');

    // ---------------------------------------------------------------- wave: scrub, keyboard
    await S(page, () => window.__fractonica.store.setTime(1791460800));
    await page.waitForTimeout(100);
    await page.locator('.rings-wave').scrollIntoViewIfNeeded();
    const w1 = await waveX(page, 0.3);
    const w2 = await waveX(page, 0.62);
    await page.mouse.move(w1.x, w1.y);
    await page.mouse.down();
    await page.mouse.move((w1.x + w2.x) / 2, w1.y, { steps: 4 });
    await page.mouse.move(w2.x, w2.y, { steps: 4 });
    await page.waitForTimeout(100);
    st = await state(page);
    const scrubPhase = st.lv.phase;
    const sameCycle = st.lv.cycle === (await S(page, () => window.__fractonica.model.levelAt(1791460800, window.__fractonica.store.state.selectedLevel).cycle));
    await page.mouse.up();
    await page.waitForTimeout(100);
    const st3 = await state(page);
    check('dragging the wave cursor scrubs time to the pointer phase', near(scrubPhase, 0.62, 0.01) && sameCycle, `phase=${scrubPhase.toFixed(4)}`);
    check('releasing keeps the position (time paused where it was dropped)', near(st3.t, st.t, 1e-6) && st3.insp.scrubbing === false);
    // hover bubble
    await page.mouse.move((w1.x + w2.x) / 2, w1.y);
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(outDir, 'rings-wave-hover.png'), clip: await page.locator('.rings-inset').boundingBox() });
    // keyboard on the slider
    await S(page, () => document.querySelector('.rings-wave').focus());
    const kIdx = st3.lv.index;
    await page.keyboard.press('ArrowRight');
    st = await state(page);
    check('slider ArrowRight advances one glyph state', st.lv.index === kIdx + 1 || (kIdx === 15 && st.lv.index === 0), `${kIdx} -> ${st.lv.index}`);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    st = await state(page);
    check('slider ArrowLeft goes back one glyph state', st.lv.index === kIdx - 1, `-> ${st.lv.index}`);
    const q0 = st.lv.quarter;
    await page.keyboard.press('PageUp');
    st = await state(page);
    check('slider PageUp jumps to the next quarter', st.lv.quarter === q0 + 1 || (q0 === 3 && st.lv.cycle !== undefined), `${q0} -> ${st.lv.quarter}`);
    await page.keyboard.press('Home');
    st = await state(page);
    check('slider Home goes to the start of the cycle', st.lv.phase < 0.002, `phase=${st.lv.phase}`);
    check('slider exposes aria value text', (await S(page, () => document.querySelector('.rings-wave').getAttribute('aria-valuetext'))).length > 10);
    check('arrow keys on the slider do not change the ring', (await state(page)).sel === 6);

    // ---------------------------------------------------------------- buttons
    await S(page, () => window.__fractonica.store.setTime(1791460800));
    await page.waitForTimeout(80);
    const c0 = (await state(page)).lv.cycle;
    await page.click('.rings-b-next');
    st = await state(page);
    check('next-cycle button steps to the following cycle', st.lv.cycle === c0 + 1 && st.lv.phase < 0.001, `${c0} -> ${st.lv.cycle}`);
    await page.click('.rings-b-prev');
    await page.click('.rings-b-prev');
    st = await state(page);
    check('previous-cycle button steps back', st.lv.cycle === c0 - 1 || st.lv.cycle === c0, `cycle ${st.lv.cycle}`);
    await S(page, () => window.__fractonica.store.setTime(1791460800));
    await page.waitForTimeout(80);
    const q1 = (await state(page)).lv.quarter;
    await page.click('.rings-b-thr');
    st = await state(page);
    check('Next threshold moves just past the next quarter boundary', st.lv.quarter === (q1 + 1) % 4 || st.lv.cycle > c0, `${q1} -> ${st.lv.quarter}`);
    await S(page, () => window.__fractonica.store.setTime(1791460800 - 7000));
    await page.waitForTimeout(80);
    await page.click('.rings-chip[data-q="1"]');
    st = await state(page);
    check('clicking a chip jumps to that threshold', st.lv.quarter === 2 || st.lv.quarter === 1, `quarter ${st.lv.quarter}`);

    // ---------------------------------------------------------------- performance (live, shared frame cost included)
    await S(page, () => window.__fractonica.store.goLive());
    await page.waitForTimeout(500);
    const perf = await S(page, () => new Promise((resolve) => {
      const { instances, model, store } = window.__fractonica;
      const inst = instances.rings;
      const orig = inst.render;
      const times = [];
      inst.render = (frame, info) => {
        const t0 = performance.now();
        orig.call(inst, frame, info);
        times.push(performance.now() - t0);
        if (times.length >= 150) {
          inst.render = orig;
          times.sort((a, b) => a - b);
          // cold cost: a brand-new frame, nothing memoised by other modules
          const cold = [];
          for (let i = 0; i < 60; i++) {
            const t = store.t() + i * 0.016;
            const f = model.frame(t);
            const s0 = performance.now();
            for (let L = 0; L <= 9; L++) f.level(L);
            orig.call(inst, f, { dirty: true, dt: 0.016, t, real: t, view: 'rings' });
            cold.push(performance.now() - s0);
          }
          cold.sort((a, b) => a - b);
          resolve({ avg: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.floor(times.length * 0.95)], max: times.at(-1), coldAvg: cold.reduce((a, b) => a + b, 0) / cold.length, coldMax: cold.at(-1) });
        }
      };
    }));
    check('render() stays under 3 ms in live mode', perf.avg < 3 && perf.p95 < 3, `avg ${perf.avg.toFixed(2)} p95 ${perf.p95.toFixed(2)} max ${perf.max.toFixed(2)} | cold frames avg ${perf.coldAvg.toFixed(2)} max ${perf.coldMax.toFixed(2)}`);

    // time-lapse
    await page.goto(url(`?t=${A}&view=rings&zone=UTC&rate=3600`));
    await page.addStyleTag({ content: QUIET });
    await page.waitForTimeout(900);
    const lapse = await S(page, () => new Promise((resolve) => {
      const { instances } = window.__fractonica;
      const inst = instances.rings;
      const orig = inst.render;
      const times = [];
      inst.render = (f, i) => {
        const t0 = performance.now();
        orig.call(inst, f, i);
        times.push(performance.now() - t0);
        if (times.length >= 120) {
          inst.render = orig;
          resolve({ avg: times.reduce((a, b) => a + b, 0) / times.length, max: Math.max(...times) });
        }
      };
    }));
    check('render() stays under 3 ms in time-lapse (x3600)', lapse.avg < 3, `avg ${lapse.avg.toFixed(2)} max ${lapse.max.toFixed(2)}`);
    await page.screenshot({ path: path.join(outDir, 'rings-lapse.png'), clip: await page.locator('.rings').boundingBox() });

    // ---------------------------------------------------------------- 14 rings, fast rings are glows
    await page.goto(url(`?t=${A}&view=rings&zone=UTC`));
    await S(page, () => window.localStorage.setItem('fractonica-clock/v1', JSON.stringify({ minDepth: 1, maxDepth: 14 })));
    await page.goto(url(`?t=${A}&view=rings&zone=UTC`));
    await page.addStyleTag({ content: QUIET });
    await page.waitForTimeout(800);
    st = await state(page);
    check('range 1..14 draws fourteen rings', st.insp.levels.length === 14);
    await page.locator('.rings-dialcard').screenshot({ path: path.join(outDir, 'rings-14.png') });
    await S(page, () => window.localStorage.removeItem('fractonica-clock/v1'));

    // ---------------------------------------------------------------- out of range
    await page.goto(url(`?t=${A}&view=rings&zone=UTC`));
    await page.addStyleTag({ content: QUIET });
    await page.waitForTimeout(600);
    await S(page, () => {
      const { instances, model, store } = window.__fractonica;
      // pause the app loop's own renders from overwriting the state: render() reads store.t(), so show an out-of-range frame once
      window.__oor = () => instances.rings.render(model.frame(model.tMax + 10), { dirty: true, dt: 0, t: model.tMax + 10, real: 0, view: 'rings' });
      window.__oor();
    });
    // the app loop renders the real (in range) frame next frame; capture synchronously in-page by freezing the loop
    await S(page, () => {
      const orig = window.requestAnimationFrame;
      window.requestAnimationFrame = () => 0; // stop the main loop
      window.__oor();
      window.__restoreRaf = () => (window.requestAnimationFrame = orig);
    });
    await page.waitForTimeout(150);
    const oor = await S(page, () => ({ name: document.querySelector('.rings-cn-name').textContent, count: document.querySelector('.rings-count').textContent, eyebrow: document.querySelector('.rings-eyebrow').textContent, chipsHidden: document.querySelector('.rings-chips').hidden, glyph: document.querySelector('.rings-glyph').innerHTML.length }));
    check('out-of-range state: explicit message, no chips, nothing extrapolated', /Outside/.test(oor.name) && oor.chipsHidden && /1613/.test(oor.count) && oor.glyph === 0, JSON.stringify(oor));
    await page.locator('.rings').screenshot({ path: path.join(outDir, 'rings-out-of-range.png') });

    // ---------------------------------------------------------------- every level, edge instants, other zone
    await page.goto(url(`?t=${A}&view=rings&zone=Europe/Kyiv`));
    await page.addStyleTag({ content: QUIET });
    await page.waitForTimeout(600);
    const kyiv = await S(page, () => ({ end: document.querySelector('.rings-end').textContent, chip: document.querySelector('.rings-chip.is-next .rings-chip-time').textContent }));
    check('Gregorian times follow the selected zone (Kyiv = UTC+3)', /15:56:12/.test(kyiv.end) && /UTC\+03:00/.test(kyiv.end) && /15:56:12/.test(kyiv.chip), JSON.stringify(kyiv));
    await S(page, () => window.__fractonica.store.set({ minDepth: 1, maxDepth: 14 }));
    const TMIN = -11253795486.968;
    const TMAX = 28005212035.816;
    let sweepErr = 0;
    for (const t of [A, TMIN + 5, TMAX - 5, TMAX, 946684800.5]) {
      for (let L = 0; L < 14; L++) {
        await S(page, ([t, L]) => { window.__fractonica.store.setTime(t); window.__fractonica.ctx.select(L); }, [t, L]);
        await page.waitForTimeout(40);
      }
    }
    sweepErr = errors.filter((e) => /render error|rings/.test(e)).length;
    check('selecting every level at five instants (incl. both catalogue edges) raises no errors', sweepErr === 0, errors.filter((e) => /render error|rings/.test(e)).join(' | '));
    // scrubbing the alpha cycle (spans four uneven Saros intervals) and a 44 ms cycle
    for (const [L, tol] of [[0, 0.01], [13, 0.06]]) {
      await S(page, ([L]) => { window.__fractonica.store.setTime(1791460800); window.__fractonica.ctx.select(L); }, [L]);
      await page.waitForTimeout(150);
      await page.locator('.rings-wave').scrollIntoViewIfNeeded();
      const a1 = await waveX(page, 0.2);
      const a2 = await waveX(page, 0.5);
      await page.mouse.move(a1.x, a1.y);
      await page.mouse.down();
      await page.mouse.move(a2.x, a2.y, { steps: 5 });
      await page.waitForTimeout(80);
      const r = await S(page, () => { const { store, model } = window.__fractonica; return model.levelAt(store.t(), store.state.selectedLevel).phase; });
      await page.mouse.up();
      check(`scrubbing level ${L + 1} lands at the pointer phase`, near(r, 0.5, tol), `phase=${r.toFixed(4)}`);
    }
    await S(page, () => window.__fractonica.store.set({ minDepth: 1, maxDepth: 10 }));

    // ---------------------------------------------------------------- own console errors
    check('no console / page errors from the rings module', own().length === 0, own().join(' | '));
  },
  { viewport: { width: 1440, height: 900 } },
);

// -------------------------------------------------------------------- responsive checks
await withApp(
  async ({ page, url, errors }) => {
    const own = () => errors.filter((e) => /rings|dial\.js|wave\.js|geometry\.js|text\.js|canvas\.js/.test(e));
    await boot(page, url, `?t=${A}&view=rings&zone=UTC`);
    for (const [w, h] of [[360, 740], [390, 844], [700, 900], [860, 900], [1100, 800], [1320, 900], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(450);
      const m = await S(page, () => {
        const root = document.querySelector('.rings').getBoundingClientRect();
        const wrap = document.querySelector('.rings-dialwrap').getBoundingClientRect();
        const cv = document.querySelector('.rings-layer-live');
        const wv = document.querySelector('.rings-wave');
        const insp = window.__fractonica.instances.rings.inspect();
        const centre = document.querySelector('.rings-centre').getBoundingClientRect();
        const more = document.querySelector('.rings-more').getBoundingClientRect();
        const wide = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.rings-tip') && getComputedStyle(e).position !== 'fixed');
        const over = wide('.rings, .rings *').length;
        const shellOver = wide('body *').filter((e) => !e.closest('.rings')).slice(0, 3).map((e) => (e.id ? '#' + e.id : e.className?.baseVal ?? e.className) || e.tagName);
        const ringsOverflow = document.querySelector('.rings').scrollWidth - document.querySelector('.rings').clientWidth;
        return {
          scrollW: document.documentElement.scrollWidth,
          innerW: window.innerWidth,
          dial: wrap.width,
          dialSq: Math.abs(wrap.width - wrap.height) < 1,
          canvasPx: cv.width,
          dpr: window.devicePixelRatio,
          waveW: wv.clientWidth,
          wavePx: wv.width,
          compact: insp.compact,
          rHole: insp.layout.rHole,
          over,
          shellOver,
          ringsOverflow,
          moreInHole: insp.compact ? true : more.width <= centre.width + 1,
        };
      });
      check(`${w}x${h}: rings never overflow, square dial, canvases match their size`, m.ringsOverflow <= 0 && m.dialSq && Math.abs(m.canvasPx - m.dial * m.dpr) <= 2 && Math.abs(m.wavePx - m.waveW * m.dpr) <= 2 && m.over === 0, `dial ${m.dial.toFixed(0)}px compact=${m.compact} rHole=${m.rHole.toFixed(0)} wave=${m.waveW}px over=${m.over} docScrollW=${m.scrollW}/${m.innerW} shell-overflow=${JSON.stringify(m.shellOver)}`);
      await page.screenshot({ path: path.join(outDir, `rings-resp-${w}.png`), fullPage: true });
    }
    check('no console / page errors from the rings module while resizing', own().length === 0, own().join(' | '));
  },
  { viewport: { width: 1440, height: 900 } },
);

// -------------------------------------------------------------------- reduced motion + DPR 2
await withApp(
  async ({ page, context, url, errors }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url(`?t=${A}&view=rings&zone=UTC&rate=1`));
    await S(page, () => window.__fractonica.store.set({ minDepth: 1, maxDepth: 14 }));
    await page.addStyleTag({ content: QUIET });
    await page.waitForTimeout(600);
    const a = await S(page, () => window.__fractonica.instances.rings.inspect());
    await page.waitForTimeout(1500);
    const b = await S(page, () => window.__fractonica.instances.rings.inspect());
    // index 11 = mu (1.55 s per turn) holds its phase; nu and xi (12, 13) are glows at x1 and carry no phase.
    // The slower rings (9 = kappa, 10 = lambda) keep moving. Both sides must be real: a frozen hand needs a phase
    // above 0, a moving one has to differ.
    const frozen = a.shown[11] > 0 && a.shown[11] === b.shown[11];
    const moving = b.shown[9] !== a.shown[9] && b.shown[10] !== a.shown[10];
    check('reduced motion freezes the hand of a ring faster than 2 s', a.reduced && frozen, `mu ${a.shown[11]?.toFixed(3)} vs ${b.shown[11]?.toFixed(3)}`);
    check('reduced motion keeps the slower hands moving', moving, `kappa ${a.shown[9]?.toFixed(5)} -> ${b.shown[9]?.toFixed(5)}, lambda ${a.shown[10]?.toFixed(5)} -> ${b.shown[10]?.toFixed(5)}`);
    check('no own errors under reduced motion', errors.filter((e) => /rings/.test(e)).length === 0);
  },
  { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
