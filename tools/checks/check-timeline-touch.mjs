// Touch behaviour (synthetic pointer events: one-finger pan, tap, double-tap, pinch) and
// prefers-reduced-motion / live-mode behaviour.
import { withApp } from '../browse.mjs';

let failed = 0;
const ok = (cond, msg, extra) => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

await withApp(
  async ({ page, url, errors }) => {
    await page.goto(url('?t=1791460800&view=timeline&zone=UTC'));
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('.tl-canvas').scrollIntoView({ block: 'center' }));
    await page.click('[data-preset="week"]');
    await page.waitForTimeout(500);

    const state = () =>
      page.evaluate(() => {
        const tl = window.__fractonica.instances.timeline.api;
        const r = document.querySelector('.tl-canvas').getBoundingClientRect();
        return { win: tl.window, L: tl.layout, r: { x: r.x, y: r.y }, t: window.__fractonica.store.t(), follow: tl.follow };
      });
    const fire = (type, id, x, y) =>
      page.evaluate(
        ([type, id, x, y]) => {
          const c = document.querySelector('.tl-canvas');
          const r = c.getBoundingClientRect();
          c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: r.x + x, clientY: r.y + y, bubbles: true, cancelable: true, button: 0 }));
        },
        [type, id, x, y],
      );

    // ---- one-finger pan --------------------------------------------------------------------------
    let st = await state();
    const k = (st.L.px1 - st.L.px0) / st.win.span;
    const y = st.L.lanesY + st.L.laneH * 3.5;
    await fire('pointerdown', 1, 500, y);
    for (let i = 1; i <= 6; i++) await fire('pointermove', 1, 500 - i * 20, y);
    await page.waitForTimeout(150);
    await fire('pointerup', 1, 380, y);
    let st2 = await state();
    ok(near((st2.win.c - st.win.c) * k, 120, 3), 'one-finger drag pans', (st2.win.c - st.win.c) * k);
    ok(near(st2.t, st.t, 1), 'a touch drag does not move the cursor');

    // ---- tap moves the cursor -----------------------------------------------------------------------
    st = await state();
    await fire('pointerdown', 1, 600, st.L.axis.y + 8);
    await fire('pointerup', 1, 600, st.L.axis.y + 8);
    await page.waitForTimeout(450); // a single tap waits out the double-tap window
    st2 = await state();
    const want = st.win.c - st.win.span / 2 + ((600 - st.L.px0) / (st.L.px1 - st.L.px0)) * st.win.span;
    ok(near(st2.t, want, 6 / k), 'tap sets the cursor', st2.t - want);

    // ---- press and hold shows the tooltip (no hover on a phone); it is not a tap ------------------------------------
    await page.evaluate(() => { window.__fractonica.store.setTime(1791460800, 'jump'); window.__fractonica.instances.timeline.api.setWindow({ c: 1791460800, span: 7 * 86400 }); });
    await page.waitForTimeout(400);
    st = await state();
    const yp = st.L.lanesY + st.L.laneH * 4.5;
    const tipText = () => page.evaluate(() => { const t = document.querySelector('.tl-tip'); return t.hidden ? null : t.innerText; });
    await fire('pointerdown', 1, 250, yp);
    await page.waitForTimeout(250);
    ok((await tipText()) === null, 'no tooltip while the finger has only just touched down');
    await page.waitForTimeout(450);
    const held = await tipText();
    ok(held && /pos \d/.test(held) && /ε 5/.test(held), 'press and hold shows the hover tooltip', held?.slice(0, 60));
    await fire('pointerup', 1, 250, yp);
    await page.waitForTimeout(500);
    st2 = await state();
    ok(near(st2.t, 1791460800, 1), 'a long press does not move the cursor', st2.t - 1791460800);
    ok((await tipText()) !== null, 'the tooltip stays for a few seconds after the finger lifts');
    await fire('pointerdown', 1, 300, yp);
    ok((await tipText()) === null, 'touching again hides it');
    await fire('pointerup', 1, 300, yp);
    await page.waitForTimeout(450);
    await page.evaluate(() => { window.__fractonica.store.setTime(1791460800, 'jump'); });
    await fire('pointerdown', 1, 250, yp);
    await fire('pointermove', 1, 250 - 30, yp);
    await page.waitForTimeout(700);
    ok((await tipText()) === null, 'a drag is not a long press (no tooltip)');
    await fire('pointerup', 1, 220, yp);
    await page.waitForTimeout(450);

    // ---- a finger can grab the cursor flag a few pixels off it -----------------------------------------------------
    await page.evaluate(() => { window.__fractonica.store.setTime(1791460800, 'jump'); window.__fractonica.instances.timeline.api.setWindow({ c: 1791460800 + 86400, span: 7 * 86400 }); });
    await page.waitForTimeout(400);
    st = await state();
    const kk = (st.L.px1 - st.L.px0) / st.win.span;
    const fxx = st.L.px0 + (st.t - (st.win.c - st.win.span / 2)) * kk;
    const fyy = st.L.axis.y + st.L.axis.ctxH + st.L.axis.tickH + 1 + 14 + 7; // 7 px below the 14 px flag
    await fire('pointerdown', 1, fxx, fyy);
    for (let i = 1; i <= 6; i++) await fire('pointermove', 1, fxx + i * 10, fyy);
    await fire('pointerup', 1, fxx + 60, fyy);
    await page.waitForTimeout(400);
    st2 = await state();
    ok(near(st2.t - st.t, 60 / kk, 60 / kk * 0.05) && near(st2.win.c, st.win.c, 1), 'dragging 7 px below the flag still scrubs the cursor, not the window', { dt: st2.t - st.t, want: 60 / kk, dc: st2.win.c - st.win.c });

    // ---- double tap fits the block -------------------------------------------------------------------------
    st = await state();
    const yl = st.L.lanesY + st.L.laneH * 5.5;
    await fire('pointerdown', 1, 700, yl);
    await fire('pointerup', 1, 700, yl);
    await page.waitForTimeout(120);
    await fire('pointerdown', 1, 703, yl);
    await fire('pointerup', 1, 703, yl);
    await page.waitForTimeout(500);
    st2 = await state();
    ok(st2.win.span < st.win.span / 2, 'double tap on a block fits that cycle', [st.win.span, st2.win.span]);

    // ---- pinch ---------------------------------------------------------------------------------------------------
    await page.click('[data-preset="week"]');
    await page.waitForTimeout(500);
    st = await state();
    const mid = 200;
    const tMid = st.win.c - st.win.span / 2 + ((mid - st.L.px0) / (st.L.px1 - st.L.px0)) * st.win.span;
    await fire('pointerdown', 1, mid - 30, y);
    await fire('pointerdown', 2, mid + 30, y);
    for (let i = 1; i <= 10; i++) {
      await fire('pointermove', 1, mid - 30 - i * 8, y);
      await fire('pointermove', 2, mid + 30 + i * 8, y);
    }
    await fire('pointerup', 2, mid + 110, y);
    await fire('pointerup', 1, mid - 110, y);
    st2 = await state();
    ok(near(st2.win.span, st.win.span * 60 / 220, st.win.span * 0.01), 'pinch out from 60 px to 220 px apart zooms in by 3.67x', [st.win.span, st2.win.span]);
    const tAfter = st2.win.c - st2.win.span / 2 + ((mid - st2.L.px0) / (st2.L.px1 - st2.L.px0)) * st2.win.span;
    ok(near(tAfter, tMid, st2.win.span * 0.003), 'pinch keeps the time between the fingers fixed', tAfter - tMid);
    ok(near(st2.t, (await state()).t, 1), 'a pinch does not move the cursor');
    ok(st2.follow === false, 'pinching turns follow off');
  },
  { viewport: { width: 390, height: 844 } },
);

// ---- reduced motion: transitions are instant ---------------------------------------------------------------
await withApp(
  async ({ page, url, errors }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url('?t=1791460800&view=timeline&zone=UTC'));
    await page.waitForTimeout(800);
    await page.click('[data-preset="day"]');
    const w = await page.evaluate(() => window.__fractonica.instances.timeline.api.window);
    ok(near(w.span, 86400, 1), 'reduced motion: preset applies immediately', w.span);
    await page.click('[data-preset="year"]');
    const w2 = await page.evaluate(() => window.__fractonica.instances.timeline.api.window);
    ok(near(w2.span, 365.25 * 86400, 1), 'reduced motion: second preset applies immediately', w2.span);
  },
  { viewport: { width: 1200, height: 800 } },
);

// ---- live mode: follow is on and tracks the clock ---------------------------------------------------------------
await withApp(
  async ({ page, url, errors }) => {
    await page.goto(url('?view=timeline&zone=UTC'));
    await page.waitForTimeout(900);
    const s0 = await page.evaluate(() => { const a = window.__fractonica.instances.timeline.api; return { follow: a.follow, w: a.window, t: window.__fractonica.store.t(), live: window.__fractonica.store.live }; });
    ok(s0.live && s0.follow === true, 'live mode: follow is on by default');
    ok(near(s0.w.c, s0.t, s0.w.span * 0.01), 'live mode: window is centred on now', s0.w.c - s0.t);
    await page.evaluate(() => window.__fractonica.instances.timeline.api.setWindow({ c: window.__fractonica.store.t(), span: 20 }));
    await page.waitForTimeout(2200);
    const s1 = await page.evaluate(() => { const a = window.__fractonica.instances.timeline.api; return { w: a.window, t: window.__fractonica.store.t() }; });
    ok(near(s1.w.c, s1.t, 0.3), 'live mode: the window slides with the clock (cursor stays at 50 %)', s1.w.c - s1.t);
    // clicking in live mode leaves live, turns follow off and the view stays put
    const clicked = await page.evaluate(() => {
      const api = window.__fractonica.instances.timeline.api;
      const c = document.querySelector('.tl-canvas');
      const r = c.getBoundingClientRect();
      const L = api.layout;
      const x = L.px0 + (L.px1 - L.px0) * 0.8;
      const y = L.axis.y + 8;
      for (const type of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(type, { pointerId: 5, pointerType: 'mouse', clientX: r.x + x, clientY: r.y + y, bubbles: true, button: 0 }));
      // a single click waits out the double-click window before it moves the cursor
      return new Promise((res) => setTimeout(() => res({ follow: api.follow, live: window.__fractonica.store.live }), 450));
    });
    ok(clicked.live === false && clicked.follow === false, 'clicking the timeline while live: travel mode, follow off', clicked);
    console.log(errors.filter((e) => /timeline|pageerror/i.test(e)));
  },
  { viewport: { width: 1200, height: 800 } },
);
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
