/**
 * Regression checks for the review findings of the Sound module (headless Chromium, real AudioContext).
 *
 *   node tools/checks/check-sound-regress.mjs        (exit code 1 when a check fails)
 *
 * Switching off must be silent (no rebound), a double toggle must not leak a scheduler, the panel must be
 * still while idle, keyboard focus must stay below the sticky header, touch screens must reach the
 * tooltips, the mixer must be readable by assistive technology, and the numbers must read right.
 */
import { withApp } from '../browse.mjs';

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const Q = '?t=1791460800&view=sound&zone=UTC';
const ownError = (e) => /sound|audio|engine\.js|schedule\.js|tuning\.js|settings\.js/i.test(e);
const fresh = () => {
  try {
    if (!sessionStorage.getItem('__snd_cleared')) {
      localStorage.removeItem('fractonica-clock/sound/v1');
      sessionStorage.setItem('__snd_cleared', '1');
    }
  } catch {
    /* ignore */
  }
};

for (const [label, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  console.log(`\n=== ${label} ${viewport.width}x${viewport.height} ===`);
  await withApp(
    async ({ page, browser, url, errors, shot }) => {
      await page.addInitScript(fresh);
      await page.addInitScript(() => {
        // what the spectrum canvas writes, to see which cycle letters it labels
        window.__scopeText = [];
        const ft = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (t, x, y) {
          if (this.canvas.classList.contains('snd-scope')) window.__scopeText.push(String(t));
          return ft.call(this, t, x, y);
        };
        window.__clears = 0;
        const cr = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (...a) {
          if (this.canvas.className.includes('snd-')) window.__clears++;
          return cr.apply(this, a);
        };
      });
      await page.goto(url(Q));
      await page.waitForSelector('.snd-power');
      await page.waitForTimeout(700);

      // ---------------------------------------------------------------------------------------
      // switching off is a fade to silence, not a fade followed by a rebound
      // ---------------------------------------------------------------------------------------
      await page.goto(url('?t=1791463900&view=sound&zone=UTC&rate=60'));
      await page.waitForSelector('.snd-power');
      await page.waitForTimeout(300);
      await page.click('.snd-power');
      await page.waitForTimeout(1500);
      const off = await page.evaluate(async () => {
        const an = window.__fractonica.instances.sound.engine.analyser;
        an.fftSize = 256;
        const buf = new Float32Array(256);
        const rec = [];
        const t0 = performance.now();
        const iv = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let m = 0;
          for (const x of buf) m = Math.max(m, Math.abs(x));
          rec.push([performance.now() - t0, m]);
        }, 15);
        await new Promise((r) => setTimeout(r, 200));
        const ts = performance.now() - t0;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
        await new Promise((r) => setTimeout(r, 900));
        clearInterval(iv);
        const before = Math.max(...rec.filter((r) => r[0] < ts).map((r) => r[1]));
        const after = rec.filter((r) => r[0] > ts + 160).map((r) => r[1]);
        return { before, afterMax: Math.max(...after), n: after.length };
      });
      check(off.before > 0.02 && off.afterMax < 5e-4, 'after the fade-out the output stays silent (no rebound of drone, bells or reverb)', `playing peak ${off.before.toFixed(4)}, peak from +160 ms ${off.afterMax.toFixed(5)} (${off.n} samples)`);

      // hear-this-moment right after switching off still sounds (the fader is brought back for it)
      await page.waitForTimeout(400);
      await page.click('.snd-moment');
      await page.waitForTimeout(500);
      const momentPeak = await page.evaluate(async () => {
        const an = window.__fractonica.instances.sound.engine.analyser;
        const buf = new Float32Array(256);
        let m = 0;
        for (let i = 0; i < 30; i++) {
          an.getFloatTimeDomainData(buf);
          for (const x of buf) m = Math.max(m, Math.abs(x));
          await new Promise((r) => setTimeout(r, 20));
        }
        return m;
      });
      check(momentPeak > 0.005, 'Hear this moment is audible after the sound was switched off', `peak ${momentPeak.toFixed(4)}`);
      check((await page.getAttribute('.snd-moment', 'aria-busy')) === 'true' && (await page.locator('.snd-moment.is-playing').count()) === 1, 'the button shows that the arpeggio is playing (is-playing, aria-busy)');
      await page.waitForTimeout(4200);
      check((await page.getAttribute('.snd-moment', 'aria-busy')) === 'false', 'and goes back to rest when it has played');

      // double toggle / held key while the context may still be resuming: one scheduler at most
      const ticks = await page.evaluate(async () => {
        const inst = window.__fractonica.instances.sound;
        let live = 0;
        const si = window.setInterval;
        const ci = window.clearInterval;
        const handles = new Set();
        window.setInterval = function (f, ms, ...a) {
          const h = si.call(window, f, ms, ...a);
          if (ms === 50) handles.add(h);
          return h;
        };
        window.clearInterval = function (h) {
          handles.delete(h);
          return ci.call(window, h);
        };
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        if (inst.enabled) await inst.toggle();
        await sleep(2300); // let the idle timer suspend the context
        const p1 = inst.toggle();
        const p2 = inst.toggle();
        await Promise.allSettled([p1, p2]);
        const afterPair = { enabled: inst.enabled, timers: handles.size };
        const p3 = inst.toggle();
        const p4 = inst.toggle();
        const p5 = inst.toggle();
        await Promise.allSettled([p3, p4, p5]);
        await sleep(300);
        const afterTriple = { enabled: inst.enabled, timers: handles.size };
        if (inst.enabled) await inst.toggle();
        await sleep(300);
        const end = { enabled: inst.enabled, timers: handles.size };
        window.setInterval = si;
        window.clearInterval = ci;
        return { afterPair, afterTriple, end, live };
      });
      check(ticks.afterPair.enabled === false && ticks.afterPair.timers === 0, 'on+off in the same instant leaves no scheduler running', JSON.stringify(ticks.afterPair));
      check(ticks.afterTriple.enabled === true && ticks.afterTriple.timers === 1, 'on+off+on leaves exactly one', JSON.stringify(ticks.afterTriple));
      check(ticks.end.enabled === false && ticks.end.timers === 0, 'and off leaves none', JSON.stringify(ticks.end));

      // ---------------------------------------------------------------------------------------
      // idle: nothing is rewritten while nothing changes
      // ---------------------------------------------------------------------------------------
      await page.goto(url(Q));
      await page.waitForSelector('.snd-power');
      await page.waitForTimeout(900);
      const idle = await page.evaluate(
        () =>
          new Promise((res) => {
            window.__clears = 0;
            let n = 0;
            const mo = new MutationObserver((r) => (n += r.length));
            mo.observe(document.getElementById('view-sound'), { attributes: true, childList: true, characterData: true, subtree: true });
            setTimeout(() => {
              mo.disconnect();
              res({ mutations: n, clears: window.__clears });
            }, 1500);
          }),
      );
      check(idle.mutations === 0, 'a paused, silent panel makes no DOM writes', `${idle.mutations} mutations in 1.5 s`);
      check(idle.clears === 0, 'and repaints no canvas', `${idle.clears} clearRect calls`);

      // the spectrum labels every tick that has room, not only those in frequency order after the previous one
      await page.evaluate(() => {
        window.__scopeText.length = 0;
        window.dispatchEvent(new Event('resize'));
      });
      await page.waitForTimeout(250);
      const letters = await page.evaluate(() => [...new Set(window.__scopeText)].filter((t) => /^[α-ω]$/.test(t)).join(''));
      check(letters.includes('θ') && letters.length >= (viewport.width > 600 ? 9 : 5), 'every tick with room carries its letter (θ was never labelled)', letters);

      // ---------------------------------------------------------------------------------------
      // hero: nothing moves when the sound starts, the rate changes sign, or a chip changes
      // ---------------------------------------------------------------------------------------
      const heroes = [];
      const hero = () => page.locator('.snd-hero').evaluate((e) => Math.round(e.getBoundingClientRect().height));
      heroes.push(await hero());
      await page.click('.snd-power');
      await page.waitForTimeout(500);
      heroes.push(await hero());
      await page.click('.snd [data-rate="3600"]');
      await page.waitForTimeout(300);
      heroes.push(await hero());
      await page.click('.snd [data-rate="rev"]');
      await page.waitForTimeout(300);
      heroes.push(await hero());
      await page.click('.snd [data-rate="0"]');
      await page.waitForTimeout(300);
      heroes.push(await hero());
      check(new Set(heroes).size === 1, 'the hero card keeps its height (sound on, time-lapse, backwards, paused)', heroes.join(' / '));
      check(!(await page.textContent('.snd-chips')).includes('drone holds'), 'the status chip does not claim a drone while the sound is off or paused');

      // chord layer off: no meter claims a drone is sounding
      await page.click('.snd [data-layer="chord"]');
      await page.waitForTimeout(300);
      const bars = await page.evaluate(() => [...document.querySelectorAll('.snd-meter i')].map((i) => i.style.transform));
      check(bars.every((b) => b === 'scaleX(0)'), 'with the chord layer off the meters rest', bars.slice(0, 4).join(' '));
      await page.click('.snd [data-layer="chord"]');
      await page.click('.snd-power');

      // ---------------------------------------------------------------------------------------
      // numbers
      // ---------------------------------------------------------------------------------------
      await page.selectOption('.snd-tdepth', '14');
      await page.locator('.snd-secs').fill('4');
      await page.locator('.snd-secs').press('Tab');
      await page.click('.snd-lock-btn');
      await page.waitForTimeout(300);
      const lapse = (await page.textContent('.snd-chips')) + ' | ' + (await page.textContent('.snd-read'));
      check(/×0\.011\b/.test(lapse) && !/×0\.0[^0-9]/.test(lapse), 'a slow tempo lock reads ×0.011, not ×0.0', lapse.replace(/\s+/g, ' ').slice(0, 130));
      check(/Slow motion/.test(lapse), 'and is called slow motion');
      check(/1\.68 min/.test(await page.textContent('.snd-strip[data-level="9"]')), 'depth 10 reads 1.68 min (one unit, rounded), not "1 min"');
      check(/\(1\.68 min\)/.test(await page.locator('.snd-tdepth option[value="10"]').textContent()), 'the depth selector agrees');
      await page.click('.snd [data-rate="1"]');
      check((await page.evaluate(() => ({ live: window.__fractonica.store.live, rate: window.__fractonica.store.rate }))).rate === 1 && !(await page.evaluate(() => window.__fractonica.store.live)), '×1 sets the speed without jumping to the device clock');

      // ---------------------------------------------------------------------------------------
      // tooltips and the base-pitch slider
      // ---------------------------------------------------------------------------------------
      await page.goto(url(Q));
      await page.waitForSelector('.snd-strip');
      await page.waitForTimeout(500);
      await page.evaluate(() => window.__fractonica.store.setRate(3600));
      await page.evaluate(() => document.querySelector('.snd-strip[data-level="4"]').scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      await page.hover('.snd-strip[data-level="4"] .snd-strip-main');
      await page.waitForTimeout(200);
      const tipNow = async () => (await page.locator('.snd-tip').innerText()).match(/Now:.*/)[0];
      const n1 = await tipNow();
      await page.evaluate(() => window.__fractonica.store.setRate(2629800));
      await page.waitForTimeout(1800);
      const n2 = await tipNow();
      check(n1 !== n2 && (await page.locator('.snd-tip:not([hidden])').count()) === 1, 'the "Now:" row of an open tooltip follows the clock', `${n1} → ${n2}`);
      const tipText = (await page.locator('.snd-tip').innerText()).replace(/\s+/g, ' ');
      check(/true rate is 1,625 : 1 to α/.test(tipText) && /sounding at 3\.17 : 1/.test(tipText), 'the tooltip separates the true rate from the sounding ratio', tipText.slice(0, 160));
      await page.mouse.move(5, 5);

      await page.evaluate(() => window.__fractonica.store.setRate(0));
      await page.locator('.snd-base').scrollIntoViewIfNeeded();
      const box = await page.evaluate(() => {
        const r = document.querySelector('.snd-base').getBoundingClientRect();
        return { x: r.left, y: r.top + r.height / 2, w: r.width };
      });
      await page.mouse.move(box.x + 8, box.y);
      await page.mouse.down();
      let prev = null;
      let backs = 0;
      for (let i = 0; i < Math.floor(box.w) - 20; i++) {
        await page.mouse.move(box.x + 8 + i, box.y);
        const v = Number(await page.$eval('.snd-base', (e) => e.value));
        if (prev !== null && v < prev) backs++;
        prev = v;
      }
      await page.mouse.up();
      check(backs === 0, 'dragging the base-pitch slider to the right never steps back (stable track)', `${backs} backward steps on a ${Math.round(box.w)} px track`);
      await page.locator('.snd-base').fill('0');

      // ---------------------------------------------------------------------------------------
      // keyboard focus is never hidden under the sticky header
      // ---------------------------------------------------------------------------------------
      await page.focus('.snd-rates button:last-child');
      let hidden = 0;
      let stops = 0;
      for (let i = 0; i < 70; i++) {
        await page.keyboard.press('Shift+Tab');
        await page.waitForTimeout(20);
        const r = await page.evaluate(() => {
          const a = document.activeElement;
          return { inSnd: !!a.closest('#view-sound'), top: a.getBoundingClientRect().top, hb: document.getElementById('topbar').getBoundingClientRect().bottom };
        });
        if (!r.inSnd) break;
        stops++;
        if (r.top < r.hb) hidden++;
      }
      check(stops > 40 && hidden === 0, 'Shift+Tab through the whole panel never leaves the focus behind the header', `${hidden} of ${stops} stops hidden`);

      // ---------------------------------------------------------------------------------------
      // assistive technology
      // ---------------------------------------------------------------------------------------
      await page.goto(url(Q));
      await page.waitForSelector('.snd-strip');
      await page.waitForTimeout(600);
      const aria = await page.evaluate(() => {
        const main = document.querySelector('.snd-strip[data-level="4"] .snd-strip-main');
        const on = document.querySelector('.snd-strip[data-level="4"] .snd-strip-on');
        const vis = main.innerText.replace(/\s+/g, ' ').trim();
        const name = (main.textContent || '').replace(/\s+/g, ' ').trim();
        const d = document.getElementById(main.getAttribute('aria-describedby') || 'x');
        return {
          label: main.getAttribute('aria-label'),
          vis,
          name,
          mute: on.getAttribute('aria-label'),
          current: document.querySelectorAll('.snd-strip-main[aria-current]').length,
          describedBy: !!d,
          describedLen: d ? d.textContent.length : 0,
          scope: document.querySelector('.snd-scope').getAttribute('aria-label'),
        };
      });
      check(aria.label === null && aria.name.includes('1625:1024') && aria.name.includes('Select depth 5'), 'the strip button is named by its visible text (plus "Select depth 5")', aria.name.slice(0, 90));
      check(/^Sound depth 5/.test(aria.mute), 'the mute toggle says what it does', aria.mute);
      check(aria.current === 1, 'the selected strip is marked aria-current');
      await page.focus('.snd-strip[data-level="4"] .snd-strip-main');
      const desc = await page.evaluate(() => {
        const main = document.querySelector('.snd-strip[data-level="4"] .snd-strip-main');
        const d = document.getElementById(main.getAttribute('aria-describedby'));
        return d ? d.textContent.replace(/\s+/g, ' ') : '';
      });
      check(/1625\/1024/.test(desc) && /Now:/.test(desc), 'the teaching text is the accessible description of the strip', desc.slice(0, 110));
      check(/Loudest cycles now:/.test(aria.scope) || /No cycle is sounding/.test(aria.scope), 'the spectrum canvas describes the state in words', aria.scope.slice(0, 100));

      // ---------------------------------------------------------------------------------------
      // touch: tooltips by tap, period on every width, touch-sized targets
      // ---------------------------------------------------------------------------------------
      const tctx = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const tp = await tctx.newPage();
      await tp.addInitScript(fresh);
      await tp.goto(url(Q));
      await tp.waitForSelector('.snd-strip');
      await tp.waitForTimeout(600);
      const visibleTip = () => tp.evaluate(() => { const t = document.querySelector('.snd-tip'); return t && !t.hidden ? t.innerText.replace(/\s+/g, ' ').slice(0, 60) : null; });
      await tp.locator('.snd-strip[data-level="4"]').scrollIntoViewIfNeeded();
      await tp.tap('.snd-strip[data-level="4"] .snd-strip-main');
      await tp.waitForTimeout(200);
      const t1 = await visibleTip();
      check(!!t1 && t1.includes('depth 5'), 'a tap on a strip opens its explanation', String(t1));
      await tp.tap('.snd-strip[data-level="4"] .snd-strip-main');
      check((await visibleTip()) === null, 'a second tap closes it');
      await tp.tap('.snd-strip[data-level="3"] .snd-strip-main');
      await tp.tap('.snd-strip[data-level="7"] .snd-strip-on');
      await tp.waitForTimeout(150);
      check((await visibleTip()) === null, 'tapping elsewhere (or a mute button) closes it and does not open another');
      await tp.locator('.snd-base').scrollIntoViewIfNeeded();
      await tp.tap('.snd-base ~ output', { force: true }).catch(() => {});
      await tp.tap('.snd-field:has(.snd-base) .snd-lbl');
      await tp.waitForTimeout(150);
      const t2 = await visibleTip();
      check(!!t2 && /Base pitch/.test(t2), 'the Base pitch caption explains itself on tap', String(t2));
      await tp.tap('.snd-field:has(.snd-floor) .snd-lbl');
      await tp.waitForTimeout(150);
      check(/Chime floor/.test((await visibleTip()) ?? ''), 'so does the Chime floor caption');
      const per = await tp.evaluate(() => {
        const vis = (s) => { const e = document.querySelector(s); return e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; };
        return { wide: vis('.snd-per'), narrow: vis('.snd-per-n') };
      });
      check(per.wide || per.narrow, 'each strip shows its cycle length on this width too', JSON.stringify(per));
      const small = await tp.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.snd button, .snd select, .snd input:not([type="range"])')) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.height < 40 || r.width < 40) && !el.closest('[hidden]')) out.push(`${el.className || el.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return out;
      });
      check(small.length === 0, 'touch targets are at least 40 px', small.slice(0, 4).join(' | '));
      await tctx.close();

      const mine = errors.filter(ownError);
      check(mine.length === 0, 'no console errors from the sound module', mine.join(' | '));
    },
    { viewport, deviceScaleFactor: label === 'mobile' ? 2 : 1 },
  );
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall sound regression checks passed');
process.exit(failures ? 1 : 0);
