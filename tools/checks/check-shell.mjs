// Shell regression checks (header, rate/zone selects, deep links, link copy). node tools/checks/check-shell.mjs
import { withApp } from '../browse.mjs';
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + extra)); if (!cond) failed++; };
await withApp(async ({ page, url, errors, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const sel = (q) => page.evaluate((s) => document.querySelector(s)?.value, q);
  const st = () => page.evaluate(() => ({ rate: __fractonica.store.rate, mode: __fractonica.store.mode, playing: __fractonica.store.playing, view: __fractonica.store.state.view, zone: __fractonica.store.state.zone, sel: __fractonica.store.state.selectedLevel }));

  await page.goto(url('?t=1791460800&rate=60&view=sound'));
  await page.waitForTimeout(400);
  ok('?rate=60 is reflected in the speed select', (await sel('#tp-rate')) === '60', await sel('#tp-rate'));
  await page.click('#tp-play'); await page.click('#tp-play');
  ok('pause then play resumes at the linked rate', (await st()).rate === 60, JSON.stringify(await st()));

  await page.goto(url('?t=1'));
  await page.evaluate(() => localStorage.clear());
  await page.goto(url('?rate=1e308&t=abc&zone=Foo/Bar&view=__proto__&sel=-5&depth=NaN'));
  await page.waitForTimeout(400);
  const s1 = await st();
  ok('hostile deep link leaves a working app', (await page.textContent('#ro-time')).match(/\d\d:\d\d:\d\d/) && s1.view === 'rings' && s1.zone === null, JSON.stringify(s1));

  await page.goto(url('?t=1791460800'));
  await page.waitForTimeout(300);
  await page.evaluate(() => __fractonica.store.goLive());
  ok('live shows real-time speed', (await sel('#tp-rate')) === '1', await sel('#tp-rate'));
  await page.selectOption('#tp-rate', '3600');
  const s2 = await st();
  ok('choosing a speed starts the time-lapse', s2.playing && s2.rate === 3600, JSON.stringify(s2));
  await page.selectOption('#tp-rate', '-60');
  ok('backward speed applies', (await st()).rate === -60);
  await page.evaluate(() => __fractonica.store.setRate(4547.2218));
  await page.waitForTimeout(100);
  ok('custom rate (tempo lock) appears in the select', (await page.evaluate(() => document.querySelector('#tp-rate option[data-custom]')?.textContent)) ?? '', 'no custom option');

  await page.goto(url('?t=1791460800&zone=Pacific/Kiritimati'));
  await page.waitForTimeout(300);
  ok('zone select shows a deep-linked zone', (await sel('#zone')) === 'Pacific/Kiritimati', await sel('#zone'));
  await page.evaluate(() => __fractonica.store.set({ zone: 'Etc/GMT+5' }));
  ok('zone select follows store changes', (await sel('#zone')) === 'Etc/GMT+5', await sel('#zone'));

  await page.goto(url('?t=1791460800&view=timeline&sel=4&depth=5&zone=UTC'));
  await page.waitForTimeout(300);
  await page.click('#btn-link');
  await page.waitForTimeout(200);
  const link = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('copied link carries t, view, zone, sel, depth', /t=1791460800/.test(link) && /view=timeline/.test(link) && /zone=UTC/.test(link) && /sel=4/.test(link) && /depth=5/.test(link), link);

  await page.goto(url('?t=1'));
  await page.evaluate(() => localStorage.clear());
  await page.goto(url('?t=1791460800'));
  await page.waitForTimeout(300);
  const t1 = await page.evaluate(() => document.querySelector('#tp-prev').title);
  ok('prev/next titles name the selected depth', /η/.test(t1) && /depth 7/.test(t1), t1);
  await page.evaluate(() => __fractonica.store.set({ selectedLevel: 4 }));
  await page.waitForTimeout(100);
  ok('titles follow selection', /ε/.test(await page.evaluate(() => document.querySelector('#tp-next').title)));

  // edge: time-lapse to the end stops with a toast; Play there says why it does nothing
  await page.evaluate(() => { const s = __fractonica.store; s.setTime(__fractonica.model.tMax - 5); s.setRate(1000); });
  await page.waitForTimeout(400);
  ok('time-lapse stops at the catalogue edge with a toast', (await st()).rate === 0 && /end of the catalogue/i.test(await page.textContent('#toast')), await page.textContent('#toast'));
  await page.click('#tp-play');
  ok('Play at the edge explains itself', /end of the catalogue/i.test(await page.textContent('#toast')));

  // header height does not ratchet: wrap at 360, then widen again
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(250);
  const hSmall = await page.evaluate(() => document.querySelector('#topbar').getBoundingClientRect().height);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(250);
  const hBig = await page.evaluate(() => document.querySelector('#topbar').getBoundingClientRect().height);
  ok('header shrinks back after being tall', hBig < 90 && hSmall > hBig, `${hSmall} -> ${hBig}`);

  // active tab is scrolled into view on narrow screens
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => __fractonica.store.set({ view: 'sound' }));
  await page.waitForTimeout(250);
  const vis = await page.evaluate(() => { const t = document.querySelector('#tab-sound').getBoundingClientRect(), n = document.querySelector('#tabs').getBoundingClientRect(); return t.left >= n.left - 1 && t.right <= n.right + 1; });
  ok('Sound tab is visible in the tab strip on a phone', vis);

  // ---- pure mode shell behaviour ----
  await page.goto(url('?t=1'));
  await page.evaluate(() => localStorage.clear());
  await page.goto(url('?pure=1&t=1791460800&view=rings'));
  await page.waitForTimeout(500);
  const pureState = await page.evaluate(() => ({
    flag: __fractonica.store.state.pure,
    attr: document.body.dataset.pure,
    clock: document.querySelector('#ro-time').textContent,
    pairs: document.querySelectorAll('#ro-time .pure-clock .pure-pair').length,
    date: document.querySelector('#ro-date').textContent,
    zoneHidden: getComputedStyle(document.querySelector('#zone')).display === 'none',
    glossaryBtn: !document.querySelector('#btn-glossary').hidden,
    brand: document.querySelector('#brand-sub').textContent,
    rate: [...document.querySelectorAll('#tp-rate option')].map((o) => o.textContent),
  }));
  ok('?pure=1 switches the shell', pureState.flag && pureState.attr === '1' && pureState.zoneHidden && pureState.glossaryBtn, JSON.stringify(pureState));
  ok('pure header: Helion count, Helion phase pair, Preons and Flavons; the date is the Delta in words with its quarter and the Nuclide', /^\d+η\d+ι\d+λ$/.test(pureState.clock.replace(/\s/g, '')) && pureState.pairs === 1 && pureState.date === 'Delta Trifracton End ε#5', pureState.clock + ' | ' + pureState.date);
  ok('speed select is in units per Blink', pureState.rate.some((r) => r === 'η per Blink') && pureState.rate.some((r) => r === '4ι per Blink') && pureState.rate.some((r) => r === 'real time') && !pureState.rate.some((r) => /\b(s|min|h|d|beat)\b|\/s|×\d/.test(r)), pureState.rate.join(' | '));
  await page.keyboard.press('?');
  await page.waitForTimeout(150);
  ok('? opens the glossary and Esc closes it', (await page.evaluate(() => !document.querySelector('#glossary').hidden)) && (await page.keyboard.press('Escape'), await page.waitForTimeout(100), await page.evaluate(() => document.querySelector('#glossary').hidden)));
  await page.click('#btn-link');
  await page.waitForTimeout(200);
  const plink = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('pure link carries pos (12 decimals) and pure=1, not t', /[?&]pos=\d+\.\d{12}\b/.test(plink) && /pure=1/.test(plink) && !/[?&]t=/.test(plink) && !/zone=/.test(plink), plink);
  await page.goto(url('?pure=banana&solar=banana&pos=0x10&view=rings'));
  await page.waitForTimeout(300);
  ok('garbage pure/pos values are ignored', await page.evaluate(() => __fractonica.store.state.pure === true), 'stored flag must stay as it was');
  await page.goto(url('?pure=0&t=1791460800'));
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => ({ pure: __fractonica.store.state.pure, attr: document.body.dataset.pure ?? '', zone: getComputedStyle(document.querySelector('#zone')).display, clock: document.querySelector('#ro-time').textContent, sub: document.querySelector('#brand-sub').textContent, g: document.querySelector('#btn-glossary').hidden }));
  ok('?pure=0 restores the normal shell', !back.pure && back.attr === '' && back.zone !== 'none' && /\d\d:\d\d:\d\d/.test(back.clock) && /Saros 141/.test(back.sub) && back.g, JSON.stringify(back));

  ok('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
});
console.log(failed ? `${failed} FAILED` : 'all shell checks passed');
process.exit(failed ? 1 : 0);
