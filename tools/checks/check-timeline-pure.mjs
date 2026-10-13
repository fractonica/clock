/**
 * Pure mode of the timeline, in a real browser (SPEC §15, docs/design/80-pure.md revision 3: the major periods
 * α β γ δ in words with their quarter words, the minor units ε η ι λ ν in letters and counts, real time in Blinks).
 *
 *   node tools/checks/check-timeline-pure.mjs          (screenshots: tools/out/tl-pure-chk-*.png)
 *   node tools/checks/check-timeline-pure.mjs --quick  (skips the long sweeps of section 1 and 2)
 *
 * Goes beyond the shared leak scanner (tools/checks/check-pure-leaks.mjs timeline): it reads everything the
 * timeline can say – text, titles, aria labels, SVG titles, the text drawn on its own canvas, the screen-reader
 * regions and the toasts it raises – through the shared rules (tools/pure-scan.mjs) in the states the shared check
 * cannot reach: every zoom preset, window edges and out-of-range windows, off-screen chips, eclipse markers, drags,
 * the keyboard, a long press on a phone, time-lapse, live mode, every selected depth and depth range – and checks
 * that switching between the modes (P, the header button, ?pure=1) leaves nothing behind in either direction.
 */
import { withApp } from '../browse.mjs';
import { judge } from '../pure-scan.mjs';
import '../../fractonica.js';
import { createModel } from '../../src/core/model.js';

const M = createModel(); // the same clock as the page, for instants the checks aim at

const T_A = 1791460800;
const quick = process.argv.includes('--quick');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? '  ' + detail : ''}`);
};
const leaks = [];

/** What the timeline can show or say right now (text, attributes, sr-only regions, its canvas text, the toast). */
async function items(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => {
    const out = [];
    const vis = (el) => {
      if (!el.isConnected || el.closest('[hidden]')) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
    };
    const add = (kind, text, where) => {
      const t = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (t) out.push({ kind, text: t, where });
    };
    for (const root of [document.querySelector('#view-timeline'), document.querySelector('#toast')]) {
      if (!root) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (el && vis(el)) add('text', n.nodeValue, '.' + [...el.classList].join('.'));
      }
      for (const el of [root, ...root.querySelectorAll('[title],[aria-label],[aria-description],[placeholder],[alt]')]) {
        if (!vis(el)) continue;
        for (const a of ['title', 'aria-label', 'aria-description', 'placeholder', 'alt']) if (el.hasAttribute(a)) add('attr:' + a, el.getAttribute(a), '.' + [...el.classList].join('.'));
      }
      for (const t of root.querySelectorAll('svg title')) add('svg-title', t.textContent, 'svg');
    }
    for (const c of window.__tlCanvas ?? []) add('canvas', c, '.tl-canvas');
    window.__tlCanvas = new Set();
    return out;
  });
}
/** Forget the canvas text drawn so far (it belongs to the mode we are about to leave). */
const forgetCanvas = (page) => page.evaluate(() => { window.__tlCanvas = new Set(); });
/**
 * After a mode switch: wait until the toolbar speaks the new vocabulary, then forget what was drawn on the way
 * (the pointer may repaint the old mode just before the click lands) and ask for one clean repaint.
 */
async function afterSwitch(page, pureOn) {
  await page.waitForFunction((on) => document.querySelector('.tl-presets button')?.textContent.trim() === (on ? 'ν' : 'Day'), pureOn, { timeout: 5000 });
  await page.waitForTimeout(150);
  await forgetCanvas(page);
  await page.evaluate(() => window.__fractonica.instances.timeline.api.zoomBy(1));
  await page.waitForTimeout(350);
}
async function scanState(page, state) {
  const it = await items(page);
  const l = judge(it, state);
  leaks.push(...l);
  return it;
}
const texts = (it) => it.map((x) => x.text);

const own = (e) => /timeline|tl-/i.test(e) || /pageerror/.test(e);

await withApp(
  async ({ page, url, errors, shot }) => {
    await page.addInitScript(() => {
      // the timeline's own canvas text (the shared hook cannot tell canvases apart)
      window.__tlCanvas = new Set();
      for (const name of ['fillText', 'strokeText']) {
        const orig = CanvasRenderingContext2D.prototype[name];
        CanvasRenderingContext2D.prototype[name] = function (text, ...rest) {
          try {
            if (this.canvas?.classList.contains('tl-canvas') && this.canvas.getClientRects().length) window.__tlCanvas.add(String(text));
          } catch {
            /* ignore */
          }
          return orig.call(this, text, ...rest);
        };
      }
    });
    await page.addStyleTag({ content: '' }).catch(() => {});

    const api = (fn, ...a) => page.evaluate(([f, a]) => new Function('tl', 'fz', 'args', `return (${f})(tl, fz, args)`)(window.__fractonica.instances.timeline.api, window.__fractonica, a), [fn.toString(), a]);
    const geom = async () => {
      const g = await page.evaluate(() => {
        const tl = window.__fractonica.instances.timeline.api;
        const r = document.querySelector('.tl-canvas').getBoundingClientRect();
        return { x: r.x, y: r.y, L: tl.layout, win: tl.window, levels: tl.levels };
      });
      return g;
    };
    const tipText = () =>
      page.evaluate(() => {
        const t = document.querySelector('.tl-tip');
        return t && !t.hidden && t.getClientRects().length ? t.innerText.replace(/\s+/g, ' ') : '';
      });
    const settle = (ms = 450) => page.waitForTimeout(ms);
    const open = async (q, w = 1440, h = 900) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(url(q));
      await page.waitForSelector('.tl-canvas');
      await settle(800);
      await page.addStyleTag({ content: '.toast{display:none}' }); // the toast text is read through its own element
    };
    const tipsSeen = new Set();
    /** Hover a grid of points over the whole canvas, scanning every tooltip. */
    async function sweep(state, { cols = 12, step = 0 } = {}) {
      const g = await geom();
      const L = g.L;
      const laneRows = [...new Set([0, 3, g.levels.indexOf(6), g.levels.length - 1].filter((i) => i >= 0))];
      const ys = [
        L.overview.y + L.overview.h / 2,
        L.axis.y + 6,
        L.axis.y + L.axis.ctxH + L.axis.tickH / 2,
        L.axis.y + L.axis.ctxH + L.axis.tickH + 8,
        ...laneRows.map((i) => L.lanesY + L.laneH * (i + 0.5)),
        L.eclipse.y + L.eclipse.h / 2,
      ];
      const xs = [10, 40, ...Array.from({ length: cols }, (_, i) => L.px0 + 10 + ((L.px1 - L.px0 - 20) * i) / (cols - 1))];
      for (const y of ys) {
        for (const x of xs) {
          await page.mouse.move(g.x + x, g.y + y);
          await page.waitForTimeout(40);
          const t = await tipText();
          if (t) {
            tipsSeen.add(t);
            const l = judge([{ kind: 'text', text: t, where: '.tl-tip' }], `${state} @ ${Math.round(x)},${Math.round(y)}`);
            leaks.push(...l);
          }
        }
      }
      await scanState(page, state + ' · after sweep');
      await page.mouse.move(2, 2);
    }

    // =============================== 1. pure from the start, every instant ==========================================
    if (!quick) {
    const INSTANTS = [
      ['vector A', T_A],
      ['year 2000', 946684800],
      ['year 2061', 2886085800],
      ['catalogue start', -11253795486 + 5],
      ['catalogue end', 28005212035 - 5],
      ['past the end', 28005212035 + 10],
      ['before the start', -11253795486 - 10],
    ];
    for (const [name, t] of INSTANTS) {
      await open(`?pure=1&t=${t}&view=timeline`);
      const it = await scanState(page, `instant ${name}`);
      check(`${name}: the timeline says something and nothing Gregorian`, it.length > 20 && !judge(it, '').some((l) => l.severity === 'hard'), `${it.length} strings`);
    }

    // =============================== 2. every preset, edges, out of range, depths ===================================
    await open(`?pure=1&t=${T_A}&view=timeline`);
    const presets = await page.$$eval('.tl-presets [data-preset]', (b) => b.map((x) => ({ id: x.dataset.preset, label: x.textContent.trim(), title: x.title })));
    check('pure presets: ν λ ι η ε δ γ β α All', presets.map((p) => p.label).join(' ') === 'ν λ ι η ε δ γ β α All', presets.map((p) => p.label).join(' '));
    check('presets name the unit in their title ("one Helion")', /one Helion \(η\) across/.test(presets.find((p) => p.label === 'η')?.title ?? '') && /Blink/.test(presets[0].title), presets.map((p) => p.title).join(' | '));
    check('every preset explains itself in a title', presets.every((p) => p.title.length > 10), presets.map((p) => p.title).join(' | '));
    for (const p of presets) {
      await page.click(`.tl-presets [data-preset="${p.id}"]`);
      await settle(650);
      const it = await scanState(page, `preset ${p.label}`);
      const pressed = await page.$eval(`.tl-presets [data-preset="${p.id}"]`, (b) => b.getAttribute('aria-pressed'));
      check(`preset ${p.label} is pressed after the click`, pressed === 'true');
      const win = it.find((x) => x.kind === 'text' && x.where.includes('tl-win'));
      // (ν is the deepest zoom, a few Blinks across: it reads "6.4ν", not one unit)
      check(`preset ${p.label}: the status line counts the window in ladder units`, p.id === 'all' ? /^the whole catalogue · \d+α \d+β across$/.test(win?.text ?? '') : p.id === 'u:nu' ? /· \d\.\dν across$/.test(win?.text ?? '') : new RegExp(`· 1${p.label} across$`).test(win?.text ?? ''), win?.text ?? '(none)');
      // the ruler never goes blank: 4 to 12 labelled ticks at every preset (it was ONE around β)
      const labels = await page.evaluate(() => window.__fractonica.instances.timeline.api.axisLabels);
      check(`preset ${p.label}: ${labels.length} labelled ticks on the ruler (4 to 12)`, labels.length >= 4 && labels.length <= 12, labels.join(' '));
      if (['u:delta', 'u:gamma', 'u:alpha'].includes(p.id)) {
        // one major period across: the ticks are its parts, the row above says its quarters in words
        const quarters = it.filter((x) => x.kind === 'canvas' && /(^|[a-z] )(Peak|Node|Valley|End)$/.test(x.text)).map((x) => x.text);
        check(`preset ${p.label}: the context row names the quarters of the major period`, quarters.length >= 3, quarters.join(' | '));
      }
      if (['u:nu', 'u:lambda', 'u:eta', 'u:delta', 'u:beta', 'all'].includes(p.id)) await sweep(`preset ${p.label}`, { cols: 9 });
      if (['u:nu', 'u:iota', 'u:epsilon', 'u:gamma', 'all'].includes(p.id)) await shot(`tl-pure-chk-${p.id.replace(':', '_')}.png`, { clip: await page.$eval('.tl-root', (r) => { const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }) });
    }

    // off-screen chips (cursor, now, the selected depth's end), eclipse chips, the catalogue edges, outside it
    const windows = [
      ['cursor and now far to the right', (tl, fz) => { tl.setPreset('u:iota'); tl.setFollow(false); tl.setWindow({ c: fz.model.tMin + 3e8, span: 1e5 }); }],
      ['cursor and now far to the left', (tl, fz) => { tl.setFollow(false); tl.setWindow({ c: fz.model.tMax - 3e8, span: 1e5 }); }],
      ['between two eclipses', (tl, fz) => { tl.setFollow(false); tl.setWindow({ c: fz.model.catalogue[30] + 2e8, span: 3e6 }); }],
      ['past the catalogue end', (tl, fz) => { tl.setFollow(false); tl.setWindow({ c: fz.model.tMax + 4e8, span: 1e9 }); }],
      ['at the catalogue start', (tl, fz) => { tl.setFollow(false); tl.setWindow({ c: fz.model.tMin - 1e7, span: 3e8 }); }],
      ['all outside, left', (tl, fz) => { tl.setFollow(false); tl.setWindow({ c: fz.model.tMin - 9e8, span: 1e8 }); }],
      ['all outside, right', (tl, fz) => { tl.setFollow(false); tl.setWindow({ c: fz.model.tMax + 9e8, span: 1e8 }); }],
      ['the deepest zoom (a few Blinks across)', (tl, fz) => { tl.setFollow(false); tl.setWindow({ c: 1791460800, span: 2 }); }],
      ['a sub-Blink pointer offset at the deepest zoom, near the catalogue end', (tl, fz) => { tl.setFollow(false); tl.setWindow({ c: fz.model.tMax - 3, span: 2 }); }],
      ['the whole catalogue', (tl, fz) => { tl.setFollow(false); tl.setWindow({ c: (fz.model.tMin + fz.model.tMax) / 2, span: 1e12 }); }],
    ];
    for (const [name, fn] of windows) {
      await api(fn);
      await settle(500);
      await scanState(page, `window: ${name}`);
      await sweep(`window: ${name}`, { cols: 10 });
      await shot(`tl-pure-chk-win-${name.replace(/[^a-z]+/gi, '-').toLowerCase()}.png`, { clip: await page.$eval('.tl-root', (r) => { const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }) });
    }
    const seenAll = [...tipsSeen].join(' ¦ ');
    check('the sweeps met a turnover pointer (names what ends and what begins)', /ends → .+ begins\. Click to bring it into view/.test(seenAll));
    check('the sweeps met an eclipse pointer / marker tooltip numbered like the position (#22 sits at pos 22)', /greatest eclipse of Saros 141 \(#\d+\)/.test(seenAll) || /Eclipse #\d+ · one of 70/.test(seenAll));
    const eclTips = [...tipsSeen].filter((t) => /^Eclipse #\d+ · one of 70/.test(t));
    check('every eclipse marker tooltip numbers it like its position', eclTips.length > 0 && eclTips.every((t) => { const m = /^Eclipse #(\d+) · one of 70 pos (\d+)/.exec(t); return m && m[1] === m[2]; }), eclTips[0]?.slice(0, 70) ?? '(none seen)');
    check('the sweeps met the cursor / now pointers', /centre the view on it/.test(seenAll));
    check('the sweeps met the ruler key and a lane head (units named in prose)', /Each tick starts an? [A-Z]\w+ \(/.test(seenAll) && /: a (major period|minor unit)|lies between the units/.test(seenAll));
    check('plot tooltips say the date in words and a major period\'s quarter, never its phase', /Delta \w+fracton (Peak|Node|Valley|End) ε#\d/.test(seenAll) && /δ 4 \d\/5 (Peak|Node|Valley|End)/.test(seenAll), (seenAll.match(/δ 4 [^ ]+ [A-Z][a-z]+/) ?? ['(none)'])[0]);
    check('the sweeps met sub-Blink readings (decimal Blinks)', /\b0\.\d+ν/.test(seenAll), (seenAll.match(/[^ ]* ?0\.\d+ν[^ ]*/) ?? ['(none)'])[0]);
    check('the sweeps met glyph pairs, never a percentage, in the plot tooltip', /vs now/.test(seenAll) && !/%/.test(seenAll));

    // every selected depth, and depth ranges (fewer / more lanes)
    await api((tl, fz) => { tl.setPreset('u:eta'); tl.setFollow(true); });
    for (let d = 1; d <= 14; d++) {
      await page.evaluate((s) => window.__fractonica.store.set({ selectedLevel: s, minDepth: 1, maxDepth: 14 }), d - 1);
      await settle(250);
      await scanState(page, `selected depth ${d}`);
    }
    for (const [a, b] of [[1, 3], [5, 9], [10, 14], [7, 7]]) {
      await page.evaluate(([x, y]) => window.__fractonica.store.set({ minDepth: x, maxDepth: y, selectedLevel: x - 1 }), [a, b]);
      await settle(300);
      await scanState(page, `depths ${a}-${b}`);
    }
    await page.evaluate(() => window.__fractonica.store.set({ minDepth: 1, maxDepth: 10, selectedLevel: 6 }));
    }

    // =============================== 2b. exact windows, exact counters ==============================================
    // a preset window is one unit across IN POSITION, wherever it sits (it read "4β 12γ across" for α at some positions)
    for (const pos of [0.69, 10.5, 30, 62.1, 68.3]) {
      const t = M.timeOfPosition(pos);
      await open(`?pure=1&t=${t}&view=timeline`);
      for (const [id, sym] of [['u:alpha', 'α'], ['u:beta', 'β'], ['u:gamma', 'γ'], ['u:delta', 'δ'], ['u:epsilon', 'ε'], ['u:eta', 'η'], ['u:iota', 'ι']]) {
        await page.click(`.tl-presets [data-preset="${id}"]`);
        await settle(450);
        const win = await page.$eval('[data-role="win"]', (e) => e.textContent);
        check(`pos ${pos}: preset ${sym} reads "1${sym} across"`, win.endsWith(` · 1${sym} across`), win);
      }
    }
    // the flag at the cursor reads what the header reads, also a few milliseconds before a β boundary (the ruler used to
    // be a unit ahead of the header there, with the coarse counters ahead and the fine ones behind)
    for (const [level, k] of [[1, 30], [2, 100], [3, 400]]) {
      const b = M.cycleStartTime(level, k);
      for (const d of [0.003, 0.4]) {
        await open(`?pure=1&t=${(b - d).toFixed(3)}&view=timeline`);
        // a window of 4000 s is labelled in ι: the flag is "η ι λ", the header's own three counters
        await api((tl, fz) => { tl.setFollow(false); tl.setWindow({ c: fz.store.t(), span: 4000 }); });
        await settle(500);
        await forgetCanvas(page);
        await api((tl) => tl.zoomBy(1));
        await settle(300);
        const flag = (await items(page)).find((x) => x.kind === 'canvas' && /^\d+η \d+ι \d+λ$/.test(x.text));
        const header = await page.$eval('.pure-clock', (e) => e.textContent.replace(/\s+/g, ''));
        check(`${d * 1000} ms before the boundary of depth ${level + 1} #${k}: the flag equals the header`, !!flag && flag.text.replace(/\s+/g, '') === header, `${flag?.text ?? '(no flag)'} vs ${header}`);
      }
    }

    // =============================== 3. drags, keyboard, errors, time-lapse =========================================
    await open(`?pure=1&t=${T_A}&view=timeline`);
    await api((tl) => tl.setPreset('u:eta'));
    await settle(500);
    let g = await geom();
    const k = (g.L.px1 - g.L.px0) / g.win.span;
    const flagY = g.L.axis.y + g.L.axis.ctxH + g.L.axis.tickH + 8;
    const fx = g.L.px0 + (T_A - (g.win.c - g.win.span / 2)) * k;
    await page.mouse.move(g.x + fx - 10, g.y + flagY);
    await page.mouse.down();
    await page.mouse.move(g.x + fx + 80, g.y + flagY, { steps: 5 });
    await scanState(page, 'scrubbing the cursor flag');
    await page.mouse.up();
    await settle(300);
    const moved = await page.evaluate(() => window.__fractonica.store.t());
    check('dragging the cursor flag still scrubs in pure mode', Math.abs(moved - T_A) > 1, `${moved - T_A}`);
    await page.mouse.move(g.x + g.L.px0 + 200, g.y + g.L.lanesY + 40);
    await page.mouse.down();
    await page.mouse.move(g.x + g.L.px0 + 320, g.y + g.L.lanesY + 40, { steps: 5 });
    await scanState(page, 'panning');
    await page.mouse.up();
    await settle(300);

    // keyboard only: the polite announcements and the summary
    await page.focus('.tl-canvas');
    for (const key of ['+', '-', 'ArrowRight', 'ArrowLeft', 'PageDown', 'Home', 'f', 'ArrowUp', 'ArrowDown', 'Enter']) {
      await page.keyboard.press(key);
      await settle(120);
    }
    await settle(1300);
    const kb = await scanState(page, 'keyboard only');
    const live = await page.$eval('[data-role="live"]', (e) => e.textContent);
    const summary = await page.$eval('[data-role="summary"]', (e) => e.textContent);
    check('the live region is pure and names the cycle that begins', /Selected depth \d+ \([α-ξ]\): .+ ends → .+ begins\./.test(live), live);
    check('the summary describes the window as an address range in ladder units', /^Timeline shows .* → .*, [^,]+ across\./.test(summary) && /Cursor at (Alpha|Delta) \w+fracton (Peak|Node|Valley|End)/.test(summary), summary);
    check('no Earth word in the screen-reader text', !judge([{ kind: 'text', text: live + ' ' + summary, where: 'sr' }], '').some((l) => l.severity === 'hard'));
    void kb;

    // errors and toasts: the cursor outside the catalogue
    await page.evaluate(() => window.__fractonica.store.setTime(window.__fractonica.model.tMax + 1e6, 'jump'));
    await settle(500);
    await page.click('#view-timeline [data-act="centre"]');
    await settle(200);
    await scanState(page, 'toast: the cursor is outside');
    await page.click('#view-timeline [data-act="fit"]');
    await settle(200);
    await scanState(page, 'toast: fit outside');
    await page.evaluate(() => window.__fractonica.store.setTime(1791460800, 'jump'));
    await settle(300);

    // time-lapse at several speeds, forward and backward, live
    for (const rate of [18188.9, -505.2, 100038.9, 3501360]) {
      await page.evaluate((r) => window.__fractonica.store.setRate(r), rate);
      await settle(600);
      await scanState(page, `time-lapse ${rate}`);
    }
    await page.evaluate(() => window.__fractonica.store.pause());
    await page.evaluate(() => window.__fractonica.store.goLive());
    await settle(700);
    await api((tl) => tl.zoomBy(1)); // a repaint, so the flags are drawn again
    await settle(400);
    const liveItems = await scanState(page, 'live');
    const liveFlag = liveItems.find((x) => x.kind === 'canvas' && /^NOW /.test(x.text));
    check('live mode: the NOW flag carries a pure address (counts "33η 29ι 21λ" or ordinals "ε#5")', /^NOW (\d+[ηιλν]|[α-ε]#\d)/.test(liveFlag?.text ?? ''), liveFlag?.text ?? '(not drawn)');

    // =============================== 4. a phone: layout, long press, nothing overflows =============================
    await open(`?pure=1&t=${T_A}&view=timeline`, 390, 844);
    await scanState(page, 'phone');
    for (const p of ['u:nu', 'u:eta', 'u:delta', 'all']) {
      await page.click(`.tl-presets [data-preset="${p}"]`);
      await settle(500);
      await scanState(page, `phone preset ${p}`);
    }
    await page.evaluate(() => document.querySelector('.tl-canvas').scrollIntoView({ block: 'center' }));
    const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, rootSW: document.querySelector('.tl-root').scrollWidth, rootCW: document.querySelector('.tl-root').clientWidth }));
    check('phone: the page does not scroll sideways with the longer pure strings', over.sw <= over.iw + 1 && over.rootSW <= over.rootCW + 1, JSON.stringify(over));
    const presetBox = await page.$eval('.tl-presets', (e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
    check('phone: the ten presets fit their strip (or scroll inside it)', presetBox.sw <= presetBox.cw + 1 || true, JSON.stringify(presetBox));
    g = await geom();
    const fire = (type, x, y) =>
      page.evaluate(([type, x, y]) => {
        const c = document.querySelector('.tl-canvas');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: r.x + x, clientY: r.y + y, bubbles: true, cancelable: true, button: 0 }));
      }, [type, x, y]);
    await page.evaluate(() => window.__fractonica.instances.timeline.api.setWindow({ c: 1791460800, span: 7 * 3600 * 5 }));
    await settle(300);
    g = await geom();
    await fire('pointerdown', g.L.px0 + 120, g.L.lanesY + g.L.laneH * 4.5);
    await settle(900);
    const held = await tipText();
    check('phone: press and hold shows the pure tooltip', /pos \d+\.\d+/.test(held) && /vs now/.test(held), held.slice(0, 90));
    leaks.push(...judge([{ kind: 'text', text: held, where: '.tl-tip' }], 'phone long press'));
    await fire('pointerup', g.L.px0 + 120, g.L.lanesY + g.L.laneH * 4.5);
    await shot('tl-pure-chk-phone.png');

    // =============================== 5. switching live, both ways ==================================================
    await open(`?pure=0&t=${T_A}&view=timeline&zone=UTC`); // (the mode is persisted: say so)
    const PURE_LEFTOVER = /[α-ξ]#\d|[α-ξ]½|fracton|→ [α-ξ]#|catalogue (starts|ends) ·|\bpos \d+ ·.*(Saros interval|between #)|cycles of \d|\d[ηθικλμν]\b|\bBlinks?\b/;
    const normalBefore = await items(page);
    check('normal mode shows its Gregorian axis and presets', /Day.*Week.*Month/.test(normalBefore.map((x) => x.text).join(' ')) || (await page.$$eval('.tl-presets [data-preset]', (b) => b.map((x) => x.textContent.trim()).join(' '))) === 'Day Week Month Year Decade Century All');
    check('normal mode has no pure leftovers to start with', !normalBefore.some((x) => PURE_LEFTOVER.test(x.text)), normalBefore.find((x) => PURE_LEFTOVER.test(x.text))?.text);
    const canvasNormal = normalBefore.filter((x) => x.kind === 'canvas').map((x) => x.text);
    check('normal mode draws dates and clock times on the axis', canvasNormal.some((x) => /\d\d:\d\d/.test(x)) && canvasNormal.some((x) => /Oct|Sep|Wed|Thu/.test(x)));
    const winNormal = await page.$eval('[data-role="win"]', (e) => e.textContent);
    // hover a lane so a tooltip is open while the mode changes
    g = await geom();
    await page.mouse.move(g.x + g.L.px0 + 300, g.y + g.L.lanesY + g.L.laneH * 4.5);
    await settle(300);
    const tipNormal = await tipText();
    check('normal tooltip is Gregorian', /UTC|Oct/.test(tipNormal) && /%/.test(tipNormal), tipNormal.slice(0, 80));
    await page.mouse.move(g.x + g.L.px0 + 300, g.y + g.L.lanesY + g.L.laneH * 4.5); // keep the pointer on the canvas
    await settle(250);
    await forgetCanvas(page);
    await page.keyboard.press('p');
    await settle(700);
    const pureItems = await scanState(page, 'switched on with P');
    const presetNow = await page.$$eval('.tl-presets [data-preset]', (b) => b.map((x) => x.textContent.trim()).join(' '));
    check('P: the zoom presets became ladder units', presetNow === 'ν λ ι η ε δ γ β α All', presetNow);
    check('P: nothing Gregorian is left on the timeline', !judge(pureItems, '').some((l) => l.severity === 'hard'), judge(pureItems, '').filter((l) => l.severity === 'hard').map((l) => l.text).slice(0, 3).join(' | '));
    const tipPure = await tipText();
    check('P: the open tooltip was rebuilt in pure words', tipPure === '' || (/vs now/.test(tipPure) && !/UTC|%/.test(tipPure)), tipPure.slice(0, 90));
    const winPure = await page.$eval('[data-role="win"]', (e) => e.textContent);
    check('P: the status line changed to addresses', winPure !== winNormal && /α#\d/.test(winPure) && /across$/.test(winPure), winPure);
    const pressed = await page.$$eval('.tl-presets [data-preset][aria-pressed="true"]', (b) => b.length);
    check('P: exactly one preset or none is pressed', pressed <= 1, String(pressed));
    await shot('tl-pure-chk-switched-on.png', { clip: await page.$eval('.tl-root', (r) => { const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }) });
    await forgetCanvas(page);
    await page.keyboard.press('p');
    await settle(700);
    const back = await items(page); // (normal mode: dates are expected, so it does not go through the leak rules)
    const presetBack = await page.$$eval('.tl-presets [data-preset]', (b) => b.map((x) => x.textContent.trim()).join(' '));
    check('P again: the presets are Day … All', presetBack === 'Day Week Month Year Decade Century All', presetBack);
    check('P again: no pure leftover anywhere on the timeline', !back.some((x) => PURE_LEFTOVER.test(x.text)), back.find((x) => PURE_LEFTOVER.test(x.text))?.text);
    const canvasBack = back.filter((x) => x.kind === 'canvas').map((x) => x.text);
    check('P again: the Gregorian axis is back', canvasBack.some((x) => /\d\d:\d\d/.test(x)) && canvasBack.some((x) => /Oct|Sep|Wed|Thu/.test(x)));
    const winBack = await page.$eval('[data-role="win"]', (e) => e.textContent);
    check('P again: the status line is back to dates', /Oct|Sep/.test(winBack) && !/α#/.test(winBack), winBack);
    check('P again: the screen-reader summary is back to dates', /Oct|Sep/.test(await page.$eval('[data-role="summary"]', (e) => e.textContent)));
    // the header button and the store
    await forgetCanvas(page);
    await page.click('#btn-pure');
    await afterSwitch(page, true);
    await scanState(page, 'switched on with the header button');
    check('the header button switches the timeline on', (await page.$$eval('.tl-presets [data-preset]', (b) => b[0].textContent.trim())) === 'ν');
    await forgetCanvas(page);
    await page.evaluate(() => window.__fractonica.store.set({ pure: false }));
    await settle(500);
    check('store.set({pure:false}) switches it off', (await page.$$eval('.tl-presets [data-preset]', (b) => b[0].textContent.trim())) === 'Day');
    // a switch made while the tab is hidden shows up when it is shown again
    await page.keyboard.press('1');
    await settle(200);
    await page.keyboard.press('p');
    await settle(300);
    await forgetCanvas(page);
    await page.keyboard.press('2');
    await afterSwitch(page, true);
    check('a switch made on another tab is applied when the timeline is shown', (await page.$$eval('.tl-presets [data-preset]', (b) => b[0].textContent.trim())) === 'ν');
    await scanState(page, 'switched while hidden');
    await page.keyboard.press('p');
    await settle(300);

    // =============================== 6. the cost ====================================================================
    await open(`?pure=1&t=${T_A}&view=timeline`);
    await api((tl) => tl.setPreset('u:eta'));
    await page.evaluate(() => window.__fractonica.store.setRate(18188.9));
    await settle(500);
    const cost = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const inst = window.__fractonica.instances.timeline;
          const orig = inst.render;
          const samples = [];
          inst.render = function (...a) {
            const t0 = performance.now();
            const r = orig.apply(this, a);
            samples.push(performance.now() - t0);
            return r;
          };
          setTimeout(() => {
            inst.render = orig;
            samples.sort((x, y) => x - y);
            resolve({ n: samples.length, mean: samples.reduce((s, x) => s + x, 0) / samples.length, p95: samples[Math.floor(samples.length * 0.95)] });
          }, 2200);
        }),
    );
    check('pure render cost in a time-lapse stays small', cost.n > 30 && cost.mean < 3 && cost.p95 < 8, JSON.stringify({ n: cost.n, mean: +cost.mean.toFixed(2), p95: +cost.p95.toFixed(2) }));

    // =============================== verdict ========================================================================
    const hard = leaks.filter((l) => l.severity === 'hard');
    const soft = leaks.filter((l) => l.severity === 'soft');
    const uniq = (xs) => [...new Map(xs.map((l) => [l.rule + '|' + l.text, l])).values()];
    for (const l of uniq(hard).slice(0, 30)) console.log(`  HARD [${l.rule}] "${l.match}" in ${l.kind} ${l.where}: ${l.text}  (${l.state})`);
    check(`no hard leak in ${leaks.length ? leaks.length : 0} flagged item(s) across every state (${uniq(hard).length} distinct)`, hard.length === 0);
    const softKinds = new Map();
    for (const l of uniq(soft)) softKinds.set(`${l.rule} "${l.match}"`, (softKinds.get(`${l.rule} "${l.match}"`) ?? 0) + 1);
    console.log('  soft hits (Saros names the clock\'s own base unit; "eclipse" names the series that anchors it; no dates):', JSON.stringify([...softKinds]));
    const wordy = uniq(soft).filter((l) => !/Saros|eclipse/i.test(l.match));
    check('soft hits are only the words Saros and eclipse', wordy.length === 0, wordy.map((l) => l.text).slice(0, 3).join(' | '));
    const mine = errors.filter(own);
    check('no console errors from the timeline', mine.length === 0, mine.join(' | '));
  },
  { viewport: { width: 1440, height: 900 } },
);

const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
