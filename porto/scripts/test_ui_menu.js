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
  /* No service worker for this run.  The app registers one, and it is right to:
     it serves the street background from its own cache and answers 504 for
     anything it cannot reach, which is what an offline phone needs.  It is also
     fatal to a browser check, because a request the worker handles never
     reaches page.route() — so the tiles this file answers below were answered
     for the first few and then quietly turned into 504s from inside the app.
     The app then dropped the background, correctly, and three checks that were
     never about the background went red.  The worker has no checks of its own
     in this file; blocking it leaves this file testing the interface. */
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 },  // a phone, portrait
                                         serviceWorkers: 'block' });
  const page = await ctx.newPage();
  /* Everything below reads the rendered page, and a page that threw still
     renders — it just renders the half that ran before the throw.  That is how
     a dead search survived nine releases here: runSearch() raised TypeError on
     every keystroke, #qres stayed empty, and no check was looking at #qres.  An
     uncaught error is now a failure in its own right, whoever else noticed. */
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e).split('\n')[0]));
  /* Answer the street background here rather than letting it reach the network.
     Three earlier cuts of this file got this wrong in two different directions.
     Letting the requests hang meant they did not fail inside the run, so the
     check on the failure path passed on a page where nothing had failed — a
     check that cannot fail is not a check.  Refusing them all, which came next,
     made the opposite problem: the app is right to drop a background it cannot
     load, so every later check that switched the background on and expected it
     to stay on was racing the app's own correctness, and which of them failed
     depended on how many refusals Leaflet had managed to fire by then.  Three
     checks in this file were red for that reason and none of them was about the
     background at all.
     So: a real, immediate, one-pixel answer, and no network.  The failure path
     gets the refusal it needs in the last block of the file, where nothing
     follows it. */
  const TILE_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
    + 'IQAAAABJRU5ErkJggg==', 'base64');
  const TILES = '**://tile.openstreetmap.org/**';
  await page.route(TILES, r => r.fulfill({ contentType: 'image/png', body: TILE_PNG,
                                headers: { 'access-control-allow-origin': '*' } }));
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
  ok('and the three line widths are the documented ones, with no district width left',
     await page.evaluate(() => LINE_W.mun === 2.4 && LINE_W.fre === 1.2
       && LINE_W.region === 3.2 && !('district' in LINE_W)),
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
    'tiles', 'glass', 'cons', 'regions', 'more', 'save', 'load', 'info', 'dev', 'terms'];
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
    'save': 'שמירת נתונים', 'load': 'ייבוא נתונים',
    'info': 'על האפליקציה', 'dev': 'מאחורי הקלעים', 'terms': 'תנאים והגבלות' };
  const labels = await page.$$eval('#menuIn [data-m]',
    els => Object.fromEntries(els.filter(e => e.querySelector('.mrow-l'))
      .map(e => [e.dataset.m, e.querySelector('.mrow-l').textContent])));
  const wrong = Object.entries(HE).filter(([k, v]) => labels[k] !== v);
  ok('every row reads what it was asked to read', wrong.length === 0,
     wrong.map(([k, v]) => `${k}: "${labels[k]}" ≠ "${v}"`).join(' | '));
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
  for (const k of ['cats', 'tiles', 'glass']) {
    const was = await flag(k);
    await page.click(`[data-m="${k}"]`);
    /* The background is the one row whose state is not the tap's to keep, and
       asking it to behave like the other three was asking it to be wrong.
       This run refuses every tile on purpose — the route at the top of the file
       — and the app answers a background that will not load by dropping it and
       saying so.  So the generic check below was reading `false` 350 ms after
       the tap and calling the app broken for having been right.  What is worth
       checking here is both halves: the tap turns it on, and the refusal turns
       it back off with a word to the reader. */
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

  /* THE REGIONS ARE A LAYER, NOT A LINE ON EVERY MAP.  2.0.0 drew the two
     NUTS III outlines at levels 1–2 with nothing to switch them off; that was
     a regression and this is what holds the fix.  Off by default, everywhere;
     אזורים in the menu opens a screen of their own. */
  const orange = () => page.evaluate(() => [...document.querySelectorAll('#map path')]
    .filter(el => (el.getAttribute('stroke') || '').toLowerCase() === '#e2761b').length);
  await page.evaluate(() => { if (S.regions) toggleRegions(); goDistrict(); });
  await page.waitForTimeout(700);
  ok('with the layer off there is no orange line at the district', await orange() === 0, String(await orange()));
  await page.evaluate(() => goMun(13)); await page.waitForTimeout(700);
  ok('nor at a municipality', await orange() === 0, String(await orange()));
  await page.evaluate(() => goDistrict()); await page.waitForTimeout(600);
  ok('and the district page no longer carries the regions paragraph', await page.$('#regionsDoc') === null);

  if (!(await page.$eval('#menu', e => !e.hidden))) { await page.click('#menuBtn'); await page.waitForTimeout(300); }
  ok('the menu carries an אזורים row, under שכבות', await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#menuIn [data-m]')].map(e => e.dataset.m);
    return rows.indexOf('regions') > rows.indexOf('tiles') && rows.indexOf('regions') > 0;
  }));
  await page.evaluate(() => { S.tiles = false; map.removeLayer(tileLayer); });
  await page.click('[data-m="regions"]');
  await page.waitForTimeout(900);
  ok('tapping it opens the regions screen and closes the menu',
     await page.evaluate(() => S.regions === true && S.menu === false));
  ok('and brings the street background back, because the regions are drawn on it',
     await page.evaluate(() => S.tiles === true && map.hasLayer(tileLayer)));
  const rg = await page.evaluate(() => ({
    lines: LG.rgLine ? LG.rgLine.getLayers().map(g => g.getLayers().length) : null,
    width: (document.querySelector('#map path[stroke="#e2761b"]') || { getAttribute: () => null }).getAttribute('stroke-width'),
    nums: LG.rgNums ? LG.rgNums.getLayers().map(m => m.getElement() && m.getElement().innerText.trim()) : null,
    level: S.level, mun: S.mun,
  }));
  ok('both regions are actually drawn — not an empty layer that draws nothing',
     rg.lines && rg.lines.length === 2 && rg.lines.every(n => n > 0), JSON.stringify(rg.lines));
  ok('the outline is the orange line at its documented width', rg.width === '3.2', String(rg.width));
  ok('and each region carries its key number at its centre',
     JSON.stringify(rg.nums) === JSON.stringify(['1', '2']), JSON.stringify(rg.nums));
  ok('opening the layer did not move the level', rg.level === 'district' && rg.mun === null, JSON.stringify(rg));
  const rtxt = await page.$eval('#doc', el => el.innerText);
  for (const need of ['אזורים', 'האזור המטרופוליטני של פורטו', 'טאמגה אה סוזה', 'NUTS III'])
    ok(`the reading half names ${need}`, rtxt.includes(need));
  ok('and it offers one row per region, each tappable',
     await page.$$eval('#doc [data-region]', e => e.length) === 2);
  ok('nothing is filled until a region is chosen', await page.evaluate(() => !LG.rgFill));

  /* tapping a row fills that region, and only that one */
  await page.click('#doc [data-region="1"]');
  await page.waitForTimeout(700);
  const sel1 = await page.evaluate(() => ({ sel: S.regionSel,
    fill: LG.rgFill ? LG.rgFill.getLayers().length : 0,
    op: LG.rgFill ? LG.rgFill.getLayers()[0].options.fillOpacity : null,
    colour: LG.rgFill ? LG.rgFill.getLayers()[0].options.fillColor : null,
    marked: document.querySelectorAll('#doc .region-row[aria-pressed="true"]').length }));
  ok('tapping a region in the list fills it orange at 40%',
     sel1.sel === 1 && sel1.op === 0.4 && sel1.colour === '#e2761b', JSON.stringify(sel1));
  ok('and it fills that region\'s municipalities and no others',
     sel1.fill === await page.evaluate(() => D.belts[1].nums.length), JSON.stringify(sel1.fill));
  ok('and exactly one row is marked', sel1.marked === 1, String(sel1.marked));

  /* tapping the other one on the map does the same, and marks its card */
  await page.evaluate(() => { let done = 0; LG.rgLine.getLayers()[0].eachLayer(l => { if (!done++) l.fire('click'); }); });
  await page.waitForTimeout(700);
  const sel2 = await page.evaluate(() => ({ sel: S.regionSel,
    fill: LG.rgFill ? LG.rgFill.getLayers().length : 0,
    which: (document.querySelector('#doc .region-row[aria-pressed="true"]') || { dataset: {} }).dataset.region }));
  ok('tapping a region on the map fills it and marks its card in the reading half',
     sel2.sel === 0 && sel2.which === '0'
       && sel2.fill === await page.evaluate(() => D.belts[0].nums.length), JSON.stringify(sel2));
  ok('tapping the same one again clears the choice',
     await page.evaluate(async () => { pickRegion(0, 'doc'); return S.regionSel === null && !LG.rgFill; }));

  /* and off again leaves nothing behind */
  await page.evaluate(() => { toggleRegions(); }); await page.waitForTimeout(800);
  ok('switching the layer off takes the orange with it', await orange() === 0, String(await orange()));
  ok('and gives the street background back exactly as it was',
     await page.evaluate(() => S.tiles === false && !map.hasLayer(tileLayer)));
  ok('and the level document is back', await page.evaluate(() =>
    S.regions === false && /מחוז פורטו/.test(document.getElementById('doc').innerText)));
  await page.evaluate(() => { S.tiles = true; tileLayer.addTo(map); goDistrict(); });
  await page.waitForTimeout(700);
  // the layer closed the menu behind it; the block below opens on a menu row
  if (!(await page.$eval('#menu', e => !e.hidden))) { await page.click('#menuBtn'); await page.waitForTimeout(300); }

  /* 6. day and night are a choice, not only the phone's setting */
  await page.click('[data-m="theme:dark"]');
  await page.waitForTimeout(500);
  ok('תצוגת לילה sets the theme', await page.evaluate(() => document.documentElement.dataset.theme) === 'dark');
  /* At night depth is colour, not shadow (Practical UI p. 122): the three
     surfaces step up in lightness and every shadow token is none.  Read off
     the computed styles, not the stylesheet, so the media query and the
     data-theme path are both what is measured. */
  const night = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
      .map(c => c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4)); return .2126 * r + .7152 * g + .0722 * b; };
    const v = k => cs.getPropertyValue(k).trim();
    return { bg: lum(v('--bg')), card: lum(v('--card')), overlay: lum(v('--overlay')),
             btn: getComputedStyle(document.querySelector('#menuBtn')).boxShadow,
             raised: v('--shadow-raised'), overlayShadow: v('--shadow-overlay') };
  });
  ok('at night the three surfaces step up base < raised < overlay',
     night.bg < night.card && night.card < night.overlay, JSON.stringify(night));
  ok('and nothing casts a shadow — the floating button included',
     night.btn === 'none' && night.raised === 'none' && night.overlayShadow === 'none', night.btn);
  ok('and the row marks itself', await flag('theme:dark') === 'true');
  ok('while תצוגת יום clears its mark', await flag('theme:light') === 'false');
  await page.click('[data-m="theme:light"]');
  await page.waitForTimeout(500);
  ok('תצוגת יום sets it back', await page.evaluate(() => document.documentElement.dataset.theme) === 'light');
  ok('and by day the floating button is raised by a shadow',
     await page.evaluate(() => getComputedStyle(document.querySelector('#menuBtn')).boxShadow) !== 'none');
  /* The type scale: eight sizes and two weights, and every line height a
     multiple of 4.  Measured on the rendered page, over everything in the
     reading half, so a size typed into a rule shows up as a size on screen. */
  const type = await page.evaluate(() => {
    const sizes = new Set(), weights = new Set(), lines = [];
    document.querySelectorAll('#doc *, .crumb *, #menu *').forEach(el => {
      if (!el.textContent.trim() || el.children.length) return;
      const cs = getComputedStyle(el);
      sizes.add(parseFloat(cs.fontSize)); weights.add(cs.fontWeight);
      const lh = parseFloat(cs.lineHeight);
      if (Number.isFinite(lh) && lh % 4) lines.push(el.className + ':' + cs.lineHeight);
    });
    const body = getComputedStyle(document.body);
    return { sizes: [...sizes].sort((a, b) => a - b), weights: [...weights].sort(), offGrid: lines.slice(0, 5),
             body: [body.fontSize, body.lineHeight] };
  });
  ok('every size on the page is one of the eight steps of the scale',
     type.sizes.every(s => [12, 14, 16, 18, 20, 24, 32, 40].includes(s)), JSON.stringify(type.sizes));
  ok('and only two weights are used, 400 and 700', type.weights.every(w => w === '400' || w === '700'), JSON.stringify(type.weights));
  ok('and every line height divides by 4', type.offGrid.length === 0, JSON.stringify(type.offGrid));
  ok('the body is 16 over 24', type.body[0] === '16px' && type.body[1] === '24px', JSON.stringify(type.body));
  ok('the theme survives a redraw of the map',
     await page.evaluate(() => document.querySelectorAll('#map path').length) > 0);

  /* 7. the rows that send you somewhere close the menu behind them */
  for (const [k, check, back] of [
    ['search', async () => !(await page.$eval('#panel', e => e.hidden)), '#panelClose'],
    ['load',   async () => (await page.$eval('#panelTitle', e => e.textContent)).includes('ייבוא'), '#panelClose'],
    ['more',   async () => (await page.$eval('#panelTitle', e => e.textContent)).includes('שכבות'), '#panelClose'],
    ['info',   async () => !(await page.$eval('#infoDrawer', e => e.hidden)) && (await page.$eval('#infoTitle', e => e.textContent)) === 'על האפליקציה', '#infoClose'],
    ['dev',    async () => !(await page.$eval('#infoDrawer', e => e.hidden)) && (await page.$eval('#infoTitle', e => e.textContent)) === 'מאחורי הקלעים', '#infoClose'],
    ['terms',  async () => !(await page.$eval('#infoDrawer', e => e.hidden)) && (await page.$eval('#infoTitle', e => e.textContent)) === 'תנאים והגבלות', '#infoClose'],
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
  const modeBtn = await box(page, '[data-dense]');
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
     (await page.$eval('[data-dense]', e => e.textContent)).trim() === 'רשימה');
  ok('expanded: the photo is under the text, not beside it',
     await page.$('.wp .wp-line') === null && await page.$('.wp .ph-fig') !== null);
  await page.click('[data-dense]');
  await page.waitForTimeout(500);
  ok('one tap turns the label to מורחב',
     (await page.$eval('[data-dense]', e => e.textContent)).trim() === 'מורחב');
  ok('and the card becomes a line with a thumbnail beside the text',
     await page.$('.wp .wp-line') !== null && await page.$('.wp .ph-thumb') !== null);
  const txt = await box(page, '.wp .wp-txt');
  const thumb = await box(page, '.wp .ph-thumb');
  ok('the thumbnail is on the left of the text', thumb.right <= txt.x + 1,
     `thumb right ${thumb.right.toFixed(1)}, text x ${txt.x.toFixed(1)}`);
  await page.click('[data-dense]');
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
  await page.setInputFiles('#photoIn', { name: 'a.jpg', mimeType: 'image/jpeg',
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
       // the district has no outline of its own any more: it is the outer
       // edge of the 18 municipalities, and fit is to that
       return map.getBounds().contains(L.geoJSON(D.bM).getBounds().pad(-0.02));
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

  /* Which boundaries are the subject, at each of the three levels.
     ARCHITECTURE.md carried this as open work for several versions — "at level
     3 all the parishes are still black, and ownFeature() needs a branch for
     zone".  Measured here on 2026-09-14 it was already false, and the branch
     would have been dead code: the narrowing happens a step earlier, in
     freHere, which builds the parish layer out of the one parish being looked
     at.  ownFeature() therefore only ever sees features that are its own and
     has nothing left to decide.

     Which is exactly why this is worth a test rather than a note.  The
     behaviour is correct by the shape of the layer, not by an explicit rule
     about colour, so widening freHere — one plausible edit away — would black
     out all 275 parishes with nothing anywhere saying that is wrong. */
  const drawnLines = () => page.evaluate(() => {
    const tally = g => {
      if (!LG[g]) return { n: 0, black: 0 };
      let n = 0, black = 0;
      LG[g].eachLayer(l => { n++; if (l.options.color === '#000000') black++; });
      return { n, black };
    };
    return { fre: tally('lnFre'), mun: tally('lnMun') };
  });

  const L1 = await drawnLines();
  ok('level 1 draws no parish outline at all — 275 over eighteen is noise',
     L1.fre.n === 0, JSON.stringify(L1.fre));
  ok('and every municipality there is the subject, so every one is black',
     L1.mun.n === 18 && L1.mun.black === 18, JSON.stringify(L1.mun));

  const munOfFirst = await page.evaluate(() => {
    const f = D.bF.features[0].properties;
    goMun(f.mun_num);
    return { num: f.mun_num,
             parishes: D.bF.features.filter(x => x.properties.mun_num === f.mun_num).length };
  });
  await page.waitForTimeout(700);
  const L2 = await drawnLines();
  ok('level 2 draws that municipality\'s own parishes and no others',
     L2.fre.n === munOfFirst.parishes, `${L2.fre.n} drawn, ${munOfFirst.parishes} in it`);
  ok('and all of them are black, because all of them belong to it',
     L2.fre.black === L2.fre.n, JSON.stringify(L2.fre));
  ok('while exactly one of the eighteen municipalities is black — the chosen one',
     L2.mun.n === 18 && L2.mun.black === 1, JSON.stringify(L2.mun));

  await page.evaluate(() => {
    const f = D.bF.features[0].properties;
    goZone(f.mun_num + '|' + f.name);
  });
  await page.waitForTimeout(700);
  const L3 = await drawnLines();
  ok('level 3 keeps the same municipality\'s parishes as the context around the one being looked at',
     L3.fre.n === munOfFirst.parishes, `${L3.fre.n} drawn, ${munOfFirst.parishes} in the municipality`);
  ok('and exactly one of them is black, because it is the subject',
     L3.fre.black === 1, JSON.stringify(L3.fre));
  ok('and no municipality is black there — the parish is the subject, not its municipality',
     L3.mun.black === 0, JSON.stringify(L3.mun));

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
  for (const pane of ['ln-mun']) {
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
     !(await strokesIn('ln-mun')).includes('#000000'));

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
       return n('ln-mun') <= 2;
     }),
     await page.evaluate(() => JSON.stringify(['ln-mun']
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

  /* Home is the level axis: it goes to the district and leaves the mode alone.
     The mode switcher is the way out, and that is what puts the background
     back as it was. */
  await page.click('#homeBtn');
  await page.waitForTimeout(900);
  ok('home keeps the comparison open — it is a level, not a mode', await page.evaluate(() => S.cmp) === true);
  ok('and comes back to the district', await page.evaluate(() => S.level) === 'district');
  await page.click('#modeBar [data-mode="overview"]');
  await page.waitForTimeout(700);
  ok('the סקירה tab closes the comparison', await page.evaluate(() => S.cmp) === false);
  ok('and gives the street background back exactly as it was',
     await page.evaluate(() => S.tiles) === tilesBefore,
     `${tilesBefore} → ${await page.evaluate(() => S.tiles)}`);
  ok('and the rivers back too, since they were on going in',
     await page.evaluate(() => S.water) === true);

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
  ok('and it sits under שכבות, between the stained glass and the regions',
     mrows.indexOf('cons') === mrows.indexOf('glass') + 1
       && mrows.indexOf('regions') === mrows.indexOf('cons') + 1
       && mrows.indexOf('more') === mrows.indexOf('regions') + 1, JSON.stringify(mrows.slice(mrows.indexOf('tiles'))));
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
  /* The page opens at the level the reader is on — so the test goes to the
     district first, and then checks that opening the page did not move it. */
  await page.evaluate(() => { goDistrict(); S.tiles = true; tileLayer.addTo(map); S.muncol = true; });
  await page.evaluate(() => openMenu(true));
  await page.waitForTimeout(250);
  page.evaluate(() => { document.querySelector('#menuIn [data-m="cons"]').click(); });
  await page.waitForFunction(() => S.cons === true, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  ok('opening the page does not move the level', await page.evaluate(() => S.level) === 'district');

  ok('one tap opens the page — no second tap to arm, the page is the asking',
     await page.evaluate(() => S.cons === true && consPhase !== 'off'));
  ok('and the menu closes behind it', await page.evaluate(() => S.menu === false));
  const loadTxt = await page.evaluate(() => document.getElementById('doc').innerText);
  ok('the text half carries the page title', /מגבלת בנייה/.test(loadTxt));
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
     await page.evaluate(() => !!LG.lnMun));
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
  /* What each plate is painted, and that it is a switch, is checked in 13e —
     where the page is open and the map is drawn to compare it against. */
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
  /* The bar is what a share is read on, so it gets the row's own line. */
  const bar = await page.evaluate(() => {
    const r = document.querySelector('#doc .cons-row:not(.no)');
    const b = r && r.querySelector('.cons-bar');
    return b ? { h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width,
      radius: parseFloat(getComputedStyle(b).borderTopLeftRadius) } : null;
  });
  ok('it is half again as tall as it was, with the corners eased',
     bar && Math.abs(bar.h - 14) <= 1 && bar.radius >= 3, JSON.stringify(bar));
  ok('and it takes the width the row has left', bar && bar.w > 200, JSON.stringify(bar));

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

  /* Home is a level, not a mode: from level 3 of this page it goes to the
     district and the page stays open there.  The סקירה tab is the way out,
     and it is what gives the level fill back. */
  await page.evaluate(() => goHome());
  await page.waitForTimeout(900);
  ok('home from level 3 of the page goes to the district and keeps the page',
     await page.evaluate(() => S.cons === true && S.level === 'district'
       && /מגבלת בנייה/.test(document.getElementById("doc").innerText)));
  await page.click('#modeBar [data-mode="overview"]');
  await page.waitForTimeout(800);
  ok('the סקירה tab leaves the page',
     await page.evaluate(() => S.cons === false
       && !/מגבלת בנייה/.test(document.getElementById("doc").innerText)));
  ok('and the level fill it had taken away is back',
     await page.evaluate(() => S.muncol === true));
  /* And back in from the tab, at level 1. */
  await page.click('#modeBar [data-mode="cons"]');
  await page.waitForFunction(() => consPhase === 'ready', null, { timeout: 120000 });
  await page.waitForTimeout(600);
  ok('the page reopens from the tab with no second download', await page.evaluate(() =>
    S.cons === true && S.level === 'district' && consMissing().length === 0));
  ok('and the tab row marks it as the mode in force',
     await page.$eval('#modeBar [data-mode="cons"]', e => e.getAttribute('aria-selected')) === 'true');
  ok('and at level 1 the trail names the district, with nothing above it',
     (await page.$eval('#crumb', e => e.innerText)).trim().indexOf('\n') < 0);
  await page.evaluate(() => goHome());
  await page.waitForTimeout(800);
  ok('home at level 1 of the page changes nothing — it is already home, and home is not a way out',
     await page.evaluate(() => S.cons === true && S.level === 'district'));
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

  /* 13e. THE KEY IS THREE SWITCHES, and the map is what they switch. */
  await page.evaluate(() => { if (!S.cons) { openMenu(true);
    document.querySelector('#menuIn [data-m="cons"]').click(); } });
  await page.waitForFunction(() => S.cons && consPhase === 'ready', null, { timeout: 120000 });
  await page.evaluate(() => goDistrict());
  await page.waitForTimeout(700);
  await page.evaluate(() => { S.consShow = { ran: true, ren: true, both: true };
    if (consLayer) consLayer.redraw(); redrawText(); });
  await page.waitForTimeout(500);
  const plates = await page.$$eval('.cons-key .cons-k', els => els.map(e => ({
    tag: e.tagName, k: e.dataset.conskey, on: e.getAttribute('aria-pressed'),
    t: e.innerText.trim(), bg: getComputedStyle(e).backgroundColor })));
  ok('the three plates are buttons, not labels',
     plates.length === 3 && plates.every(p => p.tag === 'BUTTON' && p.on === 'true'),
     JSON.stringify(plates));
  ok('and each is named by its class alone, without the word מגבלה',
     plates.map(p => p.t).join('|') === 'חקלאית|אקולוגית|משותפת',
     JSON.stringify(plates.map(p => p.t)));
  /* The plate is a sample of the map: the class at 40% over the map's ground,
     not the full-strength colour. A key painted brighter than the thing it
     indexes is a key the reader has to translate. */
  const plateWant = await page.evaluate(() =>
    CONS_ORDER.map(k => 'rgb(' + consPlate(k).join(', ') + ')'));
  ok('and each is painted the colour the map actually shows, not a brighter one',
     plates.map(p => p.bg).join('|') === plateWant.join('|'),
     JSON.stringify([plates.map(p => p.bg), plateWant]));
  ok('the overlap is purple', await page.evaluate(() => CONS_COLOUR.both) === '#8e4ea8');

  const painted = () => page.evaluate(() => {
    const cv = consLayer._cv, c = cv.getContext('2d');
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });
  const allOn = await painted();
  await page.evaluate(() => document.querySelector('.cons-k[data-conskey="ran"]').click());
  await page.waitForTimeout(700);
  ok('pressing one switches its class off', await page.evaluate(() => S.consShow.ran === false));
  const oneOff = await painted();
  ok('and the map stops painting it', oneOff < allOn && oneOff > 0,
     `${allOn} -> ${oneOff} painted pixels`);
  ok('and the bars drop its segment too',
     await page.evaluate(() => {
       const segs = document.querySelectorAll('#doc .cons-bar i');
       return ![...segs].some(i => i.style.background.replace(/\s/g, '')
         === 'rgb(' + CONS_RGB.ran.join(',') + ')');
     }));
  await page.evaluate(() => document.querySelector('.cons-k[data-conskey="ran"]').click());
  await page.waitForTimeout(700);
  ok('pressing it again brings it back', await painted() === allOn);

  /* Smallest share first, and the one municipality with no delimitation at the
     end — it has no share to be smallest of, and a zero at the head of the list
     would say "nothing is restricted here". */
  const order = await page.$$eval('#doc .cons-row', els => els.map(e => ({
    pct: (e.querySelector('.cons-pct') || {}).innerText || null,
    no: e.classList.contains('no') })));
  const nums = order.filter(o => o.pct).map(o => parseFloat(o.pct));
  ok('the list runs smallest share first', nums.length === 17
     && nums.every((v, i) => i === 0 || v >= nums[i - 1]), JSON.stringify(nums));
  ok('and the municipality with no delimitation is last',
     order.length === 18 && order[17].no === true && !order[17].pct);
  /* On the map it is hatched, not blank: blank ground reads as ground with
     nothing on it, which is the one thing it does not mean. */
  ok('and on the map it is hatched rather than left blank',
     await page.evaluate(() => {
       const n = (D.mun.find(m => m.dicofre === '1312') || {}).num;
       let f = null; LG.mun.eachLayer(l => { if (l.feature.properties.num === n) f = l.options.fillColor; });
       return f === 'url(#' + CMP_PAT + ')'
         && !!document.querySelector('#map .leaflet-overlay-pane svg #' + CMP_PAT);
     }));

  /* One line per unit: the bar and its own share, and nothing else. */
  const line = await page.evaluate(() => {
    const r = document.querySelector('#doc .cons-row:not(.no)');
    const l = r.querySelector('.cons-line');
    return { hasVal: !!r.querySelector('.cons-val'),
      text: l.innerText.replace(/\s+/g, ' ').trim(),
      barEnd: l.querySelector('.cons-bar').getBoundingClientRect().x,
      pctEnd: l.querySelector('.cons-pct').getBoundingClientRect().x };
  });
  ok('the row carries the share and nothing else beside the bar',
     /^\d+\.\d%$/.test(line.text.replace(/[\u200e\u200f]/g, '')) && !line.hasVal,
     JSON.stringify(line.text));
  ok('and the figure sits at the end of the line, past the bar',
     line.pctEnd < line.barEnd, JSON.stringify([line.pctEnd, line.barEnd]));

  /* 13f. and the comparison screen can compare the same four. */
  await page.evaluate(() => { if (S.cons) consOff(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => toggleCmp());
  await page.waitForTimeout(700);
  const cf = await page.evaluate(() => cmpFields().filter(f => f.g === 'מגבלות בנייה').map(f => f.k));
  ok('the comparison screen offers the four constraint fields',
     JSON.stringify(cf) === JSON.stringify(['either_pct', 'ran_pct', 'ren_pct', 'both_pct']),
     JSON.stringify(cf));
  await page.evaluate(() => { S.cmpField = 'either_pct'; drawCmp(); redrawText(); });
  await page.waitForTimeout(800);
  const cmpTxt = await page.evaluate(() => document.getElementById('doc').innerText);
  ok('and ranks the municipalities on one of them',
     /סך המגבלות/.test(cmpTxt) && /21\.3|68\.3/.test(cmpTxt),
     JSON.stringify(cmpTxt.slice(0, 120)));
  ok('with the one it has no figure for shown as missing, not as zero',
     await page.evaluate(() => cmpValue(D.mun.find(m => m.dicofre === '1312'), 'either_pct') === null));
  ok('and every one of them opens the same source record',
     await page.evaluate(() => cmpSrcKey('municipio', 'either_pct') === 'municipio.cons_pct'
       && cmpSrcKey('freguesia', 'ran_pct') === 'freguesia.cons_pct'));
  await page.evaluate(() => toggleCmp());
  await page.waitForTimeout(600);

  /* 13g. adding a place, by real taps, from the screen the reader starts on.
     Reported as broken on the phone and not reproducible here — so the whole
     flow is walked, both ways in, so that a regression in it cannot be silent
     again. */
  for (const way of ['map', 'photo']) {
    await page.evaluate(() => { D.mine = []; saveMine(); if (S.wp) toggleWp(); });
    await page.evaluate(() => { if (!S.wp) toggleWp(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('#doc [data-wpact="new"]').click());
    await page.waitForTimeout(500);
    await page.evaluate(w => document.querySelector(`#wpSheet [data-wpway="${w}"]`).click(), way);
    await page.waitForTimeout(700);
    if (way === 'map') {
      ok('placing from the map offers בחירה, clear of the screen edge',
         await page.evaluate(() => {
           const f = document.querySelector('#pickBar [data-wpact="fix"]');
           if (!f) return false;
           const r = f.getBoundingClientRect();
           return r.width > 0 && r.bottom <= window.innerHeight - 8;
         }));
      await page.evaluate(() => document.querySelector('#pickBar [data-wpact="fix"]').click());
    } else {
      const input = await page.$('#photoIn');
      ok('the photo way offers a real file input, outside the re-rendered sheet',
         !!input && await page.evaluate(() => !document.getElementById('photoIn').closest('#wpSheet')));
      await input.setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg',
                                  buffer: Buffer.from(TINY_JPEG, 'base64') });
    }
    await page.waitForTimeout(1400);
    const save = await page.$('#wpSheet [data-wpact="save"]');
    ok(`the ${way} way reaches a שמירה button`, !!save);
    if (save) await save.click();
    await page.waitForTimeout(900);
    ok(`and saving by the ${way} way adds the place`,
       await page.evaluate(() => D.mine.length) === 1,
       String(await page.evaluate(() => D.mine.length)));
    if (way === 'photo')
      ok('with the picture stored beside it',
         await page.evaluate(async () => {
           const b = await getPhoto(D.mine[0].id); return !!b && b.size > 0; }));
  }

  /* THE ONE THAT WAS ACTUALLY BROKEN ON THE PHONE.
     Android answers a file picker through the element the picker was opened
     from, and that answer arrives after the app has come back to the
     foreground. While it was away, anything that re-renders the sheet replaced
     that element — so the change event fired on a node nobody was listening to
     and choosing a photo did nothing at all: the picker closed and the reader
     was returned to the unchanged "new place" screen, with no fields and no
     save. The inputs live in index.html now and are never re-rendered.

     This is the reproduction, and it produced that exact screen before. */
  await page.evaluate(() => { D.mine = []; saveMine(); if (S.wp) toggleWp(); });
  await page.evaluate(() => { if (!S.wp) toggleWp(); });
  await page.waitForTimeout(500);
  ok('both file inputs live outside everything that gets re-rendered',
     await page.evaluate(() => {
       const ph = document.getElementById('photoIn'), dt = document.getElementById('dataIn');
       return !!ph && !!dt && !ph.closest('#wpSheet') && !ph.closest('#doc')
         && !ph.closest('#panelBody') && !dt.closest('#panelBody') && !dt.closest('#doc');
     }));
  await page.evaluate(() => document.querySelector('#doc [data-wpact="new"]').click());
  await page.waitForTimeout(500);
  await page.evaluate(() => pickWay('photo'));
  await page.waitForTimeout(400);
  const held = await page.$('#photoIn');
  // everything the app could redraw while the picker had the screen
  await page.evaluate(() => { renderWaypoints(); renderWpSheet(); redrawText(); });
  await page.waitForTimeout(300);
  ok('the input the picker was opened from survives a full re-render',
     await held.evaluate(e => document.contains(e)));
  await held.setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg',
                             buffer: Buffer.from(TINY_JPEG, 'base64') });
  await page.waitForTimeout(1500);
  ok('and the photo picked after it still opens the form',
     await page.$$eval('#wpSheet input[type=text], #wpSheet textarea', e => e.length) === 2
       && !!(await page.$('#wpSheet [data-wpact="save"]')),
     await page.$eval('#wpSheet', e => JSON.stringify(e.innerText.replace(/\s+/g, ' ').slice(0, 70))));
  await page.evaluate(() => document.querySelector('#wpSheet [data-wpact="save"]').click());
  await page.waitForTimeout(900);
  ok('and saving it keeps the picture',
     await page.evaluate(async () => {
       if (D.mine.length !== 1) return false;
       const b = await getPhoto(D.mine[0].id);
       return !!b && b.size > 0;
     }));
  /* The same file twice: an input that still holds it fires no change event,
     and the reader gets silence. */
  await page.evaluate(() => { D.mine = []; saveMine(); closeNewSheet(); });
  await page.evaluate(() => document.querySelector('#doc [data-wpact="new"]').click());
  await page.waitForTimeout(500);
  await page.evaluate(() => pickWay('photo'));
  await page.waitForTimeout(300);
  await (await page.$('#photoIn')).setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg',
                                                   buffer: Buffer.from(TINY_JPEG, 'base64') });
  await page.waitForTimeout(1500);
  ok('choosing the same file a second time still answers',
     await page.$$eval('#wpSheet input[type=text]', e => e.length) === 1);
  /* And when the picker answers with nothing, the page says so. On a phone the
     picker is another app and everything between choosing a photo and this
     input receiving it happens where the page cannot see it; a failure there
     used to leave the screen exactly as it was, which reads as an app that
     ignored the tap. */
  ok('the wrapper has a way to report what the picker did',
     await page.evaluate(() => typeof window.__portoPicker === 'function'));
  await page.evaluate(() => { hideNote(); window.__portoPicker('empty:no-uris'); });
  await page.waitForTimeout(300);
  ok('a picker that returns nothing is reported, not swallowed',
     await page.evaluate(() => /no-uris/.test(document.getElementById('msgs').innerText)
       && /לא החזיר/.test(document.getElementById('msgs').innerText)));
  await page.evaluate(() => { hideNote(); window.__portoPicker('cancelled:0'); });
  await page.waitForTimeout(300);
  /* A cancel used to say nothing, on the reasoning that the reader knows they
     cancelled. That reasoning cost two rounds of this bug: a picker that ate a
     photo and answered RESULT_CANCELED is INDISTINGUISHABLE from a cancel, so
     the one outcome that was kept quiet was the failure itself. It speaks now,
     briefly. */
  ok('and a cancel is named too, because a failure looks exactly like one',
     await page.evaluate(() => /לא נבחר קובץ/.test(document.getElementById('msgs').innerText)));
  /* Handed over and then lost between the wrapper and the input: the one case
     the page can name but not fix. */
  await page.evaluate(() => { hideNote(); window.__portoPicker('ok:1:content'); });
  await page.waitForTimeout(3400);
  ok('and a file handed over but never delivered names the layer that lost it',
     await page.evaluate(() => /לא הגיע לעמוד/.test(document.getElementById('msgs').innerText)));
  await page.evaluate(() => { hideNote(); window.__portoPicker('ok:1:content'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => pickerDone());
  await page.waitForTimeout(3400);
  ok('while a file that does arrive is never complained about',
     await page.evaluate(() => document.getElementById('msgs').innerText.trim() === ''));

  /* ---- 13c-bis. the picker that survives the page that opened it ----------
     On the phone the wrapper's answer can arrive at a page that no longer
     exists: Android destroys this activity while the system picker is in front,
     restores the screen the reader was on, and every object either side was
     holding is gone. That is why two correct fixes to two real bugs both left
     the symptom exactly where it was. The answer is now left on disk and the
     page COLLECTS it, so the page that asked and the page that acts do not have
     to be the same page. These tests stand in for the wrapper. */
  await page.evaluate(() => { D.mine = []; saveMine(); closeNewSheet(); hideNote(); });
  await page.waitForTimeout(300);
  const FAKE_BRIDGE = j => {
    window.__fake = { opened: [], answer: '' };
    window.PortoPick = {
      open: k => { window.__fake.opened.push(k); },
      take: () => { const a = window.__fake.answer; window.__fake.answer = ''; return a; },
      trail: () => '',
    };
    window.__fake.jpeg = 'data:image/jpeg;base64,' + j;
  };
  await page.evaluate(FAKE_BRIDGE, TINY_JPEG);
  await page.evaluate(() => { if (!S.wp) toggleWp(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('#doc [data-wpact="new"]').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => pickWay('photo'));
  await page.waitForTimeout(300);
  ok('with the wrapper present the photo way asks IT, not the file input',
     await page.evaluate(() => window.__fake.opened.join() === 'photo'));

  /* The case that was silent: nothing on this page asked for anything — as far
     as it knows it has only just loaded — and an answer is waiting. */
  await page.evaluate(() => { D.mine = []; saveMine(); closeNewSheet(); hideNote();
                              pickWaiting = null; });
  await page.evaluate(() => document.querySelector('#doc [data-wpact="new"]').click());
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.__fake.answer = JSON.stringify({ kind: 'photo', files: [
      { url: window.__fake.jpeg, name: 'IMG_1.jpg', type: 'image/jpeg', size: 64 }] });
    drainPick();
  });
  await page.waitForTimeout(1800);
  ok('an answer waiting for a page that never asked is still collected',
     await page.evaluate(() => D.mine.length === 1 || !!mineEditing));
  ok('and it opens the form, which is the whole thing that used to not happen',
     await page.$$eval('#wpSheet input[type=text]', e => e.length) === 1);
  await page.evaluate(() => { const b = document.querySelector('#wpSheet [data-wpact="save"]');
                              if (b) b.click(); });
  await page.waitForTimeout(900);
  ok('and the photo that came through the wrapper is really on the point',
     await page.evaluate(async () => {
       if (!D.mine.length) return false;
       const b = await getPhoto(D.mine[D.mine.length - 1].id);
       return !!b && b.size > 0;
     }));

  /* And it reopens wherever it left off, which need not be this screen: a
     photo that quietly becomes a point nobody is looking at is the same
     failure in different clothes. */
  await page.evaluate(() => { D.mine = []; saveMine(); closeNewSheet(); hideNote();
                              pickWaiting = null; if (S.wp) toggleWp(); });
  await page.waitForTimeout(500);
  ok('and the places screen really is shut before the answer arrives',
     await page.evaluate(() => S.wp === false));
  await page.evaluate(() => {
    window.__fake.answer = JSON.stringify({ kind: 'photo', files: [
      { url: window.__fake.jpeg, name: 'IMG_2.jpg', type: 'image/jpeg', size: 64 }] });
    drainPick();
  });
  await page.waitForTimeout(1800);
  ok('a photo collected on another screen brings its own screen with it',
     await page.evaluate(() => S.wp === true)
     && await page.$$eval('#wpSheet input[type=text]', e => e.length) === 1);
  await page.evaluate(() => { closeNewSheet(); D.mine = []; saveMine(); hideNote(); });
  await page.waitForTimeout(300);

  /* Every other outcome is named. None of them may be silence. */
  const says = async (answer, re) => {
    await page.evaluate(a => { hideNote(); window.__fake.answer = a; drainPick(); }, answer);
    await page.waitForTimeout(400);
    return page.evaluate(r => new RegExp(r).test(document.getElementById('msgs').innerText), re);
  };
  ok('a picker that never came back is named, not waited on forever',
     await says('lost:photo', 'סוגר את האפליקציה'));
  ok('a picker that answered with no file is named',
     await says('empty:no-uris', 'בלי קובץ'));
  ok('and so is a wrapper that could not open a picker at all',
     await says('err:no-chooser', 'נכשלה'));
  ok('a cancel through the wrapper says so too',
     await says('cancelled:0', 'לא נבחר קובץ'));
  ok('and an answer whose bytes cannot be fetched does not fail in silence',
     await page.evaluate(async () => {
       hideNote();
       window.__fake.answer = JSON.stringify({ kind: 'photo', files: [
         { url: '/__picked/gone.jpg', name: 'g.jpg', type: 'image/jpeg', size: 1 }] });
       drainPick();
       await new Promise(r => setTimeout(r, 900));
       return document.getElementById('msgs').innerText.trim() !== '';
     }));
  await page.evaluate(() => { delete window.PortoPick; delete window.__fake; hideNote(); });

  await page.evaluate(() => { D.mine = []; saveMine(); closeNewSheet(); if (S.wp) toggleWp(); });
  await page.waitForTimeout(400);

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

  /* ---- 14. the two searches, both of which were dead --------------------
     One root cause, found on 2026-09-14 while covering the two new-place ways
     that had never been exercised: `const t = term.trim().toLowerCase()`, in
     both runSearch() and placeHits(), shadowed the translation function t()
     that 1.32.0 introduced.  Every t('עירייה') in those two bodies was then a
     call on a string, and the app has shipped with both searches dead since.

     The two failed differently, and the difference is why it lasted.  The main
     search threw before rendering anything — the throw is inside the "two
     letters or more" guard, so even that line never appeared.  The address way
     threw only once a query MATCHED something, because the throw is in the
     branch that builds a result row; a search with no hits returned cleanly.
     The path that worked was the empty one, which is the path a quick try
     takes. */
  await page.evaluate(() => { closeNewSheet(); if (S.wp) toggleWp(); goDistrict(); });
  await page.waitForTimeout(700);
  const errsBefore = pageErrors.length;
  /* Caught in the page rather than let through: a throw inside page.evaluate
     rejects in node and ends the whole run, and a suite that dies on the first
     broken thing reports one line about 405 checks. */
  const openThrew = await page.evaluate(() => {
    try { openSearch(); return null; } catch (e) { return String(e); }
  });
  await page.waitForTimeout(600);
  ok('opening the search panel raises nothing',
     openThrew === null && pageErrors.length === errsBefore,
     openThrew || pageErrors.slice(errsBefore).join(' | '));
  ok('and it puts a search box on the screen', await page.$('#q') !== null);

  await page.fill('#q', 'פ');
  await page.waitForTimeout(400);
  ok('one letter asks for two, rather than leaving the panel blank',
     await page.evaluate(() => document.getElementById('qres').innerText.trim().length > 0),
     await page.evaluate(() => JSON.stringify(document.getElementById('qres').innerText.slice(0, 60))));

  const munQuery = await page.evaluate(() => (D.mun[0].he || D.mun[0].pt).slice(0, 4));
  await page.fill('#q', munQuery);
  await page.waitForTimeout(500);
  const rows = await page.$$('#qres [data-jump]');
  ok(`typing ${munQuery} really returns rows — this is what threw`,
     rows.length > 0, `${rows.length} rows`);
  ok('and typing raised nothing either',
     pageErrors.length === errsBefore, pageErrors.slice(errsBefore).join(' | '));
  const jumpTo = rows.length
    ? await page.$eval('#qres [data-jump]', e => e.dataset.jump) : null;
  if (jumpTo) { await page.click('#qres [data-jump]'); await page.waitForTimeout(900); }
  ok('and choosing a row goes to the place it names, which is the point of it',
     jumpTo !== null && await page.evaluate(spec => {
       const [kind, rest] = [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)];
       return kind === 'mun' ? S.level === 'mun' && S.mun === Number(rest)
            : kind === 'zone' ? S.level === 'zone' && S.zone === rest
            : S.level !== 'district';
     }, jumpTo), jumpTo === null ? 'no row to choose' : jumpTo);

  /* מכתובת: the second of the two ways whose flow had never been checked.  It
     is not the Android picker at all — it searches the app's own gazetteer,
     which is why the picker fix confirmed on 2026-09-14 says nothing about it. */
  await page.evaluate(() => { goDistrict(); D.mine = []; saveMine(); if (!S.wp) toggleWp(); });
  await page.waitForTimeout(600);
  await page.click('[data-wpact="new"]');
  await page.waitForTimeout(500);
  await page.click('[data-wpway="place"]');
  await page.waitForTimeout(500);
  ok('מכתובת opens a search box and asks for nothing else yet',
     await page.$('#wpQ') !== null && await page.$('#mineName') === null);
  ok('and says plainly that it is not a street-address search',
     /כתובות רחוב/.test(await page.$eval('#wpQres', e => e.innerText)),
     await page.$eval('#wpQres', e => e.innerText.slice(0, 70)));

  const errsBeforePlace = pageErrors.length;
  await page.fill('#wpQ', munQuery);
  await page.waitForTimeout(500);
  ok('a query that matches returns rows — the case that threw',
     (await page.$$('#wpQres [data-wpplace]')).length > 0,
     `${(await page.$$('#wpQres [data-wpplace]')).length} rows`);
  ok('and it raised nothing doing it',
     pageErrors.length === errsBeforePlace, pageErrors.slice(errsBeforePlace).join(' | '));

  const placeRow = await page.$('#wpQres [data-wpplace]');
  const chosen = placeRow
    ? await page.$eval('#wpQres [data-wpplace] .row-t', e => e.textContent.trim()) : null;
  if (placeRow) { await page.click('#wpQres [data-wpplace]'); await page.waitForTimeout(900); }
  ok('choosing one opens the form for a place of its own',
     await page.$('#mineName') !== null && await page.evaluate(() => !!mineEditing));
  const nameShown = await page.$('#mineName')
    ? await page.$eval('#mineName', e => e.value) : null;
  ok('with the record it came from already named on it',
     chosen !== null && nameShown !== null && nameShown.trim() === chosen,
     `${nameShown} vs ${chosen}`);
  ok('and that record\'s own coordinate, not a blank one',
     await page.evaluate(() => !!mineEditing && Array.isArray(mineEditing.ll)
       && mineEditing.ll.length === 2
       && Number.isFinite(mineEditing.ll[0]) && Number.isFinite(mineEditing.ll[1])),
     await page.evaluate(() => JSON.stringify(mineEditing && mineEditing.ll)));
  const wantLl = await page.evaluate(() => mineEditing ? mineEditing.ll.slice() : null);
  if (wantLl) { await page.click('#wpSheet [data-wpact="save"]'); await page.waitForTimeout(900); }
  ok('and saving really puts the place there',
     wantLl !== null && await page.evaluate(ll => D.mine.length === 1
       && Math.abs(D.mine[0].ll[0] - ll[0]) < 1e-9
       && Math.abs(D.mine[0].ll[1] - ll[1]) < 1e-9, wantLl),
     await page.evaluate(() => JSON.stringify(D.mine.map(m => [m.name, m.ll]))));
  await page.evaluate(() => { D.mine = []; saveMine(); closeNewSheet(); if (S.wp) toggleWp(); goDistrict(); });
  await page.waitForTimeout(600);

  /* ---- 13d. the flood layer, and the fifteen municipalities it is silent
     about ------------------------------------------------------------------
     APA maps flood extent only inside 23 designated ARPSI study areas, and one
     of them is Porto.  Three municipalities of the eighteen are covered; the
     other fifteen have no polygon, which means they were not studied and NOT
     that they do not flood.  Amarante, Baião and Marco de Canaveses are on the
     Tâmega and are among the fifteen.

     That is the whole risk of shipping this layer: an empty map is the most
     confident-looking thing a map can show.  So the checks below are less
     about the polygons than about what the app says where there are none. */
  await page.evaluate(() => { goDistrict(); if (S.floods) { S.floods = false; applyNature(); } });
  await page.waitForTimeout(500);

  const fl = await page.evaluate(() => {
    const o = { present: typeof D !== 'undefined' && !!D.bFl };
    if (!o.present) return o;
    o.periods = (D.bFl.features || []).map(f => f.properties.return_years).sort((a, b) => a - b);
    o.coverage = Object.keys(D.bFl.coverage || {}).sort();
    o.defaultOff = S.floods === false;
    o.built = typeof NAT !== 'undefined' && !!NAT.floods;
    return o;
  });
  ok('the flood outlines ship with the app rather than needing a download',
     fl.present && fl.periods.join() === '20,100,1000', JSON.stringify(fl.periods));
  ok('and they are off until they are asked for', fl.defaultOff === true);
  ok('APA mapped three of the eighteen municipalities, and the data says which',
     fl.present && fl.coverage.join() === '1304,1312,1317', JSON.stringify(fl.coverage));

  const drawn = await page.evaluate(() => {
    if (typeof NAT === 'undefined' || !NAT.floods) return null;
    S.floods = true; applyNature();
    const stack = NAT.floods.getLayers().map(l => l.feature.properties.return_years);
    const cols = NAT.floods.getLayers().map(l => l.options.color);
    const on = map.hasLayer(NAT.floods);
    S.floods = false; applyNature();
    return { stack, cols, on, off: !map.hasLayer(NAT.floods) };
  });
  ok('switching it on draws all three return periods',
     drawn && drawn.stack.length === 3 && drawn.on, JSON.stringify(drawn && drawn.stack));
  /* The 1000-year outline contains the 100-year contains the 20-year.  Drawn in
     that order the stack darkens towards the core on its own; drawn the other
     way the rarest flood would cover the commonest one. */
  ok('widest first, so the stack darkens towards the flood that comes often',
     drawn && drawn.stack.join() === '1000,100,20', JSON.stringify(drawn && drawn.stack));
  ok('and switching it off takes them off the map', drawn && drawn.off === true);
  /* Two blues over the same river read as one thing.  This is why the outlines
     are indigo and not another shade of the water layer. */
  ok('no flood colour is the river colour',
     drawn && !drawn.cols.some(c => ['#4a9ad4', '#2f7fc1'].includes(String(c).toLowerCase())),
     JSON.stringify(drawn && drawn.cols));

  const layHtml = await page.evaluate(() =>
    typeof renderLayers === 'function' ? renderLayers() : '');
  const floodRow = (layHtml.match(/<button[^>]*data-lay="floods"[\s\S]*?<\/button>/) || [''])[0];
  ok('the menu row carries the coverage as a count, before the switch is touched',
     /3\/18/.test(floodRow), JSON.stringify(floodRow.replace(/<[^>]+>/g, ' ').trim().slice(0, 70)));

  /* The case the layer exists for.  Porto is mapped; Amarante is not, and
     turning the layer on there must not leave a reader with a clean map and no
     explanation. */
  ok('the app can tell a mapped municipality from an unmapped one',
     await page.evaluate(() => {
       try {
         return typeof floodsMapped === 'function'
           && floodsMapped('1312') === true && floodsMapped('1301') === false;
       } catch (e) { return false; }
     }));
  const amarante = await page.evaluate(() => (D.mun.find(m => m.dicofre === '1301') || {}).num);
  await page.evaluate(n => { goMun(n); hideNote(); if (S.floods) { S.floods = false; applyNature(); } },
                      amarante);
  await page.waitForTimeout(700);
  /* The tap handler is an anonymous delegated listener, so the behaviour it
     drives lives in floodNote() — which is the thing worth checking anyway, and
     giving it a name is what made it checkable. */
  const noted = await page.evaluate(() => {
    try { S.floods = true; applyNature(); return floodNote(); } catch (e) { return String(e); }
  });
  await page.waitForTimeout(600);
  ok('the app knows it owes the reader a word here', noted === true,
     noted === true ? '' : String(noted));
  const said = await page.evaluate(() => document.getElementById('msgs').innerText);
  ok('turning it on over an unmapped municipality says so, instead of showing a clean map',
     /לא מיפתה|did not map/.test(said), JSON.stringify(said.slice(0, 90)));
  ok('and it says plainly that this is not a clearance',
     /אינו אומר שאין|does not mean no/.test(said), JSON.stringify(said.slice(0, 120)));

  /* Rule 1 of the accuracy contract, on a record that did not exist yesterday. */
  const floodRec = await page.evaluate(() => (D.sources.fields || {})['map.floods'] || null);
  ok('the source record carries a source and a reference year, like every other',
     floodRec && floodRec.source && String(floodRec.reference_year).length === 4,
     floodRec && `${String(floodRec.source).slice(0, 40)} / ${floodRec.reference_year}`);
  ok('and its caveat names the limit rather than burying it',
     floodRec && /23/.test(floodRec.caveat_he) && /15/.test(floodRec.caveat_he),
     floodRec && JSON.stringify(String(floodRec.caveat_he).slice(0, 80)));

  /* Leave the app exactly as this block found it.  The menu was opened here to
     tap the switch, and a menu left open covers the screen the next block taps
     on — which is the kind of coupling that makes a suite fail somewhere that
     has nothing to do with the change. */
  /* And over Porto, which APA DID map, it must say nothing — a warning that
     fires everywhere teaches the reader to ignore it. */
  const portoMapped = await page.evaluate(() => (D.mun.find(m => m.dicofre === '1312') || {}).num);
  await page.evaluate(n => { hideNote(); goMun(n); S.floods = true; applyNature(); }, portoMapped);
  await page.waitForTimeout(700);
  ok('and stays quiet over a municipality APA did map',
     await page.evaluate(() => {
       try {
         return floodNote() === false
           && document.getElementById('msgs').innerText.trim() === '';
       } catch (e) { return false; }
     }));

  /* Leave the reading half where this block found it.  Walking to a
     municipality and back scrolls it, and a scrolled pane puts the next
     block's buttons under the fixed home and menu controls — a failure that
     lands far away from its cause. */
  await page.evaluate(() => {
    S.floods = false; applyNature(); hideNote(); goDistrict();
    const doc = document.getElementById('doc');
    if (doc) doc.scrollTop = 0;
  });
  await page.waitForTimeout(700);

  /* Rule 1 again, this time as a route and not as a file: the record has to be
     reachable by tapping, or it is not published.  "3/18" sits inside the
     row's own <button>, so the link cannot be the number itself. */
  const srcHtml = await page.evaluate(() => { try { return renderLayers(); } catch (e) { return String(e); } });
  ok('the layers panel carries a link to the flood record',
     /data-src="map\.floods"/.test(srcHtml));
  ok('and one to the building-constraints record, which was just as unreachable',
     /data-src="map\.ren_ran"/.test(srcHtml));

  const viewBefore = await page.evaluate(() => S.view);
  await page.evaluate(() => toggleLayers(true));
  await page.waitForTimeout(400);
  /* A <button> inside a <button> is invalid HTML and the inner one never
     receives the tap, so the link being its own line is the whole design and
     not a layout preference.  This is the check that would catch someone
     folding it back into the row. */
  ok('the link is its own control, not one buried inside the row switch',
     await page.evaluate(() => !document.querySelector('.lay [data-src]')
                            && !!document.querySelector('#panelBody .srcln[data-src="map.floods"]')));

  /* Report, do not abort.  Against code without the link this block used to
     stop the whole run at the click, so the six checks after it never said
     anything — and a suite that goes quiet is worse than one that goes red. */
  const linkThere = !!(await page.$('#panelBody .srcln[data-src="map.floods"]'));
  if (linkThere) { await page.click('#panelBody .srcln[data-src="map.floods"]'); }
  await page.waitForTimeout(400);
  const srcRec = !linkThere ? { title: '(no link)', body: '(no link)' }
    : await page.evaluate(() => ({
        title: (document.getElementById('panelTitle') || {}).textContent || '',
        body: (document.getElementById('panelBody') || {}).innerText || '' }));
  ok('tapping it opens the flood record itself',
     /הצפה|flood/i.test(srcRec.title), JSON.stringify(srcRec.title));
  ok('and the record on screen carries the year and the source',
     /2023/.test(srcRec.body) && /APA/.test(srcRec.body), JSON.stringify(srcRec.body.slice(0, 80)));
  ok('and the coverage caveat — the 23 studied areas and the 15 unmapped — is on that screen',
     /23/.test(srcRec.body) && /15/.test(srcRec.body), JSON.stringify(srcRec.body.slice(0, 160)));

  await page.evaluate(v => { closePanel(); if (S.view !== v) { S.view = v; applyView(); } }, viewBefore);
  await page.waitForTimeout(300);

  /* ---- CRUS: the land-use regime, and the two municipalities whose numbers
     come with a warning.  This is the first block in the app whose reference
     year belongs to the unit rather than to the field, and the first whose
     source publishes a class meaning "we did not classify this". */
  const munNum = async dicofre => page.evaluate(
    d => (D.mun.find(m => m.dicofre === d) || {}).num, dicofre);
  const goAndRead = async dicofre => {
    await page.evaluate(n => { hideNote(); goMun(n); }, await munNum(dicofre));
    await page.waitForTimeout(700);
    return page.evaluate(() => {
      const card = document.getElementById('crusCard');
      return card ? { html: card.innerHTML, text: card.innerText } : null;
    });
  };

  const gaia = await goAndRead('1317');
  ok('every municipality has a land-use card', !!gaia);
  ok('and its numbers open the record behind them, like every other number',
     !!gaia && /data-src="municipio\.crus"/.test(gaia.html));
  ok('the classes are the source\'s own and are named in Portuguese too',
     !!gaia && /Solo Urbano/.test(gaia.text) && /Solo Rústico/.test(gaia.text));
  ok('including the transitional class, which is neither of the two',
     !!gaia && /urbanizável/.test(gaia.text));
  ok('the card refuses to call Solo Rústico agricultural land',
     !!gaia && !/קרקע חקלאית(?!״)/.test(gaia.text.replace(/״קרקע חקלאית״/g, '')));
  ok('and it says the plan itself governs, not this map',
     !!gaia && /PDM|plan/.test(gaia.text));

  const classSum = await page.evaluate(() => {
    const c = (D.mun.find(m => m.dicofre === '1317') || {}).crus || {};
    return (c.classes || []).reduce((a, x) => a + x.pct, 0);
  });
  ok('the classes on screen add up to the whole municipality',
     Math.abs(classSum - 100) < 0.3, String(classSum));

  /* Santo Tirso's plan is marked Não vigente. Every figure on its card
     describes ground nobody is bound by, and silence would leave it looking
     exactly as authoritative as the other seventeen. */
  const tirso = await goAndRead('1314');
  ok('a municipality whose plan is not in force says so, above the numbers',
     !!tirso && /אינה בתוקף|not in force/.test(tirso.text), tirso && tirso.text.slice(0, 80));
  ok('and it says it in the source\'s own word, not a paraphrase',
     !!tirso && /Não vigente/.test(tirso.text));
  ok('and the warning is a warning and not a footnote',
     !!tirso && /<div class="warn"/.test(tirso.html));

  /* And Paços de Ferreira, where CRUS does not add up to the municipality. */
  const pacos = await goAndRead('1309');
  ok('where CRUS and CAOP disagree the card says so',
     !!pacos && /2\.71|2,71/.test(pacos.text), pacos && pacos.text.slice(0, 120));
  ok('and gives no reason, because DGT publishes none',
     !!pacos && /אינו מפרסם סיבה|publishes no reason/.test(pacos.text));

  const crusPorto = await goAndRead('1312');
  ok('a municipality whose plan is in force carries neither warning',
     !!crusPorto && !/אינה בתוקף|not in force/.test(crusPorto.text)
       && !/CAOP:/.test(crusPorto.text));
  ok('and Porto, which is all urban, still shows a class and not a blank',
     !!crusPorto && /Solo Urbano/.test(crusPorto.text));

  await page.evaluate(() => { hideNote(); goDistrict();
    const doc = document.getElementById('doc'); if (doc) doc.scrollTop = 0; });
  await page.waitForTimeout(700);

  /* TIPAU 2025 — INE's urban-area class on every parish the 2025 reform left
     alone, and "no data" on every parish it created: the class of the union a
     new parish came out of is the union's, and inheriting it would be the
     unmarked inference rule 2 forbids. */
  {
    await page.evaluate(() => { if (S.wp) toggleWp(); if (S.cmp) toggleCmp(); if (S.cons) consOff(); });
    const tip = await page.evaluate(() => {
      const bonfim = D.fre.find(f => f.dicofre === '131202');
      goZone(D.freKey(bonfim));
      const row = [...document.querySelectorAll('#doc .stat')].find(e => e.dataset.src === 'freguesia.tipau');
      return row ? { text: row.innerText.replace(/\s+/g, ' ').trim(), no: row.classList.contains('no'), src: row.dataset.src } : null;
    });
    ok('Bonfim\'s card carries its TIPAU class as a chip with the field\'s source record',
       tip && !tip.no && /APU/.test(tip.text) && /2025/.test(tip.text), JSON.stringify(tip));
    await page.waitForTimeout(300);
    await page.click('#doc .stat[data-src="freguesia.tipau"]');
    await page.waitForTimeout(500);
    const rec = await page.evaluate(() => document.getElementById('doc').innerText + (document.querySelector('#panel') && !document.querySelector('#panel').hidden ? document.querySelector('#panel').innerText : ''));
    ok('and tapping it opens a record that names INE and TIPAU 2025', /TIPAU 2025/.test(rec) && /INE/.test(rec));
    await page.evaluate(() => closePanel());
    const born = await page.evaluate(() => {
      const f = D.fre.find(x => x.dicofre === '131732');      // Crestuma, created 2025
      goZone(D.freKey(f));
      const row = [...document.querySelectorAll('#doc .stat')].find(e => e.dataset.src === 'freguesia.tipau');
      return { was: !!f.was_part_of, tipau: f.tipau, no: row && row.classList.contains('no'), text: row && row.innerText };
    });
    ok('a parish created in 2025 shows אין נתון for it — not the class of the union it left',
       born.was && born.tipau === undefined && born.no === true && /אין נתון/.test(born.text), JSON.stringify(born));
    const tally = await page.evaluate(() => {
      goMun(2);                                                 // Vila Nova de Gaia, 24 parishes
      const rows = [...document.querySelectorAll('#doc .stat[data-src="freguesia.tipau"]')];
      const n = rows.map(r => parseInt((r.querySelector('.stat-v') || {}).innerText, 10) || 0);
      return { rows: rows.length, sum: n.reduce((a, b) => a + b, 0), parishes: D.freByMun.get(2).length,
               none: (rows.find(r => /2025/.test(r.innerText)) || {}).innerText };
    });
    ok('the municipality card tallies its parishes by class, and the tally is its parish count',
       tally.rows >= 3 && tally.sum === tally.parishes, JSON.stringify(tally));
    ok('and says how many are unclassified because they were created in 2025', /\d/.test(tally.none || ''), JSON.stringify(tally.none));
    await page.evaluate(() => goDistrict()); await page.waitForTimeout(400);
  }

  /* What needs a network is one list, printed where the reader can see it;
     and a note beside a value is one quiet line, with the reasons a tap away. */
  {
    await page.evaluate(() => openInfo('about')); await page.waitForTimeout(400);
    const about = await page.evaluate(() => ({
      text: document.querySelector('#infoDrawer').innerText,
      hosts: ONLINE().map(o => o.host) }));
    ok('the about page has a "what needs a network" section', /מה דורש רשת/.test(about.text));
    ok('and it names every host the app can reach', about.hosts.length >= 3 && about.hosts.every(h => about.text.includes(h)), JSON.stringify(about.hosts));
    await page.evaluate(() => { document.getElementById('infoDrawer').hidden = true; openInfo('terms'); }); await page.waitForTimeout(400);
    const terms = await page.evaluate(() => document.querySelector('#infoDrawer').innerText);
    ok('the terms page no longer promises plain offline — it points at that list', /מה דורש רשת/.test(terms) && !/עובדת גם בלי רשת/.test(terms));
    await page.evaluate(() => { document.getElementById('infoDrawer').hidden = true; });
    const cp = await page.evaluate(() => {
      const f = D.fre.find(x => x.dicofre === '131732');          // Crestuma: census_partial
      goZone(D.freKey(f));
      const notes = [...document.querySelectorAll('#doc .card .note')].map(n => n.innerText.trim());
      const note = notes.find(n => /ארבעה שדות מפקד/.test(n)) || '';
      return { partial: f.census_partial === true, len: note.length, size: getComputedStyle(document.querySelector('#doc .note')).fontSize };
    });
    ok('a parish the census sections do not cover carries one short note, not a paragraph', cp.partial && cp.len > 0 && cp.len <= 120, JSON.stringify(cp));
    ok('and the note is set at the smallest step of the scale — tier 2 is quiet', cp.size === '12px', cp.size);
    await page.click('#doc .stat[data-src="freguesia.median_age"]'); await page.waitForTimeout(500);
    const rec = await page.evaluate(() => (document.querySelector('#panel') && !document.querySelector('#panel').hidden ? document.querySelector('#panel').innerText : '') + document.getElementById('doc').innerText);
    ok('the full reason is one tap away, in the field\'s source record', /המקטעים הסטטיסטיים/.test(rec) && /2013/.test(rec));
    await page.evaluate(() => { closePanel(); goDistrict(); }); await page.waitForTimeout(400);
  }

  /* THE MATRIX.  Three levels by three modes, every cell exists, and the two
     axes never move each other: switching mode keeps the level and the unit,
     navigating keeps the mode.  Read off S and the tab row after each step. */
  {
    const cell = () => page.evaluate(() => ({ level: S.level, mun: S.mun, zone: S.zone,
      mode: S.lst ? 'lst' : S.cmp ? 'cmp' : S.cons ? 'cons' : 'overview',
      tab: (document.querySelector('#modeBar [aria-selected="true"]') || { dataset: {} }).dataset.mode,
      tabs: document.querySelectorAll('#modeBar [role="tab"]').length,
      text: document.getElementById('doc').innerText.length }));
    const go = async level => {
      await page.evaluate(l => {
        if (l === 'district') goDistrict();
        else if (l === 'mun') goMun(14);
        else goZone(D.freKey(D.freByMun.get(14)[1]));
      }, level);
      await page.waitForTimeout(600);
    };
    const mode = async k => {
      await page.click(`#modeBar [data-mode="${k}"]`);
      await page.waitForFunction(() => !S.cons || consPhase === 'ready', null, { timeout: 120000 });
      await page.waitForTimeout(600);
    };
    await page.evaluate(() => { if (S.wp) toggleWp(); if (S.cmp) toggleCmp(); if (S.cons) consOff(); if (S.lst) lstOff(); });
    ok('the tab row offers the four modes', (await cell()).tabs === 4, JSON.stringify(await cell()));
    ok('and it sits at the head of the text half',
       await page.evaluate(() => {
         const b = document.querySelector('#modeBar').getBoundingClientRect();
         const p = document.querySelector('#paneText').getBoundingClientRect();
         return Math.abs(b.top - p.top) <= 1 && b.height >= 44;
       }));
    for (const level of ['district', 'mun', 'zone']) {
      await mode('overview'); await go(level);
      const before = await cell();
      for (const k of ['cons', 'cmp', 'lst', 'overview']) {
        await mode(k);
        const c = await cell();
        ok(`${level} × ${k}: the cell exists, the tab says so, and the text half says something`,
           c.mode === k && c.tab === k && c.text > 40, JSON.stringify(c));
        ok(`${level} × ${k}: switching to it kept the level and the unit`,
           c.level === before.level && c.mun === before.mun && c.zone === before.zone,
           JSON.stringify([before, c]));
      }
    }
    /* the other axis: navigate inside a mode and the mode stays, home included */
    for (const k of ['cons', 'cmp', 'lst']) {
      await go('district'); await mode(k);
      await go('mun'); const a = await cell();
      await go('zone'); const b = await cell();
      await page.click('#homeBtn'); await page.waitForTimeout(700); const c = await cell();
      ok(`${k}: two levels down and home again, and the mode never changed`,
         a.mode === k && a.level === 'mun' && b.mode === k && b.level === 'zone'
           && c.mode === k && c.level === 'district', JSON.stringify([a, b, c]));
    }
    /* level 3 of the comparison: the parish among its siblings, and marked */
    await go('zone'); await mode('cmp');
    ok('level 3 of the comparison lists the municipality\'s parishes with the open one marked',
       await page.evaluate(() => document.querySelectorAll('#doc .cmp-row').length >= 2
         && document.querySelectorAll('#doc .cmp-row.is-hi[data-fre]').length === 1
         && document.querySelector('#doc .cmp-row.is-hi').dataset.fre === S.zone));
    ok('and its outline is the marked one on the map — one black parish line among grey siblings',
       await page.evaluate(() => { let black = 0, n = 0;
         LG.lnFre.eachLayer(l => { n++; if (l.options.color === C.white) black++; });
         return n >= 2 && black === 1; }));
    /* the places list is not a mode: it opens over the comparison and closes back into it */
    await page.evaluate(() => toggleWp()); await page.waitForTimeout(500);
    const over = await cell();
    await page.evaluate(() => toggleWp()); await page.waitForTimeout(500);
    const back = await cell();
    ok('the places list opens over the comparison without closing it, and closes back into it',
       over.mode === 'cmp' && over.level === 'zone' && back.mode === 'cmp' && back.level === 'zone'
         && back.text > 40, JSON.stringify([over, back]));
    await mode('overview'); await go('district');
  }

  /* THE LISTINGS MODE.  A results file (six real Lousada listings, read
     through the provider's connector) is imported; the map colours by count,
     the rows count, the cards quote; nothing on it opens a source record and
     nothing in the overview shows a listing; save makes a place of the
     user's own with the quote inside and the copy marked as a copy. */
  {
    const fixture = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'listings_lousada.json'), 'utf8'));
    await page.route('**img4.idealista.pt/**', r => r.abort());
    await page.evaluate(() => { if (S.wp) toggleWp(); if (S.cmp) toggleCmp(); if (S.cons) consOff(); if (S.lst) lstOff(); goDistrict(); });
    await page.click('#modeBar [data-mode="lst"]'); await page.waitForTimeout(600);
    ok('the listings tab opens a search form and moves nothing', await page.evaluate(() =>
      S.lst === true && S.level === 'district' && !!document.querySelector('#lstForm') && !!document.querySelector('#lstSearch')));
    ok('the form is one column with a label above every field', await page.evaluate(() => {
      const f = document.querySelector('#lstForm'); const cs = getComputedStyle(f);
      return cs.flexDirection === 'column' && f.querySelectorAll('.fld-l').length >= 6; }));
    await page.click('#lstSearch'); await page.waitForTimeout(500);
    ok('search without a key explains what is missing and opens the key fields, without a blocking screen',
       await page.evaluate(() => !!document.querySelector('#lstApikey') && document.querySelector('#msgs').innerText.includes('מפתח')
         && !document.querySelector('#menu').hidden === false));
    await page.evaluate(f => importListings(f), fixture); await page.waitForTimeout(800);
    const l1 = await page.evaluate(() => ({ n: D.lst.items.length, level: S.level, form: !!document.querySelector('#lstForm'),
      lousada: (document.querySelector('#doc [data-lstmun="14"] .num') || {}).innerText,
      chips: document.querySelectorAll('#doc [data-src]').length,
      painted: LG.mun ? LG.mun.getLayers().filter(l => l.options.fillOpacity > .5).length : 0 }));
    ok('the file is read: six listings, the level unchanged, the form folded', l1.n === 6 && l1.level === 'district' && !l1.form, JSON.stringify(l1));
    ok('level 1 counts them by municipality — all six in Lousada', l1.lousada === '6', JSON.stringify(l1));
    ok('and paints exactly one municipality on the map', l1.painted === 1, String(l1.painted));
    ok('no number on the listings screen opens a source record', l1.chips === 0, String(l1.chips));
    await page.click('#doc [data-lstmun="14"]'); await page.waitForTimeout(700);
    const l2 = await page.evaluate(() => ({ level: S.level, mun: S.mun, mode: S.lst,
      sum: [...document.querySelectorAll('#doc [data-lstfre] .num')].reduce((a, e) => a + (+e.innerText || 0), 0),
      cards: document.querySelectorAll('#doc .lst').length, chips: document.querySelectorAll('#doc [data-src]').length }));
    ok('level 2 keeps the mode, counts by parish to six, and lists the six', l2.level === 'mun' && l2.mode && l2.sum === 6 && l2.cards === 6 && l2.chips === 0, JSON.stringify(l2));
    const code = fixture.items[0].code;
    await page.click(`#doc [data-lst="${code}"] .lst-txt`); await page.waitForTimeout(800);
    const l3 = await page.evaluate(c => ({ level: S.level, zone: S.zone, open: S.lstOpen, state: lstState(c),
      quote: !!document.querySelector('#doc .lst-quote'), pins: LG.lst ? LG.lst.getLayers().length : 0,
      src: !!document.querySelector('#doc a[href*="idealista.pt"]'), chips: document.querySelectorAll('#doc [data-src]').length }), code);
    ok('tapping a listing opens its parish at level 3, marks it read, and shows the quote and the pin', l3.level === 'zone' && l3.open === code && l3.state === 'read' && l3.quote && l3.pins >= 1 && l3.src && l3.chips === 0, JSON.stringify(l3));
    ok('and the parish it opened is the one under the coordinate, not the one in the text',
       l3.zone === await page.evaluate(c => { const it = D.lst.items.find(x => x.code === c); const f = freguesiaAt(it.ll[0], it.ll[1]); return D.freKey(f); }, code), l3.zone);
    await page.evaluate(() => { D.mine = D.mine.filter(p => !p.src); saveMine(); });
    await page.click(`#doc [data-lstact="save"][data-code="${code}"]`); await page.waitForTimeout(1200);
    const sv = await page.evaluate(c => { const p = D.mine.find(x => x.id === 'l' + c); return p ? { state: lstState(c), price: p.src.price, read: p.src.read_at, desc: p.desc.length > 20, url: p.src.url } : null; }, code);
    ok('save makes a place of the user\'s own with the quote, the price as read then, and when it was read', sv && sv.state === 'saved' && sv.price === 69000 && /2026/.test(sv.read) && sv.desc && /idealista/.test(sv.url), JSON.stringify(sv));
    await page.evaluate(() => { if (!S.wp) toggleWp(); }); await page.waitForTimeout(600);
    const card = await page.evaluate(c => { const el = document.querySelector(`#doc [data-wp="l${c}"]`); return el ? el.innerText : ''; }, code);
    ok('on its my-places card the copy says it is a copy: the price "as read then", the quote as the listing\'s words', /כפי שנקרא אז/.test(card) && /לשון המודעה/.test(card) && /69/.test(card), card.slice(0, 120));
    const ex = await page.evaluate(async c => { const p = await exportPayload(); const r = p.points.find(x => x.id === 'l' + c); return !!(r && r.src && r.src.code === c); }, code);
    ok('and the export carries the quote and its provenance', ex);
    await page.evaluate(() => { toggleWp(); }); await page.waitForTimeout(400);
    await page.click(`#doc [data-lstact="del"][data-code="${fixture.items[1].code}"]`).catch(() => {});
    await page.evaluate(c => { lstSetState(c, 'deleted'); redrawText(); }, fixture.items[1].code); await page.waitForTimeout(400);
    ok('delete removes a listing from the results', await page.evaluate(() => lstLive().length) === 5);
    await page.click('#modeBar [data-mode="overview"]'); await page.waitForTimeout(700);
    const ov = await page.evaluate(() => ({ level: S.level, zone: S.zone, lst: document.querySelectorAll('#doc .lst, #doc .lst-quote').length,
      euros: /€ ?69|69[,.]000/.test(document.getElementById('doc').innerText), chips: document.querySelectorAll('#doc [data-src]').length }));
    ok('the overview of the same parish shows the statistics and not one listing — two screens, no mixing', ov.level === 'zone' && ov.lst === 0 && !ov.euros && ov.chips > 0, JSON.stringify(ov));
    await page.evaluate(() => { D.mine = D.mine.filter(p => !p.src); saveMine(); D.lst = null; lstSave(); goDistrict(); });
    await page.unroute('**img4.idealista.pt/**');
  }

  /* Last block in the file, and it has to be: from here on every tile is
     refused, and the app answers a background it cannot load by dropping it —
     correctly — so nothing after this point could switch the background on and
     keep it.  Nothing comes after. */
  await page.evaluate(() => { hideNote(); if (!S.tiles) toggleTiles(); });
  await page.waitForTimeout(400);
  await page.unroute(TILES);
  await page.route(TILES, r => r.abort());
  // the tiles already on the map loaded, so ask for them again: without this the
  // layer sits there satisfied and the failure path is never reached
  await page.evaluate(() => tileLayer.redraw());
  const dropped = await page.waitForFunction(() => S.tiles === false, null, { timeout: 15000 })
    .then(() => true).catch(() => false);
  ok('a street background that will not load is dropped, not left as grey squares', dropped);
  await page.waitForTimeout(300);
  ok('and the reader is told, rather than left thinking the map is empty',
     /לא נטען|did not load/.test(
       await page.evaluate(() => document.getElementById('msgs').innerText)));

  ok('nothing on any screen threw an uncaught error along the way',
     pageErrors.length === 0, pageErrors.join(' | '));


  /* ---- the boundary stack: the orange regions sit on top ------------------
     The four line panes are created once and given zIndex = 460 + i in
     LINE_PANE order, so the array IS the stacking order.  For a year the
     array put the regions first — i.e. lowest — and the one line that marks
     a body reaching beyond the district was painted under every other line.
     Read back from the panes the browser actually made, not from the array. */
  {
    const document_has_district = await page.$('.leaflet-ln-district-pane') !== null;
    const z = await page.evaluate(() => {
      const zi = n => Number(getComputedStyle(document.querySelector(`.leaflet-${n}-pane`)).zIndex);
      return { region: zi('ln-region'), mun: zi('ln-mun'), fre: zi('ln-fre') };
    });
    ok('boundary stack: the regions pane above municipalities above parishes — and no district pane',
       z.region > z.mun && z.mun > z.fre && !document_has_district, JSON.stringify(z));
  }

  /* ---- running numbers: the map, the pins and the legend say the same thing
     The label on a unit is the app's own 1..N; the official DICOFRE code is
     printed in the text beside it. Read back the labels the map actually
     draws, at the district and inside one municipality (Lousada = 14, which
     has 16 parishes), and compare with the pins in the list. */
  {
    const labels = () => page.$$eval('.leaflet-marker-icon.lbl i', els => els.map(e => e.textContent.trim()).sort((a, b) => a - b));
    const pins = () => page.$$eval('#doc [data-mun] .pin, #doc [data-fre] .pin', els => els.map(e => e.textContent.trim()).sort((a, b) => a - b));
    await page.click('#homeBtn'); await page.waitForTimeout(400);
    const want18 = Array.from({ length: 18 }, (_, i) => String(i + 1));
    ok('district: the 18 map labels are the running numbers 1..18', JSON.stringify(await labels()) === JSON.stringify(want18), (await labels()).join(','));
    ok('district: the list pins are the same 1..18', JSON.stringify(await pins()) === JSON.stringify(want18), (await pins()).join(','));
    const codeBeside = await page.$$eval('#doc [data-mun]', els => els.length && els.every(e => /\b13\d\d\b/.test(e.textContent)));
    ok('district: every row also prints the four-digit official code', codeBeside);
    await page.click('#doc [data-mun="14"]'); await page.waitForTimeout(500);
    const want16 = Array.from({ length: 16 }, (_, i) => String(i + 1));
    ok('Lousada: the 16 parish labels are 1..16', JSON.stringify(await labels()) === JSON.stringify(want16), (await labels()).join(','));
    ok('Lousada: the list pins are 1..16 and each row prints a six-digit code',
       JSON.stringify(await pins()) === JSON.stringify(want16)
         && await page.$$eval('#doc [data-fre]', els => els.every(e => /\b1305\d\d\b/.test(e.textContent))),
       (await pins()).join(','));
  }

  /* ---- the sort chip: a reading order, never a fact ----------------------
     Comparison mode, parishes, the INE price (70 of 275 have one, so there is
     a real "no data" block).  One tap reverses the ranked rows and nothing
     else: every unit keeps its colour, the map keeps every fill, and the units
     with no value stay after the ranked ones. */
  {
    await page.evaluate(() => { if (S.wp) toggleWp(); if (S.cmp) toggleCmp(); });
    await page.click('#homeBtn'); await page.waitForTimeout(400);      // the district, plain
    await page.evaluate(() => toggleCmp()); await page.waitForTimeout(400);
    const scopeThere = await page.waitForSelector('[data-cmpscope="fre"]', { timeout: 5000 }).then(() => true, () => false);
    ok('sort chip: comparison mode opened at the district, with its scope buttons', scopeThere,
       await page.evaluate(() => `level ${S.level}, cmp ${S.cmp}`));
    if (await page.evaluate(() => S.sortDesc)) { await page.click('[data-sortdir]'); await page.waitForTimeout(300); }
    if (scopeThere) await page.click('[data-cmpscope="fre"]'); await page.waitForTimeout(400);
    if (await page.evaluate(() => !S.cmpPick)) { await page.click('[data-cmppick="1"]'); await page.waitForTimeout(300); }
    await page.click('#doc [data-cmpf="price_eur_m2"]'); await page.waitForTimeout(500);
    const rows = () => page.$$eval('#doc .cmp-row', els => els.map(e => ({ id: e.dataset.cmpu, no: e.classList.contains('no'),
      c: getComputedStyle(e.querySelector('.cmp-sw')).backgroundColor })));
    const fills = () => page.$$eval('.leaflet-overlay-pane path', els => els.map(e => e.getAttribute('fill') || '').sort());
    const aria = () => page.$eval('#doc .cmp-rows', e => e.getAttribute('aria-sort'));
    const b = await rows(), fb = await fills();
    await page.click('[data-sortdir]'); await page.waitForTimeout(400);
    const a = await rows(), fa = await fills();
    const rb = b.filter(r => !r.no), ra = a.filter(r => !r.no);
    ok('sort chip: the ranked rows come back in the opposite order',
       rb.length > 10 && JSON.stringify(ra.map(r => r.id)) === JSON.stringify(rb.map(r => r.id).reverse()), `${rb.length} rows`);
    ok('sort chip: every unit keeps its colour', ra.every(r => rb.find(x => x.id === r.id).c === r.c));
    ok('sort chip: the map keeps every fill', JSON.stringify(fa) === JSON.stringify(fb));
    ok('sort chip: "no data" stays after the ranked rows, and aria-sort says descending',
       a.filter(r => r.no).length === b.filter(r => r.no).length && a.length && a[a.length - 1].no && await aria() === 'descending',
       `none ${a.filter(r => r.no).length}, aria ${await aria()}`);
    await page.click('[data-sortdir]'); await page.waitForTimeout(300);
    await page.evaluate(() => { if (S.cmp) toggleCmp(); });
  }

  /* ---- list / expanded, the same chip in every mode ---------------------
     Compact folds descriptions and notes away and nothing else: every value
     row keeps its year and its "אין נתון", every source button stays, and the
     state is one — set at the district, still set inside a municipality. */
  {
    await page.evaluate(async () => { if (S.wp) toggleWp(); if (S.cmp) toggleCmp(); if (S.cons) await toggleCons(); });
    await page.click('#homeBtn'); await page.waitForTimeout(400);
    if (await page.evaluate(() => S.dense)) { await page.click('[data-dense]'); await page.waitForTimeout(300); }
    const vis = sel => page.$$eval(sel, els => els.filter(e => e.getClientRects().length > 0).length);
    const chipIn = async () => (await page.$('#doc [data-dense]')) !== null;
    const where = [];
    where.push(['district', await chipIn()]);
    await page.evaluate(() => toggleCmp()); await page.waitForTimeout(300); where.push(['comparison', await chipIn()]);
    await page.evaluate(() => toggleCmp()); await page.evaluate(async () => { await toggleCons(); }); await page.waitForTimeout(300); where.push(['constraints', await chipIn()]);
    await page.evaluate(async () => { await toggleCons(); }); await page.waitForTimeout(300);
    ok('list/expanded: the same chip in the district, comparison and constraints views', where.every(w => w[1]), JSON.stringify(where));
    const before = { d: await vis('#doc .row-d'), y: await vis('#doc .stat-y'), no: await vis('#doc .stat.no'), src: await vis('#doc [data-src]') };
    await page.click('#doc [data-dense]'); await page.waitForTimeout(400);
    const after = { d: await vis('#doc .row-d'), y: await vis('#doc .stat-y'), no: await vis('#doc .stat.no'), src: await vis('#doc [data-src]') };
    ok('list: descriptions fold away', before.d > 5 && after.d === 0, `${before.d} → ${after.d}`);
    ok('list: every year, every "אין נתון" and every source button stay visible',
       after.y === before.y && after.no === before.no && after.src === before.src && before.src > 0, JSON.stringify({ before, after }));
    await page.click('#doc [data-mun="14"]'); await page.waitForTimeout(500);
    ok('list: one state — still compact inside Lousada, chip offers מורחב',
       await page.$eval('#doc', e => e.classList.contains('dense')) && (await page.$eval('#doc [data-dense]', e => e.textContent.trim())) === 'מורחב'
         && await vis('#doc .row-d') === 0 && await vis('#doc .stat-y') > 0);
    await page.click('#doc [data-dense]'); await page.waitForTimeout(300);
  }

  /* ---- the three pages behind the one drawer -----------------------------
     The user's page carries no field key; the developer's page does; the
     terms page carries every licence notice and the limits of the app. */
  {
    const open = async k => { await page.evaluate(k => openInfo(k), k); await page.waitForTimeout(200);
      return page.$eval('#infoBody', e => e.textContent); };
    const about = await open('about'), dev = await open('dev'), terms = await open('terms');
    ok('about: explains the codes, names the two bodies behind the numbers, and lists what is missing',
       about.includes('DICOFRE') && about.includes('INE') && about.includes('CAOP') && about.includes('מה עוד חסר'));
    ok('about: no field keys', !/\bmunicipio\.[a-z_]+\b/.test(about) && !/\bfreguesia\.[a-z_]+\b/.test(about));
    ok('behind the scenes: the field keys, the build date and the validation chain',
       /\bmunicipio\.crus\b/.test(dev) && dev.includes('checks.py') && dev.includes(await page.evaluate(() => D.generated)));
    ok('terms: every licence notice, ODbL and CC BY 4.0 among them, and the limits of liability',
       terms.includes('OpenStreetMap contributors') && terms.includes('ODbL') && terms.includes('CC BY 4.0')
         && terms.includes('אינה ייעוץ') && terms.includes('אינו נושא באחריות'), terms.slice(0, 80));
    await page.evaluate(() => { document.getElementById('infoDrawer').hidden = true; });
  }

  /* ---- boundaries as a function of (level, mode) --------------------------
     Read off the layers the map holds, level by level: what is drawn, and
     which single unit is black. */
  {
    await page.evaluate(async () => { if (S.wp) toggleWp(); if (S.cmp) toggleCmp(); if (S.cons) await toggleCons(); });
    const tally = () => page.evaluate(() => {
      const t = g => { if (!LG[g]) return { n: 0, black: 0 }; let n = 0, black = 0;
        LG[g].eachLayer(l => { n++; if (l.options.color === '#000000') black++; }); return { n, black }; };
      return { mun: t('lnMun'), fre: t('lnFre'), rg: !!LG.rgLine };
    });
    await page.evaluate(() => { if (S.regions) toggleRegions(); goDistrict(); }); await page.waitForTimeout(600);
    const l1 = await tally();
    ok('level 1: 18 black municipalities, no parish, no district line and no region line',
       l1.mun.n === 18 && l1.mun.black === 18 && l1.fre.n === 0 && !l1.rg
         && !(await page.evaluate(() => !!LG.lnDistrict)), JSON.stringify(l1));
    await page.evaluate(() => goMun(14)); await page.waitForTimeout(600);
    const l2 = await tally();
    ok('level 2: one black municipality of 18, its 16 parishes drawn, still no region line',
       l2.mun.n === 18 && l2.mun.black === 1 && l2.fre.n === 16 && !l2.rg, JSON.stringify(l2));
    await page.evaluate(() => goZone(D.freKey(D.freByMun.get(14)[0]))); await page.waitForTimeout(700);
    const l3 = await tally();
    ok('level 3: 18 grey municipalities, the 16 sibling parishes with exactly one black',
       l3.mun.n === 18 && l3.mun.black === 0 && l3.fre.n === 16 && l3.fre.black === 1 && !l3.rg, JSON.stringify(l3));
    ok('and nothing about boundaries is saved', await page.evaluate(() => {
      try { const o = JSON.parse(localStorage.getItem('porto') || '{}'); return !('lnMun' in o) && !('lnRegion' in o); } catch (e) { return true; } }));
    await page.evaluate(() => goDistrict()); await page.waitForTimeout(500);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
