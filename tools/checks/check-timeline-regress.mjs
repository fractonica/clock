// Regression checks for the timeline review fixes (headless Chromium, reads the real state back).
//   node tools/checks/check-timeline-regress.mjs        exits non-zero when a check fails
import { withApp } from '../browse.mjs';

let failed = 0;
const ok = (cond, msg, extra) => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
};
const TMAX = 28005212035.816;
const api = (page, fn, arg) => page.evaluate(fn, arg);
const toCanvas = (page) => page.evaluate(() => document.querySelector('.tl-canvas').scrollIntoView({ block: 'center' }));
const layoutOf = (page) => page.evaluate(() => {
  const a = window.__fractonica.instances.timeline.api;
  const r = document.querySelector('.tl-canvas').getBoundingClientRect();
  return { L: a.layout, w: a.window, r: { x: r.x, y: r.y } };
});
/** The instant under canvas-x `cx` for the window as it is right now. */
const tUnder = (page, cx) =>
  page.evaluate((cx) => {
    const a = window.__fractonica.instances.timeline.api;
    const w = a.window;
    const L = a.layout;
    return w.c + (cx - (L.px0 + L.px1) / 2) / ((L.px1 - L.px0) / w.span);
  }, cx);
const tipHead = async (page) => (await page.locator('.tl-tip').innerText()).split('\n')[0];
const parseHead = (h) => {
  const m = /(\d+) (\w+) (\d{4}), (\d\d):(\d\d):(\d\d)(?:\.(\d{3}))?/.exec(h);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[2]);
  return Date.UTC(+m[3], mon, +m[1], +m[4], +m[5], +m[6], +(m[7] ?? 0)) / 1000;
};

await withApp(
  async ({ page, context, url, errors }) => {
    // ---- the instant under a resting pointer follows the window ------------------------------------------------------
    await page.goto(url('?t=1791460800&view=timeline&zone=UTC'));
    await page.waitForTimeout(800);
    await toCanvas(page);
    await api(page, () => { const a = window.__fractonica.instances.timeline.api; a.setFollow(false); a.setWindow({ c: 1791460800, span: 86400 }); });
    await page.waitForTimeout(300);
    let { L, r } = await layoutOf(page);
    const hx = L.px0 + 450;
    await page.mouse.move(r.x + hx - 5, r.y + L.lanesY + 3 * L.laneH + 10);
    await page.mouse.move(r.x + hx, r.y + L.lanesY + 3 * L.laneH + 10);
    await page.waitForTimeout(250);
    await page.focus('.tl-canvas');
    for (const [key, name] of [['ArrowRight', 'pan'], ['+', 'zoom']]) {
      await page.keyboard.press(key);
      if (key === 'ArrowRight') await page.keyboard.press(key);
      await page.waitForTimeout(600);
      const shown = parseHead(await tipHead(page));
      const truth = await tUnder(page, hx);
      ok(Math.abs(shown - truth) < 1.5, `tooltip follows the window after a keyboard ${name} (pointer at rest)`, { shown, truth, off: shown - truth });
    }

    await page.goto(url('?view=timeline&zone=UTC'));
    await page.waitForTimeout(800);
    await toCanvas(page);
    await api(page, () => { window.__fractonica.instances.timeline.api.animateTo({ c: window.__fractonica.store.t(), span: 20 }, { dur: 0 }); });
    await page.waitForTimeout(400);
    ({ L, r } = await layoutOf(page));
    await page.mouse.move(r.x + L.px0 + 440, r.y + L.lanesY + 3 * L.laneH + 10);
    await page.mouse.move(r.x + L.px0 + 450, r.y + L.lanesY + 3 * L.laneH + 10);
    await page.waitForTimeout(2500);
    const liveShown = parseHead(await tipHead(page));
    const liveTruth = await tUnder(page, L.px0 + 450);
    ok(Math.abs(liveShown - liveTruth) < 0.4, 'live mode, 20 s window: the tooltip keeps up with the sliding window', { off: liveShown - liveTruth });

    // ---- the polite live region is silent while the clock runs, and speaks once after a user action ----------------
    await page.goto(url('?view=timeline&zone=UTC'));
    await page.waitForTimeout(1200);
    const liveMut = await page.evaluate(() => new Promise((res) => {
      const el = document.querySelector('[data-role="live"]');
      let c = 0;
      const mo = new MutationObserver(() => c++);
      mo.observe(el, { childList: true, characterData: true, subtree: true });
      setTimeout(() => { mo.disconnect(); res(c); }, 3500);
    }));
    ok(liveMut === 0, 'live mode: no live-region announcements from the ticking clock', liveMut);
    await page.goto(url('?t=1791460800&view=timeline&zone=UTC&rate=3600'));
    await page.waitForTimeout(1200);
    const lapseMut = await page.evaluate(() => new Promise((res) => {
      const el = document.querySelector('[data-role="live"]');
      let c = 0;
      const mo = new MutationObserver(() => c++);
      mo.observe(el, { childList: true, characterData: true, subtree: true });
      setTimeout(() => { mo.disconnect(); res(c); }, 3000);
    }));
    ok(lapseMut === 0, 'time-lapse: no live-region announcements', lapseMut);
    await page.click('[data-preset="week"]');
    await page.waitForTimeout(1500);
    const said = await page.locator('[data-role="live"]').textContent();
    ok(/7 d 0 h across/.test(said) && /Selected depth 7 \(η\)/.test(said) && !/level/i.test(said), 'a preset click is announced once, with the selected depth', said);
    const sum = await page.locator('[data-role="summary"]').textContent();
    const desc = await page.getAttribute('.tl-canvas', 'aria-describedby');
    ok(sum.length > 40 && desc.split(' ').every((id) => page.locator('#' + id).count()), 'the canvas has a text alternative (aria-describedby)', desc);

    // ---- repaints: Follow glides without redrawing every frame --------------------------------------------------------
    await page.goto(url('?view=timeline&zone=UTC'));
    await page.waitForTimeout(1000);
    const rp = await page.evaluate(() => new Promise((res) => {
      const g = document.querySelector('.tl-canvas').getContext('2d');
      const orig = g.clearRect.bind(g);
      let c = 0;
      g.clearRect = (...a) => { c++; return orig(...a); };
      let attrs = 0;
      const mo = new MutationObserver((m) => { attrs += m.length; });
      mo.observe(document.querySelector('.tl-root'), { attributes: true, subtree: true });
      setTimeout(() => { mo.disconnect(); g.clearRect = orig; res({ repaints: c, attrs }); }, 2000);
    }));
    ok(rp.repaints <= 6, 'live Follow at day scale repaints about once per second, not per frame', rp);
    ok(rp.attrs === 0, 'no attribute writes inside the timeline while nothing changes', rp);

    // ---- the closing instant of the catalogue ------------------------------------------------------------------------
    await page.goto(url(`?t=${TMAX}&view=timeline&zone=UTC`));
    await page.waitForTimeout(800);
    await api(page, () => { const a = window.__fractonica.instances.timeline.api; a.setFollow(false); a.setWindow({ c: window.__fractonica.store.t(), span: 6 * 3600 }); });
    await page.click('[data-act="fit"]');
    await page.waitForTimeout(700);
    const toastAtMax = await page.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
    const spanAtMax = await api(page, () => window.__fractonica.instances.timeline.api.window.span);
    ok(toastAtMax === '' && Math.abs(spanAtMax - 6 * 3600) > 100, 'Fit works at exactly tMax (no "outside the catalogue" toast)', { toastAtMax, spanAtMax });

    // ---- millisecond labels ----------------------------------------------------------------------------------------------
    await page.goto(url('?view=timeline&zone=UTC'));
    await page.waitForTimeout(800);
    await toCanvas(page);
    await api(page, () => { const a = window.__fractonica.instances.timeline.api; a.setFollow(false); a.setWindow({ c: 1791460800.9997, span: 20 }); });
    await page.waitForTimeout(300);
    ({ L, r } = await layoutOf(page));
    const badHeads = [];
    for (let i = 0; i < 40; i++) {
      await page.mouse.move(r.x + (L.px0 + L.px1) / 2 + i * 0.05, r.y + L.lanesY + 3 * L.laneH + 10);
      await page.waitForTimeout(25);
      const h = await tipHead(page);
      if (!/:\d\d\.\d{3} UTC/.test(h)) badHeads.push(h);
    }
    ok(badHeads.length === 0, 'tooltip heads always carry a 3-digit millisecond field', badHeads.slice(0, 2));

    // ---- double-click zooms without leaving Live; a single click does move the cursor ------------------------------
    await page.goto(url('?view=timeline&zone=UTC'));
    await page.waitForTimeout(800);
    await toCanvas(page);
    await api(page, () => { const a = window.__fractonica.instances.timeline.api; a.setFollow(false); a.setPreset('week'); });
    await page.waitForTimeout(500);
    ({ L, r } = await layoutOf(page));
    const px = r.x + L.px0 + 300;
    const py = r.y + L.lanesY + 4 * L.laneH + 10;
    await page.mouse.dblclick(px, py);
    await page.waitForTimeout(900);
    const afterDbl = await api(page, () => ({ mode: window.__fractonica.store.mode, span: window.__fractonica.instances.timeline.api.window.span }));
    ok(afterDbl.mode === 'live' && afterDbl.span < 3e6, 'double-click zooms to the cycle and stays in Live mode', afterDbl);
    ({ L, r } = await layoutOf(page));
    await page.mouse.click(r.x + L.px0 + 100, r.y + L.axis.y + 10);
    await page.waitForTimeout(500);
    ok((await api(page, () => window.__fractonica.store.mode)) === 'travel', 'a single click still moves the cursor (after the double-click window)');

    // ---- no phantom block at the closing instant ------------------------------------------------------------------------
    for (const lane of [5, 7, 8, 9]) {
      await page.goto(url(`?t=${TMAX - 2000}&view=timeline&zone=UTC&sel=9`));
      await page.waitForTimeout(700);
      await toCanvas(page);
      await api(page, (tm) => { const a = window.__fractonica.instances.timeline.api; a.setFollow(false); a.setWindow({ c: tm - 300, span: 3000 }); }, TMAX);
      await page.waitForTimeout(300);
      ({ L, r } = await layoutOf(page));
      const w = (await layoutOf(page)).w;
      const xTmax = L.px0 + ((TMAX - (w.c - w.span / 2)) / w.span) * (L.px1 - L.px0);
      await page.mouse.click(r.x + xTmax - 2.2, r.y + L.lanesY + lane * L.laneH + 8);
      await page.waitForTimeout(500);
      const out = await api(page, (tm) => ({ d: window.__fractonica.store.t() - tm, toast: document.querySelector('.toast')?.textContent ?? '' }), TMAX);
      ok(out.toast === '' && out.d > -20 && out.d <= 0, `click just inside the catalogue end lands inside it on lane ${lane + 1}`, out);
    }

    // ---- keyboard after the toolbar, Up/Down stay on the lanes, zoom limit --------------------------------------------
    await page.goto(url('?t=1791460800&view=timeline&zone=UTC'));
    await page.waitForTimeout(800);
    await toCanvas(page);
    await page.click('[data-preset="week"]');
    await page.waitForTimeout(500);
    const goalSpan = () => api(page, () => window.__fractonica.instances.timeline.api.goal.span);
    await page.keyboard.press('+');
    await page.waitForTimeout(400);
    ok(Math.abs((await goalSpan()) - 302400) < 1, 'shortcuts work while a toolbar button has the focus');
    await page.focus('[data-preset="day"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    ok(Math.abs((await goalSpan()) - 86400) < 1, 'Enter on a focused button activates that button');
    await page.focus('.tl-canvas');
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
    ok((await api(page, () => window.__fractonica.store.state.selectedLevel)) === 9, 'Down stops at the last lane (depth 10)');
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowUp');
    ok((await api(page, () => window.__fractonica.store.state.selectedLevel)) === 0, 'Up stops at the first lane');
    for (let i = 0; i < 30; i++) await page.keyboard.press('+');
    await page.waitForTimeout(400);
    ok((await page.getAttribute('[data-act="in"]', 'aria-disabled')) === 'true' && (await page.getAttribute('[data-act="out"]', 'aria-disabled')) === 'false', 'zoom-in is marked unavailable at the 2 s limit');

    // ---- corrupt persisted settings do not stop the view from mounting -------------------------------------------------
    for (const bad of ['{"selectedLevel":null}', '{"selectedLevel":-3}', '{"selectedLevel":3.5}', '{"selectedLevel":"6"}']) {
      const p2 = await context.newPage();
      await p2.addInitScript((v) => localStorage.setItem('fractonica-clock/v1', v), bad);
      await p2.goto(url('?view=timeline&zone=UTC'));
      await p2.waitForTimeout(600);
      const mounted = await p2.evaluate(() => !!document.querySelector('.tl-canvas') && !/could not be loaded/.test(document.querySelector('#view-timeline').textContent));
      ok(mounted, `mounts with persisted ${bad}`);
      await p2.close();
    }
    console.log(errors.filter((e) => /timeline|tl-/i.test(e)));
  },
  { viewport: { width: 1440, height: 900 } },
);

// ---- phone: target sizes, the cursor flag stays readable --------------------------------------------------------------
await withApp(
  async ({ page, url }) => {
    await page.goto(url('?t=1791460800&view=timeline&zone=UTC'));
    await page.waitForTimeout(900);
    const sizes = await page.evaluate(() => [...document.querySelectorAll('.tl-presets button, .tl-group .btn')].map((b) => { const r = b.getBoundingClientRect(); return [b.textContent.trim() || b.dataset.act, Math.round(r.width), Math.round(r.height)]; }));
    ok(sizes.every(([, w, h]) => w >= 34 && h >= 36), 'phone: toolbar targets are at least 36 px tall and 34 px wide', sizes.filter(([, w, h]) => w < 34 || h < 36));
    const follow = await page.textContent('[data-act="follow"]');
    ok(/Follow/.test(follow), 'phone: Follow keeps its name', follow.trim());
  },
  { viewport: { width: 360, height: 740 } },
);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
