/**
 * The diary preview: the current page large (or the spread of verso + recto on wide screens), page navigation
 * (◀ ▶, a page number, the sections of the plan), and a strip of thumbnails rendered lazily (only the ones near the
 * visible part of the strip, a few per frame, released again when far away).
 *
 *   const pv = createPreview({ onPage(no), onLayout(layout), onShownPage() });
 *   pv.setPlan(plan, env, { renderPage, pageTitle });   pv.setPage(no);   pv.setShown(no | null)
 *
 * Page SVGs are memoised per plan (a small LRU), so turning back and forth and the thumbnails share the work.
 */
import { h, ICONS, setText, setAttr } from './dom.js';
import { clampPage, spreadOf, stepPage, sectionAt } from './logic.js';

const CACHE = 40; // page SVGs kept per plan
const THUMB_LIVE = 90; // thumbnails holding an image at most
const SPREAD_MIN = 600; // stage width (px) from which a spread fits

export function createPreview({ onPage, onLayout, onShownPage, layout: layout0 = 'spread' }) {
  let plan = null;
  let env = null;
  let fns = null;
  let page = 1;
  let layout = layout0;
  let shown = null;
  let active = false;
  let wide = true;
  const cache = new Map();
  let warned = false;

  // ---- DOM ---------------------------------------------------------------------------------------------
  const prev = h('button.btn.btn-icon.dy-prev', { type: 'button', 'aria-label': 'Previous page', title: 'Previous page (←)', html: ICONS.prev });
  const next = h('button.btn.btn-icon.dy-next', { type: 'button', 'aria-label': 'Next page', title: 'Next page (→)', html: ICONS.next });
  const num = h('input.input.dy-pno', { type: 'number', min: 1, step: 1, inputmode: 'numeric', 'aria-label': 'Page number' });
  const of = h('span.dy-of');
  const here = h('button.btn.btn-icon.dy-here', { type: 'button', 'aria-label': 'Page of the shown moment', title: 'Page of the shown moment', html: ICONS.target });
  const sections = h('select.select.dy-secs', { 'aria-label': 'Go to a section' });
  const segPage = h('button', { type: 'button', text: 'Page', 'aria-pressed': 'false' });
  const segSpread = h('button', { type: 'button', text: 'Spread', 'aria-pressed': 'false' });
  const seg = h('div.seg.dy-layout', { role: 'group', 'aria-label': 'Preview layout' }, segPage, segSpread);
  const nav = h('div.dy-nav', null, h('div.dy-pager', null, prev, h('label.dy-pnl', null, h('span.sr-only', { text: 'Page' }), num), of, next), here, sections, seg);
  const ptitle = h('p.dy-ptitle', { 'aria-live': 'polite' });
  const spreadEl = h('div.dy-spread');
  const stage = h('div.dy-stage', { tabindex: '0', role: 'group', 'aria-roledescription': 'page preview', 'aria-label': 'Diary pages: the arrow keys turn the pages' }, spreadEl);
  // one tab stop for the whole strip (the current page); the arrow keys, Home and End move along it
  const strip = h('div.dy-thumbs', { role: 'group', 'aria-label': 'All pages: the arrow keys move between them' });
  const el = h('div.dy-preview', null, nav, ptitle, stage, strip);
  here.disabled = true;

  prev.addEventListener('click', () => go(stepPage(page, -1, count(), isSpread())));
  next.addEventListener('click', () => go(stepPage(page, +1, count(), isSpread())));
  num.addEventListener('change', () => go(clampPage(num.value, count())));
  num.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go(clampPage(num.value, count()));
  });
  sections.addEventListener('change', () => {
    const p = Number(sections.value);
    if (p) go(p);
  });
  here.addEventListener('click', () => onShownPage?.());
  segPage.addEventListener('click', () => setLayout('page', true));
  segSpread.addEventListener('click', () => setLayout('spread', true));
  stage.addEventListener('keydown', (e) => {
    const n = count();
    const map = { ArrowLeft: -1, ArrowRight: 1, PageUp: -1, PageDown: 1, ArrowUp: -1, ArrowDown: 1 };
    if (e.key in map) {
      e.preventDefault();
      go(stepPage(page, map[e.key], n, isSpread()));
    } else if (e.key === 'Home') {
      e.preventDefault();
      go(1);
    } else if (e.key === 'End') {
      e.preventDefault();
      go(n);
    }
  });
  strip.addEventListener('keydown', (e) => {
    const b = e.target.closest?.('.dy-thumb');
    if (!b) return;
    const no = Number(b.dataset.no);
    const map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 };
    const to = e.key in map ? no + map[e.key] : e.key === 'Home' ? 1 : e.key === 'End' ? count() : null;
    if (to === null) return;
    e.preventDefault();
    go(clampPage(to, count()));
    thumbs[page - 1]?.focus({ preventScroll: true });
  });
  spreadEl.addEventListener('click', (e) => {
    const s = e.target.closest('.dy-sheet[data-no]');
    if (s) go(Number(s.dataset.no));
  });

  const count = () => plan?.pages.length ?? 1;
  const isSpread = () => layout === 'spread' && wide;

  // ---- page SVGs ---------------------------------------------------------------------------------------
  function svgOf(no) {
    if (cache.has(no)) {
      const v = cache.get(no);
      cache.delete(no);
      cache.set(no, v);
      return v;
    }
    let svg;
    try {
      svg = fns.renderPage(plan, plan.pages[no - 1], env);
    } catch (err) {
      if (!warned) console.warn('[diary] page renderer failed', err);
      warned = true;
      const { width: W, height: H } = plan.opts.page;
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/><text x="${W / 2}" y="${H / 2}" font-size="5" text-anchor="middle" fill="#a33">Page ${no} could not be drawn</text></svg>`;
    }
    cache.set(no, svg);
    while (cache.size > CACHE) cache.delete(cache.keys().next().value);
    return svg;
  }
  const titleOf = (no) => {
    try {
      return fns.pageTitle(plan, plan.pages[no - 1]);
    } catch {
      return `Page ${no}`;
    }
  };

  // ---- layout ------------------------------------------------------------------------------------------
  function fit() {
    if (!plan) return;
    const { width: W, height: H } = plan.opts.page;
    const avail = stage.clientWidth - 2 * 12;
    if (avail <= 0) return;
    const nowWide = avail >= SPREAD_MIN;
    if (nowWide !== wide) {
      wide = nowWide;
      draw();
      return;
    }
    const n = isSpread() ? 2 : 1;
    const sticky = getComputedStyle(el.closest('.dy-pcard') ?? el).position === 'sticky';
    const bar = document.getElementById('topbar')?.getBoundingClientRect().height ?? 68;
    const maxH = Math.max(260, innerHeight - (sticky ? bar + 280 : 170));
    const pw = Math.max(80, Math.min((avail - (n - 1) * 2) / n, (maxH * W) / H));
    spreadEl.style.setProperty('--dy-pw', `${Math.floor(pw)}px`);
    spreadEl.style.setProperty('--dy-ph', `${Math.floor((pw * H) / W)}px`);
  }
  const ro = new ResizeObserver(() => active && fit());
  ro.observe(stage);
  const onResize = () => active && fit();
  addEventListener('resize', onResize);

  // ---- drawing ------------------------------------------------------------------------------------------
  function sheetEl(no, current) {
    if (!no) return h('div.dy-sheet.is-empty', { 'aria-hidden': 'true' });
    const p = plan.pages[no - 1];
    const s = h('div.dy-sheet', { dataset: { no: String(no), side: p.side }, role: 'img', 'aria-label': `Page ${no}: ${titleOf(no)}` });
    if (current) s.classList.add('is-current');
    s.innerHTML = svgOf(no);
    return s;
  }
  let drawnKey = '';
  function draw() {
    if (!plan) return;
    const n = count();
    page = clampPage(page, n);
    const pair = isSpread() ? spreadOf(page, n) : [page];
    const key = `${pair.join(',')}|${page}`;
    if (key !== drawnKey) {
      drawnKey = key;
      spreadEl.replaceChildren(...pair.map((no) => sheetEl(no, no === page)));
      spreadEl.classList.toggle('is-spread', pair.length === 2);
    }
    fit();
    num.value = String(page);
    num.max = String(n);
    setText(of, `of ${n}`);
    prev.disabled = stepPage(page, -1, n, isSpread()) === page;
    next.disabled = stepPage(page, +1, n, isSpread()) === page;
    setText(ptitle, pair.filter(Boolean).map((no) => titleOf(no)).join('   ·   '));
    const sec = sectionAt(plan.sections, page);
    sections.value = sec ? String(sec.page) : '';
    if (!sec) sections.value = '';
    segPage.setAttribute('aria-pressed', String(!isSpread()));
    segSpread.setAttribute('aria-pressed', String(isSpread()));
    seg.hidden = !wide;
    markThumbs();
  }

  // ---- thumbnails ---------------------------------------------------------------------------------------
  let thumbs = [];
  const visible = new Set();
  const live = new Set();
  const queue = [];
  let pump = null;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const no = Number(e.target.dataset.no);
        if (e.isIntersecting) {
          visible.add(no);
          if (!live.has(no) && !queue.includes(no)) queue.push(no);
        } else visible.delete(no);
      }
      schedulePump();
    },
    { root: strip, rootMargin: '0px 320px' },
  );
  function schedulePump() {
    if (pump || !queue.length || !active) return;
    pump = setTimeout(runPump, 16);
  }
  function runPump() {
    pump = null;
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 10) {
      const no = queue.shift();
      if (!visible.has(no) || live.has(no) || !thumbs[no - 1]) continue;
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgOf(no));
      thumbs[no - 1].firstChild.replaceChildren(img);
      live.add(no);
    }
    // keep the DOM light: drop images far from the visible part of the strip
    if (live.size > THUMB_LIVE) {
      for (const no of [...live]) {
        if (live.size <= THUMB_LIVE * 0.7) break;
        if (visible.has(no)) continue;
        thumbs[no - 1]?.firstChild.replaceChildren();
        live.delete(no);
      }
    }
    schedulePump();
  }
  function buildThumbs() {
    io.disconnect();
    visible.clear();
    live.clear();
    queue.length = 0;
    const { width: W, height: H } = plan.opts.page;
    strip.style.setProperty('--dy-ta', `${W} / ${H}`);
    thumbs = plan.pages.map((p) => {
      const b = h('button.dy-thumb', { type: 'button', tabindex: '-1', dataset: { no: String(p.no), side: p.side }, 'aria-label': `Page ${p.no}: ${titleOf(p.no)}` }, h('span.dy-timg'), h('span.dy-tno', { text: String(p.no), 'aria-hidden': 'true' }));
      b.addEventListener('click', () => go(p.no));
      return b;
    });
    strip.replaceChildren(...thumbs);
    for (const b of thumbs) io.observe(b);
    markThumbs(true);
  }
  let marked = [];
  function markThumbs(scroll = false) {
    for (const b of marked) {
      b.classList.remove('is-current', 'is-pair');
      b.removeAttribute('aria-current');
      b.tabIndex = -1;
    }
    marked = [];
    if (!thumbs.length) return;
    const pair = isSpread() ? spreadOf(page, count()) : [page];
    for (const no of pair) {
      const b = thumbs[no - 1];
      if (!b) continue;
      b.classList.add(no === page ? 'is-current' : 'is-pair');
      if (no === page) {
        b.setAttribute('aria-current', 'page');
        b.tabIndex = 0;
      }
      marked.push(b);
    }
    for (const b of thumbs) b.classList.toggle('is-shown', Number(b.dataset.no) === shown);
    const cur = thumbs[page - 1];
    if (cur && (scroll || active)) {
      // scroll the strip only (never the page): keep the current thumbnail in view
      const l = cur.offsetLeft; // the strip is the offset parent
      if (l < strip.scrollLeft + 8 || l + cur.offsetWidth > strip.scrollLeft + strip.clientWidth - 8) {
        strip.scrollLeft = Math.max(0, l - (strip.clientWidth - cur.offsetWidth) / 2);
      }
    }
  }

  function go(no) {
    const p = clampPage(no, count());
    if (p === page && drawnKey) {
      draw();
      return;
    }
    page = p;
    draw();
    onPage?.(page);
  }
  function setLayout(l, user = false) {
    layout = l === 'page' ? 'page' : 'spread';
    drawnKey = '';
    draw();
    if (user) onLayout?.(layout);
  }

  return {
    el,
    stage,
    /** A new plan: drop the cached pages, rebuild the section list and the thumbnails. */
    setPlan(nextPlan, nextEnv, renderFns) {
      plan = nextPlan;
      env = nextEnv;
      fns = renderFns;
      cache.clear();
      warned = false;
      drawnKey = '';
      sections.replaceChildren(h('option', { value: '', text: 'Sections …', disabled: true }), ...plan.sections.map((s) => h('option', { value: String(s.page), text: `${s.title} · ${s.page}` })));
      buildThumbs();
      draw();
    },
    setPage(no) {
      // before the first plan the page is kept as asked (draw() clamps it to the book)
      page = plan ? clampPage(no, count()) : Math.max(1, Math.round(Number(no)) || 1);
      if (plan) draw();
    },
    get page() {
      return page;
    },
    get spread() {
      return isSpread();
    },
    setLayout,
    /** The page that holds the displayed moment (a dot on its thumbnail), or null. */
    setShown(no) {
      if (no === shown) return;
      shown = no;
      here.disabled = !no;
      for (const b of thumbs) b.classList.toggle('is-shown', Number(b.dataset.no) === shown);
      setAttr(here, 'title', no ? `Page of the shown moment (${no})` : 'The shown moment is outside this Delta');
    },
    setActive(on) {
      active = on;
      if (on) {
        fit();
        schedulePump();
      } else {
        clearTimeout(pump);
        pump = null;
      }
    },
    relayout: fit,
    /** The SVG markup of a page (cached), for tests. */
    svgOf: (no) => (plan ? svgOf(no) : ''),
    destroy() {
      io.disconnect();
      ro.disconnect();
      removeEventListener('resize', onResize);
      clearTimeout(pump);
    },
  };
}
