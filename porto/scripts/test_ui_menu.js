/* Browser checks for the map menu and the moved trail bar.
 *
 *     python3 -m http.server 8123          # from porto/
 *     node scripts/test_ui_menu.js
 *
 * Everything here is read back off the rendered page — bounding boxes and the
 * classes the app actually set — and every interaction goes through a real tap
 * on the real button.  Calling the handler behind it would prove the handler
 * works, which was never the thing in doubt.
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

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 412, height: 900 } });  // a phone, portrait
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.view, null, { timeout: 20000 });
  await page.waitForTimeout(1200);   // Leaflet settles

  const vw = page.viewportSize().width;

  /* 1. the trail sits below the map, not above it */
  const map = await box(page, '#paneMap');
  const top = await box(page, 'header.top');
  ok('trail is below the map', top.y >= map.bottom - 1, `map bottom ${map.bottom}, trail y ${top.y}`);
  ok('map reaches the top of the screen', map.y <= 1, `map y ${map.y}`);
  ok('trail is the last thing on screen', top.bottom >= 899 - 1, `trail bottom ${top.bottom}`);

  /* 2. a menu button in the map's top corner — right, in this RTL document */
  const menu = await box(page, '#menuBtn');
  ok('menu button exists and is visible', menu.w > 0 && menu.h > 0);
  ok('menu button is in the top corner', menu.y < map.y + 60, `menu y ${menu.y}`);
  ok('menu button is on the RIGHT half', menu.x > vw / 2, `menu x ${menu.x} of ${vw}`);

  /* 3. the tool column moved to the right, under the menu */
  const tools = await box(page, '#tools');
  ok('tool column is on the RIGHT half', tools.x > vw / 2, `tools x ${tools.x} of ${vw}`);
  ok('tool column sits below the menu button', tools.y >= menu.bottom - 1,
     `menu bottom ${menu.bottom}, tools y ${tools.y}`);
  ok('menu and column share the same edge', Math.abs(tools.right - menu.right) < 2,
     `tools right ${tools.right}, menu right ${menu.right}`);

  /* 4. one tap hides the column, another brings it back */
  const shown = () => page.$eval('#tools', el => getComputedStyle(el).display !== 'none');
  const expanded = () => page.$eval('#menuBtn', el => el.getAttribute('aria-expanded'));
  ok('column starts showing', await shown() === true);
  ok('aria-expanded starts true', await expanded() === 'true');

  await page.click('#menuBtn');
  await page.waitForTimeout(500);            // longer than DOUBLE_MS, so this is a single tap
  ok('one tap hides the column', await shown() === false);
  ok('aria-expanded follows', await expanded() === 'false');

  await page.click('#menuBtn');
  await page.waitForTimeout(500);
  ok('another tap brings it back', await shown() === true);

  /* 5. two quick taps cycle the layout and leave the column as it was */
  const view = () => page.$eval('body', el => el.dataset.view);
  const before = await view();
  const colBefore = await shown();
  await page.click('#menuBtn');
  await page.click('#menuBtn');              // no wait between: inside DOUBLE_MS
  await page.waitForTimeout(500);
  const after = await view();
  ok('double tap cycles the layout', after !== before, `${before} -> ${after}`);
  ok('double tap leaves the column as it was', await shown() === colBefore);
  ok('double tap follows the same order as the layout button',
     after === ({ split: 'map', map: 'text', text: 'split' })[before], `${before} -> ${after}`);

  /* 6. the column survives a reload — it is a preference, not a mode */
  await page.click('#menuBtn');
  await page.waitForTimeout(500);
  const wanted = await shown();
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.view, null, { timeout: 20000 });
  await page.waitForTimeout(900);
  ok('the column state is remembered', await shown() === wanted, `wanted ${wanted}`);

  /* 7. nothing overlaps: the menu must not sit under Leaflet's own controls */
  const z = await page.$eval('#menuBtn', el => Number(getComputedStyle(el).zIndex));
  ok('menu button is above the map panes', z >= 600, `z-index ${z}`);

  /* 8. landscape.  The map moves to the left half and the text beside it, so
     "the map's top corner" is no longer the screen's corner — the first cut of
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
  ok('landscape: column is over the MAP, not the text',
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
