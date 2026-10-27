/**
 * The Pentad card (side panel) and the header's Pentad button: the Helion as the clock's link to the Sun (SPEC §7.5).
 *
 *   card     "PENTAD  [⬠II] 2nd Helion of 5" · the chart of the running sync's four Pentads against the solar day ·
 *            one line on why · what comes next ("Pentad III in 3η 12ι") · an (i) that opens the longer story
 *   header   #ro-pentad, the mark that leads the readout like a weekday: its title says the Pentad and its Helion, a
 *            click opens the same chart in a popover (phones and the Calendar tab, where the side panel is hidden)
 *
 * Contract: export mount(el, ctx) -> { render, destroy } (docs/ARCHITECTURE.md); the header button is wired here too
 * because both show the same reading and story.
 */
import { createPentadChart } from './chart.js';
import { pentadMarkHTML, pentadName, pentadStep, helionPlace, PENTAD_HELIONS, DAY_TEXT, QUARTER_TEXT } from '../pentad.js';

const INFO_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="M8 7.2v3.6"/><circle cx="8" cy="5.1" r=".5" fill="currentColor"/></svg>';

/** One line under the chart. */
export function pentadCaption(pure) {
  return pure
    ? `${DAY_TEXT} is a solar day, so each Pentad starts ${QUARTER_TEXT} later in it; the Hypopentad, one Helion short, brings Pentad I back.`
    : `A solar day is ${DAY_TEXT}, so each Pentad starts ${QUARTER_TEXT} (1 h 16 min) later in the day; the Hypopentad, one Helion short, brings Pentad I back.`;
}

/** The longer story, in the owner's terms: both directions of the Helion–Sun link. HTML; pure mode has no Earth units. */
export function pentadStory(pure) {
  const marks = `${pentadMarkHTML(1)} is Pentad II, ${pentadMarkHTML(3)} the Hypopentad: the shape's sides are its Helions`;
  if (pure) {
    return [
      `<p>The <b>Helion</b> (η) is the clock's link to the Sun: ${DAY_TEXT} is a solar day.</p>`,
      `<p><b>From the Sun:</b> when the Sun is back at the same place in the sky, a solar day later, the Helions have slipped a quarter Helion back. Each Helion's quarter lands on the same place in the solar day, and after 4 solar days – 19 Helions, one solar sync – the whole pattern repeats, about a Flavon early.</p>`,
      `<p><b>From the Helion:</b> after 5 Helions – a <b>Pentad</b> – the Sun is ${QUARTER_TEXT} later in the solar day. Pentads I, II and III drift ¼, ½ and ¾ Helion; the fourth, the <b>Hypopentad</b>, is one Helion short and brings the Sun back: a leap run backwards, taking a period out instead of adding one.</p>`,
      `<p>So a Pentad is the clock's own solar day, and a date leads with it: ${marks}.</p>`,
    ].join('');
  }
  return [
    `<p>The <b>Helion</b> (η, 5 h 3 min) is the clock's link to the Sun: a solar day is ${DAY_TEXT} (23 h 59.8 min).</p>`,
    `<p><b>From the Sun:</b> when the Sun is back at the same place in the sky a day later, the Helions have slipped a quarter Helion back. Each Helion's quarter lands on the same time of day, and after 4 days – 19 Helions, one solar sync – the whole pattern repeats, about 10 seconds earlier.</p>`,
    `<p><b>From the Helion:</b> after 5 Helions – a <b>Pentad</b> – the Sun is ${QUARTER_TEXT} (1 h 16 min) later in its day. Pentads I, II and III drift ¼, ½ and ¾ Helion; the fourth, the <b>Hypopentad</b>, is one Helion short and brings the Sun back: a leap year run backwards, taking a period out instead of adding one.</p>`,
    `<p>So a Pentad is the clock's day, and a date leads with it the way a calendar date leads with its weekday: ${marks}.</p>`,
  ].join('');
}

const PANEL = `
  <div class="card-h">
    <h2>Pentad</h2>
    <span class="pentad-now"></span>
    <span class="spacer"></span>
    <button class="btn btn-icon btn-sm pentad-info-btn" type="button" aria-expanded="false" title="Why Pentads: the Helion and the Sun">${INFO_ICON}</button>
  </div>
  <div class="card-b">
    <div class="pentad-chart-slot"></div>
    <p class="pentad-cap"></p>
    <p class="pentad-next mono"></p>
    <div class="pentad-story" hidden></div>
  </div>`;

export function mount(el, ctx) {
  const { model, store, fmt } = ctx;
  const isPure = () => !!store.state.pure;

  /** One panel (the card or the popover): its chart, its lines and its story toggle. */
  function panel(root, { close = null } = {}) {
    root.innerHTML = PANEL;
    const $ = (s) => root.querySelector(s);
    const chart = createPentadChart({ model, fmt, isPure });
    $('.pentad-chart-slot').append(chart.el);
    const story = $('.pentad-story');
    const info = $('.pentad-info-btn');
    if (close) {
      // the popover always tells the story; it only needs a way out
      info.hidden = true;
      const b = document.createElement('button');
      b.className = 'btn btn-sm';
      b.type = 'button';
      b.textContent = 'Close';
      b.dataset.close = '';
      b.addEventListener('click', close);
      info.after(b);
    }
    info.addEventListener('click', () => {
      const open = story.hidden;
      story.hidden = !open;
      info.setAttribute('aria-expanded', String(open));
      info.classList.toggle('is-on', open);
      last.delete(story);
      paint(store.t(), true);
    });
    return { root, chart, now: $('.pentad-now'), cap: $('.pentad-cap'), next: $('.pentad-next'), story };
  }

  // ---- the card --------------------------------------------------------------------------------------------------
  el.textContent = '';
  el.classList.add('pentad-card');
  el.setAttribute('aria-label', 'Pentad: the Helions against the solar day');
  const last = new Map(); // node -> last html
  const card = panel(el);

  // ---- the header button and its popover ---------------------------------------------------------------------------
  const btn = document.getElementById('ro-pentad');
  const pop = document.getElementById('pentad-pop');
  let popPanel = null;
  function openPop() {
    if (!pop || !btn) return;
    popPanel ??= panel(pop, { close: () => closePop() });
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    paint(store.t(), true);
    pop.querySelector('[data-close]').focus();
  }
  function closePop(focus = true) {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    btn?.setAttribute('aria-expanded', 'false');
    if (focus) btn?.focus();
  }
  const onBtn = () => (pop?.hidden ? openPop() : closePop());
  const onKey = (e) => {
    if (e.key === 'Escape' && pop && !pop.hidden) closePop();
  };
  const onDown = (e) => {
    if (!pop || pop.hidden) return;
    if (pop.contains(e.target) || btn?.contains(e.target)) return;
    closePop(false);
  };
  btn?.addEventListener('click', onBtn);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown);

  // ---- painting ------------------------------------------------------------------------------------------------------
  const set = (node, html) => {
    if (last.get(node) !== html) {
      node.innerHTML = html;
      last.set(node, html);
    }
  };
  /** "[⬠II] 2nd Helion of 5" beside the title. */
  const nowHTML = (p) => `${pentadMarkHTML(p, { cls: 'is-gold' })}<span class="pentad-of">${helionPlace(p.helion)} of ${PENTAD_HELIONS[p.index]}</span>`;
  /** "Pentad III in 3η 12ι" (pure) / "Pentad III in 3 h 12 min · 16:17": what begins next. */
  function nextText(p, t) {
    const n = pentadStep(model, p, 1);
    if (!n) return 'The catalogue ends in this Pentad';
    const when = fmt.countdown(n.start - t);
    return isPure() ? `${pentadName(n.index)} ${when}` : `${pentadName(n.index)} ${when} · ${fmt.label(n.start, t)}`;
  }

  let lastKey = '';
  let lastMode = '';
  let lastSec = NaN;
  function paint(t, force = false) {
    const pure = isPure();
    const p = model.pentadAt(t);
    // the header mark: leads the readout like a weekday
    if (btn) {
      const k = p ? `${p.index}|${p.helion}` : '-';
      if (btn.dataset.key !== k) {
        btn.hidden = !p;
        btn.innerHTML = p ? pentadMarkHTML(p.index, { cls: 'is-gold' }) : '';
        const say = p ? `${pentadName(p)}, ${helionPlace(p.helion)} of ${PENTAD_HELIONS[p.index]}` : '';
        btn.setAttribute('aria-label', p ? `${say}. Show the Pentads against the solar day` : 'No Pentad');
        btn.title = p ? `${say}: the Pentad leads the date like a weekday. Click for the Pentads against the solar day.` : '';
        btn.dataset.key = k;
      }
    }
    const open = popPanel && !pop.hidden;
    const mode = `${pure}|${store.state.zone}`;
    const remode = mode !== lastMode;
    card.chart.update(t, remode);
    if (open) popPanel.chart.update(t, remode || force);
    const sec = Math.floor(t);
    const key = `${p ? `${p.sync}|${p.index}|${p.helion}` : '-'}|${mode}`;
    if (!force && key === lastKey && sec === lastSec) return;
    lastSec = sec;
    lastKey = key;
    lastMode = mode;
    const now = p ? nowHTML(p) : '<span class="dim">outside the catalogue</span>';
    const cap = p ? pentadCaption(pure) : '';
    const next = p ? nextText(p, t) : '';
    for (const x of open ? [card, popPanel] : [card]) {
      set(x.now, now);
      set(x.cap, cap);
      set(x.next, next.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
      if (!x.story.hidden || x === popPanel) {
        x.story.hidden = false;
        set(x.story, pentadStory(pure));
      }
    }
  }

  return {
    render(frame, info) {
      if (!info.dirty) return;
      paint(frame.t);
    },
    destroy() {
      btn?.removeEventListener('click', onBtn);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      card.chart.destroy();
      popPanel?.chart.destroy();
    },
  };
}
