// Scene screenshots: node tools/checks/check-calendar-scenes.mjs [filter]
import { withApp } from '../browse.mjs';
const filter = process.argv[2] ?? '';
const mine = (e) => /calendar|jump|cal-/i.test(e);

const scenes = [
  { name: 'vecA', q: '?t=1791460800&view=calendar&zone=UTC', w: 1920, h: 1080, target: '#view-calendar' },
  { name: 'vecB-berlin-mar', q: '?t=1774778400&view=calendar&zone=Europe/Berlin', w: 1920, h: 1080, target: '.cal-month', pre: async (p) => {} },
  { name: 'y2000-eta', q: '?t=946684800&view=calendar&zone=UTC', w: 1920, h: 1080, target: '.cal-month', pre: async (p) => { await p.locator('.cal-ovseg button:text-is("η")').click(); } },
  { name: 'y2061-sync', q: '?t=2886085800&view=calendar&zone=UTC', w: 1920, h: 1080, target: '.cal-month', pre: async (p) => { await p.locator('.cal-ovseg button:text-is("Solar sync")').click(); } },
  { name: 'edge-min', q: '?t=-11253795481&view=calendar&zone=UTC', w: 1920, h: 1080, target: '#view-calendar' },
  { name: 'edge-max', q: '?t=28005212030&view=calendar&zone=UTC', w: 1920, h: 1080, target: '#view-calendar' },
  { name: 'out-of-range', q: '?t=28005212045&view=calendar&zone=UTC', w: 1920, h: 1080, target: '#view-calendar', pre: async (p) => { await p.locator('.cal-conv input[aria-label="Date"]').fill('3000-05-05'); } },
  { name: 'picker', q: '?t=1791460800&view=calendar&zone=UTC', w: 1920, h: 1080, target: '.cal-conv', pre: async (p) => { await p.locator('.cal-gcell').nth(6).click(); await p.locator('.cal-state').nth(4).click(); } },
  { name: 'jump-results', q: '?t=1791460800&view=calendar&zone=UTC', w: 1440, h: 900, clip: { x: 300, y: 0, width: 760, height: 520 }, pre: async (p) => { await p.keyboard.press('/'); await p.keyboard.type('next ε'); } },
  { name: 'jump-error', q: '?t=1791460800&view=calendar&zone=UTC', w: 1440, h: 900, clip: { x: 300, y: 0, width: 760, height: 300 }, pre: async (p) => { await p.keyboard.press('/'); await p.keyboard.type('α6 β6'); await p.keyboard.press('Enter'); } },
  { name: 'jump-multi', q: '?t=1791460800&view=calendar&zone=Europe/Kyiv', w: 1440, h: 900, clip: { x: 300, y: 0, width: 760, height: 460 }, pre: async (p) => { await p.keyboard.press('/'); await p.keyboard.type('03/04/2031'); } },
  { name: 'mobile-cal', q: '?t=1791460800&view=calendar&zone=UTC', w: 390, h: 844, target: '.cal-month', dsf: 2, pre: async (p) => { await p.locator('.cal-switch button:text-is("Calendar")').click(); } },
  { name: 'mobile-conv', q: '?t=1791460800&view=calendar&zone=UTC', w: 390, h: 844, target: '.cal-conv', dsf: 2 },
  { name: 'narrow360', q: '?t=1791460800&view=calendar&zone=UTC', w: 360, h: 740, target: '.cal-month', dsf: 2, pre: async (p) => { await p.locator('.cal-switch button:text-is("Calendar")').click(); await p.locator('.cal-ovseg button:text-is("η")').click(); } },
  { name: 'live', q: '?view=calendar', w: 1920, h: 1080, target: '#view-calendar' },
  { name: 'lapse', q: '?t=1791460800&view=calendar&rate=3600&zone=UTC', w: 1920, h: 1080, target: '#view-calendar' },
];

for (const sc of scenes) {
  if (filter && !sc.name.includes(filter)) continue;
  await withApp(
    async ({ page, url, errors, shot }) => {
      await page.goto(url(sc.q));
      await page.addStyleTag({ content: '.topbar{position:static!important}' });
      await page.waitForTimeout(700);
      if (sc.pre) await sc.pre(page);
      await page.waitForTimeout(500);
      const file = `scene-${sc.name}.png`;
      if (sc.clip) await shot(file, { clip: sc.clip });
      else {
        const loc = page.locator(sc.target).first();
        await loc.screenshot({ path: `tools/out/${file}` });
      }
      const e = errors.filter(mine);
      console.log(file, e.length ? e : 'clean');
    },
    { viewport: { width: sc.w, height: sc.h }, deviceScaleFactor: sc.dsf ?? 1 },
  );
}
