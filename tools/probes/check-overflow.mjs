// Horizontal-overflow audit across widths and tabs. node tools/checks/check-overflow.mjs
import { withApp } from '../browse.mjs';
const widths = [320, 360, 390, 600, 768, 900, 1024, 1180, 1280, 1366, 1440, 1920];
const tabs = ['rings', 'timeline', 'wave', 'calendar', 'sound'];
await withApp(async ({ page, url, errors }) => {
  let bad = 0;
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const tab of tabs) {
      await page.goto(url(`?t=1791460800&view=${tab}&zone=UTC`));
      await page.waitForTimeout(350);
      const o = await page.evaluate(() => {
        const de = document.documentElement;
        const wide = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > de.clientWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.tabs,svg,canvas'); }).slice(0, 4).map((e) => (e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ')[0] + ' r=' + Math.round(e.getBoundingClientRect().right));
        return { sw: de.scrollWidth, cw: de.clientWidth, wide };
      });
      if (o.sw > o.cw) { bad++; console.log('OVERFLOW', w, tab, JSON.stringify(o)); }
    }
  }
  console.log(bad ? `${bad} overflowing combos` : 'no horizontal overflow at any width/tab', errors.length ? errors.slice(0, 5) : 'no errors');
});
