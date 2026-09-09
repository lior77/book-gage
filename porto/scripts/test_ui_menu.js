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

  /* 5. geometry — every distance below is measured against the MAP's own box,
        not the screen's, because that is what the two are placed inside. */
  const menu = await box(page, '#menuBtn');
  const tools = await box(page, '#tools');
  const near = (a, b, t = 1.5) => Math.abs(a - b) <= t;
  ok('menu button is 20px below the map\'s top', near(menu.y - map.y, 20),
     `${(menu.y - map.y).toFixed(1)}px`);
  ok('menu button is 20px in from the map\'s right', near(map.right - menu.right, 20),
     `${(map.right - menu.right).toFixed(1)}px`);

  for (const [side, got] of [['top', tools.y - map.y], ['right', map.right - tools.right],
                             ['left', tools.x - map.x], ['bottom', map.bottom - tools.bottom]]) {
    ok(`the card is 10px in from the map's ${side}`, near(got, 10), `${got.toFixed(1)}px`);
  }
  ok('the card is under the menu button, not over it',
     Number(await css(page, '#tools', 'z-index')) < Number(await css(page, '#menuBtn', 'z-index')),
     `${await css(page, '#tools', 'z-index')} vs ${await css(page, '#menuBtn', 'z-index')}`);

  /* the buttons run down the card's start edge and stop 10px above its foot */
  const first = await box(page, '#viewBtn');
  const lastRow = await box(page, '.mt-row');
  ok('the top button is 10px in from the card\'s right',
     near(tools.right - first.right, 10), `${(tools.right - first.right).toFixed(1)}px`);
  ok('the top button clears the menu button above it', first.y >= menu.bottom - 1,
     `menu bottom ${menu.bottom.toFixed(1)}, first ${first.y.toFixed(1)}`);
  ok('the last row ends 10px above the card\'s foot',
     near(tools.bottom - lastRow.bottom, 10), `${(tools.bottom - lastRow.bottom).toFixed(1)}px`);
  ok('the row keeps the column\'s grid — same right edge',
     near(lastRow.right, first.right), `${lastRow.right.toFixed(1)} vs ${first.right.toFixed(1)}`);
  ok('the column is spread down the card, not bunched at the top',
     first.y < map.y + 100 && lastRow.y > tools.y + tools.h / 2,
     `first ${first.y.toFixed(1)}, row ${lastRow.y.toFixed(1)}, card ${tools.y.toFixed(1)}..${tools.bottom.toFixed(1)}`);

  /* 6. both sit on the tinted panel, and it is neither white nor transparent */
  const tint = await css(page, '#tools', 'background-color');
  const menuTint = await css(page, '#menuBtn', 'background-color');
  const rgb = s => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
  const bluish = s => { const [r, g, b] = rgb(s); return b > r && b > 200 - 1 ? true : b > r; };
  ok('strip has a tinted background', tint !== 'rgba(0, 0, 0, 0)' && tint !== 'rgb(255, 255, 255)', tint);
  ok('menu button carries the same hue', rgb(menuTint).join() === rgb(tint).join(),
     `${menuTint} vs ${tint}`);
  ok('the tint is bluish rather than neutral grey', bluish(tint), tint);
  /* half transparent: the map has to stay readable under the strip.  An opaque
     colour reports as rgb(...) with no fourth number, so the alpha is the
     check — not the eye, which cannot tell 50% grey from a lighter grey. */
  const alpha = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return 1;
                       const p = m[1].split(',').map(v => parseFloat(v));
                       return p.length > 3 ? p[3] : 1; };
  ok('the card is 40% opaque', Math.abs(alpha(tint) - 0.4) < 0.02, tint);
  ok('the menu button is not — it is the way back and never dims',
     alpha(menuTint) === 1, menuTint);

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

  /* 8. the switch line, in the order it was asked for — the layer list at the
        right end, then the five switches, then the add action */
  const order = ['#layerListBtn', '#layersBtn', '#wpBtn', '#fillsBtn',
                 '#bordersBtn', '#regionsBtn', '#addBtn'];
  const xs = [];
  for (const id of order) xs.push((await box(page, id)).x);
  ok('the line reads שכבות מפה · רקע · נ.צ. · צבעים · גבולות · אזורים · הוספה, right to left',
     xs.every((x, i) => i === 0 || x < xs[i - 1]), xs.map(Math.round).join(' > '));
  ok('all seven are on one row',
     (await Promise.all(order.map(id => box(page, id).then(b => b.y))))
       .every((y, _, a) => Math.abs(y - a[0]) < 2));
  ok('the layer list left the column for the line',
     await page.$eval('#layerListBtn', el => el.parentElement.className) === 'mt-row');

  /* the plain switches: pressed flips, and the map answers */
  for (const [id, name] of [['#layersBtn', 'רקע המפה'], ['#fillsBtn', 'צבע השטח'],
                            ['#regionsBtn', 'אזורים']]) {
    const was = await page.$eval(id, e => e.getAttribute('aria-pressed'));
    await page.click(id);
    await page.waitForTimeout(350);
    const now = await page.$eval(id, e => e.getAttribute('aria-pressed'));
    ok(`${name}: one tap flips it`, now !== was, `${was} -> ${now}`);
    await page.click(id);                       // put it back
    await page.waitForTimeout(350);
  }

  /* 8b. the boundaries button is a four-state cycle, not a switch.  Read the
         rings the way an eye does — the resolved stroke of each circle — and
         count the lines actually on the map, so a ring that lies about what is
         drawn fails here rather than looking right. */
  const ringOff = await page.$eval('#bordersBtn',
    el => getComputedStyle(el).getPropertyValue('--ring-off').trim());
  const accent = await page.$eval('#bordersBtn',
    el => getComputedStyle(el).getPropertyValue('--accent').trim());
  ok('the rings have their own widths, 3 · 2 · 1 outside in',
     (await page.$$eval('#bordersBtn circle',
        els => els.map(e => getComputedStyle(e).strokeWidth)))
       .join(' ') === '3px 2px 1px');
  ok('גבולות has no aria-pressed — four states cannot be a pressed flag',
     await page.$eval('#bordersBtn', el => el.getAttribute('aria-pressed')) === null);

  const ringState = () => page.evaluate(off => {
    const hex = c => {                     // getComputedStyle gives rgb()
      const m = c.match(/\d+/g);
      return m ? '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('') : c;
    };
    const want = off.toLowerCase();
    return [...document.querySelectorAll('#bordersBtn circle')]
      .map(e => hex(getComputedStyle(e).stroke).toLowerCase() === want ? 'off' : 'on')
      .join(' ');
  }, ringOff);
  const drawn = () => page.evaluate(() => {
    const w = [...document.querySelectorAll('#map path')]
      .filter(p => (p.getAttribute('stroke') || '').toLowerCase() !== '#e2761b')
      .map(p => Number(p.getAttribute('stroke-width')));
    return { district: w.includes(3.2), mun: w.includes(2.1), fre: w.includes(1) };
  });

  ok('by default all three rings are blue', await ringState() === 'on on on',
     await ringState());
  ok('and all three levels are on the map',
     JSON.stringify(await drawn()) === '{"district":true,"mun":true,"fre":true}',
     JSON.stringify(await drawn()));

  const steps = [
    ['first tap drops גבול המחוז, outer ring goes dark',  'off on on',
     '{"district":false,"mun":true,"fre":true}'],
    ['second tap brings it back and drops the עיריות',    'on off on',
     '{"district":true,"mun":false,"fre":true}'],
    ['third tap does the same for the רובעים',            'on on off',
     '{"district":true,"mun":true,"fre":false}'],
    ['a fourth tap comes back to all three',              'on on on',
     '{"district":true,"mun":true,"fre":true}'],
  ];
  for (const [name, rings, lines] of steps) {
    await page.click('#bordersBtn');
    await page.waitForTimeout(450);
    const r = await ringState(), d = JSON.stringify(await drawn());
    ok(name, r === rings && d === lines, `rings ${r}, map ${d}`);
  }
  ok('a dark ring is not the blue one', ringOff !== accent, `${ringOff} / ${accent}`);

  /* 8c. the stack.  Bottom to top: map, regions, district, municipalities,
         parishes — and it has to hold at every level, which is why it is panes
         and not draw order.  Read the resolved z-index of the pane each line
         actually landed in, at all three levels in turn. */
  if (await page.$eval('#regionsBtn', e => e.getAttribute('aria-pressed')) === 'false') {
    await page.click('#regionsBtn'); await page.waitForTimeout(500);
  }
  const stack = () => page.evaluate(() => {
    const w = { 4: 'region', 3.2: 'district', 2.1: 'mun', 1: 'fre' };
    const seen = {};
    for (const el of document.querySelectorAll('#map path')) {
      const kind = w[Number(el.getAttribute('stroke-width'))];
      if (!kind || seen[kind]) continue;
      const pane = el.closest('.leaflet-pane');
      seen[kind] = { pane: pane && pane.className.replace(/leaflet-\S+\s*/g, '').trim(),
                     z: Number(getComputedStyle(pane).zIndex) };
    }
    return seen;
  });
  const inOrder = st => ['region', 'district', 'mun', 'fre'].every((k, i, a) =>
    st[k] && (i === 0 || st[k].z > st[a[i - 1]].z));

  for (const [name, go] of [
        ['level 1 (המחוז)', null],
        ['level 2 (עירייה)', () => page.evaluate(() => goMun(13))],
        ['level 3 (רובע)', () => page.evaluate(() => goZone(
            D.freKey(D.fre.find(f => f.mun_num === 13))))],
      ]) {
    if (go) { await go(); await page.waitForTimeout(900); }
    const st = await stack();
    ok(`stack holds at ${name}: אזורים < מחוז < עיריות < רובעים`, inOrder(st),
       ['region', 'district', 'mun', 'fre']
         .map(k => `${k} ${st[k] ? st[k].z : '—'}`).join('  '));
  }
  await page.evaluate(() => goDistrict());
  await page.waitForTimeout(700);
  await page.click('#regionsBtn'); await page.waitForTimeout(400);

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

  /* the panel sets one level at a time; the rings have to follow that too */
  await page.click('#layerListBtn');
  await page.waitForTimeout(300);
  await page.click('#panelBody [data-lay="ln:mun"]');
  await page.waitForTimeout(400);
  ok('a level switched off in the panel darkens its ring too',
     await ringState() === 'on off on', await ringState());
  await page.click('#panelBody [data-lay="ln:mun"]');
  await page.waitForTimeout(400);
  await page.click('#panelClose');
  await page.waitForTimeout(200);

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
  if (await page.$eval('#wpBtn', e => e.getAttribute('aria-pressed')) === 'true') {
    await page.click('#wpBtn'); await page.waitForTimeout(400);
  }
  await page.evaluate(() => goDistrict());
  await page.waitForTimeout(800);
  const lead = await page.$eval('#doc .lead', el => el.textContent);
  const shownStats = await page.$$eval('#doc .stats .stat-v', els => els.map(e => e.textContent.trim()));
  ok('the lead repeats no figure from the table below it',
     shownStats.every(v => !lead.includes(v.replace(/[^\d,.]/g, ''))),
     `lead "${lead.trim().slice(0, 60)}…" vs ${shownStats.join(' / ')}`);
  ok('and the figures are still on the page, in the table',
     shownStats.length >= 3, shownStats.join(' / '));

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
