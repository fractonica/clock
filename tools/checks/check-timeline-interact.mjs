// Exercises every timeline interaction in headless Chromium and reads the state back.
//   node tools/checks/check-timeline-interact.mjs
import { withApp } from '../browse.mjs';

let failed = 0;
const ok = (cond, msg, extra) => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const DAY = 86400;

await withApp(
  async ({ page, url, errors, shot }) => {
    await page.goto(url('?t=1791460800&view=timeline&zone=UTC'));
    await page.waitForTimeout(800);
    await page.addStyleTag({ content: '.topbar{position:static!important}' });

    const state = () =>
      page.evaluate(() => {
        const tl = window.__fractonica.instances.timeline;
        const c = document.querySelector('.tl-canvas').getBoundingClientRect();
        const s = window.__fractonica.store;
        return { win: tl.api.window, goal: tl.api.goal, follow: tl.api.follow, L: tl.api.layout, rect: { x: c.x, y: c.y, w: c.width, h: c.height }, t: s.t(), sel: s.state.selectedLevel, mode: s.mode, levels: tl.api.levels };
      });
    const settle = (ms = 450) => page.waitForTimeout(ms);
    const tAt = (st, x) => st.win.c - st.win.span / 2 + ((x - st.L.px0) / (st.L.px1 - st.L.px0)) * st.win.span;
    const xAt = (st, t) => st.L.px0 + ((t - (st.win.c - st.win.span / 2)) / st.win.span) * (st.L.px1 - st.L.px0);
    const abs = (st, x, y) => [st.rect.x + x, st.rect.y + y];
    const laneY = (st, i) => st.L.lanesY + st.L.laneH * i + st.L.laneH / 2;

    // make sure the canvas is on screen
    await page.evaluate(() => document.querySelector('.tl-canvas').scrollIntoView({ block: 'center' }));
    await settle(200);

    // ---- initial state ---------------------------------------------------------------------------
    let st = await state();
    ok(st.L && st.L.lanes === 10, 'layout has 10 lanes (depth 1..10)', st.L?.lanes);
    ok(near(st.win.c, 1791460800, 1), 'window centred on the cursor at mount', st.win.c);
    ok(st.follow === false, 'follow is off when mounted in time-travel mode');
    ok(st.rect.h >= 400 && st.rect.h <= 700, 'canvas height fits the viewport', st.rect.h);

    // ---- presets -----------------------------------------------------------------------------------
    for (const [id, span] of [['day', DAY], ['week', 7 * DAY], ['month', 30.4375 * DAY], ['year', 365.25 * DAY], ['decade', 3652.5 * DAY], ['century', 36525 * DAY]]) {
      await page.click(`[data-preset="${id}"]`);
      await settle();
      st = await state();
      const pressed = await page.getAttribute(`[data-preset="${id}"]`, 'aria-pressed');
      ok(near(st.win.span, span, span * 0.001) && pressed === 'true', `preset ${id}`, { span: st.win.span, pressed });
      ok(near(st.win.c, 1791460800, 2), `preset ${id} keeps the cursor centred`, st.win.c - 1791460800);
    }
    await page.click('[data-preset="all"]');
    await settle();
    st = await state();
    ok(st.win.span > 3.9e10, 'preset All shows the whole catalogue plus margin', st.win.span);
    await page.click('[data-preset="week"]');
    await settle();

    // ---- wheel zoom about the pointer --------------------------------------------------------------------
    st = await state();
    let px = st.L.px0 + (st.L.px1 - st.L.px0) * 0.8;
    let py = laneY(st, 3);
    let tBefore = tAt(st, px);
    await page.mouse.move(...abs(st, px, py));
    await page.mouse.wheel(0, -300);
    await settle(500);
    let st2 = await state();
    ok(st2.win.span < st.win.span * 0.7, 'wheel up zooms in', [st.win.span, st2.win.span]);
    ok(near(tAt(st2, px), tBefore, st2.win.span * 0.002), 'wheel zoom keeps the time under the pointer fixed', tAt(st2, px) - tBefore);
    await page.mouse.wheel(0, 600);
    await settle(500);
    st2 = await state();
    ok(st2.win.span > st.win.span, 'wheel down zooms out', st2.win.span);
    // ctrl + wheel also zooms
    st = await state();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await settle(400);
    st2 = await state();
    ok(st2.win.span < st.win.span, 'ctrl+wheel zooms', [st.win.span, st2.win.span]);
    // shift + wheel pans
    st = await state();
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 200);
    await page.keyboard.up('Shift');
    await settle(200);
    st2 = await state();
    ok(st2.win.c > st.win.c && near(st2.win.span, st.win.span, 1e-6), 'shift+wheel pans horizontally', st2.win.c - st.win.c);

    // ---- drag pans (and turns follow off) ---------------------------------------------------------------------------
    await page.click('[data-preset="week"]');
    await settle();
    st = await state();
    const k = (st.L.px1 - st.L.px0) / st.win.span;
    px = st.L.px0 + 300;
    py = laneY(st, 3);
    await page.mouse.move(...abs(st, px, py));
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(...abs(st, px - i * 20, py));
    await page.waitForTimeout(160); // let it rest so no inertia is carried
    await page.mouse.up();
    await settle(200);
    st2 = await state();
    ok(near(st2.win.c - st.win.c, 160 / k, 160 / k * 0.02), 'dragging left 160 px moves the window forward by 160 px', (st2.win.c - st.win.c) * k);
    ok(st2.t === st.t || near(st2.t, st.t, 1), 'a drag does not move the cursor');

    // ---- click moves the cursor ----------------------------------------------------------------------------------------
    st = await state();
    px = st.L.px0 + (st.L.px1 - st.L.px0) * 0.35;
    py = st.L.axis.y + 10; // the axis: no boundary snapping beyond ticks
    await page.mouse.click(...abs(st, px, py + 2));
    await settle(450); // a single click waits out the double-click window
    st2 = await state();
    ok(st2.mode === 'travel' && Math.abs(st2.t - tAt(st, px)) < 6 / k, 'click moves the cursor to the clicked time', { clicked: tAt(st, px), got: st2.t });
    // snapping on a lane: click 3 px next to a block boundary
    const bnd = await page.evaluate((t) => {
      const m = window.__fractonica.model;
      return m.boundaries(5, t - 86400, t + 86400, 10).map((b) => b.time);
    }, st.win.c);
    const target = bnd.find((b) => xAt(st, b) > st.L.px0 + 40 && xAt(st, b) < st.L.px1 - 40);
    await page.mouse.click(...abs(st, xAt(st, target) + 3, laneY(st, 5)));
    await settle(450);
    st2 = await state();
    ok(near(st2.t, target + 0.001, 0.0006), 'click within 5 px of a boundary snaps to the block start', st2.t - target);
    await page.mouse.click(...abs(st, xAt(st, target) + 15, laneY(st, 5)));
    await settle(450);
    st2 = await state();
    ok(Math.abs(st2.t - target) > 1000, 'click 15 px away does not snap', st2.t - target);

    // ---- scrubbing the cursor flag ------------------------------------------------------------------------------------
    await page.evaluate(() => { window.__fractonica.store.setTime(1791460800, 'jump'); window.__fractonica.instances.timeline.api.setWindow({ c: 1791460800, span: 7 * 86400 }); });
    await settle(300);
    st = await state();
    const flagY = st.L.axis.y + st.L.axis.ctxH + st.L.axis.tickH + 8;
    const flagX = xAt(st, st.t);
    const k2 = (st.L.px1 - st.L.px0) / st.win.span;
    await page.mouse.move(...abs(st, flagX - 10, flagY));
    await page.waitForTimeout(100);
    const cur = await page.evaluate(() => document.querySelector('.tl-canvas').style.cursor);
    ok(cur === 'ew-resize', 'hovering the cursor flag shows the scrub cursor', cur);
    await page.mouse.down();
    await page.mouse.move(...abs(st, flagX - 10 + 120, flagY), { steps: 6 });
    await page.mouse.up();
    await settle(150);
    st2 = await state();
    ok(near(st2.t - st.t, 120 / k2, 120 / k2 * 0.02), 'dragging the cursor flag scrubs time by the dragged distance', { dt: st2.t - st.t, want: 120 / k2 });
    ok(near(st2.win.c, st.win.c, 1), 'scrubbing does not move the window');

    // scrubbing past the plot edge scrolls the view and keeps the cursor under the pointer
    st = await state();
    const fx = xAt(st, st.t);
    await page.mouse.move(...abs(st, fx + 8, flagY));
    await page.mouse.down();
    await page.mouse.move(...abs(st, st.L.px1 + 6, flagY), { steps: 8 });
    await page.waitForTimeout(600);
    st2 = await state();
    await page.mouse.up();
    ok(st2.win.c > st.win.c + st.win.span * 0.05 && st2.t > st.t + st.win.span * 0.3, 'scrubbing past the right edge scrolls the view and carries the cursor', { dc: (st2.win.c - st.win.c) / st.win.span, dt: (st2.t - st.t) / st.win.span });

    // ---- double-click fits a block ----------------------------------------------------------------------------------------
    await page.click('[data-preset="week"]');
    await settle();
    st = await state();
    px = st.L.px0 + (st.L.px1 - st.L.px0) * 0.5;
    const cyc = await page.evaluate(([t, L]) => { const m = window.__fractonica.model; const c = m.cycleAt(t, L); return { start: c.start, end: c.end }; }, [tAt(st, px), 5]);
    await page.mouse.dblclick(...abs(st, px, laneY(st, 5)));
    await settle(500);
    st2 = await state();
    ok(near(st2.win.c, (cyc.start + cyc.end) / 2, 120) && near(st2.win.span, (cyc.end - cyc.start) * 1.12, 240), 'double-click on a block zooms to fit that cycle (+6 % margin)', { c: st2.win.c, span: st2.win.span, want: cyc.end - cyc.start });
    ok(st2.follow === false, 'fitting turns follow off');

    // ---- toolbar buttons ------------------------------------------------------------------------------------------------------
    st = await state();
    await page.click('[data-act="out"]');
    await settle();
    st2 = await state();
    ok(near(st2.win.span, st.win.span * 2, st.win.span * 0.01), 'zoom out button doubles the span');
    await page.click('[data-act="in"]');
    await settle();
    st2 = await state();
    ok(near(st2.win.span, st.win.span, st.win.span * 0.01), 'zoom in button halves it again');
    await page.click('[data-act="centre"]');
    await settle();
    st2 = await state();
    ok(near(st2.win.c, st2.t, 2), 'centre button centres on the cursor', st2.win.c - st2.t);
    await page.click('[data-act="fit"]');
    await settle();
    st2 = await state();
    const selCycle = await page.evaluate((t) => { const m = window.__fractonica; const c = m.model.cycleAt(t, m.store.state.selectedLevel); return { start: c.start, end: c.end }; }, st2.t);
    ok(near(st2.win.span, (selCycle.end - selCycle.start) * 1.12, 240), 'fit button fits the selected depth cycle at the cursor', { span: st2.win.span, want: (selCycle.end - selCycle.start) * 1.12 });
    ok((await page.textContent('.tl-fit-label')) === 'Fit η', 'fit label names the selected depth');
    await page.click('[data-act="follow"]');
    await settle();
    st2 = await state();
    ok(st2.follow === true && (await page.getAttribute('[data-act="follow"]', 'aria-pressed')) === 'true', 'follow toggles on');
    ok(near(st2.win.c, st2.t, 2), 'enabling follow centres the cursor', st2.win.c - st2.t);

    // follow: window moves with time-lapse, cursor stays at 50 %
    st = await state();
    await page.evaluate(() => { const s = window.__fractonica.store; s.setRate(3600); });
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__fractonica.store.pause());
    await page.waitForTimeout(120);
    st2 = await state();
    ok(near(st2.win.c, st2.t, 1) && st2.t > st.t + 1000, 'follow keeps the cursor at the middle during a time-lapse', { dc: st2.win.c - st2.t });
    // dragging turns follow off
    st = await state();
    await page.mouse.move(...abs(st, st.L.px0 + 200, laneY(st, 2)));
    await page.mouse.down();
    await page.mouse.move(...abs(st, st.L.px0 + 260, laneY(st, 2)), { steps: 4 });
    await page.mouse.up();
    st2 = await state();
    ok(st2.follow === false, 'dragging turns follow off');

    // ---- external jumps bring the cursor into view --------------------------------------------------------------------------------
    await page.evaluate(() => window.__fractonica.store.setTime(946684800, 'jump'));
    await settle(500);
    st2 = await state();
    ok(near(st2.win.c, 946684800, st2.win.span * 0.01), 'a jump from elsewhere re-centres the view on the new time', st2.win.c - 946684800);

    // ---- lane labels select the level ---------------------------------------------------------------------------------------------
    st = await state();
    await page.mouse.click(...abs(st, 20, laneY(st, 3)));
    await settle(150);
    st2 = await state();
    ok(st2.sel === st.levels[3], 'clicking a lane label selects that level everywhere', st2.sel);

    // ---- overview ---------------------------------------------------------------------------------------------------------------------
    st = await state();
    const ovY = st.L.overview.y + st.L.overview.h / 2;
    const ovX = st.L.px0 + (st.L.px1 - st.L.px0) * 0.75;
    await page.mouse.click(...abs(st, ovX, ovY));
    await settle(150);
    st2 = await state();
    const wantC = await page.evaluate((f) => { const m = window.__fractonica.model; const L = m.tMax - m.tMin; const d0 = m.tMin - 0.03 * L; const d1 = m.tMax + 0.03 * L; return d0 + f * (d1 - d0); }, 0.75);
    ok(near(st2.win.c, wantC, st2.win.span * 0.02 + 1e6), 'clicking the overview recentres the window there', { c: st2.win.c, want: wantC });
    // drag the overview frame
    st = await state();
    const frameX = st.L.px0 + ((st.win.c - (await page.evaluate(() => { const m = window.__fractonica.model; const L = m.tMax - m.tMin; return m.tMin - 0.03 * L; }))) / (st.win.span > 0 ? (await page.evaluate(() => { const m = window.__fractonica.model; const L = m.tMax - m.tMin; return 1.06 * L; })) : 1)) * (st.L.px1 - st.L.px0);
    await page.mouse.move(...abs(st, frameX, ovY));
    await page.mouse.down();
    await page.mouse.move(...abs(st, frameX - 120, ovY), { steps: 6 });
    await page.mouse.up();
    await settle(100);
    st2 = await state();
    ok(st2.win.c < st.win.c, 'dragging the overview frame scrolls the timeline', st2.win.c - st.win.c);

    // ---- keyboard ------------------------------------------------------------------------------------------------------------------------
    await page.click('[data-preset="week"]');
    await settle();
    await page.evaluate(() => document.querySelector('.tl-canvas').focus());
    st = await state();
    await page.keyboard.press('+');
    await settle(300);
    st2 = await state();
    ok(near(st2.win.span, st.win.span / 2, st.win.span * 0.01), 'key + zooms in');
    await page.keyboard.press('-');
    await settle(300);
    st2 = await state();
    ok(near(st2.win.span, st.win.span, st.win.span * 0.01), 'key - zooms out');
    await page.keyboard.press('ArrowRight');
    await settle(300);
    let st3 = await state();
    ok(near(st3.win.c - st2.win.c, st2.win.span * 0.15, st2.win.span * 0.01), 'ArrowRight pans 15 % of the span', (st3.win.c - st2.win.c) / st2.win.span);
    await page.keyboard.press('ArrowLeft');
    await settle(300);
    let st4 = await state();
    ok(near(st4.win.c, st2.win.c, 1), 'ArrowLeft pans back');
    await page.keyboard.press('Home');
    await settle(300);
    st4 = await state();
    ok(near(st4.win.c, st4.t, 2), 'Home centres on the cursor');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await settle(200);
    st3 = await state();
    ok(near(st3.t, st4.win.c + st4.win.span * 0.15, st4.win.span * 0.01), 'Enter moves the cursor to the middle of the view');
    const selBefore = (await state()).sel;
    await page.keyboard.press('ArrowDown');
    ok((await state()).sel === selBefore + 1, 'ArrowDown selects the next finer level');
    await page.keyboard.press('ArrowUp');
    ok((await state()).sel === selBefore, 'ArrowUp selects the next coarser level');
    await page.keyboard.press('f');
    await settle(300);
    {
      const g = (await state()).goal;
      const c = await page.evaluate((t) => { const m = window.__fractonica; const x = m.model.cycleAt(t, m.store.state.selectedLevel); return x.end - x.start; }, (await state()).t);
      ok(near(g.span, c * 1.12, c * 0.003), 'F fits the selected cycle', { span: g.span, want: c * 1.12 });
    }

    // ---- limits --------------------------------------------------------------------------------------------------------------------------------
    await page.evaluate(() => window.__fractonica.instances.timeline.api.setWindow({ c: 1.79e9, span: 0.001 }));
    st = await state();
    ok(st.win.span === 2, 'zoom is limited to 2 s across', st.win.span);
    await page.evaluate(() => window.__fractonica.instances.timeline.api.setWindow({ c: 1e12, span: 1e15 }));
    st = await state();
    ok(st.win.span < 4.2e10 && st.win.c - st.win.span / 2 >= -1.2455e10 && st.win.c + st.win.span / 2 <= 2.9206e10, 'pan / zoom stay within the catalogue plus margin', st.win);

    // ---- hover tooltip ---------------------------------------------------------------------------------------------------------------------------
    await page.evaluate(() => window.__fractonica.store.setTime(1791460800, 'jump'));
    await page.click('[data-preset="day"]');
    await settle();
    st = await state();
    px = st.L.px0 + 400;
    await page.mouse.move(...abs(st, px, laneY(st, 4)));
    await page.waitForTimeout(200);
    const tipText = await page.evaluate(() => { const t = document.querySelector('.tl-tip'); return t.hidden ? null : t.innerText; });
    ok(tipText && /UTC/.test(tipText) && /pos \d+\.\d{6}/.test(tipText) && /ε 5/.test(tipText) && /\d\/5/.test(tipText), 'hover tooltip shows time, position and cycle names', tipText?.slice(0, 120));
    await page.mouse.move(...abs(st, st.L.px0 + 400, st.L.eclipse.y + 8));
    await page.waitForTimeout(150);
    await page.mouse.move(...abs(st, 20, laneY(st, 4)));
    await page.waitForTimeout(150);
    const gtip = await page.evaluate(() => { const t = document.querySelector('.tl-tip'); return t.hidden ? null : t.innerText; });
    ok(gtip && /ε/.test(gtip) && /select/i.test(gtip), 'lane label tooltip teaches what the lane is', gtip?.slice(0, 100));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(150);
    ok(await page.evaluate(() => document.querySelector('.tl-tip').hidden), 'tooltip hides when the pointer leaves');

    // ---- eclipse lane ----------------------------------------------------------------------------------------------------------------------------------
    await page.click('[data-preset="century"]');
    await settle();
    await page.evaluate(() => window.__fractonica.store.setTime(946684800, 'jump'));
    await settle(500);
    st = await state();
    const ecl = await page.evaluate((t) => window.__fractonica.model.catalogue.filter((e) => Math.abs(e - t) < 1.2e9), st.win.c);
    ok(ecl.length >= 2, 'eclipses are visible in the century window', ecl.length);
    const ex = xAt(st, ecl[1]);
    await page.mouse.move(...abs(st, ex, st.L.eclipse.y + 0.4 * st.L.eclipse.h));
    await page.waitForTimeout(150);
    const etip = await page.evaluate(() => { const t = document.querySelector('.tl-tip'); return t.hidden ? null : t.innerText; });
    ok(etip && /Eclipse \d+ of 70/.test(etip), 'hovering an eclipse marker names it', etip?.slice(0, 80));
    await page.mouse.click(...abs(st, ex + 2, st.L.eclipse.y + 0.4 * st.L.eclipse.h));
    await settle(450);
    st2 = await state();
    ok(near(st2.t, ecl[1] + 0.001, 0.002), 'clicking an eclipse marker moves the cursor to it', st2.t - ecl[1]);

    // ---- next-boundary pointer ---------------------------------------------------------------------------------------------------------------------------
    await page.evaluate(() => window.__fractonica.store.setTime(1791460800, 'jump'));
    await page.evaluate(() => { window.__fractonica.store.set({ selectedLevel: 4 }); window.__fractonica.instances.timeline.api.setWindow({ c: 1791460800, span: 8 * 3600 }); });
    await settle(300);
    st = await state();
    const chip = await page.evaluate(() => 1);
    void chip;
    const endT = await page.evaluate((t) => window.__fractonica.model.cycleAt(t, 4).end, st.t);
    ok(endT > st.win.c + st.win.span / 2, 'selected cycle end is off screen to the right (setup)');
    await shot('tl-chip.png');
    // chip sits right-aligned in the selected lane
    const li = st.levels.indexOf(4);
    await page.mouse.click(...abs(st, st.L.px1 - 40, laneY(st, li)));
    await settle(500);
    st2 = await state();
    ok(st2.win.c + st2.win.span / 2 > endT || near(st2.goal.c + st2.goal.span / 2, endT, 1) || (endT >= st2.win.c - st2.win.span / 2 && endT <= st2.win.c + st2.win.span / 2), 'clicking the "ends in" pointer brings the end into view', { c: st2.win.c, endT });
    ok(st2.follow === false, 'revealing turns follow off');

    // ---- resize ---------------------------------------------------------------------------------------------------------------------------------------------
    await page.setViewportSize({ width: 700, height: 800 });
    await settle(300);
    st = await state();
    ok(st.L.compact === false && st.rect.w > 0, 'resized to 700 px wide', st.rect.w);
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(300);
    st = await state();
    ok(st.L.compact === true, 'phone layout below 560 px', st.rect.w);
    const own = () => page.evaluate(() => {
      const root = document.querySelector('.tl-root');
      const vw = document.documentElement.clientWidth;
      let worst = 0;
      for (const el of root.querySelectorAll('*')) {
        const b = el.getBoundingClientRect();
        if (b.width && getComputedStyle(el).position !== 'fixed') worst = Math.max(worst, b.right - vw);
      }
      return { worst: Math.round(worst), rootScroll: root.scrollWidth - root.clientWidth, right: Math.round(root.getBoundingClientRect().right), vw };
    });
    let o = await own();
    ok(o.worst <= 0 && o.rootScroll <= 0, 'timeline has no horizontal overflow at 390 px', o);
    await page.setViewportSize({ width: 360, height: 740 });
    await settle(300);
    o = await own();
    ok(o.worst <= 0 && o.rootScroll <= 0, 'timeline has no horizontal overflow at 360 px', o);

    const mine = errors.filter((e) => /timeline/i.test(e) || /pageerror/.test(e));
    ok(mine.length === 0, 'no console errors from the timeline', mine);
  },
  { viewport: { width: 1440, height: 900 } },
);
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
