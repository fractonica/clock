/**
 * Interaction and runtime checks of the Sound module in headless Chromium (real AudioContext).
 *
 *   node tools/checks/check-sound.mjs        (exit code 1 when a check fails; screenshots in tools/out/)
 *
 * Covers: power button, header speaker + M key, layer toggles, sliders and persistence, mixer toggles and
 * presets, tempo lock, reverse, hear-this-moment, a real-time strum at a known cycle end, jumps and
 * rate changes while sound is on, the out-of-range state, render() cost and a clean console.
 */
import { withApp } from '../browse.mjs';

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const ETA_END = 1791464172.428;
const ownError = (e) => /sound|audio|engine\.js|schedule\.js|tuning\.js|settings\.js/i.test(e);

const hook = () => {
  window.__osc = [];
  const orig = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (t) {
    try {
      if (this.context.constructor.name !== 'OfflineAudioContext') window.__osc.push({ when: t ?? 0, now: this.context.currentTime, f: this.frequency.value, storeT: window.__fractonica?.store.t() });
    } catch {
      /* ignore */
    }
    return orig.call(this, t);
  };
};
const snd = (page, fn, arg) => page.evaluate(fn, arg);
const settings = (page) => snd(page, () => window.__fractonica.instances.sound.engine.settings);

for (const [label, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  console.log(`\n=== ${label} ${viewport.width}x${viewport.height} ===`);
  await withApp(
    async ({ page, url, errors, shot }) => {
      await page.addInitScript(hook);
      await page.addInitScript(() => {
        try {
          if (!sessionStorage.getItem('__snd_cleared')) {
            localStorage.removeItem('fractonica-clock/sound/v1');
            sessionStorage.setItem('__snd_cleared', '1');
          }
        } catch {
          /* ignore */
        }
      });

      // -----------------------------------------------------------------------------------------
      // power, header, keyboard
      // -----------------------------------------------------------------------------------------
      await page.goto(url('?t=1791460800&view=sound&zone=UTC'));
      await page.waitForSelector('.snd-power');
      await page.waitForTimeout(500);
      check(await snd(page, () => window.__fractonica.instances.sound.enabled === false), 'starts silent (autoplay policy: no sound before a gesture)');
      check((await page.textContent('.snd-status')).includes('Sound is off'), 'status explains how to start');
      await page.click('.snd-power');
      await page.waitForTimeout(700);
      check(await snd(page, () => window.__fractonica.instances.sound.enabled === true), 'power button starts the engine');
      check((await page.getAttribute('#btn-sound', 'aria-pressed')) === 'true', 'header speaker shows it is on');
      const st = await snd(page, () => window.__fractonica.instances.sound.engine.stats());
      check(st.state === 'running' && st.chordVoices === 12, 'context running with 12 voices', JSON.stringify({ state: st.state, sr: st.sampleRate, voices: st.voices }));
      check((await page.textContent('.snd-status')).startsWith('Audio on'), 'status reads Audio on', await page.textContent('.snd-status'));
      await shot(`sound-check-${label}-on.png`);
      await page.keyboard.press('m');
      await page.waitForTimeout(400);
      check(await snd(page, () => window.__fractonica.instances.sound.enabled === false), 'M key turns it off');
      await page.waitForTimeout(500);
      const st2 = await snd(page, () => window.__fractonica.instances.sound.engine.stats());
      check(st2.voices === 0, 'voices are released after the fade-out', `voices ${st2.voices}`);
      await page.click('#btn-sound');
      await page.waitForTimeout(500);
      check(await snd(page, () => window.__fractonica.instances.sound.enabled === true), 'header speaker button turns it on again');

      // -----------------------------------------------------------------------------------------
      // layers, sliders, mixer, presets
      // -----------------------------------------------------------------------------------------
      await page.click('.snd [data-layer="chord"]');
      await page.waitForTimeout(200);
      let s = await settings(page);
      check(s.chord === false && (await snd(page, () => window.__fractonica.instances.sound.engine.stats().chordVoices)) === 0, 'Chord layer off releases the drone voices');
      await page.click('.snd [data-layer="chord"]');
      await page.click('.snd [data-layer="physical"]');
      await page.waitForTimeout(300);
      check((await snd(page, () => window.__fractonica.instances.sound.engine.physicalVoices())).length === 3, 'Physical layer adds omicron, pi and rho', JSON.stringify(await snd(page, () => window.__fractonica.instances.sound.engine.physicalVoices())));
      await page.click('.snd-phys [data-step="1"]');
      s = await settings(page);
      check(s.physShift === 0, 'transposition stepper', `shift ${s.physShift}`);
      await page.click('.snd [data-layer="physical"]');

      await page.locator('.snd-vol').fill('-30');
      await page.locator('.snd-rev').fill('60');
      await page.locator('.snd-base').fill('-12');
      await page.selectOption('.snd-floor', '0.25');
      s = await settings(page);
      check(s.volumeDb === -30 && Math.abs(s.reverb - 0.6) < 1e-9 && Math.abs(s.baseHz - 55) < 1e-9 && s.floor === 0.25, 'sliders and chime floor change the settings', JSON.stringify({ v: s.volumeDb, r: s.reverb, b: s.baseHz, f: s.floor }));
      check(/55(\.0)? Hz/.test(await page.textContent('.snd-base ~ output')), 'base pitch readout', await page.textContent('.snd-base ~ output'));
      const f0 = await snd(page, () => window.__fractonica.instances.sound.engine.frequency(0));
      check(Math.abs(f0 - 55) < 1e-9, 'voice frequencies follow the base pitch', `${f0}`);
      await page.locator('.snd-base').fill('0');

      await page.click('.snd [data-preset="slow"]');
      await page.waitForTimeout(300);
      check(JSON.stringify((await snd(page, () => window.__fractonica.instances.sound.engine.voiceLevels()))) === '[0,1,2,3,4,5,6]', 'Slow preset: depths 1-7 only');
      await page.click('.snd [data-preset="all"]');
      await page.waitForTimeout(300);
      check((await snd(page, () => window.__fractonica.instances.sound.engine.voiceLevels())).length === 14, 'All preset: 14 voices');
      await page.click('.snd-strip[data-level="3"] .snd-strip-on');
      await page.waitForTimeout(200);
      s = await settings(page);
      check(s.levels[3] === false && (await snd(page, () => window.__fractonica.instances.sound.engine.voiceLevels())).length === 13, 'mixer toggle mutes depth 4');
      check((await page.getAttribute('.snd-strip[data-level="3"] .snd-strip-on', 'aria-pressed')) === 'false', 'strip reflects the mute');
      await page.click('.snd [data-preset="default"]');
      await page.click('.snd-strip[data-level="8"] .snd-strip-main');
      check((await snd(page, () => window.__fractonica.store.state.selectedLevel)) === 8, 'clicking a strip selects that level across the app');

      // persistence
      await page.reload();
      await page.waitForSelector('.snd-power');
      await page.waitForTimeout(400);
      s = await settings(page);
      check(s.volumeDb === -30 && s.floor === 0.25, 'settings survive a reload (localStorage)', JSON.stringify({ v: s.volumeDb, f: s.floor }));
      await page.evaluate(() => localStorage.removeItem('fractonica-clock/sound/v1'));

      // -----------------------------------------------------------------------------------------
      // tempo lock
      // -----------------------------------------------------------------------------------------
      await page.goto(url('?t=1791460800&view=sound&zone=UTC'));
      await page.waitForSelector('.snd-lock-btn');
      await page.selectOption('.snd-tdepth', '7');
      await page.locator('.snd-secs').fill('4');
      await page.locator('.snd-secs').press('Tab');
      await page.click('.snd-lock-btn');
      await page.waitForTimeout(300);
      const rate = await snd(page, () => window.__fractonica.store.rate);
      const want = await snd(page, () => window.__fractonica.model.levelInfo(6).meanSeconds / 4);
      check(Math.abs(rate - want) < 1e-6, 'tempo lock sets store.rate so one depth-7 cycle lasts 4 s', `${rate.toFixed(2)} vs ${want.toFixed(2)}`);
      const read = await page.textContent('.snd-read');
      check(/60(\.0)? BPM/.test(read) && read.includes('4.00 s'), 'readout shows the cycle time and BPM', read);
      check((await page.locator('.snd-rh').count()) >= 4, 'nested rhythm ladder is shown');
      await shot(`sound-check-${label}-tempo.png`);
      await page.click('.snd [data-rate="rev"]');
      check((await snd(page, () => window.__fractonica.store.rate)) < 0, 'Reverse flips the time-lapse direction');
      await page.click('.snd [data-rate="0"]');
      check((await snd(page, () => window.__fractonica.store.rate)) === 0, 'Pause');
      await page.click('.snd [data-rate="live"]');
      check(await snd(page, () => window.__fractonica.store.live), 'Real time returns to the device clock');

      // -----------------------------------------------------------------------------------------
      // tempo lock is a visible, persistent state with an unlock action
      // -----------------------------------------------------------------------------------------
      await page.goto(url('?t=1791460800&view=sound&zone=UTC'));
      await page.waitForSelector('.snd-lock-btn');
      const lockState = () =>
        page.evaluate(() => ({
          chip: !document.querySelector('.snd-chip-lock').hidden,
          text: document.querySelector('.snd-lock-txt').textContent,
          btn: document.querySelector('.snd-lock-label').textContent,
          rate: window.__fractonica.store.rate,
        }));
      check((await page.getAttribute('.snd-floor', 'aria-label')) === 'Chime floor' && (await page.inputValue('.snd-floor')) === '0.5', 'the chime floor starts at the calm 0.5 s default', await page.inputValue('.snd-floor'));
      check((await page.textContent('.snd-floor option:checked')).includes('default'), 'and the 0.5 s option is the one labelled default', await page.textContent('.snd-floor option:checked'));
      let ls = await lockState();
      check(!ls.chip && ls.btn === 'Lock tempo', 'no lock chip before locking');
      await page.selectOption('.snd-tdepth', '7');
      await page.locator('.snd-secs').fill('4');
      await page.locator('.snd-secs').press('Tab');
      await page.click('.snd-lock-btn');
      ls = await lockState();
      check(ls.chip && ls.text === 'Locked: one η = 4 s' && ls.btn === 'Unlock tempo', 'locking shows the chip "Locked: one η = 4 s" and turns the button into Unlock', JSON.stringify(ls));
      await page.waitForTimeout(200); // the readouts repaint on the next animation frame
      check(/×4,547/.test(await page.textContent('.snd-read')) && /×4,547/.test(await page.textContent('.snd-chips')), 'rate numbers are written like the header: comma grouping', (await page.textContent('.snd-read')).slice(0, 30));
      const presets = await page.$$eval('.snd-rate span:first-child', (n) => n.map((x) => x.textContent));
      check(presets.includes('×3,600') && presets.includes('×86,400') && !presets.some((t) => /\d[\s\u2009\u00a0]\d{3}/.test(t)), 'the speed presets use the same notation', presets.join(' '));
      await page.waitForTimeout(400);
      ls = await lockState();
      check(ls.chip, 'the lock persists while the clock runs (it is a state, not a toast)');
      // scrubbing time does not change the speed: still locked
      await page.evaluate(() => window.__fractonica.ctx.goto(946684800));
      await page.waitForTimeout(150);
      check((await lockState()).chip, 'jumping in time keeps the lock');
      // edits re-tune a locked tempo
      await page.selectOption('.snd-tdepth', '8');
      ls = await lockState();
      const want8 = await snd(page, () => window.__fractonica.model.levelInfo(7).meanSeconds / 4);
      check(ls.chip && ls.text === 'Locked: one θ = 4 s' && Math.abs(ls.rate - want8) < 1e-6, 'changing the depth while locked re-tunes the lock', JSON.stringify(ls));
      await page.locator('.snd-secs').fill('2.5');
      await page.locator('.snd-secs').press('Enter');
      ls = await lockState();
      check(ls.chip && ls.text === 'Locked: one θ = 2.5 s' && Math.abs(ls.rate - want8 * 4 / 2.5) < 1e-6 && ls.btn === 'Unlock tempo', 'Enter in the seconds field re-tunes and never unlocks', JSON.stringify(ls));
      // the unlock action: the speed stays, the lock goes
      const rateBefore = ls.rate;
      await page.click('.snd-unlock');
      ls = await lockState();
      check(!ls.chip && ls.btn === 'Lock tempo' && ls.rate === rateBefore, 'Unlock in the chip releases the lock and keeps the speed', JSON.stringify(ls));
      await page.selectOption('.snd-tdepth', '7');
      check((await lockState()).rate === rateBefore, 'once unlocked, editing the depth does not touch the speed');
      // every other way of changing the speed releases the lock by itself
      const relock = async () => {
        await page.locator('.snd-secs').fill('4');
        await page.locator('.snd-secs').press('Tab');
        await page.click('.snd-lock-btn');
        return lockState();
      };
      check((await relock()).chip, 'locked again');
      await page.selectOption('#tp-rate', '60');
      ls = await lockState();
      check(!ls.chip && ls.rate === 60, 'choosing a speed in the header releases the lock', JSON.stringify(ls));
      await relock();
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Space');
      ls = await lockState();
      check(!ls.chip && ls.rate === 0, 'Space (pause) releases the lock', JSON.stringify(ls));
      await page.keyboard.press('Space');
      check(!(await lockState()).chip, 'and resuming does not bring a stale lock back');
      await relock();
      await page.evaluate(() => window.__fractonica.store.setRate(86400));
      check(!(await lockState()).chip, 'a rate set from outside (link / script) releases it');
      await relock();
      await page.click('.snd [data-rate="3600"]');
      check(!(await lockState()).chip, 'so does a speed preset of this panel');
      await relock();
      await page.click('.snd [data-rate="live"]');
      check(!(await lockState()).chip, 'and going live');
      // the same rate set again from elsewhere keeps the lock (the rate still equals the locked one)
      await relock();
      const lockedRate = (await lockState()).rate;
      await page.evaluate((r) => window.__fractonica.store.setRate(r), lockedRate);
      check((await lockState()).chip, 'the lock is "while the rate equals the locked rate": setting the same rate keeps it');
      // the rate changed while another tab is showing is noticed too
      await page.evaluate(() => window.__fractonica.store.set({ view: 'rings' }));
      await page.waitForTimeout(150);
      await page.evaluate(() => window.__fractonica.store.setRate(7));
      await page.evaluate(() => window.__fractonica.store.set({ view: 'sound' }));
      await page.waitForTimeout(250);
      check(!(await lockState()).chip, 'a lock released while the tab was hidden is gone when it comes back');
      const described = (await snd(page, () => document.querySelector('.snd-lock-btn').getAttribute('aria-describedby'))) !== null;
      check(described, 'the lock button has its teaching tooltip (aria-describedby)');
      await shot(`sound-check-${label}-lock.png`);

      // -----------------------------------------------------------------------------------------
      // texts say what is true
      // -----------------------------------------------------------------------------------------
      const legend = await page.textContent('.snd-rh-legend');
      check(/30 Hz/.test(legend) && /mean loudness/.test(legend) && !/too fast to ring, heard as the drone/.test(legend), 'rhythm legend: modulation only up to ~30 Hz, faster cycles rest at their mean loudness', legend.slice(0, 120));
      const how = await page.textContent('.snd-how');
      check(/5 : 13 : 5 : 5 : 7 : 11 : 9 : 4/.test(how) && /repeats/.test(how), '"How to listen" lists the whole 8-term series and says it repeats');
      await page.hover('.snd-field:has(.snd-floor) .snd-lbl');
      await page.waitForTimeout(150);
      const floorTip = await page.locator('.snd-tip').innerText();
      check(/30 Hz/.test(floorTip) && /mean loudness/.test(floorTip), 'the chime-floor tooltip says the same', floorTip.replace(/\s+/g, ' ').slice(0, 140));
      await page.mouse.move(5, 5);
      // a locked tempo's rows say which are too fast to follow (hover title)
      await page.evaluate(() => window.__fractonica.store.setRate(1));
      await page.selectOption('.snd-tdepth', '8');
      await page.locator('.snd-secs').fill('2');
      await page.locator('.snd-secs').press('Enter');
      await page.waitForTimeout(250);
      const titles = await page.$$eval('.snd-rh', (n) => n.map((x) => x.getAttribute('title')));
      check(titles.length >= 4 && titles.some((t) => /rests at its mean loudness/.test(t)) && titles.some((t) => /heard as the drone/.test(t) || /fading out/.test(t)), 'row hints distinguish modulation from "rests at its mean loudness"', JSON.stringify(titles));

      // -----------------------------------------------------------------------------------------
      // hear this moment (engine off)
      // -----------------------------------------------------------------------------------------
      await page.goto(url('?t=1791460800&view=sound&zone=UTC'));
      await page.waitForSelector('.snd-moment');
      await page.evaluate(() => (window.__osc.length = 0));
      await page.click('.snd-moment');
      await page.waitForTimeout(900);
      const m = await snd(page, () => {
        const mm = window.__fractonica.instances.sound.engine.moment;
        return mm ? { n: mm.notes.length, enabled: window.__fractonica.instances.sound.enabled } : null;
      });
      check(m && m.n === 12 && m.enabled === false, 'moment plays 12 notes while the engine is off');
      check((await page.locator('.snd-strip.is-flash').count()) >= 1, 'the strips flash in turn as the arpeggio plays');
      await shot(`sound-check-${label}-moment.png`);
      check((await snd(page, async () => (await window.__fractonica.ctx.modules.sound.playMoment(1791460800 + 3600))?.notes.length)) === 12, 'ctx.modules.sound.playMoment(t) works for other modules');
      check((await snd(page, async () => await window.__fractonica.ctx.modules.sound.playMoment(window.__fractonica.model.tMax + 100))) === null, 'out-of-range moment is refused, not extrapolated');

      // -----------------------------------------------------------------------------------------
      // real-time strum at a known cycle end, then jumps while playing
      // -----------------------------------------------------------------------------------------
      await page.goto(url(`?t=${ETA_END - 3.2}&rate=1&view=sound&zone=UTC`));
      await page.waitForSelector('.snd-power');
      await page.waitForTimeout(300);
      await page.evaluate(() => (window.__osc.length = 0));
      await page.click('.snd-power');
      await page.waitForTimeout(4600);
      const osc = await snd(page, () => window.__osc);
      const first = osc[0]?.when ?? 0;
      const late = osc.filter((o) => o.when > first + 1.5);
      // bells are scheduled in clusters; find the largest cluster of starts within 0.12 s
      let best = { n: 0, at: 0 };
      for (const o of late) {
        const n = late.filter((p) => p.when >= o.when && p.when < o.when + 0.12).length;
        if (n > best.n) best = { n, at: o.when - first };
      }
      const expectAt = ETA_END - osc[0].storeT; // displayed seconds from the first voice to the turnover (rate 1)
      check(best.n >= 14 && Math.abs(best.at - expectAt) < 0.15, 'the depth-7 end sounds as one strummed chord exactly when the clock gets there', `${best.n} oscillators at +${best.at.toFixed(3)} s, expected +${expectAt.toFixed(3)} s`);
      const stats = await snd(page, () => window.__fractonica.instances.sound.engine.stats());
      check(stats.resyncs <= 1, 'steady playback does not keep re-anchoring', `resyncs ${stats.resyncs}`);

      const before = (await snd(page, () => window.__osc)).length;
      await page.evaluate(() => window.__fractonica.ctx.goto(946684800));
      await page.waitForTimeout(900);
      await page.evaluate(() => window.__fractonica.store.setRate(3600));
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.__fractonica.store.setRate(-3600));
      await page.waitForTimeout(1500);
      const stats2 = await snd(page, () => window.__fractonica.instances.sound.engine.stats());
      check(stats2.resyncs >= 3 && stats2.state === 'running', 'jump and rate changes re-anchor the engine', `resyncs ${stats2.resyncs}`);
      check((await snd(page, () => window.__osc)).length > before, 'bells keep coming in a time-lapse (also backwards)');
      check((await page.textContent('.snd-chips')).includes('Backwards'), 'reverse mode is labelled');
      await shot(`sound-check-${label}-lapse.png`);

      // -----------------------------------------------------------------------------------------
      // hidden tab: the schedule widens (timers are throttled in the background)
      // -----------------------------------------------------------------------------------------
      await page.goto(url(`?t=${ETA_END - 2.6}&rate=1&view=sound&zone=UTC`));
      await page.waitForSelector('.snd-power');
      await page.evaluate(() => (window.__osc.length = 0));
      await page.click('.snd-power');
      await page.waitForTimeout(450);
      const near0 = await snd(page, () => window.__osc.filter((o) => o.when - o.now > 1.2).length);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(150);
      const far = await snd(page, () => window.__osc.filter((o) => o.when - o.now > 1.2).length);
      check(near0 === 0 && far >= 14, 'a hidden tab schedules ~2.5 s ahead (the strum 2 s away is already queued)', `before ${near0}, after ${far}`);
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.click('.snd-power');

      // scrub storm: 200 jumps in a second must not pile up work or throw
      await page.click('.snd-power');
      await page.waitForTimeout(300);
      const storm = await snd(page, async () => {
        const t0 = performance.now();
        for (let i = 0; i < 200; i++) {
          window.__fractonica.ctx.goto(1791460800 + i * 1234.5);
          await new Promise((r) => setTimeout(r, 5));
        }
        const e = window.__fractonica.instances.sound.engine;
        return { ms: performance.now() - t0, resyncs: e.stats().resyncs, state: e.stats().state };
      });
      check(storm.state === 'running' && storm.resyncs < 120, 'a scrub storm is debounced', JSON.stringify(storm));
      await page.click('.snd-power');

      // no layout shift while numbers tick (bells ringing, loudness, readouts) or when sound is switched
      if (!(await snd(page, () => window.__fractonica.instances.sound.enabled))) await page.click('.snd-power');
      await page.waitForTimeout(400);
      const shifts = await snd(page, async () => {
        const sel = ['.snd-hero', '.snd-viz-card', '.snd-ctl-card', '.snd-mixer-card', '.snd-tempo-card', '.snd-how-card'];
        const heights = new Map(sel.map((q) => [q, new Set()]));
        for (let i = 0; i < 25; i++) {
          for (const q of sel) heights.get(q).add(Math.round(document.querySelector(q).getBoundingClientRect().height));
          await new Promise((r) => setTimeout(r, 90));
        }
        return Object.fromEntries([...heights].map(([q, v]) => [q, [...v]]));
      });
      check(Object.values(shifts).every((v) => v.length === 1), 'card heights stay constant while sound plays in a time-lapse', JSON.stringify(shifts));
      const heroOn = await page.locator('.snd-hero').evaluate((e) => Math.round(e.getBoundingClientRect().height));
      await page.click('.snd-power');
      await page.waitForTimeout(500);
      const heroOff = await page.locator('.snd-hero').evaluate((e) => Math.round(e.getBoundingClientRect().height));
      check(heroOn === heroOff, 'switching sound on/off does not move the page', `${heroOn} vs ${heroOff}`);
      await page.click('.snd-power');
      await page.waitForTimeout(300);

      // -----------------------------------------------------------------------------------------
      // render cost
      // -----------------------------------------------------------------------------------------
      const cost = await snd(page, async () => {
        const inst = window.__fractonica.instances.sound;
        const orig = inst.render;
        let n = 0;
        let sum = 0;
        let max = 0;
        inst.render = function (...a) {
          const t0 = performance.now();
          orig.apply(this, a);
          const d = performance.now() - t0;
          sum += d;
          max = Math.max(max, d);
          n++;
        };
        await new Promise((r) => setTimeout(r, 2200));
        inst.render = orig;
        const eng = inst.engine;
        const t0 = performance.now();
        for (let i = 0; i < 200; i++) eng.tick();
        return { frames: n, avg: sum / n, max, tick: (performance.now() - t0) / 200 };
      });
      check(cost.avg < 3, 'render() under 3 ms on average', `avg ${cost.avg.toFixed(2)} ms, max ${cost.max.toFixed(2)} ms over ${cost.frames} frames`);
      check(cost.tick < 3, 'scheduler tick is cheap', `${cost.tick.toFixed(2)} ms per tick`);

      // -----------------------------------------------------------------------------------------
      // out of range, hover tooltip, keyboard focus
      // -----------------------------------------------------------------------------------------
      const oor = await page.evaluate(() => {
        const inst = window.__fractonica.instances.sound;
        const f = window.__fractonica.model.frame(window.__fractonica.model.tMax + 10);
        inst.render(f, { view: 'sound', dirty: true });
        return document.querySelector('.snd-status').textContent; // read before the app's own frame repaints
      });
      check(/Outside the Saros 141 catalogue/.test(oor), 'out-of-range state is explicit', oor);
      await shot(`sound-check-${label}-range.png`);

      await page.click('.snd-power'); // off
      await page.waitForTimeout(300);
      await page.mouse.move(5, 5);
      await page.hover('.snd-strip[data-level="4"]');
      await page.waitForTimeout(150);
      const tip = await page.locator('.snd-tip').innerText();
      check(tip.includes('1625') && tip.includes('1024') && /Hz/.test(tip) && tip.includes('depth 5'), 'strip tooltip explains the ratio and pitch', tip.replace(/\n/g, ' | ').slice(0, 140));
      await shot(`sound-check-${label}-tip.png`);
      await page.mouse.move(5, 5);
      await page.focus('.snd-strip[data-level="2"] .snd-strip-on');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(120);
      check(await page.locator('.snd-tip:not([hidden])').count() >= 1, 'keyboard focus shows the tooltip too');
      await page.keyboard.press('Space');
      s = await settings(page);
      check(s.levels[2] === false, 'a strip toggles with the keyboard');

      const mine = errors.filter(ownError);
      check(mine.length === 0, 'no console errors from the sound module', mine.join(' | '));
      const others = errors.filter((e) => !ownError(e));
      if (others.length) console.log('(ignored errors from other modules:', others.length + ')');
    },
    { viewport, deviceScaleFactor: label === 'mobile' ? 2 : 1 },
  );
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall sound UI checks passed');
process.exit(failures ? 1 : 0);
