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

/* A 2x2 baseline JPEG with no EXIF — enough for the browser to decode, shrink
   and store, which is all the photo way needs to be exercised. */
const TINY_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAHwAAAQUBAQEB' +
  'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
  'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
  'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+v//Z';

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

  /* 0. the defaults a fresh install opens on.  A default that changes in the
     code alone changes nothing on a phone that already has the app — the old
     value is in localStorage and restore() puts it straight back — so PREF_REV
     drops the switches named in DEFAULT_RESET once.  Both halves are checked:
     the value, and the fact that a stored true does not survive a bump. */
  ok('the rivers are off until they are asked for',
     await page.evaluate(() => S.water) === false);
  ok('and no boundary is drawn thicker than a municipality',
     await page.evaluate(() => LINE_W.mun === 2.4 && LINE_W.district === 2.4
       && LINE_W.fre === 1.2 && LINE_W.region === 3.2),
     await page.evaluate(() => JSON.stringify(LINE_W)));
  ok('a river switch stored by an older build does not come back',
     await page.evaluate(() => {
       const k = Object.keys(localStorage).find(x => /porto/i.test(x)) || KEY;
       const kept = localStorage.getItem(k);
       localStorage.setItem(k, JSON.stringify({ water: true, rev: PREF_REV - 1 }));
       const before = S.water;
       S.water = false; restore();
       const after = S.water;
       localStorage.setItem(k, kept === null ? '{}' : kept);
       S.water = before;
       return after === false;
     }));

  /* 1. the trail is on the map, in the same band as the two buttons.  It used to
        be a bar of its own under the whole screen; that bar is gone and its
        height went back to the map. */
  const map = await box(page, '#paneMap');
  const crumb = await box(page, '#crumb');
  const menuBtnH = (await box(page, '#menuBtn')).h;
  ok('there is no trail bar under the screen any more',
     await page.$('header.top') === null);
  ok('map reaches the top of the screen', map.y <= 1, `map y ${map.y}`);
  ok('map reaches the bottom of its half', map.bottom >= 440, `map bottom ${map.bottom}`);
  ok('the trail is inside the map', crumb.y >= map.y && crumb.bottom <= map.bottom,
     `crumb ${crumb.y}..${crumb.bottom}, map ${map.y}..${map.bottom}`);
  ok('the trail is 10px down from the map\'s top, like the buttons',
     Math.abs(crumb.y - map.y - 10) <= 1, `${(crumb.y - map.y).toFixed(1)}`);
  ok('and the same size as the buttons, so the band is one strip',
     Math.abs(crumb.h - 44) <= 1 && Math.abs(menuBtnH - 44) <= 1,
     `crumb ${crumb.h.toFixed(1)}, button ${menuBtnH.toFixed(1)}`);
  /* The trail reads AWAY from the home button, which is the thing it undoes:
     leftward from it in Hebrew, rightward in English — one logical rule, both
     directions. It used to sit across the map from the buttons, in the far
     corner, which put the trail and the control it belongs to as far apart as
     the screen allows. The gap is measured against the home button and not
     against the map's edge, so the same line holds under either direction. */
  const homeBox = await box(page, '#homeBtn');
  const rtl = await page.evaluate(() => document.documentElement.dir === 'rtl');
  const gap = rtl ? homeBox.x - crumb.right : crumb.x - homeBox.right;
  ok('the trail sits beside the home button, not across the map from it',
     gap >= 8 && gap <= 20, `${gap.toFixed(1)}px from the home button`);
  /* Centred ON the home button, not merely started at the same inset. The two
     line heights were written in a `font:` shorthand ending in `inherit` —
     which is not a font-family token, so the whole declaration was dropped and
     the trail rendered at the inherited 16px/1.55. Its second line then hung
     below the buttons it is meant to sit beside. */
  const crumbMid = () => page.evaluate(() => {
    const c = document.querySelector('#crumb').getBoundingClientRect();
    const h = document.querySelector('#homeBtn').getBoundingClientRect();
    return +((c.y + c.height / 2) - (h.y + h.height / 2)).toFixed(2);
  });
  ok('and its middle is the home button\'s middle', Math.abs(await crumbMid()) <= 1,
     `${await crumbMid()}px off centre`);


  /* 1b. the map uses the room it has.  fitBounds snapped the zoom DOWN to a
        quarter step, so a district that wanted 9.235 was drawn at 9 — 18% of the
        map given back on every level.  The margins are the ones asked for: 10px
        at the sides and the foot, and 10px below the band at the head. */
  const fitted = async () => page.evaluate(() => {
    const pane = document.getElementById('paneMap').getBoundingClientRect();
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    document.querySelectorAll('#map .leaflet-overlay-pane path').forEach(el => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      a = Math.min(a, r.left); c = Math.max(c, r.right);
      b = Math.min(b, r.top);  d = Math.max(d, r.bottom);
    });
    const band = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ctl-size'));
    return { left: a - pane.left, right: pane.right - c,
             top: b - pane.top, bottom: pane.bottom - d,
             w: c - a, h: d - b, pane: [pane.width, pane.height],
             head: 10 + band + 10, zoom: map.getZoom() };
  });
  const f1 = await fitted();
  ok('the map is drawn to 10px of the side edges, or centred between them',
     Math.min(f1.left, f1.right) >= 9 && Math.abs(f1.left - f1.right) <= 2,
     `left ${f1.left.toFixed(1)}, right ${f1.right.toFixed(1)}`);
  ok('it never rides up under the button band',
     f1.top >= f1.head - 1, `top ${f1.top.toFixed(1)}, band ends ${f1.head}`);
  ok('and one of the two axes is actually full — nothing is left on the table',
     Math.abs(f1.w - (f1.pane[0] - 20)) <= 2
       || Math.abs(f1.h - (f1.pane[1] - f1.head - 10)) <= 2,
     `shape ${f1.w.toFixed(1)}x${f1.h.toFixed(1)} in ${f1.pane[0]}x${f1.pane[1]}`);
  ok('the zoom is not forced to a round step',
     map !== null && String(await page.evaluate(() => map.options.zoomSnap)) === '0');

  /* 1c. the map label carries no plate — a halo instead, per SC 1.4.11's own
        wording that a wide border "acts as a halo and would be considered
        background".  Measured ink-against-halo it is 17.9:1 on every level-1
        fill; what this checks is that the plate is really gone. */
  const lbl = await page.evaluate(() => {
    const i = document.querySelector('#map .lbl > i');
    if (!i) return null;
    const cs = getComputedStyle(i);
    const box = document.querySelector('#map .lbl').getBoundingClientRect();
    return { bg: cs.backgroundColor, border: cs.borderTopWidth,
             stroke: cs.webkitTextStrokeWidth, order: cs.paintOrder,
             size: parseFloat(cs.fontSize), hit: Math.round(box.height) };
  });
  ok('the number on the map has no disc behind it',
     lbl && /rgba\(0, 0, 0, 0\)|transparent/.test(lbl.bg) && parseFloat(lbl.border) === 0,
     JSON.stringify(lbl));
  ok('it is a haloed glyph — the stroke is painted under the fill',
     lbl && parseFloat(lbl.stroke) > 0 && /stroke/.test(lbl.order),
     `${lbl && lbl.stroke} / ${lbl && lbl.order}`);
  ok('and the halo stays inside MapLibre\'s quarter-of-the-font cap',
     lbl && parseFloat(lbl.stroke) / lbl.size <= 0.25,
     `${lbl && (parseFloat(lbl.stroke) / lbl.size).toFixed(3)}`);
  ok('the label is still a 24px target',
     lbl && lbl.hit >= 24, String(lbl && lbl.hit));


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
  const WANT = ['search', 'mine', 'locate', 'cats', 'cats-open', 'cmp',
    'view:split', 'view:map', 'view:text',
    'theme:auto', 'theme:light', 'theme:dark', 'lang:he', 'lang:en',
    'tiles', 'glass', 'cons', 'borders', 'more', 'regions', 'save', 'load', 'info'];
  /* Three theme rows, not two.  With only light and dark on the list the first
     choice was permanent — nothing offered the way back to following the phone.
     And all three stay named: a control whose label changes with its state
     leaves a screen reader unable to say whether the word is what the control
     IS or what it WILL DO (WAI-ARIA APG, Switch pattern). */
  ok('the theme is a set of three, and the one in force is the marked one',
     await page.evaluate(() => {
       const of = k => document.querySelector(`[data-m="theme:${k}"]`);
       const cur = k => of(k) && of(k).getAttribute('aria-current') === 'true';
       return !!of('auto') && !!of('light') && !!of('dark')
         && [cur('auto'), cur('light'), cur('dark')].filter(Boolean).length === 1;
     }));
  ok('choosing a theme and going back to following the phone both work',
     await page.evaluate(async () => {
       const tap = k => document.querySelector(`[data-m="theme:${k}"]`).click();
       tap('light');
       const lit = document.documentElement.dataset.theme === 'light';
       tap('auto');
       const back = !document.documentElement.dataset.theme && S.theme === 'auto';
       return lit && back;
     }));
  /* Hebrew is the default and the source. English flips the whole page: the
     direction, the labels, the units, and the names — which become the official
     Portuguese ones, because that is what an English reader wants and what is
     on the road signs. Prose written for this app in Hebrew stays Hebrew and
     says so, rather than being machine-translated in the app's own voice. */
  ok('Hebrew is the language the app opens in',
     await page.evaluate(() => S.lang) === 'he');
  ok('and the page is right-to-left',
     await page.evaluate(() => document.documentElement.dir) === 'rtl');
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
  ok('the four groups are titled',
     (await page.$$eval('#menuIn .mgrp', els => els.map(e => e.textContent).filter(Boolean)))
       .join('|') === 'תצוגה|שפה|שכבות|נתונים',
     (await page.$$eval('#menuIn .mgrp', els => els.map(e => e.textContent).filter(Boolean))).join('|'));

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

  /* אזורים draws the orange line, 3.2 wide */
  await page.click('[data-m="regions"]');
  await page.waitForTimeout(700);
  const region = await page.evaluate(() => {
    const p = [...document.querySelectorAll('#map path')]
      .find(el => (el.getAttribute('stroke') || '').toLowerCase() === '#e2761b');
    return p ? Number(p.getAttribute('stroke-width')) : null;
  });
  ok('אזורים draws the orange line at width 3.2', region === 3.2, String(region));
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
     (await page.$$eval('.way-row [data-wpway]', els => els.map(e => e.textContent.trim()))).join('|')
       === 'ממפה|מתמונה|מכתובת');
  ok('on one line', await page.evaluate(() => {
       const ys = [...document.querySelectorAll('.way-row .chip')]
         .map(e => Math.round(e.getBoundingClientRect().y));
       return new Set(ys).size === 1;
     }));
  ok('packed to the start edge — the right',
     await page.evaluate(() => {
       const r = document.querySelector('.way-row').getBoundingClientRect();
       const first = document.querySelector('.way-row .chip').getBoundingClientRect();
       return Math.abs(first.right - r.right) < 2;
     }));
  ok('under a heading that says what the row is for',
     (await page.$eval('.way-hd', e => e.textContent)).trim() === 'מקור מקום חדש',
     await page.$eval('.way-hd', e => e.textContent));
  ok('and a line on each of them', (await page.$$('.way-why [data-wpway]')).length === 3);
  ok('the lines are as tappable as the chips — the words are the explanation',
     await page.evaluate(() => {
       const before = wpWay;
       document.querySelector('.way-why [data-wpway="place"]').click();
       const after = wpWay;
       return before !== 'place' && after === 'place';
     }));
  await page.waitForTimeout(400);
  ok('there is no cancel button anywhere on it — home is the way out',
     await page.$('[data-wpact="cancel"]') === null);
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
  ok('ממפה shows the map first',
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

  /* 3: מתמונה has to produce a place.  takePhoto() needed a record to already
        exist, so the photo way opened the picker and then did nothing at all —
        no form, no place.  A real file goes through the real input here. */
  await page.evaluate(() => { D.mine = []; saveMine(); if (!S.wp) toggleWp(); });
  await page.waitForTimeout(500);
  await page.click('[data-wpact="new"]');
  await page.waitForTimeout(400);
  await page.click('.way-why [data-wpway="photo"]');
  await page.waitForTimeout(400);
  await page.setInputFiles('#wpPhotoIn', { name: 'a.jpg', mimeType: 'image/jpeg',
    buffer: Buffer.from(TINY_JPEG, 'base64') });
  await page.waitForTimeout(2500);
  ok('מתמונה opens the form for a place of its own',
     await page.$('#mineName') !== null && await page.evaluate(() => !!mineEditing));
  ok('with the photo already on it', await page.$('#minePhotoBox img') !== null);
  ok('and the coordinates it could work out',
     await page.evaluate(() => Array.isArray(mineEditing.ll) && mineEditing.ll.length === 2));
  await page.click('#homeBtn');
  await page.waitForTimeout(800);

  /* 1.1 + 2: home is live on every screen, and it is the way out of one.  There
     is no cancel button any more, so this is the only way back. */
  await page.evaluate(() => { if (!S.wp) toggleWp(); S.wpSel = null; renderWaypoints(); });
  await page.waitForTimeout(500);
  await page.click('[data-wpact="new"]');
  await page.waitForTimeout(500);
  ok('the new-place screen is up', await page.$eval('#wpSheet', e => e.hidden) === false);
  await page.evaluate(() => goMun(13));
  await page.waitForTimeout(800);
  await page.click('#homeBtn');
  await page.waitForTimeout(900);
  ok('home works from the new-place screen and shuts it',
     await page.$eval('#wpSheet', e => e.hidden) === true);
  ok('and leaves the places screen behind it',
     await page.evaluate(() => S.wp === false && wpNew === false && !mineEditing));
  ok('and comes back to the district',
     await page.evaluate(() => S.level) === 'district');
  /* home also gets out of placing, which has no buttons of its own but two */
  await page.evaluate(() => { toggleWp(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { openNewSheet(); pickWay('map'); });
  await page.waitForTimeout(800);
  ok('placing is on', await page.evaluate(() => S.adding && !!ghost));
  await page.click('#homeBtn');
  await page.waitForTimeout(900);
  ok('home ends placing and clears the map',
     await page.evaluate(() => !S.adding && !ghost)
       && await page.$eval('#pickBar', e => e.hidden));

  /* 5: on the places screen the map is for looking at and for the pins.  A tap
        on a municipality would take you off the screen you are working on. */
  await page.evaluate(() => {
    D.mine = [{ id: 'tap1', name: 'בדיקה', desc: '', ll: [41.2, -8.5], at: '2026-09-11' }];
    saveMine(); if (!S.wp) toggleWp();
  });
  await page.waitForTimeout(700);
  const lvlBefore = await page.evaluate(() => S.level);
  await page.evaluate(() => {
    LG.mun.eachLayer(l => { if (l.feature && l.feature.properties.num === 13) l.fire('click'); });
  });
  await page.waitForTimeout(700);
  ok('a tap on a municipality does not navigate while the places screen is up',
     await page.evaluate(() => S.level) === lvlBefore,
     `${lvlBefore} -> ${await page.evaluate(() => S.level)}`);
  ok('nor does its number label',
     await page.evaluate(() => {
       const was = S.level;
       LG.labels.eachLayer(l => l.fire('click'));
       return S.level === was;
     }));
  ok('but a pin still answers',
     await page.evaluate(() => {
       S.wpSel = null;
       LG.wp.eachLayer(l => l.fire('click'));
       return S.wpSel === 'tap1';
     }));
  /* setZoom is animated and does not land inside one tick, so what is read here
     is whether the gestures are on — that is what "the map still moves" means */
  ok('and the map can still be panned and zoomed',
     await page.evaluate(() => map.dragging.enabled()
       && map.touchZoom.enabled() && map.scrollWheelZoom.enabled()
       && map.doubleClickZoom.enabled()));

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
  /* the chosen one differs in size and in nothing else */
  const two = await page.evaluate(() => {
    const read = on => {
      const el = document.createElement('div');
      el.innerHTML = pinIcon(on).options.html;
      const path = el.querySelector('path');
      return { fill: path.getAttribute('fill'), stroke: path.getAttribute('stroke'),
               w: Number(el.querySelector('svg').getAttribute('width')) };
    };
    return { off: read(false), on: read(true) };
  });
  ok('the chosen pin is the same colour as the rest',
     two.on.fill === two.off.fill && two.on.stroke === two.off.stroke,
     JSON.stringify(two));
  ok('and differs only in being bigger', two.on.w > two.off.w, `${two.off.w} -> ${two.on.w}`);
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

  /* 10b. the INE housing-market card.  Four numbers, every one of them a chip
     that opens its own source record, and the seven municipalities INE does not
     publish parishes for showing "אין נתון" rather than their municipality's
     median.  The fill-down is the failure this is here for: it would look
     perfectly plausible on screen. */
  const cardOf = h => page.evaluate(t => {
    const c = [...document.querySelectorAll('#doc .card')]
      .find(el => (el.querySelector('h2') || {}).textContent?.includes(t));
    if (!c) return null;
    return {
      title: c.querySelector('h2').textContent.trim(),
      note: (c.querySelector('.note') || {}).textContent || '',
      chips: [...c.querySelectorAll('.stat')].map(b => ({
        label: b.querySelector('.stat-l').textContent.trim(),
        value: b.querySelector('.stat-v').textContent.trim(),
        year: b.querySelector('.stat-y').textContent.trim(),
        src: b.dataset.src,
        missing: b.classList.contains('no'),
      })),
    };
  }, h);

  await page.evaluate(() => goMun(1));          // Porto
  await page.waitForTimeout(800);
  const mk = await cardOf('שוק הדיור');
  ok('the market card is on the municipality page', mk !== null);
  ok('its heading names INE and the quarter',
     mk && /INE\s+\d{4}Q\d/.test(mk.title), mk && mk.title);
  ok('it carries the four series', mk && mk.chips.length === 4,
     mk && String(mk.chips.length));
  ok('each chip points at its own source record',
     mk && new Set(mk.chips.map(c => c.src)).size === 4
        && mk.chips.every(c => c.src.startsWith('municipio.')),
     mk && mk.chips.map(c => c.src).join(' '));
  ok('Porto has a sale price and it is a number',
     mk && !mk.chips[0].missing && /\d/.test(mk.chips[0].value),
     mk && mk.chips[0].value);
  ok('and the year on the chip is the reference year, not today',
     mk && /^\d{4}$/.test(mk.chips[0].year), mk && mk.chips[0].year);
  ok('the note says the value is a twelve-month median, not the quarter',
     mk && mk.note.includes('שנים עשר החודשים'), mk && mk.note.slice(0, 60));
  ok('and that the rent is new contracts only',
     mk && mk.note.includes('חוזים חדשים'));

  /* the chip opens the source record, and the record carries the caveat */
  await page.click('#doc .card .stat[data-src="municipio.rent_eur_m2"]');
  await page.waitForTimeout(400);
  const rec = await page.evaluate(() =>
    document.querySelector('#panel').hidden ? '' :
    document.querySelector('#panelBody').textContent);
  ok('tapping the rent chip opens its source record',
     rec.includes('0014696'), rec.slice(0, 80));
  ok('the record repeats the twelve-month caveat',
     rec.includes('שנים עשר החודשים'));
  ok('and says the value is reported, not verified',
     !rec.includes('מאומת') || rec.includes('מדווח'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  /* one of the nine: INE publishes the municipality and none of its parishes.
     It was seven until the app moved to the 2025 division. INE publishes
     against the 2013 codes, so every parish the reform created has no row at
     all — which took Matosinhos and Póvoa de Varzim, whose parishes were all
     renumbered, from partly covered to not covered. That cost was written
     down before the move and is recorded in sources.json. */
  // The count is the assertion, not the sample.  Picking whichever municipality
  // happens to be empty would keep passing while six of the seven quietly
  // filled up, which is the shape of a check that cannot fail.
  const blind = await page.evaluate(() => {
    const has = new Set(D.fre.filter(f => f.price_eur_m2 !== undefined)
                             .map(f => f.mun_num));
    return D.mun.filter(x => !has.has(x.num)).map(x => x.pt);
  });
  ok('INE publishes parishes in nine municipalities and no more',
     blind.length === 9, `${blind.length}: ${blind.join(', ')}`);
  ok('and they are the nine the source record names',
     blind.slice().sort().join('|') === ['Amarante', 'Baião', 'Felgueiras',
       'Lousada', 'Marco de Canaveses', 'Matosinhos', 'Paços de Ferreira',
       'Penafiel', 'Póvoa de Varzim'].sort().join('|'), blind.join(', '));
  const blindNum = await page.evaluate(names => {
    const m = D.mun.find(x => x.pt === names[0]);
    goMun(m.num);
    return m.num;
  }, blind);
  await page.waitForTimeout(800);
  const pm = await cardOf('שוק הדיור');
  ok('a municipality with no published parish still has its own figure',
     pm && !pm.chips[0].missing, pm && pm.chips[0].value);
  const pz = await page.evaluate(n => {
    const f = D.fre.find(x => x.mun_num === n);
    goZone(f.mun_num + '|' + f.pt);
    return f.pt;
  }, blindNum);
  await page.waitForTimeout(900);
  const pf = await cardOf('שוק הדיור');
  ok(`${pz}: every one of the four reads אין נתון`,
     pf && pf.chips.length === 4 && pf.chips.every(c => c.missing),
     pf && pf.chips.map(c => c.value).join(' | '));
  ok('and the card says why rather than leaving four blanks',
     pf && pf.note.includes('אינו מפרסם ברמת הרובע'), pf && pf.note.slice(-70));
  ok('the parish chips point at the parish records, not the municipality ones',
     pf && pf.chips.every(c => c.src.startsWith('freguesia.')),
     pf && pf.chips.map(c => c.src).join(' '));

  /* a parish INE does publish, in one of the eleven */
  const okp = await page.evaluate(() => {
    const f = D.fre.find(x => x.price_eur_m2 !== undefined);
    goZone(f.mun_num + '|' + f.pt);
    return f.pt;
  });
  await page.waitForTimeout(900);
  const gf = await cardOf('שוק הדיור');
  ok(`${okp}: a published parish shows its own number`,
     gf && !gf.chips[0].missing, gf && gf.chips[0].value);
  ok('and it does not carry the seven-municipality note',
     gf && !gf.note.includes('אינו מפרסם ברמת הרובע'));
  await page.evaluate(() => goDistrict());
  await page.waitForTimeout(700);

  /* 10c. השוואת נתונים.  The screen as it was specified: eighteen municipalities
     with the street background off, area as the field it opens on, the field's
     own name as the heading, three controls above it, a key that binds each of
     the five colours to a range, and the units listed small to large.

     Two of these are the accuracy contract in a new place: a unit with no value
     is HATCHED rather than given an end of the scale, and the key's ranges are
     read off the units rather than assumed. */
  const cmpRows = () => page.$$eval('#doc .cmp-row', els => els.map(e => ({
    code: e.querySelector('.cmp-sw').textContent.trim(),
    name: e.querySelector('.cmp-n').firstChild.textContent.trim(),
    val: e.querySelector('.cmp-v').textContent.trim(),
    src: e.querySelector('.cmp-v').dataset.src,
    none: e.classList.contains('no'),
    mun: e.dataset.mun || null,
    fill: getComputedStyle(e.querySelector('.cmp-sw')).backgroundColor,
  })));
  const keyRows = () => page.$$eval('#doc .cmp-k', els => els.map(e => ({
    range: e.querySelector('.cmp-k-r').textContent.replace(/\s+/g, ' ').trim(),
    n: +e.querySelector('.cmp-k-n').textContent.trim(),
    nd: e.querySelector('.cmp-k-sw').classList.contains('cmp-k-nd'),
  })));

  await page.click('#homeBtn'); await page.waitForTimeout(700);
  /* The background has to be ON going in, or "it is off inside" proves nothing:
     the run aborts every tile request, and the failure path switches it off by
     itself.  The first cut of this check passed with the code that turns it off
     deleted. */
  await page.evaluate(() => { if (!S.tiles) toggleTiles(); });
  /* Same trap as the background: switch the rivers ON going in, or "they are
     off inside" passes on a page where they were never on. */
  await page.evaluate(() => { if (!S.water) { S.water = true; applyNature(); } });
  await page.waitForTimeout(300);
  const tilesBefore = await page.evaluate(() => S.tiles);
  ok('the street background is on before the comparison is opened',
     tilesBefore === true);
  ok('and so are the rivers', await page.evaluate(() => S.water) === true);
  if (!(await page.$eval('#menu', e => !e.hidden))) { await page.click('#menuBtn'); await page.waitForTimeout(300); }
  await page.click('[data-m="cmp"]');
  await page.waitForTimeout(1000);
  ok('the menu row opens השוואת נתונים', await page.evaluate(() => S.cmp) === true);
  ok('it opens on the district, the eighteen municipalities',
     await page.evaluate(() => S.level) === 'district'
       && await page.evaluate(() => S.cmpScope) === 'mun');
  ok('with the street background off',
     await page.evaluate(() => S.tiles) === false);
  /* A blue line crossing a blue fill is read as part of the scale. */
  ok('and the rivers off with it', await page.evaluate(() => S.water) === false
     && await page.evaluate(() => !!(NAT.water && map.hasLayer(NAT.water))) === false);
  ok('and the field it opens on is the municipalities\' area',
     await page.evaluate(() => S.cmpField) === 'area_km2');
  ok('the screen is map above and text below',
     await page.evaluate(() => document.body.dataset.view) === 'split');

  /* the heading is the field's own name */
  const head = await page.$eval('#doc .cmp-h', e => e.textContent.replace(/\s+/g, ' ').trim());
  ok('the heading is the name of the field on screen', head.startsWith('שטח'), head);

  /* three controls above it, and where they sit */
  const ctl = await box(page, '#doc .cmp-top');
  const bMun = await box(page, '[data-cmpscope="mun"]');
  const bFre = await box(page, '[data-cmpscope="fre"]');
  const bSwap = await box(page, '[data-cmppick="1"]');
  const headBox = await box(page, '#doc .cmp-h');
  ok('the three controls sit above the heading', ctl.bottom <= headBox.y + 1,
     `${ctl.bottom} vs ${headBox.y}`);
  ok('עיריות and רובעים are at the start edge — the right',
     Math.abs(ctl.right - bMun.right) <= 2 && bMun.right > bFre.right,
     `${ctl.right} / ${bMun.right} / ${bFre.right}`);
  ok('החלפת נתון is at the end edge — the left',
     Math.abs(bSwap.x - ctl.x) <= 2, `${bSwap.x} vs ${ctl.x}`);
  ok('and it reads החלפת נתון',
     (await page.$eval('[data-cmppick="1"]', e => e.textContent)).trim() === 'החלפת נתון');

  /* the key: five colours, each bound to the range it covers */
  const key = await keyRows();
  ok('the key has one row per colour that has units in it',
     key.length === 5 && key.every(k => k.n > 0), JSON.stringify(key.map(k => k.n)));
  ok('every row names the range it stands for',
     key.every(k => /\d/.test(k.range)), key.map(k => k.range).join(' | '));
  /* Both ends, not just the starts: five bands that interleave still have
     ascending first numbers, which is how the first cut of this passed with the
     banding scrambled. */
  ok('the ranges climb and do not overlap',
     (() => { const nums = k => (k.range.match(/[\d.,]+/g) || [])
                .map(x => parseFloat(x.replace(/,/g, '')));
              const b = key.map(k => nums(k));
              return b.every(x => x.length >= 1)
                && b.every((x, i) => i === 0 || x[0] > b[i - 1][b[i - 1].length - 1]); })(),
     key.map(k => k.range).join(' | '));
  ok('and the counts add up to the eighteen', key.reduce((a, k) => a + k.n, 0) === 18);

  /* the list, smallest first */
  const mun = await cmpRows();
  ok('all 18 municipalities are listed', mun.length === 18, String(mun.length));
  ok('and the list runs from the smallest value up',
     (() => { const v = mun.map(r => parseFloat(r.val.replace(/[^\d.]/g, '')));
              return v.every((x, i) => i === 0 || x >= v[i - 1]); })(),
     mun.map(r => r.val).join(' '));
  /* the DICOFRE code, with the leading zero dropped under ten: one digit reads
     faster as a label on a shape, and the map and the list have to agree */
  ok('each row carries the unit\'s own DICOFRE code, single-digit under ten',
     mun.every(r => /^([1-9]|[1-9]\d)$/.test(r.code)), mun.map(r => r.code).join(' '));
  ok('and its value opens the municipality source record',
     mun.every(r => r.src === 'municipio.area_km2'));
  /* five distinct fills and no more: the whole point of five classes */
  ok('the rows take exactly five colours, not one per unit',
     new Set(mun.map(r => r.fill)).size === 5,
     String(new Set(mun.map(r => r.fill)).size));

  /* the map: eighteen shapes, one of five colours each, plus the code labels */
  const mapFills = await page.$$eval('#map .leaflet-overlay-pane path',
    els => els.map(e => e.getAttribute('fill')).filter(f => f && f.startsWith('#')));
  ok('the map paints the same five colours', new Set(mapFills).size === 5,
     String(new Set(mapFills).size));
  ok('and the labels on it are the same codes, the map agreeing with the list',
     await page.$$eval('#map .lbl', els => els.every(e => /^([1-9]|[1-9]\d)$/.test(e.textContent.trim())))
       && (await page.$$eval('#map .lbl', els => els.map(e => e.textContent.trim()).sort().join(' ')))
          === mun.map(r => r.code).sort().join(' '),
     await page.$$eval('#map .lbl', els => els.map(e => e.textContent.trim()).join(' ')));
  /* the label carries no pill of its own here: white on the fill, nothing behind */
  const lblStyle = await page.$eval('#map .lbl.cmp-lbl > i', el => {
    const c = getComputedStyle(el);
    const box = el.parentElement.getBoundingClientRect();
    return { colour: c.color, bg: c.backgroundColor, border: c.borderTopWidth,
             hit: Math.min(box.width, box.height) };
  });
  ok('the labels are white with nothing behind them',
     lblStyle.colour === 'rgb(255, 255, 255)'
       && /rgba\(0, 0, 0, 0\)|transparent/.test(lblStyle.bg)
       && parseFloat(lblStyle.border) === 0, JSON.stringify(lblStyle));
  /* the ink is 12px of glyph; the box around it is the target, and WCAG 2.2
     SC 2.5.8 puts the floor at 24 CSS px */
  ok('and the label\'s own box is a 24px target, as 2.5.8 requires',
     lblStyle.hit >= 24, String(lblStyle.hit));
  /* The boundary while comparing is white AND dark — a casing with a core
     inside it.  Neither colour clears 3:1 over all five blues and both plates
     on its own, and the edge of the district against the day plate, white on
     #eef1f5 at 1.13, was the one the eye lost first.  So the test is not "white
     everywhere" any more; it is that both strokes are there, in every pane that
     draws a boundary, and that the dark one is present on the district's own
     outline, which is the silhouette. */
  // Leaflet names the pane element leaflet-<name>-pane, not <name>
  const strokesIn = p => page.evaluate(pane => [...new Set(
    [...document.querySelectorAll(`.leaflet-${pane}-pane path`)]
      .map(x => (x.getAttribute('stroke') || '').toLowerCase()).filter(Boolean))], p);
  for (const pane of ['ln-mun', 'ln-district']) {
    const c = await strokesIn(pane);
    ok(`${pane}: the boundary is cased — white outside, dark core inside`,
       c.includes('#ffffff') && c.includes('#1b2532'), c.join(' | '));
  }
  const cased = await page.evaluate(() => {
    const of = pane => [...document.querySelectorAll(`.leaflet-${pane}-pane path`)]
      .map(x => ({ c: (x.getAttribute('stroke') || '').toLowerCase(),
                   w: Number(x.getAttribute('stroke-width')) }));
    const m = of('ln-mun');
    const white = m.find(x => x.c === '#ffffff');
    const dark = m.find(x => x.c === '#1b2532');
    return { white: white && white.w, dark: dark && dark.w };
  });
  ok('and the core is the narrower of the two, so it reads as one line',
     cased.dark > 0 && cased.dark < cased.white,
     `casing ${cased.white}, core ${cased.dark}`);
  ok('no boundary is left black while comparing',
     !(await strokesIn('ln-mun')).includes('#000000')
       && !(await strokesIn('ln-district')).includes('#000000'));

  /* רובעים at level 1 must draw ALL 243, not a sample.  An earlier cut drew the
     twenty ends and hatched the eighteen municipalities underneath them, which
     put the whole district in the "no value" pattern — the screen said nothing
     at all, and no check here noticed, because they all counted rows in the
     list rather than shapes on the map. */
  await page.click('[data-cmpscope="fre"]');
  await page.waitForTimeout(1100);
  const freRows = await cmpRows();
  const freShapes = await page.$$eval('#map .leaflet-overlay-pane path[fill^="#"]',
    els => els.length);
  ok('choosing רובעים lists all 275 parishes', freRows.length === 275, String(freRows.length));
  ok('and draws every one of them on the map, not a sample',
     freShapes === freRows.length, `${freShapes} shapes, ${freRows.length} rows`);
  ok('nothing is left in the no-value pattern that has a value',
     await page.$$eval('#map .leaflet-overlay-pane path',
       els => els.filter(e => (e.getAttribute('fill') || '').includes('cmp-nodata')).length) === 0);
  ok('and they still take only the five colours',
     new Set(freRows.map(r => r.fill)).size === 5,
     String(new Set(freRows.map(r => r.fill)).size));
  /* A fill with no edge is not a unit — it is a stain that runs into the next
     one.  At level 1 the parish lines are off on the ordinary map, which is why
     they were missing here: the comparison is the one place that needs all 243
     of them, because all 243 are carrying a value. */
  const freLines = await page.$$eval('.leaflet-ln-fre-pane path',
    els => els.filter(e => e.getAttribute('stroke')).length);
  ok('and every parish has a boundary drawn, not only a fill',
     freLines >= freRows.length, `${freLines} strokes for ${freRows.length} parishes`);
  ok('the parish line stays the receding one — the municipality above it is stronger',
     await page.evaluate(() => {
       const w = pane => {
         const el = document.querySelector(`.leaflet-${pane}-pane path[stroke="#ffffff"]`)
           || document.querySelector(`.leaflet-${pane}-pane path`);
         return el ? Number(el.getAttribute('stroke-width')) : 0;
       };
       // an absent pane gives 0, and 0 < anything is true — so require both
       return w('ln-fre') > 0 && w('ln-mun') > 0 && w('ln-fre') < w('ln-mun');
     }));
  await page.click('[data-cmpscope="mun"]');
  await page.waitForTimeout(900);

  /* a municipality opens level 2, from the list and from the map alike */
  await page.click('#doc .cmp-row[data-mun]');
  await page.waitForTimeout(900);
  ok('a tap on a municipality row opens it',
     await page.evaluate(() => S.level) === 'mun' && await page.evaluate(() => S.cmp) === true);
  ok('at level 2 the two scope buttons are gone',
     await page.$('#doc .cmp-sc') === null);
  /* There is no street map under the other seventeen, so their outlines would
     be lines around a picture of one municipality, and the district edge would
     cross the empty corner on its way to nowhere. */
  ok('and the plate holds that municipality alone — no neighbours, no district',
     await page.evaluate(() => {
       const n = p => document.querySelectorAll(`.leaflet-${p}-pane path`).length;
       return n('ln-mun') <= 2 && n('ln-district') === 0;
     }),
     await page.evaluate(() => JSON.stringify(['ln-mun', 'ln-district']
       .map(p => [p, document.querySelectorAll(`.leaflet-${p}-pane path`).length]))));
  ok('but החלפת נתון is still there', await page.$('[data-cmppick="1"]') !== null);
  const p2 = await cmpRows();
  ok('and the parishes of that municipality are what is compared',
     p2.length === await page.evaluate(() => (D.freByMun.get(S.mun) || []).length)
       && p2.every(r => r.src === 'freguesia.area_km2'),
     String(p2.length));
  ok('the heading is still the field, not the municipality',
     (await page.$eval('#doc .cmp-h', e => e.textContent)).trim().startsWith('שטח'));

  /* החלפת נתון opens the picker, and choosing puts the screen back */
  await page.click('[data-cmppick="1"]'); await page.waitForTimeout(500);
  ok('החלפת נתון opens the field picker',
     await page.evaluate(() => S.cmpPick) === true
       && (await page.$$eval('#doc [data-cmpf]', e => e.length)) > 12);
  ok('and the key and the list are not on screen while it is open',
     await page.$('#doc .cmp-k') === null && (await cmpRows()).length === 0);
  await page.evaluate(() => goMun(9));            // Santo Tirso: 6 of 14 priced
  await page.waitForTimeout(700);
  await page.click('[data-cmppick="1"]').catch(() => {});
  await page.waitForTimeout(300);
  if (await page.evaluate(() => !S.cmpPick)) { await page.click('[data-cmppick="1"]'); await page.waitForTimeout(400); }
  await page.click('#doc [data-cmpf="price_eur_m2"]');
  await page.waitForTimeout(900);
  ok('choosing a field closes the picker and names it in the heading',
     await page.evaluate(() => S.cmpPick) === false
       && (await page.$eval('#doc .cmp-h', e => e.textContent)).includes('מכירות'));

  /* the one that matters: no value is a hatch, never an end of the scale */
  const st = await cmpRows();
  const blank = st.filter(r => r.none);
  ok('the parishes INE does not publish are listed apart, without a colour',
     blank.length === 8, String(blank.length));
  ok('and they read אין נתון', blank.every(r => r.val === 'אין נתון'));
  ok('the map hatches them rather than giving them a shade',
     await page.$$eval('#map .leaflet-overlay-pane path',
       els => els.filter(e => (e.getAttribute('fill') || '').includes('cmp-nodata')).length) === 8);
  ok('and the pattern is the one specified — 1.2px lines 4px apart, at 45°',
     await page.evaluate(() => {
       const p = document.querySelector('#cmp-nodata');
       if (!p) return false;
       const l = p.querySelector('line');
       return p.getAttribute('width') === '4' && p.getAttribute('patternTransform') === 'rotate(45)'
         && l.getAttribute('stroke-width') === '1.2';
     }));
  const k2 = await keyRows();
  ok('the key names the missing group too, with its own hatch',
     k2.some(k => k.nd && k.n === 8), JSON.stringify(k2));

  /* home closes it and puts the background back as it was */
  await page.click('#homeBtn');
  await page.waitForTimeout(900);
  ok('home closes the comparison', await page.evaluate(() => S.cmp) === false);
  ok('and gives the street background back exactly as it was',
     await page.evaluate(() => S.tiles) === tilesBefore,
     `${tilesBefore} → ${await page.evaluate(() => S.tiles)}`);
  ok('and the rivers back too, since they were on going in',
     await page.evaluate(() => S.water) === true);
  ok('and comes back to the district', await page.evaluate(() => S.level) === 'district');

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

  /* 12. the language switch, driven the way a user drives it */
  await page.setViewportSize({ width: 412, height: 900 });
  await page.evaluate(() => { if (S.cmp) toggleCmp(); goMun(1); });
  await page.waitForTimeout(600);
  if (!(await page.$eval('#menu', e => !e.hidden))) { await page.click('#menuBtn'); await page.waitForTimeout(300); }
  await page.click('[data-m="lang:en"]');
  await page.waitForTimeout(900);
  ok('choosing English flips the page to left-to-right',
     await page.evaluate(() => document.documentElement.dir) === 'ltr'
       && await page.evaluate(() => document.documentElement.lang) === 'en');
  await page.click('#menuClose').catch(() => {});
  await page.waitForTimeout(500);
  const enText = await page.evaluate(() => document.getElementById('doc').innerText);
  ok('the card labels are English', enText.includes('Residents') && enText.includes('Density'));
  ok('the units are English', enText.includes('km²'));
  ok('a place is named in Portuguese, not transliterated Hebrew',
     enText.includes('Porto') && !/פורטו/.test(enText.split('\n').slice(0, 6).join(' ')));
  ok('the trail is English too',
     (await page.$eval('#crumb', e => e.innerText)).includes('Porto District'));
  /* One line here, because this is level 2 and there is exactly one level
     above it. The trail names where you came from, not where you are — the
     municipality's own name is the heading of the page under it. */
  ok('and at level 2 it names the one level above, on one line',
     (await page.$eval('#crumb', e => e.innerText)).split('\n')
       .filter(x => x.trim()).length === 1,
     await page.$eval('#crumb', e => JSON.stringify(e.innerText)));
  /* Line by line, not substring: the municipality here is Porto, and "Porto"
     is inside "Porto District" — a substring test would fail on a trail that is
     perfectly correct. */
  const enLines = (await page.$eval('#crumb', e => e.innerText))
    .split('\n').map(x => x.trim()).filter(Boolean);
  const enMun = await page.evaluate(() => nm(D.munByNum.get(S.mun)));
  ok('and no line of it is the municipality the page is already titled with',
     !enLines.includes(enMun), JSON.stringify([enLines, enMun]));
  /* the same logical rule, now pointing the other way: in English the trail
     reads rightward from the home button. A rule that only held in Hebrew
     would be a physical left, not a logical start. */
  const enCrumb = await box(page, '#crumb');
  const enHome = await box(page, '#homeBtn');
  ok('and it has crossed to the other side of the home button',
     enCrumb.x - enHome.right >= 8 && enCrumb.x - enHome.right <= 20,
     `${(enCrumb.x - enHome.right).toFixed(1)}px right of home`);
  /* Until 1.33.0 the app's own prose stayed in Hebrew on an English screen,
     flagged 'Hebrew only'. It is translated now — by the same hand that wrote
     the Hebrew, which is the only English the app will speak in its own voice.
     So the claim to test reversed: no Hebrew reaches an English reading panel
     at all. heOnly() stays as the backstop for a string that slips past check
     7o, and the second case is what proves the backstop still works. */
  ok('no Hebrew survives anywhere in the English reading panel',
     await page.evaluate(() => !/[\u0590-\u05ff]/.test(
       document.getElementById('doc').innerText)),
     await page.evaluate(() => (document.getElementById('doc').innerText
       .match(/[\u0590-\u05ff][^\n]*/) || ['—'])[0].slice(0, 60)));
  ok('and an untranslated string would still be marked, not passed off as English',
     await page.evaluate(() => {
       // prose() is what renders every data string; ask it about one that has
       // no entry, exactly as a newly written Hebrew note would arrive
       const out = prose('משפט שאין לו אנגלית.');
       return /dir="rtl"/.test(out) && /Hebrew only/.test(out);
     }));
  /* The screenshot that started this: some of the text had not been translated
     and had not turned round.  One panel proves nothing — the strings that
     survived were in the places the earlier test never opened: a bairro's name
     on a Porto parish, the licence notices at the foot of the info panel, and
     the point categories, whose table held a t() evaluated once at load and so
     froze to whatever language the app had opened in.  This walks every level
     of every municipality, plus the panels, and asks one question of each. */
  /* Two kinds of Hebrew belong on an English screen and are not findings.  A
     point the user saved is THEIR text and is never touched — translating it
     would put words in their mouth.  And a language names itself in its own
     language, which is the same exemption checks.py 7n carries. */
  const hebrewIn = async sel => page.evaluate(s2 => {
    const el = document.querySelector(s2);
    if (!el || !el.innerText) return null;
    const mine = new Set([...el.querySelectorAll('[data-mine], [data-m^="lang:"]')]
      .flatMap(e => e.innerText.split('\n')));
    const line = el.innerText.split('\n').find(l =>
      /[\u0590-\u05ff]/.test(l) && !/Hebrew only/.test(l) && !mine.has(l)
      && l.trim() !== 'עברית');
    return line ? line.trim().slice(0, 70) : null;
  }, sel);
  /* The other half of that rule, stated as a test rather than left implied:
     the user's own words survive the switch exactly as they typed them. */
  await page.evaluate(() => {
    D.mine = [{ id: 'lang1', name: 'נקודה שלי', desc: 'מה שכתבתי',
                ll: [41.2, -8.5], at: '2026-09-12' }];
  });
  await page.evaluate(() => goHome()); await page.waitForTimeout(400);
  await page.evaluate(() => openMenu(true)); await page.waitForTimeout(300);
  await page.click('[data-m="mine"]').catch(() => {});
  await page.waitForTimeout(600);
  ok("a point the user saved keeps their own words, in English too",
     await page.evaluate(() => /נקודה שלי/.test(document.getElementById('doc').innerText)),
     await page.evaluate(() => document.getElementById('doc').innerText.slice(0, 80)));
  await page.evaluate(() => { D.mine = []; if (S.wp) toggleWp(); });
  await page.evaluate(() => openMenu(false)); await page.waitForTimeout(300);
  /* The reading panel has to be on screen for any of this to mean anything.
     The landscape section left the view on 'map', and the first version of
     this sweep then found no parish row to open, opened nothing, and passed —
     eighteen levels skipped in silence, which is the §11 failure this project
     keeps meeting. The counters below are what make the skip impossible. */
  await page.evaluate(() => { S.view = 'split'; applyView(); });
  await page.waitForTimeout(300);
  const sweep = [];
  let munSeen = 0, freSeen = 0;
  for (const num of await page.evaluate(() => D.mun.map(m => m.num))) {
    await page.evaluate(n => goMun(n), num);
    await page.waitForTimeout(260);
    munSeen++;
    const bad = await hebrewIn('#doc');
    if (bad) sweep.push('municipality ' + num + ': ' + bad);
    /* Three parishes, not one: a note that only shows on the twelfth parish of
       a municipality is exactly the string that escapes. The whole 243 is
       checks.py 7o's job — it reads the data rather than the screen, and it is
       the one that proves every string has an English form. What THIS proves
       is the other half: that the render path puts that English on the page
       instead of walking round the translator. */
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('#doc [data-fre]')].map(e => e.dataset.fre));

    for (const key of rows.slice(0, 3)) {
      await page.evaluate(k => {
        const row = document.querySelector(`#doc [data-fre="${k.replace(/"/g, '\\"')}"]`);
        if (row) row.click();
      }, key);
      await page.waitForTimeout(320);
      freSeen++;
      const b2 = await hebrewIn('#doc');
      if (b2) sweep.push('parish ' + key + ': ' + b2);
      await page.evaluate(n => goMun(n), num);
      await page.waitForTimeout(220);
    }
  }
  ok('the sweep actually walked the levels it claims to have walked',
     munSeen === 18 && freSeen >= 40, `${munSeen} municipalities, ${freSeen} parishes`);
  ok('no Hebrew on any English screen, at any level of any municipality',
     sweep.length === 0, sweep.slice(0, 3).join(' | '));

  await page.evaluate(() => goHome()); await page.waitForTimeout(400);
  await page.evaluate(() => openInfo()); await page.waitForTimeout(600);
  ok('and none in the sources panel, where every record and licence is listed',
     (await hebrewIn('#infoBody')) === null, await hebrewIn('#infoBody'));
  await page.evaluate(() => { document.getElementById('infoDrawer').hidden = true; });
  await page.waitForTimeout(300);
  await page.evaluate(() => openMenu(true)); await page.waitForTimeout(450);
  ok('and none in the menu itself', (await hebrewIn('#menu')) === null,
     await hebrewIn('#menu'));
  await page.evaluate(() => openMenu(false)); await page.waitForTimeout(300);
  await page.evaluate(() => { if (!S.cmp) toggleCmp(); }); await page.waitForTimeout(900);
  ok('and none in the comparison view', (await hebrewIn('#doc')) === null,
     await hebrewIn('#doc'));
  await page.evaluate(() => { if (S.cmp) toggleCmp(); }); await page.waitForTimeout(500);

  await page.click('#menuBtn'); await page.waitForTimeout(300);
  await page.click('[data-m="lang:he"]'); await page.waitForTimeout(800);
  ok('and choosing Hebrew puts it all back',
     await page.evaluate(() => document.documentElement.dir) === 'rtl'
       && (await page.evaluate(() => document.getElementById('doc').innerText)).includes('תושבים'));

  /* 13. the constraint layers: fetched on demand, stored apart, verified.
     The files are in the repository, so the test server already serves them
     from the same origin and no CORS fixture is needed — which is also the
     reason they are in the repository. A GitHub release download sends no
     Access-Control-Allow-Origin header at all, checked rather than assumed,
     so a fetch() from the app would be blocked wherever it runs. */
  await page.evaluate(() => {
    D.layers.base = '/data/layers/';
    D.layers.fallback = null;
  });
  await page.evaluate(() => { S.lang = 'he'; applyLang(); });
  ok('the layer manifest ships with the app',
     await page.evaluate(() => !!(D.layers && D.layers.layers && D.layers.layers.ren)));

  /* The projection is Leaflet's own formula written out, because projecting a
     million and a half points through map.project() on every frame is the
     other way to lock a phone. Written out means it can drift, so it is held
     to the thing it copies rather than trusted. */
  const proj = await page.evaluate(() => {
    let worst = 0;
    [[41.15, -8.61], [41.44, -8.29], [40.93, -8.65], [41.35, -7.90], [0, 0]]
      .forEach(([lat, lng]) => {
        const p = map.project(L.latLng(lat, lng), CONS_REF_Z);
        worst = Math.max(worst, Math.abs(p.x - consProjX(lng)), Math.abs(p.y - consProjY(lat)));
      });
    return worst;
  });
  ok('the inlined projection is Leaflet\'s own, to a thousandth of a pixel',
     proj < 0.001, 'worst ' + proj);

  /* Porto is the one municipality DGT publishes neither layer for. Picking a
     municipality that happens to have them, rather than assuming a number,
     is what keeps this from passing on the wrong place. */
  const munWith = await page.evaluate(() => {
    const code = Object.keys(D.layers.layers.ren.municipalities)[0];
    const m = D.mun.find(x => x.dicofre === code);
    return m ? m.num : null;
  });
  ok('and names a municipality it has REN for', munWith !== null);
  const munWithCode = await page.evaluate(() =>
    Object.keys(D.layers.layers.ren.municipalities)[0]);
  await page.evaluate(c => { window.munWithCode = c; }, munWithCode);
  await page.evaluate(n => { window.munWithNum = n; }, munWith);
  // saved for real, not just set in memory: the point of the last assertion
  // below is that the layer code never reaches localStorage, and a point that
  // was never written there would have made it pass on nothing.
  await page.evaluate(() => {
    D.mine = [{ id: 'lay1', name: 'נקודה שלי', desc: '',
                ll: [41.2, -8.5], at: '2026-09-13' }];
    saveMine();
  });
  await page.evaluate(n => goMun(n), munWith);
  await page.waitForTimeout(700);
  const layRow = await page.$('#doc [data-layer]');
  ok('the municipality page offers them', !!layRow);
  const layText = await page.evaluate(() =>
    document.querySelector('#doc [data-layer]').innerText);
  ok('and states the size, the reference year and the law before any download',
     /MB/.test(layText) && /20\d\d/.test(layText), JSON.stringify(layText.slice(0, 70)));

  await page.evaluate(() => document.querySelector('#doc [data-layer]').click());
  await page.waitForTimeout(350);
  ok('one tap only arms it — this spends somebody\'s mobile data',
     await page.evaluate(() => !!layerArmed
       && Object.keys(D.layerHave || {}).length === 0));

  const layId = await page.evaluate(() =>
    document.querySelector('#doc [data-layer]').dataset.layer);
  await page.evaluate(() => document.querySelector('#doc [data-layer]').click());
  await page.waitForFunction(() => Object.keys(D.layerHave || {}).length > 0,
                             null, { timeout: 120000 });
  ok('the second tap downloads that one municipality',
     await page.evaluate(() => Object.keys(D.layerHave || {}).length === 1));
  /* And it does NOT draw. The drawing is the district's switch, because a
     constraint map that stops at a municipal line says "you may build here"
     about ground nobody looked at. */
  ok('and does not draw it on its own — the view is the district\'s',
     await page.evaluate(() => S.cons === false && consLayer === null));
  const stored = await page.evaluate(async k => {
    const r = await getLayerRec(k);
    return r ? { n: r.bytes.length, sha: r.sha256 } : null;
  }, layId);
  const promised = await page.evaluate(i => {
    const [k, c] = i.split(':');
    const e = layerEntry(k, c);
    return { n: e.bytes, sha: e.sha256 };
  }, layId);
  ok('what was stored is byte for byte what the manifest promised',
     stored && stored.n === promised.n && stored.sha === promised.sha);
  ok('and it decompresses to real polygons',
     await page.evaluate(async i => {
       const [k, c] = i.split(':');
       const g = await layerGeoJSON(k, c);
       return !!(g && g.features && g.features.length);
     }, layId));

  /* A truncated or tampered file that gets stored draws half a map without
     saying so, and the half that is missing looks exactly like ground with no
     constraint on it. */
  const refused = await page.evaluate(async () => {
    const code = Object.keys(D.layers.layers.ren.municipalities)[1];
    const e = layerEntry('ren', code);
    const real = e.sha256;
    e.sha256 = '0'.repeat(64);
    let m = '';
    try { await fetchLayer('ren', code, () => {}, undefined); m = 'NO ERROR'; }
    catch (err) { m = String(err.message || err); }
    e.sha256 = real;
    return { m, stored: !!(await getLayerRec('ren:' + code)) };
  });
  ok('a file whose digest does not match is refused', /sha256/.test(refused.m),
     refused.m.slice(0, 60));
  ok('and nothing at all is stored when it is refused', refused.stored === false);

  /* 13b. THE CONSTRAINTS PAGE — one switch in the menu, under שכבות, and what
     it opens is a screen of its own rather than a card among the others. */
  await page.evaluate(() => openMenu(true));
  await page.waitForTimeout(300);
  const mrows = await page.$$eval('#menuIn [data-m]', els => els.map(e => e.dataset.m));
  ok('the menu carries one row for the constraints', mrows.indexOf('cons') >= 0,
     JSON.stringify(mrows.slice(mrows.indexOf('tiles'), mrows.indexOf('tiles') + 5)));
  ok('and it sits under שכבות, above the boundaries row',
     mrows.indexOf('cons') === mrows.indexOf('glass') + 1
       && mrows.indexOf('cons') === mrows.indexOf('borders') - 1);
  const consLabel = await page.evaluate(() =>
    document.querySelector('#menuIn [data-m="cons"]').innerText);
  ok('the row says what is still to download before it is pressed',
     /MB/.test(consLabel), JSON.stringify(consLabel));

  /* One municipality is already here; the page has to buy the remaining 32 and
     nothing more. */
  const before = await page.evaluate(() => ({
    missing: consMissing().length, have: Object.keys(D.layerHave || {}).length,
    all: consEntries().length,
  }));
  ok('the district needs 33 layers and 1 of them is already paid for',
     before.all === 33 && before.have === 1 && before.missing === 32,
     JSON.stringify(before));

  /* Slow the files down so the loading state is a state and not a flicker. */
  await page.route('**/data/layers/*.gz', async r => {
    await new Promise(x => setTimeout(x, 40)); r.continue();
  });
  await page.evaluate(() => { S.tiles = true; tileLayer.addTo(map); S.muncol = true; });
  page.evaluate(() => { document.querySelector('#menuIn [data-m="cons"]').click(); });
  await page.waitForFunction(() => S.cons === true, null, { timeout: 20000 });
  await page.waitForTimeout(500);

  ok('one tap opens the page — no second tap to arm, the page is the asking',
     await page.evaluate(() => S.cons === true && consPhase !== 'off'));
  ok('and the menu closes behind it', await page.evaluate(() => S.menu === false));
  const loadTxt = await page.evaluate(() => document.getElementById('doc').innerText);
  ok('the text half carries the page title', /מגבלות בנייה/.test(loadTxt));
  ok('and says a download is running, with a percentage',
     /מוריד/.test(loadTxt) && /%/.test(loadTxt), JSON.stringify(loadTxt.slice(0, 120)));
  ok('and there is a real progress bar behind the number',
     await page.evaluate(() => {
       const b = document.querySelector('.cons-prog i');
       return !!b && parseFloat(b.style.width) >= 0;
     }));
  ok('and a way to stop it', await page.evaluate(() =>
    !!document.querySelector('[data-cons="cancel"]')));
  /* The visual half is the district's 18 municipalities, and nothing else:
     no street background under a page about three flat colour classes. */
  ok('the street background is off by default on this page',
     await page.evaluate(() => S.tiles === false));
  ok('and so is the level\'s own colour fill',
     await page.evaluate(() => S.muncol === false));
  ok('while the municipality boundaries are on and drawn',
     await page.evaluate(() => S.lnMun === true && !!LG.mun));
  ok('nothing is drawn as a constraint yet — the data has not arrived',
     await page.evaluate(() => consPhase !== 'ready' && consVertices() < 1556351));

  await page.waitForFunction(() => consPhase === 'ready', null, { timeout: 600000 });
  await page.waitForTimeout(600);
  ok('when it finishes the whole district is in memory, not a subset',
     await page.evaluate(() => consVertices()) === 1556351,
     String(await page.evaluate(() => consVertices())));
  ok('and it is drawn', await page.evaluate(() =>
    !!consLayer && !!consLayer._cv && consLayer._cv.width > 0));

  /* The colour index, one line above the title, in the order asked for:
     agricultural, ecological, both. The swatches are the same hex the map
     paints — read from the same table, so the legend cannot drift. */
  const ckey = await page.$$eval('.cons-key .cons-k', els => els.map(e => ({
    t: e.innerText.replace(/\s+/g, ' ').trim(),
    c: getComputedStyle(e).backgroundColor,
    words: e.querySelectorAll('i').length,
  })));
  ok('a three-colour index sits above the title', ckey.length === 3,
     JSON.stringify(ckey));
  ok('in the order asked for: agricultural, ecological, both',
     /חקלאית/.test(ckey[0].t) && /אקולוגית/.test(ckey[1].t) && /משותפת/.test(ckey[2].t),
     JSON.stringify(ckey.map(k => k.t)));
  ok('each plate carries its own name, stacked on its own colour',
     ckey.every(k => k.words === 2));
  const asRgb = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')';
  ok('and each plate IS the colour the map paints',
     ckey[0].c === asRgb('#8a5a2b') && ckey[1].c === asRgb('#1f7a4d')
       && ckey[2].c === asRgb('#556a3c'),
     JSON.stringify(ckey.map(k => k.c)));
  /* The third colour is not chosen, it is the average of the other two. A
     legend that names it "both" has to be able to say so. */
  ok('and the khaki is literally the brown and the green mixed',
     await page.evaluate(() => CONS_RGB.both.every((v, i) =>
       Math.abs(v - (CONS_RGB.ran[i] + CONS_RGB.ren[i]) / 2) < 1e-9)));
  /* White on all three, and all three owe 4.5:1 for text this size. */
  const consLum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratios = await page.evaluate(() => CONS_ORDER.map(k => CONS_RGB[k]));
  ok('and white text on each of them clears 4.5:1',
     ratios.every(c => 1.05 / (consLum(c) + .05) >= 4.5),
     JSON.stringify(ratios.map(c => +(1.05 / (consLum(c) + .05)).toFixed(2))));
  ok('the index is ABOVE the title, not under it',
     await page.evaluate(() => {
       const k = document.querySelector('.cons-key'), h = document.querySelector('#consCard h1');
       return !!k && !!h && k.getBoundingClientRect().bottom <= h.getBoundingClientRect().top + 1;
     }));

  /* Level 1: the 18 municipalities, and nothing about population or housing. */
  const l1 = await page.evaluate(() => document.getElementById('doc').innerText);
  const l1rows = await page.$$eval('#doc [data-mun]', els => els.length);
  ok('level 1 lists all 18 municipalities under the title', l1rows === 18, String(l1rows));
  ok('and the rest of the municipality data is not on this page',
     !/תושבים/.test(l1) && !/בנייני מגורים/.test(l1) && !/גיל חציוני/.test(l1),
     JSON.stringify(l1.slice(0, 100)));

  /* Level 2, from the list. */
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#doc [data-mun]')];
    const want = rows.find(r => r.dataset.mun === String(window.munWithNum));
    (want || rows[0]).click();
  });
  await page.waitForTimeout(900);
  ok('tapping a municipality name opens it', await page.evaluate(() => S.level === 'mun'));
  const l2 = await page.evaluate(() => document.getElementById('doc').innerText);
  ok('and the page is still the constraints page', /מגבלה|עתודת|REN/.test(l2));
  const crows = await page.$$eval('#doc .crow', els => els.map(e => e.innerText.replace(/\n/g, ' ')));
  ok('with the four rows: each layer alone, the overlap, and the total',
     crows.length === 4 && /RAN/.test(crows[0]) && /REN/.test(crows[1])
       && /בשתי/.test(crows[2]) && /בקיזוז/.test(crows[3]),
     JSON.stringify(crows));
  ok('each row carries an area in hectares beside its share',
     crows.slice(0, 3).every(r => /הקטר/.test(r)) && /%/.test(crows[3]));
  /* The number that must never be the sum. */
  const sums = await page.evaluate(() => {
    const c = D.munByNum.get(S.mun).cons;
    return { ran: c.ran_pct, ren: c.ren_pct, both: c.both_pct, either: c.either_pct };
  });
  ok('and the total is the union, not the sum — it is smaller by the overlap',
     Math.abs(sums.ran + sums.ren - sums.both - sums.either) <= 0.15
       && sums.both > 0 && sums.either < sums.ran + sums.ren,
     JSON.stringify(sums));
  ok('every number on the page opens its own source record',
     await page.$$eval('#doc .crow[data-src]', els => els.length) === 4);
  ok('the parishes of that municipality are listed under it',
     await page.$$eval('#doc [data-fre]', els => els.length) > 0);
  /* The bar is what a share is read on, so it gets the card's whole width —
     a 74px stub beside a line of text could only be read against the other
     stubs, never against the whole it is a share of. */
  const bar = await page.evaluate(() => {
    const r = document.querySelector('#doc .cons-row');
    if (!r) return null;
    const b = r.querySelector('.cons-bar'), v = r.querySelector('.cons-val');
    const card = r.closest('.card');
    return b && v ? {
      w: b.getBoundingClientRect().width, card: card.getBoundingClientRect().width,
      pad: parseFloat(getComputedStyle(card).paddingInlineStart),
      h: b.getBoundingClientRect().height,
      radius: parseFloat(getComputedStyle(b).borderTopLeftRadius),
      val: v.innerText.replace(/\s+/g, ' ').trim(),
      align: getComputedStyle(v).textAlign,
      segs: [...b.querySelectorAll('i')].map(i => i.style.background),
    } : null;
  });
  ok('the bar runs the card\'s width, less its side padding',
     bar && Math.abs(bar.w - (bar.card - 2 * bar.pad)) <= 1.5,
     JSON.stringify(bar && { w: bar.w, card: bar.card, pad: bar.pad }));
  ok('it is half again as tall as it was, with the corners eased',
     bar && Math.abs(bar.h - 14) <= 1 && bar.radius >= 3, JSON.stringify(bar && [bar.h, bar.radius]));
  ok('and the figure under it is in km², at the end of the line',
     bar && /קמ״ר/.test(bar.val) && /%/.test(bar.val) && bar.align === 'end',
     JSON.stringify(bar && bar.val));

  /* Level 3, and the map's own click path — tapping the polygon does what
     tapping the name does, because the map underneath is the app's map. */
  await page.evaluate(() => document.querySelector('#doc [data-fre]').click());
  await page.waitForTimeout(900);
  ok('tapping a parish opens it, and the page follows to level 3',
     await page.evaluate(() => S.level === 'zone'));
  ok('with its own four rows and its municipality under them',
     await page.$$eval('#doc .crow', els => els.length) === 8,
     String(await page.$$eval('#doc .crow', els => els.length)));
  /* A parish carries a letter on every locality and up to 341 landmark dots.
     On a page about where the ground is restricted they are a different
     question drawn on top of this one. */
  ok('level 3 on this page carries no locality letters and no landmark dots',
     await page.evaluate(() => (LG.letters ? LG.letters.getLayers().length : 0) === 0
       && (LG.pois ? LG.pois.getLayers().length : 0) === 0));
  /* The trail names where you came FROM. The page below it already carries the
     name of the unit being looked at, in a heading, in full — the trail
     repeating it in an ellipsis spent both its lines saying one thing. */
  const tr3 = await page.$eval('#crumb', e => e.innerText.split('\n').filter(x => x.trim()));
  const here3 = await page.evaluate(() => nm(D.freByKey.get(S.zone)));
  const up3 = await page.evaluate(() => nm(D.munByNum.get(S.mun)));
  ok('at level 3 the trail names the district and the municipality above it',
     tr3.length === 2 && /פורטו/.test(tr3[0]) && tr3[1].trim() === up3, JSON.stringify(tr3));
  ok('and does not repeat the parish the page is already titled with',
     !tr3.some(x => x.trim() === here3), JSON.stringify([tr3, here3]));
  ok('both of its lines are a way back', await page.$$eval('#crumb button', e => e.length) === 2);
  ok('and it is still centred on the home button here',
     Math.abs(await crumbMid()) <= 1, `${await crumbMid()}px off centre`);

  /* Home is the way out of a mode, not a way up inside one. From level 3 of
     this page it used to climb to the page's own level 1 and stop there. */
  await page.evaluate(() => goHome());
  await page.waitForTimeout(900);
  ok('home from level 3 of the page returns to the base display',
     await page.evaluate(() => S.cons === false && S.level === 'district'
       && !/מגבלה חקלאית/.test(document.getElementById('doc').innerText)));
  ok('and the level fill it had taken away is back',
     await page.evaluate(() => S.muncol === true));
  /* And from level 1, where it used to do nothing at all. */
  await page.evaluate(() => openMenu(true));
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('#menuIn [data-m="cons"]').click());
  await page.waitForFunction(() => consPhase === 'ready', null, { timeout: 120000 });
  await page.waitForTimeout(600);
  ok('the page reopens with no second download', await page.evaluate(() =>
    S.cons === true && S.level === 'district' && consMissing().length === 0));
  ok('and at level 1 the trail names the district, with nothing above it',
     (await page.$eval('#crumb', e => e.innerText)).trim().indexOf('\n') < 0);
  await page.evaluate(() => goHome());
  await page.waitForTimeout(800);
  ok('home from level 1 of the page leaves it too',
     await page.evaluate(() => S.cons === false && S.level === 'district'));
  await page.evaluate(() => openMenu(true));
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('#menuIn [data-m="cons"]').click());
  await page.waitForFunction(() => consPhase === 'ready', null, { timeout: 120000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => goDistrict());
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    LG.mun.eachLayer(l => { if (l.feature && l.feature.properties.num === window.munWithNum) l.fire('click'); });
  });
  await page.waitForTimeout(900);
  ok('and tapping the municipality ON THE MAP opens the same page',
     await page.evaluate(() => S.level === 'mun' && S.cons === true
       && document.querySelectorAll('#doc .crow').length === 4));

  /* A municipality DGT publishes neither reserve for says so, and does not say
     zero. Porto is the one. */
  await page.evaluate(() => goMun((D.mun.find(m => m.dicofre === '1312') || {}).num));
  await page.waitForTimeout(800);
  const porto = await page.evaluate(() => document.getElementById('doc').innerText);
  ok('Porto has no delimitation, and the page says so rather than showing 0%',
     /אין נתון/.test(porto) && !/\b0\.0%/.test(porto), JSON.stringify(porto.slice(0, 160)));
  ok('and it names why nothing is shown, without inventing a reason',
     /אינו מפרסם/.test(porto) && /הסיבה אינה מתפרסמת/.test(porto));

  /* Off is off. It is not a refund. */
  await page.evaluate(() => openMenu(true));
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('#menuIn [data-m="cons"]').click());
  await page.waitForFunction(() => S.cons === false, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  ok('switching it off takes the page and the drawing away',
     await page.evaluate(() => consLayer === null && !/מגבלה חקלאית/.test(
       document.getElementById('doc').innerText)));
  ok('and deletes nothing at all — all 33 layers are still on the device',
     await page.evaluate(() => Object.keys(D.layerHave || {}).length === 33));
  ok('the level fill comes back exactly as it was',
     await page.evaluate(() => S.muncol === true && S.tiles === true));
  ok('so switching it back on needs no download and no unpacking',
     await page.evaluate(() => consMissing().length === 0 && consVertices() === 1556351));

  /* 13d starts from one municipality rather than the district: the export
     test is about what a file carries, not about how much of it there is. */
  await page.evaluate(async () => {
    for (const k of (await allLayerKeys()) || []) await delLayerRec(k);
    await refreshLayerHave();
    Object.keys(consData).forEach(k => consData[k].clear());
    S.cons = false; applyCons();
  });
  await page.evaluate(c => tapLayerFetch('ren', c), munWithCode);
  await page.waitForFunction(() => Object.keys(D.layerHave || {}).length === 1,
                             null, { timeout: 60000 });

  /* 13d. export and import carry all three things this phone holds that the
     app did not ship with: the points, the photos on them, and the constraint
     layers that were downloaded. Before this, an export carried the points
     alone — a reinstall lost every picture and every layer had to be paid for
     again over mobile data, and nothing said so. */
  await page.evaluate(async j => {
    D.mine = [{ id: 'exp1', name: 'נקודה עם תמונה', desc: '', ll: [41.2, -8.5],
                at: '2026-09-13', photo: { w: 2, h: 2, bytes: 64, from: 'map' } }];
    saveMine();
    const bin = atob(j);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    await putPhoto('exp1', new Blob([u8], { type: 'image/jpeg' }));
  }, TINY_JPEG);

  const packed = await page.evaluate(async () => {
    const pay = await exportPayload();
    return {
      points: pay.points.length,
      photos: pay.photos.length,
      layers: pay.layers.map(l => l.kind + ':' + l.code),
      photoB64: pay.photos[0] && pay.photos[0].b64.length,
      bytes: JSON.stringify(pay).length,
    };
  });
  ok('the export carries the point', packed.points === 1);
  ok('and the photo bytes with it, not only the record that there is one',
     packed.photos === 1 && packed.photoB64 > 0);
  ok('and the constraint layer that was downloaded',
     packed.layers.length === 1 && packed.layers[0] === 'ren:' + munWithCode,
     JSON.stringify(packed.layers));
  /* A layer is megabytes. This is why the export is a file: an Android
     clipboard truncates a string that size instead of refusing it. */
  ok('which is why it is a file and not the clipboard', packed.bytes > 200000,
     String(packed.bytes));

  const back = await page.evaluate(async () => {
    const pay = await exportPayload();
    const text = JSON.stringify(pay);          // through the same text a file holds
    // wipe everything the export was made from
    D.mine = []; saveMine();
    await delPhoto('exp1');
    for (const k of (await allLayerKeys()) || []) await delLayerRec(k);
    await refreshLayerHave();
    const emptied = {
      points: D.mine.length,
      photo: !!(await getPhoto('exp1')),
      layers: Object.keys(D.layerHave || {}).length,
    };
    const read = JSON.parse(text);
    await importAll(read.points, read);
    const rec = await getLayerRec('ren:' + munWithCode);
    const e = layerEntry('ren', munWithCode);
    return {
      emptied: emptied,
      points: D.mine.length,
      name: (D.mine[0] || {}).name,
      photo: !!(await getPhoto('exp1')),
      hasPhotoRec: !!(D.mine[0] || {}).photo,
      layer: rec ? { n: rec.bytes.length, sha: rec.sha256 } : null,
      promised: { n: e.bytes, sha: e.sha256 },
    };
  });
  ok('the wipe really emptied all three', back.emptied.points === 0
     && back.emptied.photo === false && back.emptied.layers === 0,
     JSON.stringify(back.emptied));
  ok('importing brings the point back', back.points === 1 && back.name === 'נקודה עם תמונה');
  ok('and its photo, as bytes and not only as a claim',
     back.photo === true && back.hasPhotoRec === true);
  ok('and the constraint layer, byte for byte what the manifest promises',
     !!back.layer && back.layer.n === back.promised.n
       && back.layer.sha === back.promised.sha, JSON.stringify(back.layer));

  /* An imported boundary is a stranger's file. "Here you may not build" is not
     a thing to take on trust: the bytes are hashed and the hash has to equal
     what this app publishes, or the layer does not go in. */
  const tampered = await page.evaluate(async () => {
    const pay = await exportPayload();
    for (const k of (await allLayerKeys()) || []) await delLayerRec(k);
    await refreshLayerHave();
    const bad = JSON.parse(JSON.stringify(pay));
    // flip one base64 character: same length out, different bytes
    const b = bad.layers[0].b64;
    const at = Math.floor(b.length / 2);
    bad.layers[0].b64 = b.slice(0, at) + (b[at] === 'A' ? 'B' : 'A') + b.slice(at + 1);
    await importAll([], bad);
    return {
      stored: Object.keys(D.layerHave || {}).length,
      said: document.getElementById('msgs').innerText,
    };
  });
  ok('a tampered layer in an import file is refused', tampered.stored === 0);
  ok('and the message says it was, rather than passing in silence',
     /נדחת|נדחו/.test(tampered.said), JSON.stringify(tampered.said.slice(0, 90)));

  /* The panel says what the file will weigh before it is made, because the
     reader is the one paying for the storage. */
  await page.evaluate(() => { D.mine = []; saveMine(); });
  await page.evaluate(n => goMun(n), munWith);
  await page.waitForTimeout(400);
  await page.evaluate(() => openExport());
  await page.waitForFunction(() => /MB|אין/.test(
    document.getElementById('panelBody').innerText), null, { timeout: 15000 });
  const expText = await page.evaluate(() =>
    document.getElementById('panelBody').innerText);
  ok('the export panel counts all three before anything is written',
     /מקומות/.test(expText) && /תמונות/.test(expText) && /מגבלות בנייה/.test(expText),
     JSON.stringify(expText.slice(0, 120)));
  ok('and offers a file, not only the clipboard',
     await page.evaluate(() => !!document.getElementById('expFile')
       && !!document.getElementById('expClip')));
  await page.evaluate(() => closePanel());

  /* 13c. the stock's shape, and the labels that say what they divide by. */
  const houseTxt = await page.evaluate(() => {
    S.view = 'text'; applyView();
    return document.getElementById('doc').innerText;
  });
  ok('the housing card shows how many floors the buildings have',
     /קומה או שתיים/.test(houseTxt) && /שלוש קומות ומעלה/.test(houseTxt));
  ok('and what they were built to hold, and whether they are only homes',
     /נבנו לדירה או שתיים/.test(houseTxt) && /למגורים בלבד/.test(houseTxt));
  /* The label said "of them, deep repair" while showing a share of ALL
     buildings — 4.7% where "of them" means 11.9%. A reader multiplying the two
     rows got a third number, wrong again. */
  ok('deep repair no longer claims to be a share of those needing repair',
     !/מהם תיקון עמוק/.test(houseTxt) && /תיקון עמוק/.test(houseTxt));
  ok('and higher education says it counts children in the denominator',
     /מכלל התושבים/.test(houseTxt) || await page.evaluate(() =>
       /מכלל התושבים/.test(document.getElementById('doc').innerText)));

  /* Porto has neither layer, and the first build showed it two dead rows
     saying "no data" and nothing else — which reads as a feature that does not
     work rather than a municipality DGT does not publish. The reader who hit
     this could not tell the difference, and neither could the test, because
     nothing checked the empty case. */
  const portoNum = await page.evaluate(() =>
    (D.mun.find(m => m.dicofre === '1312') || {}).num);
  await page.evaluate(n => goMun(n), portoNum);
  await page.waitForTimeout(700);
  ok('a municipality with neither layer still shows the card', await page.evaluate(() =>
    !!document.getElementById('layerCard')));
  ok('and offers nothing to tap, because there is nothing to download',
     await page.evaluate(() => !document.querySelector('#doc [data-layer]')));
  const emptyText = await page.evaluate(() =>
    document.getElementById('layerCard').innerText);
  ok('but says how many municipalities DO have it, so it does not read as broken',
     /16/.test(emptyText) && /17/.test(emptyText), JSON.stringify(emptyText.slice(0, 120)));
  ok('and says plainly where to go instead',
     /עירייה אחרת/.test(emptyText), JSON.stringify(emptyText.slice(-140)));

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
