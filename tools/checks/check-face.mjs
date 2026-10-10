/**
 * Headless verification of the clock face module.
 *   node tools/checks/check-face.mjs            screenshots (tools/out/face-*.png) + interaction checks
 *
 * Exits non-zero when a check fails or when the page logs an error that comes from the face files.
 */
import path from 'node:path';
import { withApp, outDir } from '../browse.mjs';
import { scan, judge } from '../pure-scan.mjs';

const T_A = 1791460800; // SPEC vector A 2026-10-08T12:00:00Z
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? '  ' + detail : ''}`);
}
// An error is ours when the page error's stack runs through src/ui/face (any uncaught exception from face code,
// whatever its message says), or when a console error is tagged [face] (the app loop's isolation of a throwing render).
const ownError = (e) => /src\/ui\/face/.test(e) || /\[face\]/.test(e) || (/face/i.test(e) && !/rings|ladder|timeline|wave|calendar|sound|upnext|jump/i.test(e));

const api = (page) => ({
  state: () => page.evaluate(() => ({ ...window.__fractonica.store.state, t: window.__fractonica.store.t() })),
  face: (fn, ...args) => page.evaluate(([f, a]) => new Function('face', 'ctx', 'args', `return (${f})(face, ctx, args)`)(window.__fractonica.instances.face, window.__fractonica.ctx, a), [fn.toString(), args]),
  // logical screen coordinates -> client pixels
  client: (x, y) =>
    page.evaluate(([x, y]) => {
      const s = document.querySelector('.face-svg');
      const p = new DOMPoint(x, y).matrixTransform(s.getScreenCTM());
      return { x: p.x, y: p.y };
    }, [x, y]),
});

async function tapAt(page, f, x, y) {
  const p = await f.client(x, y);
  await page.mouse.click(p.x, p.y);
}

async function faceCard(page, shot, name) {
  const box = await page.locator('#slot-face').boundingBox();
  const file = await shot(name, { clip: box, fullPage: true });
  return file;
}

// ---- pure mode helpers ---------------------------------------------------------------------------
/**
 * Everything a user could see, hover or have read out in the given root(s): the scanner's collect() scoped to the
 * face card. With `all` it also lists what is hidden right now (opacity 0 overlays, a closed popover, a hidden
 * tooltip) - text that would show up later, so a stale string of the other mode must not hide there either.
 */
async function collectScoped(page, rootSel, { all = false } = {}) {
  return page.evaluate(
    ([rootSel, all]) => {
      const visible = (el) => {
        if (all) return true;
        if (!el.isConnected || el.closest('[hidden]')) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
      };
      const items = [];
      const add = (kind, text, el) => {
        const t = String(text ?? '').replace(/\s+/g, ' ').trim();
        if (!t) return;
        const where = (el.id ? '#' + el.id : '') + [...(el.classList ?? [])].slice(0, 2).map((c) => '.' + c).join('') || el.tagName.toLowerCase();
        items.push({ kind, text: t, where });
      };
      for (const root of document.querySelectorAll(rootSel)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const el = n.parentElement;
          if (!el || ['SCRIPT', 'STYLE'].includes(el.tagName) || !visible(el)) continue;
          add('text', n.nodeValue, el);
        }
        for (const el of [root, ...root.querySelectorAll('[title],[aria-label],[aria-description],[placeholder],[alt]')]) {
          if (!visible(el)) continue;
          for (const a of ['title', 'aria-label', 'aria-description', 'placeholder', 'alt']) if (el.hasAttribute(a)) add('attr:' + a, el.getAttribute(a), el);
        }
      }
      return items;
    },
    [rootSel, all],
  );
}
/** What only pure mode says: if any of it is found in normal mode something was left behind. */
const PURE_MARKERS = /fracton|[αβγδεζηθικλμνξ]#\d|\d[ηιλμνξ](?=\s|$|[,.;:)])|\d(?:δ|ε|ζ)½|solar rhythm|one sync|phase \d+ and \d+|of 256|one cycle =|count from [01]|for the glossary|\bbeat\b|SYNC \d/;

// ------------------------------------------------------------------------------------------------
await withApp(
  async ({ page, url, errors, shot, browser }) => {
    // the harness records only error messages: keep the stacks too, so errors can be attributed to a file
    page.on('pageerror', (e) => errors.push(`pageerror stack: ${e.stack || e.message}`));
    const f = api(page);
    const q = (t, extra = '') => `?t=${t}&view=rings&zone=UTC${extra}`;
    // other modules may be unfinished while this runs: keep the header from distorting the layout under test
    const open = async (query) => {
      await page.goto(url(query));
      await page.addStyleTag({ content: '#slot-jump{display:none!important;} #topbar{max-height:140px;overflow:hidden;}' });
      await page.waitForSelector('.face-svg .face-glyph path');
      await page.waitForFunction(() => !document.querySelector('.face-svg').classList.contains('is-pending')); // first reading drawn
    };

    // ---- 1. readings at the SPEC vectors -------------------------------------------------------
    await open(q(T_A));
    await page.waitForTimeout(700);
    const read = () =>
      page.evaluate(() => {
        const out = {};
        for (const k of ['top', 'solar', 'bottom']) {
          const row = document.querySelector(`.face-row--${k}`);
          out[k] = {
            d: [...row.querySelectorAll('.face-glyph path')].map((p) => p.getAttribute('d')),
            dots: [...row.querySelectorAll('.face-glyph circle')].map((c) => c.getAttribute('display') !== 'none'),
          };
          const dots = [...row.querySelectorAll('.face-dot')].filter((d) => d.getAttribute('display') !== 'none');
          out[k].counter = dots.length;
          out[k].lit = dots.filter((d) => d.classList.contains('is-lit')).length;
        }
        out.overlay = document.querySelector('.face-svg').dataset.overlay;
        out.letters = [...document.querySelectorAll('.face-letter')].map((e) => e.textContent);
        out.caption = document.querySelector('.face-caption').textContent;
        out.depths = document.querySelector('.face-depths').textContent;
        return out;
      });
    let r = await read();
    check('vector A: top odometer is depth 7 [13,0] (3 trits: -3 rising) with no dot', r.top.dots.join() === 'false,false', JSON.stringify(r.top.dots));
    check('vector A: bottom odometer depth 8 [5,4]: first glyph dotted (falling), second not', r.bottom.dots.join() === 'true,false', JSON.stringify(r.bottom.dots));
    check('vector A: solar digits [5,11,13] -> dots on 5 and 11 (falling), not 13', r.solar.dots.join() === 'true,true,false', JSON.stringify(r.solar.dots));
    check('vector A: top counter has 11 dots, 1 lit (local 0)', r.top.counter === 11 && r.top.lit === 1, `${r.top.counter}/${r.top.lit}`);
    check('vector A: bottom counter has 9 dots, 8 lit (local 7)', r.bottom.counter === 9 && r.bottom.lit === 8, `${r.bottom.counter}/${r.bottom.lit}`);
    check('letters show briefly on load', r.overlay === 'letters' && r.letters.join('') === 'ηθ', `${r.overlay} ${r.letters}`);
    check('caption shows the displayed time because time travel is not live', /2026-10-08 12:00:00 UTC/.test(r.caption), r.caption);
    check('depth readout', /η 7 · θ 8/.test(r.depths), r.depths);
    // glyph ink equals the library geometry
    const inkOk = await page.evaluate(() => {
      const { model } = window.__fractonica;
      const geo = (i) => model.F.CBT.geometry(model.F.CBT.fromIndex(i, { depth: 2 }), { scale: 10, thickness: 0.3 }).path;
      const top = [...document.querySelectorAll('.face-row--top .face-glyph path')].map((p) => p.getAttribute('d'));
      const od = model.odometerAt(model.tMin + 0, 6); // just to be sure the model is alive
      return top[0] === geo(13) && top[1] === geo(0) && !!od;
    });
    check('glyph paths are the library CBT.geometry paths', inkOk);

    await page.waitForTimeout(4300); // letters expire
    r = await read();
    check('letters disappear after ~4 s', r.overlay === 'none', r.overlay);
    console.log(await faceCard(page, shot, 'face-A.png'));

    // ---- 2. other instants + edges --------------------------------------------------------------
    const instants = [
      ['2000', 946684800, 'face-2000.png'],
      ['2061', 2886085800, 'face-2061.png'],
    ];
    for (const [name, t, file] of instants) {
      await page.evaluate((t) => window.__fractonica.store.setTime(t), t);
      await page.waitForTimeout(500);
      const rr = await read();
      check(`${name}: renders 2+3+2 glyphs and counters`, rr.top.d.length === 2 && rr.solar.d.length === 3 && rr.bottom.d.length === 2 && rr.top.counter > 0);
      await faceCard(page, shot, file);
    }
    // vector B and C digits
    await page.evaluate(() => window.__fractonica.store.setTime(946684800));
    await page.waitForTimeout(300);
    r = await read();
    const digitsB = await page.evaluate(() => {
      const { model } = window.__fractonica;
      const g = (i) => model.F.CBT.geometry(model.F.CBT.fromIndex(i, { depth: 2 }), { scale: 10, thickness: 0.3 }).path;
      return [...document.querySelectorAll('.face-row--top .face-glyph path')].map((p) => p.getAttribute('d')).join('|') === [g(5), g(6)].join('|');
    });
    check('vector B: top odometer shows [5,6]', digitsB);

    for (const [name, expr] of [
      ['tMin+5', 'model.tMin + 5'],
      ['tMax-5', 'model.tMax - 5'],
    ]) {
      await page.evaluate((e) => {
        const { model, store } = window.__fractonica;
        store.setTime(new Function('model', `return ${e}`)(model));
      }, expr);
      await page.waitForTimeout(400);
      const rr = await read();
      check(`${name}: period glyphs and counters render`, rr.top.d.length === 2 && rr.top.counter > 0 && rr.bottom.counter > 0);
      check(`${name}: solar odometer shows an explicit "not defined" state (the sync cycle leaves the catalogue)`, await page.evaluate(() => document.querySelector('.face-svg').classList.contains('is-solar-na')));
      await faceCard(page, shot, `face-${name.replace(/[^a-z0-9]/gi, '')}.png`);
    }

    // out of range: the shared store clamps, so drive the module directly with an out-of-range frame
    await page.evaluate(() => {
      const { model, instances } = window.__fractonica;
      const frame = model.frame(model.tMax + 10);
      window.__oorFrame = frame;
      // freeze the app loop's own rendering of the face by shadowing render
      const inst = instances.face;
      inst.__origRender = inst.render;
      inst.render = (fr, info) => inst.__origRender(window.__oorFrame, { ...info, dirty: true });
    });
    await page.waitForTimeout(500);
    const oor = await page.evaluate(() => ({
      cls: document.querySelector('.face-svg').classList.contains('is-oor'),
      text: [...document.querySelectorAll('.face-oor text')].map((t) => t.textContent).join(' | '),
    }));
    check('out of range: dimmed state with the catalogue range', oor.cls && /outside Saros 141/.test(oor.text) && /1613-05-19/.test(oor.text) && /2857-06-13/.test(oor.text), oor.text);
    await faceCard(page, shot, 'face-oor.png');
    await page.evaluate(() => {
      const inst = window.__fractonica.instances.face;
      inst.render = inst.__origRender;
    });
    await page.waitForTimeout(300);
    check('out of range: recovers when time is back inside', await page.evaluate(() => !document.querySelector('.face-svg').classList.contains('is-oor')));

    // ---- 3. interactions --------------------------------------------------------------------------
    await open(q(T_A));
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.__fractonica.store.set({ selectedLevel: 9, showLetters: false }));
    let s = await f.state();
    check('start: depth 7', s.topDepth === 7);

    await tapAt(page, f, 96, 20); // top region, outside the row
    s = await f.state();
    check('tap top region -> longer period (depth 6)', s.topDepth === 6, `topDepth=${s.topDepth}`);
    await page.waitForTimeout(250);
    r = await read();
    check('brief letters after a depth change (ζ η)', r.overlay === 'letters' && r.letters.join('') === 'ζη', `${r.overlay} ${r.letters}`);
    await tapAt(page, f, 96, 475); // bottom region
    s = await f.state();
    check('tap bottom region -> shorter period (depth 7)', s.topDepth === 7, `topDepth=${s.topDepth}`);
    await tapAt(page, f, 96, 475);
    check('tap bottom again -> depth 8', (await f.state()).topDepth === 8);
    for (let i = 0; i < 8; i++) await tapAt(page, f, 96, 475);
    s = await f.state();
    check('bottom taps clamp at depth 11', s.topDepth === 11, `topDepth=${s.topDepth}`);
    check('clamped tap shows a hint toast', await page.evaluate(() => !document.querySelector('#toast').hidden && /shortest/i.test(document.querySelector('#toast').textContent)));
    await page.waitForTimeout(120);
    check('"Shorter" button is aria-disabled at depth 11', (await page.getAttribute('.face-btn[data-act="shorter"]', 'aria-disabled')) === 'true');
    await faceCard(page, shot, 'face-depth11.png');
    for (let i = 0; i < 12; i++) await tapAt(page, f, 96, 14);
    s = await f.state();
    check('top taps clamp at depth 2', s.topDepth === 2, `topDepth=${s.topDepth}`);
    await faceCard(page, shot, 'face-depth2.png');
    await page.evaluate(() => window.__fractonica.store.set({ topDepth: 7 }));
    await page.waitForTimeout(100);

    // persistence
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fractonica-clock/v1')).topDepth);
    check('depth is persisted through store.set', stored === 7, String(stored));

    // info + double tap
    await page.waitForTimeout(4300);
    await tapAt(page, f, 96, 170); // middle (not on the solar row)
    await page.waitForTimeout(300);
    r = await read();
    check('single tap in the middle shows info labels', r.overlay === 'info', r.overlay);
    const info = await page.evaluate(() => [...document.querySelectorAll('.face-info text')].map((t) => t.textContent));
    console.log('     info labels:', info.join(' | '));
    check('info labels: threshold caption + local times', info.some((t) => /^NEXT /.test(t)) && info.filter((t) => /\d\d:\d\d/.test(t)).length === 3, info.join('|'));
    await faceCard(page, shot, 'face-info.png');
    await page.waitForTimeout(4300);
    r = await read();
    check('info labels disappear after ~4 s', r.overlay === 'none', r.overlay);
    await tapAt(page, f, 96, 170);
    await page.waitForTimeout(120);
    await tapAt(page, f, 96, 170);
    await page.waitForTimeout(300);
    s = await f.state();
    r = await read();
    check('double tap toggles persistent letters on', s.showLetters === true && r.overlay === 'letters', `${s.showLetters} ${r.overlay}`);
    await page.waitForTimeout(4400);
    r = await read();
    check('persistent letters stay after 4 s', r.overlay === 'letters');
    await faceCard(page, shot, 'face-letters.png');
    await tapAt(page, f, 96, 170);
    await page.waitForTimeout(100);
    await tapAt(page, f, 96, 170);
    await page.waitForTimeout(300);
    s = await f.state();
    check('double tap toggles letters off', s.showLetters === false);
    await page.waitForTimeout(500);
    // slow taps are two infos, not a double tap
    await tapAt(page, f, 96, 170);
    await page.waitForTimeout(550);
    await tapAt(page, f, 96, 170);
    s = await f.state();
    check('taps 550 ms apart do not toggle letters', s.showLetters === false);
    await page.waitForTimeout(4300);

    // keyboard
    await page.focus('.face-svg');
    await page.keyboard.press('ArrowUp');
    check('ArrowUp -> depth 6', (await f.state()).topDepth === 6);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    check('ArrowDown x2 -> depth 8', (await f.state()).topDepth === 8);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('i');
    await page.waitForTimeout(250);
    check('key i shows info', (await read()).overlay === 'info');
    await page.keyboard.press('l');
    await page.waitForTimeout(250);
    s = await f.state();
    check('key l toggles persistent letters', s.showLetters === true && (await read()).overlay === 'letters');
    await page.keyboard.press('l');
    check('key l again turns them off', (await f.state()).showLetters === false);

    // buttons
    await page.click('.face-btn[data-act="longer"]');
    check('button Longer -> depth 6', (await f.state()).topDepth === 6);
    await page.click('.face-btn[data-act="shorter"]');
    check('button Shorter -> depth 7', (await f.state()).topDepth === 7);
    await page.click('.face-btn[data-act="info"]');
    await page.waitForTimeout(250);
    check('button Info shows info labels', (await read()).overlay === 'info');
    await page.click('.face-btn[data-act="letters"]');
    await page.waitForTimeout(250);
    check('button Letters pins letters and aria-pressed follows', (await f.state()).showLetters === true && (await page.getAttribute('.face-btn[data-act="letters"]', 'aria-pressed')) === 'true');
    await page.click('.face-btn[data-act="letters"]');

    // selection by clicking a row (also steps)
    await page.waitForTimeout(4300);
    await page.evaluate(() => window.__fractonica.store.set({ selectedLevel: 2, topDepth: 7 }));
    await page.waitForTimeout(150);
    await tapAt(page, f, 96, 80); // top row = level 6
    s = await f.state();
    check('click top row selects its level (6) and steps the face (depth 6)', s.selectedLevel === 6 && s.topDepth === 6, `sel=${s.selectedLevel} depth=${s.topDepth}`);
    await page.waitForTimeout(250);
    // level 6 is now the bottom row -> accent there
    const sel1 = await page.evaluate(() => document.querySelector('.face-row.is-selected')?.dataset.row);
    check('the selected cycle stays on screen with an accent (bottom row)', sel1 === 'bottom', String(sel1));
    await tapAt(page, f, 96, 410); // bottom row = level 6 again, shorter
    s = await f.state();
    check('click bottom row selects its level (6), face steps back to depth 7', s.selectedLevel === 6 && s.topDepth === 7, `sel=${s.selectedLevel} depth=${s.topDepth}`);
    await page.waitForTimeout(200);
    check('accent moves to the top row', (await page.evaluate(() => document.querySelector('.face-row.is-selected')?.dataset.row)) === 'top');
    await page.evaluate(() => window.__fractonica.store.set({ selectedLevel: 0 }));
    await page.waitForTimeout(150);
    check('no accent when the selected level is not on screen', (await page.evaluate(() => !document.querySelector('.face-row.is-selected'))));

    // hover tooltip
    await page.waitForTimeout(100);
    const topc = await f.client(96, 80);
    await page.mouse.move(topc.x - 5, topc.y);
    await page.mouse.move(topc.x, topc.y);
    await page.waitForTimeout(200);
    let tip = await page.evaluate(() => {
      const t = document.querySelector('.face-tip');
      return { hidden: t.hidden, text: t.innerText };
    });
    check('hover on the top row shows a teaching tooltip', !tip.hidden && /State 13 of 16: value −3, rising ↗/.test(tip.text) && /depth 7/.test(tip.text), tip.text.replace(/\n/g, ' / '));
    await shot('face-tip.png');
    const solarc = await f.client(96, 245);
    await page.mouse.move(solarc.x, solarc.y);
    await page.waitForTimeout(250);
    tip = await page.evaluate(() => ({ hidden: document.querySelector('.face-tip').hidden, text: document.querySelector('.face-tip').innerText }));
    check('hover on the solar row shows sync number, phase, drift, next quarter', !tip.hidden && /Solar sync #4820/.test(tip.text) && /Phase 35\.8 %/.test(tip.text) && /Drift/.test(tip.text) && /Next node/.test(tip.text), tip.text.replace(/\n/g, ' / '));
    const ringc = await f.client(96, 13); // over the counter arc of the top period
    await page.mouse.move(ringc.x - 4, ringc.y);
    await page.mouse.move(ringc.x, ringc.y);
    await page.waitForTimeout(200);
    tip = await page.evaluate(() => ({ hidden: document.querySelector('.face-tip').hidden, text: document.querySelector('.face-tip').innerText }));
    check('hover on a counter arc explains the cycle number (Cycle n of m in its parent)', !tip.hidden && /Cycle \d+ of 11 in its ζ/.test(tip.text), tip.text.replace(/\n/g, ' / '));
    await page.mouse.move(solarc.x, solarc.y - 100 + 40); // y=185: middle region, no row
    await page.mouse.move(solarc.x, solarc.y - 60);
    await page.waitForTimeout(700);
    tip = await page.evaluate(() => ({ hidden: document.querySelector('.face-tip').hidden, text: document.querySelector('.face-tip').innerText }));
    check('resting on empty screen shows a gesture hint', !tip.hidden && /info/i.test(tip.text), tip.text.replace(/\n/g, ' / '));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    check('tooltip hides when the pointer leaves', await page.evaluate(() => document.querySelector('.face-tip').hidden));

    // keyboard focus on rows
    await page.evaluate(() => document.querySelector('.face-svg').focus());
    await page.keyboard.press('Tab');
    const focusedRow = await page.evaluate(() => document.activeElement?.dataset?.row);
    check('Tab moves focus to the first glyph row', focusedRow === 'top', String(focusedRow));
    await page.waitForTimeout(150);
    check('a focused row shows its tooltip', await page.evaluate(() => !document.querySelector('.face-tip').hidden));
    await shot('face-focus.png');
    await page.keyboard.press('Enter');
    check('Enter on a focused row selects that level', (await f.state()).selectedLevel === 6);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    check('rows have accessible names', await page.evaluate(() => [...document.querySelectorAll('.face-row')].every((e) => /\w/.test(e.getAttribute('aria-label') || ''))));

    // popover
    await page.click('.face-help');
    await page.waitForTimeout(250);
    check('How to read opens (aria-expanded)', (await page.getAttribute('.face-help', 'aria-expanded')) === 'true' && (await page.isVisible('.face-pop')));
    check('popover has 5 lines and 3 mini glyphs', (await page.locator('.face-pop-list li').count()) === 5 && (await page.locator('.face-mini').count()) === 3);
    await faceCard(page, shot, 'face-popover.png');
    await page.keyboard.press('Escape');
    check('Escape closes the popover and returns focus to the button', !(await page.isVisible('.face-pop')) && (await page.evaluate(() => document.activeElement?.classList.contains('face-help'))));
    await page.click('.face-help');
    await page.mouse.click(900, 500);
    check('clicking outside closes the popover', !(await page.isVisible('.face-pop')));

    // ---- 4. modes: live, time-lapse ------------------------------------------------------------------
    await open('?view=rings&zone=UTC');
    await page.waitForTimeout(900);
    r = await read();
    check('live mode: no caption under the pill', r.caption === '', JSON.stringify(r.caption));
    await faceCard(page, shot, 'face-live.png');
    const liveNow = await page.evaluate(() => {
      const { model, store } = window.__fractonica;
      const od = model.odometerAt(store.t(), 6);
      const g = (i) => model.F.CBT.geometry(model.F.CBT.fromIndex(i, { depth: 2 }), { scale: 10, thickness: 0.3 }).path;
      const top = [...document.querySelectorAll('.face-row--top .face-glyph path')].map((p) => p.getAttribute('d'));
      return top[0] === g(od.digits[0]);
    });
    check('live mode: top glyph matches the model for the device clock', liveNow);

    await open(q(T_A, '&rate=3600'));
    const before = await read();
    await page.waitForTimeout(2500);
    const after = await read();
    check('time-lapse x3600: glyphs advance', JSON.stringify(before.bottom.d) !== JSON.stringify(after.bottom.d));
    check('time-lapse: caption follows the displayed time', /2026-10-08 1[2-9]|2026-10-08 2|2026-10-09/.test(after.caption), after.caption);
    await faceCard(page, shot, 'face-lapse.png');

    // ---- 4b. tick cue: one short fade after a calm change, never in time-lapse; none under reduced motion ----------------
    const cueAnims = () => page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('#slot-face')).length);
    await open(q(T_A));
    await page.waitForTimeout(1800); // the glyphs have been still longer than the cue's calm period
    await page.evaluate(() => window.__fractonica.store.setTime(window.__fractonica.store.t() + 1900)); // changes glyphs
    // the cue lasts ~160 ms: poll every frame so a slow machine cannot miss it
    const cueSeen = await page
      .waitForFunction(() => document.getAnimations().some((a) => a.effect?.target?.closest?.('#slot-face')), null, { timeout: 1500, polling: 'raf' })
      .then(() => true, () => false);
    check('tick cue: a glyph that changes after a calm period fades in once', cueSeen);
    await page.waitForTimeout(500);
    check('tick cue: it is over within half a second (no lingering dim glyph)', (await cueAnims()) === 0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(q(T_A));
    await page.waitForTimeout(1800);
    await page.evaluate(() => window.__fractonica.store.setTime(window.__fractonica.store.t() + 1900));
    await page.click('.face-btn[data-act="longer"]');
    await page.waitForTimeout(80);
    check('prefers-reduced-motion: no animations or transitions run inside the face', (await cueAnims()) === 0, `animations=${await cueAnims()}`);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // time-lapse: glyphs change faster than the cue lasts, so none of them may strobe (opacity stays 1)
    for (const [label, query, sel] of [
      ['x3600, depth 7, top coarse glyph', q(T_A, '&rate=3600&depth=7'), '.face-row--top .face-glyph'],
      ['x3600, depth 7, solar middle glyph', q(T_A, '&rate=3600&depth=7'), '.face-row--solar .face-glyph:nth-child(2)'],
      ['x86400, depth 5, solar left glyph', q(T_A, '&rate=86400&depth=5'), '.face-row--solar .face-glyph'],
    ]) {
      await open(query);
      await page.waitForTimeout(3500);
      const dim = await page.evaluate(
        (sel) =>
          new Promise((resolve) => {
            const el = document.querySelector(sel);
            let frames = 0;
            let dimmed = 0;
            let changes = 0;
            let last = el.querySelector('path').getAttribute('d');
            const tick = () => {
              if (+getComputedStyle(el).opacity < 0.99) dimmed++;
              const d = el.querySelector('path').getAttribute('d');
              if (d !== last) (changes++, (last = d));
              if (++frames < 150) requestAnimationFrame(tick);
              else resolve({ dimmed, changes });
            };
            requestAnimationFrame(tick);
          }),
        sel,
      );
      check(`time-lapse ${label}: glyph never dims (${dim.changes} changes in 150 frames)`, dim.dimmed === 0 && dim.changes > 0, JSON.stringify(dim));
    }

    // ---- 5. render cost --------------------------------------------------------------------------------
    for (const [label, query] of [
      ['live', '?view=rings&zone=UTC'],
      ['time-lapse x3600', q(T_A, '&rate=3600')],
      ['time-lapse x31.6M (1 y/s)', q(T_A, '&rate=31557600')],
      ['frozen', q(T_A)],
    ]) {
      await open(query);
      await page.waitForTimeout(500);
      const ms = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const inst = window.__fractonica.instances.face;
            const orig = inst.render;
            const times = [];
            inst.render = (...a) => {
              const t0 = performance.now();
              orig(...a);
              times.push(performance.now() - t0);
              if (times.length >= 150) {
                inst.render = orig;
                const sorted = [...times].sort((a, b) => a - b);
                resolve({ mean: times.reduce((x, y) => x + y, 0) / times.length, p95: sorted[Math.floor(times.length * 0.95)], max: sorted.at(-1) });
              }
            };
          }),
      );
      check(`render() cost, ${label}: mean ${ms.mean.toFixed(3)} ms, p95 ${ms.p95.toFixed(3)} ms, max ${ms.max.toFixed(2)} ms`, ms.mean < 1 && ms.p95 < 3);
    }

    // ---- 6. time zone follows the formatter -------------------------------------------------------------
    await open(`?t=${T_A}&view=rings&zone=Asia/Tokyo`);
    await page.waitForTimeout(500);
    await page.click('.face-btn[data-act="info"]');
    await page.waitForTimeout(300);
    const tokyo = await page.evaluate(() => ({ cap: document.querySelector('.face-caption').textContent, info: [...document.querySelectorAll('.face-info text')].map((t) => t.textContent) }));
    check('zone: caption and labels use the selected zone (Tokyo = UTC+9)', /2026-10-08 21:00:00 UTC\+09:00/.test(tokyo.cap), tokyo.cap);

    // ---- 7. mobile ------------------------------------------------------------------------------------------
    await page.setViewportSize({ width: 390, height: 844 });
    await open(q(T_A));
    await page.waitForTimeout(800);
    const faceOverflow = () =>
      page.evaluate(() => {
        const card = document.querySelector('#slot-face').getBoundingClientRect();
        let worst = 0;
        for (const e of document.querySelectorAll('#slot-face *')) {
          if (e.closest('.face-pop[hidden], .face-tip[hidden]')) continue;
          const r = e.getBoundingClientRect();
          if (r.width) worst = Math.max(worst, r.right - card.right, card.left - r.left);
        }
        return { worst, cardRight: card.right, innerW: innerWidth };
      });
    const mob = await page.evaluate(() => {
      const c = document.querySelector('#slot-face').getBoundingClientRect();
      const s = document.querySelector('.face-svg').getBoundingClientRect();
      return { card: [c.width, c.height], svg: [s.width, s.height] };
    });
    const ov = await faceOverflow();
    check('mobile 390: nothing in the face card overflows the card or the viewport', ov.worst <= 0.5 && ov.cardRight <= ov.innerW, JSON.stringify(ov));
    check('mobile 390: pill height is sensible (<= 600) and inside the card', mob.svg[1] <= 600 && mob.svg[0] <= mob.card[0], JSON.stringify(mob.svg));
    await shot('face-mobile.png', { fullPage: true });
    await faceCard(page, shot, 'face-mobile-card.png');
    // touch tap on the top region
    const ctx2 = await page.context();
    await page.setViewportSize({ width: 360, height: 640 });
    await open(q(T_A));
    await page.waitForTimeout(600);
    const m2 = await faceOverflow();
    check('mobile 360: nothing in the face card overflows', m2.worst <= 0.5 && m2.cardRight <= m2.innerW, JSON.stringify(m2));
    await faceCard(page, shot, 'face-mobile360.png');
    await page.setViewportSize({ width: 800, height: 900 });
    await open(q(T_A));
    await page.waitForTimeout(600);
    await faceCard(page, shot, 'face-tablet.png');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await open(q(T_A));
    await page.waitForTimeout(600);
    await faceCard(page, shot, 'face-1920.png');
    void ctx2;

    // ---- 8. touch: tap steps, press-and-hold teaches ---------------------------------------------------
    {
      const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, colorScheme: 'dark' });
      const tp = await tctx.newPage();
      tp.on('pageerror', (e) => errors.push('pageerror(touch) stack: ' + (e.stack || e.message)));
      tp.on('console', (m) => m.type() === 'error' && errors.push('console.error(touch): ' + m.text()));
      await tp.goto(url(q(T_A)));
      await tp.addStyleTag({ content: '#slot-jump{display:none!important;} #topbar{max-height:140px;overflow:hidden;}' });
      await tp.waitForSelector('.face-svg .face-glyph path');
      await tp.waitForTimeout(600);
      await tp.locator('.face-svg').scrollIntoViewIfNeeded();
      const tf = api(tp);
      const tdepth = () => tp.evaluate(() => window.__fractonica.store.state.topDepth);
      const cdp = await tctx.newCDPSession(tp);
      const touch = async (x, y, holdMs = 40) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await tp.waitForTimeout(holdMs);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      const p1 = await tf.client(96, 20);
      await touch(p1.x, p1.y);
      await tp.waitForTimeout(150);
      check('touch: tap on the top region steps to a longer period', (await tdepth()) === 6, String(await tdepth()));
      const p2 = await tf.client(96, 410);
      await touch(p2.x, p2.y);
      await tp.waitForTimeout(150);
      check('touch: tap on the bottom region steps back', (await tdepth()) === 7, String(await tdepth()));
      const p3 = await tf.client(96, 245);
      await touch(p3.x, p3.y);
      await tp.waitForTimeout(250);
      check('touch: tap in the middle shows info', (await tp.evaluate(() => document.querySelector('.face-svg').dataset.overlay)) === 'info');
      await tp.waitForTimeout(4300);
      const p4 = await tf.client(96, 410);
      await touch(p4.x, p4.y, 700);
      await tp.waitForTimeout(150);
      const held = await tp.evaluate(() => ({ hidden: document.querySelector('.face-tip').hidden, text: document.querySelector('.face-tip').innerText, depth: window.__fractonica.store.state.topDepth }));
      check('touch: press and hold on a row shows its tooltip without stepping', !held.hidden && /depth 8/.test(held.text) && held.depth === 7, `${held.depth} ${held.text.slice(0, 30)}`);
      await tp.screenshot({ path: path.join(outDir, 'face-touch-hold.png') });
      await tp.waitForTimeout(3000);
      check('touch: the held tooltip fades away on its own', await tp.evaluate(() => document.querySelector('.face-tip').hidden));
      const sizeInfo = await tp.evaluate(() => {
        const r = document.querySelector('.face-svg').getBoundingClientRect();
        return { w: r.width, h: r.height, dpr: devicePixelRatio };
      });
      check('touch: 3x display, pill sized to whole device pixels or exact fit', sizeInfo.dpr === 3 && sizeInfo.h > 300, JSON.stringify(sizeInfo));
      // a hold that turns into a scroll (pointercancel) must not leave the viewport-fixed tooltip behind
      const tipHidden = () => tp.evaluate(() => document.querySelector('.face-tip').hidden);
      const touchStart = (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      const touchEnd = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const touchMove = (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      await tp.evaluate(() => scrollTo(0, 0));
      await tp.locator('.face-svg').scrollIntoViewIfNeeded();
      const h1 = await tf.client(96, 410);
      await touchStart(h1.x, h1.y);
      await tp.waitForTimeout(650);
      const shown1 = !(await tipHidden());
      for (let i = 1; i <= 8; i++) {
        await touchMove(h1.x, h1.y - i * 25);
        await tp.waitForTimeout(16);
      }
      await touchEnd();
      await tp.waitForTimeout(300);
      const scrolled = await tp.evaluate(() => scrollY);
      check('touch: a hold that turns into a scroll hides its tooltip (no tooltip pinned over other controls)', shown1 && (await tipHidden()) && scrolled > 50, `shown=${shown1} scrollY=${scrolled}`);
      await tp.waitForTimeout(3000);
      check('touch: ... and it stays hidden', await tipHidden());
      // the browser cancelling the pointer (without any scroll) hides it too
      const hc = await tf.client(96, 410);
      await touchStart(hc.x, hc.y);
      await tp.waitForTimeout(650);
      const shownC = !(await tipHidden());
      await tp.evaluate(() => document.querySelector('.face-svg').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'touch', bubbles: true })));
      await tp.waitForTimeout(100);
      check('touch: pointercancel while a tooltip is held hides it', shownC && (await tipHidden()));
      await touchEnd();
      await tp.waitForTimeout(200);
      // the next touch dismisses a held tooltip even when it lands on the middle region or elsewhere
      await tp.evaluate(() => scrollTo(0, 0));
      await tp.locator('.face-svg').scrollIntoViewIfNeeded();
      const h2 = await tf.client(96, 410);
      await touchStart(h2.x, h2.y);
      await tp.waitForTimeout(650);
      await touchEnd();
      const shown2 = !(await tipHidden());
      await tp.waitForTimeout(400);
      const mid = await tf.client(96, 170);
      await touchStart(mid.x, mid.y);
      await tp.waitForTimeout(40);
      await touchEnd();
      await tp.waitForTimeout(150);
      check('touch: a tap in the middle after a hold dismisses the held tooltip at once', shown2 && (await tipHidden()));
      // a page scroll without touching the face hides it too
      const h3 = await tf.client(96, 410);
      await touchStart(h3.x, h3.y);
      await tp.waitForTimeout(650);
      await touchEnd();
      await tp.evaluate(() => scrollBy(0, 50));
      await tp.waitForTimeout(250);
      check('touch: scrolling the page hides a held tooltip', await tipHidden());
      await tp.evaluate(() => document.querySelector('.face-help').click());
      const targets = await tp.evaluate(() => {
        const h = document.querySelector('.face-help').getBoundingClientRect();
        const c = document.querySelector('.face-pop-close').getBoundingClientRect();
        return { help: h.height, closeW: c.width, closeH: c.height };
      });
      check('touch: the footer button and the dialog close button are at least 40 px', targets.help >= 40 && targets.closeW >= 40 && targets.closeH >= 40, JSON.stringify(targets));
      await tctx.close();
    }

    // ---- 8b. DOM wiring against independently derived values (model + fmt, read in the page) -----------------------
    // Instants x zones. Expected strings come from model/fmt, never from the face's own helpers.
    const berlinDst = Date.UTC(2026, 9, 25, 0, 30) / 1000; // 02:30 CEST, the hour that repeats
    const wiring = [
      [T_A, 'UTC'],
      [T_A, 'Asia/Tokyo'],
      [946684800, 'America/New_York'],
      [2886085800, 'Europe/Berlin'],
      [berlinDst, 'Europe/Berlin'],
      [1784000123.5, 'Asia/Kolkata'],
      [1234567890, 'Australia/Lord_Howe'],
    ];
    await open(q(T_A));
    for (const [t, zone] of wiring) {
      await page.evaluate(([t, zone]) => {
        const { store } = window.__fractonica;
        store.set({ zone, topDepth: 7, selectedLevel: 6, showLetters: false });
        store.setTime(t);
      }, [t, zone]);
      await page.waitForTimeout(250);
      await page.click('.face-btn[data-act="info"]');
      await page.waitForTimeout(350);
      const got = await page.evaluate(() => [...document.querySelectorAll('.face-info text')].map((e) => e.textContent));
      const want = await page.evaluate(() => {
        const { model, store, fmt } = window.__fractonica;
        const t = store.t();
        const lv = model.levelAt(t, 6);
        let sol = null;
        try {
          sol = model.solarAt(t);
        } catch {}
        return [
          `NEXT ${lv.next.name.toUpperCase()}`,
          lv.next.time != null ? fmt.label(lv.next.time, t) : '\u2014',
          sol ? `NEXT ${sol.threshold.name.toUpperCase()}` : 'SOLAR SYNC',
          sol ? fmt.label(sol.threshold.time, t) : '\u2014',
          'SYNC TIME',
          sol ? fmt.label(sol.start, t) : '\u2014',
        ];
      });
      check(`info labels @${t} ${zone} equal model + fmt (next threshold, next solar threshold, sync START)`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) + ' vs ' + JSON.stringify(want));
      await page.waitForTimeout(100);
    }
    {
      // the solar rows carry the date (SPEC §8: "Mon D HH:MM" when on another day) and the sync time is the sync START
      await page.evaluate(() => {
        const { store } = window.__fractonica;
        store.set({ zone: 'UTC' });
        store.setTime(1791460800);
      });
      await page.click('.face-btn[data-act="info"]');
      await page.waitForTimeout(350);
      const sv = await page.evaluate(() => [...document.querySelectorAll('.face-info text')].map((e) => e.textContent));
      check('info labels: solar threshold and sync time show "Mon D HH:MM" (they fall on other days)', /^[A-Z][a-z]{2} \d{1,2} \d\d:\d\d$/.test(sv[3]) && /^[A-Z][a-z]{2} \d{1,2} \d\d:\d\d$/.test(sv[5]) && sv[5] !== sv[3], sv.join('|'));
    }

    // sibling counters: every dot where the spec puts it (radius 86 on the screen-end arcs, 11.5 degree step), lit through the current cycle
    const dotsOk = async (t) => {
      await page.evaluate((t) => window.__fractonica.store.setTime(t), t);
      await page.waitForTimeout(250);
      return page.evaluate(() => {
        const { model, store } = window.__fractonica;
        const t = store.t();
        const depth = store.state.topDepth;
        const problems = [];
        for (const [kind, level] of [
          ['top', depth - 1],
          ['bottom', depth],
        ]) {
          const lv = model.levelAt(t, level);
          const dots = [...document.querySelectorAll(`.face-row--${kind} .face-dot`)].filter((d) => d.getAttribute('display') !== 'none');
          if (dots.length !== lv.siblings) problems.push(`${kind}: ${dots.length} dots, want ${lv.siblings}`);
          dots.forEach((d, i) => {
            const a = ((i - (lv.siblings - 1) / 2) * 11.5 * Math.PI) / 180;
            const wx = 96 + 86 * Math.sin(a);
            const wy = kind === 'top' ? 96 - 86 * Math.cos(a) : 394 + 86 * Math.cos(a);
            if (Math.abs(+d.getAttribute('cx') - wx) > 0.01 || Math.abs(+d.getAttribute('cy') - wy) > 0.01) problems.push(`${kind} dot ${i} at ${d.getAttribute('cx')},${d.getAttribute('cy')} want ${wx.toFixed(2)},${wy.toFixed(2)}`);
            if (d.classList.contains('is-lit') !== i <= lv.local) problems.push(`${kind} dot ${i} lit=${d.classList.contains('is-lit')}`);
            if (d.classList.contains('is-now') !== (i === lv.local)) problems.push(`${kind} dot ${i} now=${d.classList.contains('is-now')}`);
          });
          const ys = dots.map((d) => +d.getAttribute('cy'));
          if (kind === 'top' ? !ys.every((y) => y < 245) : !ys.every((y) => y > 245)) problems.push(`${kind} counter is on the wrong end of the screen`);
        }
        return problems;
      });
    };
    for (const depthNow of [7, 4, 11]) {
      await page.evaluate((d) => window.__fractonica.store.set({ topDepth: d }), depthNow);
      for (const t of [T_A, 946684800.4, 2886085800]) {
        const bad = await dotsOk(t);
        check(`counter dots @${t} depth ${depthNow}: positions, lit and current dot equal the model`, bad.length === 0, bad.join('; '));
      }
    }
    await page.evaluate(() => window.__fractonica.store.set({ topDepth: 7 }));

    // tooltips: every line against model + fmt (rows, counter arcs, solar)
    await page.evaluate(() => {
      const { store } = window.__fractonica;
      store.set({ zone: 'Europe/Berlin', topDepth: 7 });
      store.setTime(1791460800);
    });
    await page.waitForTimeout(300);
    const tipAt = async (x, y) => {
      const c = await f.client(x, y);
      await page.mouse.move(c.x - 3, c.y);
      await page.mouse.move(c.x, c.y);
      await page.waitForTimeout(300);
      return page.evaluate(() => ({ hidden: document.querySelector('.face-tip').hidden, lines: [...document.querySelector('.face-tip').querySelectorAll('b, .face-tip-l')].map((e) => e.textContent) }));
    };
    for (const [row, x, y] of [
      ['top', 96, 80],
      ['bottom', 96, 410],
      ['top', 96, 13],
      ['bottom', 96, 477],
    ]) {
      const got = await tipAt(x, y);
      const want = await page.evaluate(([row]) => {
        const { model, store, fmt } = window.__fractonica;
        const t = store.t();
        const level = row === 'top' ? store.state.topDepth - 1 : store.state.topDepth;
        const lv = model.levelAt(t, level);
        const od = model.odometerAt(t, level, { strokes: 2, digits: 2 });
        const major = model.odometerAt(t, level, { digits: 1 });
        const info = model.levelInfo(level);
        return {
          title: `${info.letter} \u00b7 depth ${level + 1}`,
          state: `State ${od.digits[0]} of 16: `,
          fine: `Right (fine) glyph: state ${od.digits[1]} of 16, changes at ${fmt.label(od.nextTime, t)}`,
          next: `Next change ${fmt.label(major.nextTime, t)} (`,
          cycle: `Cycle ${lv.local + 1} of ${lv.siblings} in its ${model.levelInfo(level - 1).letter} \u00b7 ends ${fmt.label(lv.end, t)}`,
        };
      }, [row]);
      const ok = !got.hidden && got.lines[0] === want.title && got.lines[1].startsWith(want.state) && got.lines.includes(want.fine) && got.lines.some((l) => l.startsWith(want.next)) && got.lines.includes(want.cycle);
      check(`tooltip (${row}, ${y < 100 || y > 400 ? 'row or arc' : 'row'} at y=${y}): title, state, fine glyph, next change, cycle number and end equal model + fmt`, ok, JSON.stringify(got.lines) + ' vs ' + JSON.stringify(want));
    }
    {
      const got = await tipAt(96, 245);
      const want = await page.evaluate(() => {
        const { model, store, fmt } = window.__fractonica;
        const t = store.t();
        const s = model.solarAt(t);
        const pct = (Math.floor(s.phase * 1000 + 1e-7) / 10).toFixed(1); // floored, like the rings text
        return [`Solar sync #${s.sync}`, `Phase ${pct} % of this 4-day sync`, `Next ${s.threshold.name} ${fmt.label(s.threshold.time, t)}`, `Sync time ${fmt.label(s.start, t)}`];
      });
      const ok = !got.hidden && got.lines[0] === want[0] && want.slice(1).every((w, i) => (i === 0 ? got.lines.includes(w) : got.lines.includes(w))) && got.lines.some((l) => /^Drift against civil days [+\u2212]?\d/.test(l));
      check('tooltip (solar): sync number, phase, next quarter, sync time and drift equal model + fmt', ok, JSON.stringify(got.lines) + ' vs ' + JSON.stringify(want));
    }
    await page.mouse.move(5, 5);
    await page.evaluate(() => window.__fractonica.store.set({ zone: 'UTC' }));

    // ---- 8c. regressions of reviewed bugs ---------------------------------------------------------------------------
    // a press that starts on the face and ends elsewhere is not a tap, and leaves no stale press behind
    await open(q(T_A, '&depth=7'));
    {
      const c = await f.client(96, 20);
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(1000, 600);
      await page.mouse.up();
      await page.mouse.move(900, 780);
      await page.mouse.down();
      await page.mouse.move(c.x, c.y);
      await page.mouse.up();
      check('a press started elsewhere and released over the face is not a tap', (await f.state()).topDepth === 7, String((await f.state()).topDepth));
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(1000, 600);
      await page.mouse.move(c.x, c.y);
      await page.mouse.up();
      check('leaving the face during a press cancels the tap', (await f.state()).topDepth === 7);
      await page.mouse.down();
      await page.mouse.up();
      check('a plain click still steps afterwards', (await f.state()).topDepth === 6);
    }
    // the gesture hint disappears once its click has changed the depth, and with the keyboard / buttons too
    {
      await page.evaluate(() => window.__fractonica.store.set({ topDepth: 7 }));
      const c = await f.client(96, 138);
      await page.mouse.move(c.x - 3, c.y);
      await page.mouse.move(c.x, c.y);
      await page.waitForTimeout(700);
      const before = await page.evaluate(() => ({ hidden: document.querySelector('.face-tip').hidden, text: document.querySelector('.face-tip').innerText, swatch: !document.querySelector('.face-tip-sw').hidden }));
      check('region hint names the target depth and carries no colour dot', !before.hidden && /top becomes ζ, depth 6/.test(before.text) && !before.swatch, before.text);
      await page.mouse.move(c.x + 2, c.y + 2);
      await page.waitForTimeout(80);
      check('region hint survives a couple of pixels of pointer jitter', await page.evaluate(() => !document.querySelector('.face-tip').hidden));
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(80);
      check('region hint is hidden after the click it described', await page.evaluate(() => document.querySelector('.face-tip').hidden));
      await page.mouse.move(c.x + 1, c.y + 30);
      await page.mouse.move(c.x, c.y + 32);
      await page.waitForTimeout(700);
      await page.click('.face-btn[data-act="shorter"]');
      await page.waitForTimeout(80);
      check('region hint is hidden after a depth change by button too', await page.evaluate(() => document.querySelector('.face-tip').hidden));
      await page.mouse.move(5, 5);
    }
    // the row hint says what a click does
    {
      await page.evaluate(() => window.__fractonica.store.set({ topDepth: 7 }));
      const c = await f.client(96, 80);
      await page.mouse.move(c.x - 3, c.y);
      await page.mouse.move(c.x, c.y);
      await page.waitForTimeout(300);
      const text = await page.evaluate(() => document.querySelector('.face-tip').innerText);
      check('row tooltip hint: a click selects and shows longer periods', /Click or tap: select this cycle in every view and show longer periods/.test(text), text.replace(/\n/g, ' / '));
      await page.mouse.move(5, 5);
    }
    // a click event with no pointer behind it (assistive technology) activates rows
    await page.evaluate(() => window.__fractonica.store.set({ topDepth: 7, selectedLevel: 2 }));
    await page.evaluate(() => document.querySelector('.face-row--bottom').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    check('a bare click event on a glyph row selects its level (assistive technology)', (await f.state()).selectedLevel === 7 && (await f.state()).topDepth === 7);
    // chained taps in the middle
    {
      await page.evaluate(() => window.__fractonica.store.set({ showLetters: false }));
      const c = await f.client(96, 170);
      const letters = async () => (await f.state()).showLetters;
      await page.mouse.click(c.x, c.y);
      await page.waitForTimeout(100);
      await page.mouse.click(c.x, c.y);
      await page.waitForTimeout(100);
      const on = await letters();
      await page.mouse.click(c.x, c.y);
      await page.waitForTimeout(60);
      check('double tap toggles letters on, and a quick third tap does not toggle them back', on === true && (await letters()) === true);
      await page.waitForTimeout(600);
      await page.evaluate(() => window.__fractonica.store.set({ showLetters: false }));
    }
    // info labels are announced
    await open(q(T_A));
    await page.click('.face-btn[data-act="info"]');
    await page.waitForTimeout(300);
    {
      const said = await page.evaluate(() => document.querySelector('#slot-face [role=status]').textContent);
      check('Info announces the labels in the live region', /^Next \w+ of the top period: .+ Next \w+ of the solar sync: .+ Sync time: .+/.test(said), said);
    }
    // keyboard: the focused row's tooltip is its description
    await page.focus('.face-svg');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    {
      const d = await page.evaluate(() => {
        const r = document.activeElement;
        const id = r.getAttribute('aria-describedby');
        const tip = id && document.getElementById(id);
        return { row: r.dataset.row, id, hidden: tip?.hidden, hint: tip?.querySelector('.face-tip-hint')?.textContent };
      });
      check('a keyboard-focused row is described by its tooltip, whose hint names Enter', d.row === 'top' && !!d.id && d.hidden === false && /^Enter:/.test(d.hint), JSON.stringify(d));
      await page.keyboard.press('Tab');
      check('moving focus removes the description again', await page.evaluate(() => !document.querySelector('.face-row--top').hasAttribute('aria-describedby')));
    }
    // the dialog keeps its keys to itself (Space must not start the time-lapse)
    await page.click('.face-help');
    await page.keyboard.press('Space');
    await page.keyboard.press('3');
    await page.waitForTimeout(150);
    {
      const st = await page.evaluate(() => ({ rate: window.__fractonica.store.rate, view: window.__fractonica.store.state.view }));
      check('keys typed in the How to read dialog do not reach the global shortcuts', st.rate === 0 && st.view === 'rings', JSON.stringify(st));
      await page.keyboard.press('Escape');
      check('... and Escape still closes the dialog', await page.evaluate(() => document.querySelector('.face-pop').hidden));
    }
    // out of the catalogue and back: the accent and labels return
    await open('?view=rings&zone=UTC&depth=7&sel=7');
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.__realNow = Date.now;
      Date.now = () => 29e9 * 1000;
    });
    await page.waitForTimeout(300);
    {
      const oorNow = await page.evaluate(() => ({ oor: document.querySelector('.face-svg').classList.contains('is-oor'), label: document.querySelector('.face-svg').getAttribute('aria-label'), sel: !!document.querySelector('.face-row.is-selected') }));
      check('out of range (device clock): label says so, no accent', oorNow.oor && /outside the Saros 141 catalogue/.test(oorNow.label) && !oorNow.sel, JSON.stringify(oorNow));
      await page.evaluate(() => (Date.now = window.__realNow));
      await page.waitForTimeout(300);
      const back = await page.evaluate(() => ({ oor: document.querySelector('.face-svg').classList.contains('is-oor'), label: document.querySelector('.face-svg').getAttribute('aria-label'), sel: document.querySelector('.face-row.is-selected')?.dataset.row }));
      check('back in range: the selected-row accent and the label are redrawn', !back.oor && back.sel === 'top' && /depth 7 η over depth 8 θ/.test(back.label), JSON.stringify(back));
    }
    // before the first reading nothing is drawn
    await page.route('**/src/ui/sound.js', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await route.continue();
      } catch {}
    });
    await page.goto(url(q(T_A)));
    await page.waitForSelector('.face-svg');
    await page.waitForTimeout(500);
    {
      const pending = await page.evaluate(() => ({ cls: document.querySelector('.face-svg').classList.contains('is-pending'), ink: getComputedStyle(document.querySelector('.face-row--top .face-ink')).opacity, dots: getComputedStyle(document.querySelector('.face-row--top .face-counter')).opacity }));
      check('before the first reading the screen is blank (no all-zero clock)', pending.cls && pending.ink === '0' && pending.dots === '0', JSON.stringify(pending));
      await page.waitForTimeout(2200);
      check('... and the glyphs appear with the first reading', await page.evaluate(() => !document.querySelector('.face-svg').classList.contains('is-pending') && getComputedStyle(document.querySelector('.face-row--top .face-ink')).opacity === '1'));
    }
    await page.unroute('**/src/ui/sound.js');
    // persisted garbage: null / out-of-range depth and selection must not break the face
    await page.evaluate(() => localStorage.setItem('fractonica-clock/v1', JSON.stringify({ topDepth: null, selectedLevel: null, showLetters: 'yes' })));
    await page.goto(url(`?t=${T_A}&view=rings&zone=UTC`));
    await page.waitForSelector('.face-svg .face-glyph path');
    await page.waitForTimeout(500);
    check('stored topDepth null falls back to the default depth 7', /η 7 · θ 8/.test(await page.textContent('.face-depths')), await page.textContent('.face-depths'));
    await page.evaluate(() => localStorage.clear());
    // small details of the page chrome
    await open(q(T_A));
    {
      const d = await page.evaluate(() => {
        // computed colours come back as rgb(...) or, for color-mix(), as color(srgb r g b) with channels 0..1
        const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map((v) => (c.startsWith('color(') ? Math.round(Number(v) * 255) : Number(v)));
        const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        const cr = (a, b) => (Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05);
        const off = document.querySelector('.face-dot:not(.is-lit)');
        return {
          help: document.querySelector('.face-help').getAttribute('aria-label'),
          cap: parseFloat(getComputedStyle(document.querySelector('.face-cap')).fontSize),
          dotContrast: cr(rgb(getComputedStyle(off).stroke), [8, 12, 16]),
          depthsContrast: cr(rgb(getComputedStyle(document.querySelector('.face-depths')).color), [16, 22, 29]),
        };
      });
      check('How to read has its own accessible name (the Rings panel has one too)', /^How to read the clock face$/.test(d.help), d.help);
      check('info captions are 10 design px (they were 7.5)', d.cap === 10, String(d.cap));
      check('unlit counter dots keep >= 3:1 contrast with the glass; the footer text >= 4.5:1', d.dotContrast >= 3 && d.depthsContrast >= 4.5, `${d.dotContrast.toFixed(2)} / ${d.depthsContrast.toFixed(2)}`);
    }


    // ---- 10. pure mode: Fractonica terms only (docs/design/80-pure.md) -------------------------------------------
    {
      const hard = (ls) => ls.filter((l) => l.severity === 'hard');
      const fmtLeaks = (ls) => ls.slice(0, 3).map((l) => `${l.rule} "${l.match}" in ${l.kind} ${l.where}: ${l.text}`).join(' | ');
      /** Hard leaks that belong to the face: the shared scanner (filtered by location) plus the scoped scan of the card. */
      const faceLeaks = async (state, { all = false } = {}) => {
        const wide = (await scan(page, state)).filter((l) => /face|slot-face/.test(l.where));
        const scoped = judge(await collectScoped(page, '#slot-face', { all }), state);
        return hard([...wide, ...scoped]);
      };
      const clean = async (name, { all = false } = {}) => {
        const ls = await faceLeaks(name, { all });
        check(`pure: ${name}: no Earth reference ${all ? 'anywhere in the face DOM' : 'in what the face shows'}`, ls.length === 0, fmtLeaks(ls));
      };
      const leftover = async (name) => {
        const items = await collectScoped(page, '#slot-face', { all: true });
        const hit = items.filter((i) => PURE_MARKERS.test(i.text));
        check(`normal: ${name}: nothing of pure mode left in the face DOM`, hit.length === 0, hit.slice(0, 3).map((i) => `${i.kind} ${i.where}: ${i.text}`).join(' | '));
      };
      const tipFull = async (x, y, wait = 350) => {
        const c = await f.client(x, y);
        await page.mouse.move(c.x - 3, c.y);
        await page.mouse.move(c.x, c.y);
        await page.waitForTimeout(wait);
        return page.evaluate(() => {
          const t = document.querySelector('.face-tip');
          return {
            hidden: t.hidden,
            text: t.innerText.replace(/\n/g, ' / '),
            lines: [...t.querySelectorAll('.face-tip-l')].map((l) => l.innerText.trim()),
            title: t.querySelector('b').textContent,
            aside: t.querySelector('.dim').textContent,
            pairs: [...t.querySelectorAll('.pure-pair')].map((p) => ({ svgs: p.querySelectorAll('svg').length, label: p.getAttribute('aria-label') })),
          };
        });
      };
      /** The vocabulary of the shared core, evaluated in the page (an independent route to the expected strings). */
      const expected = () =>
        page.evaluate(() => {
          const { model, store, ctx } = window.__fractonica;
          const pure = ctx.pure;
          const t = store.t();
          const depth = store.state.topDepth;
          const lvT = model.levelAt(t, depth - 1);
          const lvB = model.levelAt(t, depth);
          let sol = null;
          try {
            sol = model.solarAt(t);
          } catch {}
          const lam = pure.UNITS.find((u) => u.id === 'lambda');
          return {
            t,
            names: [pure.nameAt(t, depth - 1), pure.nameAt(t, depth)],
            topNext: `in ${pure.between(t, lvT.next.time)}`,
            topCap: `NEXT ${lvT.next.name.toUpperCase()}`,
            solarCap: sol ? `NEXT ${sol.threshold.name.toUpperCase()}` : null,
            solarNext: sol ? `in ${pure.between(t, sol.threshold.time)}` : null,
            syncCap: sol ? `SYNC ${sol.sync}` : null,
            driftLambda: sol ? (sol.start - sol.nominalStart) / pure.unitSeconds(lam) : null,
            sync: sol?.sync,
            phaseSpeech: sol ? (({ hi, lo }) => `phase ${hi} and ${lo} of 256`)(pure.pair(sol.phase)) : null,
            stamp: pure.stamp(t, 'lambda'),
            length: [pure.cycleLength(depth - 1), pure.cycleLength(depth)],
            ordinals: [pure.cycleShort(depth - 1, lvT.cycle), pure.cycleShort(depth, lvB.cycle)],
            driftText: sol ? pure.driftText(sol) : null,
            ends: [lvT.end, lvB.end],
            caption: pure.stamp(t, 'lambda').split(/[\s·]+/).filter(Boolean),
            local: [lvT.local, lvB.local],
            siblings: [lvT.siblings, lvB.siblings],
          };
        });
      const infoTexts = () => page.evaluate(() => [...document.querySelectorAll('.face-info text')].map((t) => t.textContent));
      const driftOk = (txt, want) => {
        const m = /^drift ([−+]?)([\d\u202f]+)λ$/.exec(txt);
        if (!m) return false;
        const n = Number(m[2].replace(/\u202f/g, '')) * (m[1] === '−' ? -1 : 1);
        return Math.abs(n - want) <= Math.max(2, Math.abs(want) * 0.005);
      };

      // ---- 10a. the basics at SPEC vector A, with a foreign zone that must make no difference
      await open(`?pure=1&t=${T_A}&view=rings&zone=Asia/Tokyo`);
      await page.waitForTimeout(700);
      const timeOrigin = await page.evaluate(() => performance.timeOrigin);
      let pe = await expected();
      const base = await page.evaluate(() => ({
        root: document.querySelector('.face-root').dataset.pure,
        body: document.body.dataset.pure,
        overlay: document.querySelector('.face-svg').dataset.overlay,
        names: [...document.querySelectorAll('.face-letter-name')].map((e) => e.textContent),
        letters: [...document.querySelectorAll('.face-letter')].map((e) => e.textContent),
        caption: document.querySelector('.face-caption').textContent,
        captionTitle: document.querySelector('.face-caption').title,
        depths: document.querySelector('.face-depths').textContent,
        svgLabel: document.querySelector('.face-svg').getAttribute('aria-label'),
        rows: Object.fromEntries([...document.querySelectorAll('.face-row')].map((e) => [e.dataset.row, e.getAttribute('aria-label')])),
        help: document.querySelector('.face-help').getAttribute('aria-label'),
      }));
      check('pure: ?pure=1 mounts the face in pure mode (card and body flagged, no reload)', base.root === '1' && base.body === '1');
      check('pure: the letters overlay carries the name of each running cycle under its letter', base.overlay === 'letters' && base.names.join('|') === pe.names.join('|') && base.names[0] === 'Eta Monofracton' && base.letters.join('') === 'ηθ', `${base.overlay} ${base.names} ${base.letters}`);
      check('pure: the caption (time is not live) is the address and the counters, not a clock time or a zone', JSON.stringify(base.caption.split(/[\s·]+/).filter(Boolean)) === JSON.stringify(pe.caption) && /^α#\d+ β#\d γ#\d+ · δ½#\d+ ε½#\d ζ½#\d · \d+η \d+ι \d+λ$/.test(base.caption) && !/UTC|\+09|:/.test(base.caption), base.caption);
      check('pure: ... its hover text says which numbers count from 0 and which from 1, and points to the glossary', /count from 1.*count from 0.*Press \? for the glossary\.$/.test(base.captionTitle), base.captionTitle);
      check('pure: the screen label names the depths and the sync; the rows are named by cycle', /^Clock face: depth 7 η over depth 8 θ, solar sync 4820$/.test(base.svgLabel) && /^η depth 7 · Eta Monofracton: state 13 of 16, value −3, rising, cycle 1 of 11/.test(base.rows.top) && /^θ depth 8 · Theta Octafracton: state 5 of 16/.test(base.rows.bottom), base.svgLabel + ' | ' + base.rows.top);
      check('pure: the solar row says "phase a and b of 256" (two numbers, not "a·b") and never "percent"', new RegExp(`^Solar sync 4820, ${pe.phaseSpeech}, glyphs 5, 11, 13\\.`).test(base.rows.solar) && !/percent|%|\d·\d/.test(base.rows.solar), base.rows.solar);
      await clean('letters overlay at vector A');
      await clean('letters overlay at vector A', { all: true });
      await page.waitForTimeout(4200);
      await page.click('.face-btn[data-act="info"]');
      await page.waitForTimeout(350);
      let inf = await infoTexts();
      check('pure: info labels are countdowns: next threshold of the top period, next solar threshold, sync number', inf[0] === pe.topCap && inf[1] === pe.topNext && inf[2] === pe.solarCap && inf[3] === pe.solarNext && inf[4] === pe.syncCap, JSON.stringify(inf) + ' vs ' + JSON.stringify([pe.topCap, pe.topNext, pe.solarCap, pe.solarNext, pe.syncCap]));
      check('pure: ... and the sync caption is followed by the drift counted in λ (not a clock time), written like pure.driftText', driftOk(inf[5], pe.driftLambda) && inf[5] === `drift ${pe.driftText}`, `${inf[5]} vs drift ${pe.driftText} (${pe.driftLambda})`);
      check('pure: the first label reads like "peak in 3η 2ι": a countdown in ladder units', /^in \d+[αβγδεζηιλμνξ½]+ \d+[αβγδεζηιλμνξ½]+$/.test(inf[1]), inf[1]);
      await clean('info labels at vector A');
      await faceCard(page, shot, 'face-pure-info.png');
      const saidPure = await page.evaluate(() => document.querySelector('#slot-face [role=status]').textContent);
      check('pure: Info announces the countdowns and the sync in the live region', /^Next \w+ of the top period: in \S+ \S+\. Next \w+ of the solar sync: in \S+ \S+\. Solar sync 4820, drift [−+]?[\d\u202f]+λ\.$/.test(saidPure), saidPure);
      const hardSaid = hard(judge([{ kind: 'text', text: saidPure, where: 'status' }], 'status'));
      check('pure: ... and the announcement has no Earth reference', hardSaid.length === 0, fmtLeaks(hardSaid));
      // the foreign zone makes no difference at all
      const tokyo = { caption: base.caption, info: inf };
      await page.evaluate(() => window.__fractonica.store.set({ zone: 'UTC' }));
      await page.waitForTimeout(250);
      await page.click('.face-btn[data-act="info"]');
      await page.waitForTimeout(300);
      check('pure: the time zone has no influence on the caption or the info labels', (await page.textContent('.face-caption')) === tokyo.caption && JSON.stringify(await infoTexts()) === JSON.stringify(tokyo.info));

      // ---- 10b. tooltips: every row, the counter arcs, the gesture hints
      await page.waitForTimeout(4200);
      let t1 = await tipFull(96, 80);
      pe = await expected();
      check('pure: top row tooltip names and numbers the cycle, gives its length (pure.cycleLength) and when it ends', !t1.hidden && t1.title === 'η · depth 7' && t1.aside === `one cycle = ${pe.length[0]}` && t1.lines[0] === `${pe.names[0]} · ${pe.ordinals[0]} of ${pe.siblings[0]} in its ζ` && /^State 13 of 16: value −3, rising ↗$/.test(t1.lines[1]) && new RegExp(`^Ends in \\S+ \\S+ → Eta Difracton begins$`).test(t1.lines.at(-2)), t1.text);
      check('pure: ... every time in it is a countdown (in …), none is a clock time; the last line says what counts from 0 and from 1', t1.lines.slice(2, -1).every((l) => /\bin \d+\S+( \d+\S+)?/.test(l)) && !/\d:\d\d/.test(t1.text) && /^Names and # numbers count from 1; states and clock counters \(η ι λ\) count from 0\.$/.test(t1.lines.at(-1)), t1.text);
      await clean('top row tooltip');
      await shot('face-pure-tip-top.png', { clip: { x: 0, y: 0, width: 720, height: 760 } });
      const t2 = await tipFull(96, 410);
      check('pure: bottom row tooltip: Theta Octafracton, ends → Theta Nonafracton begins', !t2.hidden && t2.title === 'θ · depth 8' && t2.aside === `one cycle = ${pe.length[1]}` && pe.length[1] === '4ι' && /^Theta Octafracton · θ#8 of 9 in its η$/.test(t2.lines[0]) && /→ Theta Nonafracton begins$/.test(t2.lines.at(-2)), t2.text);
      await clean('bottom row tooltip');
      const t3 = await tipFull(96, 13);
      check('pure: the counter arc explains the cycle number with the name', !t3.hidden && /^Eta Monofracton · η#1 of 11 in its ζ$/.test(t3.lines[0]), t3.text);
      await clean('counter arc tooltip');
      const t4 = await tipFull(96, 245);
      pe = await expected();
      check('pure: solar tooltip: sync number, phase as a glyph pair, drift in λ, next quarter, age', !t4.hidden && t4.title === 'Solar sync #4820' && t4.aside === '19η per sync' && /^Phase\s+of this sync$/.test(t4.lines[0].replace(/\s+/g, ' ')) && t4.pairs.length === 1 && t4.pairs[0].svgs === 2 && t4.pairs[0].label === pe.phaseSpeech && t4.lines[1] === `Drift ${pe.driftText} against the solar rhythm` && /^Drift [−+]?\d{1,3}(\u202f\d{3})*λ against the solar rhythm$/.test(t4.lines[1]) && /^Next node in \S+ \S+$/.test(t4.lines[2]) && /^Sync began \S+ \S+ ago$/.test(t4.lines[3]), t4.text + ' ' + JSON.stringify(t4.pairs));
      await clean('solar tooltip with the glyph pair');
      await clean('solar tooltip with the glyph pair', { all: true });
      await shot('face-pure-tip-solar.png', { clip: { x: 0, y: 0, width: 720, height: 760 } });
      const hintTop = await tipFull(96, 138, 750);
      check('pure: the region hint is unchanged (no Earth reference to remove)', !hintTop.hidden && /top becomes ζ, depth 6/.test(hintTop.text), hintTop.text);
      await clean('region hint');
      await page.mouse.move(5, 5);

      // ---- 10c. keyboard focus: the tooltip is the description of the row; rows and the dialog have pure names
      await page.focus('.face-svg');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(250);
      const kt = await page.evaluate(() => {
        const r = document.activeElement;
        const tip = document.getElementById(r.getAttribute('aria-describedby') || 'x');
        return { row: r.dataset.row, hidden: tip?.hidden, hint: tip?.querySelector('.face-tip-hint')?.textContent, first: tip?.querySelector('.face-tip-l')?.textContent };
      });
      check('pure: a focused row is described by its pure tooltip (name first, Enter in the hint)', kt.row === 'top' && kt.hidden === false && kt.first === 'Eta Monofracton · η#1 of 11 in its ζ' && /^Enter:/.test(kt.hint), JSON.stringify(kt));
      await clean('keyboard-focus tooltip');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.mouse.move(5, 5);

      // ---- 10d. how to read
      await page.click('.face-help');
      await page.waitForTimeout(250);
      const howto = await page.evaluate(() => ({ open: !document.querySelector('.face-pop').hidden, text: document.querySelector('.face-pop').textContent.replace(/\s+/g, ' ').trim(), lis: [...document.querySelectorAll('.face-pop-list li')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()), pairs: document.querySelectorAll('.face-pop-list .pure-pair').length, minis: document.querySelectorAll('.face-mini').length }));
      check('pure: How to read has the five lines, one on counters from 0 and names from 1, three mini glyphs and the glyph pair example', howto.open && howto.lis.length === 6 && howto.minis === 3 && howto.pairs === 1, JSON.stringify(howto.lis));
      check('pure: ... the counters line gives the examples "0η 29ι 21λ" (from 0) and "δ½#6" (from 1)', /0η 29ι 21λ/.test(howto.lis[4]) && /δ½#6/.test(howto.lis[4]) && /from 0/.test(howto.lis[4]) && /from 1/.test(howto.lis[4]), howto.lis[4]);
      check('pure: ... the yellow line says "19η cycles", with no civil days', /19η cycles/.test(howto.lis[5]) && !/civil|4-day|\bs\b|19 η/.test(howto.lis[5]), howto.lis[5]);
      check('pure: ... the dialog ends with "Press ? for the glossary."', howto.text.endsWith('Press ? for the glossary.'), howto.text.slice(-60));
      // "?" typed while the dialog has focus still reaches the shell: it opens the glossary
      await page.keyboard.press('?');
      await page.waitForTimeout(250);
      const gl = await page.evaluate(() => ({ glossary: !document.querySelector('#glossary').hidden, popOpen: !document.querySelector('.face-pop').hidden }));
      check('pure: ... and pressing ? in the dialog opens the glossary', gl.glossary, JSON.stringify(gl));
      await page.keyboard.press('?'); // toggles it closed again
      await page.waitForTimeout(150);
      await clean('How to read');
      await clean('How to read', { all: true });
      await faceCard(page, shot, 'face-pure-popover.png');
      await page.keyboard.press('Escape');

      // ---- 10e. messages: the clamped steps
      await page.evaluate(() => window.__fractonica.store.set({ topDepth: 11 }));
      await page.waitForTimeout(150);
      await page.click('.face-btn[data-act="shorter"]', { force: true }); // aria-disabled at the end of the range: still clickable, it only explains
      await page.waitForTimeout(150);
      const toast = await page.evaluate(() => document.querySelector('#toast').textContent);
      check('pure: the clamped-step toast has no Earth reference', /^Depth 11 over 12 is the shortest pair the face shows$/.test(toast) && hard(judge([{ kind: 'text', text: toast, where: 'toast' }], 'toast')).length === 0, toast);
      await page.evaluate(() => window.__fractonica.store.set({ topDepth: 2 }));
      await page.waitForTimeout(150);
      await page.click('.face-btn[data-act="longer"]', { force: true });
      await page.waitForTimeout(150);
      const toast2 = await page.evaluate(() => document.querySelector('#toast').textContent);
      check('pure: ... and the other end', /^Depth 2 \(β\) is the longest period the face shows$/.test(toast2), toast2);

      // ---- 10f. every depth: names, info labels and tooltips are right and clean
      const depthProblems = [];
      for (const d of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
        await page.evaluate((d) => window.__fractonica.store.set({ topDepth: d, showLetters: false }), d);
        await page.waitForTimeout(200);
        await page.click('.face-btn[data-act="info"]');
        await page.waitForTimeout(300);
        const e = await expected();
        const names = await page.evaluate(() => [...document.querySelectorAll('.face-letter-name')].map((x) => x.textContent));
        const i2 = await infoTexts();
        if (names.join('|') !== e.names.join('|')) depthProblems.push(`d${d} names ${names} vs ${e.names}`);
        if (i2[1] !== e.topNext || i2[0] !== e.topCap) depthProblems.push(`d${d} info ${i2.slice(0, 2)} vs ${e.topCap} ${e.topNext}`);
        const a = await tipFull(96, 80, 300);
        const b = await tipFull(96, 410, 300);
        if (!a.lines[0].startsWith(e.names[0]) || !b.lines[0].startsWith(e.names[1])) depthProblems.push(`d${d} tooltip names ${a.lines[0]} / ${b.lines[0]}`);
        const ls = await faceLeaks(`depth ${d}`);
        if (ls.length) depthProblems.push(`d${d} leaks ${fmtLeaks(ls)}`);
        await page.mouse.move(5, 5);
      }
      check('pure: depths 2..11 each show the right names, countdowns and clean tooltips', depthProblems.length === 0, depthProblems.join(' || '));
      await page.evaluate(() => window.__fractonica.store.set({ topDepth: 7 }));

      // ---- 10g. instants and edge states
      const inRangeProblems = [];
      for (const [name, expr] of [
        ['year 2000', '946684800'],
        ['year 2061', '2886085800'],
        ['catalogue start', 'model.tMin + 5'],
        ['catalogue end', 'model.tMax - 5'],
        ['a late cycle edge', 'model.levelAt(1791460800, 5).end - 30'],
      ]) {
        await page.evaluate((e) => {
          const { model, store } = window.__fractonica;
          store.setTime(new Function('model', `return ${e}`)(model));
        }, expr);
        await page.waitForTimeout(250);
        await page.click('.face-btn[data-act="info"]');
        await page.waitForTimeout(300);
        const ls = await faceLeaks(name);
        const all = hard(judge(await collectScoped(page, '#slot-face', { all: true }), name + ' (all)'));
        const texts = await page.evaluate(() => ({ cap: document.querySelector('.face-caption').textContent, na: document.querySelector('.face-svg').classList.contains('is-solar-na'), naText: [...document.querySelectorAll('.face-na text')].map((t) => t.textContent), solarRow: document.querySelector('.face-row--solar').getAttribute('aria-label') }));
        await tipFull(96, 245, 250);
        const tipLeaks = await faceLeaks(name + ' solar tooltip');
        if (ls.length || all.length || tipLeaks.length) inRangeProblems.push(`${name}: ${fmtLeaks([...ls, ...all, ...tipLeaks])}`);
        if (texts.na && (texts.naText.join('|') !== 'SOLAR SYNC|not defined within|one sync of the edge' || texts.solarRow !== 'Solar sync unavailable within one sync of the catalogue ends')) inRangeProblems.push(`${name}: solar-na text ${texts.naText} / ${texts.solarRow}`);
        if (/\d:\d\d/.test(texts.cap)) inRangeProblems.push(`${name}: caption ${texts.cap}`);
        await page.mouse.move(5, 5);
        await faceCard(page, shot, `face-pure-${name.replace(/[^a-z0-9]/gi, '')}.png`);
      }
      check('pure: other instants and both catalogue edges (solar sync not defined at the ends) are clean', inRangeProblems.length === 0, inRangeProblems.join(' || '));
      // out of range, driven with an out-of-range frame like the normal-mode check
      await page.evaluate(() => {
        const { model, instances } = window.__fractonica;
        window.__oorFrame = model.frame(model.tMax + 10);
        const inst = instances.face;
        inst.__origRender = inst.render;
        inst.render = (fr, info2) => inst.__origRender(window.__oorFrame, { ...info2, dirty: true });
      });
      await page.waitForTimeout(400);
      const oorPure = await page.evaluate(() => ({ cls: document.querySelector('.face-svg').classList.contains('is-oor'), text: [...document.querySelectorAll('.face-oor text')].map((t) => t.textContent).join(' | '), label: document.querySelector('.face-svg').getAttribute('aria-label'), caption: document.querySelector('.face-caption').textContent }));
      check('pure: out of range says "outside the catalogue" with the range α#1 to α#18, no years', oorPure.cls && oorPure.text === 'outside the | catalogue | from α#1 | to α#18' && oorPure.label === 'Fractonica clock face: outside the catalogue, no reading' && oorPure.caption === '', JSON.stringify(oorPure));
      await clean('out of range');
      await clean('out of range', { all: true });
      await faceCard(page, shot, 'face-pure-oor.png');
      // switching back to normal while out of range: the normal wording returns at once
      await page.keyboard.press('p');
      await page.waitForTimeout(300);
      const oorNormal = await page.evaluate(() => [...document.querySelectorAll('.face-oor text')].map((t) => t.textContent).join(' | '));
      check('normal: out of range after leaving pure mode shows the normal text again', /^outside Saros 141 \| catalogue \| from 1613-05-19 \| to 2857-06-13$/.test(oorNormal), oorNormal);
      await page.keyboard.press('p');
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const inst = window.__fractonica.instances.face;
        inst.render = inst.__origRender;
      });
      await page.waitForTimeout(300);

      // ---- 10h. time-lapse and live
      await open(`?pure=1&t=${T_A}&view=rings&rate=18188.9`);
      const lapse = [];
      for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(700);
        await page.click('.face-btn[data-act="info"]');
        await page.waitForTimeout(200);
        lapse.push(...(await faceLeaks(`time-lapse frame ${i}`)));
        const cap = await page.textContent('.face-caption');
        if (!/^α#\d+ β#\d γ#\d+ · δ½#\d+ ε½#\d ζ½#\d · \d+η \d+ι \d+λ$/.test(cap)) lapse.push({ rule: 'caption', match: cap, kind: 'text', where: 'caption', text: cap });
      }
      check('pure: time-lapse (one η per beat): every frame is clean and the caption follows', lapse.length === 0, fmtLeaks(lapse));
      await faceCard(page, shot, 'face-pure-lapse.png');
      await open('?pure=1&view=rings');
      await page.waitForTimeout(900);
      const liveCap = await page.textContent('.face-caption');
      check('pure: live mode shows no caption (like normal mode)', liveCap === '', JSON.stringify(liveCap));
      await clean('live');
      await clean('live', { all: true });
      await faceCard(page, shot, 'face-pure-live.png');

      // ---- 10i. live switching in both directions: P key, header button, store; no reload, no leftovers
      await open(`?t=${T_A}&view=rings&zone=UTC&pure=0`); // the store persists the mode: say it explicitly
      await page.waitForTimeout(500);
      await page.click('.face-btn[data-act="info"]');
      await page.waitForTimeout(300);
      const normalInfo = await infoTexts();
      check('normal: info labels show clock times before the switch', /\d\d:\d\d/.test(normalInfo[1]) && normalInfo[4] === 'SYNC TIME', normalInfo.join('|'));
      const hov = await f.client(96, 80);
      await page.mouse.move(hov.x - 3, hov.y);
      await page.mouse.move(hov.x, hov.y);
      await page.waitForTimeout(300);
      check('normal: a tooltip is open before the switch (with clock times in it)', await page.evaluate(() => !document.querySelector('.face-tip').hidden && /\d\d:\d\d/.test(document.querySelector('.face-tip').innerText)));
      const origin1 = await page.evaluate(() => performance.timeOrigin);
      await page.keyboard.press('p'); // focus is on the page (the key is not typed into the dialog or a field)
      await page.waitForTimeout(400);
      const sw1 = await page.evaluate(() => ({
        flagged: document.querySelector('.face-root').dataset.pure === '1',
        tipHidden: document.querySelector('.face-tip').hidden,
        tipText: document.querySelector('.face-tip').textContent,
        status: document.querySelector('#slot-face [role=status]').textContent,
        info: [...document.querySelectorAll('.face-info text')].map((t) => t.textContent),
        caption: document.querySelector('.face-caption').textContent,
        names: [...document.querySelectorAll('.face-letter-name')].map((e) => e.textContent),
        origin: performance.timeOrigin,
      }));
      check('pure: the P key switches live: the card is flagged and the open tooltip is closed and emptied', sw1.flagged && sw1.tipHidden && sw1.tipText === '', JSON.stringify(sw1.tipText));
      check('pure: ... the info labels that were showing are rewritten (no clock time survives), the caption and the letter names too', !sw1.info.some((x) => /\d:\d\d/.test(x)) && /^in /.test(sw1.info[1]) && !/UTC|:/.test(sw1.caption) && sw1.names.every((n) => /fracton$/.test(n)), sw1.info.join('|') + ' ' + sw1.caption);
      check('pure: ... without a reload', sw1.origin === origin1);
      await clean('after switching on with the P key', { all: true });
      // the dialog is open while the mode changes (the store changes it, e.g. a deep link or another module): it is rewritten in place
      await page.click('.face-help');
      await page.waitForTimeout(200);
      const popPure = await page.evaluate(() => document.querySelector('.face-pop-list li:last-child').textContent);
      await page.evaluate(() => window.__fractonica.store.set({ pure: false }));
      await page.waitForTimeout(300);
      const popNormal = await page.evaluate(() => ({ open: !document.querySelector('.face-pop').hidden, last: document.querySelector('.face-pop-list li:last-child').textContent, pair: document.querySelectorAll('.face-pop-list .pure-pair').length }));
      check('normal/pure: an open How to read dialog is rewritten in place when the mode changes (and stays open)', /19η cycles\. Its start drifts/.test(popPure) && popNormal.open && /≈ 4 civil days/.test(popNormal.last) && popNormal.pair === 0, popPure + ' => ' + popNormal.last);
      await leftover('after the dialog was open during the switch');
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.__fractonica.store.set({ pure: true }));
      await page.waitForTimeout(250);
      await page.click('.face-btn[data-act="info"]');
      await page.waitForTimeout(300);
      // back with the header button
      await page.click('#btn-pure');
      await page.waitForTimeout(400);
      const sw2 = await page.evaluate(() => ({ flagged: document.querySelector('.face-root').dataset.pure, names: [...document.querySelectorAll('.face-letter-name')].map((e) => e.textContent).join(''), info: [...document.querySelectorAll('.face-info text')].map((t) => t.textContent), caption: document.querySelector('.face-caption').textContent, pop: document.querySelector('.face-pop-list li:last-child').textContent, rows: [...document.querySelectorAll('.face-row')].map((e) => e.getAttribute('aria-label')), depths: document.querySelector('.face-depths').textContent }));
      check('normal: the header button switches back: flag gone, names gone, caption and row labels are the normal ones', sw2.flagged === undefined && sw2.names === '' && /UTC/.test(sw2.caption) && /civil days/.test(sw2.pop) && /^Solar sync 4820, 35\.8 percent/.test(sw2.rows[1]) && /^η depth 7: state 13 of 16/.test(sw2.rows[0]), JSON.stringify({ ...sw2, rows: sw2.rows.map((r) => r.slice(0, 40)) }));
      check('normal: ... the info overlay that was showing holds no pure text (it is emptied until the next Info)', sw2.info.every((x) => !PURE_MARKERS.test(x)), sw2.info.join('|'));
      await leftover('after the header button');
      // again with the store (the same path the URL and other modules use), checking the DOM in every state
      const toggleProblems = [];
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.__fractonica.store.set({ pure: true }));
        await page.waitForTimeout(200);
        const ls = await faceLeaks(`store toggle ${i} on`, { all: true });
        await page.evaluate(() => window.__fractonica.store.set({ pure: false }));
        await page.waitForTimeout(200);
        const left = (await collectScoped(page, '#slot-face', { all: true })).filter((x) => PURE_MARKERS.test(x.text));
        if (ls.length) toggleProblems.push(`round ${i} on: ${fmtLeaks(ls)}`);
        if (left.length) toggleProblems.push(`round ${i} off: ${left.slice(0, 3).map((x) => `${x.where}: ${x.text}`).join(' | ')}`);
      }
      check('pure/normal: three round trips through the store leave nothing of the other mode behind', toggleProblems.length === 0, toggleProblems.join(' || '));
      // pure mode first, then normal: the normal info overlay is fully normal again
      await open(`?pure=1&t=${T_A}&view=rings&zone=UTC`);
      await page.click('.face-btn[data-act="info"]');
      await page.waitForTimeout(300);
      await page.keyboard.press('p');
      await page.waitForTimeout(200);
      await page.click('.face-btn[data-act="info"]');
      await page.waitForTimeout(300);
      const back = await infoTexts();
      check('normal: after pure mode the info labels are the normal ones again (clock times, SYNC TIME)', /^\d\d:\d\d:\d\d$/.test(back[1]) && /^[A-Z][a-z]{2} \d{1,2} \d\d:\d\d$/.test(back[3]) && back[4] === 'SYNC TIME', back.join('|'));
      await leftover('info labels after pure mode');

      // ---- 10j. narrow screens
      for (const [w, h] of [
        [390, 844],
        [360, 640],
        [320, 640],
      ]) {
        await page.setViewportSize({ width: w, height: h });
        await open(`?pure=1&t=${T_A}&view=rings`);
        await page.waitForTimeout(700);
        const ov = await faceOverflow();
        check(`pure mobile ${w}: nothing in the face card overflows (caption, letters, buttons)`, ov.worst <= 0.5 && ov.cardRight <= ov.innerW, JSON.stringify(ov));
        const cap = await page.evaluate(() => { const c = document.querySelector('.face-caption'); return { clipped: c.scrollWidth > c.clientWidth, text: c.textContent }; });
        check(`pure mobile ${w}: the caption fits on one line without being cut`, !cap.clipped, JSON.stringify(cap));
        // the longest address that can occur (α#18 β#5 γ#13 · δ½#10 ε½#5 ζ½#7 · 10η 35ι 64λ) must fit as well
        const longest = await page.evaluate(() => {
          const c = document.querySelector('.face-caption');
          const keep = c.textContent;
          c.textContent = 'α#18 β#5 γ#13 · δ½#10 ε½#5 ζ½#7 · 10η 35ι 64λ';
          const r = { sw: c.scrollWidth, cw: c.clientWidth };
          c.textContent = keep;
          return r;
        });
        check(`pure mobile ${w}: ... also the longest possible address`, longest.sw <= longest.cw, JSON.stringify(longest));
        await faceCard(page, shot, `face-pure-mobile${w}-letters.png`);
        await page.waitForTimeout(4200);
        await page.click('.face-btn[data-act="info"]');
        await page.waitForTimeout(300);
        await faceCard(page, shot, `face-pure-mobile${w}-info.png`);
        await clean(`mobile ${w} info`);
        await page.click('.face-help');
        await page.waitForTimeout(250);
        const popBox = await page.evaluate(() => { const r = document.querySelector('.face-pop').getBoundingClientRect(); const c = document.querySelector('#slot-face').getBoundingClientRect(); return { l: r.left - c.left, r: c.right - r.right, sw: document.querySelector('.face-pop').scrollWidth - document.querySelector('.face-pop').clientWidth }; });
        check(`pure mobile ${w}: the dialog stays inside the card and its lines wrap`, popBox.l >= -0.5 && popBox.r >= -0.5 && popBox.sw <= 0.5, JSON.stringify(popBox));
        await faceCard(page, shot, `face-pure-mobile${w}-popover.png`);
        await page.keyboard.press('Escape');
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(`?pure=1&t=${T_A}&view=rings`);
      await page.waitForTimeout(900);
      await shot('face-pure-full-1440.png');

      // ---- 10k. touch: press and hold a row in pure mode
      {
        const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, colorScheme: 'dark' });
        const tp = await tctx.newPage();
        tp.on('pageerror', (e) => errors.push('pageerror(touch) stack: ' + (e.stack || e.message)));
        await tp.goto(url(`?pure=1&t=${T_A}&view=rings`));
        await tp.addStyleTag({ content: '#slot-jump{display:none!important;} #topbar{max-height:140px;overflow:hidden;}' });
        await tp.waitForSelector('.face-svg .face-glyph path');
        await tp.waitForTimeout(600);
        await tp.locator('.face-svg').scrollIntoViewIfNeeded();
        const tf = api(tp);
        const cdp = await tctx.newCDPSession(tp);
        const p = await tf.client(96, 245);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
        await tp.waitForTimeout(700);
        const held = await tp.evaluate(() => ({ hidden: document.querySelector('.face-tip').hidden, text: document.querySelector('.face-tip').innerText.replace(/\n/g, ' / '), pair: document.querySelectorAll('.face-tip .pure-pair svg').length }));
        await tp.screenshot({ path: path.join(outDir, 'face-pure-touch-hold.png') });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const heldLeaks = hard(judge(await collectScoped(tp, '#slot-face'), 'touch'));
        check('pure touch: press and hold on the solar row shows the tooltip with the glyph pair, clean', !held.hidden && held.pair === 2 && /Solar sync #4820/.test(held.text) && heldLeaks.length === 0, held.text + ' ' + fmtLeaks(heldLeaks));
        await tctx.close();
      }

      // ---- 10l. render cost in pure mode (info labels and a tooltip open)
      await open(`?pure=1&t=${T_A}&view=rings`);
      await page.waitForTimeout(400);
      await page.click('.face-btn[data-act="info"]');
      {
        const c = await f.client(96, 245);
        await page.mouse.move(c.x - 3, c.y);
        await page.mouse.move(c.x, c.y);
      }
      await page.waitForTimeout(300);
      for (const [label, rate] of [['frozen', 0], ['time-lapse x3600', 3600]]) {
        if (rate) await page.evaluate((r) => window.__fractonica.store.setRate(r), rate);
        const ms = await page.evaluate(
          () =>
            new Promise((resolve) => {
              const inst = window.__fractonica.instances.face;
              const orig = inst.render;
              const times = [];
              inst.render = (...a) => {
                const t0 = performance.now();
                orig(...a);
                times.push(performance.now() - t0);
                if (times.length >= 150) {
                  inst.render = orig;
                  const sorted = [...times].sort((x, y) => x - y);
                  resolve({ mean: times.reduce((x, y) => x + y, 0) / times.length, p95: sorted[Math.floor(times.length * 0.95)] });
                }
              };
            }),
        );
        check(`pure: render() cost, ${label}, info labels and tooltip open: mean ${ms.mean.toFixed(3)} ms, p95 ${ms.p95.toFixed(3)} ms`, ms.mean < 1 && ms.p95 < 3);
      }
      await page.evaluate(() => window.__fractonica.store.pause());
      await page.mouse.move(5, 5);
    }

    // ---- 9. console hygiene ---------------------------------------------------------------------------------
    const mine = errors.filter(ownError);
    check('no console / page errors from the face files', mine.length === 0, mine.join(' || '));
  },
  { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log('FAILED:\n' + failed.map((c) => ` - ${c.name} ${c.detail}`).join('\n'));
  process.exit(1);
}
