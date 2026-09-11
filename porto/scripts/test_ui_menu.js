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
  const reset = await box(page, '#homeBtn');
  ok('menu button is 10px below the map\'s top', near(menuBtn.y - map.y, 10),
     `${(menuBtn.y - map.y).toFixed(1)}px`);
  ok('menu button is 10px in from the map\'s right', near(map.right - menuBtn.right, 10),
     `${(map.right - menuBtn.right).toFixed(1)}px`);
  ok('home button is to the LEFT of the menu button', reset.right <= menuBtn.x + 1,
     `reset right ${reset.right.toFixed(1)}, menu x ${menuBtn.x.toFixed(1)}`);
  ok('and on the same line', near(reset.y, menuBtn.y),
     `${reset.y.toFixed(1)} vs ${menuBtn.y.toFixed(1)}`);
  const alpha = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return 1;
                       const p = m[1].split(',').map(v => parseFloat(v));
                       return p.length > 3 ? p[3] : 1; };
  ok('the menu button is fully opaque',
     alpha(await css(page, '#menuBtn', 'background-color')) === 1,
     await css(page, '#menuBtn', 'background-color'));
  ok('so is the home button',
     alpha(await css(page, '#homeBtn', 'background-color')) === 1,
     await css(page, '#homeBtn', 'background-color'));
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
  ok('and the home button matches the menu button',
     await css(page, '#homeBtn', 'background-color') === btnBg);

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

  /* 4. the rows, in the order they were asked for.  The eight point categories
        are folded under one heading now — the heading switches all eight, and
        the chevron beside it opens the list. */
  const rowsNow = () => page.$$eval('#menuIn [data-m]', els => els.map(e => e.dataset.m));
  const CATS = ['cat:station', 'cat:hospital', 'cat:university', 'cat:museum',
                'cat:culture', 'cat:market', 'cat:landmark', 'cat:green'];
  const WANT = ['search', 'mine', 'locate', 'cats', 'cats-open',
    'view:split', 'view:map', 'view:text', 'theme:light', 'theme:dark',
    'tiles', 'glass', 'borders', 'more', 'regions', 'save', 'load', 'info'];
  ok('the menu carries exactly the rows asked for, in order',
     (await rowsNow()).join(' ') === WANT.join(' '), (await rowsNow()).join(' '));
  const folded = await rowsNow();
  ok('the eight categories are folded away, not listed',
     CATS.every(c => !folded.includes(c)));

  await page.click('[data-m="cats-open"]');
  await page.waitForTimeout(400);
  const opened = await rowsNow();
  ok('the chevron opens the eight, under their heading',
     CATS.every(c => opened.includes(c))
       && opened.indexOf('cat:station') === opened.indexOf('cats-open') + 1,
     opened.join(' '));
  ok('and they are marked as belonging to it',
     await page.$$eval('#menuIn [data-m^="cat:"]',
       els => els.every(e => e.classList.contains('mrow-sub'))));
  ok('the chevron says it is open',
     await page.$eval('[data-m="cats-open"]', e => e.getAttribute('aria-expanded')) === 'true');
  await page.click('[data-m="cats-open"]');
  await page.waitForTimeout(400);
  ok('and shuts them again', (await rowsNow()).join(' ') === WANT.join(' '));

  /* the heading is one switch over all eight */
  const catsOn = () => page.evaluate(() => S.cats.size);
  ok('all eight start on', await catsOn() === 8, String(await catsOn()));
  await page.click('[data-m="cats"]');
  await page.waitForTimeout(400);
  ok('one tap on the heading switches all eight off', await catsOn() === 0, String(await catsOn()));
  ok('and the heading reads off',
     await page.$eval('[data-m="cats"]', e => e.getAttribute('aria-pressed')) === 'false');
  await page.click('[data-m="cats"]');
  await page.waitForTimeout(400);
  ok('another tap brings them all back', await catsOn() === 8, String(await catsOn()));

  const HE = { search: 'חיפוש', mine: 'המקומות שלי', locate: 'המיקום שלי',
    cats: 'נקודות ציון',
    'view:split': 'גרפיקה וטקסט', 'view:map': 'גרפיקה בלבד', 'view:text': 'טקסט בלבד',
    'theme:light': 'תצוגת יום', 'theme:dark': 'תצוגת לילה',
    'tiles': 'מפת רקע', 'glass': 'ויטרז׳ מפות', 'more': 'עוד שכבות',
    'regions': 'אזורים', 'save': 'שמירת נתונים', 'load': 'ייבוא נתונים', 'info': 'מידע' };
  const labels = await page.$$eval('#menuIn [data-m]',
    els => Object.fromEntries(els.filter(e => e.querySelector('.mrow-l'))
      .map(e => [e.dataset.m, e.querySelector('.mrow-l').textContent])));
  const wrong = Object.entries(HE).filter(([k, v]) => labels[k] !== v);
  ok('every row reads what it was asked to read', wrong.length === 0,
     wrong.map(([k, v]) => `${k}: "${labels[k]}" ≠ "${v}"`).join(' | '));
  ok('the גבולות row says which of the four states it is in',
     /^גבולות · /.test(labels.borders), labels.borders);
  ok('every row carries an icon, and it is the first thing on the line — the right',
     await page.$$eval('#menuIn [data-m] .mrow-l', els => els.every(lab => {
       const e = lab.closest('[data-m]');
       const svg = e.querySelector('svg');
       if (!svg || !svg.children.length) return false;
       return svg.getBoundingClientRect().right > lab.getBoundingClientRect().right;
     })));
  ok('the three groups are titled',
     (await page.$$eval('#menuIn .mgrp', els => els.map(e => e.textContent).filter(Boolean)))
       .join('|') === 'תצוגה|שכבות|נתונים');

  /* 5. the switches: a tap flips the row and the state behind it */
  const flag = k => page.$eval(`[data-m="${k}"]`,
    e => e.getAttribute('aria-pressed') || e.getAttribute('aria-current'));
  for (const k of ['cats', 'tiles', 'glass', 'regions']) {
    const was = await flag(k);
    await page.click(`[data-m="${k}"]`);
    await page.waitForTimeout(350);
    ok(`${HE[k]}: one tap flips it`, await flag(k) !== was, `${was} -> ${await flag(k)}`);
    ok(`${HE[k]}: and the menu stays open — these come in handfuls`, await shown());
    await page.click(`[data-m="${k}"]`);
    await page.waitForTimeout(350);
  }
  ok('a category switched off from the opened list is off in the app',
     await page.evaluate(() => { menuPick('cats-open');
       const had = S.cats.has('hospital');
       document.querySelector('[data-m="cat:hospital"]').click();
       const now = S.cats.has('hospital');
       document.querySelector('[data-m="cat:hospital"]').click();
       menuPick('cats-open');
       return had && !now; }));

  /* All eight categories can be off at once.  A guard used to put the last one
     back, which made one switch refuse to switch — the bug this is here for. */
  await page.evaluate(() => D.poiOrder.forEach(c => { if (S.cats.has(c)) menuPick('cat:' + c); }));
  await page.waitForTimeout(500);
  ok('every category can be switched off, including the last one',
     await catsOn() === 0, `${await catsOn()} still on`);
  ok('and the menu heading shows them off',
     await page.$eval('[data-m="cats"]', e => e.getAttribute('aria-pressed')) === 'false');
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

  /* 7b. המקומות שלי: two buttons on a line, the heading under them. */
  if (!(await page.$eval('#menu', e => !e.hidden))) { await page.click('#menuBtn'); await page.waitForTimeout(300); }
  await page.click('[data-m="mine"]');
  await page.waitForTimeout(800);
  ok('the screen is headed המקומות שלי',
     (await page.$eval('#doc h1', e => e.textContent)).trim() === 'המקומות שלי',
     await page.$eval('#doc h1', e => e.textContent));
  ok('and carries no count beside it',
     !/\d/.test(await page.$eval('#doc h1', e => e.textContent)));
  ok('saving and importing are not on this screen — they are in the menu',
     await page.$('#doc [data-mine-act]') === null);

  const newBtn = await box(page, '[data-wpact="new"]');
  const modeBtn = await box(page, '[data-wpact="mode"]');
  const h1 = await box(page, '#doc h1');
  const pane = await box(page, '#paneText');
  ok('the button reads חדש',
     (await page.$eval('[data-wpact="new"]', e => e.textContent)).trim() === 'חדש');
  ok('and sits at the start edge — the right — 10px in',
     near(pane.right - newBtn.right, 10, 2), `${(pane.right - newBtn.right).toFixed(1)}px`);
  ok('רשימה is to its left, on the same line',
     modeBtn.right <= newBtn.x + 1 && near(modeBtn.y, newBtn.y),
     `mode right ${modeBtn.right.toFixed(1)}, new x ${newBtn.x.toFixed(1)}`);
  ok('the heading is under the buttons, not beside them', h1.y > newBtn.bottom - 1,
     `buttons end ${newBtn.bottom.toFixed(1)}, heading ${h1.y.toFixed(1)}`);

  /* a place to look at, and the two card shapes */
  await page.evaluate(() => {
    D.mine = [{ id: 'tst1', name: 'בדיקה', desc: 'תיאור', ll: [41.2, -8.5], at: '2026-09-10',
                photo: { w: 4, h: 4, bytes: 1, taken: '', from: 'pin', alt: null } }];
    saveMine(); renderWaypoints();
  });
  await page.waitForTimeout(500);
  ok('the mode button reads רשימה while the cards are expanded',
     (await page.$eval('[data-wpact="mode"]', e => e.textContent)).trim() === 'רשימה');
  ok('expanded: the photo is under the text, not beside it',
     await page.$('.wp .wp-line') === null && await page.$('.wp .ph-fig') !== null);
  await page.click('[data-wpact="mode"]');
  await page.waitForTimeout(500);
  ok('one tap turns the label to מורחב',
     (await page.$eval('[data-wpact="mode"]', e => e.textContent)).trim() === 'מורחב');
  ok('and the card becomes a line with a thumbnail beside the text',
     await page.$('.wp .wp-line') !== null && await page.$('.wp .ph-thumb') !== null);
  const txt = await box(page, '.wp .wp-txt');
  const thumb = await box(page, '.wp .ph-thumb');
  ok('the thumbnail is on the left of the text', thumb.right <= txt.x + 1,
     `thumb right ${thumb.right.toFixed(1)}, text x ${txt.x.toFixed(1)}`);
  await page.click('[data-wpact="mode"]');
  await page.waitForTimeout(500);
  ok('and back to expanded', await page.$('.wp .wp-line') === null);

  /* עריכה and מחיקה belong to the chosen card only */
  await page.evaluate(() => { S.wpSel = null; renderWaypoints(); });
  await page.waitForTimeout(400);
  const editShown = () => page.$eval('.wp [data-wpact="edit"]',
    e => getComputedStyle(e.closest('.wp-acts')).display !== 'none');
  ok('an unchosen card does not show עריכה or מחיקה', await editShown() === false);
  await page.click('.wp');
  await page.waitForTimeout(500);
  ok('choosing one brings them out', await editShown() === true);
  const acts = await box(page, '.wp .wp-acts');
  const cardBox = await box(page, '.wp');
  const editBtn = await box(page, '.wp [data-wpact="edit"]');
  const nameH = await box(page, '.wp h2');
  ok('above the name of the place', acts.bottom <= nameH.y + 1,
     `acts ${acts.bottom.toFixed(1)}, name ${nameH.y.toFixed(1)}`);
  ok('and aligned to the right', near(editBtn.right, cardBox.right, 14),
     `edit right ${editBtn.right.toFixed(1)}, card right ${cardBox.right.toFixed(1)}`);
  await page.evaluate(() => { D.mine = []; saveMine(); S.wpSel = null; renderWaypoints(); });
  await page.waitForTimeout(400);

  /* 7c. חדש opens a screen: three ways at its head, one line each on what they
         do, and the home and menu buttons still above it. */
  await page.click('[data-wpact="new"]');
  await page.waitForTimeout(600);
  ok('חדש opens the new-place screen', await page.$eval('#wpSheet', e => e.hidden) === false);
  ok('with the three ways at its head',
     (await page.$$eval('[data-wpway]', els => els.map(e => e.textContent.trim()))).join('|')
       === 'מקום ממפה|מקום מתמונה|מקום מכתובת');
  ok('and a line on each of them', (await page.$$('.way-why li')).length === 3);
  const ways = await box(page, '.way-row');
  const home = await box(page, '#homeBtn');
  const menuB = await box(page, '#menuBtn');
  ok('the ways sit below the home and menu buttons', ways.y >= home.bottom - 1,
     `home ends ${home.bottom.toFixed(1)}, ways ${ways.y.toFixed(1)}`);
  ok('and those two are still on top of the screen',
     Number(await css(page, '#homeBtn', 'z-index')) > Number(await css(page, '#wpSheet', 'z-index')),
     `${await css(page, '#homeBtn', 'z-index')} vs ${await css(page, '#wpSheet', 'z-index')}`);
  ok('nothing is asked for until a way is chosen', await page.$('#mineName') === null);

  /* the map way shows the map before anything else */
  await page.click('[data-wpway="map"]');
  await page.waitForTimeout(800);
  ok('מקום ממפה shows the map first',
     await page.evaluate(() => document.body.dataset.view) === 'map'
       && await page.$eval('#wpSheet', e => e.hidden) === true
       && await page.$eval('#pickBar', e => e.hidden) === false);
  await page.click('#pickBar [data-wpact="fix"]');
  await page.waitForTimeout(900);
  ok('and choosing on it brings the fields', await page.$('#mineName') !== null);

  /* 7: the description starts at two lines and grows with what is typed */
  const one = await page.evaluate(() => {
    const t = document.querySelector('#mineDesc');
    return parseFloat(getComputedStyle(t).lineHeight);
  });
  const twoLines = await box(page, '#mineDesc');
  ok('the description box starts about two lines tall',
     twoLines.h > one * 1.6 && twoLines.h < one * 3.4,
     `${twoLines.h.toFixed(1)}px, one line ${one.toFixed(1)}px`);
  await page.fill('#mineDesc', Array(12).fill('שורה של טקסט ארוך למדי').join('\n'));
  await page.waitForTimeout(400);
  const grown = await box(page, '#mineDesc');
  ok('and grows with the text rather than scrolling inside itself',
     grown.h > twoLines.h * 2, `${twoLines.h.toFixed(1)} -> ${grown.h.toFixed(1)}`);

  /* 4: saving puts the screen back as it was — no crosshair, no two buttons */
  await page.fill('#mineName', '');
  await page.click('#wpSheet [data-wpact="save"]');
  await page.waitForTimeout(900);
  ok('saving names an unnamed place',
     await page.evaluate(() => D.mine.length === 1 && /^נקודת ציון \d+$/.test(D.mine[0].name)),
     await page.evaluate(() => JSON.stringify(D.mine.map(p => p.name))));
  ok('and closes the form', await page.$eval('#wpSheet', e => e.hidden));
  ok('and leaves no way chosen', await page.evaluate(() => wpWay === null && wpNew === false));

  /* Saving while the map is still in placing mode is the case that left the
     crosshair and its two buttons behind.  Reaching it through the buttons is
     not possible — the form is down while placing — so it is set up directly:
     a record being edited, placing started from inside the form, then a save.
     Without the cleanup in commitMine() the ghost and the bar survive. */
  await page.evaluate(() => { startWpEdit(D.mine[0].id); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { harvestWp(); toggleAdd(); });
  await page.waitForTimeout(700);
  ok('placing is on and the bar is up', await page.evaluate(() => S.adding && !!ghost)
     && await page.$eval('#pickBar', e => e.hidden) === false);
  await page.evaluate(() => commitMine());
  await page.waitForTimeout(800);
  ok('saving takes the crosshair off the map', await page.evaluate(() => !ghost));
  ok('and the בחירה/ביטול buttons with it', await page.$eval('#pickBar', e => e.hidden));
  ok('and the map is not left on placing', await page.evaluate(() => !S.adding));

  /* 3 + 4: one kind of point, and its pin is a red push pin */
  await page.evaluate(() => { if (S.wp) toggleWp(); });
  await page.waitForTimeout(800);
  const pin = await page.evaluate(() => {
    const el = document.querySelector('#map .me-pin svg path');
    if (!el) return null;
    const box = el.getBBox();
    return { fill: el.getAttribute('fill'), tall: box.height > box.width };
  });
  ok('a place is drawn as a pin, not a square', pin && pin.tall, JSON.stringify(pin));
  ok('and it is red', pin && pin.fill.toLowerCase() === '#d32f2f', pin && pin.fill);
  ok('there is one points layer, not one for photos and one without',
     await page.evaluate(() => typeof S.photos === 'undefined' && typeof S.mine === 'boolean'));
  ok('the layer panel offers one row for them',
     await page.evaluate(() => (renderLayers().match(/data-lay="(mine|photos)"/g) || []).join() === 'data-lay="mine"'));

  /* 8. the close button, and Escape */
  await page.click('#menuBtn'); await page.waitForTimeout(300);
  await page.click('#menuClose'); await page.waitForTimeout(300);
  ok('the close button shuts the menu', await shown() === false);
  await page.click('#menuBtn'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok('Escape shuts it too', await shown() === false);

  /* 9. home is a level, not a zoom: it leaves whatever is open and comes back
        to the district, fitted. */
  await page.evaluate(() => goMun(13));
  await page.waitForTimeout(900);
  ok('a municipality is open', await page.evaluate(() => S.level) === 'mun');
  await page.click('#homeBtn');
  await page.waitForTimeout(900);
  ok('home comes back to the district', await page.evaluate(() => S.level) === 'district');
  ok('and the whole district is inside the view',
     await page.evaluate(() => {
       // bB holds the two NUTS III regions as well, and they spill past the
       // district — fit is to the district's own outline.
       const d = { type: 'FeatureCollection',
         features: D.bB.features.filter(f => f.properties.kind !== 'nuts3') };
       return map.getBounds().contains(L.geoJSON(d).getBounds().pad(-0.02));
     }));
  /* at level 1 it still refits, so a panned map has a way back */
  await page.evaluate(() => map.setView([41.0, -8.0], 12));
  await page.waitForTimeout(500);
  const far = await page.evaluate(() => map.getCenter().lat);
  await page.click('#homeBtn');
  await page.waitForTimeout(900);
  ok('and at level 1 it refits a map that was panned away',
     far !== await page.evaluate(() => map.getCenter().lat));

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
  const lReset = await box(page, '#homeBtn');
  ok('landscape: map is the left half', lMap.x < 2 && lMap.right < 900,
     `map ${lMap.x}..${lMap.right}`);
  ok('landscape: menu button is over the MAP, not the text',
     lMenu.right <= lMap.right + 1 && lMenu.x >= lMap.x,
     `menu ${lMenu.x}..${lMenu.right}, map ends ${lMap.right}`);
  ok('landscape: so is the home button',
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
