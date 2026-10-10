// Pure-mode verification of the rings view in headless Chromium.
//   node tools/checks/check-rings-pure.mjs [--shots]
// Everything a user can see or hear described inside the rings view (visible text, every title / aria attribute, the
// tooltip, canvas text of the dial and of the wave, the live region) is run through the leak rules of
// tools/pure-scan.mjs in many states the generic sweep cannot reach: all 14 selected depths, depth ranges, the
// catalogue edges, an out-of-range frame, scrubbing and keyboard use, a touch hold, time-lapse (glow rings), the
// compact dial of a phone, a clipped last cycle. It also asserts the positive behaviour (names, countdowns, glyph
// pairs), live switching in both directions with nothing left behind, and prints the cost of a pure-mode render.
// Prints PASS/FAIL per check, exits non-zero on any failure. --shots writes screenshots to tools/out/.
import path from 'node:path';
import { withApp, outDir } from '../browse.mjs';
import { RULES, installHooks, scan, formatLeaks } from '../pure-scan.mjs';

const SHOTS = process.argv.includes('--shots');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const A = 1791460800; // SPEC vector A
const TMIN = -11253795486;
const TMAX = 28005212035;
const QUIET = '.topbar{position:static!important}';

/** Words that only exist in pure mode: none of them may survive in normal mode. */
const PURE_ONLY = /fracton|[δεζ]½|[α-ξ]#\d|\d·\d|→ end of the catalogue|\bbeats?\b|\d+[ηιλμνξ]\b/;

// ---------------------------------------------------------------------------------------------
// collection: everything visible inside the rings view, tagged canvas text, attributes of every kind
// ---------------------------------------------------------------------------------------------
async function install(page) {
  await installHooks(page); // the generic scanner's canvas hook (used by scan())
  await page.addInitScript(() => {
    window.__ringsCanvas = new Set();
    const wrap = (name) => {
      const orig = CanvasRenderingContext2D.prototype[name];
      CanvasRenderingContext2D.prototype[name] = function (text, ...rest) {
        try {
          const cls = this.canvas?.className?.baseVal ?? this.canvas?.className ?? '';
          if (/\brings-/.test(cls)) window.__ringsCanvas.add(`${cls.split(' ').find((c) => /^rings-/.test(c))}|${text}`);
        } catch {
          /* ignore */
        }
        return orig.call(this, text, ...rest);
      };
    };
    wrap('fillText');
    wrap('strokeText');
  });
}

async function collectRings(page) {
  return page.evaluate(() => {
    const items = [];
    const visible = (el) => {
      if (!el.isConnected || el.closest('[hidden]')) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      return el.getClientRects().length > 0;
    };
    const where = (el) => ((el.id ? '#' + el.id : '') + [...(el.classList ?? [])].slice(0, 2).map((c) => '.' + c).join('')) || el.tagName.toLowerCase();
    const add = (kind, text, el) => {
      const t = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (t) items.push({ kind, text: t, where: el ? where(el) : '' });
    };
    const roots = [document.querySelector('#view-rings'), ...document.querySelectorAll('.rings-tip')].filter(Boolean);
    for (const r of roots) {
      const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || !visible(el)) continue;
        add('text', n.nodeValue, el);
      }
      for (const el of [r, ...r.querySelectorAll('*')]) {
        if (!el.getAttributeNames || !visible(el)) continue;
        for (const a of el.getAttributeNames()) {
          if (a === 'class' || a === 'style' || a === 'id' || a === 'd' || a === 'viewBox' || a.startsWith('data-') || a === 'type' || a === 'role' || a === 'tabindex' || a === 'width' || a === 'height' || a === 'xmlns' || a === 'fill' || a === 'stroke' || a === 'points' || a.startsWith('stroke') || a === 'transform') continue;
          add('attr:' + a, el.getAttribute(a), el);
        }
      }
      for (const t of r.querySelectorAll('svg title')) add('svg-title', t.textContent, t.parentElement);
    }
    // the live region is visually hidden but read aloud
    for (const l of document.querySelectorAll('.rings-live')) add('text', l.textContent, l);
    for (const c of window.__ringsCanvas ?? []) add('canvas', c.split('|').slice(1).join('|'), null);
    window.__ringsCanvas = new Set();
    return items;
  });
}

function judgeRings(items, state) {
  const out = [];
  for (const it of items) {
    for (const [rule, re, severity] of RULES) {
      const m = re.exec(it.text);
      if (m) out.push({ rule, severity, match: m[0], text: it.text.length > 160 ? it.text.slice(0, 157) + '…' : it.text, kind: it.kind, where: it.where, state });
    }
  }
  return out;
}

const hardLeaks = [];
const softLeaks = [];
const seenTexts = new Set();
/** Scan the rings view (and its tooltip) in the current state. */
async function sweep(page, state, { judge = true } = {}) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const items = await collectRings(page);
  if (!judge) return items; // normal mode is allowed to say Gregorian things
  for (const it of items) seenTexts.add(it.text);
  for (const l of judgeRings(items, state)) (l.severity === 'hard' ? hardLeaks : softLeaks).push(l);
  return items;
}
/** Repaint the canvases (they only draw text when something changed) and scan. */
async function sweepFresh(page, state, o) {
  await page.evaluate(() => window.__fractonica.instances.rings.setActive(true));
  await page.waitForTimeout(160);
  return sweep(page, state, o);
}

const boot = async (page, url, query) => {
  await page.goto(url(query));
  await page.addStyleTag({ content: QUIET });
  await page.waitForFunction(() => window.__fractonica?.instances?.rings?.inspect?.().layout, null, { timeout: 8000 });
  await page.waitForTimeout(450);
};
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? null, sel);
const textAll = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, ' ').trim()), sel);
const tipText = (page) => page.evaluate(() => { const t = document.querySelector('.rings-tip'); return t && !t.hidden ? t.innerText.replace(/\s+/g, ' ').trim() : ''; });
const insp = (page) => page.evaluate(() => window.__fractonica.instances.rings.inspect());
const dialPoint = (page, ring, phase, radial = 0.5) =>
  page.evaluate(([ring, phase, radial]) => {
    const c = document.querySelector('.rings-layer-live');
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    const { layout } = window.__fractonica.instances.rings.inspect();
    const k = r.width / layout.size;
    const slot = layout.rings[ring];
    const rad = slot.inner + radial * layout.band;
    const a = phase * 2 * Math.PI;
    return { x: r.left + (layout.cx + rad * Math.sin(a)) * k, y: r.top + (layout.cy - rad * Math.cos(a)) * k };
  }, [ring, phase, radial]);
const wavePoint = (page, phase) =>
  page.evaluate((phase) => {
    const c = document.querySelector('.rings-wave');
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    const { wave } = window.__fractonica.instances.rings.inspect();
    return { x: r.left + wave.x0 + phase * (wave.x1 - wave.x0), y: r.top + (wave.y0 + wave.y1) / 2 };
  }, phase);
const setStore = (page, patch) => page.evaluate((p) => window.__fractonica.store.set(p), patch);
const costOf = (page) =>
  page.evaluate(async () => {
    const inst = window.__fractonica.instances.rings;
    const orig = inst.render;
    const times = [];
    inst.render = (f, i) => {
      const t0 = performance.now();
      orig(f, i);
      times.push(performance.now() - t0);
    };
    await new Promise((r) => setTimeout(r, 2200));
    inst.render = orig;
    times.sort((a, b) => a - b);
    return { frames: times.length, median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)], max: times.at(-1) };
  });

// ---------------------------------------------------------------------------------------------
await withApp(
  async ({ page, url, errors, shot }) => {
    await install(page);
    page.setDefaultTimeout(6000);
    const own = () => errors.filter((e) => /rings|dial\.js|wave\.js|geometry\.js|text\.js|canvas\.js|pure-text/.test(e));
    const genericLeaks = []; // the shared scanner, restricted to places that belong to this view

    // ------------------------------------------------------------------ vector A: the whole view, read closely
    await boot(page, url, `?pure=1&t=${A}&view=rings`);
    let items = await sweepFresh(page, 'vector A');
    const generic = await scan(page, 'rings @ vector A');
    genericLeaks.push(...generic.filter((l) => /rings-/.test(l.where)));
    const all = items.map((i) => i.text).join(' | ');
    check('name of the selected cycle is the canonical one', (await text(page, '.rings-cn-name')) === 'Eta Monofracton', await text(page, '.rings-cn-name'));
    check('pill carries depth chip, counter, phase word and next threshold', /^η 7 · 1\/11 · [↗↘▲▼] (Rising|Falling|Peak|Valley) · to \w+$/.test(await text(page, '.rings-cn-phase')), await text(page, '.rings-cn-phase'));
    // two units, like Up next / ladder / face: a third one is added only while it stays steady (never finer than λ)
    check('centre countdown is two units (6ι 43λ), the same string as Up next', /^\d+ι \d+λ$/.test(await text(page, '.rings-count')) && (await text(page, '.rings-count')) === (await text(page, '.rings-chip[data-q="3"] .rings-chip-in')), `${await text(page, '.rings-count')} / ${await text(page, '.rings-chip[data-q="3"] .rings-chip-in')}`);
    check('the end is the cycle that begins', (await text(page, '.rings-end')) === '→ Eta Difracton', await text(page, '.rings-end'));
    const chipIn = await textAll(page, '.rings-chip-in');
    check('every quarter chip has a countdown, passed ones are negative', chipIn.length === 4 && chipIn.every(Boolean) && chipIn.slice(0, 3).every((c) => c.startsWith('−')) && !chipIn[3].startsWith('−'), chipIn.join(' | '));
    const chipTitles = await page.evaluate(() => [...document.querySelectorAll('.rings-chip')].map((c) => c.title));
    check('chip titles name the cycle they belong to', chipTitles.every((t) => /of Eta Monofracton/.test(t)) && /Eta Difracton begins/.test(chipTitles[3]), chipTitles[3]);
    check('the phase is two glyphs (2 x 2 SVG), not a percentage', (await page.locator('.rings-wh-pct .pure-pair svg').count()) === 2 && !/%/.test(all));
    check('the pair label reads digits, not a percentage', /^phase \d+·\d+$/.test(await text(page, '.rings-wh-pctl')), await text(page, '.rings-wh-pctl'));
    check('the single glyph is hidden (the pair shows it)', await page.evaluate(() => getComputedStyle(document.querySelector('.rings-glyph')).display === 'none'));
    const facts = await page.evaluate(() => ({ s: document.querySelector('.rings-f-start').innerText, e: document.querySelector('.rings-f-end').innerText, l: document.querySelector('.rings-f-len').innerText, a: document.querySelector('.rings-f-addr').innerText.replace(/\s+/g, ' ') }));
    check('facts: started / ends / length / address are pure', /ago/.test(facts.s) && /→ Eta Difracton/.test(facts.e) && /^1η$/.test(facts.l) && /α#6.*β#4.*γ#9.*δ#3.*ε#5.*ζ#4.*η#1/.test(facts.a), JSON.stringify(facts));
    check('facts: ordinals are X#n (ε½#4 · ζ½#7), counters nX (0η 0ι), never "ε½ 4"', /ε½#\d+ · ζ½#\d+/.test(facts.s) && /^0η 0ι$/m.test(facts.s) && !/[δεζ]½ \d/.test(facts.s + facts.e), JSON.stringify([facts.s, facts.e]));
    const glyphFact = await text(page, '.rings-f-glyph');
    check('glyph fact is spoken as two digits ("phase 13 and 0 of 256"), not "13·0"', /^phase \d+ and \d+ of 256 ?value [+−]?\d+/.test(glyphFact) && !/\d·\d/.test(glyphFact), glyphFact);
    const pairNames = await page.evaluate(() => [...document.querySelectorAll('#view-rings .pure-pair')].map((e) => e.getAttribute('aria-label')));
    check('pair labels are the helper\'s words and glyph svgs carry no title', pairNames.length > 0 && pairNames.every((n) => /^phase \d+ and \d+ of 256$/.test(n)) && (await page.locator('#view-rings .pure-pair svg title').count()) === 0, pairNames.join(' | '));
    check('the visible digit caption under the pair is hidden from screen readers (the pair has the words)', (await page.getAttribute('.rings-wh-pctl', 'aria-hidden')) === 'true');
    const slider = await page.evaluate(() => { const w = document.querySelector('.rings-wave'); return { max: w.getAttribute('aria-valuemax'), now: w.getAttribute('aria-valuenow'), txt: w.getAttribute('aria-valuetext') }; });
    check('slider semantics: 0..255 and a pure value text', slider.max === '255' && Number(slider.now) >= 0 && Number(slider.now) <= 255 && /of 256 in Eta Monofracton$/.test(slider.txt), JSON.stringify(slider));
    check('wave boundary labels are coordinates on the ladder', [...seenTexts].some((t) => /^0η 9ι$/.test(t)) && [...seenTexts].some((t) => /^0η 18ι$/.test(t)), '');
    const unitWords = /\b(second|minute|hour|day|week|month|year)s?\b/i;
    check('no Earth unit word anywhere in the view', !unitWords.test(all));
    if (SHOTS) await shot('rings-pure-A-desktop.png', { fullPage: true });

    // help open
    await page.click('.rings-help-btn');
    await page.waitForTimeout(150);
    items = await sweep(page, 'help open');
    const help = await text(page, '.rings-help');
    check('help panel is in pure vocabulary', /Eta Monofracton/.test(help) && /256 states/.test(help) && !/Gregorian|zone|years/.test(help), help.slice(0, 120));
    check('help says counters count from 0 and names from 1, and points to the glossary', /Counters \(η ι λ\) count from 0 and names \(.*\) from 1/.test(help) && /Press \? for the glossary\./.test(help), help.slice(-200));
    if (SHOTS) await shot('rings-pure-help.png', { fullPage: true });

    // ------------------------------------------------------------------ every depth selected, several instants
    const NOMINAL = ['1α', '1β', '1γ', '2δ½', '2ε½', '2ζ½', '1η', '4ι', '1ι', '13λ', '1λ', '1μ', '1ν', '1ξ'];
    const lengths = [];
    for (const sel of Array.from({ length: 14 }, (_, i) => i)) {
      await setStore(page, { selectedLevel: sel, minDepth: 1, maxDepth: 14 });
      await sweepFresh(page, `selected depth ${sel + 1}`);
      lengths.push(await text(page, '.rings-f-len'));
    }
    check('LENGTH of the selected cycle is its exact nominal length at every depth 1-14', lengths.join(' ') === NOMINAL.join(' '), lengths.join(' '));
    await setStore(page, { selectedLevel: 6, minDepth: 1, maxDepth: 10 });
    const instants = [['year 2000', 946684800], ['year 2061', 2886085800], ['catalogue start', TMIN + 5], ['catalogue end', TMAX - 5], ['clipped alpha', TMAX - 3e8]];
    for (const [name, t] of instants) {
      await boot(page, url, `?pure=1&t=${t}&view=rings`);
      for (const sel of [0, 2, 5, 6, 9, 12]) {
        await setStore(page, { selectedLevel: sel });
        await sweepFresh(page, `${name} · depth ${sel + 1}`);
      }
      if (name === 'catalogue end') {
        // a threshold on the closing edge is labelled with the exact end position, not with the unit before it
        await setStore(page, { selectedLevel: 8, minDepth: 1, maxDepth: 12 });
        await page.waitForTimeout(200);
        const endChip = await page.evaluate(() => document.querySelector('.rings-chip[data-q="3"] .rings-chip-time').textContent.replace(/\s+/g, ' ').trim());
        check('catalogue end: the end chip of the last ι reads 8η 9ι 0λ (it read 8η 8ι 64λ)', /8η 9ι 0λ$/.test(endChip), endChip);
        await setStore(page, { selectedLevel: 0, minDepth: 1, maxDepth: 10 });
        await page.waitForTimeout(150);
        const e = await text(page, '.rings-end');
        check('at the catalogue end the last cycle is followed by nothing: "→ end of the catalogue"', e === '→ end of the catalogue', e);
        check('…and its eyebrow says the catalogue ends', (await text(page, '.rings-eyebrow')) === 'catalogue ends in', await text(page, '.rings-eyebrow'));
      }
    }

    // ------------------------------------------------------------------ out of range (the store clamps: feed a frame by hand)
    await boot(page, url, `?pure=1&t=${A}&view=rings`);
    for (const t of [TMAX + 10, TMIN - 10]) {
      await page.evaluate((t) => {
        const { model } = window.__fractonica;
        window.__fractonica.instances.rings.render({ t, inRange: false, level: () => null }, { dirty: true, dt: 0, t, real: 0, view: 'rings' });
      }, t);
      await sweep(page, `out of range ${t}`);
      if (t > 0) {
        check('out of range: the catalogue is α#1 – α#18 and a position span, never years', (await text(page, '.rings-count')) === 'α#1 – α#18' && /^pos 0 → \d+$/.test(await text(page, '.rings-end')), `${await text(page, '.rings-count')} / ${await text(page, '.rings-end')}`);
        check('out of range: the phase card is empty, not stale', (await text(page, '.rings-wh-pct')) === '' && (await text(page, '.rings-wh-pctl')) === '');
      }
    }
    await boot(page, url, `?pure=1&t=${A}&view=rings`);

    // ------------------------------------------------------------------ hover sweep over the dial (rings, labels, sectors, hole)
    const box = await page.locator('.rings-layer-live').boundingBox();
    await page.locator('.rings-layer-live').scrollIntoViewIfNeeded();
    const b2 = await page.locator('.rings-layer-live').boundingBox();
    let tips = 0;
    const seenTips = new Set();
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        await page.mouse.move(b2.x + ((c + 0.5) * b2.width) / 13, b2.y + ((r + 0.5) * b2.height) / 13);
        await page.waitForTimeout(40);
        const tt = await tipText(page);
        if (tt) {
          tips++;
          seenTips.add(tt);
        }
        await sweep(page, `dial hover (${c},${r})`);
      }
    }
    check('hovering the dial shows tooltips (ring heads, child cycles, labels)', tips > 40, `${tips} tooltips`);
    const tipList = [...seenTips];
    check('child-cycle tooltips name the cycle and what follows', tipList.some((t) => /child · /.test(t) && /ends → [A-Z][a-z]+ [A-Z][a-z]+fracton begins/.test(t) && /lasts .*(starts in|started|running now)/.test(t)), tipList.find((t) => /child/.test(t)) ?? '');
    check('ring tooltips show the glyph pair', await (async () => { const p = await dialPoint(page, 4, 0.9); await page.mouse.move(p.x, p.y); await page.waitForTimeout(150); return (await page.locator('.rings-tip .pure-pair svg').count()) === 2; })());
    if (SHOTS) {
      const p = await dialPoint(page, 4, 0.9);
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(outDir, 'rings-pure-tip.png'), clip: { x: Math.max(0, p.x - 360), y: Math.max(0, p.y - 170), width: 760, height: 400 } });
    }
    // the stub tooltip of a ring too fast to follow (time-lapse): "about …"
    await page.mouse.move(2, 2);

    // ------------------------------------------------------------------ the wave: hover, scrub, keyboard
    for (const ph of [0.02, 0.15, 0.3, 0.5, 0.7, 0.88, 0.98]) {
      const p = await wavePoint(page, ph);
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(120);
      await sweep(page, `wave hover ${ph}`);
    }
    const hp = await wavePoint(page, 0.4);
    await page.mouse.move(hp.x, hp.y);
    await page.waitForTimeout(150);
    const hoverCanvas = (await collectRings(page)).filter((i) => i.kind === 'canvas').map((i) => i.text);
    await sweep(page, 'wave hover 0.4 (repaint)');
    // drag the cursor
    const t0 = await page.evaluate(() => window.__fractonica.store.t());
    await page.mouse.down();
    const p2 = await wavePoint(page, 0.2);
    await page.mouse.move(p2.x, p2.y, { steps: 6 });
    await sweep(page, 'wave drag');
    await page.mouse.up();
    const t1 = await page.evaluate(() => window.__fractonica.store.t());
    check('dragging the wave cursor scrubs time inside the cycle', t1 !== t0);
    await page.focus('.rings-wave');
    for (const key of ['ArrowRight', 'ArrowLeft', 'PageUp', 'PageDown', 'Home', 'End']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(60);
      await sweep(page, `wave key ${key}`);
    }
    await page.focus('.rings-dialwrap');
    for (const key of ['ArrowRight', 'ArrowLeft', 'PageUp', 'PageDown', 'Enter', 'End', 'Home']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(80);
      await sweep(page, `dial key ${key}`);
    }
    const live = await text(page, '.rings-live');
    check('screen-reader announcements are pure', !live || (!/\d{1,2}:\d{2}/.test(live) && !/Gregorian/.test(live)), live);

    // ------------------------------------------------------------------ chips, buttons, depth steppers, toggles, picker
    await boot(page, url, `?pure=1&t=${A}&view=rings`);
    for (let k = 0; k < 4; k++) {
      await page.hover(`.rings-chip[data-q="${k}"]`);
      await page.waitForTimeout(120);
      await sweep(page, `chip ${k} hover`);
    }
    await page.click('.rings-chip[data-q="1"]');
    await page.waitForTimeout(200);
    await sweep(page, 'after chip jump');
    check('chip jump lands 1 ms past its threshold (a passed one goes back)', await page.evaluate(() => { const { model, store } = window.__fractonica; const lv = model.levelAt(store.t(), 6); return lv.quarter === 2 && store.t() - lv.thresholds[2].time < 0.01; }));
    for (const b of ['.rings-b-prev', '.rings-b-thr', '.rings-b-next']) {
      await page.click(b);
      await page.waitForTimeout(150);
      await sweep(page, `button ${b}`);
    }
    for (const [which, d] of [['min', 1], ['min', 1], ['max', -1], ['max', 1], ['max', 1], ['max', 1], ['max', 1], ['max', 1]]) {
      await page.click(`[data-step="${which}:${d}"]`);
      await page.waitForTimeout(90);
      await sweepFresh(page, `range step ${which} ${d}`);
    }
    await setStore(page, { selectedLevel: 0, minDepth: 3, maxDepth: 12 });
    await sweepFresh(page, 'selection outside the depth range (off-dial note)');
    check('off-dial note is pure', /^α 1 is not on the dial · show it$/.test((await text(page, '.rings-offdial')) ?? ''), await text(page, '.rings-offdial'));
    await setStore(page, { selectedLevel: 6, minDepth: 1, maxDepth: 10 });
    for (const k of ['sectors', 'quarters', 'funnels']) {
      await page.click(`[data-toggle="${k}"]`);
      await sweepFresh(page, `toggle ${k} off`);
      await page.click(`[data-toggle="${k}"]`);
    }

    // ------------------------------------------------------------------ time-lapse: glowing rings, blurred selection
    await page.evaluate(() => window.__fractonica.store.setRate(3501360));
    await page.waitForTimeout(300);
    await sweepFresh(page, 'time-lapse x3.5M');
    for (const sel of [9, 12]) {
      await setStore(page, { selectedLevel: sel });
      await page.waitForTimeout(300);
      await sweepFresh(page, `time-lapse, blurred depth ${sel + 1}`);
    }
    const stub = await dialPoint(page, 8, 0.4);
    await page.mouse.move(stub.x, stub.y);
    await page.waitForTimeout(350);
    const stubTip = await tipText(page);
    await sweep(page, 'time-lapse stub tooltip');
    check('a ring too fast to follow says how long one turn is, on the ladder', /about \d+[α-ξ½]+ per cycle/.test(stubTip) || stubTip === '', stubTip);
    await page.evaluate(() => window.__fractonica.store.pause());
    await setStore(page, { selectedLevel: 6 });
    await page.mouse.move(2, 2);

    // ------------------------------------------------------------------ touch: tap and hold shows the tooltip
    await withTouch(page, url, check, sweep, install);

    // ------------------------------------------------------------------ phone: compact dial, card below
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page, url, `?pure=1&t=${A}&view=rings`);
    await sweepFresh(page, 'phone');
    check('phone: the centre keeps the short tag, the full name moves to the card', (await text(page, '.rings-cn-name')) === 'η 7 · 1/11' && (await page.evaluate(() => getComputedStyle(document.querySelector('.rings-fullname')).display)) === 'block' && (await text(page, '.rings-fullname')) === 'Eta Monofracton', `${await text(page, '.rings-cn-name')} / ${await text(page, '.rings-fullname')}`);
    check('phone: centre countdown is two units and fits the hole', await page.evaluate(() => {
      const c = document.querySelector('.rings-count');
      const hole = document.querySelector('.rings-centre').getBoundingClientRect();
      const r = c.getBoundingClientRect();
      return /^\d+ι \d+λ$/.test(c.textContent) && r.width <= hole.width + 1;
    }));
    await page.click('.rings-help-btn');
    await sweep(page, 'phone help');
    // no horizontal overflow of the page, no clipped text in the cards
    const overflow = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('#view-rings *')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed') bad.push(el.className || el.tagName);
      }
      return { scroll: document.documentElement.scrollWidth - innerWidth, bad: bad.slice(0, 6) };
    });
    check('phone: nothing sticks out of the screen', overflow.scroll <= 1 && overflow.bad.length === 0, JSON.stringify(overflow));
    if (SHOTS) {
      for (const [name, t] of [['A', A], ['edge', TMAX - 5]]) {
        await boot(page, url, `?pure=1&t=${t}&view=rings`);
        await page.click('.rings-help-btn').catch(() => {});
        await page.click('.rings-help-btn').catch(() => {});
        await shot(`rings-pure-phone-${name}.png`, { fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // ------------------------------------------------------------------ live switching, both ways, no reload
    await boot(page, url, `?t=${A}&view=rings&zone=UTC&pure=0`);
    await page.evaluate(() => { window.__noReload = 'same page'; });
    const normalBefore = (await collectRings(page)).map((i) => i.text).join(' | ');
    check('normal mode starts with Gregorian wording', /12:56:12/.test(normalBefore) && /%/.test(normalBefore) && !PURE_ONLY.test(normalBefore.replace(/η 7 · 1\/11/g, '')), '');
    await page.click('.rings-help-btn');
    const helpNormal = await text(page, '.rings-help');
    await page.click('.rings-help-btn');
    await page.hover('.rings-layer-live', { position: { x: 100, y: 200 } });
    for (const how of ['header button', 'key P']) {
      if (how === 'header button') await page.click('#btn-pure');
      else await page.keyboard.press('p');
      await page.waitForTimeout(450);
      const inPure = await sweepFresh(page, `switched on with ${how}`);
      check(`switch on (${how}): no reload`, (await page.evaluate(() => window.__noReload)) === 'same page');
      check(`switch on (${how}): pure texts replace the Gregorian ones`, (await text(page, '.rings-cn-name')) === 'Eta Monofracton' && !/%/.test(inPure.map((i) => i.text).join(' ')));
      if (how === 'header button') {
        await page.click('.rings-help-btn');
        check('switch on: help panel rebuilt in pure vocabulary while open', /Eta Monofracton/.test(await text(page, '.rings-help')));
        await page.click('.rings-help-btn');
      }
      if (how === 'header button') await page.click('#btn-pure');
      else await page.keyboard.press('p');
      await page.waitForTimeout(450);
      const back = (await sweepFresh(page, `switched off with ${how}`, { judge: false })).map((i) => i.text).join(' | ');
      check(`switch off (${how}): the Gregorian text is back, identical to before`, /12:56:12/.test(back) && /81\.\d\s?%|\d\d\.\d\s?%/.test(back));
      check(`switch off (${how}): nothing pure is left behind`, !PURE_ONLY.test(back.replace(/η 7 · 1\/11/g, '')) && (await page.locator('#view-rings .pure-pair').count()) === 0 && !(await page.evaluate(() => document.querySelector('.rings').hasAttribute('data-pure'))), back.match(PURE_ONLY)?.[0] ?? '');
    }
    await page.click('.rings-help-btn');
    check('switch off: the help text is the Gregorian one again', (await text(page, '.rings-help')) === helpNormal);
    await page.click('.rings-help-btn');
    // the tooltip does not survive the switch
    const p = await dialPoint(page, 4, 0.9);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(200);
    check('normal tooltip before switching', /\d{2}:\d{2}/.test(await tipText(page)));
    await page.keyboard.press('p');
    await page.waitForTimeout(250);
    const tipAfter = await tipText(page);
    check('an open tooltip is not left over in the old vocabulary after the switch', !/\d{2}:\d{2}|through this cycle/.test(tipAfter), tipAfter);
    await page.keyboard.press('p');
    await page.waitForTimeout(250);
    // ?pure=1 deep link and the stored setting
    await boot(page, url, `?pure=1&t=${A}&view=rings`);
    check('?pure=1 opens straight in pure mode', (await text(page, '.rings-cn-name')) === 'Eta Monofracton');

    // ------------------------------------------------------------------ cost of a pure-mode frame
    await boot(page, url, `?pure=1&t=${A}&view=rings`);
    await page.evaluate(() => window.__fractonica.store.setRate(18188.9));
    const cost = await costOf(page);
    check('pure render stays cheap in time-lapse (median < 3 ms, p95 < 6 ms)', cost.median < 3 && cost.p95 < 6, `${cost.frames} frames, median ${cost.median.toFixed(2)} ms, p95 ${cost.p95.toFixed(2)} ms, max ${cost.max.toFixed(2)} ms`);
    await page.evaluate(() => window.__fractonica.store.pause());

    // ------------------------------------------------------------------ verdict
    const rep = (list) => formatLeaks(list, { soft: true });
    console.log('\nown scanner (everything in #view-rings, tooltips, tagged canvas text):');
    console.log(`  hard leaks: ${hardLeaks.length}, soft: ${softLeaks.length}, distinct texts inspected: ${seenTexts.size}`);
    if (hardLeaks.length) console.log(rep(hardLeaks).split('\n[').slice(0, 25).join('\n['));
    const softKinds = new Map();
    for (const l of softLeaks) softKinds.set(`${l.rule} "${l.match}" in ${l.kind} ${l.where}: ${l.text}`, (softKinds.get(`${l.rule} "${l.match}" in ${l.kind} ${l.where}: ${l.text}`) ?? 0) + 1);
    if (softKinds.size) {
      console.log('  soft hits (each must be justified):');
      for (const [k, n] of [...softKinds].slice(0, 12)) console.log(`    x${n} ${k}`);
    }
    check('0 hard leaks inside the rings view in every state above', hardLeaks.length === 0, `${hardLeaks.length}`);
    const g = genericLeaks.filter((l) => l.severity === 'hard');
    check('the shared scanner finds 0 hard leaks at rings- locations', g.length === 0, g.length ? formatLeaks(g) : '');
    check('no console errors from this module', own().length === 0, JSON.stringify(own()));
    console.log('other console errors (not this module):', errors.filter((e) => !own().includes(e)).slice(0, 3));
  },
  { viewport: { width: 1440, height: 900 } },
);

/** Tap and hold on a real touch page: the tooltip appears without jumping, and is pure. */
async function withTouch(page, url, check, sweep, install) {
  const browser = page.context().browser();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const tp = await ctx.newPage();
  await install(tp);
  await tp.goto(url(`?pure=1&t=${A}&view=rings&sel=5`));
  await tp.waitForFunction(() => window.__fractonica?.instances?.rings?.inspect?.().layout, null, { timeout: 8000 });
  await tp.waitForTimeout(500);
  await tp.evaluate(() => window.__fractonica.store.pause?.());
  const cdp = await ctx.newCDPSession(tp);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await tp.evaluate(() => document.querySelector('.rings-dialwrap').scrollIntoView({ block: 'center' }));
  await tp.waitForTimeout(200);
  const { i, b } = await (async () => ({ i: await tp.evaluate(() => window.__fractonica.instances.rings.inspect()), b: await tp.locator('.rings-layer-live').boundingBox() }))();
  const ring = i.layout.rings[4];
  const ang = 0.62 * Math.PI * 2;
  const px = b.x + i.layout.cx + ring.mid * Math.sin(ang);
  const py = b.y + i.layout.cy - ring.mid * Math.cos(ang);
  await touch('touchStart', px, py);
  await tp.waitForTimeout(700);
  await touch('touchEnd');
  await tp.waitForTimeout(250);
  const tip = await tp.evaluate(() => { const t = document.querySelector('.rings-tip'); return t && !t.hidden ? t.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const items = await tp.evaluate(() => [...document.querySelectorAll('.rings-tip')].map((t) => t.innerText));
  check('touch: tap and hold shows a pure tooltip', /child · /.test(tip) && /Tap again to jump/.test(tip) && !/\d{2}:\d{2}|%/.test(tip), tip);
  const leaks = [];
  for (const [rule, re, sev] of RULES) if (sev === 'hard' && re.test(items.join(' '))) leaks.push(rule);
  check('touch: the tooltip has no leaks', leaks.length === 0, leaks.join(','));
  await ctx.close();
}

console.log(results.every(Boolean) ? '\nALL PASS' : `\nFAILED: ${results.filter((r) => !r).length}`);
process.exit(results.every(Boolean) ? 0 : 1);
