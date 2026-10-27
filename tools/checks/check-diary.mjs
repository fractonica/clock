// Diary tab checks (headless Chromium): mounting, the Delta of the shown moment, options → plan, page navigation,
// the print document, persistence, a 360 px layout, pure mode (no Gregorian, the leak rules), no console errors.
//   node tools/checks/check-diary.mjs            screenshots: tools/out/diary-*.png
import { withApp } from '../browse.mjs';
import { installHooks, scan, judge } from '../pure-scan.mjs';
import { pdfPageCount, pdfPageSizes, sameSize } from '../diary-pdf.mjs';

const T = 1791460800; // SPEC vector A: Delta Trifracton (α#6 β#4 γ#9 δ#3)
let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}${cond || !extra ? '' : '  ' + extra}`);
};

await withApp(
  async ({ page, url, errors, shot, context }) => {
    /** Print a document to PDF the way the command line does: its page count and page sizes (mm). */
    const pdfOf = async (html) => {
      const p = await context.newPage();
      await p.setContent(html, { waitUntil: 'load', timeout: 120000 });
      const buf = await p.pdf({ preferCSSPageSize: true, printBackground: true, timeout: 300000 });
      await p.close();
      return { pages: pdfPageCount(buf), sizes: pdfPageSizes(buf) };
    };
    const S = () => page.evaluate(() => __fractonica.instances.diary.state);
    const P = (fn) => page.evaluate(`(() => { const d = __fractonica.instances.diary; const p = d.plan; return (${fn})(d, p); })()`);
    const settle = (ms = 500) => page.waitForTimeout(ms);
    await installHooks(page);
    await page.goto(url(`?t=${T}&view=rings`));
    await page.evaluate(() => {
      localStorage.removeItem('fractonica.diary.v1');
      localStorage.removeItem('fractonica.diary.ui.v1');
    });

    console.log('mount, lightweight while hidden');
    await page.goto(url(`?t=${T}&view=rings&zone=Europe/Berlin`));
    await settle(600);
    ok((await page.evaluate(() => !!document.querySelector('#view-diary .dy'))), 'the tab mounts');
    ok((await P('(d, p) => p')) === null, 'nothing is planned while the tab is hidden');
    await page.click('#tab-diary');
    await settle(700);
    const st0 = await S();
    ok(st0.planned && st0.delta === 1862 && st0.follow, 'shown: the Delta of the shown moment is planned', JSON.stringify(st0));
    ok((await page.textContent('.dy-name')) === 'Delta Trifracton', 'the Delta in words');
    ok((await page.textContent('.dy-stamp')) === 'α#6 β#4 γ#9 δ#3', 'its letters');
    ok((await page.getAttribute('.dy-follow', 'aria-pressed')) === 'true', '"Delta of the shown moment" is on');
    const pickers = await page.$$eval('.dy-pick', (els) => els.map((e) => e.selectedOptions[0]?.textContent));
    ok(pickers.join('|') === 'Alpha Hexafracton|Beta Tetrafracton|Gamma Nonafracton|Delta Trifracton', 'fracton-name pickers', pickers.join('|'));
    // each end of the Delta is a date led by its Pentad (SPEC §7.5): the mark (named for screen readers), then the date
    const spanParts = await page.$$eval('.dy-span .pentad-lead', (els) => els.map((e) => `${e.querySelector('.pentad-mark')?.getAttribute('aria-label')} · ${e.querySelector('.pentad-rest')?.textContent}`));
    const spanText = spanParts.join(' → ');
    const wantSpan = await page.evaluate(() => {
      const { model, ctx } = __fractonica;
      const c = model.cycleByIndex(3, 1862);
      const at = (t) => `${ctx.pure.PENTAD_NAMES[model.pentadAt(t).index]} · ${ctx.pure.dateText(t)}`;
      return `${at(c.start + 1e-3)} → ${at(c.end + 1e-3)}`;
    });
    ok(spanText === wantSpan && /^(Pentad I+|Hypopentad) · Delta Trifracton Peak ε#1 \d+η 0ι → (Pentad I+|Hypopentad) · Delta Tetrafracton Peak/.test(spanText), 'the span in Fractonica terms, each end led by its Pentad', spanText);
    ok((await page.$$('.dy-span .pentad-mark svg path')).length === 2, 'the Pentads drawn as shapes, not characters');
    ok(/2026.*→.*2026.*Europe\/Berlin/.test(await page.textContent('.dy-gspan')), 'the Gregorian range in the app zone');
    const pages0 = await P('(d, p) => p.pages.length');
    ok(pages0 >= 198 && pages0 % 2 === 0, `the default A5 diary: ${pages0} pages`);
    const same = await P('(d, p) => (window.__dyPlan = p, true)');
    await settle(400);
    ok(same && (await page.evaluate(() => __fractonica.instances.diary.plan === window.__dyPlan)), 'no re-planning per frame');

    console.log('the Delta follows the shown moment; pickers and ◀ ▶ take over');
    const nextDelta = await page.evaluate(() => {
      const { model, ctx } = __fractonica;
      const c = model.cycleByIndex(3, 1863);
      ctx.goto(c.start + 86400);
      return 1863;
    });
    await settle(500);
    ok((await S()).delta === nextDelta, 'time travel into the next Delta: the diary follows');
    ok((await page.textContent('.dy-name')) === 'Delta Tetrafracton', 'and names it');
    await page.selectOption('.dy-pick >> nth=1', '2');
    await settle(400);
    const st1 = await S();
    const want1 = await page.evaluate(() => (((6 - 1) * 5 + 1) * 13 + 8) * 5 + 3);
    ok(st1.delta === want1 && !st1.follow, 'picking Beta Difracton keeps the finer ordinals, stops following', JSON.stringify(st1));
    await page.click('.dy-picker .btn-icon >> nth=1');
    await settle(300);
    ok((await S()).delta === want1 + 1, '▶ next Delta');
    await page.click('.dy-picker .btn-icon >> nth=0');
    await page.click('.dy-picker .btn-icon >> nth=0');
    await settle(300);
    ok((await S()).delta === want1 - 1, '◀ previous Delta');
    await page.click('.dy-follow');
    await settle(500);
    const st2 = await S();
    ok(st2.follow && st2.delta === 1863, '"Delta of the shown moment" brings it back', JSON.stringify(st2));
    await page.evaluate((t) => __fractonica.ctx.goto(t), T);
    await settle(500);
    ok((await S()).delta === 1862, 'back to vector A');
    // the last Alpha offers only the Deltas inside the catalogue
    const lastOk = await page.evaluate(() => {
      const sel = document.querySelectorAll('.dy-pick')[0];
      return sel.options.length;
    });
    ok(lastOk === 18, `Alpha picker lists 18 Alphas (${lastOk})`);

    console.log('page navigation');
    const spread = (await S()).spread;
    ok(spread, 'a spread on a wide screen');
    await page.click('.dy-next');
    await settle(200);
    ok((await S()).page === 2, 'next: page 1 → spread 2|3');
    ok((await page.$$eval('.dy-sheet:not(.is-empty)', (e) => e.map((x) => x.dataset.no).join(','))) === '2,3', 'the spread shows verso 2 and recto 3');
    await page.fill('.dy-pno', '50');
    await page.press('.dy-pno', 'Enter');
    await settle(200);
    ok((await S()).page === 50, 'page number input');
    const nuc = await P('(d, p) => p.sections.find((s) => s.key === "nuclide-2").page');
    await page.selectOption('.dy-secs', String(nuc));
    await settle(200);
    ok((await S()).page === nuc, `section list: Nuclide ε#3 on page ${nuc}`);
    await page.focus('.dy-stage');
    await page.keyboard.press('End');
    await settle(150);
    ok((await S()).page === pages0, 'End: the last page');
    await page.keyboard.press('ArrowLeft');
    await settle(150);
    ok((await S()).page === pages0 - 1, '← one spread back');
    await page.keyboard.press('Home');
    await settle(150);
    ok((await S()).page === 1, 'Home: page 1');
    await page.click('.dy-thumb[data-no="9"]');
    await settle(300);
    ok((await S()).page === 9, 'a thumbnail opens its page');
    const thumbs = await page.$$eval('.dy-thumb', (els) => ({ all: els.length, live: els.filter((e) => e.querySelector('img')).length }));
    ok(thumbs.all === pages0 && thumbs.live > 0 && thumbs.live < pages0, `thumbnails: ${thumbs.all}, rendered lazily: ${thumbs.live}`);
    await page.click('.dy-here');
    await settle(200);
    const herePage = await P('(d, p) => p.pageOf(__fractonica.store.t())');
    ok((await S()).page === herePage, `"page of the shown moment" → ${herePage}`);
    console.log('keyboard');
    await page.focus('.dy-pick >> nth=0');
    const order = [];
    for (let i = 0; i < 12; i++) {
      order.push(await page.evaluate(() => {
        const a = document.activeElement;
        return a.classList.contains('dy-pick') ? 'pick' : [...a.classList].find((c) => c.startsWith('dy-')) ?? a.tagName.toLowerCase();
      }));
      await page.keyboard.press('Tab');
    }
    ok(order.slice(0, 4).every((x) => x === 'pick') && order.includes('dy-follow') && order.includes('dy-export') && order.indexOf('dy-export') < order.indexOf('dy-prev'), 'tab order: pickers, ◀ ▶, follow, export, then the pager', order.join(' '));
    ok((await page.$$eval('.dy-thumb', (els) => els.filter((e) => e.tabIndex === 0).length)) === 1, 'the thumbnail strip is a single tab stop');
    await page.focus('.dy-thumb[tabindex="0"]');
    const k0 = (await S()).page;
    await page.keyboard.press('ArrowRight');
    await settle(150);
    const k1 = await page.evaluate(() => ({ page: __fractonica.instances.diary.state.page, focus: document.activeElement.dataset.no }));
    ok(k1.page === k0 + 1 && k1.focus === String(k0 + 1), 'arrow keys move along the thumbnails and open the page', JSON.stringify(k1));
    await page.click('.dy-here');
    await settle(150);
    await page.click('.dy-layout button >> nth=0');
    await settle(200);
    ok(!(await S()).spread && (await page.$$('.dy-sheet')).length === 1, 'single-page layout');
    await page.click('.dy-layout button >> nth=1');
    await settle(200);
    await shot('diary-1440.png');

    console.log('options change the plan');
    await page.click('.dy-grp[data-key="paper"] > summary').catch(() => {});
    if (!(await page.evaluate(() => document.querySelector('.dy-grp[data-key="paper"]').open))) await page.click('.dy-grp[data-key="paper"] > summary');
    await page.selectOption('[data-path="page.size"]', 'A4');
    await settle(500);
    ok((await P('(d, p) => p.opts.page.width + "x" + p.opts.page.height')) === '210x297', 'A4 paper');
    const ratio = await page.$eval('.dy-sheet', (e) => e.getBoundingClientRect().height / e.getBoundingClientRect().width);
    ok(Math.abs(ratio - 297 / 210) < 0.02, `the preview has the A4 ratio (${ratio.toFixed(3)})`);
    if (!(await page.evaluate(() => document.querySelector('.dy-grp[data-key="lined"]').open))) await page.click('.dy-grp[data-key="lined"] > summary');
    await page.fill('[data-path="lined.linesPerHelion"]', '24');
    await settle(800);
    ok((await P('(d, p) => p.pages.find((x) => x.kind === "lined").sections[0].lines')) === 24, '24 lines per Helion');
    ok(/one line per 1ι 32λ/.test(await page.textContent('.dy-grp[data-key="lined"]')), 'the line span hint follows');
    if (!(await page.evaluate(() => document.querySelector('.dy-grp[data-key="lock"]').open))) await page.click('.dy-grp[data-key="lock"] > summary');
    await page.click('.dy-sheets .dy-item >> nth=3 >> .dy-del');
    await settle(500);
    ok((await page.textContent('.dy-readout')) === '15 Helions per lock · 5 locks + 2 retrospection Helions', 'removing a sheet: the live readout', await page.textContent('.dy-readout'));
    ok((await P('(d, p) => JSON.stringify(p.shape)')) === '{"perLock":15,"locks":5,"retro":2}', 'and the plan');
    await page.fill('.dy-sheets .dy-item >> nth=0 >> input >> nth=1', '4');
    await settle(800);
    ok((await P('(d, p) => p.shape.perLock')) === 17, 'a sheet back of 4 canvas Helions: 17 per lock');
    await page.click('.dy-grp[data-key="lock"] .dy-btns button >> nth=1'); // default pattern
    await settle(500);
    ok((await P('(d, p) => p.shape.perLock')) === 19, 'default pattern again');
    if (!(await page.evaluate(() => document.querySelector('.dy-grp[data-key="canvases"]').open))) await page.click('.dy-grp[data-key="canvases"] > summary');
    await page.selectOption('.dy-canvases >> nth=0 >> .dy-item >> nth=0 >> select', 'dot-grid');
    await settle(500);
    ok((await P('(d, p) => p.pages.find((x) => x.kind === "canvas").sections[0].canvas.type')) === 'dot-grid', 'a canvas type');
    if (!(await page.evaluate(() => document.querySelector('.dy-grp[data-key="front"]').open))) await page.click('.dy-grp[data-key="front"] > summary');
    const before = await P('(d, p) => p.pages.length');
    await page.fill('[data-path="front.planning"]', '3');
    await settle(800);
    const after = await P('(d, p) => p.pages.filter((x) => x.kind === "planning").length');
    ok(after === 3, `3 planning pages (book ${before} → ${await P('(d, p) => p.pages.length')} pages)`);
    // stored, and still there after a reload
    await page.goto(url(`?t=${T}&view=diary&zone=Europe/Berlin`));
    await settle(900);
    ok((await P('(d, p) => p.opts.page.size + "/" + p.opts.lined.linesPerHelion + "/" + p.opts.front.planning')) === 'A4/24/3', 'the options persist across a reload');
    ok((await S()).page === herePage, 'and so does the page');

    console.log('export: the print document');
    const doc = await page.evaluate(() => {
      const d = __fractonica.instances.diary;
      const html = d.printDocument();
      const size = /@page\s*\{[^}]*?size:\s*([\d.]+)mm\s+([\d.]+)mm/.exec(html);
      const x = new DOMParser().parseFromString(html, 'text/html');
      const top = [...x.querySelectorAll('svg')].filter((s) => !s.parentElement?.closest('svg')).length;
      return { pages: top, w: size && +size[1], h: size && +size[2], title: x.title, plan: d.plan.pages.length };
    });
    ok(doc.pages === doc.plan && doc.w === 210 && doc.h === 297, `print document: ${doc.pages} pages, @page ${doc.w} × ${doc.h} mm`, JSON.stringify(doc));
    ok(doc.title === 'Diary · Delta Trifracton (α#6 β#4 γ#9 δ#3)', `title "${doc.title}"`);
    const pdf1 = await pdfOf(await page.evaluate(() => __fractonica.instances.diary.printDocument()));
    ok(pdf1.pages === doc.plan && sameSize(pdf1.sizes, { width: 210, height: 297 }), `printed: ${pdf1.pages} PDF pages of A4`, JSON.stringify(pdf1));
    await page.click('.dy-export');
    await settle(1500);
    const ex = await page.evaluate(() => __fractonica.instances.diary.lastExport);
    ok(ex?.printed && ex.pages === doc.plan && ex.width === 210, 'Export PDF prints the document from a hidden frame', JSON.stringify(ex));
    ok(/Save as PDF/.test(await page.textContent('.dy-status')), 'and says how to save it');
    ok(/node tools\/diary-pdf\.mjs/.test(await page.textContent('.dy-how')), 'the command line is named');

    console.log('reset to defaults');
    await page.click('.dy-reset');
    await settle(500);
    ok((await P('(d, p) => p.opts.page.size + "/" + p.opts.lined.linesPerHelion + "/" + p.pages.length')) === `A5/12/${pages0}`, 'defaults again');
    const a5 = await page.evaluate(() => /size:\s*148mm 210mm/.test(__fractonica.instances.diary.printDocument()));
    ok(a5, '@page 148mm 210mm');

    console.log('two pages per sheet');
    if (!(await page.evaluate(() => document.querySelector('.dy-grp[data-key="print"]').open))) await page.click('.dy-grp[data-key="print"] > summary');
    ok(/2 × A5 on A4 landscape \(297 × 210 mm\)/.test(await page.textContent('.dy-grp[data-key="print"]')), 'the form says which paper two-up makes');
    ok(await page.isDisabled('[data-path="print.pairing"]'), 'pairing waits for two-up');
    await page.check('[data-path="print.twoUp"]');
    await settle(500);
    const n2 = await P('(d, p) => p.pages.length');
    ok((await P('(d, p) => p.opts.print.twoUp')) === true, 'the form turns two-up on');
    ok((await page.textContent('.dy-paper')) === `PDF: ${Math.ceil((n2 + 1) / 2)} pages of A4 landscape · 297 × 210 mm, two diary pages each (facing pages)`, 'the export line names the paper', await page.textContent('.dy-paper'));
    ok(/--path 6,4,9,3 --two-up$/.test(await page.textContent('.dy-how code')), 'and the command line carries it', await page.textContent('.dy-how code'));
    const html2 = await page.evaluate(() => __fractonica.instances.diary.printDocument());
    ok(/@page\s*\{[^}]*size:\s*297mm 210mm/.test(html2), 'two-up print document: @page 297mm 210mm', (/@page\s*\{[^}]*\}/.exec(html2) ?? [''])[0]);
    const pdf2 = await pdfOf(html2);
    ok(pdf2.pages === Math.ceil((n2 + 1) / 2) && sameSize(pdf2.sizes, { width: 297, height: 210 }), `facing pages: ${n2} pages on ${pdf2.pages} sheets of A4 landscape (want ${Math.ceil((n2 + 1) / 2)})`, JSON.stringify(pdf2));
    await page.selectOption('[data-path="print.pairing"]', 'sequential');
    await settle(500);
    const pdf3 = await pdfOf(await page.evaluate(() => __fractonica.instances.diary.printDocument()));
    ok(pdf3.pages === Math.ceil(n2 / 2) && sameSize(pdf3.sizes, { width: 297, height: 210 }), `in order: ${pdf3.pages} sheets (want ${Math.ceil(n2 / 2)})`, JSON.stringify(pdf3));
    await page.click('.dy-export');
    await settle(1500);
    const ex2 = await page.evaluate(() => __fractonica.instances.diary.lastExport);
    ok(ex2?.printed && ex2.width === 297 && ex2.height === 210 && ex2.sheets === Math.ceil(n2 / 2), 'Export PDF prints the landscape document', JSON.stringify(ex2));
    const copied = await page.evaluate(() => JSON.parse(localStorage.getItem('fractonica.diary.v1')).print);
    ok(copied.twoUp && copied.pairing === 'sequential', 'the print settings are stored with the options (and copied with them)');
    await page.uncheck('[data-path="print.twoUp"]');
    await settle(500);
    ok((await P('(d, p) => p.opts.print.twoUp')) === false && /size:\s*148mm 210mm/.test(await page.evaluate(() => __fractonica.instances.diary.printDocument())), 'two-up off: one A5 page per sheet again');

    console.log('the app zone and live pure switching');
    await page.evaluate(() => __fractonica.store.set({ zone: 'Asia/Tokyo' }));
    await settle(500);
    ok((await S()).zone === 'Asia/Tokyo' && /Asia\/Tokyo/.test(await page.textContent('.dy-gspan')), 'the diary follows the app zone');
    await page.evaluate(() => __fractonica.store.set({ zone: 'Europe/Berlin' }));
    await page.evaluate(() => __fractonica.store.set({ pure: true }));
    await settle(700);
    const pst = await P('(d, p) => ({ on: p.opts.gregorian.on, greg: p.pages.some((x) => x.kind === "gregorian"), days: p.days.length })');
    ok(!pst.on && !pst.greg && pst.days === 0, 'pure mode re-plans without Gregorian', JSON.stringify(pst));
    ok(await page.evaluate(() => document.querySelector('.dy-grp[data-key="gregorian"]').hidden && document.querySelector('.dy-gspan').hidden), 'Gregorian controls and range hidden');
    await page.evaluate(() => __fractonica.store.set({ pure: false }));
    await settle(700);
    ok((await P('(d, p) => p.opts.gregorian.on && p.pages.some((x) => x.kind === "gregorian")')) === true, 'back to normal: the Gregorian settings were kept');
    ok(!errors.length, 'no console errors', errors.slice(0, 4).join(' | '));
  },
  { viewport: { width: 1440, height: 900 } },
);

// pure mode from a link: nothing Gregorian, the leak rules
await withApp(
  async ({ page, url, errors, shot }) => {
    await installHooks(page);
    console.log('pure mode');
    await page.goto(url(`?pure=1&t=${T}&view=diary`));
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelectorAll('.dy-grp').forEach((d) => (d.open = true)));
    await page.waitForTimeout(400);
    const text = await page.evaluate(() => document.querySelector('.dy').innerText);
    ok(!/Gregorian|UTC|\b(19|20)\d\d\b|\bmonth|\bday|\bweek/i.test(text), 'the tab says nothing Gregorian', (/.{0,40}(Gregorian|UTC|\b(19|20)\d\d\b|\bmonth|\bday|\bweek).{0,40}/i.exec(text) ?? [''])[0]);
    ok(/diary-pdf\.mjs --path 6,4,9,3 --pure/.test(await page.textContent('.dy-how')), 'the command line for this Delta in pure mode');
    const leaks = (await scan(page, 'diary pure')).filter((l) => l.severity === 'hard');
    ok(!leaks.length, `0 hard pure-mode leaks (${leaks.length})`, leaks.slice(0, 6).map((l) => `${l.rule} "${l.text}" (${l.where})`).join(' | '));
    // what would be printed: the text of every page of the print document
    const printed = await page.evaluate(() => {
      const html = __fractonica.instances.diary.printDocument();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return [{ kind: 'title', text: doc.title, where: 'title' }, ...[...doc.querySelectorAll('svg text, svg title, svg desc')].map((e) => ({ kind: 'svg', text: e.textContent, where: 'print' }))];
    });
    const pl = judge(printed, 'diary print').filter((l) => l.severity === 'hard');
    ok(printed.length > 100 && !pl.length, `every printed page passes the leak rules (${printed.length} texts)`, pl.slice(0, 6).map((l) => `${l.rule} "${l.text}"`).join(' | '));
    await shot('diary-pure-1440.png');
    ok(!errors.length, 'no console errors (pure)', errors.slice(0, 4).join(' | '));
  },
  { viewport: { width: 1440, height: 900 } },
);

// phones
for (const [w, h, pure] of [
  [360, 780, false],
  [390, 844, true],
]) {
  await withApp(
    async ({ page, url, errors, shot }) => {
      console.log(`${w} px${pure ? ' (pure)' : ''}`);
      await page.goto(url(`?t=${T}&view=diary&zone=Europe/Berlin${pure ? '&pure=1' : ''}`));
      await page.waitForTimeout(1200);
      await page.evaluate(() => document.querySelectorAll('.dy-grp').forEach((d) => (d.open = true)));
      await page.waitForTimeout(300);
      const o = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const bad = [...document.querySelectorAll('.dy *')]
          .filter((e) => e.getClientRects().length && !e.closest('.dy-thumbs, .dy-stage'))
          .filter((e) => e.getBoundingClientRect().right > vw + 0.5 || e.getBoundingClientRect().left < -0.5)
          .slice(0, 5)
          .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} ${Math.round(e.getBoundingClientRect().right)}`);
        return { sw: document.documentElement.scrollWidth, vw, bad };
      });
      ok(o.sw <= o.vw && !o.bad.length, `no horizontal overflow at ${w} px`, JSON.stringify(o));
      const st = await page.evaluate(() => __fractonica.instances.diary.state);
      ok(st.planned && !st.spread, 'one page at a time on a phone', JSON.stringify(st));
      const sheet = await page.$eval('.dy-sheet', (e) => e.getBoundingClientRect().width);
      ok(sheet > 200, `the page is readable (${Math.round(sheet)} px wide)`);
      await page.evaluate(() => scrollTo(0, 0));
      await shot(`diary-${w}${pure ? '-pure' : ''}.png`, { fullPage: true });
      ok(!errors.length, 'no console errors', errors.slice(0, 4).join(' | '));
    },
    { viewport: { width: w, height: h } },
  );
}

console.log(failures ? `\n${failures} diary check(s) failed` : '\nall diary checks passed');
process.exitCode = failures ? 1 : 0;
