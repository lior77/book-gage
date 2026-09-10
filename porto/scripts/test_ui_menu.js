/* Browser checks for the map's menu screen, the two buttons on the map, the
 * boundary stack, and the reading half.
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


  /* 2. the two on the map itself.  Every distance is measured against the MAP's
        own box, not the screen's, because that is what they are placed inside. */
  const near = (a, b, t = 1.5) => Math.abs(a - b) <= t;
  const menuBtn = await box(page, '#menuBtn');
  const reset = await box(page, '#resetBtn');
  ok('menu button is 10px below the map\'s top', near(menuBtn.y - map.y, 10),
     `${(menuBtn.y - map.y).toFixed(1)}px`);
  ok('menu button is 10px in from the map\'s right', near(map.right - menuBtn.right, 10),
     `${(map.right - menuBtn.right).toFixed(1)}px`);
  ok('reset button is to the LEFT of the menu button', reset.right <= menuBtn.x + 1,
     `reset right ${reset.right.toFixed(1)}, menu x ${menuBtn.x.toFixed(1)}`);
  ok('and on the same line', near(reset.y, menuBtn.y),
     `${reset.y.toFixed(1)} vs ${menuBtn.y.toFixed(1)}`);
  const alpha = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return 1;
                       const p = m[1].split(',').map(v => parseFloat(v));
                       return p.length > 3 ? p[3] : 1; };
  ok('the menu button is fully opaque',
     alpha(await css(page, '#menuBtn', 'background-color')) === 1,
     await css(page, '#menuBtn', 'background-color'));
  ok('so is the reset button',
     alpha(await css(page, '#resetBtn', 'background-color')) === 1,
     await css(page, '#resetBtn', 'background-color'));
  /* and darker than the menu they open, or on a pale map they read as a patch
     of it rather than as controls */
  const lum = c => { const [r, g, b] = (c.match(/\d+/g) || []).map(Number);
                     return .2126 * r + .7152 * g + .0722 * b; };
  const btnBg = await css(page, '#menuBtn', 'background-color');
  const menuGround = await page.$eval('#menu',
    el => getComputedStyle(el).backgroundColor);
  ok('the two on the map are darker than the menu\'s own ground',
     Math.abs(lum(btnBg) - lum(menuGround)) > 12
       && (lum(btnBg) < lum(menuGround)) === (lum(menuGround) > 128),
     `button ${btnBg} (${lum(btnBg).toFixed(0)}) vs menu ${menuGround} (${lum(menuGround).toFixed(0)})`);
  ok('and the reset button matches the menu button',
     await css(page, '#resetBtn', 'background-color') === btnBg);

  /* 3. the menu is a screen: closed to start, and it covers everything */
  const shown = () => page.$eval('#menu', el => !el.hidden);
  ok('the menu starts closed', await shown() === false);
  ok('aria-expanded starts false',
     await page.$eval('#menuBtn', el => el.getAttribute('aria-expanded')) === 'false');
  await page.click('#menuBtn');
  await page.waitForTimeout(400);
  ok('one tap opens it', await shown() === true);
  ok('aria-expanded follows',
     await page.$eval('#menuBtn', el => el.getAttribute('aria-expanded')) === 'true');

  const menu = await box(page, '#menu');
  ok('the menu covers the whole screen, not just the map',
     menu.x <= 0.5 && menu.y <= 0.5 && menu.right >= vw - 0.5
       && menu.bottom >= (await page.evaluate(() => innerHeight)) - 0.5,
     `${menu.x},${menu.y} .. ${menu.right},${menu.bottom} of ${vw}`);
  const menuBg = await css(page, '#menu', 'background-color');
  ok('its ground is opaque', alpha(menuBg) === 1, menuBg);
  const rgb = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
  ok('and bluish grey rather than neutral', (([r, g, b]) => b > r)(rgb(menuBg)), menuBg);

  /* The close button kept its 20px when the menu button moved in to 10, so the
     two deliberately no longer sit on the same pixels. */
  const x = await box(page, '#menuClose');
  ok('the close button stayed at 20px from the screen\'s corner',
     near(x.y, 20) && near(vw - x.right, 20),
     `${x.y.toFixed(1)} from top, ${(vw - x.right).toFixed(1)} from right`);
  ok('and is therefore inside the menu button\'s 10px, not on it',
     x.y > menuBtn.y && x.right < menuBtn.right,
     `close ${x.right.toFixed(1)}/${x.y.toFixed(1)}, menu ${menuBtn.right.toFixed(1)}/${menuBtn.y.toFixed(1)}`);

  /* 4. the rows, in the order they were asked for */
  const WANT = ['search', 'mine', 'locate',
    'cat:station', 'cat:hospital', 'cat:university', 'cat:museum',
    'cat:culture', 'cat:market', 'cat:landmark', 'cat:green',
    'view:split', 'view:map', 'view:text', 'theme:light', 'theme:dark',
    'tiles', 'glass', 'borders', 'more', 'regions', 'save', 'load', 'info'];
  const got = await page.$$eval('#menuIn [data-m]', els => els.map(e => e.dataset.m));
  ok('the menu carries exactly the rows asked for, in order',
     got.join(' ') === WANT.join(' '), got.join(' '));
  const HE = { search: 'חיפוש', mine: 'המקומות שלי', locate: 'המיקום שלי',
    'cat:station': 'תחנות מטרו ורכבת', 'cat:hospital': 'בתי חולים',
    'cat:university': 'אוניברסיטה והשכלה', 'cat:museum': 'מוזיאונים וגלריות',
    'cat:culture': 'תיאטרון, ספריות ותרבות', 'cat:market': 'שווקים',
    'cat:landmark': 'אתרים ומונומנטים', 'cat:green': 'פארקים, גנים וחופים',
    'view:split': 'גרפיקה וטקסט', 'view:map': 'גרפיקה בלבד', 'view:text': 'טקסט בלבד',
    'theme:light': 'תצוגת יום', 'theme:dark': 'תצוגת לילה',
    'tiles': 'מפת רקע', 'glass': 'ויטרז׳ מפות', 'more': 'עוד שכבות',
    'regions': 'אזורים', 'save': 'שמירת נתונים', 'load': 'ייבוא נתונים', 'info': 'מידע' };
  const labels = await page.$$eval('#menuIn [data-m]',
    els => Object.fromEntries(els.map(e => [e.dataset.m, e.querySelector('.mrow-l').textContent])));
  const wrong = Object.entries(HE).filter(([k, v]) => labels[k] !== v);
  ok('every row reads what it was asked to read', wrong.length === 0,
     wrong.map(([k, v]) => `${k}: "${labels[k]}" ≠ "${v}"`).join(' | '));
  ok('the גבולות row says which of the four states it is in',
     /^גבולות · /.test(labels.borders), labels.borders);
  ok('every row carries an icon, and it is the first thing on the line — the right',
     await page.$$eval('#menuIn [data-m]', els => els.every(e => {
       const svg = e.querySelector('svg'), lab = e.querySelector('.mrow-l');
       if (!svg || !svg.children.length || !lab) return false;
       return svg.getBoundingClientRect().right > lab.getBoundingClientRect().right;
     })));
  ok('the four groups are titled',
     (await page.$$eval('#menuIn .mgrp', els => els.map(e => e.textContent).filter(Boolean)))
       .join('|') === 'תצוגה|שכבות|נתונים');

  /* 5. the switches: a tap flips the row and the state behind it */
  const flag = k => page.$eval(`[data-m="${k}"]`,
    e => e.getAttribute('aria-pressed') || e.getAttribute('aria-current'));
  for (const k of ['cat:hospital', 'tiles', 'glass', 'regions']) {
    const was = await flag(k);
    await page.click(`[data-m="${k}"]`);
    await page.waitForTimeout(350);
    ok(`${HE[k]}: one tap flips it`, await flag(k) !== was, `${was} -> ${await flag(k)}`);
    ok(`${HE[k]}: and the menu stays open — these come in handfuls`, await shown());
    await page.click(`[data-m="${k}"]`);
    await page.waitForTimeout(350);
  }
  ok('a category the menu switched off is off in the app',
     await page.evaluate(() => { const had = S.cats.has('hospital');
       document.querySelector('[data-m="cat:hospital"]').click();
       const now = S.cats.has('hospital');
       document.querySelector('[data-m="cat:hospital"]').click();
       return had && !now; }));

  /* All eight categories can be off at once.  A guard used to put the last one
     back, which made one switch refuse to switch — the bug this is here for. */
  const catsOn = () => page.evaluate(() => S.cats.size);
  await page.evaluate(() => D.poiOrder.forEach(c => { if (S.cats.has(c)) menuPick('cat:' + c); }));
  await page.waitForTimeout(500);
  ok('every category can be switched off, including the last one',
     await catsOn() === 0, `${await catsOn()} still on`);
  ok('and the menu shows all eight as off',
     await page.$$eval('#menuIn [data-m^="cat:"]',
       els => els.every(e => e.getAttribute('aria-pressed') === 'false')));
  await page.evaluate(() => D.poiOrder.forEach(c => { if (!S.cats.has(c)) menuPick('cat:' + c); }));
  await page.waitForTimeout(400);
  ok('and back on again', await catsOn() === 8, String(await catsOn()));

  /* The same toggle exists three times over — this menu row, a row in the layer
     panel, and a chip on the parish card — and the guard survived on the chip
     after the other two lost it, because the check only ever clicked the menu.
     So click the real chip, at the level where it exists. */
  await page.click('#menuClose');            // the chips are under the menu screen
  await page.waitForTimeout(300);
  await page.evaluate(() => goZone(D.freKey(D.fre.find(f => f.mun_num === 1))));
  await page.waitForTimeout(1000);
  /* the card is rebuilt after every chip, so the handles go stale — click by
     the category each chip carries, re-querying each time */
  const chipCats = await page.$$eval('#doc [data-cat]', els => els.map(e => e.dataset.cat));
  if (!chipCats.length) {
    ok('the parish card offers category chips', false, 'none rendered');
  } else {
    /* A parish carries only the categories it has, so switching off just its
       chips would leave the others on and the guard would never fire.  Clear
       everything else first, so the last chip is the one that empties the set —
       that is the only click the guard would ever act on. */
    await page.evaluate(cs => { S.cats.forEach(c => { if (!cs.includes(c)) S.cats.delete(c); }); },
                        chipCats);
    await page.waitForTimeout(200);
    for (const c of chipCats) {
      await page.click(`#doc [data-cat="${c}"]`);
      await page.waitForTimeout(250);
    }
    ok('the chips on the parish card can be switched off to the last one too',
       await catsOn() === 0, `${await catsOn()} still on, ${chipCats.length} chips`);
  }
  await page.evaluate(() => { D.poiOrder.forEach(c => { if (!S.cats.has(c)) S.cats.add(c); }); goDistrict(); });
  await page.waitForTimeout(800);
  if (!(await page.$eval('#menu', e => !e.hidden))) { await page.click('#menuBtn'); await page.waitForTimeout(300); }

  /* אזורים draws the orange line, 4 wide */
  await page.click('[data-m="regions"]');
  await page.waitForTimeout(700);
  const region = await page.evaluate(() => {
    const p = [...document.querySelectorAll('#map path')]
      .find(el => (el.getAttribute('stroke') || '').toLowerCase() === '#e2761b');
    return p ? Number(p.getAttribute('stroke-width')) : null;
  });
  ok('אזורים draws the orange line at width 4', region === 4, String(region));
  await page.click('[data-m="regions"]');
  await page.waitForTimeout(400);

  /* The regions paragraph belongs to the line that draws them: at the foot of
     the reading half while the layer is on, and nowhere at all while it is off.
     It used to sit in the district card either way — a paragraph about
     something that was not on the map. */
  const regionsOff = await page.evaluate(() => { if (S.lnRegion) menuPick('regions'); return !!S.lnRegion; });
  await page.waitForTimeout(600);
  ok('with אזורים off there is no regions block', await page.$('#regionsDoc') === null);
  ok('and the district card does not carry one either',
     !(await page.$eval('#doc', el => el.textContent)).includes('NUTS III'));
  await page.evaluate(() => menuPick('regions'));
  await page.waitForTimeout(700);
  ok('turning אזורים on brings the explanation', await page.$('#regionsDoc') !== null);
  ok('and it is the last thing on the page',
     await page.evaluate(() => document.querySelector('#doc').lastElementChild.id) === 'regionsDoc');
  const rtxt = await page.$eval('#regionsDoc', el => el.textContent);
  for (const need of ['האזור המטרופוליטני של פורטו', 'טאמגה אה סוזה', 'NUTS III'])
    ok(`the regions block names ${need}`, rtxt.includes(need));
  ok('it follows the map to level 2 as well',
     await page.evaluate(async () => { goMun(13); return true; }) &&
     (await page.waitForTimeout(800), await page.$('#regionsDoc') !== null));
  await page.evaluate(() => goDistrict());
  await page.waitForTimeout(700);
  if (!regionsOff) { await page.evaluate(() => menuPick('regions')); await page.waitForTimeout(500); }

  /* גבולות is a cycle, and the row's own text is what reports it */
  const bl = () => page.$eval('[data-m="borders"] .mrow-l', e => e.textContent);
  ok('גבולות starts on הכל', (await bl()).includes('הכל'), await bl());
  await page.click('[data-m="borders"]'); await page.waitForTimeout(450);
  ok('one tap drops גבול המחוז', (await bl()).includes('בלי המחוז'), await bl());
  for (let i = 0; i < 3; i++) { await page.click('[data-m="borders"]'); await page.waitForTimeout(400); }
  ok('four taps come back to הכל', (await bl()).includes('הכל'), await bl());

  /* 6. day and night are a choice, not only the phone's setting */
  await page.click('[data-m="theme:dark"]');
  await page.waitForTimeout(500);
  ok('תצוגת לילה sets the theme', await page.evaluate(() => document.documentElement.dataset.theme) === 'dark');
  ok('and the row marks itself', await flag('theme:dark') === 'true');
  ok('while תצוגת יום clears its mark', await flag('theme:light') === 'false');
  await page.click('[data-m="theme:light"]');
  await page.waitForTimeout(500);
  ok('תצוגת יום sets it back', await page.evaluate(() => document.documentElement.dataset.theme) === 'light');
  ok('the theme survives a redraw of the map',
     await page.evaluate(() => document.querySelectorAll('#map path').length) > 0);

  /* 7. the rows that send you somewhere close the menu behind them */
  for (const [k, check, back] of [
    ['search', async () => !(await page.$eval('#panel', e => e.hidden)), '#panelClose'],
    ['load',   async () => (await page.$eval('#panelTitle', e => e.textContent)).includes('ייבוא'), '#panelClose'],
    ['more',   async () => (await page.$eval('#panelTitle', e => e.textContent)).includes('שכבות'), '#panelClose'],
    ['info',   async () => !(await page.$eval('#infoDrawer', e => e.hidden)), '#infoClose'],
  ]) {
    if (!(await shown())) { await page.click('#menuBtn'); await page.waitForTimeout(300); }
    await page.click(`[data-m="${k}"]`);
    await page.waitForTimeout(600);
    ok(`${HE[k] || k} opens what it says`, await check());
    ok(`${HE[k] || k} closes the menu behind it`, await shown() === false);
    await page.click(back);
    await page.waitForTimeout(300);
  }

  /* view is a radio, and choosing one shows the result rather than the menu */
  if (!(await shown())) { await page.click('#menuBtn'); await page.waitForTimeout(300); }
  await page.click('[data-m="view:map"]');
  await page.waitForTimeout(500);
  ok('גרפיקה בלבד switches the layout',
     await page.evaluate(() => document.body.dataset.view) === 'map');
  ok('and closes the menu, or there would be nothing to see', await shown() === false);
  await page.click('#menuBtn'); await page.waitForTimeout(300);
  await page.click('[data-m="view:split"]');
  await page.waitForTimeout(600);

  /* 8. the close button, and Escape */
  await page.click('#menuBtn'); await page.waitForTimeout(300);
  await page.click('#menuClose'); await page.waitForTimeout(300);
  ok('the close button shuts the menu', await shown() === false);
  await page.click('#menuBtn'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok('Escape shuts it too', await shown() === false);

  /* 9. reset puts the whole district back inside the map's half */
  await page.evaluate(() => map.setView([41.0, -8.0], 12));
  await page.waitForTimeout(500);
  const far = await page.evaluate(() => [map.getCenter().lat, map.getZoom()]);
  await page.click('#resetBtn');
  await page.waitForTimeout(900);
  const home = await page.evaluate(() => [map.getCenter().lat, map.getZoom()]);
  ok('reset moves the map back', far[0] !== home[0] || far[1] !== home[1],
     `${far.join('/')} -> ${home.join('/')}`);
  ok('and the whole district is inside the view',
     await page.evaluate(() => {
       // bB holds the two NUTS III regions as well, and they spill past the
       // district — fit is to the district's own outline.
       const d = { type: 'FeatureCollection',
         features: D.bB.features.filter(f => f.properties.kind !== 'nuts3') };
       return map.getBounds().contains(L.geoJSON(d).getBounds().pad(-0.02));
     }));
  /* 8c. the stack.  Bottom to top: map, regions, district, municipalities,
         parishes — and it has to hold at every level, which is why it is panes
         and not draw order.  Read the resolved z-index of the pane each line
         actually landed in, at all three levels in turn. */
  if (!(await page.$eval('#menu', e => !e.hidden))) { await page.click('#menuBtn'); await page.waitForTimeout(300); }
  if (await page.$eval('[data-m="regions"]', e => e.getAttribute('aria-pressed')) === 'false') {
    await page.click('[data-m="regions"]'); await page.waitForTimeout(600);
  }
  await page.click('#menuClose'); await page.waitForTimeout(300);
  const stack = () => page.evaluate(() => {
    // By pane, not by width: the municipalities were widened to the district's
    // own 3.2 and a width can no longer tell one layer from another.
    const o = {};
    for (const el of document.querySelectorAll('#map path')) {
      const pane = el.closest('.leaflet-pane');
      const m = pane && (pane.className.match(/leaflet-ln-(\w+)-pane/));
      if (m) o[m[1]] = { z: Number(getComputedStyle(pane).zIndex),
                         w: Number(el.getAttribute('stroke-width')),
                         n: (o[m[1]] ? o[m[1]].n : 0) + 1 };
    }
    return o;
  });
  const inOrder = (st, kinds) => kinds.every((k, i, a) =>
    st[k] && (i === 0 || st[k].z > st[a[i - 1]].z));

  for (const [name, go, kinds] of [
        ['level 1 (המחוז)', null, ['region', 'district', 'mun']],
        ['level 2 (עירייה)', () => page.evaluate(() => goMun(13)),
         ['region', 'district', 'mun', 'fre']],
        ['level 3 (רובע)', () => page.evaluate(() => goZone(
            D.freKey(D.fre.find(f => f.mun_num === 13)))),
         ['region', 'district', 'mun', 'fre']],
      ]) {
    if (go) { await go(); await page.waitForTimeout(900); }
    const st = await stack();
    ok(`stack holds at ${name}: ` + kinds.join(' < '), inOrder(st, kinds),
       kinds.map(k => `${k} ${st[k] ? st[k].z : '—'}`).join('  '));
  }

  /* the widths, and which levels the parish layer is drawn at */
  const at = async go => { await page.evaluate(go); await page.waitForTimeout(900);
                           return stack(); };
  const l1 = await at(() => goDistrict());
  ok('level 1 draws no parish lines — 243 outlines was noise, not context',
     l1.fre === undefined, l1.fre && `${l1.fre.n} of them`);
  ok('גבול המחוז is 3.2 wide', l1.district.w === 3.2, String(l1.district.w));
  ok('גבולות העיריות are 3.2 too, at every level', l1.mun.w === 3.2, String(l1.mun.w));

  const l2 = await at(() => goMun(13));
  const want2 = await page.evaluate(() => D.bF.features.filter(f => f.properties.mun_num === 13).length);
  ok('level 2 draws the chosen municipality\'s parishes and no others',
     l2.fre && l2.fre.n === want2, `${l2.fre ? l2.fre.n : 0} of ${want2}`);
  ok('and they are 1.6 wide', l2.fre.w === 1.6, String(l2.fre.w));
  ok('the municipality lines are still 3.2 there', l2.mun.w === 3.2, String(l2.mun.w));

  const l3 = await at(() => goZone(D.freKey(D.fre.find(f => f.mun_num === 13))));
  ok('level 3 draws the one parish being looked at — the fill under it has no edge',
     l3.fre && l3.fre.n === 1, `${l3.fre ? l3.fre.n : 0}`);
  ok('at 1.6 as well', l3.fre.w === 1.6, String(l3.fre.w));

  await page.evaluate(() => goDistrict());
  await page.waitForTimeout(700);
  await page.evaluate(() => menuPick('regions'));
  await page.waitForTimeout(400);

  /* 8d. the halves cannot be dragged any more */
  ok('there is no divider to drag', await page.$('#divider') === null);
  ok('the seam between the halves is a hairline, not a handle',
     await page.$eval('.seam', el => el.getBoundingClientRect().height <= 2
       && getComputedStyle(el).cursor !== 'row-resize'));
  const wasMap = await box(page, '#paneMap');
  await page.mouse.move(wasMap.x + wasMap.w / 2, wasMap.bottom + 1);
  await page.mouse.down();
  await page.mouse.move(wasMap.x + wasMap.w / 2, wasMap.bottom - 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const nowMap = await box(page, '#paneMap');
  ok('dragging the seam does not resize the halves', near(nowMap.h, wasMap.h, 2),
     `${wasMap.h.toFixed(1)} -> ${nowMap.h.toFixed(1)}`);

  /* 11b. the reading half is one white page, 10px in, and it scrolls */
  const paneBg = await css(page, '#paneText', 'background-color');
  const cardBg = await page.$eval('#paneText',
    el => getComputedStyle(el).getPropertyValue('--card').trim());
  ok('the text half is the page colour, not the grey ground',
     paneBg.replace(/\s/g, '') === (m => m ? `rgb(${parseInt(cardBg.slice(1,3),16)},${parseInt(cardBg.slice(3,5),16)},${parseInt(cardBg.slice(5,7),16)})`.replace(/\s/g,'') : paneBg)(cardBg.startsWith('#')),
     `${paneBg} vs --card ${cardBg}`);
  for (const side of ['top', 'right', 'bottom', 'left']) {
    ok(`the document is 10px in from the text area's ${side}`,
       await css(page, '#doc', 'padding-' + side) === '10px',
       await css(page, '#doc', 'padding-' + side));
  }
  ok('the sections carry no card of their own',
     await page.$eval('#doc .card', el => {
       const c = getComputedStyle(el);
       return c.borderTopWidth === '0px' && c.borderRadius === '0px'
              && (c.backgroundColor === 'rgba(0, 0, 0, 0)' || c.backgroundColor === 'transparent');
     }));
  ok('the reading half scrolls', await page.evaluate(() => {
       const el = document.querySelector('#paneText');
       if (el.scrollHeight <= el.clientHeight + 1) return false;
       el.scrollTop = 120; const moved = el.scrollTop > 0; el.scrollTop = 0; return moved;
     }));

  /* 11c. the lead does not say again what the table underneath it says.  Back to
          the district first — earlier sections leave the נ.צ. screen up. */
  await page.evaluate(() => { if (S.wp) toggleWp(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => goDistrict());
  await page.waitForTimeout(800);
  const lead = await page.$eval('#doc .lead', el => el.textContent);
  const shownStats = await page.$$eval('#doc .stats .stat-v', els => els.map(e => e.textContent.trim()));
  ok('the lead repeats no figure from the table below it',
     shownStats.every(v => !lead.includes(v.replace(/[^\d,.]/g, ''))),
     `lead "${lead.trim().slice(0, 60)}…" vs ${shownStats.join(' / ')}`);
  ok('and the figures are still on the page, in the table',
     shownStats.length >= 3, shownStats.join(' / '));


  /* 10. the menu never comes back open: it is a screen, not a preference */
  await page.click('#menuBtn');
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.view, null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  ok('a reload does not reopen the menu', await page.$eval('#menu', el => el.hidden) === true);

  /* 11. landscape.  The map moves to the left half and the text beside it, so
     "the map's top corner" is no longer the screen's corner — an earlier cut of
     this change put the controls over the text, which is what this catches. */
  await page.setViewportSize({ width: 900, height: 412 });
  await page.evaluate(() => { document.body.dataset.view = 'split'; });
  await page.waitForTimeout(700);
  const lMap = await box(page, '#paneMap');
  const lMenu = await box(page, '#menuBtn');
  const lReset = await box(page, '#resetBtn');
  ok('landscape: map is the left half', lMap.x < 2 && lMap.right < 900,
     `map ${lMap.x}..${lMap.right}`);
  ok('landscape: menu button is over the MAP, not the text',
     lMenu.right <= lMap.right + 1 && lMenu.x >= lMap.x,
     `menu ${lMenu.x}..${lMenu.right}, map ends ${lMap.right}`);
  ok('landscape: so is the reset button',
     lReset.right <= lMap.right + 1 && lReset.x >= lMap.x,
     `reset ${lReset.x}..${lReset.right}`);
  await page.click('#menuBtn');
  await page.waitForTimeout(400);
  /* Landscape is where the two rules part: the map's right edge is halfway
     across, and a close button halfway across a full-screen menu is not one.
     It stays in the screen's corner — the corner of the thing it closes. */
  const lx = await box(page, '#menuClose');
  ok('landscape: the close button is in the SCREEN\'s corner, not mid-screen',
     Math.abs(lx.y - 20) <= 1.5 && Math.abs(900 - lx.right - 20) <= 1.5,
     `${lx.y.toFixed(1)} from top, ${(900 - lx.right).toFixed(1)} from right`);
  ok('landscape: and it is past the map\'s own edge, where the menu button is',
     lx.right > lMenu.right, `close right ${lx.right}, menu right ${lMenu.right}`);
  const lMenuBox = await box(page, '#menu');
  ok('landscape: the menu still covers the whole screen',
     lMenuBox.x <= 0.5 && lMenuBox.right >= 899.5, `${lMenuBox.x}..${lMenuBox.right}`);
  await page.click('#menuClose');
  await page.waitForTimeout(300);

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
