/**
 * Pure-mode leak scanner: finds every Gregorian / Earth-unit / percentage reference a user could see.
 *
 *   import { installHooks, scan, hoverSweep, formatLeaks } from './pure-scan.mjs';
 *   await installHooks(page);            // before page.goto: records canvas text
 *   ... drive the app into a state ...
 *   const leaks = await scan(page, 'rings @ vector A');   // [{rule, text, where, state}]
 *
 * What is inspected (visible things only): body.innerText, title / aria-label / aria-description / placeholder /
 * alt attributes of visible elements, the option labels of visible <select>s, SVG <title> text, and every string
 * drawn on a canvas since the last scan (fillText / strokeText are hooked).
 *
 * HARD rules fail the check; SOFT rules are listed for a human to judge (e.g. a 4-digit number may be a ratio).
 */

export const RULES = [
  // [id, regex, severity]
  ['clock-time', /\b\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\b/, 'hard'],
  ['iso-date', /\b\d{4}-\d{2}-\d{2}\b/, 'hard'],
  ['slash-date', /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/, 'hard'],
  ['month-name', /\b(January|February|March|April|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b|\bMay\s\d/, 'hard'],
  ['weekday', /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b/, 'hard'],
  ['earth-unit', /\b\d+([.,]\d+)?\s?(ms|msec|s|sec|secs|min|mins|h|hr|hrs|d|day|days|wk|wks|week|weeks|mo|month|months|y|yr|yrs|year|years|Hz|kHz|bpm|BPM)\b/, 'hard'],
  ['per-unit', /\bper\s(s|sec|second|min|minute|hour|day|week|month|year)\b|\/(s|min|h|d|y)\b/, 'hard'],
  ['unit-word', /\b(seconds?|minutes?|hours?|days?|weeks?|months?|years?|decades?|centur(y|ies)|today|tomorrow|yesterday|daily|weekly|monthly|yearly|annual|midnight|noon|o'clock)\b/i, 'hard'],
  ['zone-word', /\b(UTC|GMT|UT1|Unix|ISO\s?8601|time\s?zones?|timezones?|local time|Gregorian|Julian|Anno|DST|daylight)\b/i, 'hard'],
  ['am-pm', /\b\d{1,2}\s?(am|pm|AM|PM)\b|\bAD\b|\bBC\b/, 'hard'],
  ['percent', /%|\bper ?cent(age)?s?\b/i, 'hard'],
  ['frequency', /\bHz\b|\bkHz\b|\bhertz\b/i, 'hard'],
  // revision 2: whole cycles only, and real time is counted in Blinks (cycles per Blink = pB), never in beats
  ['half-unit', /[αβγδεζηθικλμνξ]½/, 'hard'],
  ['beat-word', /\bbeats?\b/i, 'hard'],
  // revision 3: the depths between the minor units have no names, and only Alpha … Delta have fracton names
  ['retired-unit', /\b(Hadron|Quark|Chromon|Somon|Atom)s?\b/, 'hard'],
  ['minor-fracton', /\b(Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi|Omicron)\s+[A-Za-z]*fracton\b/, 'hard'],
  ['note-name', /\b[A-G](#|♯|♭)?\d\b/, 'hard'],
  ['saros', /\bSaros\b/i, 'soft'],
  ['year-number', /\b(1[6-9]\d\d|2[0-8]\d\d)\b/, 'soft'],
  ['eclipse-date-word', /\beclipses?\b/i, 'soft'],
];

export async function installHooks(page) {
  await page.addInitScript(() => {
    window.__canvasText = new Map(); // text -> where (canvas id / classes)
    const wrap = (name) => {
      const orig = CanvasRenderingContext2D.prototype[name];
      CanvasRenderingContext2D.prototype[name] = function (text, ...rest) {
        try {
          // only text that can be seen: skip fully transparent strings and off-screen canvases
          const c = this.canvas;
          if (c?.isConnected && c.getClientRects().length) {
            const where = (c.id ? '#' + c.id : '') + [...c.classList].slice(0, 2).map((k) => '.' + k).join('') || 'canvas';
            window.__canvasText.set(String(text), where);
          }
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

/** Drop the canvas strings recorded so far (call after a mode switch, before scanning the new state). */
export async function drainCanvas(page) {
  await page.evaluate(() => { window.__canvasText = new Map(); });
}

/** Collect everything visible. */
export async function collect(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el.isConnected) return false;
      if (el.closest('[hidden]')) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      return el.getClientRects().length > 0;
    };
    const items = [];
    const add = (kind, text, el) => {
      const t = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      const where = el
        ? (el.id ? '#' + el.id : '') + [...(el.classList ?? [])].slice(0, 2).map((c) => '.' + c).join('') || el.tagName.toLowerCase()
        : '';
      items.push({ kind, text: t, where });
    };
    // visible text, line by line, with the nearest identifiable element as location
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
      if (el.tagName === 'OPTION') continue;
      if (!visible(el)) continue;
      add('text', n.nodeValue, el);
    }
    for (const el of document.querySelectorAll('[title],[aria-label],[aria-description],[placeholder],[alt]')) {
      if (!visible(el)) continue;
      for (const a of ['title', 'aria-label', 'aria-description', 'placeholder', 'alt']) if (el.hasAttribute(a)) add('attr:' + a, el.getAttribute(a), el);
    }
    for (const sel of document.querySelectorAll('select')) {
      if (!visible(sel)) continue;
      for (const o of sel.options) add('option', o.textContent, sel);
      for (const g of sel.querySelectorAll('optgroup')) add('optgroup', g.label, sel);
    }
    for (const t of document.querySelectorAll('svg title')) if (visible(t.parentElement)) add('svg-title', t.textContent, t.parentElement);
    for (const el of document.querySelectorAll('input')) if (visible(el) && el.type !== 'range' && el.value) add('input-value', el.value, el);
    const canvas = [...(window.__canvasText ?? new Map())];
    window.__canvasText = new Map();
    for (const [text, where] of canvas) items.push({ kind: 'canvas', text: String(text).replace(/\s+/g, ' ').trim(), where });
    return items;
  });
}

export function judge(items, state) {
  const leaks = [];
  const seen = new Set();
  for (const it of items) {
    for (const [rule, re, severity] of RULES) {
      const m = re.exec(it.text);
      if (!m) continue;
      const key = rule + '|' + it.text;
      if (seen.has(key)) continue;
      seen.add(key);
      leaks.push({ rule, severity, match: m[0], text: it.text.length > 160 ? it.text.slice(0, 157) + '…' : it.text, kind: it.kind, where: it.where, state });
    }
  }
  return leaks;
}

export async function scan(page, state = '') {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const items = await collect(page);
  return judge(items, state);
}

/** Move the mouse over a grid inside `box` ({x,y,width,height}) and over interactive elements, scanning after each dwell. */
export async function hoverSweep(page, state, { cols = 9, rows = 6, dwell = 90, box } = {}) {
  const all = [];
  const b = box ?? { x: 0, y: 0, ...page.viewportSize() };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      await page.mouse.move(b.x + ((c + 0.5) * b.width) / cols, b.y + ((r + 0.5) * b.height) / rows);
      await page.waitForTimeout(dwell);
      all.push(...(await scan(page, `${state} · hover(${c},${r})`)));
    }
  }
  return all;
}

/** Dwell on the first `limit` visible interactive elements (long enough for delayed tooltips). */
export async function hoverInteractive(page, state, { limit = 70, dwell = 700 } = {}) {
  const boxes = await page.evaluate((limit) => {
    const out = [];
    const sel = 'button, [role=button], [role=option], [role=slider], a, [tabindex="0"], summary, canvas';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      if (out.length >= limit) break;
    }
    return out;
  }, limit);
  const all = [];
  for (const [i, p] of boxes.entries()) {
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(dwell);
    all.push(...(await scan(page, `${state} · dwell#${i}`)));
  }
  return all;
}

export function formatLeaks(leaks, { soft = false } = {}) {
  const rows = leaks.filter((l) => soft || l.severity === 'hard');
  const byKey = new Map();
  for (const l of rows) {
    const k = `${l.rule}|${l.text}`;
    if (!byKey.has(k)) byKey.set(k, { ...l, states: [l.state] });
    else if (byKey.get(k).states.length < 3) byKey.get(k).states.push(l.state);
  }
  return [...byKey.values()].map((l) => `[${l.severity}] ${l.rule} "${l.match}" in ${l.kind} ${l.where}\n      "${l.text}"\n      e.g. ${l.states.join(' | ')}`).join('\n');
}
