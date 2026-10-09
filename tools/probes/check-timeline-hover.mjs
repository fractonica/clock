// Hover states (tooltip, crosshair, chips) as full-viewport screenshots.
import { withApp } from '../browse.mjs';
const prefix = process.argv[2] ?? 'tl';
await withApp(
  async ({ page, url, errors, shot }) => {
    await page.goto(url('?t=1791460800&view=timeline&zone=Europe/Berlin'));
    await page.waitForTimeout(800);
    await page.addStyleTag({ content: '.topbar{position:static!important}' });
    await page.evaluate(() => document.querySelector('#view-timeline').scrollIntoView({ block: 'start' }));
    await page.click('[data-preset="week"]');
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const tl = window.__fractonica.instances.timeline.api;
      const r = document.querySelector('.tl-canvas').getBoundingClientRect();
      return { L: tl.layout, r: { x: r.x, y: r.y } };
    });
    const at = (x, y) => [info.r.x + x, info.r.y + y];
    // lane hover (ζ lane, a bit right of the cursor)
    await page.mouse.move(...at(info.L.px0 + 380, info.L.lanesY + info.L.laneH * 5.5));
    await page.waitForTimeout(250);
    await shot(`${prefix}-hover-lane.png`);
    // gutter hover
    await page.mouse.move(...at(30, info.L.lanesY + info.L.laneH * 4.5));
    await page.waitForTimeout(250);
    await shot(`${prefix}-hover-gutter.png`);
    // eclipse tooltip at century zoom
    await page.click('[data-preset="century"]');
    await page.waitForTimeout(500);
    const ex = await page.evaluate(() => {
      const st = window.__fractonica;
      const tl = st.instances.timeline.api;
      const w = tl.window;
      const L = tl.layout;
      const e = st.model.catalogue.find((t) => t > w.c - w.span / 2 + w.span * 0.2);
      return L.px0 + ((e - (w.c - w.span / 2)) / w.span) * (L.px1 - L.px0);
    });
    await page.mouse.move(...at(ex, info.L.eclipse.y + info.L.eclipse.h * 0.4));
    await page.waitForTimeout(250);
    await shot(`${prefix}-hover-eclipse.png`);
    // overview hover
    await page.mouse.move(...at(info.L.px0 + 200, info.L.overview.y + 14));
    await page.waitForTimeout(250);
    await shot(`${prefix}-hover-overview.png`);
    console.log(errors.filter((e) => /timeline|pageerror/i.test(e)));
  },
  { viewport: { width: 1440, height: 1000 } },
);
