/**
 * Headless check of the read-out wording of the timeline and the face (the "small round"):
 *   - the percentage through a cycle in the timeline hover is floored (never 100 % before the end),
 *   - the face tooltips print the 0-based SPEC state index (a cycle starts in state 0 and ends in state 15),
 *   - no visible text, title, aria label or tooltip of either module says "level" (the word is "depth").
 *
 *   node tools/checks/check-timeline-wording.mjs      (screenshots: tools/out/wording-*.png)
 */
import { withApp } from '../browse.mjs';

const T_A = 1791460800; // SPEC vector A 2026-10-08T12:00:00Z
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? '  ' + detail : ''}`);
};
const LEVEL = /\blevels?\b/i;

/** Every string a screen reader or a hover could show inside `sel`: text content, title, aria-label, aria-description. */
const stringsIn = (page, sel) =>
  page.evaluate((s) => {
    const out = [];
    for (const root of document.querySelectorAll(s)) {
      out.push(root.textContent);
      for (const el of [root, ...root.querySelectorAll('*')]) {
        for (const a of ['title', 'aria-label', 'aria-description', 'aria-valuetext']) {
          const v = el.getAttribute(a);
          if (v) out.push(v);
        }
      }
    }
    return out.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }, sel);

const own = (e) => /timeline|face/i.test(e) || /pageerror/.test(e);

await withApp(
  async ({ page, url, errors, shot }) => {
    await page.goto(url(`?t=${T_A}&view=timeline&zone=UTC&sel=7&face=watch`));
    await page.addStyleTag({ content: '#topbar{max-height:140px;overflow:hidden;} .toast{display:none}' });
    await page.waitForSelector('.tl-canvas');
    await page.waitForSelector('.face-svg .face-glyph path');
    await page.waitForTimeout(900);

    const tl = (fn, ...args) => page.evaluate(([f, a]) => new Function('tl', 'fz', 'args', `return (${f})(tl, fz, args)`)(window.__fractonica.instances.timeline.api, window.__fractonica, a), [fn.toString(), args]);
    const box = await page.evaluate(() => {
      const r = document.querySelector('.tl-canvas').getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    const L = await tl((api) => api.layout);
    const levels = await tl((api) => api.levels);
    const at = (x, y) => [box.x + x, box.y + y];
    const laneY = (level) => L.lanesY + L.laneH * (levels.indexOf(level) + 0.5);
    const tipText = async () => (await page.locator('.tl-tip').isVisible()) ? (await page.locator('.tl-tip').innerText()).replace(/\s+/g, ' ') : '';

    // ---- 1. timeline hover: the percentage is floored ----------------------------------------------------------------
    // a window two seconds wide, centred 4.5 ms before the end of the kappa cycle (depth 10, about 100 s long)
    const kEnd = await tl((api, fz) => fz.model.levelAt(1791460800, 9).end);
    await tl((api, fz, [c]) => api.setWindow({ c, span: 2 }), kEnd - 0.0045);
    await page.waitForTimeout(400);
    await page.mouse.move(...at((L.px0 + L.px1) / 2, laneY(9)));
    await page.waitForTimeout(300);
    const tip1 = await tipText();
    const kappaRow = /κ 10\s+(\d+)\/(\d+)\s+(\d+)%/.exec(tip1);
    check('hover 4.5 ms before the end of a kappa cycle reads 99% (not 100%)', kappaRow && kappaRow[3] === '99', kappaRow ? kappaRow[0] : tip1.slice(0, 200));
    check('no row of that tooltip reads 100%', !/\b100%/.test(tip1));
    await shot('wording-hover-kappa-end.png');

    // vector A, eta is 81.46 % through its cycle: 81%, and the same instant in the rings text is 81.4 %
    await tl((api, fz, [c]) => api.setWindow({ c, span: 2 }), T_A);
    await page.waitForTimeout(400);
    await page.mouse.move(...at((L.px0 + L.px1) / 2 + 1, laneY(6)));
    await page.waitForTimeout(300);
    const tip2 = await tipText();
    const etaRow = /η 7\s+(\d+)\/(\d+)\s+(\d+)%/.exec(tip2);
    check('hover at vector A: eta reads 81%', etaRow && etaRow[3] === '81', etaRow ? etaRow[0] : tip2.slice(0, 200));

    // ---- 2. the face prints the 0-based SPEC state index ------------------------------------------------------------
    const lv = await page.evaluate(() => {
      const l = window.__fractonica.model.levelAt(1791460800, 6);
      return { start: l.start, end: l.end };
    });
    const faceTip = async (row) => {
      const r = await page.locator(`.face-row--${row}`).boundingBox();
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      await page.waitForTimeout(700);
      const vis = await page.locator('.face-tip').isVisible();
      return vis ? (await page.locator('.face-tip').innerText()).replace(/\s+/g, ' ') : '';
    };
    await page.evaluate((t) => window.__fractonica.ctx.goto(t), lv.start + 0.001);
    await page.waitForTimeout(400);
    const first = await faceTip('top');
    check('face tooltip, first instant of a cycle: "State 0 of 16"', /State 0 of 16: value 0, rising/.test(first), first.slice(0, 160));
    await page.evaluate((t) => window.__fractonica.ctx.goto(t), lv.end - 0.001);
    await page.waitForTimeout(400);
    const last = await faceTip('top');
    check('face tooltip, last instant of a cycle: "State 15 of 16", never 16', /State 15 of 16/.test(last) && !/State 16\b/.test(last), last.slice(0, 160));
    await shot('wording-face-state15.png');
    const label = await page.locator('.face-row--top').getAttribute('aria-label');
    check('face row aria label carries state 15 and says "depth"', /depth 7: state 15 of 16/.test(label) && /select this depth$/.test(label), label);

    // solar tooltip: phase floored (35.866 % at vector A)
    await page.evaluate((t) => window.__fractonica.ctx.goto(t), T_A);
    await page.waitForTimeout(400);
    const solar = await faceTip('solar');
    check('face solar tooltip floors the phase: 35.8 % (35.87 % through)', /Phase 35\.8 % of this 4-day sync/.test(solar), solar.slice(0, 120));

    // ---- 3. no "level" in anything the two modules show or announce -----------------------------------------------------
    const seen = [];
    seen.push(...(await stringsIn(page, '#view-timeline')));
    seen.push(...(await stringsIn(page, '#slot-face')));
    // tooltips: lane head (gutter), a lane in the plot, the overview, an eclipse, the selected cycle's end chip at the edge
    await tl((api, fz, [c]) => api.setWindow({ c, span: 2 }), T_A);
    await page.waitForTimeout(400);
    const sel = await page.evaluate(() => window.__fractonica.store.state.selectedLevel);
    check('the selected depth is 7 (sel=7 deep link)', sel === 6, String(sel));
    for (const [name, x, y] of [
      ['lane head', 20, laneY(6)],
      ['lane head of alpha', 20, laneY(0)],
      ['lane in the plot', L.px0 + 300, laneY(3)],
      ['end chip of the selected cycle', L.px1 - 24, laneY(6)],
      ['overview', L.px0 + 100, L.overview.y + 12],
      ['eclipse lane head', 20, L.eclipse.y + L.eclipse.h / 2],
    ]) {
      await page.mouse.move(...at(x, y));
      await page.waitForTimeout(300);
      const t = await tipText();
      seen.push(t);
      console.log(`     ${name}: ${t.slice(0, 150)}`);
    }
    // the selected-cycle chip's tooltip names the depth
    const chipTip = seen.find((x) => /Next turnover/.test(x));
    check('the end chip tooltip says "selected depth"', chipTip && /selected depth, η \(depth 7\)/.test(chipTip), chipTip ?? '(no chip tooltip seen)');
    await page.mouse.move(2, 2);
    // the face: the other rows and the gesture hints, the how-to card, the selection announcement
    for (const row of ['bottom', 'solar']) seen.push(await faceTip(row));
    await page.click('.face-help, [aria-controls^="face-pop"]').catch(() => {});
    await page.waitForTimeout(300);
    seen.push(...(await stringsIn(page, '.face-pop')));
    await page.keyboard.press('Escape');
    await page.locator('.face-row--top').click({ force: true });
    await page.waitForTimeout(300);
    seen.push(...(await stringsIn(page, '#slot-face')));
    const bad = seen.filter((s) => LEVEL.test(s));
    check(`no visible text, title, aria label or tooltip of the timeline or the face says "level" (${seen.length} strings read)`, bad.length === 0, bad.slice(0, 3).map((s) => s.slice(0, 120)).join(' | '));

    const mine = errors.filter(own);
    check('no console errors from the timeline or the face', mine.length === 0, mine.join(' | '));
  },
  { viewport: { width: 1440, height: 900 } },
);

process.exit(results.every(Boolean) ? 0 : 1);
