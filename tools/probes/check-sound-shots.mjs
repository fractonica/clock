/**
 * Screenshots of the Sound panel at several instants and sizes (tools/out/sound-*.png).
 *   node tools/checks/check-sound-shots.mjs [name-filter]
 */
import { withApp, outDir } from '../browse.mjs';

const filter = process.argv[2] ?? '';
const ETA_END = 1791464172.428;
const shots = [
  { name: 'sound-desktop-off', q: '?t=1791460800&view=sound&zone=UTC', vp: [1440, 900] },
  { name: 'sound-desktop-on', q: '?t=1791460800&view=sound&zone=UTC', vp: [1440, 900], on: true },
  { name: 'sound-desktop-live', q: '?view=sound', vp: [1440, 900], on: true },
  { name: 'sound-desktop-2000', q: '?t=946684800&view=sound&zone=UTC&rate=3600', vp: [1440, 900], on: true },
  { name: 'sound-desktop-2061', q: '?t=2886085800&view=sound&zone=UTC', vp: [1440, 900], on: true },
  { name: 'sound-desktop-edge-min', q: '?t=-1&view=sound&zone=UTC', vp: [1440, 900], on: true },
  { name: 'sound-desktop-edge-max', q: '?t=99999999999&view=sound&zone=UTC', vp: [1440, 900], on: true },
  { name: 'sound-desktop-turnover', q: `?t=${ETA_END - 0.4}&rate=1&view=sound&zone=UTC`, vp: [1440, 900], on: true, wait: 1400 },
  { name: 'sound-desktop-hidpi', q: '?t=1791460800&view=sound&zone=UTC', vp: [1000, 800], on: true, dpr: 2, clip: '.snd-viz-card' },
  { name: 'sound-wide-1920', q: '?t=1791460800&view=sound&zone=UTC', vp: [1920, 1000], on: true },
  { name: 'sound-narrow-360', q: '?t=1791460800&view=sound&zone=UTC&rate=3600', vp: [360, 740], on: true },
  { name: 'sound-mobile-off', q: '?t=1791460800&view=sound&zone=UTC', vp: [390, 844] },
  { name: 'sound-mobile-on', q: '?t=1791460800&view=sound&zone=UTC&rate=3600', vp: [390, 844], on: true },
  { name: 'sound-desktop-locked', q: '?t=1791460800&view=sound&zone=UTC', vp: [1440, 900], on: true, lock: true },
  { name: 'sound-narrow-360-locked', q: '?t=1791460800&view=sound&zone=UTC', vp: [360, 740], on: true, lock: true },
  { name: 'sound-mobile-locked', q: '?t=1791460800&view=sound&zone=UTC', vp: [390, 844], on: true, lock: true },
  { name: 'sound-focus', q: '?t=1791460800&view=sound&zone=UTC', vp: [1000, 700], focus: true },
];
for (const s of shots) {
  if (!s.name.includes(filter)) continue;
  await withApp(
    async ({ page, url, errors }) => {
      await page.goto(url(s.q));
      await page.waitForTimeout(900);
      if (s.on) {
        await page.click('.snd-power');
        await page.waitForTimeout(s.wait ?? 1600);
      }
      if (s.lock) {
        await page.click('.snd-lock-btn'); // the tempo lock chip and the pressed button
        await page.waitForTimeout(500);
      }
      if (s.focus) {
        for (let i = 0; i < 22; i++) await page.keyboard.press('Tab');
        await page.waitForTimeout(200);
      }
      await page.mouse.move(5, 5);
      await page.waitForTimeout(150);
      const target = page.locator(s.clip ?? '#view-sound');
      const file = `${outDir}/${s.name}.png`;
      await target.screenshot({ path: file });
      console.log(file);
      const own = errors.filter((e) => /sound|audio/i.test(e));
      if (own.length) console.log('ERRORS', own);
    },
    { viewport: { width: s.vp[0], height: s.vp[1] }, deviceScaleFactor: s.dpr ?? 1 },
  );
}
