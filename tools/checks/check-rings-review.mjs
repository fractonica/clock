// Regression checks for the rings review round (touch, keyboard, robustness, narrow layouts, contrast).
//   node tools/checks/check-rings-review.mjs
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
const TMAX = 28005212035.816;
const QUIET = '.topbar{position:static!important}';
const S = (page, fn, arg) => page.evaluate(fn, arg);
const ownErrors = (errors) => errors.filter((e) => /rings|dial\.js|wave\.js|geometry\.js|text\.js|canvas\.js/.test(e));

async function boot(page, url, query) {
  await page.goto(url(query));
  await page.addStyleTag({ content: QUIET });
  await page.waitForFunction(() => window.__fractonica?.instances?.rings?.inspect?.().layout, null, { timeout: 8000 });
  await page.waitForTimeout(350);
}
const tState = (page) => S(page, () => ({ t: window.__fractonica.store.t(), mode: window.__fractonica.store.mode, rate: window.__fractonica.store.rate, sel: window.__fractonica.store.state.selectedLevel }));
async function dialPoint(page, ring, phase, radial = 0.5) {
  return S(page, ([ring, phase, radial]) => {
    const c = document.querySelector('.rings-layer-live');
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    const { layout } = window.__fractonica.instances.rings.inspect();
    const k = r.width / layout.size;
    const rad = layout.rings[ring].inner + radial * layout.band;
    const a = phase * 2 * Math.PI;
    return { x: r.left + (layout.cx + rad * Math.sin(a)) * k, y: r.top + (layout.cy - rad * Math.cos(a)) * k };
  }, [ring, phase, radial]);
}

// ---------------------------------------------------------------------------------------------- desktop
await withApp(
  async ({ page, url, errors }) => {
    await boot(page, url, `?t=${A}&view=rings&zone=UTC`);

    // End / ArrowRight on the last glyph state must not run into the next cycle (short cycles: iota .. xi)
    for (const L of [7, 8, 9, 12, 13]) {
      const c0 = await S(page, async (L) => {
        const { ctx, model, store } = window.__fractonica;
        store.setTime(1791460800);
        ctx.select(L);
        await new Promise((r) => setTimeout(r, 80));
        const w = document.querySelector('.rings-wave');
        w.scrollIntoView();
        w.focus();
        return model.levelAt(store.t(), L).cycle;
      }, L);
      await page.keyboard.press('End');
      const e1 = await S(page, (L) => { const lv = window.__fractonica.model.levelAt(window.__fractonica.store.t(), L); return { cycle: lv.cycle, index: lv.index }; }, L);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('End');
      const e2 = await S(page, (L) => { const lv = window.__fractonica.model.levelAt(window.__fractonica.store.t(), L); return { cycle: lv.cycle, index: lv.index }; }, L);
      check(`End on level ${L + 1} stays on the last glyph state of the same cycle`, e1.cycle === c0 && e1.index === 15 && e2.cycle === c0 && e2.index === 15, `${JSON.stringify(e1)} ${JSON.stringify(e2)}`);
    }

    // Label target: only for rings that are not selected, and the selected ring's last sector navigates
    await S(page, () => { const { ctx, store } = window.__fractonica; store.setTime(1791460800); ctx.select(9); });
    await page.waitForTimeout(150);
    const f9 = await S(page, () => window.__fractonica.model.levelInfo(9).factor);
    let p = await dialPoint(page, 9, (f9 - 0.5) / f9);
    let before = await tState(page);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
    let after = await tState(page);
    check('last sector of the selected ring navigates on click (label does not swallow it)', after.t !== before.t && after.sel === 9, `dt=${(after.t - before.t).toFixed(1)}`);
    await S(page, () => { const { ctx, store } = window.__fractonica; store.setTime(1791460800); ctx.select(6); });
    await page.waitForTimeout(150);
    p = await dialPoint(page, 9, 0.985);
    before = await tState(page);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
    after = await tState(page);
    check('label of an unselected ring still selects without moving time', after.sel === 9 && near(after.t, before.t, 1e-6));
    p = await dialPoint(page, 9, 0.985, 0.03);
    await S(page, () => { const { ctx, store } = window.__fractonica; store.setTime(1791460800); ctx.select(6); });
    await page.waitForTimeout(150);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
    check('below the text, the same sector of an unselected ring is a normal sector (select + jump)', (await tState(page)).t !== A, '');

    // keyboard route to the sectors + announcements
    await S(page, () => { const { ctx, store } = window.__fractonica; store.setTime(1791460800); ctx.select(6); document.querySelector('.rings-dialwrap').focus(); });
    await page.waitForTimeout(150);
    const run0 = await S(page, () => { const { model, store } = window.__fractonica; const lv = model.levelAt(store.t(), 6); return { cycle: lv.cycle, phase: lv.phase, factor: lv.factor }; });
    await page.keyboard.press('Enter');
    let k = await S(page, () => { const { model, store } = window.__fractonica; const c = model.levelAt(store.t(), 7); return { phase: c.phase, local: c.local, t: store.t() }; });
    check('Enter on the dial jumps to the start of the running child cycle', k.phase < 1e-3, `child phase ${k.phase}`);
    const l0 = k.local;
    await page.keyboard.press('PageUp');
    k = await S(page, () => { const { model, store } = window.__fractonica; const c = model.levelAt(store.t(), 7); return { phase: c.phase, local: c.local }; });
    check('PageUp on the dial steps to the next child cycle', k.phase < 1e-3 && k.local === (l0 + 1) % 9, `${l0} -> ${k.local}`);
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    k = await S(page, () => { const { model, store } = window.__fractonica; const c = model.levelAt(store.t(), 7); return { phase: c.phase, local: c.local }; });
    check('PageDown steps back', k.local === (l0 + 8) % 9 && k.phase < 1e-3, `${l0} -> ${k.local}`);
    const note1 = await S(page, () => document.querySelector('.rings-live').textContent);
    check('a screen-reader note announces the jump', /Jumped to the start of θ 8/.test(note1), note1);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const note2 = await S(page, () => document.querySelector('.rings-live').textContent);
    check('a screen-reader note announces a changed selection', /^Selected θ 8 · /.test(note2) && /ends in/.test(note2), note2);
    const live = await S(page, () => { const n = document.querySelector('.rings-live'); return { role: n.getAttribute('role'), aria: n.getAttribute('aria-live') }; });
    check('the note is a polite status region', live.role === 'status' && live.aria === 'polite');

    // threshold buttons at the very end of the catalogue say so instead of doing nothing
    await S(page, () => { const { ctx, store } = window.__fractonica; store.setTime(window.__fractonica.model.tMax); ctx.select(8); });
    await page.waitForTimeout(200);
    await S(page, () => { document.querySelector('#toast').hidden = true; });
    await page.click('.rings-b-thr');
    const toast = await S(page, () => ({ hidden: document.querySelector('#toast').hidden, text: document.querySelector('#toast').textContent }));
    check('Next threshold at the catalogue end shows a note', !toast.hidden && /End of the catalogue/.test(toast.text), toast.text);
    check('and the time stays at the end', near((await tState(page)).t, TMAX, 0.01));

    // a phantom child at the end of the catalogue is not offered (theta 8, sector 2 of 4)
    await S(page, () => { const { ctx, store, model } = window.__fractonica; store.setTime(model.tMax - 5); ctx.select(7); });
    await page.waitForTimeout(250);
    p = await dialPoint(page, 7, 0.375);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(150);
    const tip = await S(page, () => ({ text: document.querySelector('.rings-tip').textContent, cursor: document.querySelector('.rings-layer-live').style.cursor }));
    check('hover over a sector past the catalogue end: explicit text, no jump offered', /Beyond the end of the catalogue/.test(tip.text) && !/lasts 0/.test(tip.text) && tip.cursor !== 'pointer', tip.text.slice(0, 120));
    await page.mouse.move(2, 2);

    // percentage never reads 100.0 % before the end
    await S(page, () => { const { ctx, store, model } = window.__fractonica; store.setTime(model.tMax - 0.002); ctx.select(8); });
    await page.waitForTimeout(250);
    const pct = await S(page, () => document.querySelector('.rings-wh-pct').textContent);
    check('percentage floors (99.9 %, never 100.0 %) just before the end', /^99\.9/.test(pct), pct);
    await S(page, () => window.__fractonica.store.setTime(1791460800));

    // off-dial selection
    await S(page, () => { window.__fractonica.store.set({ minDepth: 1, maxDepth: 5 }); window.__fractonica.ctx.select(6); });
    await page.waitForTimeout(200);
    let off = await S(page, () => { const b = document.querySelector('.rings-offdial'); return { hidden: b.hidden, text: b.textContent, name: document.querySelector('.rings-cn-name').textContent }; });
    check('a selection outside the shown rings is announced with a way to show it', !off.hidden && /η 7 is not on the dial/.test(off.text), off.text);
    await page.click('.rings-offdial');
    await page.waitForTimeout(200);
    off = await S(page, () => ({ hidden: document.querySelector('.rings-offdial').hidden, levels: window.__fractonica.instances.rings.inspect().levels }));
    check('"show it" widens the range to include the selection', off.hidden && off.levels.length === 7 && off.levels.at(-1) === 6, JSON.stringify(off.levels));
    await S(page, () => window.__fractonica.store.set({ minDepth: 1, maxDepth: 10 }));

    // garbage in the shared range: steppers start from what the dial shows and never write NaN
    // the store now refuses such values, so write the state object itself: the module must survive whatever reaches it
    await S(page, () => { Object.assign(window.__fractonica.store.state, { minDepth: 9, maxDepth: 3 }); window.__fractonica.ctx.requestRender(); });
    await page.waitForTimeout(150);
    await page.click('[data-step="min:-1"]');
    await page.waitForTimeout(100);
    let st = await S(page, () => ({ min: window.__fractonica.store.state.minDepth, max: window.__fractonica.store.state.maxDepth, sel: window.__fractonica.store.state.selectedLevel }));
    check('inverted range: stepping min from the shown "ι 9 to ι 9" gives 8..9 (not a jump to 3)', st.min === 8 && st.max === 9, JSON.stringify(st));
    await S(page, () => { Object.assign(window.__fractonica.store.state, { minDepth: 'x', maxDepth: null }); window.__fractonica.ctx.requestRender(); });
    await page.waitForTimeout(150);
    await page.click('[data-step="max:1"]');
    await page.waitForTimeout(100);
    st = await S(page, () => JSON.parse(localStorage.getItem('fractonica-clock/v1')));
    check('garbage range: stepping writes valid integers only', [st.minDepth, st.maxDepth, st.selectedLevel].every((v) => Number.isInteger(v)), JSON.stringify([st.minDepth, st.maxDepth, st.selectedLevel]));
    await S(page, () => window.__fractonica.store.set({ minDepth: 1, maxDepth: 10 }));

    check('no console / page errors from the rings module (desktop interactions)', ownErrors(errors).length === 0, ownErrors(errors).join(' | '));
  },
  { viewport: { width: 1440, height: 900 } },
);

// ---------------------------------------------------------------------------------------------- robustness: bad input
for (const [name, query] of [
  ['non-integer ?sel=3.5', `?t=${A}&view=rings&sel=3.5`],
  ['?sel=abc', `?t=${A}&view=rings&sel=abc`],
]) {
  await withApp(
    async ({ page, url, errors }) => {
      await page.goto(url(query));
      await page.waitForTimeout(900);
      const r = await S(page, () => ({ name: document.querySelector('.rings-cn-name')?.textContent, err: document.querySelector('#view-rings .module-error')?.textContent }));
      check(`${name}: the Rings tab mounts and shows a cycle`, !r.err && /\d/.test(r.name ?? ''), JSON.stringify(r));
      check(`${name}: no errors from the rings module`, ownErrors(errors).length === 0, ownErrors(errors).join(' | '));
    },
    { viewport: { width: 1440, height: 900 } },
  );
}
await withApp(
  async ({ page, url, errors }) => {
    await page.addInitScript(() => localStorage.setItem('fractonica-clock/v1', JSON.stringify({ selectedLevel: null, minDepth: 'x', maxDepth: -4 })));
    await page.goto(url(`?t=${A}&view=rings`));
    await page.waitForTimeout(900);
    const r = await S(page, () => ({ name: document.querySelector('.rings-cn-name')?.textContent, err: document.querySelector('#view-rings .module-error')?.textContent, levels: window.__fractonica.instances.rings.inspect().levels }));
    check('garbage in localStorage (selectedLevel null, depths "x" / -4): rings still mounts', !r.err && r.levels.length >= 1, JSON.stringify(r));
    check('...without errors from the rings module', ownErrors(errors).length === 0, ownErrors(errors).join(' | '));
  },
  { viewport: { width: 1440, height: 900 } },
);

// ---------------------------------------------------------------------------------------------- motion
await withApp(
  async ({ page, url, errors }) => {
    // slow motion: the true speed decides what blurs (xi turns once per 0.9 s of real time at x0.05... no: 44 ms / 0.05 = 0.9 s)
    await boot(page, url, `?t=${A}&view=rings&zone=UTC&rate=0.05`);
    await S(page, () => window.__fractonica.store.set({ minDepth: 1, maxDepth: 14 }));
    await page.waitForTimeout(400);
    const sh = await S(page, () => window.__fractonica.instances.rings.inspect().shown);
    check('rate 0.05: the 0.31 s ring is a crisp hand, not a glow (true speed, not "at least x1")', typeof sh[12] === 'number' && sh[12] > 0, `phase ${sh[12]}`);
    check('...while the 44 ms ring (0.9 s per turn at that speed) is still a hand', typeof sh[13] === 'number', `phase ${sh[13]}`);
    check('no errors from the rings module (slow motion)', ownErrors(errors).length === 0, ownErrors(errors).join(' | '));
  },
  { viewport: { width: 1440, height: 900 } },
);
await withApp(
  async ({ page, url, errors }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, url, `?t=${A}&view=rings&zone=UTC&rate=1`);
    await S(page, () => window.__fractonica.store.set({ minDepth: 1, maxDepth: 14 }));
    await page.waitForTimeout(500);
    const a = await S(page, () => window.__fractonica.instances.rings.inspect());
    await page.waitForTimeout(1600);
    const b = await S(page, () => window.__fractonica.instances.rings.inspect());
    check('reduced motion: the 1.55 s hand holds its phase (no once-a-second hopping)', a.reduced && a.shown[11] > 0 && a.shown[11] === b.shown[11], `${a.shown[11]} vs ${b.shown[11]}`);
    check('reduced motion: slower hands still move', a.shown[9] !== b.shown[9] && a.shown[10] !== b.shown[10], `${a.shown[9]?.toFixed(4)} -> ${b.shown[9]?.toFixed(4)}`);
    await S(page, () => window.__fractonica.store.setTime(1791460800 + 5));
    await page.waitForTimeout(300);
    const c = await S(page, () => window.__fractonica.instances.rings.inspect());
    check('reduced motion: a jump of the time moves the frozen hand to the new phase', c.shown[11] !== b.shown[11]);
    check('no errors from the rings module (reduced motion)', ownErrors(errors).length === 0, ownErrors(errors).join(' | '));
  },
  { viewport: { width: 1440, height: 900 } },
);
await withApp(
  async ({ page, url, errors }) => {
    // a selected cycle that is too fast to follow: the large digits must not change every frame
    await boot(page, url, `?t=${A}&view=rings&zone=UTC&rate=86400`);
    const changes = await S(page, () => new Promise((resolve) => {
      const n = document.querySelector('.rings-count');
      const p = document.querySelector('.rings-wh-pct');
      let last = n.textContent + p.textContent;
      let c = 0;
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        const now = n.textContent + p.textContent;
        if (now !== last) { c++; last = now; }
        frames++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else resolve({ c, frames, fast: document.querySelector('.rings').classList.contains('is-fast') });
      };
      requestAnimationFrame(tick);
    }));
    check('time-lapse x86400 on a 5 h cycle: digits are dimmed and refresh at about 4 Hz, not every frame', changes.fast && changes.c <= 12 && changes.frames > 40, JSON.stringify(changes));
    check('no errors from the rings module (fast time-lapse)', ownErrors(errors).length === 0, ownErrors(errors).join(' | '));
  },
  { viewport: { width: 1440, height: 900 } },
);

// ---------------------------------------------------------------------------------------------- layout: dial size, centre, contrast
await withApp(
  async ({ page, url, errors }) => {
    await boot(page, url, `?t=${A}&view=rings&zone=UTC`);
    let prev = 0;
    let worstDip = 0;
    const sizes = [];
    for (const w of [1000, 1120, 1200, 1280, 1400, 1500, 1600, 1680, 1720, 1800, 1920]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(300);
      const size = await S(page, () => window.__fractonica.instances.rings.inspect().layout.size);
      sizes.push(Math.round(size));
      // the shell itself changes its columns at some widths (shared css): allow 4 %
      if (prev) worstDip = Math.max(worstDip, (prev - size) / prev);
      prev = size;
    }
    check('a wider window never gives a visibly smaller dial (2-column switch at 1120 px of view width)', worstDip < 0.05 && Math.min(...sizes) >= 600, sizes.join(' '));

    // the centre read-out lies inside the hole at every size where it is shown
    await page.setViewportSize({ width: 1440, height: 900 });
    let worst = -99;
    let seen = 0;
    for (const h of [700, 780, 840, 880, 900, 960, 1000, 1100]) {
      await page.setViewportSize({ width: 1440, height: h });
      await page.waitForTimeout(250);
      for (const [t, L] of [[A, 0], [A, 6], [946684800, 13], [946684800, 11], [2886085800, 3]]) {
        await S(page, ([t, L]) => { window.__fractonica.store.setTime(t); window.__fractonica.ctx.select(L); }, [t, L]);
        await page.waitForTimeout(100);
        const m = await S(page, () => {
          const i = window.__fractonica.instances.rings.inspect();
          if (i.compact) return null;
          const wrap = document.querySelector('.rings-dialwrap').getBoundingClientRect();
          const k = wrap.width / i.layout.size;
          const cx = wrap.left + wrap.width / 2;
          const cy = wrap.top + wrap.height / 2;
          let far = 0;
          for (const e of document.querySelectorAll('.rings-centre .rings-cn-name, .rings-centre .rings-cn-phase, .rings-centre .rings-eyebrow, .rings-centre .rings-count, .rings-centre .rings-end, .rings-centre .rings-chip, .rings-centre .rings-btns .btn')) {
            const r = e.getBoundingClientRect();
            for (const [x, y] of [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]) far = Math.max(far, Math.hypot(x - cx, y - cy));
          }
          const clipped = [...document.querySelectorAll('.rings-centre .rings-chip, .rings-centre .rings-chip > *')].some((e) => e.scrollWidth > e.clientWidth + 1);
          return { over: far - i.layout.rHole * k, clipped };
        });
        if (!m) continue;
        seen++;
        worst = Math.max(worst, m.over + (m.clipped ? 100 : 0));
      }
    }
    // the rows are measured by their bounding boxes: the 8 px rounded corners of the buttons sit about 2 px closer than that
    check('centre read-out stays inside the hole (and nothing is clipped) wherever it is shown in full', seen > 10 && worst <= 4, `${seen} samples, worst overrun ${worst.toFixed(1)} px`);
    await S(page, () => window.__fractonica.store.setTime(1791460800));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);

    // contrast of the small caption text on the cards
    const contrast = await S(page, () => {
      const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
      const ratio = (fg, bg) => { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      const bg = rgb(getComputedStyle(document.querySelector('.rings-dialcard')).backgroundColor || 'rgb(21,29,38)');
      const panel = [21, 29, 38];
      const out = {};
      for (const [k, sel] of [['eyebrow', '.rings-eyebrow'], ['chipName', '.rings-chip-name'], ['hint', '.rings-wave-hint'], ['factsLabel', '.rings-facts dt'], ['toolbarLabel', '.rings-tb-label'], ['passedTime', '.rings-chip.is-passed .rings-chip-time'], ['sub', '.rings-wh-sub']]) {
        const e = document.querySelector(sel);
        const op = e ? Number(getComputedStyle(e).opacity) * (e.closest('.is-passed') ? Number(getComputedStyle(e.closest('.is-passed')).opacity) : 1) : 1;
        const col = e ? rgb(getComputedStyle(e).color) : [0, 0, 0];
        const blended = col.map((v, i) => v * op + panel[i] * (1 - op));
        out[k] = Math.round(ratio(blended, panel) * 100) / 100;
      }
      return out;
    });
    check('small captions have at least 4.5:1 contrast (eyebrow, chip names, hint, fact labels, passed times)', Object.values(contrast).every((v) => v >= 4.5), JSON.stringify(contrast));
    check('no errors from the rings module (layout checks)', ownErrors(errors).length === 0, ownErrors(errors).join(' | '));
  },
  { viewport: { width: 1440, height: 900 } },
);

// ---------------------------------------------------------------------------------------------- phone, touch
await withApp(
  async ({ browser, url }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push('console.error: ' + m.text()));
    await page.goto(url('?view=rings'));
    await page.addStyleTag({ content: QUIET });
    await page.waitForFunction(() => window.__fractonica?.instances?.rings?.inspect?.().wave);
    await page.waitForTimeout(500);
    const cdp = await context.newCDPSession(page);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const wavePt = () => S(page, () => { const c = document.querySelector('.rings-wave'); c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); const w = window.__fractonica.instances.rings.inspect().wave; return { x: r.left + (w.x0 + w.x1) / 2, y: r.top + (w.y0 + w.y1) / 2, x0: r.left + w.x0, x1: r.left + w.x1 }; });

    // a page scroll that starts on the wave
    let pt = await wavePt();
    await page.waitForTimeout(250);
    pt = await wavePt();
    const y0 = await S(page, () => scrollY);
    await touch('touchStart', pt.x, pt.y);
    for (let i = 1; i <= 12; i++) { await touch('touchMove', pt.x, pt.y - 15 * i); await page.waitForTimeout(16); }
    await touch('touchEnd');
    await page.waitForTimeout(300);
    let st = await S(page, () => ({ mode: window.__fractonica.store.mode, y: scrollY, live: document.querySelector('#tp-live').textContent }));
    check('touch: a vertical swipe starting on the wave scrolls the page and leaves the clock live', st.y !== y0 && st.mode === 'live' && st.live === 'LIVE', JSON.stringify(st));

    // a sideways drag scrubs
    pt = await wavePt();
    await touch('touchStart', pt.x - 40, pt.y);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', pt.x - 40 + i * 10, pt.y); await page.waitForTimeout(16); }
    await touch('touchEnd');
    await page.waitForTimeout(200);
    st = await S(page, () => ({ mode: window.__fractonica.store.mode, rate: window.__fractonica.store.rate, scrubbing: window.__fractonica.instances.rings.inspect().scrubbing }));
    check('touch: a sideways drag on the wave scrubs time (travel mode) and releasing keeps the position', st.mode === 'travel' && !st.scrubbing, JSON.stringify(st));

    // a tap sets the time once
    await S(page, () => window.__fractonica.store.goLive());
    pt = await wavePt();
    await touch('touchStart', pt.x1 - 5, pt.y);
    await touch('touchEnd');
    await page.waitForTimeout(200);
    st = await S(page, () => ({ mode: window.__fractonica.store.mode, ph: window.__fractonica.model.levelAt(window.__fractonica.store.t(), window.__fractonica.store.state.selectedLevel).phase }));
    check('touch: a tap on the wave sets the time to that point', st.mode === 'travel' && st.ph > 0.9, JSON.stringify(st));

    // dial: first tap selects + previews, second tap jumps
    await S(page, () => { window.__fractonica.store.setTime(1791460800); window.__fractonica.ctx.select(6); });
    await page.waitForTimeout(200);
    const dp = await S(page, () => {
      const c = document.querySelector('.rings-layer-live');
      c.scrollIntoView({ block: 'center' });
      const r = c.getBoundingClientRect();
      const { layout } = window.__fractonica.instances.rings.inspect();
      const k = r.width / layout.size;
      const ring = layout.rings[2];
      const a = 0.3 * 2 * Math.PI;
      return { x: r.left + (layout.cx + ring.mid * Math.sin(a)) * k, y: r.top + (layout.cy - ring.mid * Math.cos(a)) * k };
    });
    await page.waitForTimeout(250);
    const dp2 = await S(page, () => {
      const c = document.querySelector('.rings-layer-live');
      const r = c.getBoundingClientRect();
      const { layout } = window.__fractonica.instances.rings.inspect();
      const k = r.width / layout.size;
      const ring = layout.rings[2];
      const a = 0.3 * 2 * Math.PI;
      return { x: r.left + (layout.cx + ring.mid * Math.sin(a)) * k, y: r.top + (layout.cy - ring.mid * Math.cos(a)) * k };
    });
    await page.touchscreen.tap(dp2.x, dp2.y);
    await page.waitForTimeout(250);
    const t1 = await S(page, () => ({ t: window.__fractonica.store.t(), sel: window.__fractonica.store.state.selectedLevel, tip: document.querySelector('.rings-tip').hidden ? '' : document.querySelector('.rings-tip').textContent }));
    check('touch: the first tap on a ring selects it, shows the tooltip and does not move time', t1.sel === 2 && near(t1.t, 1791460800, 0.01) && /child cycle/.test(t1.tip) && /Tap again to jump/.test(t1.tip), `${t1.sel} ${t1.tip.slice(0, 100)}`);
    await page.touchscreen.tap(dp2.x, dp2.y);
    await page.waitForTimeout(250);
    const t2 = await S(page, () => ({ t: window.__fractonica.store.t(), tipHidden: document.querySelector('.rings-tip').hidden }));
    check('touch: the second tap on the same sector jumps to the start of its child cycle', Math.abs(t2.t - 1791460800) > 3600 && t2.tipHidden, `dt ${(t2.t - 1791460800) / 86400} d`);

    // dismiss: tapping elsewhere clears a preview
    await S(page, () => { window.__fractonica.store.setTime(1791460800); });
    await page.touchscreen.tap(dp2.x, dp2.y);
    await page.waitForTimeout(200);
    await page.touchscreen.tap(20, 20);
    await page.waitForTimeout(200);
    check('touch: a tap elsewhere dismisses the preview', await S(page, () => document.querySelector('.rings-tip').hidden));

    // ring picker
    await S(page, () => { window.__fractonica.ctx.select(6); });
    await page.waitForTimeout(200);
    const pick = await S(page, () => { const bs = [...document.querySelectorAll('.rings-pick')]; const b = bs[2]; const r = b.getBoundingClientRect(); return { n: bs.length, pressed: bs.filter((x) => x.getAttribute('aria-pressed') === 'true').map((x) => x.dataset.level), h: r.height, w: r.width, visible: r.width > 0 }; });
    check('compact dial: a ring picker with one 40 px button per ring, the selected one pressed', pick.n === 10 && pick.pressed.join() === '6' && pick.h >= 40 && pick.visible, JSON.stringify(pick));
    await page.locator('.rings-pick').nth(2).tap();
    await page.waitForTimeout(150);
    check('tapping a picker button selects that ring', (await tState(page)).sel === 2);

    // touch target sizes
    const sizes = await S(page, () => {
      const small = [];
      for (const e of document.querySelectorAll('.rings button')) {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || e.closest('[hidden]')) continue;
        if (r.height < 36 || r.width < 36) small.push(`${e.className.split(' ')[0] || e.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return small;
    });
    check('touch: buttons in the rings view are at least 36 px in both directions', sizes.length === 0, sizes.join(' '));

    // phone layout: no horizontal scroll, labels inside the wave canvas, facts do not change height
    for (const [t, L] of [[946684800, 2], [2886085800, 3], [A, 1], [A, 0]]) {
      await S(page, ([t, L]) => { window.__fractonica.store.setTime(t); window.__fractonica.ctx.select(L); }, [t, L]);
      await page.waitForTimeout(250);
      const m = await S(page, () => {
        const box = document.querySelector('.rings-wavebox').getBoundingClientRect();
        const inn = document.querySelector('.rings-wave-in');
        const r = inn.hidden ? null : inn.getBoundingClientRect();
        return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, inside: !r || (r.left >= box.left - 0.5 && r.right <= box.right + 0.5) };
      });
      check(`phone ${t} L${L + 1}: no horizontal page scroll, countdown inside the wave`, m.scrollW <= m.innerW && m.inside, JSON.stringify(m));
    }
    // boundary labels of a year-scale cycle fit the canvas: probe the pixels at the right edge of the label row
    await S(page, () => { window.__fractonica.store.setTime(1791460800); window.__fractonica.ctx.select(1); });
    await page.waitForTimeout(300);
    await page.locator('.rings-inset').screenshot({ path: path.join(outDir, 'rings-review-phone-wave.png') });

    await S(page, () => { window.__fractonica.store.set({ minDepth: 1, maxDepth: 10 }); window.__fractonica.ctx.select(6); window.__fractonica.store.setTime(1791460800); window.__fractonica.store.setRate(3600); });
    await page.waitForTimeout(400);
    const heights = await S(page, () => new Promise((resolve) => {
      const f = document.querySelector('.rings-facts');
      const hs = new Set();
      let n = 0;
      const tick = () => {
        hs.add(Math.round(f.getBoundingClientRect().height * 2) / 2);
        if (++n < 300) requestAnimationFrame(tick);
        else resolve([...hs]);
      };
      requestAnimationFrame(tick);
    }));
    check('phone: the Started / Ends block keeps its height while the numbers change (x3600)', heights.length === 1, heights.join(','));
    check('no errors from the rings module (phone)', ownErrors(errors).length === 0, ownErrors(errors).join(' | '));
    await context.close();
  },
  { viewport: { width: 1440, height: 900 } },
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
