/* Browser checks for the map menu, the strip it opens, and the trail bar.
 *
 *     python3 -m http.server 8123          # from porto/
 *     node scripts/test_ui_menu.js
 *
 * Everything here is read back off the rendered page — bounding boxes and the
 * computed styles the browser actually resolved — and every interaction goes
 * through a real tap on the real button.  Calling the handler behind it would
 * prove the handler works, which was never the thing in doubt.
 *
 * Order matters: the strip starts hidden now, and a hidden element has no box,
 * so the geometry checks come after it is opened.  The first cut of this file
 * measured it closed and compared zeroes.
 */
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://127.0.0.1:8123/index.html';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};

const box = (page, sel) => page.$eval(sel, el => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
});
const css = (page, sel, prop) =>
  page.$eval(sel, (el, p) => getComputedStyle(el).getPropertyValue(p), prop);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 412, height: 900 } });  // a phone, portrait
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.view, null, { timeout: 20000 });
  await page.waitForTimeout(1200);   // Leaflet settles

  const vw = page.viewportSize().width;
  const shown = () => page.$eval('#tools', el => getComputedStyle(el).display !== 'none');
  const expanded = () => page.$eval('#menuBtn', el => el.getAttribute('aria-expanded'));

  /* 1. the trail sits below the map, and is only as tall as its own line */
  const map = await box(page, '#paneMap');
  const top = await box(page, 'header.top');
  const crumb = await box(page, '#crumb');
  ok('trail is below the map', top.y >= map.bottom - 1, `map bottom ${map.bottom}, trail y ${top.y}`);
  ok('map reaches the top of the screen', map.y <= 1, `map y ${map.y}`);
  ok('trail is the last thing on screen', top.bottom >= 899 - 1, `trail bottom ${top.bottom}`);
  ok('trail is the text plus 4px above and below',
     Math.abs(top.h - (crumb.h + 8)) <= 1.5, `bar ${top.h.toFixed(1)}, text ${crumb.h.toFixed(1)}`);
  ok('trail padding is 4px top and bottom',
     (await css(page, 'header.top', 'padding-top')) === '4px' &&
     (await css(page, 'header.top', 'padding-bottom')) === '4px',
     `${await css(page, 'header.top', 'padding-top')} / ${await css(page, 'header.top', 'padding-bottom')}`);

  /* 2. the info button left the trail for the strip */
  ok('info button is no longer in the trail',
     await page.$('header.top #infoBtn') === null);
  ok('info button is inside the strip',
     await page.$('#tools #infoBtn') !== null);

  /* 3. the strip starts away — the map is the thing being looked at */
  ok('strip starts hidden', await shown() === false);
  ok('aria-expanded starts false', await expanded() === 'false');

  /* 4. one tap opens it, another puts it away */
  await page.click('#menuBtn');
  await page.waitForTimeout(400);
  ok('one tap shows the strip', await shown() === true);
  ok('aria-expanded follows', await expanded() === 'true');

  /* 5. geometry, now that there is something to measure */
  const menu = await box(page, '#menuBtn');
  const tools = await box(page, '#tools');
  ok('menu button is in the map\'s top corner', menu.y < map.y + 60, `menu y ${menu.y}`);
  ok('menu button is on the RIGHT half', menu.x > vw / 2, `menu x ${menu.x} of ${vw}`);
  ok('strip is on the RIGHT half', tools.x > vw / 2, `tools x ${tools.x} of ${vw}`);
  ok('strip sits below the menu button', tools.y >= menu.bottom - 1,
     `menu bottom ${menu.bottom}, tools y ${tools.y}`);
  ok('menu and strip share the same edge', Math.abs(tools.right - menu.right) < 2,
     `tools right ${tools.right}, menu right ${menu.right}`);

  /* 6. both sit on the tinted panel, and it is neither white nor transparent */
  const tint = await css(page, '#tools', 'background-color');
  const menuTint = await css(page, '#menuBtn', 'background-color');
  const rgb = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
  const bluish = s => { const [r, g, b] = rgb(s); return b > r && b > 200 - 1 ? true : b > r; };
  ok('strip has a tinted background', tint !== 'rgba(0, 0, 0, 0)' && tint !== 'rgb(255, 255, 255)', tint);
  ok('menu button has the same tint', menuTint === tint, `${menuTint} vs ${tint}`);
  ok('the tint is bluish rather than neutral grey', bluish(tint), tint);

  /* 7. the two נ.צ. buttons share a row, add to the LEFT of the list button */
  const wp = await box(page, '#wpBtn');
  const add = await box(page, '#addBtn');
  ok('add button is on the same row as the list button',
     Math.abs(wp.y - add.y) < 2, `wp y ${wp.y}, add y ${add.y}`);
  ok('add button is to the LEFT of the list button',
     add.right <= wp.x + 1, `add right ${add.right}, wp x ${wp.x}`);
  ok('add button carries a pin, not a bare plus',
     (await page.$eval('#addBtn svg', el => el.innerHTML)).includes('21.5s6.5-6'));
  ok('add button also carries the plus',
     (await page.$eval('#addBtn svg', el => el.innerHTML)).includes('M12 7.7v5.6'));

  /* 8. two quick taps no longer change the layout */
  const view = () => page.$eval('body', el => el.dataset.view);
  const before = await view();
  await page.click('#menuBtn');
  await page.click('#menuBtn');
  await page.waitForTimeout(400);
  ok('double tap does not cycle the layout', await view() === before,
     `view went ${before} -> ${await view()}`);
  ok('double tap lands where two single taps would', await shown() === true);

  /* 9. the strip's state survives a reload — it is a preference, not a mode */
  const wanted = await shown();
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.view, null, { timeout: 20000 });
  await page.waitForTimeout(900);
  ok('the strip state is remembered', await shown() === wanted, `wanted ${wanted}`);

  /* 10. nothing overlaps: the menu must not sit under Leaflet's own panes */
  const z = await page.$eval('#menuBtn', el => Number(getComputedStyle(el).zIndex));
  ok('menu button is above the map panes', z >= 600, `z-index ${z}`);

  /* 11. landscape.  The map moves to the left half and the text beside it, so
     "the map's top corner" is no longer the screen's corner — an earlier cut of
     this change put both controls over the text, which is what this catches. */
  await page.setViewportSize({ width: 900, height: 412 });
  await page.evaluate(() => { document.body.dataset.view = 'split'; });
  await page.waitForTimeout(700);
  const lMap = await box(page, '#paneMap');
  const lMenu = await box(page, '#menuBtn');
  const lTools = await box(page, '#tools');
  ok('landscape: map is the left half', lMap.x < 2 && lMap.right < 900,
     `map ${lMap.x}..${lMap.right}`);
  ok('landscape: menu is over the MAP, not the text',
     lMenu.right <= lMap.right + 1 && lMenu.x >= lMap.x,
     `menu ${lMenu.x}..${lMenu.right}, map ends ${lMap.right}`);
  ok('landscape: strip is over the MAP, not the text',
     lTools.right <= lMap.right + 1 && lTools.x >= lMap.x,
     `tools ${lTools.x}..${lTools.right}, map ends ${lMap.right}`);
  ok('landscape: menu is still in the map\'s top corner',
     lMenu.y < lMap.y + 60 && lMenu.right > lMap.x + lMap.w / 2,
     `menu y ${lMenu.y} x ${lMenu.x}`);

  /* map-only in landscape: the map is the whole width, so the edges coincide */
  await page.evaluate(() => { document.body.dataset.view = 'map'; });
  await page.waitForTimeout(500);
  const fMap = await box(page, '#paneMap');
  const fMenu = await box(page, '#menuBtn');
  ok('landscape, map only: menu is still over the map',
     fMenu.right <= fMap.right + 1 && fMenu.right > fMap.right - 60,
     `menu right ${fMenu.right}, map right ${fMap.right}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
