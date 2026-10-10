/**
 * Pure mode of the Sound panel, checked in headless Chromium (docs/design/80-pure.md):
 *
 *   node tools/checks/check-sound-pure.mjs            run the checks (exit code 1 on failure; screenshots in tools/out/)
 *   node tools/checks/check-sound-pure.mjs --dump F   only write the visible text of every state in the current mode to F
 *                                                     (JSON; add --pure for pure mode) - used to diff normal mode
 *
 * What it walks (`walkSound`): the panel at rest, every tooltip (power, moment, layers, floor, base, lock, all 14 strips,
 * the pitch ring), the Physical register and its stepper, the presets, muted strips, extreme slider values, the tempo
 * lock at several depths/lengths (chip, read-out, rhythm chips, toast), every speed button, every selected depth, the
 * running engine, "Hear this moment", the out-of-range state and the phone layout. In pure mode every state goes through
 * pure-scan's scan(); hard leaks fail the check. Then it proves the live switch: normal -> pure -> normal reads exactly
 * like a fresh load in each mode, with nothing left behind.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withApp } from '../browse.mjs';
import { installHooks, scan, judge, formatLeaks } from '../pure-scan.mjs';

export const T = 1791460800; // SPEC vector A
const SETTLE = 160;

/** Records the strings drawn on the canvases of the Sound panel (the shared hook of pure-scan sees every canvas). */
export async function hookSoundCanvas(page) {
  await page.addInitScript(() => {
    window.__sndCanvasText = new Set();
    for (const name of ['fillText', 'strokeText']) {
      const orig = CanvasRenderingContext2D.prototype[name];
      CanvasRenderingContext2D.prototype[name] = function (text, ...rest) {
        try {
          if (this.canvas?.isConnected && this.canvas.getClientRects().length && this.canvas.closest('#view-sound')) window.__sndCanvasText.add(String(text));
        } catch {
          /* ignore */
        }
        return orig.call(this, text, ...rest);
      };
    }
  });
}

/**
 * Everything a user can see or read of the Sound panel right now: its text nodes, title / aria-label / placeholder
 * attributes, select options, the open tooltip, the toast, the strings drawn on its canvases.
 * Same shape as pure-scan's collect(): [{kind, text, where}].
 */
export async function collectSound(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el.isConnected || el.closest('[hidden]')) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
    };
    const items = [];
    const add = (kind, text, el) => {
      const t = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      const where = el ? (el.id ? '#' + el.id : '') + [...(el.classList ?? [])].slice(0, 2).map((c) => '.' + c).join('') || el.tagName.toLowerCase() : '';
      items.push({ kind, text: t, where });
    };
    const roots = [document.querySelector('#view-sound'), document.querySelector('.snd-tip:not([hidden])'), document.querySelector('#toast:not([hidden])')].filter(Boolean);
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(el.tagName) || !visible(el)) continue;
        add('text', n.nodeValue, el);
      }
      for (const el of [root, ...root.querySelectorAll('[title],[aria-label],[aria-description],[aria-valuetext],[placeholder],[alt]')]) {
        if (!visible(el)) continue;
        for (const a of ['title', 'aria-label', 'aria-description', 'aria-valuetext', 'placeholder', 'alt']) if (el.hasAttribute(a)) add('attr:' + a, el.getAttribute(a), el);
      }
      for (const sel of root.querySelectorAll('select')) {
        if (!visible(sel)) continue;
        for (const o of sel.options) add('option', o.textContent, sel);
      }
      for (const t of root.querySelectorAll('svg title')) if (visible(t.parentElement)) add('svg-title', t.textContent, t.parentElement);
      for (const el of root.querySelectorAll('input')) if (visible(el) && el.type !== 'range' && el.value) add('input-value', el.value, el);
    }
    const canvas = [...(window.__sndCanvasText ?? [])];
    window.__sndCanvasText = new Set();
    for (const c of canvas) add('canvas', c, null);
    return items;
  });
}

/** The texts a screen reader gets as descriptions (aria-describedby): hidden nodes, so collectSound cannot see them. */
export async function collectDescriptions(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[id^="snd-desc-"]')]
      .map((el) => ({ kind: 'describedby', text: el.textContent.replace(/\s+/g, ' ').trim(), where: '#' + el.id }))
      .filter((x) => x.text),
  );
}

/** Visible text of the Sound panel as sorted unique lines. */
export async function snapshot(page) {
  await page.evaluate(() => {
    window.__sndCanvasText = new Set(); // only what the canvases draw from now on: the strings of an earlier state are gone
    window.__fractonica.ctx.requestRender();
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.waitForTimeout(80);
  const items = await collectSound(page);
  return { items, lines: [...new Set(items.map((i) => `${i.kind}\t${i.where}\t${i.text}`))].sort() };
}

/**
 * Drive the Sound panel through its states. `visit(label)` is awaited in each one.
 * @param {import('playwright-core').Page} page
 * @param {(q?:string)=>string} url
 * @param {(label:string)=>Promise<void>} visit
 * @param {{pure:boolean}} opts
 */
export async function walkSound(page, url, visit, { pure }) {
  const go = async (q) => {
    await page.goto(url(`?${q}&view=sound&zone=UTC&pure=${pure ? 1 : 0}`));
    await page.waitForSelector('.snd-power');
    await page.waitForTimeout(500);
  };
  const settle = (ms = SETTLE) => page.waitForTimeout(ms);
  const at = async (label) => {
    await settle();
    await visit(label);
  };
  const park = () => page.mouse.move(2, 2);
  const hover = async (sel, label) => {
    if (process.env.STEPS) console.log('hover', label);
    await page.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 4000 });
    await page.hover(sel, { force: true });
    await at(label);
    await park();
  };
  const set = (fn, arg) => page.evaluate(fn, arg);

  await go(`t=${T}`);
  await at('rest');

  // ---- tooltips of the controls
  await hover('.snd-power', 'tip power');
  await hover('.snd-moment', 'tip moment');
  for (const l of ['chord', 'chimes', 'physical']) await hover(`.snd [data-layer="${l}"]`, `tip layer ${l}`);
  await hover('.snd-floor', 'tip floor');
  await hover('.snd-base', 'tip base');
  await hover('.snd-lock-btn', 'tip lock');
  for (let L = 0; L < 14; L++) await hover(`.snd-strip[data-level="${L}"]`, `tip strip ${L + 1}`);
  // the pitch ring: hover the dot of a few depths
  for (const L of [0, 4, 8, 13]) {
    const p = await set(async (L) => {
      const ring = document.querySelector('.snd-ring');
      const r = ring.getBoundingClientRect();
      const rows = window.__fractonica.instances.sound.engine.tuning;
      const R = Math.min(r.width, r.height) / 2 - 24;
      const rIn = R * 0.42;
      const rad = R - ((R - rIn) * L) / (rows.length - 1);
      const a = -Math.PI / 2 + (rows[L].pcCents / 1200) * Math.PI * 2;
      return { x: r.left + r.width / 2 + Math.cos(a) * rad, y: r.top + r.height / 2 + Math.sin(a) * rad };
    }, L);
    await page.locator('.snd-ring').scrollIntoViewIfNeeded();
    await page.mouse.move(p.x, p.y);
    await at(`tip ring dot ${L + 1}`);
    await park();
  }

  // ---- keyboard focus tips (they use the same builders)
  await page.keyboard.press('Tab');
  await at('after Tab');

  // ---- sliders at their ends and the middle
  for (const [sel, vals] of [
    ['.snd-vol', [-48, -18, -3]],
    ['.snd-rev', [0, 22, 50, 100]],
    ['.snd-base', [-12, -7, -5, 0, 7, 12]],
  ]) {
    for (const v of vals) {
      await page.locator(sel).fill(String(v));
      await at(`${sel} = ${v}`);
    }
  }
  await page.locator('.snd-vol').fill('-18');
  await page.locator('.snd-rev').fill('22');
  await page.locator('.snd-base').fill('0');

  // ---- chime floor options
  for (const f of ['0.05', '0.12', '0.25', '0.5', '1']) {
    await page.selectOption('.snd-floor', f);
    await at(`floor ${f}`);
  }
  await page.selectOption('.snd-floor', '0.5');

  // ---- layers, physical register
  await page.click('.snd [data-layer=\"physical\"]');
  await at('physical on');
  for (const step of [-1, -1, -1, -1, 1, 1, 1, 1, 1, 1, 1]) {
    await page.click(`.snd-phys [data-step="${step}"]`);
    await at(`physical step`);
  }
  await hover('.snd [data-layer=\"physical\"]', 'tip layer physical (on)');
  await page.click('.snd [data-layer=\"physical\"]');
  await page.click('.snd [data-layer=\"chord\"]');
  await at('chord off');
  await page.click('.snd [data-layer=\"chimes\"]');
  await at('chord and chimes off');
  await page.click('.snd [data-layer=\"chord\"]');
  await page.click('.snd [data-layer=\"chimes\"]');
  await at('layers back');

  // ---- presets and a muted strip
  for (const p of ['slow', 'all', 'default']) {
    await page.click(`.snd-presets [data-preset="${p}"]`);
    await at(`preset ${p}`);
  }
  await page.click('.snd-strip[data-level="3"] .snd-strip-on');
  await at('depth 4 muted');
  await page.click('.snd-strip[data-level="3"] .snd-strip-on');

  // ---- selecting a depth (ring corner, mixer selection)
  for (const L of [0, 3, 6, 8, 12, 13]) {
    await set((L) => window.__fractonica.store.set({ selectedLevel: L }), L);
    await at(`selected depth ${L + 1}`);
  }
  await set(() => window.__fractonica.store.set({ selectedLevel: 6 }));

  // ---- tempo lock
  for (const depth of ['2', '7', '14', '9']) {
    await page.selectOption('.snd-tdepth', depth);
    for (const secs of ['0.25', '4', '1', '600', '13.5']) {
      await page.fill('.snd-secs', secs);
      await page.press('.snd-secs', 'Enter'); // Enter always locks or re-tunes; the button would toggle
      await at(`locked depth ${depth} for ${secs}`);
    }
  }
  await hover('.snd-lock-btn', 'tip unlock');
  await hover('.snd-chip-lock', 'lock chip hover');
  await page.click('.snd-unlock');
  await at('unlocked');

  // ---- speed buttons
  const keys = await page.$$eval('.snd-rate', (bs) => bs.map((b) => b.dataset.rate));
  for (const k of keys) {
    await hover(`.snd-rate[data-rate="${k}"]`, `hover rate ${k}`);
    await page.click(`.snd-rate[data-rate="${k}"]`);
    await at(`rate ${k}`);
  }
  await set(() => window.__fractonica.store.setRate(0));
  for (const r of [0.5, 0.011, 3, 12345, -7, 1e9, 2629800, -3600]) {
    await set((r) => window.__fractonica.store.setRate(r), r);
    await at(`rate ${r}`);
  }
  await set(() => window.__fractonica.store.setTime(1791460800));
  await at('paused again');

  // ---- the engine running
  await page.click('.snd-power');
  await page.waitForTimeout(500);
  await at('engine on');
  await page.click('.snd-moment');
  await page.waitForTimeout(300);
  await at('hear this moment');
  await set(() => window.__fractonica.store.setRate(18188.9));
  await at('engine on, time-lapse');
  await page.click('.snd-power');
  await page.waitForTimeout(300);
  await set(() => window.__fractonica.store.setTime(1791460800));

  // ---- out of range, edges, live
  for (const [name, t] of [
    ['after the catalogue', 28005212035 + 10],
    ['before the catalogue', -11253795486 - 10],
    ['catalogue start', -11253795486 + 5],
    ['catalogue end', 28005212035 - 5],
    ['year 2000', 946684800],
  ]) {
    await set((t) => window.__fractonica.store.setTime(t), t);
    await at(name);
    if (name.includes('after') || name.includes('before')) {
      await page.click('.snd-moment');
      await at(`${name}: hear this moment`);
    }
  }
  await set(() => window.__fractonica.store.goLive());
  await at('live');

  // ---- phone
  await page.setViewportSize({ width: 390, height: 844 });
  await go(`t=${T}`);
  await at('phone');
  await hover('.snd-strip[data-level="4"]', 'phone tip strip 5');
  await page.setViewportSize({ width: 1440, height: 900 });
}

// -------------------------------------------------------------------------------------------------
// The checks
// -------------------------------------------------------------------------------------------------
/** A key for the app (not for a focused input, which would swallow `p` and `m`). */
const press = async (page, key) => {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press(key);
};

const norm = (lines) =>
  lines
    .filter((l) => !/\bbells?\b/.test(l)) // the bell counter of a running engine is live
    .filter((l) => !/Loudest cycles now|Pitch ring: each cycle/.test(l)) // the screen-reader summaries are refreshed once a second
    .filter((l) => !/#toast/.test(l)) // a toast fades out by itself
    .sort();

async function main() {
  const args = process.argv.slice(2);
  const soft = args.includes('--soft');
  const dumpIdx = args.indexOf('--dump');
  if (dumpIdx >= 0) {
    const file = path.resolve(args[dumpIdx + 1]);
    const pure = args.includes('--pure');
    const out = {};
    await withApp(async ({ page, url }) => {
      await hookSoundCanvas(page);
      let n = 0;
      await walkSound(
        page,
        url,
        async (label) => {
          const { lines } = await snapshot(page);
          out[`${String(++n).padStart(3, '0')} ${label}`] = lines;
        },
        { pure },
      );
    });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 1));
    console.log(`dumped ${Object.keys(out).length} states to ${file}`);
    return 0;
  }

  let failures = 0;
  const check = (ok, label, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  };
  const ownError = (e) => /sound|audio|engine\.js|schedule\.js|tuning\.js|settings\.js|words\.js|mixer\.js|scope\.js|ring\.js|tooltip\.js/i.test(e);
  const q = (page, sel) => page.textContent(sel);

  await withApp(
    async ({ page, url, errors, shot }) => {
      await hookSoundCanvas(page);
      await installHooks(page);

      // ---------------------------------------------------------------------------------------------
      // 1. every state of the panel, in pure mode, through the leak rules
      // ---------------------------------------------------------------------------------------------
      const leaks = [];
      let states = 0;
      await walkSound(
        page,
        url,
        async (label) => {
          const { items } = await snapshot(page);
          states++;
          leaks.push(...judge([...items, ...(await collectDescriptions(page))], label));
        },
        { pure: true },
      );
      const hard = leaks.filter((l) => l.severity === 'hard');
      check(hard.length === 0, `pure mode: no hard leak in ${states} states of the Sound panel`, hard.length ? '\n' + formatLeaks(hard) : '');
      if (soft) console.log('\nsoft hits (justify each):\n' + formatLeaks(leaks.filter((l) => l.severity === 'soft'), { soft: true }));
      check(
        leaks.filter((l) => l.severity === 'soft').every((l) => l.rule === 'year-number' && new RegExp(`\\b${l.match}/\\d+`).test(l.text)),
        'the only soft hit is the numerator of a ratio (1625/1024), never the word Saros, a year or an eclipse',
        [...new Set(leaks.filter((l) => l.severity === 'soft').map((l) => `${l.rule}:${l.match}`))].join(' '),
      );

      // the shared whole-page scan() in a few of the module's own states: nothing it finds may be a text of this panel
      // (other modules are converted at the same time: their leaks are theirs)
      const whole = [];
      for (const [label, drive] of [
        ['rest', async () => {}],
        ['a voice tooltip', async () => page.hover('.snd-strip[data-level="6"]')],
        ['tempo locked', async () => {
          await page.mouse.move(2, 2);
          await page.press('.snd-secs', 'Enter');
        }],
        ['physical register', async () => page.click('.snd [data-layer="physical"]')],
        ['engine on', async () => page.click('.snd-power')],
      ]) {
        await page.goto(url(`?t=${T}&view=sound&zone=UTC&pure=1`));
        await page.waitForSelector('.snd-power');
        await page.waitForTimeout(500);
        await drive();
        await page.waitForTimeout(500);
        const found = (await scan(page, `whole page: ${label}`)).filter((l) => l.severity === 'hard');
        const mine = new Set((await collectSound(page)).map((i) => i.text));
        whole.push(...found.filter((l) => mine.has(l.text) || /\bsnd-/.test(l.where)));
      }
      await page.evaluate(() => localStorage.removeItem('fractonica-clock/sound/v1')); // the layer toggles above were remembered
      check(whole.length === 0, 'the shared scan() finds no hard leak that belongs to the Sound panel (5 states)', whole.length ? '\n' + formatLeaks(whole) : '');

      // ---------------------------------------------------------------------------------------------
      // 2. what pure mode says, state by state
      // ---------------------------------------------------------------------------------------------
      await page.goto(url(`?t=${T}&view=sound&zone=UTC&pure=1`));
      await page.waitForSelector('.snd-power');
      await page.waitForTimeout(600);
      const eng = () => page.evaluate(() => window.__fractonica.instances.sound.engine);
      const freqs = () => page.evaluate(() => window.__fractonica.instances.sound.engine.tuning.map((r, L) => window.__fractonica.instances.sound.engine.frequency(L)));
      const f0 = await freqs();

      check((await q(page, '.snd-status')) === 'Sound is off. Press the speaker (or M) to start.', 'status line (off)');
      check(/^ground ×1$/.test(await q(page, '.snd-base ~ output')), 'base pitch reads "ground ×1", not Hz', await q(page, '.snd-base ~ output'));
      await page.locator('.snd-base').fill('7');
      check((await q(page, '.snd-base ~ output')) === '+700¢ ×1.5', 'base pitch +7 steps reads "+700¢ ×1.5"', await q(page, '.snd-base ~ output'));
      await page.locator('.snd-base').fill('12');
      check((await q(page, '.snd-base ~ output')) === '+1 octave ×2', '+12 steps reads "+1 octave ×2"', await q(page, '.snd-base ~ output'));
      await page.locator('.snd-base').fill('-12');
      check((await q(page, '.snd-base ~ output')) === '−1 octave ×½', '−12 steps reads "−1 octave ×½"', await q(page, '.snd-base ~ output'));
      await page.locator('.snd-base').fill('0');
      check((await page.$$('.snd-rev ~ output .pure-pair svg')).length === 2 && !/%/.test(await q(page, '.snd-rev ~ output')), 'reverb is a pair of glyphs, no percent');
      check((await page.$$('.snd-vol ~ output .pure-pair svg')).length === 2, 'volume is a pair of glyphs, no dB');
      const aria0 = await page.getAttribute('.snd-rev ~ output .pure-pair', 'aria-label');
      await page.locator('.snd-rev').fill('100');
      const aria1 = await page.getAttribute('.snd-rev ~ output .pure-pair', 'aria-label');
      check(aria0 !== aria1 && aria1 === 'reverb 15 and 15 of 256', 'the reverb pair follows the slider (22 -> 100 is 15 and 15), in the helper\'s words', `${aria0} -> ${aria1}`);
      await page.locator('.snd-rev').fill('22');
      check(JSON.stringify(await freqs()) === JSON.stringify(f0), 'audio is untouched: every voice frequency is the same as before');
      check(
        (await page.getAttribute('.snd-rev', 'aria-valuetext')) === 'reverb 3 and 8 of 256' &&
          /^volume \d+ and \d+ of 256$/.test(await page.getAttribute('.snd-vol', 'aria-valuetext')) &&
          (await page.getAttribute('.snd-base', 'aria-valuetext')) === 'ground ×1',
        'screen readers get the pair (two digits, "reverb 3 and 8 of 256") and the ground for the sliders, not bare numbers or "3·8"',
        `${await page.getAttribute('.snd-rev', 'aria-valuetext')} / ${await page.getAttribute('.snd-vol', 'aria-valuetext')} / ${await page.getAttribute('.snd-base', 'aria-valuetext')}`,
      );
      // the screen-reader summaries of the two canvases name loudness in the same words, never as "12·5"
      await page.waitForTimeout(1200);
      const scopeAria = await page.getAttribute('.snd-scope', 'aria-label');
      check(
        /Loudest cycles now: (\S+ loudness \d+ and \d+ of 256(, |\.))+/.test(scopeAria) && !/\d·\d/.test(scopeAria),
        'the spectrum summary speaks pairs as "ι loudness 12 and 5 of 256"',
        scopeAria,
      );
      check(
        (await q(page, '.snd-auto')).endsWith('Press ? for the glossary.'),
        'the How-to-listen footer points to the glossary',
      );
      check(
        (await page.$$eval('.snd-floor option', (o) => o.map((x) => x.textContent))).join('|') === '0.05 beats · dense|0.12 beats · lively|0.25 beats|0.5 beats · default|1 beat · sparse',
        'chime floors are counts of beats',
      );
      check(
        (await page.$$eval('.snd-tdepth option', (o) => o.map((x) => x.textContent))).slice(0, 7).join('|') === '2 · β (1β)|3 · γ (1γ)|4 · δ (2δ½)|5 · ε (2ε½)|6 · ζ (2ζ½)|7 · η (1η)|8 · θ (4ι)',
        'depth options carry the cycle length in Fractonica periods',
      );
      check((await q(page, '.snd-secs-unit')) === 'beats' && (await page.getAttribute('.snd-secs', 'aria-label')) === 'Beats per cycle', 'tempo lock is counted in beats');
      // the separators are CSS (::before), so join the three parts the way they are drawn
      const strip5 = await page.$eval('.snd-strip[data-level="4"] .snd-l2', (e) => [...e.children].map((c) => c.textContent).join(' · '));
      check(/^octave \+1 · 79\d¢ · 2ε½$/.test(strip5), 'a mixer strip reads octave offset · cents · cycle length', strip5);
      check((await q(page, '.snd-strip[data-level="2"] .snd-ratio')) === '65/64', 'ratios use a slash (65:64 would read as a time of day)');
      const rateBtns = await page.$$eval('.snd-rate', (b) => b.map((x) => [...x.children].map((c) => c.textContent).join(' ')));
      check(rateBtns.join('|') === 'Live follow now|real time|λ per beat|ι per beat|η per beat|ζ½ per beat|δ½ per beat|Pause|Reverse', 'speed buttons are the helper\'s units per beat, "real time" for ×1 (no bare multiplier)', rateBtns.join(' | '));
      // every speed button says exactly what the header's speed select says for the same rate
      const headerSays = await page.evaluate(() => {
        const sel = document.querySelector('#tp-rate');
        const byValue = Object.fromEntries([...sel.options].map((o) => [Number(o.value), o.textContent]));
        return [...document.querySelectorAll('.snd-rate')]
          .filter((b) => /^[\d.]+$/.test(b.dataset.rate) && b.dataset.rate !== '0')
          .map((b) => [[...b.children].map((c) => c.textContent).join(' '), byValue[Number(b.dataset.rate)]]);
      });
      check(headerSays.length === 6 && headerSays.every(([btn, hdr]) => btn === hdr), 'speed buttons and the header select use the same words', JSON.stringify(headerSays.filter(([a, b]) => a !== b)));

      // "Hear this moment" outside the catalogue: the app clamps the time, so the displayed time is faked for one click
      const momentToast = () =>
        page.evaluate(async () => {
          const st = window.__fractonica.store;
          const orig = st.t;
          st.t = () => window.__fractonica.model.tMax + 10;
          document.querySelector('.snd-moment').click();
          await new Promise((r) => setTimeout(r, 300));
          st.t = orig;
          return document.querySelector('#toast').textContent;
        });
      check((await momentToast()) === 'Outside the catalogue: no chord to play', 'refused moment: the toast does not name a year or a series');

      // out of range: the state is explicit and speaks pure (the app clamps the time, so the frame is built by hand)
      const oor = await page.evaluate(() => {
        const inst = window.__fractonica.instances.sound;
        const m = window.__fractonica.model;
        inst.render(m.frame(m.tMax + 10), { view: 'sound', dirty: true });
        return { status: document.querySelector('.snd-status').textContent, tone: document.querySelector('.snd').dataset.state };
      });
      check(oor.status === 'Outside the catalogue (α#1 – α#18): silent. Jump back inside to hear the clock.' && oor.tone === 'warn', 'out-of-range state names the catalogue by its cycles, not by years', oor.status);
      check(judge([{ kind: 'text', text: oor.status, where: '.snd-status' }], 'out of range').length === 0, 'out-of-range text has no leak (not even a soft one)');
      await page.waitForTimeout(100);

      // tempo lock
      await page.selectOption('.snd-tdepth', '7');
      await page.fill('.snd-secs', '4');
      await page.press('.snd-secs', 'Enter');
      await page.waitForTimeout(300);
      check((await q(page, '.snd-lock-txt')) === 'Locked: one η = 4 beats', 'lock chip', await q(page, '.snd-lock-txt'));
      check(/^9ι per beat: one η cycle lasts 4 beats; a quarter lasts 1 beat\.$/.test(await q(page, '.snd-read')), 'tempo read-out counts the lock in units per beat (9ι), not "×4,547"', await q(page, '.snd-read'));
      check(
        (await page.$eval('#tp-rate', (s) => s.options[s.selectedIndex].textContent)) === '9ι per beat' && /9ι per beat/.test(await page.getAttribute('.snd-chip-lock', 'title')),
        'the header select and the lock chip say the same: 9ι per beat',
      );
      check(
        !/×\s*(\d{1,3}(,\d{3})+|\d{3,})/.test((await collectSound(page)).map((i) => i.text).join(' | ')),
        'no bare multiplier (×4,547) anywhere in the panel while the tempo is locked',
      );
      check((await page.$$eval('.snd-rhythm .snd-rh', (e) => e.map((x) => x.textContent.trim()))).join('|').startsWith('η 4 beats ♪|θ 0.444 beats'), 'rhythm chips are counted in beats', await q(page, '.snd-rhythm'));
      check(/Tempo locked: one η cycle = 4 beats \(9ι per beat\)/.test((await q(page, '#toast')) ?? ''), 'toast', await q(page, '#toast'));
      check((await q(page, '.snd-chip-lapse')) === 'Time-lapse 9ι per beat', 'hero speed chip counts the lock in units per beat', await q(page, '.snd-chip-lapse'));
      await page.click('.snd-rate:has(span:text-is("η"))');
      await page.waitForTimeout(300);
      const pressed = await page.$eval('.snd-rate:has(span:text-is("η"))', (b) => b.getAttribute('aria-pressed'));
      const rate = await page.evaluate(() => window.__fractonica.store.rate);
      const etaRate = await page.evaluate(() => window.__fractonica.ctx.pure.RATES.find((r) => r.id === 'eta').rate);
      check(pressed === 'true' && rate === etaRate, 'the η per beat button sets that speed and shows pressed', `rate ${rate}`);
      check((await q(page, '.snd-chip-lapse')) === 'Time-lapse η per beat', 'speed chip', await q(page, '.snd-chip-lapse'));

      // tooltips that carry pairs, a voice and the ring
      await page.evaluate(() => window.__fractonica.store.setRate(0));
      await page.hover('.snd-strip[data-level="4"]');
      await page.waitForTimeout(150);
      const tip = await page.$eval('.snd-tip', (e) => ({ text: e.textContent.replace(/\s+/g, ' '), pairs: e.querySelectorAll('.pure-pair svg').length }));
      check(tip.pairs === 4 && /one cycle = 2ε½/.test(tip.text) && /True rate of this cycle: 1 cycle per 1\.40 M beats/.test(tip.text), 'voice tooltip: ratio, periods, rate per beat, phase and loudness as glyph pairs', tip.text);
      await page.mouse.move(2, 2);

      // switching the mode while a tooltip is open re-words it at once
      await page.hover('.snd-base');
      await page.waitForTimeout(100);
      check(/ground/.test(await page.$eval('.snd-tip', (e) => e.textContent)), 'base-pitch tooltip speaks of the ground (pure)');
      await press(page, 'p');
      await page.waitForTimeout(250);
      check(/The note of α, the 1\/1 of the chord/.test(await page.$eval('.snd-tip', (e) => e.textContent)), 'the open tooltip is re-worded when pure mode is switched off');
      await press(page, 'p');
      await page.waitForTimeout(250);
      await page.mouse.move(2, 2);

      // the descriptions a screen reader gets follow the mode too: emptied at the switch, written again on use
      await page.hover('.snd-strip[data-level="4"]');
      await page.mouse.move(2, 2);
      let desc = await collectDescriptions(page);
      check(desc.some((d) => /one cycle = 2ε½/.test(d.text)) && judge(desc, 'descriptions').filter((l) => l.severity === 'hard').length === 0, 'the description of a hovered strip is pure');
      await press(page, 'p');
      await page.waitForTimeout(300);
      check((await collectDescriptions(page)).length === 0, 'switching the mode empties the hidden descriptions (nothing stale for a screen reader)');
      await page.hover('.snd-strip[data-level="4"]');
      await page.mouse.move(2, 2);
      desc = await collectDescriptions(page);
      check(desc.some((d) => /Hz/.test(d.text)) && !desc.some((d) => /beats|ground/.test(d.text)), 'back in normal mode the descriptions are normal again');
      await press(page, 'p');
      await page.waitForTimeout(300);

      // the audio engine keeps its sound through a switch of the mode
      await page.click('.snd-power');
      await page.waitForTimeout(600);
      const st1 = await page.evaluate(() => window.__fractonica.instances.sound.engine.stats());
      const status1 = await q(page, '.snd-status');
      check(/^Audio on · \d+ voices$/.test(status1), 'status line while sounding has no sample rate (no kHz)', status1);
      await press(page, 'p');
      await page.waitForTimeout(400);
      const st2 = await page.evaluate(() => ({ enabled: window.__fractonica.instances.sound.enabled, ...window.__fractonica.instances.sound.engine.stats() }));
      const f2 = await freqs();
      check(st2.enabled && st2.voices === st1.voices && JSON.stringify(f2) === JSON.stringify(f0), 'switching to normal mode while sounding changes nothing in the audio', `voices ${st1.voices} -> ${st2.voices}`);
      check(/^Audio on · [\d.]+ kHz · \d+ voices$/.test(await q(page, '.snd-status')), 'normal status line has its sample rate again', await q(page, '.snd-status'));
      await press(page, 'p');
      await page.waitForTimeout(300);
      await page.click('.snd-power');
      await page.waitForTimeout(400);

      // render() stays cheap in pure mode, with the sound on and a time-lapse running
      await page.evaluate(() => window.__fractonica.store.setRate(18188.9));
      await page.click('.snd-power');
      await page.waitForTimeout(500);
      const cost = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const inst = window.__fractonica.instances.sound;
            const orig = inst.render;
            let n = 0;
            let sum = 0;
            let max = 0;
            inst.render = function (...a) {
              const t0 = performance.now();
              const r = orig.apply(this, a);
              const d = performance.now() - t0;
              sum += d;
              max = Math.max(max, d);
              if (++n === 120) {
                inst.render = orig;
                resolve({ avg: sum / n, max });
              }
              return r;
            };
          }),
      );
      check(cost.avg < 3, 'render() under 3 ms on average in pure mode', `avg ${cost.avg.toFixed(2)} ms, max ${cost.max.toFixed(2)} ms`);
      await page.click('.snd-power');
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__fractonica.store.setRate(0));

      // an audio failure speaks pure as well (a fresh page: the engine has not made a context yet)
      await page.goto(url(`?t=${T}&view=sound&zone=UTC&pure=1`));
      await page.waitForSelector('.snd-power');
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        window.AudioContext = undefined;
        window.webkitAudioContext = undefined;
      });
      await page.click('.snd-power');
      await page.waitForTimeout(250);
      const failToast = await q(page, '#toast');
      check(/^Audio could not start: /.test(failToast) && judge([{ kind: 'text', text: failToast, where: '#toast' }], 'toast').length === 0, 'the error toast has no Earth reference', failToast);
      check(judge([{ kind: 'text', text: 'The browser blocks audio until you click or press a key on this page', where: 'engine' }], '').length === 0, 'the autoplay message has no Earth reference');

      // ---------------------------------------------------------------------------------------------
      // 3. live switching reads exactly like a fresh load, both ways
      // ---------------------------------------------------------------------------------------------
      const fresh = async (pure, extra = '') => {
        await page.goto(url(`?t=${T}&view=sound&zone=UTC&pure=${pure ? 1 : 0}${extra}`));
        await page.waitForSelector('.snd-power');
        await page.waitForTimeout(700);
        return norm((await snapshot(page)).lines);
      };
      const diff = (a, b) => ({ only1: a.filter((x) => !b.includes(x)), only2: b.filter((x) => !a.includes(x)) });
      for (const [name, prep] of [
        ['defaults', async () => {}],
        [
          'a busy panel (physical register, muted depth, other base, floor, selection, time-lapse)',
          async () => {
            await page.click('.snd [data-layer="physical"]');
            await page.click('.snd-phys [data-step="1"]');
            await page.locator('.snd-base').fill('-5');
            await page.selectOption('.snd-floor', '0.25');
            await page.click('.snd-strip[data-level="3"] .snd-strip-on');
            await page.evaluate(() => {
              window.__fractonica.store.set({ selectedLevel: 4 });
              window.__fractonica.store.setRate(18188.9);
            });
            await page.evaluate(() => window.__fractonica.store.setTime(1791460800));
          },
        ],
      ]) {
        await page.goto(url(`?t=${T}&view=sound&zone=UTC&pure=0`));
        await page.waitForSelector('.snd-power');
        await page.waitForTimeout(500);
        await prep();
        const rateNow = await page.evaluate(() => window.__fractonica.store.rate);
        await page.evaluate(() => window.__fractonica.store.setRate(0)); // freeze: both sides must read the same instant
        await page.waitForTimeout(400);
        const normalBefore = norm((await snapshot(page)).lines);
        await press(page, 'p');
        await page.waitForTimeout(1300);
        const pureSwitched = norm((await snapshot(page)).lines);
        await press(page, 'p');
        await page.waitForTimeout(1300);
        const normalAfter = norm((await snapshot(page)).lines);
        const d1 = diff(normalBefore, normalAfter);
        check(d1.only1.length + d1.only2.length === 0, `${name}: normal -> pure -> normal leaves nothing behind`, JSON.stringify(d1).slice(0, 600));
        // fresh pure load of the very same state (settings persist in localStorage; time is frozen by the URL)
        await page.goto(url(`?t=${T}&view=sound&zone=UTC&pure=1`));
        await page.waitForSelector('.snd-power');
        await page.waitForTimeout(700);
        await page.evaluate(() => window.__fractonica.store.setRate(0));
        await page.waitForTimeout(300);
        const pureFresh = norm((await snapshot(page)).lines);
        const d2 = diff(pureSwitched, pureFresh);
        check(d2.only1.length + d2.only2.length === 0, `${name}: the live switch to pure reads like a fresh pure load`, JSON.stringify(d2).slice(0, 600));
        void rateNow;
      }
      // restore the panel
      await page.goto(url(`?t=${T}&view=sound&zone=UTC&pure=0`));
      await page.waitForSelector('.snd-power');
      await page.evaluate(() => localStorage.removeItem('fractonica-clock/sound/v1'));

      // the panel switched while another tab was showing is right when it is opened
      await page.goto(url(`?t=${T}&view=rings&zone=UTC&pure=0`));
      await page.waitForTimeout(500);
      await press(page, 'p');
      await page.waitForTimeout(300);
      await press(page, '5');
      await page.waitForTimeout(500);
      check(await page.evaluate(() => document.body.dataset.view === 'sound'), 'the Sound tab opens (key 5)');
      check(/^ground ×1$/.test(await q(page, '.snd-base ~ output')) && (await q(page, '.snd-secs-unit')) === 'beats', 'a switch made while the panel was hidden is already applied when it opens');
      await press(page, '1');
      await press(page, 'p');
      await page.waitForTimeout(300);
      await press(page, '5');
      await page.waitForTimeout(400);
      check(/Hz · A2/.test(await q(page, '.snd-base ~ output')) && (await q(page, '.snd-secs-unit')) === 's', 'switched back while hidden: normal wording again');
      check((await momentToast()) === 'Outside the Saros 141 catalogue: no chord to play', 'normal mode keeps its toast for a refused moment');
      // keyboard-only text (focus tips) in pure mode
      await press(page, 'p');
      await page.waitForTimeout(300);
      await page.focus('.snd-power');
      const kb = [];
      for (let i = 0; i < 64; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(40);
        const t = await page.evaluate(() => {
          const tip = document.querySelector('.snd-tip:not([hidden])');
          return tip ? tip.textContent.replace(/\s+/g, ' ') : '';
        });
        if (t && !kb.some((x) => x.text === t)) kb.push({ text: t, where: 'focus tip' });
      }
      const kbLeaks = judge(kb.map((x) => ({ kind: 'text', ...x })), 'keyboard focus tips');
      check(kb.length > 10 && kbLeaks.filter((l) => l.severity === 'hard').length === 0, `keyboard focus tips (${kb.length} different ones) have no leak`, kbLeaks.map((l) => l.match).join(','));

      // ---------------------------------------------------------------------------------------------
      // 4. pictures
      // ---------------------------------------------------------------------------------------------
      for (const [label, viewport] of [
        ['desktop', { width: 1440, height: 900 }],
        ['mobile', { width: 390, height: 844 }],
      ]) {
        await page.setViewportSize(viewport);
        for (const [name, t, extra] of [
          ['a', T, ''],
          ['y2000', 946684800, ''],
          ['y2061', 2886085800, '&rate=18188.9'],
          ['edge', 28005212035 - 5, ''],
          ['out', 28005212035 + 10, ''],
        ]) {
          await page.goto(url(`?t=${t}&view=sound&zone=UTC&pure=1${extra}`));
          await page.waitForSelector('.snd-power');
          await page.waitForTimeout(700);
          await page.locator('.snd-hero').scrollIntoViewIfNeeded();
          await page.evaluate(() => window.scrollTo(0, 0));
          await shot(`sound-pure-${label}-${name}.png`);
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });

      check(errors.filter(ownError).length === 0, 'no console errors from the sound module', errors.filter(ownError).slice(0, 3).join(' | '));
    },
    { viewport: { width: 1440, height: 900 } },
  );
  console.log(failures ? `\n${failures} check(s) failed` : '\nall pure-mode sound checks passed');
  return failures ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();
