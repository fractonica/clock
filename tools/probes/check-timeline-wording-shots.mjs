/**
 * Fresh desktop + mobile screenshots of the face (with a row tooltip) and the timeline after the wording round.
 *   node tools/checks/check-timeline-wording-shots.mjs   ->  tools/out/wording-{desktop,mobile}-{face,timeline}.png
 */
import { withApp } from '../browse.mjs';

for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  await withApp(
    async ({ page, url, errors, shot }) => {
      await page.goto(url('?t=1791460800&view=timeline&zone=UTC&sel=7'));
      await page.addStyleTag({ content: '.toast{display:none}' });
      await page.waitForSelector('.face-svg .face-glyph path');
      await page.waitForTimeout(900);
      // face: hover (desktop) or press and hold (mobile) the top row, then crop the card
      const row = await page.locator('.face-row--top').boundingBox();
      const cx = row.x + row.width / 2;
      const cy = row.y + row.height / 2;
      await page.locator('#slot-face').scrollIntoViewIfNeeded();
      const r2 = await page.locator('.face-row--top').boundingBox();
      await page.mouse.move(r2.x + r2.width / 2, r2.y + r2.height / 2);
      await page.waitForTimeout(700);
      await shot(`wording-${name}-face.png`, { fullPage: false });
      await page.mouse.move(2, 2);
      await page.locator('#view-timeline').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.locator('#view-timeline').screenshot({ path: `tools/out/wording-${name}-timeline.png` });
      const mine = errors.filter((e) => /face|timeline|pageerror/i.test(e));
      console.log(name, mine.length ? mine : 'clean');
    },
    { viewport },
  );
}
