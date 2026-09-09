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
  /* Refuse the street background outright rather than letting the requests hang.
     Left to time out on their own they did not fail inside the run, and the
     check below then passed on a page where the background had never failed —
     a check that cannot fail is not a check. */
  await page.route('**://tile.openstreetmap.org/**', r => r.abort());
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

  /* Offline the street background cannot load, and the switch has to say so on
     its own — nothing else has touched it yet at this point in the run, which
     is the whole point: it used to stay lit until the next redraw. */
  await page.waitForFunction(
    () => /רקע המפה לא נטען/.test(document.querySelector('#msgs').textContent),
    null, { timeout: 8000 }).catch(() => {});
  ok('a background that failed to load turns its own switch off',
     await page.evaluate(() => {
       const on = document.querySelector('#layersBtn').getAttribute('aria-pressed');
       const failed = /רקע המפה לא נטען/.test(document.querySelector('#msgs').textContent);
       return !failed || on === 'false';
     }), 'the note is up but the switch still reads pressed');

  /* 5. geometry, now that there is something to measure */
  const menu = await box(page, '#menuBtn');
  const tools = await box(page, '#tools');
  ok('menu button is in the map\'s top corner', menu.y < map.y + 60, `menu y ${menu.y}`);
  ok('menu button is on the RIGHT half', menu.x > vw / 2, `menu x ${menu.x} of ${vw}`);
  /* The strip is a wide row now, so its LEFT edge is well past the middle; what
     has to hold is that it hangs off the right edge and still fits on screen. */
  ok('strip hangs off the RIGHT edge', tools.right > vw / 2, `tools right ${tools.right} of ${vw}`);
  ok('strip fits on screen', tools.x > 0, `tools x ${tools.x} of ${vw}`);
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

  /* 7. add sits on the switch row, at its far (left) end — past every switch,
        so it is still to the LEFT of the list button it was paired with. */
  const wp = await box(page, '#wpBtn');
  const add = await box(page, '#addBtn');
  ok('add button is on the switch row',
     Math.abs(wp.y - add.y) < 2, `wp y ${wp.y}, add y ${add.y}`);
  ok('add button is at the far end of the row',
     add.x < (await box(page, '#regionsBtn')).x, 'add is not past אזורים');
  ok('add button is to the LEFT of the list button',
     add.right <= wp.x + 1, `add right ${add.right}, wp x ${wp.x}`);
  ok('add button carries a pin, not a bare plus',
     (await page.$eval('#addBtn svg', el => el.innerHTML)).includes('21.5s6.5-6'));
  ok('add button also carries the plus',
     (await page.$eval('#addBtn svg', el => el.innerHTML)).includes('M12 7.7v5.6'));

  /* 8. the five map switches, in the order they were asked for */
  const order = ['#layersBtn', '#wpBtn', '#fillsBtn', '#bordersBtn', '#regionsBtn'];
  const xs = [];
  for (const id of order) xs.push((await box(page, id)).x);
  ok('the row reads שכבות · נ.צ. · צבעים · גבולות · אזורים, right to left',
     xs.every((x, i) => i === 0 || x < xs[i - 1]), xs.map(Math.round).join(' > '));
  ok('all five are on one row',
     (await Promise.all(order.map(id => box(page, id).then(b => b.y))))
       .every((y, _, a) => Math.abs(y - a[0]) < 2));

  /* each is a switch: pressed flips, and the map answers */
  for (const [id, name] of [['#layersBtn', 'רקע המפה'], ['#fillsBtn', 'צבע השטח'],
                            ['#bordersBtn', 'גבולות'], ['#regionsBtn', 'אזורים']]) {
    const was = await page.$eval(id, e => e.getAttribute('aria-pressed'));
    await page.click(id);
    await page.waitForTimeout(350);
    const now = await page.$eval(id, e => e.getAttribute('aria-pressed'));
    ok(`${name}: one tap flips it`, now !== was, `${was} -> ${now}`);
    await page.click(id);                       // put it back
    await page.waitForTimeout(350);
  }

  /* the regions line is orange and 4 wide when it is on */
  const regionsOn = await page.$eval('#regionsBtn', e => e.getAttribute('aria-pressed'));
  if (regionsOn === 'false') { await page.click('#regionsBtn'); await page.waitForTimeout(600); }
  const region = await page.evaluate(() => {
    const p = [...document.querySelectorAll('#map path')]
      .find(el => (el.getAttribute('stroke') || '').toLowerCase() === '#e2761b');
    return p ? { stroke: p.getAttribute('stroke'), w: p.getAttribute('stroke-width') } : null;
  });
  ok('the regions line is drawn in orange', region !== null, 'no #e2761b path on the map');
  ok('the regions line is 4 wide', region && Number(region.w) === 4, region && region.w);

  /* the layers button no longer opens a panel — the sliders button does, and it
     still carries everything the switch row leaves out */
  ok('the layers button switches instead of opening a panel',
     await page.$eval('#panel', el => el.hidden) === true);
  await page.click('#layerListBtn');
  await page.waitForTimeout(300);
  const panelHtml = await page.$eval('#panelBody', el => el.innerHTML);
  ok('the full layer list is still reachable',
     await page.$eval('#panel', el => el.hidden) === false);
  ok('it still carries נהרות ומים', panelHtml.includes('data-lay="water"'));
  ok('it still carries the four border kinds',
     ['region', 'district', 'mun', 'fre'].every(k => panelHtml.includes(`data-lay="ln:${k}"`)));
  /* the panel and the switch row are one state, so a change on one shows on the
     other — this went wrong the other way round when a failed background left
     the switch lit. */
  const fillsBefore = await page.$eval('#fillsBtn', e => e.getAttribute('aria-pressed'));
  await page.click('#panelBody [data-lay="muncol"]');
  await page.waitForTimeout(400);
  ok('the panel and the switch row agree about the fill',
     await page.$eval('#fillsBtn', e => e.getAttribute('aria-pressed')) !== fillsBefore);
  await page.click('#panelBody [data-lay="muncol"]');
  await page.waitForTimeout(400);
  await page.click('#panelClose');
  await page.waitForTimeout(200);

  /* 9. the photo picker takes more than one */
  ok('the photo input accepts multiple files',
     await page.evaluate(() => {
       const b = document.querySelector('#addBtn'); if (b) b.click();
       return new Promise(r => setTimeout(() => {
         const i = document.querySelector('#minePhotoIn');
         r(i ? i.multiple : null);
       }, 400));
     }) === true);

  /* 10. add opens a card in the text half straight away */
  ok('the add button opens a card to fill in',
     await page.$('#mineName') !== null);
  ok('the card starts with a position of its own',
     await page.evaluate(() => !!(window.__wpLL || document.querySelector('#mineWhere'))));

  /* 11. the explanations are gone from the screen */
  const docText = await page.$eval('#doc', el => el.textContent);
  ok('the storage explanation is no longer on the נ.צ. card',
     !docText.includes('נשמרות במכשיר הזה בלבד'), 'still there');
  ok('the export note is no longer on the נ.צ. card',
     !docText.includes('ההעתקה מוציאה את הנקודות כטקסט'), 'still there');

  /* and are in the info drawer instead */
  await page.click('#infoBtn');
  await page.waitForTimeout(700);
  const infoText = await page.$eval('#infoBody', el => el.textContent);
  ok('the storage explanation moved into the info drawer',
     infoText.includes('במכשיר הזה בלבד'));
  ok('the multiple-photo behaviour is explained there too',
     infoText.includes('כמה תמונות בבת אחת'));
  await page.click('#infoClose');
  await page.waitForTimeout(400);

  /* 12. the float: the strip and its buttons both cast a shadow */
  const shStrip = await css(page, '#tools', 'box-shadow');
  const shBtn = await css(page, '#layersBtn', 'box-shadow');
  ok('the strip floats over the map', shStrip !== 'none' && shStrip.length > 0, shStrip);
  ok('each button floats over the strip', shBtn !== 'none' && shBtn.length > 0, shBtn);

  /* 13. two quick taps no longer change the layout */
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
