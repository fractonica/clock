// Visual / interaction checks for the wave view (headless Chromium through tools/browse.mjs).
//
//   node tools/checks/check-wave.mjs [shots|interact|perf|edges|reduced|pinch|stress|all]
//
//   shots     screenshots of the wave card at several instants / levels / sizes -> tools/out/wave-*.png
//   interact  chips, zoom buttons, wheel, keyboard, step buttons, hover tooltips, click, scrub, resize
//   perf      render() cost per frame (live, time-lapse, catalogue) at HiDPI
//   edges     out-of-range (faked device clock), clipped last arc, catalogue edges
//   reduced   prefers-reduced-motion: level changes are instant
//   pinch     two-finger pinch changes the level
//   stress    fast time-lapse over many levels and into the end of the catalogue
//   labels    the read-out names what every number counts: shares say "of this half-arc" / "of the cycle", the
//             half-arc maps onto the cycle numbering of the ladder ("6 / 11"), "depth" is never "level",
//             no read-out line is clipped or re-wraps while it ticks -> tools/out/wave-labels-*.png
//   regress   one check per reviewed defect: touch scrub and scroll, wheel, Prev at depth 14, end of the
//             catalogue, ms fields, disabled controls, announcements, label steadiness, idle redraws, ...
//
// Exit code is non-zero when an assertion fails or the wave module logs an error.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withApp } from '../browse.mjs';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
const T = { A: 1791460800, Y2000: 946684800, Y2061: 2886085800 }; // SPEC vectors A, B, C
const mode = process.argv[2] ?? 'shots';
let failed = 0;

const hideChrome = (page) =>
  page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = '.topbar{display:none!important}'; // the sticky header would cover element screenshots
      document.head.append(s);
    });
  });
async function snap(page, name, sel = '.wave-card') {
  await page.locator(sel).screenshot({ path: path.join(out, name) });
  return `tools/out/${name}`;
}
const state = (page) => page.evaluate(() => window.__fractonica.instances.wave.getState());
/** Wait until the wave has built its scene (the module boots a few tens of ms after load) and is not zooming. */
const ready = (page, timeout = 8000) =>
  page.waitForFunction(() => {
    const s = window.__fractonica?.instances?.wave?.getState();
    return !!s && !!s.scene && !s.animating;
  }, null, { timeout });
/** Load a deep link and wait for the wave. */
async function open(page, url, query) {
  await page.goto(url(query));
  await ready(page);
}
const hitsOf = (page) => page.evaluate(() => window.__fractonica.instances.wave.getHits());
const selOf = (page) => page.evaluate(() => window.__fractonica.store.state.selectedLevel);
const timeOf = (page) => page.evaluate(() => window.__fractonica.store.t());
// errors from other modules (still being written) are not ours
// ("header update failed": the shell's header throws on the deliberately corrupt shared selection the regress check stores)
const mine = (errors) => errors.filter((e) => !/calendar|sound|jump|face|ladder|upnext|rings|timeline|404|Failed to load|header update failed/.test(e));
function ok(name, cond, extra = '') {
  if (!cond) failed++;
  console.log(cond ? 'PASS' : 'FAIL', name, extra);
}
function report(errors) {
  const m = mine(errors);
  if (m.length) failed++;
  console.log(m.length ? 'ERRORS' : 'no errors from the wave module', m.length ? m : '');
}
/** Pixel position (page coordinates) at progress t of a hit-test arc. */
const pointOnHit = (box, a, t) => {
  const ang = a.sa.a0 + a.sa.sweep * t;
  return { x: box.x + a.sa.x + a.sa.r * Math.cos(ang), y: box.y + a.sa.y + a.sa.r * Math.sin(ang) };
};

// ---------------------------------------------------------------- shots ----
async function shots() {
  for (const [vp, tag, dpr] of [[{ width: 1440, height: 900 }, 'desktop', 1], [{ width: 390, height: 844 }, 'mobile', 2]]) {
    await withApp(async ({ page, url, errors }) => {
      await hideChrome(page);
      for (const [q, name] of [
        [`?t=${T.A}&view=wave&zone=UTC&sel=7`, 'd7'],
        [`?t=${T.A}&view=wave&zone=UTC&sel=1`, 'd1'],
        [`?t=${T.A}&view=wave&zone=UTC&sel=2`, 'd2'],
        [`?t=${T.A}&view=wave&zone=UTC&sel=4`, 'd4'],
        [`?t=${T.A}&view=wave&zone=UTC&sel=11`, 'd11'],
        [`?t=${T.A}&view=wave&zone=UTC&sel=14`, 'd14'],
        [`?t=${T.Y2000}&view=wave&zone=UTC&sel=3`, 'y2000-d3'],
        [`?t=${T.Y2061}&view=wave&zone=UTC&sel=5`, 'y2061-d5'],
      ]) {
        await page.goto(url(q));
        await page.waitForTimeout(700);
        console.log(await snap(page, `wave-${tag}-${name}.png`));
      }
      await page.goto(url(`?t=${T.A}&view=wave&zone=UTC&sel=3`));
      await page.waitForTimeout(500);
      await page.evaluate(() => window.__fractonica.instances.wave.showOverview(true));
      await page.waitForTimeout(900);
      console.log(await snap(page, `wave-${tag}-overview.png`));
      report(errors);
    }, { viewport: vp, deviceScaleFactor: dpr });
  }
}

// ------------------------------------------------------------- interact ----
async function interact() {
  await withApp(async ({ page, url, errors }) => {
    await hideChrome(page);
    await page.goto(url(`?t=${T.A}&view=wave&zone=UTC&sel=3`));
    await page.waitForTimeout(700);
    const box = await page.locator('.wave-canvas').boundingBox();

    // level control <-> shared selection
    await page.click('.wave-lv[data-level="5"]');
    await page.waitForTimeout(950);
    ok('chip selects the level in the shared store', (await selOf(page)) === 5);
    ok('the view follows the selection', (await state(page)).scene.startsWith('5:'), (await state(page)).scene);
    await page.evaluate(() => window.__fractonica.ctx.select(8));
    await page.waitForTimeout(950);
    ok('a selection made elsewhere focuses here', (await state(page)).scene.startsWith('8:'));
    ok('the chip reflects it (aria-checked)', (await page.getAttribute('.wave-lv[data-level="8"]', 'aria-checked')) === 'true');

    // catalogue and zoom buttons
    await page.click('.wave-lv-all');
    await page.waitForTimeout(950);
    ok('catalogue chip shows the whole wave', (await state(page)).scene === 'O');
    await page.click('[data-zoom="1"]');
    await page.waitForTimeout(950);
    ok('zoom in from the catalogue goes to alpha', (await state(page)).scene.startsWith('0:') && (await selOf(page)) === 0);
    await page.click('[data-zoom="1"]');
    await page.waitForTimeout(800);
    ok('zoom in again goes to beta', (await selOf(page)) === 1);
    await page.click('[data-zoom="-1"]');
    await page.waitForTimeout(800);
    await page.click('[data-zoom="-1"]');
    await page.waitForTimeout(950);
    ok('zooming out of alpha leads to the catalogue', (await state(page)).scene === 'O');

    // Ctrl + wheel (a trackpad pinch arrives as ctrl + wheel); a plain wheel scrolls the page (see "regress")
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(950);
    ok('ctrl + wheel up zooms in', (await state(page)).scene.startsWith('0:'));
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(700);
    ok('ctrl + wheel up again goes one level deeper', (await selOf(page)) === 1);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(700);
    await page.keyboard.up('Control');
    ok('ctrl + wheel down zooms out', (await selOf(page)) === 0);

    // keyboard
    await page.click('.wave-lv[data-level="4"]');
    await page.waitForTimeout(800);
    await page.focus('.wave-canvas');
    const t0 = await timeOf(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const t1 = await timeOf(page);
    ok('ArrowRight steps to the next half-arc', t1 > t0);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    ok('ArrowLeft steps back to the previous half-arc', (await timeOf(page)) < t1);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(700);
    ok('ArrowUp zooms in', (await selOf(page)) === 5);
    await page.keyboard.press('Home');
    await page.waitForTimeout(800);
    ok('Home shows the catalogue', (await state(page)).scene === 'O');

    // step buttons
    await page.click('.wave-lv[data-level="2"]');
    await page.waitForTimeout(800);
    const s0 = await timeOf(page);
    await page.click('[data-step="1"]');
    await page.waitForTimeout(300);
    const s1 = await timeOf(page);
    ok('Next moves to the next half-arc', s1 > s0);
    await page.click('[data-step="-1"]');
    await page.waitForTimeout(300);
    ok('Prev moves back', (await timeOf(page)) < s1);

    // hover, click a child, scrub along the focused arc
    await page.goto(url(`?t=${T.A}&view=wave&zone=UTC&sel=3`));
    await page.waitForTimeout(900);
    const h = await hitsOf(page);
    const child = h.arcs.find((a) => a.kind === 'child' && a.idx > 0);
    const p = pointOnHit(box, child, 0.5);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(300);
    const tip = await page.evaluate(() => ({ hidden: document.querySelector('.wave-tip').hidden, text: document.querySelector('.wave-tip').innerText }));
    ok('hovering a loop shows a tooltip', !tip.hidden && /half-arc/.test(tip.text) && /ends in|starts in|ended/.test(tip.text) && /glyph/.test(tip.text), tip.text.replace(/\n/g, ' | '));
    ok('the hovered target is the child', (await state(page)).hover?.kind === 'child');
    await page.screenshot({ path: path.join(out, 'wave-hover-child.png'), clip: { x: box.x, y: box.y - 120, width: box.width, height: box.height + 120 } });
    const clicked = (await state(page)).hover;
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
    const landed = await page.evaluate((lvl) => {
      const w = window.__fractonica;
      const r = w.model.levelAt(w.store.t(), lvl);
      return { idx: r.cycle * 2 + (r.phase >= 0.5 ? 1 : 0), local: r.phase * 2 - (r.phase >= 0.5 ? 1 : 0) };
    }, clicked.level);
    ok('a click on a loop lands at the start of that half-arc', landed.idx === clicked.idx && landed.local < 0.01, JSON.stringify({ clicked, landed }));

    await page.waitForTimeout(900);
    const foc = (await hitsOf(page)).arcs.find((a) => a.kind === 'focus');
    const a0 = pointOnHit(box, foc, 0.2);
    const a1 = pointOnHit(box, foc, 0.8);
    await page.mouse.move(a0.x, a0.y);
    await page.mouse.down();
    await page.waitForTimeout(100);
    const tA = await timeOf(page);
    await page.mouse.move(a1.x, a1.y, { steps: 8 });
    await page.waitForTimeout(150);
    const tB = await timeOf(page);
    await page.mouse.up();
    ok('dragging along the focused arc scrubs time forward', tB > tA, `${tA} -> ${tB}`);

    // markers and edge badges select their level
    await page.goto(url(`?t=${T.A}&view=wave&zone=UTC&sel=6`));
    await page.waitForTimeout(900);
    const badge = (await hitsOf(page)).markers.find((m) => m.badge);
    ok('an off-screen ancestor is shown as an edge badge', !!badge);
    if (badge) {
      await page.mouse.move(box.x + badge.x, box.y + badge.y);
      await page.waitForTimeout(250);
      ok('the badge tooltip names its half-arc', /marker/.test(await page.evaluate(() => document.querySelector('.wave-tip').innerText)));
      await page.mouse.click(box.x + badge.x, box.y + badge.y);
      await page.waitForTimeout(950);
      ok('clicking the badge focuses that level', (await selOf(page)) === badge.level, `${await selOf(page)} vs ${badge.level}`);
    }

    // catalogue: hover and drag along the wave
    await page.evaluate(() => window.__fractonica.instances.wave.showOverview(true));
    await page.waitForTimeout(950);
    const ho = await hitsOf(page);
    const al3 = ho.arcs.find((a) => a.kind === 'alpha' && a.idx === 3);
    const q = pointOnHit(box, al3, 0.5);
    await page.mouse.move(q.x, q.y);
    await page.waitForTimeout(300);
    const tipO = await page.evaluate(() => document.querySelector('.wave-tip').innerText);
    ok('hovering the catalogue explains the alpha half-arc', /half-arc −4/.test(tipO) && /trough/.test(tipO), tipO.replace(/\n/g, ' | '));
    await page.screenshot({ path: path.join(out, 'wave-hover-overview.png'), clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
    await page.mouse.down();
    await page.waitForTimeout(200);
    const o1 = await timeOf(page);
    const al6 = ho.arcs.find((a) => a.kind === 'alpha' && a.idx === 6);
    const q2 = pointOnHit(box, al6, 0.5);
    await page.mouse.move(q2.x, q2.y, { steps: 10 });
    await page.waitForTimeout(200);
    const o2 = await timeOf(page);
    await page.mouse.up();
    ok('dragging along the catalogue travels through decades', o2 - o1 > 80 * 365 * 86400, `${((o2 - o1) / (365.25 * 86400)).toFixed(0)} y`);

    // resize
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.waitForTimeout(500);
    const sz = (await state(page)).size;
    const cb = await page.locator('.wave-canvas').boundingBox();
    ok('the canvas follows a resize', Math.abs(cb.width - sz[0]) < 1 && Math.abs(cb.height - sz[1]) < 1, `${JSON.stringify(sz)} vs ${cb.width}x${cb.height}`);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(500);
    ok('and a second one down to 360 px', (await state(page)).size[0] < sz[0]);
    ok('no horizontal page scroll at 360 px', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    report(errors);
  }, { viewport: { width: 1440, height: 900 } });
}

// ----------------------------------------------------------------- perf ----
async function perf() {
  await withApp(async ({ page, url, errors }) => {
    await page.goto(url('?view=wave&zone=UTC&sel=7')); // live mode
    await page.waitForTimeout(700);
    const measure = (label, level, extra) =>
      page.evaluate(
        async ({ label, level, extra }) => {
          const F = window.__fractonica;
          const inst = F.instances.wave;
          if (extra === 'overview') inst.showOverview(true);
          else {
            inst.showOverview(false);
            F.ctx.select(level);
          }
          if (extra === 'lapse') F.store.setRate(3600);
          await new Promise((r) => setTimeout(r, 900));
          const orig = inst.render;
          const samples = [];
          inst.render = (frame, info) => {
            const t0 = performance.now();
            orig(frame, info);
            samples.push(performance.now() - t0);
          };
          await new Promise((r) => setTimeout(r, 2200));
          inst.render = orig;
          if (extra === 'lapse') F.store.pause();
          samples.sort((a, b) => a - b);
          const n = samples.length;
          return { label, n, median: samples[n >> 1], p95: samples[Math.floor(n * 0.95)], max: samples[n - 1] };
        },
        { label, level, extra },
      );
    for (const [label, level, extra] of [
      ['live focus depth 2', 1], ['live focus depth 7', 6], ['live focus depth 11', 10], ['live focus depth 14', 13],
      ['live catalogue', 0, 'overview'], ['time-lapse x3600, depth 4', 3, 'lapse'],
    ]) {
      const r = await measure(label, level, extra);
      ok(`${r.label}: median ${r.median.toFixed(2)} ms, p95 ${r.p95.toFixed(2)} ms, max ${r.max.toFixed(2)} ms (${r.n} frames)`, r.median < 3 && r.p95 < 6);
    }
    report(errors);
  }, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
}

// ---------------------------------------------------------------- edges ----
async function edges() {
  // out of range is only reachable through the live clock, so fake the device clock
  for (const [label, ms] of [['after', Date.UTC(3000, 0, 1)], ['before', Date.UTC(1500, 5, 1)]]) {
    await withApp(async ({ page, url, errors }) => {
      await hideChrome(page);
      await page.addInitScript((fake) => { Date.now = () => fake; }, ms);
      await open(page, url, '?view=wave&zone=UTC&sel=5');
      console.log(await snap(page, `wave-oor-${label}.png`));
      const st = await state(page);
      ok(`out of range (${label}): the greyed catalogue is shown`, st.scene === 'O' && !st.inRange);
      ok(`out of range (${label}): an explanatory line is shown`, /Outside the Saros 141 catalogue/.test(await page.locator('.wave-r-oor p').innerText()));
      await page.click('[data-edge="last"]');
      await page.waitForTimeout(1200);
      ok(`out of range (${label}): "Go to the last eclipse" brings the wave back`, (await state(page)).inRange && (await state(page)).scene !== 'O');
      report(errors);
    }, { viewport: { width: 1440, height: 900 } });
  }
  await withApp(async ({ page, url, errors }) => {
    await hideChrome(page);
    await page.goto(url('?view=wave'));
    await page.waitForFunction(() => !!window.__fractonica?.model);
    const [tMin, tMax] = await page.evaluate(() => [window.__fractonica.model.tMin, window.__fractonica.model.tMax]);
    for (const [name, t, sel] of [['tmin+5', tMin + 5, 3], ['tmax-5', tMax - 5, 3], ['tmax-alpha', tMax - 5, 1], ['tmin-d9', tMin + 5, 9], ['tmax-d9', tMax - 5, 9]]) {
      await open(page, url, `?t=${t}&view=wave&zone=UTC&sel=${sel}`);
      console.log(await snap(page, `wave-edge-${name}.png`), JSON.stringify(await state(page)));
    }
    // the exact first and last instants, every level
    for (const t of [tMin, tMax]) {
      for (let sel = 1; sel <= 14; sel++) {
        await page.goto(url(`?t=${t}&view=wave&zone=UTC&sel=${sel}`));
        // the wave builds its scene a few tens of ms after load: wait for it instead of sleeping a fixed time
        await page.waitForFunction(() => !!window.__fractonica?.instances?.wave?.getState().scene, null, { timeout: 8000 }).catch(() => {});
        const st = await state(page);
        ok(`exact catalogue edge ${t === tMin ? 'start' : 'end'}, depth ${sel}`, st.scene && st.scene !== 'O' && st.inRange);
      }
    }
    report(errors);
  }, { viewport: { width: 1000, height: 800 } });
}

// -------------------------------------------------------------- reduced ----
async function reduced() {
  await withApp(async ({ page, url, errors }) => {
    await hideChrome(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url(`?t=${T.A}&view=wave&zone=UTC&sel=3`));
    await page.waitForTimeout(800);
    await page.click('.wave-lv[data-level="6"]');
    await page.waitForTimeout(80);
    const st = await state(page);
    ok('reduced motion: a level change is instant', st.scene.startsWith('6:') && !st.animating, JSON.stringify(st));
    report(errors);
  }, { viewport: { width: 1440, height: 900 } });
}

// ---------------------------------------------------------------- pinch ----
async function pinch() {
  await withApp(async ({ page, url, errors }) => {
    await page.goto(url(`?t=${T.A}&view=wave&zone=UTC&sel=4`));
    await page.waitForTimeout(700);
    const fire = (type, id, x, y) =>
      page.evaluate(([type, id, x, y]) => {
        const c = document.querySelector('.wave-canvas');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: id, clientX: r.left + x, clientY: r.top + y, bubbles: true, button: 0, isPrimary: id === 1 }));
      }, [type, id, x, y]);
    const before = await selOf(page);
    await fire('pointerdown', 1, 300, 250);
    await fire('pointerdown', 2, 340, 250);
    for (let i = 1; i <= 6; i++) {
      await fire('pointermove', 1, 300 - i * 12, 250);
      await fire('pointermove', 2, 340 + i * 12, 250);
    }
    await fire('pointerup', 1, 228, 250);
    await fire('pointerup', 2, 412, 250);
    await page.waitForTimeout(500);
    ok('pinching apart zooms in one level', (await selOf(page)) === before + 1, `${before} -> ${await selOf(page)}`);
    await fire('pointerdown', 1, 228, 250);
    await fire('pointerdown', 2, 412, 250);
    for (let i = 1; i <= 6; i++) {
      await fire('pointermove', 1, 228 + i * 16, 250);
      await fire('pointermove', 2, 412 - i * 16, 250);
    }
    await fire('pointerup', 1, 324, 250);
    await fire('pointerup', 2, 316, 250);
    await page.waitForTimeout(500);
    ok('pinching together zooms out', (await selOf(page)) === before);
    report(errors);
  }, { viewport: { width: 800, height: 900 } });
}

// --------------------------------------------------------------- stress ----
async function stress() {
  await withApp(async ({ page, url, errors }) => {
    await page.goto(url('?view=wave&zone=UTC&sel=1'));
    await page.waitForTimeout(500);
    const [tMin, tMax] = await page.evaluate(() => [window.__fractonica.model.tMin, window.__fractonica.model.tMax]);
    const run = async (sel, rate, from, ms) => {
      await page.evaluate(([sel, rate, from]) => {
        const F = window.__fractonica;
        F.ctx.select(sel);
        F.store.setTime(from);
        F.store.setRate(rate);
      }, [sel, rate, from]);
      const s = await page.evaluate(async (ms) => {
        const inst = window.__fractonica.instances.wave;
        const orig = inst.render;
        const out = [];
        inst.render = (f, i) => {
          const t0 = performance.now();
          orig(f, i);
          out.push(performance.now() - t0);
        };
        await new Promise((r) => setTimeout(r, ms));
        inst.render = orig;
        return out;
      }, ms);
      s.sort((a, b) => a - b);
      const st = await state(page);
      ok(`time-lapse depth ${sel + 1} at ${rate}x: median ${s[s.length >> 1].toFixed(2)} ms, max ${s.at(-1).toFixed(2)} ms, focus level ${st.focus}`, s[s.length >> 1] < 4);
    };
    for (const sel of [0, 3, 6, 9, 12, 13]) await run(sel, 31557600, tMin + 1000, 2500);
    for (const sel of [2, 8, 13]) await run(sel, -2629800, 2.0e9, 2000);
    await run(5, 31557600, tMax - 40 * 31557600, 3500);
    report(errors);
  }, { viewport: { width: 1440, height: 900 } });
}

// -------------------------------------------------------------- regress ----
/** Label relocations of the focus marker's time label while the clock runs: how often it jumps to another side. */
async function labelRelocations(page, ms) {
  const res = await page.evaluate(async (ms) => {
    const ctx2d = document.querySelector('.wave-canvas').getContext('2d');
    const orig = ctx2d.fillText.bind(ctx2d);
    let cur = null;
    ctx2d.fillText = (str, x, y) => {
      if (/^\d\d:\d\d:\d\d|^\d{4}-\d\d-\d\d/.test(str)) cur = { x, y };
      return orig(str, x, y);
    };
    const w = window.__fractonica.instances.wave;
    const out = [];
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        if (cur) {
          const st = w.getState();
          const m = w.getHits().markers.find((m) => m.level === st.focus && !m.badge);
          if (m) out.push({ sc: st.scene, at: performance.now(), ox: cur.x - m.x, oy: cur.y - m.y });
        }
        cur = null;
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    ctx2d.fillText = orig;
    return out;
  }, ms);
  // a relocation = a run of frames in which the label moves (> 3 px per frame) and gets more than 25 px away
  // from where it was; a glide to the other side of the dot is one run, steady following of the dot is none
  let hops = 0;
  let maxStep = 0;
  let from = null;
  let far = 0;
  let switchedAt = -Infinity;
  const endRun = () => {
    if (from && far > 25) hops++;
    from = null;
    far = 0;
  };
  for (let i = 1; i < res.length; i++) {
    if (res[i].sc !== res[i - 1].sc) switchedAt = res[i].at;
    if (res[i].at - switchedAt < 450) { endRun(); continue; } // a new scene moves everything on purpose, and the label glides to its place in it
    const step = Math.hypot(res[i].ox - res[i - 1].ox, res[i].oy - res[i - 1].oy);
    maxStep = Math.max(maxStep, step);
    if (step > 3) {
      if (!from) from = res[i - 1];
      far = Math.max(far, Math.hypot(res[i].ox - from.ox, res[i].oy - from.oy));
    } else endRun();
  }
  endRun();
  return { frames: res.length, hops, maxStep };
}

async function regress() {
  // ---- desktop: pointer, wheel, keyboard, labels, redraws -----------------------------------------------------
  await withApp(async ({ page, url, errors }) => {
    const toastText = () => page.evaluate(() => document.querySelector('#toast')?.textContent ?? '');
    const scrollY = () => page.evaluate(() => window.scrollY);

    // a plain wheel over the stage scrolls the page and leaves the shared level alone; ctrl + wheel changes the level
    await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=7`);
    let box = await page.locator('.wave-canvas').boundingBox();
    await page.mouse.move(box.x + 200, box.y + 100);
    const sel0 = await selOf(page);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(280); }
    ok('a plain wheel over the stage scrolls the page', (await scrollY()) > 0, `scrollY ${await scrollY()}`);
    ok('and does not change the shared level', (await selOf(page)) === sel0, `${sel0} -> ${await selOf(page)}`);
    await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=7`);
    box = await page.locator('.wave-canvas').boundingBox();
    await page.mouse.move(box.x + 200, box.y + 100);
    await page.keyboard.down('Control');
    for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, -10); await page.waitForTimeout(16); }
    await page.keyboard.up('Control');
    await page.waitForTimeout(500);
    const zoomed = (await selOf(page)) - sel0;
    ok('small ctrl + wheel deltas add up to level changes (about one per 48 units, at most one per 230 ms)', zoomed >= 1 && zoomed <= 8, `${sel0} -> ${await selOf(page)}`);
    ok('and the page did not scroll', (await scrollY()) === 0);

    // Prev at depth 14: four presses reach four different half-arcs
    await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=14`);
    const scenes = [(await state(page)).scene];
    for (let i = 0; i < 4; i++) {
      await page.click('.wave-card [data-step="-1"]');
      await page.waitForFunction((prev) => window.__fractonica.instances.wave.getState().scene !== prev, scenes.at(-1), { timeout: 3000 }).catch(() => {});
      scenes.push((await state(page)).scene);
    }
    // the first press returns to the start of the half-arc we are in; every further one goes back one half-arc
    ok('Prev steps back through consecutive half-arcs at depth 14', scenes[1] === scenes[0] && new Set(scenes).size === 4, scenes.join(' '));

    // the end of the catalogue: nothing is announced after the last half-arc, and 100 % is shown
    const tMax = await page.evaluate(() => window.__fractonica.model.tMax);
    for (const sel of [2, 9, 14]) {
      await open(page, url, `?t=${tMax - 0.0001}&view=wave&zone=UTC&sel=${sel}`);
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({ n2: document.querySelector('.wave-r-n2').innerText, pct: document.querySelector('.wave-r-pct b').innerText.trim() }));
      ok(`end of the catalogue, depth ${sel}: "catalogue ends here" and 100 %`, /catalogue ends here/.test(r.n2) && r.pct.startsWith('100'), JSON.stringify(r));
    }

    // milliseconds never read ".1000"
    await open(page, url, '?t=1791460672.5&view=wave&zone=UTC&sel=12');
    const span = await page.locator('.wave-r-span').innerText();
    ok('a span of a short arc has valid millisecond fields', !/\.\d{4}/.test(span), span);

    // a fractional or odd shared selection still renders
    await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=3.5`);
    ok('a fractional ?sel= renders the wave', (await state(page)).scene !== null && Number.isInteger((await state(page)).level));
    await page.goto(url(`?t=${T.A}&view=wave&zone=UTC`));
    await page.evaluate(() => (window.__fractonica.store.state.selectedLevel = 'abc'));
    await page.waitForTimeout(500);
    ok('a non-numeric shared selection renders the wave', (await state(page)).scene !== null);

    // off-canvas markers are not hit targets
    await open(page, url, '?t=2000000000&view=wave&zone=UTC&sel=4');
    const sz = (await state(page)).size;
    const hm = (await hitsOf(page)).markers.filter((m) => !m.badge);
    ok('only drawn dots are marker targets', hm.length > 0 && hm.every((m) => m.x >= 15 && m.x <= sz[0] - 15 && m.y >= 15 && m.y <= sz[1] - 15), JSON.stringify(hm.map((m) => [m.level, Math.round(m.x), Math.round(m.y)])));

    // level row: up / down move the radio selection like left / right
    await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=3`);
    await page.focus('.wave-lv[aria-checked="true"]');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    ok('ArrowDown on the level row selects the next level', (await selOf(page)) === 3);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300);
    ok('ArrowUp selects the previous one', (await selOf(page)) === 2);

    // announcements: the newest message is spoken, also right after load and after quick steps
    await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=7`);
    await page.focus('.wave-canvas');
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(120); }
    await page.waitForTimeout(700);
    const said = await page.locator('.wave-live').textContent();
    const title = await page.locator('.wave-r-title b').innerText();
    ok('quick keyboard steps end in one announcement about the half-arc they stopped at', said.includes(title.replace('half-arc ', '')) && said.length > 5, `"${said}" vs "${title}"`);

    // a paused wave makes no DOM writes and no canvas draws
    await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=7`);
    await page.waitForTimeout(600);
    const idle = await page.evaluate(async () => {
      let n = 0;
      const mo = new MutationObserver((l) => (n += l.length));
      mo.observe(document.querySelector('.wave-card'), { subtree: true, attributes: true, childList: true, characterData: true });
      const c = document.querySelector('.wave-canvas').getContext('2d');
      const clear = c.clearRect.bind(c);
      let draws = 0;
      c.clearRect = (...a) => { draws++; return clear(...a); };
      await new Promise((r) => setTimeout(r, 2000));
      c.clearRect = clear;
      mo.disconnect();
      return { n, draws };
    });
    ok('a paused wave writes nothing to the DOM and draws nothing', idle.n === 0 && idle.draws === 0, JSON.stringify(idle));

    // a live catalogue overview redraws only when something moved
    await open(page, url, '?view=wave&zone=UTC&sel=7');
    await page.evaluate(() => window.__fractonica.instances.wave.showOverview(true));
    await page.waitForTimeout(1200);
    const liveDraws = await page.evaluate(async () => {
      const c = document.querySelector('.wave-canvas').getContext('2d');
      const clear = c.clearRect.bind(c);
      let draws = 0;
      c.clearRect = (...a) => { draws++; return clear(...a); };
      await new Promise((r) => setTimeout(r, 2000));
      c.clearRect = clear;
      return draws;
    });
    ok('the live catalogue overview does not redraw every frame', liveDraws < 20, `${liveDraws} draws in 2 s`);

    // the time label next to the focus dot keeps its side while the dot moves
    for (const [q, label] of [[`?t=${T.A}&view=wave&zone=UTC&sel=7&rate=3600`, 'time-lapse depth 7'], ['?view=wave&zone=UTC&sel=12', 'live depth 12']]) {
      await open(page, url, q);
      await page.waitForTimeout(1200);
      const r = await labelRelocations(page, 5000);
      ok(`the time label stays put (${label}): ${r.hops} relocations in 5 s, largest step ${r.maxStep.toFixed(1)} px over ${r.frames} frames`, r.hops <= 4 && r.maxStep < 20);
    }

    // the zone-aware canvas follows a display change (devicePixelRatio) without a resize
    await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=7`);
    const w1 = await page.evaluate(() => document.querySelector('.wave-canvas').width);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    await page.waitForFunction((w) => document.querySelector('.wave-canvas').width > w * 1.5, w1, { timeout: 4000 }).catch(() => {});
    const w2 = await page.evaluate(() => document.querySelector('.wave-canvas').width);
    ok('the canvas follows a devicePixelRatio change', w2 > w1 * 1.9, `${w1} -> ${w2}`);
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    // focus ring room above the level chips
    const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.wave-levels')).paddingTop));
    ok('the level chips leave room above them for the focus ring', pad >= 4, `${pad}px`);

    // legend lists what is on the picture
    const legend = async () => page.evaluate(() => [...document.querySelectorAll('.wave-legend li')].filter((l) => l.offsetParent !== null).length);
    const nFocus = await legend();
    await page.evaluate(() => window.__fractonica.instances.wave.showOverview(true));
    await page.waitForTimeout(900);
    const eclipseKey = await page.evaluate(() => !!document.querySelector('[data-for="all"]').offsetParent && !document.querySelector('[data-for="focus"]').offsetParent);
    ok('the catalogue legend differs from the focus legend', eclipseKey && nFocus > 0);

    report(errors);
  }, { viewport: { width: 1440, height: 900 } });

  // ---- out of range: controls that cannot act say so ---------------------------------------------------------------
  await withApp(async ({ page, url, errors }) => {
    await page.addInitScript((fake) => { Date.now = () => fake; }, Date.UTC(3000, 0, 1));
    await open(page, url, '?view=wave&zone=UTC&sel=5');
    await page.waitForTimeout(400);
    const dis = await page.evaluate(() => [...document.querySelectorAll('.wave-card [data-step], .wave-card [data-zoom]')].map((b) => b.getAttribute('aria-disabled')));
    ok('out of range: step and zoom buttons are aria-disabled', dis.length === 4 && dis.every((d) => d === 'true'), JSON.stringify(dis));
    await page.click('.wave-card [data-step="-1"]', { force: true }); // an aria-disabled button can still be pressed
    ok('out of range: pressing one explains why', /Outside the catalogue/.test(await page.evaluate(() => document.querySelector('#toast').textContent)));
    const t0 = await timeOf(page);
    await page.click('.wave-card [data-zoom="1"]', { force: true });
    await page.focus('.wave-canvas');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    ok('and nothing moves', Math.abs((await timeOf(page)) - t0) < 5 && (await selOf(page)) === 4);
    await page.click('[data-edge="last"]');
    await page.waitForTimeout(900);
    ok('back in range the step buttons are live again', (await page.evaluate(() => document.querySelectorAll('.wave-card [data-step][aria-disabled="true"]').length)) === 0);
    report(errors);
  }, { viewport: { width: 1440, height: 900 } });

  // ---- phone: finger scrub, tap, scroll, targets ------------------------------------------------------------------------
  await withApp(async ({ browser, url, errors }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=4`);
    const cdp = await context.newCDPSession(page);
    await page.evaluate(() => document.querySelector('.wave-stage').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.__ev = [];
      const c = document.querySelector('.wave-canvas');
      for (const t of ['pointerdown', 'pointercancel', 'pointerup']) c.addEventListener(t, (e) => window.__ev.push(e.type));
    });
    const geo = async () => {
      const g = await page.evaluate(() => {
        const r = document.querySelector('.wave-canvas').getBoundingClientRect();
        return { hits: window.__fractonica.instances.wave.getHits(), x: r.x, y: r.y };
      });
      const foc = g.hits.arcs.find((a) => a.kind === 'focus');
      return (f) => {
        const a = foc.sa.a0 + foc.sa.sweep * f;
        return { x: g.x + foc.sa.x + foc.sa.r * Math.cos(a), y: g.y + foc.sa.y + foc.sa.r * Math.sin(a) };
      };
    };
    const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // `top` = where the stage sits in the window: it moves when a finger scrolls the page (scrollY alone also
    // changes when the shared header grows and the browser keeps the stage in place)
    const snapshot = () =>
      page.evaluate(() => {
        const w = window.__fractonica;
        const r = w.model.levelAt(w.store.t(), w.instances.wave.getState().focus);
        return {
          t: w.store.t(),
          top: document.querySelector('.wave-stage').getBoundingClientRect().top,
          local: r ? r.phase * 2 - (r.phase >= 0.5 ? 1 : 0) : null,
          ev: window.__ev.splice(0),
        };
      });

    // touching the steep side of the arc does not move the clock by itself; dragging along it scrubs, whichever way it runs
    let pt = await geo();
    const before = await snapshot();
    await touch('touchStart', pt(0.24));
    await sleep(250);
    const held = await snapshot();
    ok('a finger resting on the arc does not move the clock', Math.abs(held.t - before.t) < 1, `${held.t - before.t} s`);
    for (let i = 1; i <= 14; i++) { await touch('touchMove', pt(0.24 + (0.2 * i) / 14)); await sleep(16); }
    await touch('touchEnd');
    await sleep(250);
    const dragged = await snapshot();
    ok('a finger dragging along the steep part of the arc scrubs time to where it ends', dragged.local > 0.36 && dragged.local < 0.52, `progress ${before.local.toFixed(2)} -> ${dragged.local.toFixed(2)}, wanted about 0.44`);
    ok('the browser did not take the gesture (no pointercancel) and the page stayed put', !dragged.ev.includes('pointercancel') && Math.abs(dragged.top - before.top) < 2, `${dragged.ev.join()}, stage top ${before.top.toFixed(0)} -> ${dragged.top.toFixed(0)}`);

    // a tap on the arc jumps there
    await page.waitForTimeout(500);
    pt = await geo();
    await touch('touchStart', pt(0.8));
    await touch('touchEnd');
    await sleep(300);
    const tapped = await snapshot();
    ok('a tap on the arc travels to that point', tapped.local > 0.7 && tapped.local < 0.9, `progress ${tapped.local.toFixed(2)}, wanted about 0.8`);

    // a swipe that starts on an empty part of the stage scrolls the page and leaves the clock alone
    await page.waitForTimeout(500);
    const empty = await page.evaluate(() => {
      const w = window.__fractonica.instances.wave;
      const r = document.querySelector('.wave-canvas').getBoundingClientRect();
      const arcs = w.getHits().arcs.map((a) => a.sa);
      // the point of the stage farthest from every arc
      let best = null;
      for (let x = 20; x < r.width - 20; x += 10) for (let y = 20; y < r.height - 20; y += 10) {
        const d = Math.min(...arcs.map((s) => Math.abs(Math.hypot(x - s.x, y - s.y) - s.r)));
        if (!best || d > best.d) best = { d, x: r.x + x, y: r.y + y };
      }
      return best;
    });
    const before2 = await snapshot();
    await touch('touchStart', { x: empty.x, y: empty.y });
    for (let i = 1; i <= 10; i++) { await touch('touchMove', { x: empty.x, y: empty.y - i * 12 }); await sleep(16); }
    await touch('touchEnd');
    await sleep(500);
    const swiped = await snapshot();
    ok('a swipe starting off the arc scrolls the page', Math.abs(swiped.top - before2.top) > 30, `stage top ${before2.top.toFixed(0)} -> ${swiped.top.toFixed(0)} (start ${empty.d.toFixed(0)} px from every arc)`);
    ok('and leaves the clock alone', Math.abs(swiped.t - before2.t) < 1, `${swiped.t - before2.t} s`);

    // finger-sized controls
    const small = await page.evaluate(() => [...document.querySelectorAll('.wave-card button')].filter((b) => !b.classList.contains('wave-lv') && b.offsetParent).map((b) => [b.getAttribute('aria-label') || b.textContent.trim(), Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)]).filter(([, w, h]) => Math.min(w, h) < 40));
    ok('every control on a phone is at least 40 px', small.length === 0, JSON.stringify(small));
    report(errors);
    await context.close();
  }, {});
}

// --------------------------------------------------------------- labels ----
/** A time 75 % through the 6th (local 5 of 11) cycle of a depth-7 (η) level: the ladder reads "6 / 11" there. */
const auditTime = (page) =>
  page.evaluate(() => {
    const m = window.__fractonica.model;
    const r = m.levelAt(1791460800, 6);
    const idx = r.cycle - r.local + 5;
    const s = m.cycleStartTime(6, idx);
    return s + (m.cycleStartTime(6, idx + 1) - s) * 0.75;
  });
const floorTo = (x, k) => Math.floor(x * k + 1e-7) / k;
/** The read-out as the user sees it, one entry per line. */
const readout = (page) =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      title: q('.wave-r-title').innerText.replace(/\s+/g, ' ').trim(),
      span: q('.wave-r-span').innerText,
      loop: q('.wave-r-loop').hidden ? '' : q('.wave-r-loop').innerText,
      cyc: q('.wave-r-cyc').innerText,
      pct: q('.wave-r-pct').innerText.replace(/\s+/g, ' ').trim(),
      pct2: q('.wave-r-pct2').innerText.replace(/\s+/g, ' ').trim(),
      n1: q('.wave-r-n1').innerText,
      n2: q('.wave-r-n2').innerText,
    };
  });
/** Every piece of text the wave shows or announces right now: visible text, titles, aria labels, live region, tooltip, toast. */
const allText = (page) =>
  page.evaluate(() => {
    const card = document.querySelector('.wave-card');
    const out = [card.innerText];
    for (const n of [card, ...card.querySelectorAll('*')]) for (const a of ['title', 'aria-label', 'aria-valuetext']) if (n.hasAttribute(a)) out.push(n.getAttribute(a));
    out.push(document.querySelector('.wave-live').textContent, document.querySelector('#toast')?.textContent ?? '');
    return out.join('\n');
  });

async function labels() {
  await withApp(async ({ page, url, errors }) => {
    await hideChrome(page);
    await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=7`);
    const t = await auditTime(page);
    await open(page, url, `?t=${t}&view=wave&zone=UTC&sel=7`);
    await page.waitForTimeout(500);

    // 1. every percentage says what it is a fraction of
    const r = await readout(page);
    console.log('   read-out:', JSON.stringify(r));
    const truth = await page.evaluate((t) => {
      const w = window.__fractonica;
      const lv = w.model.levelAt(t, 6);
      return { local: lv.local, siblings: lv.siblings, phase: lv.phase };
    }, t);
    ok('the half-arc share says "of this half-arc"', /^\d+ % of this half-arc$/.test(r.pct), r.pct);
    ok('the cycle share says "of this η cycle"', /^\d+\.\d % of this η cycle$/.test(r.pct2), r.pct2);
    ok('the cycle share is the floored model phase (same as the rings and the face)', r.pct2.startsWith(`${floorTo(truth.phase * 100, 10).toFixed(1)} %`), `${r.pct2} vs phase ${truth.phase}`);
    const half = Number(r.pct.match(/^(\d+) %/)[1]);
    ok('the two shares are one fact: the half-arc share is the cycle share doubled, modulo the half', Math.abs(((truth.phase * 2) % 1) * 100 - half) < 1.01, `${half} % of the half-arc, ${truth.phase * 100} % of the cycle`);
    const bare = [r.pct, r.pct2, r.n1, r.n2, r.title].filter((x) => /%(?! of )/.test(x));
    ok('no bare percentage anywhere in the read-out', bare.length === 0, JSON.stringify(bare));

    // 2. the half-arc maps onto the cycle numbering of the ladder
    const ladder = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.ladder-row')].find((x) => /depth 7\b/.test(x.querySelector('.ladder-chip')?.getAttribute('aria-label') ?? ''));
      return row ? row.querySelector('.ladder-count').textContent.trim() : null;
    });
    ok('the loop line says what the number counts', r.loop === '1 of 11 in this ζ half-arc', r.loop);
    ok('the cycle line names the cycle and its half', r.cyc === 'Second half of η cycle 6 / 11 in ζ', r.cyc);
    ok('the title is signed and not mistaken for the cycle number', /^half-arc −1 trough$/.test(r.title), r.title);
    if (ladder) ok(`the cycle number is the one the ladder shows ("${ladder}")`, r.cyc.includes(ladder.replace(/\s/g, ' ')), `${r.cyc} vs ladder ${ladder}`);
    else console.log('NOTE the ladder row for depth 7 is not visible; compared with the model instead:', `${truth.local + 1} / ${truth.siblings}`);
    ok('and the model agrees', r.cyc.includes(`cycle ${truth.local + 1} / ${truth.siblings}`), JSON.stringify(truth));

    // first half of the same cycle: loop 11 of 11 in the previous ζ half-arc, same cycle 6 / 11
    const t1 = await page.evaluate((t) => { const m = window.__fractonica.model; const lv = m.levelAt(t, 6); return lv.start + (lv.end - lv.start) * 0.25; }, t);
    await open(page, url, `?t=${t1}&view=wave&zone=UTC&sel=7`);
    await page.waitForTimeout(400);
    const r1 = await readout(page);
    ok('the first half of the same cycle is loop 11 of 11 but still cycle 6 / 11', r1.loop === '11 of 11 in this ζ half-arc' && r1.cyc === 'First half of η cycle 6 / 11 in ζ' && /^half-arc \+11 crest$/.test(r1.title), JSON.stringify(r1));

    // the catalogue and α
    await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=1`);
    await page.waitForTimeout(400);
    const ra = await readout(page);
    ok('α: the loop line counts half-arcs of the catalogue, the cycle line says which α cycle', /^\d+ of 35 in the catalogue$/.test(ra.loop) && /^(First|Second) half of α cycle \d+ \/ 18$/.test(ra.cyc), JSON.stringify(ra));
    await page.evaluate(() => window.__fractonica.instances.wave.showOverview(true));
    await page.waitForTimeout(500);
    const ro = await readout(page);
    ok('catalogue: shares are labelled too', /^\d+\.\d % of the catalogue$/.test(ro.pct) && /^\d+ % of this α half-arc$/.test(ro.pct2) && /^Now in the (first|second) half of α cycle \d+ \/ 18$/.test(ro.cyc), JSON.stringify(ro));
    ok('catalogue: nothing is a bare percentage', ![ro.pct, ro.pct2, ro.n1, ro.n2].some((x) => /%(?! of )/.test(x)));
    await snap(page, 'wave-labels-desktop-catalogue.png');
    await open(page, url, `?t=${t}&view=wave&zone=UTC&sel=7`);
    await page.waitForTimeout(500);
    await snap(page, 'wave-labels-desktop.png');

    // 3. "depth", never "level", in anything shown, titled, labelled, announced or toasted
    const seen = [];
    const collect = async (what) => {
      const txt = await allText(page);
      const hit = txt.match(/.{0,40}\blevels?\b.{0,40}/gi);
      if (hit) seen.push(`${what}: ${hit.join(' | ')}`);
    };
    await collect('focus');
    await page.focus('.wave-canvas');
    await page.keyboard.press('ArrowRight'); // an announcement
    await page.waitForTimeout(700);
    await collect('after a step (announcement)');
    const box = await page.locator('.wave-canvas').boundingBox();
    const child = (await hitsOf(page)).arcs.find((a) => a.kind === 'child');
    if (child) {
      const p = pointOnHit(box, child, 0.5);
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(400);
      const tipText = await page.evaluate(() => document.querySelector('.wave-tip').innerText);
      ok('the loop tooltip names loop and cycle', /\d+ of \d+ in this .+ half-arc/.test(tipText) && /(first|second) half of \S+ cycle \d+ \/ \d+/.test(tipText) && /% of this half-arc travelled|ends in|starts in|ended/.test(tipText), tipText.replace(/\n/g, ' | '));
      await collect('child tooltip');
    }
    const focusLevel = (await state(page)).focus;
    const mk = (await hitsOf(page)).markers.find((m) => m.level !== focusLevel && !m.badge);
    if (mk) {
      await page.mouse.move(box.x + mk.x, box.y + mk.y);
      await page.waitForTimeout(400);
      await collect('marker tooltip');
    }
    await page.mouse.move(box.x + 2, box.y + 2);
    await page.click('.wave-lv[data-level="13"]');
    await page.waitForTimeout(900);
    await page.click('.wave-card [data-zoom="1"]', { force: true }); // at the deepest depth (aria-disabled, still pressable): a toast
    await page.waitForTimeout(300);
    ok('the zoom limit is explained in terms of depth', /Depth 14/.test(await page.evaluate(() => document.querySelector('#toast').textContent)));
    await collect('zoom limit toast');
    await page.evaluate(() => window.__fractonica.instances.wave.showOverview(true));
    await page.waitForTimeout(500);
    await collect('catalogue');
    ok('no "level" in any visible text, title, aria label, announcement or toast', seen.length === 0, seen.join('\n'));
    report(errors);
  }, { viewport: { width: 1440, height: 900 } });

  // out of range
  await withApp(async ({ page, url, errors }) => {
    await page.addInitScript((fake) => { Date.now = () => fake; }, Date.UTC(3000, 0, 1));
    await open(page, url, '?view=wave&zone=UTC&sel=5');
    await page.waitForTimeout(400);
    const txt = await allText(page);
    ok('out of range: no "level" either', !/\blevels?\b/i.test(txt), (txt.match(/.{0,30}\blevels?\b.{0,30}/i) ?? [''])[0]);
    report(errors);
  }, { viewport: { width: 1440, height: 900 } });

  // 4. no read-out line is clipped, at any width, depth or mode; the read-out keeps its height while it ticks
  for (const [vp, tag, dpr] of [[{ width: 1920, height: 1000 }, 'wide', 1], [{ width: 1440, height: 900 }, 'desktop', 1], [{ width: 1100, height: 800 }, 'mid', 1], [{ width: 820, height: 900 }, 'tablet', 1], [{ width: 390, height: 844 }, 'mobile', 2], [{ width: 360, height: 740 }, 'narrow', 2]]) {
    await withApp(async ({ page, url, errors }) => {
      await hideChrome(page);
      await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=7`);
      const clipped = [];
      const lines = ['.wave-r-title', '.wave-r-span', '.wave-r-loop', '.wave-r-cyc', '.wave-r-pct', '.wave-r-pct2', '.wave-r-n1', '.wave-r-n2'];
      const probe = (what) =>
        page.evaluate(({ lines, what }) => {
          const bad = [];
          const read = document.querySelector('.wave-read');
          if (read.scrollWidth > read.clientWidth + 1) bad.push(`${what}: the read-out scrolls sideways (${read.scrollWidth} > ${read.clientWidth})`);
          for (const s of lines) {
            const n = document.querySelector(s);
            if (!n.offsetParent) continue;
            if (n.scrollWidth > n.clientWidth + 1) bad.push(`${what}: ${s} is clipped (${n.scrollWidth} > ${n.clientWidth}): ${n.innerText.slice(0, 60)}`);
          }
          return bad;
        }, { lines, what });
      const times = [T.A, T.Y2000, T.Y2061, 1791550569.9, 2000000000.5, await page.evaluate(() => window.__fractonica.model.tMax - 0.002), await page.evaluate(() => window.__fractonica.model.tMin + 0.002)];
      for (const tt of times) {
        for (const sel of [1, 2, 3, 5, 7, 8, 11, 12, 14]) {
          await page.goto(url(`?t=${tt}&view=wave&zone=UTC&sel=${sel}`));
          await ready(page);
          await page.waitForTimeout(120);
          clipped.push(...(await probe(`t=${tt} depth ${sel}`)));
        }
      }
      await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=7`);
      await page.evaluate(() => window.__fractonica.instances.wave.showOverview(true));
      await page.waitForTimeout(700);
      clipped.push(...(await probe('catalogue')));
      ok(`${tag} ${vp.width}px: no read-out line is clipped`, clipped.length === 0, clipped.slice(0, 4).join('\n'));

      // height steadiness while the numbers tick (time-lapse over a few half-arcs of depth 7)
      await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=7&rate=3600`);
      const heights = new Set();
      const widths = new Set();
      for (let i = 0; i < 30; i++) {
        const m = await page.evaluate(() => { const b = document.querySelector('.wave-read').getBoundingClientRect(); return [Math.round(b.height), Math.round(document.querySelector('.wave-r-side').getBoundingClientRect().width)]; });
        heights.add(m[0]);
        widths.add(m[1]);
        await page.waitForTimeout(150);
      }
      ok(`${tag}: the read-out keeps its size while it ticks`, heights.size === 1 && widths.size === 1, `heights ${[...heights]} widths ${[...widths]}`);
      if (tag === 'mobile') {
        await open(page, url, `?t=${T.A}&view=wave&zone=UTC&sel=7`);
        await snap(page, 'wave-labels-mobile.png');
        await page.evaluate(() => window.__fractonica.instances.wave.showOverview(true));
        await page.waitForTimeout(700);
        await snap(page, 'wave-labels-mobile-catalogue.png');
      }
      report(errors);
    }, { viewport: vp, deviceScaleFactor: dpr });
  }
}

const modes = { shots, interact, perf, edges, reduced, pinch, stress, regress, labels };
if (mode === 'all') for (const fn of Object.values(modes)) await fn();
else if (modes[mode]) await modes[mode]();
else {
  console.log('unknown mode', mode, '- use one of', Object.keys(modes).join(', '), 'or all');
  failed++;
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
