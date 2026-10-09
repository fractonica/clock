// Audit follow-ups for the rings view: quarter chips (passed ones jump back), glyph state numbering,
// help copy, the labelled "through this cycle" figure and the touch routes to the ring tooltip.
// usage: node tools/checks/check-rings-audit.mjs        (exit code 1 when a check fails)
import { withApp } from '../browse.mjs';

const T = 1791460800; // 2026-10-08T12:00Z, SPEC vector A
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};
const hideToast = (page) => page.evaluate(() => { const e = document.querySelector('#toast'); if (e) e.hidden = true; });
const toastText = (page) => page.evaluate(() => { const e = document.querySelector('#toast'); return e && !e.hidden ? e.textContent : ''; });
const clock = (page) => page.evaluate(() => window.__fractonica.store.t());
const setClock = async (page, t) => {
  await page.evaluate((tt) => window.__fractonica.store.setTime(tt), t);
  await page.waitForTimeout(120);
};

// ---------------------------------------------------------------------------------------------
// desktop: chips, copy, labels
// ---------------------------------------------------------------------------------------------
await withApp(
  async ({ page, url, errors }) => {
    for (const sel of [7, 3, 10]) {
      await page.goto(url(`?t=${T}&view=rings&zone=UTC&sel=${sel}`));
      await page.waitForTimeout(700);
      await page.evaluate(() => window.__fractonica.store.pause?.());
      const L = sel - 1;
      const thr = await page.evaluate((LL) => {
        const { model, store } = window.__fractonica;
        const lv = model.levelAt(store.t(), LL);
        return { th: lv.thresholds.map((e) => e.time), quarter: lv.quarter, cycle: lv.cycle };
      }, L);
      const titles = await page.evaluate(() => [...document.querySelectorAll('.rings-chip')].map((b) => ({ cls: b.className, title: b.title, disabled: b.disabled })));
      for (let k = 0; k < 4; k++) {
        const passed = thr.quarter > k;
        check(
          `L${L} chip ${k} title says ${passed ? 'back' : 'past'}`,
          passed ? /^Jump back to the .* of this cycle/.test(titles[k].title) : /^Jump just past the/.test(titles[k].title),
          titles[k].title,
        );
      }
      for (let k = 0; k < 4; k++) {
        await setClock(page, T);
        await hideToast(page);
        const before = await clock(page);
        await page.locator(`.rings-chip[data-q="${k}"]`).click({ force: true });
        await page.waitForTimeout(150);
        const after = await clock(page);
        const toast = await toastText(page);
        const want = thr.th[k + 1] + 0.001;
        check(
          `L${L} chip ${k} (${thr.quarter > k ? 'passed' : 'ahead'}) jumps to threshold + 1 ms`,
          Math.abs(after - want) < 1e-3 && !/End of the catalogue/.test(toast),
          `before ${before.toFixed(3)} after ${after.toFixed(3)} want ${want.toFixed(3)} toast "${toast}"`,
        );
        if (k < 3) {
          const q = await page.evaluate((LL) => {
            const { model, store } = window.__fractonica;
            const lv = model.levelAt(store.t(), LL);
            return { quarter: lv.quarter, cycle: lv.cycle };
          }, L);
          check(`L${L} chip ${k}: same cycle, quarter ${k + 1}`, q.cycle === thr.cycle && q.quarter === k + 1, JSON.stringify(q));
        }
      }
      // "Next threshold" still goes to the next one
      await setClock(page, T);
      await hideToast(page);
      const next = await page.evaluate((LL) => {
        const { model, store } = window.__fractonica;
        return model.levelAt(store.t(), LL).next.time;
      }, L);
      await page.locator('.rings-b-thr').click({ force: true });
      await page.waitForTimeout(150);
      check(`L${L} Next threshold goes just past the next threshold`, Math.abs((await clock(page)) - (next + 0.001)) < 1e-3, `${next}`);
    }

    // glyph state: SPEC index, 0-based (vector A, depth 7: index 13)
    await page.goto(url(`?t=${T}&view=rings&zone=UTC&sel=7`));
    await page.waitForTimeout(700);
    const glyph = (await page.locator('.rings-f-glyph').innerText()).replace(/\s+/g, ' ');
    check('Glyph fact reads "state 13 of 0–15"', /state 13 of 0–15/.test(glyph), glyph);
    for (const [s, idx] of [[7, 13]]) {
      const real = await page.evaluate((LL) => window.__fractonica.model.levelAt(window.__fractonica.store.t(), LL).index, s - 1);
      check(`Glyph fact matches the model index (${idx})`, real === idx);
    }

    // help text
    await page.locator('.rings-help-btn').click();
    const help = (await page.locator('.rings-help').innerText()).replace(/\s+/g, ' ');
    check('Help no longer promises "a fraction of a second"', !/fraction of a second/.test(help));
    check('Help states the default range end (κ 10, 1 min 41 s) and the deepest ring (ξ 14, 44 ms)', /κ 10/.test(help) && /1 min 41 s/.test(help) && /ξ 14/.test(help) && /44 ms/.test(help));
    check('Help mentions touch navigation', /touch and hold/.test(help));
    await page.locator('.rings-help-btn').click();

    // the figure is labelled and floored
    const pct = await page.evaluate(() => ({
      n: document.querySelector('.rings-wh-pct').textContent,
      l: document.querySelector('.rings-wh-pctl').textContent,
    }));
    const phase = await page.evaluate(() => window.__fractonica.model.levelAt(window.__fractonica.store.t(), 6).phase);
    const flo = `${(Math.floor(phase * 1000 + 1e-7) / 10).toFixed(1)}`;
    check('% through is labelled "through this cycle"', pct.l === 'through this cycle', JSON.stringify(pct));
    check('% through is the floored phase', pct.n.replace(/\s| /g, '') === `${flo}%`, `${pct.n} vs ${flo}`);

    // hovering a ring: tooltip head carries the same wording
    const box = await page.locator('.rings-layer-live').boundingBox();
    const info = await page.evaluate(() => window.__fractonica.instances.rings.inspect());
    const r0 = info.layout.rings[2];
    await page.mouse.move(box.x + info.layout.cx, box.y + info.layout.cy - r0.mid);
    await page.waitForTimeout(250);
    const tip = await page.evaluate(() => { const t = document.querySelector('.rings-tip'); return t && !t.hidden ? t.innerText.replace(/\s+/g, ' ') : ''; });
    check('Ring tooltip says "through this cycle"', /through this cycle/.test(tip), tip);

    // out of range (the store clamps, so feed the module a frame outside the catalogue directly): no stale label
    await page.evaluate(() => {
      const { model } = window.__fractonica;
      window.__fractonica.instances.rings.render({ t: model.tMax + 10, inRange: false, level: () => null }, { dirty: true, dt: 0, t: model.tMax + 10, real: 0, view: 'rings' });
    });
    const outLabel = await page.evaluate(() => ({ l: document.querySelector('.rings-wh-pctl').textContent, p: document.querySelector('.rings-wh-pct').textContent, sub: document.querySelector('.rings-wh-sub').textContent }));
    check('Out of range: the % figure and its label are empty', outLabel.l === '' && outLabel.p === '', JSON.stringify(outLabel));
    check('no own console errors (desktop)', errors.filter((e) => /rings/.test(e)).length === 0, JSON.stringify(errors.filter((e) => /rings/.test(e))));
  },
  { viewport: { width: 1440, height: 900 } },
);

// ---------------------------------------------------------------------------------------------
// touch: tap previews, tap and hold previews without jumping
// ---------------------------------------------------------------------------------------------
await withApp(
  async ({ page, browser, url, errors }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const tp = await ctx.newPage();
    const errs = [];
    tp.on('pageerror', (e) => errs.push(e.message));
    await tp.goto(url(`?t=${T}&view=rings&zone=UTC&sel=3`));
    await tp.waitForTimeout(900);
    await tp.evaluate(() => window.__fractonica.store.pause?.());
    const cdp = await ctx.newCDPSession(tp);
    const dial = async () => {
      const i = await tp.evaluate(() => window.__fractonica.instances.rings.inspect());
      const b = await tp.locator('.rings-layer-live').boundingBox();
      return { i, b };
    };
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const tipText = () => tp.evaluate(() => { const t = document.querySelector('.rings-tip'); return t && !t.hidden ? t.innerText.replace(/\s+/g, ' ') : ''; });

    // a point on ring 5 (zeta, depth 6), at the middle of a sector that is not the running one
    const scrollDial = async () => {
      await tp.evaluate(() => document.querySelector('.rings-dialwrap').scrollIntoView({ block: 'center' }));
      await tp.waitForTimeout(150);
    };
    await scrollDial();
    const { i, b } = await dial();
    const ring = i.layout.rings[4];
    const lvRing = i.levels[4];
    const target = await tp.evaluate(({ L }) => {
      const { model, store } = window.__fractonica;
      const lv = model.levelAt(store.t(), L);
      const f = model.levelInfo(L).factor;
      const run = Math.min(f - 1, Math.floor(lv.phase * f));
      const j = (run + 2) % f;
      return { phase: (j + 0.5) / f };
    }, { L: lvRing });
    const ang = target.phase * Math.PI * 2;
    const px = b.x + i.layout.cx + ring.mid * Math.sin(ang);
    const py = b.y + i.layout.cy - ring.mid * Math.cos(ang);

    // 1. tap and hold
    const t0 = await clock(tp);
    await touch('touchStart', px, py);
    await tp.waitForTimeout(250);
    check('touch: nothing shown before the hold time', (await tipText()) === '');
    await tp.waitForTimeout(450);
    const heldTip = await tipText();
    await touch('touchEnd');
    await tp.waitForTimeout(250);
    const afterHold = await clock(tp);
    const stillTip = await tipText();
    check('touch: tap and hold shows the ring tooltip', /through this cycle/.test(heldTip) && /child cycle/.test(heldTip), heldTip);
    check('touch: the hold did not jump', Math.abs(afterHold - t0) < 1e-6, `${t0} -> ${afterHold}`);
    check('touch: the tooltip stays after the finger lifts', stillTip === heldTip && stillTip !== '');
    check('touch: the held ring is selected', (await dial()).i.selected === lvRing, String((await dial()).i.selected));

    // 2. a tap on the same sector now jumps (second tap)
    await touch('touchStart', px, py);
    await tp.waitForTimeout(80);
    await touch('touchEnd');
    await tp.waitForTimeout(300);
    const afterTap = await clock(tp);
    check('touch: a quick tap on the previewed sector then jumps', Math.abs(afterTap - t0) > 1, `${t0} -> ${afterTap}`);

    // 3. a first quick tap elsewhere only previews
    await setClock(tp, T);
    await scrollDial();
    const tapAt = { x: px, y: py };
    await touch('touchStart', tapAt.x, tapAt.y);
    await tp.waitForTimeout(80);
    await touch('touchEnd');
    await tp.waitForTimeout(300);
    const afterFirstTap = await clock(tp);
    check('touch: a first quick tap previews (no jump)', Math.abs(afterFirstTap - T) < 1e-6 && (await tipText()) !== '', `${afterFirstTap}`);

    // 4. a hold that slides is a scroll: no tooltip
    await tp.evaluate(() => { document.querySelector('.rings-tip').hidden = true; });
    await setClock(tp, T);
    await scrollDial();
    await touch('touchStart', px, py);
    await tp.waitForTimeout(100);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: px, y: py + 30 }] });
    await tp.waitForTimeout(650);
    const slidTip = await tipText();
    await touch('touchEnd');
    check('touch: a hold that slides away shows nothing', slidTip === '' || slidTip === stillTip, JSON.stringify(slidTip));

    // 5. chips on the mobile card jump back too
    await tp.evaluate(() => window.__fractonica.store.pause?.());
    await setClock(tp, T);
    await tp.evaluate(() => window.__fractonica.instances.rings && 0);
    const chip = tp.locator('.rings-chip[data-q="0"]');
    const before = await clock(tp);
    const wanted = await tp.evaluate(() => {
      const { model, store } = window.__fractonica;
      return model.levelAt(store.t(), store.state.selectedLevel).thresholds[1].time + 0.001;
    });
    await chip.click({ force: true });
    await tp.waitForTimeout(200);
    const after = await clock(tp);
    check('mobile: first chip jumps to its threshold + 1 ms', Math.abs(after - wanted) < 1e-3, `${before} -> ${after} want ${wanted}`);
    check('no own console errors (touch)', errs.filter((e) => /rings/.test(e)).length === 0, JSON.stringify(errs));
    await ctx.close();
  },
  { viewport: { width: 390, height: 844 } },
);

console.log(results.every(Boolean) ? 'ALL PASS' : `FAILED: ${results.filter((r) => !r).length}`);
process.exit(results.every(Boolean) ? 0 : 1);
