/* מחוז פורטו — split-screen app.
   Data: data/processed/*.json, built by scripts/build.py from the source
   document's own texts, CAOP 2020 boundaries, INE Censos 2021 and OSM.
   Nothing here is invented: a field with no value renders "אין נתון", and every
   number carries the source and the reference year it came with.

   Three levels, one screen split in two:
     district   18 numbered municipalities + the two NUTS III outlines
     mun        that municipality's numbered parishes
     zone       inside one parish: lettered localities + black landmark dots
*/
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const MISSING = 'אין נתון';
const KEY = 'porto-split-v1';

const S = {
  level: 'district',   // district | mun | zone
  mun: null,           // municipality number, 1..18
  zone: null,          // level 3: the parish key, "mun_num|name"
  tiles: true,
  fPort: 52,           // the map's share of the split, per orientation
  fLand: 46,
  cats: null,          // level 3: which landmark categories are shown
  hi: null,            // { kind, id } — the record highlighted on both halves
  view: 'split',       // split | map | text — which half fills the screen
  viewBefore: null,    // the layout to restore after placing a point
  letters: true,       // draw the locality letters
  water: true,         // rivers and lakes
  muncol: true,        // the 18 municipality colours (the outlines stay either way)
  mine: true,          // draw the points the user added
  photos: true,        // draw the ones that carry a photo (their own layer)
  // The four boundary layers.  Each is drawn at every level and switched on
  // its own; the level decides which of them are black and which recede.
  lnRegion: true,      // the two NUTS III regions
  lnDistrict: true,    // Porto district
  lnMun: true,         // the 18 municipalities
  lnFre: true,         // the 243 parishes
  adding: false,       // waiting for a tap on the map to place a new point
};
const MINE_KEY = 'porto-mine-v1';
const D = {};

/* ------------------------------------------------------------ formatting --- */
const nf = (v, dec) => v === null || v === undefined ? MISSING
  : new Intl.NumberFormat('he-IL', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }).format(v);
const html = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// CAOP spells the merged parishes "União das freguesias de X"; the source
// document and porto_city.json both use the bare X.
// The number printed for a municipality is its official one — the last two
// digits of the DICOFRE code — not a number the app made up. `num` is still the
// identity everything is keyed on internally; it is never shown.
const munCode = m => (m && m.code) || String(m && m.num || '');
const bare = s => String(s || '').replace(/^União das freguesias de\s+/i, '');
const latlng = c => [c[1], c[0]];   // *.center is [lon,lat]; *.ll is already [lat,lon]

/* A colour per category, so a dot says what it is before it is tapped.  Nine
   hues that hold up on a light map, on a dark one, and on bare background when
   the tiles are off; landmarks keep the black they had, because they are the
   largest group by far and a neutral reads as "everything else". */
const CAT_COLOUR = {
  station: '#1a73e8', hospital: '#d93025', university: '#7b1fa2',
  museum: '#c2790b', culture: '#d81b60', market: '#f57c00',
  civic: '#455a64', landmark: '#101010', green: '#2e7d32',
};
const MINE_COLOUR = '#00897b';

/* ------------------------------------------------------------ boundaries --- */
/* Four layers, one per kind of border, each drawn at every level and switched
   on its own.  What changes with the level is not which lines exist but which
   of them are being read: the ones that belong to the level are black, and the
   rest drop to half black so they stay available as context without competing
   with what is being looked at.

   Three widths, and only three, so the hierarchy is the same everywhere: a
   region or the district is 3.2, a municipality 2.1, a parish 1.  A boundary
   does not change weight because of what is selected — selection is a fill and
   a highlight colour, which is a different question from what kind of border
   this is. */
const LINE_W = { region: 3.2, district: 3.2, mun: 2.1, fre: 1 };
const LINE_BLACK = {
  district: ['district', 'mun'],   // level 1: the district and its municipalities
  mun: ['mun', 'fre'],             // level 2: the municipality and its parishes
  zone: ['fre'],                   // level 3: the parish
};
const LINE_ON = { region: 'lnRegion', district: 'lnDistrict',
                  mun: 'lnMun', fre: 'lnFre' };
const LINE_HE = { region: 'גבולות האזורים', district: 'גבול מחוז פורטו',
                  mun: 'גבולות העיריות', fre: 'גבולות הרובעים' };

/* Black, and black at 50% for the rest — a grey of its own would be a third
   colour to keep in step, and half of the line is exactly what "recedes" means.

   In the dark theme it inverts.  "Black" there is a line on a near-black map,
   which is not a quiet line but an absent one; what was asked for is the
   strongest contrast the background allows, and that flips with the
   background.  The same 50% then does the same job. */
const lineColour = kind => {
  const own = (LINE_BLACK[S.level] || []).indexOf(kind) >= 0;
  return isDark()
    ? (own ? '#ffffff' : 'rgba(255,255,255,.5)')
    : (own ? '#000000' : 'rgba(0,0,0,.5)');
};

/* Drawn after the filled shapes of whichever level is on screen, so a boundary
   is never buried under a fill.  The fills carry no stroke of their own any
   more — every line on the map comes from here. */
function drawLines() {
  ['lnRegion', 'lnDistrict', 'lnMun', 'lnFre'].forEach(k => {
    if (LG[k]) { map.removeLayer(LG[k]); delete LG[k]; }
  });
  const style = kind => ({ color: lineColour(kind), weight: LINE_W[kind],
    opacity: .95, fill: false, lineJoin: 'round', lineCap: 'round' });

  if (S.lnFre) {
    LG.lnFre = L.geoJSON(D.bF, { interactive: false, style: () => style('fre') })
      .addTo(map);
  }
  if (S.lnMun) {
    LG.lnMun = L.geoJSON(D.bM, { interactive: false, style: () => style('mun') })
      .addTo(map);
  }
  // The regions and the district share one file; each feature says which it is.
  // The district goes in the pane above, so where the three follow the same
  // border the district is the one that stays whole.
  const pick = kind => ({ type: 'FeatureCollection',
    features: D.bB.features.filter(ft => (ft.properties.kind === 'nuts3'
      ? 'region' : 'district') === kind) });
  if (S.lnRegion) {
    LG.lnRegion = L.geoJSON(pick('region'), {
      interactive: false, style: () => style('region') }).addTo(map);
  }
  if (S.lnDistrict) {
    LG.lnDistrict = L.geoJSON(pick('district'), {
      pane: 'district', interactive: false,
      style: () => style('district') }).addTo(map);
  }
}

function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/* A number, its unit, and the year it refers to — the year is on screen next to
   every value, and the whole chip opens the full source record. */
// The two Censos 2021 blocks. Both cards show the same figures at their own
// level, and one source record covers each block, because every figure inside
// it comes out of the same INE file, the same table and the same year.
function peopleStats(o, lvl) {
  return `<div class="card">
    <h2>אנשים — מפקד 2021</h2>
    <div class="stats">
      ${stat('גיל חציוני', o.median_age, 'שנים', 0, lvl + '.median_age')}
      ${stat('בני 0–14', o.pct_0_14, '%', 0, lvl + '.pct_0_14')}
      ${stat('בני 65+', o.pct_65plus, '%', 0, lvl + '.pct_65plus')}
      ${stat('מדד הזדקנות', o.ageing_index, '', 0, lvl + '.ageing_index')}
      ${stat('אזרחות זרה', o.foreign_pct, '%', 0, lvl + '.foreign_pct')}
      ${stat('השכלה גבוהה', o.education_pct, '%', 0, lvl + '.education_pct')}
      ${stat('אבטלה', o.unemployment_pct, '%', 0, lvl + '.unemployment_pct')}
    </div>
    <p class="note">הגיל החציוני מחושב מפסי גיל של חמש שנים — INE לא מפרסם חציון
      בקובץ הזה. מדד הזדקנות הוא בני 65 ומעלה לכל מאה בני 0–14.</p>
  </div>`;
}
function housingStats(o, lvl) {
  const h = o.housing;
  if (!h) return '';
  const k = lvl + '.housing';
  return `<div class="card">
    <h2>דיור ובניינים — מפקד 2021</h2>
    <div class="stats">
      ${stat('דירות', h.dwellings, '', 0, k)}
      ${stat('דירות ריקות', h.vacant_pct, '%', 1, k)}
      ${stat('בית שני', h.second_home_pct, '%', 1, k)}
      ${stat('בבעלות הדיירים', h.owner_pct, '%', 1, k)}
      ${stat('בשכירות', h.rented_pct, '%', 1, k)}
      ${stat('עם חניה', h.parking_pct, '%', 1, k)}
      ${stat('בניינים', h.buildings, '', 0, k)}
      ${stat('זקוקים לתיקון', h.repair_pct, '%', 1, k)}
      ${stat('מהם תיקון עמוק', h.deep_repair_pct, '%', 1, k)}
      ${stat('נבנו לפני 1946', h.pre1946_pct, '%', 1, k)}
      ${stat('נבנו מ-2011', h.since2011_pct, '%', 1, k)}
    </div>
    <p class="note">׳זקוקים לתיקון׳ כולל אצל INE גם תיקונים קלים, ולכן האחוז גבוה
      כמעט בכל מקום; השורה שמתחתיו — תיקון עמוק — היא זו שמעידה על מצב הבניין.</p>
  </div>`;
}

/* `step` rounds the figure that is shown — to the nearest 100 for a headcount,
   to a whole number for a percentage.  A census total carried to the person
   invites a precision it does not have at this scale, and a density of 4 993
   reads as measured when it is a division of one estimate by another.

   The exact value is not lost: it rides on the button as data-exact and the
   source panel prints it, so the number on screen is readable and the number
   the source published is one tap away.  Rounding what is displayed is fine;
   rounding what is recorded would not be. */
function shown(val, dec, step) {
  if (!step) return nf(val, dec);
  return nf(Math.round(val / step) * step, 0);
}

function stat(label, val, unit, dec, srcKey, step) {
  const f = D.sources.fields[srcKey] || {};
  const has = val !== null && val !== undefined;
  const text = has ? shown(val, dec, step) : MISSING;
  // Only when rounding actually changed something.  Porto's census population
  // is 231 800 to begin with, and offering "the exact value" beside an
  // identical figure would make the panel look like it was hiding one.
  const exact = has ? nf(val, val === Math.round(val) ? 0 : 2) : '';
  // One figure per line: label, value, year. Four tiles side by side made the
  // numbers compete with each other and wrapped their units onto a second line.
  return `<button class="stat${has ? '' : ' no'}" data-src="${html(srcKey)}"${
      exact && exact !== text ? ` data-exact="${html(exact)}"` : ''}>
    <span class="stat-l">${html(label)}</span>
    <span class="stat-v ${has ? 'num' : ''}">${text}${
      has && unit ? ' <span class="stat-u">' + html(unit) + '</span>' : ''}</span>
    <span class="stat-y">${f.reference_year ? html(f.reference_year) : 'מקור'}</span>
  </button>`;
}

/* ------------------------------------------------------------- load data --- */
// scripts/bundle_standalone.py inlines every data file into window.PORTO_DATA,
// so the same code runs from a server, from one file on file://, and from a
// published page that is not allowed to fetch anything.
const STANDALONE = typeof window.PORTO_DATA === 'object' && window.PORTO_DATA !== null;

async function j(path) {
  if (STANDALONE) {
    if (!(path in window.PORTO_DATA)) throw new Error('missing inlined ' + path);
    return window.PORTO_DATA[path];
  }
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' → ' + r.status);
  return r.json();
}

async function load() {
  const [ind, mun, fre, city, zones, bW, sources, bM, bB, bF, bC] = await Promise.all([
    j('data/processed/indicators.json'),
    j('data/processed/municipios.json'),
    j('data/processed/freguesias.json'),
    j('data/processed/porto_city.json'),
    j('data/processed/zones.json'),
    j('data/processed/boundaries_water.geojson'),
    j('data/sources.json'),
    j('data/processed/boundaries_municipios.geojson'),
    j('data/processed/boundaries_belts.geojson'),
    j('data/processed/boundaries_freguesias.geojson'),
    j('data/processed/boundaries_porto_city.geojson'),
  ]);
  D.belts = mun.belts;
  D.mun = mun.items;
  D.fre = fre.items;
  D.city = city.quarters;
  D.zones = zones.zones;
  D.sources = sources;
  D.generated = mun.generated;
  D.version = ind.app_version || '';
  D.bM = bM; D.bB = bB; D.bF = bF; D.bC = bC; D.bW = bW;
  // an undefined layer renders as nothing at all, in silence; say so instead
  for (const [k, v] of Object.entries({ bM, bB, bF, bC, bW })) {
    if (!v || !Array.isArray(v.features)) throw new Error('layer ' + k + ' did not load');
  }

  D.munByNum = new Map(D.mun.map(m => [m.num, m]));
  D.freKey = f => f.mun_num + '|' + f.pt;
  D.freByKey = new Map(D.fre.map(f => [D.freKey(f), f]));
  D.freByMun = new Map();
  D.fre.forEach(f => {
    if (!D.freByMun.has(f.mun_num)) D.freByMun.set(f.mun_num, []);
    D.freByMun.get(f.mun_num).push(f);
    f.mun_he = D.munByNum.get(f.mun_num).he;
  });
  D.freByMun.forEach(list => list.sort((a, b) => freOrder(a).localeCompare(freOrder(b))));
  D.quarterByNum = new Map(D.city.map(q => [q.num, q]));
  // Porto's seven parishes *are* the seven city quarters; keep one numbering
  // for both so level 2 and level 3 agree.
  D.quarterOfFre = new Map(D.city.map(q => [q.en, q.num]));
  D.fre.filter(f => f.mun_num === 1).forEach(f => { f.q = D.quarterOfFre.get(bare(f.pt)) || null; });
  // Porto's parishes are ordered by their official code like everyone else's;
  // f.q stays as the link to the city quarter's 53 bairros, not as a label.
  D.totPop = D.mun.reduce((a, m) => a + (m.pop2021 || 0), 0);
  D.totArea = D.mun.reduce((a, m) => a + (m.area_km2 || 0), 0);
  D.totPoi = D.city.reduce((a, q) => a + q.pois.length, 0);
}

/* ------------------------------------------------------------------- map --- */
let map, tileLayer;
const LG = {};                      // the layers currently on the map
let fitBounds = null;               // what the "fit" button goes back to

// the contour that says "this is the municipality you picked": solid, not the
// translucent line every other boundary uses, or it disappears among them

function initMap() {
  map = L.map('map', {
    // Every gesture stays on: the map can be panned, pinched and zoomed
    // freely inside its half, and the divider changes how big that half is.
    // no +/- buttons: pinch, double tap and the fit control cover it, and the
    // corner they took is worth more to the map than to a duplicate gesture
    zoomControl: false, attributionControl: false,
    dragging: true, touchZoom: true, scrollWheelZoom: true, doubleClickZoom: true,
    boxZoom: false, keyboard: true, tap: true,
    minZoom: 7, maxZoom: 19,
    // the district and the city are both wide and short; with whole-number
    // zoom only, fitBounds lands a level short and leaves them half-size
    zoomSnap: 0.25, zoomDelta: 0.5,
  });
  map.setView([41.22, -8.35], 9);

  tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, crossOrigin: true, attribution: '© OpenStreetMap contributors',
  });
  // No connection, or a host that will not load third-party images: drop the
  // background rather than leave the user staring at empty grey squares.
  let errs = 0;
  tileLayer.on('tileerror', () => {
    if (++errs < 6 || !map.hasLayer(tileLayer)) return;
    map.removeLayer(tileLayer);
    S.tiles = false;
    mapNote('רקע המפה לא נטען — מוצגים הגבולות בלבד. כל הנתונים והטקסטים זמינים.',
            false, true);
  });
  if (S.tiles) tileLayer.addTo(map);

  // The map half changes size when the divider moves and when the phone turns.
  new ResizeObserver(() => {
    if (map._rafSize) cancelAnimationFrame(map._rafSize);
    map._rafSize = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
  }).observe($('#map'));
}

const NAT = {};   // the two layers that belong to every level, not to one

function initNature() {
  // Their own pane, above the filled boundaries so a river is not buried under
  // a parish colour, below the markers so it never covers a letter or a dot.
  map.createPane('nature');
  map.getPane('nature').style.zIndex = 450;
  map.getPane('nature').style.pointerEvents = 'none';

  // The district line sits above the region lines: where the two follow the
  // same border the district is the one that stays whole, and the regions
  // step aside for it rather than the other way round.
  map.createPane('district');
  map.getPane('district').style.zIndex = 460;
  map.getPane('district').style.pointerEvents = 'none';

  NAT.water = L.geoJSON(D.bW, {
    pane: 'nature', interactive: false,
    style: ft => /LineString/.test(ft.geometry.type)
      ? { color: '#2f7fc1', weight: 1.8, opacity: .85, fill: false }
      : { color: '#2f7fc1', weight: .8, opacity: .8, fillColor: '#4a9ad4', fillOpacity: .55 },
  });
  applyNature();
}
function applyNature() {
  [['water', S.water]].forEach(([k, on]) => {
    if (!NAT[k]) return;
    if (on && !map.hasLayer(NAT[k])) NAT[k].addTo(map);
    if (!on && map.hasLayer(NAT[k])) map.removeLayer(NAT[k]);
  });
}

function clearMap() {
  Object.keys(LG).forEach(k => { if (LG[k]) { map.removeLayer(LG[k]); delete LG[k]; } });
}

function numIcon(text, cls) {
  // Official codes are two digits, and a unit the 2025 reform split shows its
  // first successor with a plus — three characters, which need a wider pill or
  // they spill out of the circle Leaflet sizes from iconSize.
  const w = String(text).length > 2 ? 28 : 20;
  return L.divIcon({
    className: 'lbl' + (cls ? ' ' + cls : ''), html: html(text),
    iconSize: [w, 20], iconAnchor: [w / 2, 10],
  });
}

function fit(b, pad) {
  if (!b || !b.isValid()) return;
  fitBounds = b;
  map.fitBounds(b, { padding: pad || [16, 16] });
}
function refit() { if (fitBounds) map.fitBounds(fitBounds, { padding: [16, 16] }); }

/* ------------------------------------------------------------- where am I --- */
/* The device position, from the browser's own geolocation API.  It is read on
   the phone and drawn on the phone: nothing here sends a coordinate anywhere,
   there is no server to send it to, and the app keeps no history of it.
   The browser only hands it over on a secure origin (https, or localhost) and
   only after the user says yes; opened as a file:// page it is refused, and
   that refusal is reported rather than swallowed. */
let meMark = null, meRing = null, meWatch = null;
// whether the map has already been moved to this run's first fix
let meCentred = false;

function ringInside(pt, ring) {
  // ray casting; ring is [[lon,lat],...]
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polyHas(pt, coords, type) {
  const polys = type === 'Polygon' ? [coords] : coords;
  return polys.some(rings =>
    ringInside(pt, rings[0]) && !rings.slice(1).some(h => ringInside(pt, h)));
}
// Which parish is this point in?  The polygons are the official CAOP ones the
// app already draws, so the answer is as good as the boundary itself.
function freguesiaAt(lat, lon) {
  const pt = [lon, lat];
  for (const ft of D.bF.features) {
    if (polyHas(pt, ft.geometry.coordinates, ft.geometry.type)) {
      return D.freByKey.get(ft.properties.mun_num + '|' + ft.properties.name) || null;
    }
  }
  return null;
}

/* Every message the app has to give lands in the same place: the top of the
   text half.  Over the map they covered the thing being talked about, and on a
   phone in map-only view there was nowhere for them to go. */
/* Almost every message here answers something the user just pressed, so it
   opens the text half to be read.  A message that arrives on its own — a tile
   that would not load — passes `quiet`, because taking the screen back from a
   layout the user had just chosen is worse than the notice is useful. */
function mapNote(inner, bad, quiet) {
  const n = $('#msgs');
  n.innerHTML = `<div class="msg${bad ? ' bad' : ''}">
      <div class="msg-body">${inner}</div>
      <button class="msg-x" type="button" data-close="1" aria-label="סגירת ההודעה">✕</button>
    </div>`;
  if (quiet) return;
  if (S.view === 'map') { S.view = 'split'; applyView(); save(); }
  $('#paneText').scrollTop = 0;
}
function hideNote() { $('#msgs').innerHTML = ''; }

function showMe(pos) {
  const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
  const ll = [lat, lon];
  if (!meMark) {
    meMark = L.marker(ll, {
      icon: L.divIcon({ className: 'me', iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false, keyboard: false, zIndexOffset: 900,
    }).addTo(map);
    // the accuracy circle is the honest part: a phone indoors can be 200 m out
    meRing = L.circle(ll, { radius: acc, color: '#1a73e8', weight: 1,
      fillColor: '#1a73e8', fillOpacity: .12, interactive: false }).addTo(map);
  } else {
    meMark.setLatLng(ll);
    meRing.setLatLng(ll).setRadius(acc);
  }

  // Move the map to the first fix and then leave it alone, at whatever zoom
  // the user had: showing where you are is not a reason to change how much of
  // the district you can see, and a watch that re-centres on every update
  // takes the map away from anyone trying to read it.
  const first = !meCentred;
  meCentred = true;

  const f = freguesiaAt(lat, lon);
  const m = f ? D.munByNum.get(f.mun_num) : null;
  if (f) {
    if (first) map.panTo(ll);
    mapNote(`אתה ב<b>${html(f.he || f.pt)}</b>, ${html(m.he)} ·
      דיוק ${nf(Math.round(acc))} מ׳
      <button type="button" data-jump="fre:${html(D.freKey(f))}">פתיחת הרובע</button>`);
  } else {
    // Anywhere else on earth: say so, and say how far, instead of dropping the
    // map on an empty spot in the ocean.
    const km = Math.round(map.distance(ll, [41.14961, -8.61099]) / 1000);
    if (first) map.panTo(ll);
    mapNote(`המיקום שלך אינו בתוך מחוז פורטו — כ-${nf(km)} ק״מ ממרכז פורטו.
      דיוק ${nf(Math.round(acc))} מ׳.
      <button type="button" data-loc="back">חזרה למפת המחוז</button>`, true);
  }
}

function locError(err) {
  stopLocate();
  const why = {
    1: 'לא ניתנה הרשאת מיקום. אפשר לאשר אותה מהאייקון שליד כתובת האתר בדפדפן.',
    2: 'הטלפון לא הצליח לקבוע מיקום. כדאי לבדוק שה-GPS דלוק ולנסות שוב בחוץ.',
    3: 'קביעת המיקום ארכה יותר מדי. נסה שוב.',
  }[err && err.code] || 'לא הצלחתי לקבל מיקום.';
  mapNote(why, true);
}

function stopLocate() {
  meCentred = false;
  if (meWatch !== null) { navigator.geolocation.clearWatch(meWatch); meWatch = null; }
  if (meMark) { map.removeLayer(meMark); meMark = null; }
  if (meRing) { map.removeLayer(meRing); meRing = null; }
  $('#locBtn').setAttribute('aria-pressed', 'false');
}

function toggleLocate() {
  if (meWatch !== null) { stopLocate(); hideNote(); return; }
  if (!navigator.geolocation) {
    mapNote('הדפדפן הזה לא תומך באיתור מיקום.', true); return;
  }
  // https or localhost only.  Saying this plainly beats a silent failure that
  // looks like a bug: the standalone file opened from the phone's storage is
  // a file:// page, and no browser will hand it a position.
  if (!window.isSecureContext) {
    mapNote(`הדפדפן נותן מיקום רק בחיבור מאובטח. הדף הזה נפתח מ־
      <span class="lat">${html(location.protocol)}</span>, ולכן המיקום חסום.
      הקישור המקוון (https) יעבוד.`, true);
    return;
  }
  $('#locBtn').setAttribute('aria-pressed', 'true');
  mapNote('מחפש מיקום…');
  meWatch = navigator.geolocation.watchPosition(showMe, locError, {
    enableHighAccuracy: true, maximumAge: 15000, timeout: 20000,
  });
}

/* --------------------------------------------------------- level 1: מחוז --- */
function drawDistrict() {
  clearMap();
  LG.mun = L.geoJSON(D.bM, {
    style: ft => ({
      // no stroke: every boundary on the map is drawn by drawLines()
      weight: 0, opacity: .9,
      fillColor: (D.munByNum.get(ft.properties.num) || {}).fill || '#ddd',
      // solid, and a switch that empties the fill without losing the outline
      fillOpacity: S.muncol ? 1 : 0,
    }),
    onEachFeature: (ft, l) => {
      const m = D.munByNum.get(ft.properties.num);
      l.on('click', () => {
        if (S.adding) return;
        if (isSecondTap('mun:' + m.num)) { openInGoogle(latlng(m.center), m.he); return; }
        goMun(ft.properties.num);
      });
      l.bindTooltip(`<b>${html(munCode(m) + ' · ' + m.he)}</b><br><span class="lat">${html(m.pt)}</span>`,
        { sticky: true, className: 'tt' });
    },
  }).addTo(map);

  drawLines();

  LG.labels = L.layerGroup(D.mun.map(m => {
    const mk = L.marker(latlng(m.center), { icon: numIcon(munCode(m)), keyboard: false,
      title: munCode(m) + ' · ' + m.he, riseOnHover: true });
    mk.on('click', () => {
      if (S.adding) return;
      if (isSecondTap('mun:' + m.num)) { openInGoogle(latlng(m.center), m.he); return; }
      goMun(m.num);
    });
    return mk;
  })).addTo(map);

  fit(LG.mun.getBounds());
}

function renderDistrict() {
  const beltRows = D.belts.map(b => `<div class="belt">
      <span class="belt-sw" style="--c:${html(b.colour)}"></span>
      <span class="row-body">
        <span class="row-t">${html(b.he)} <span class="lat">(${html(b.en)})</span></span>
        <span class="row-d">${html(b.sub_he)}</span>
        <span class="row-m num">${html(b.nums.map(n => munCode(D.munByNum.get(n))).sort().join(' · '))}</span>
      </span></div>`).join('');

  const list = D.mun.slice().sort((a, b) => munCode(a).localeCompare(munCode(b))).map(m => {
    const chr = (m.profile.find(p => p.label === 'אופי') || {}).text || '';
    return `<button class="row" data-mun="${m.num}">
      <span class="pin" style="--c:${html(m.fill)}">${html(munCode(m))}</span>
      <span class="row-body">
        <span class="row-t">${html(m.he)} <span class="lat">(${html(m.en)})</span></span>
        <span class="row-d">${html(chr)}</span>
        <span class="row-m">${html(m.belt)} · <span class="num">${shown(m.pop2021, 0, 100)}</span> תושבים ·
          <span class="num">${nf(m.area_km2, 1)}</span> קמ״ר ·
          <span class="num">${nf(m.n_freguesias)}</span> רובעים</span>
      </span>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
    </button>`;
  }).join('');

  $('#doc').innerHTML = `
    <div class="card">
      <h1>מחוז פורטו <span class="en lat">(Distrito do Porto)</span></h1>
      <p class="lead">18 עיריות ו-243 רובעים בצפון-מערב פורטוגל, מהאוקיינוס האטלנטי
        במערב ועד הרי מראו במזרח. זהו המחוז הצפוף במדינה: כאן חיים
        <span class="num">${shown(D.totPop, 0, 100)}</span> תושבים על
        <span class="num">${nf(D.totArea, 1)}</span> קמ״ר.</p>
      <div class="stats">
        ${stat('תושבים', D.totPop, '', 0, 'municipio.pop2021', 100)}
        ${stat('שטח', D.totArea, 'קמ״ר', 1, 'municipio.area_km2')}
        ${stat('צפיפות', D.totPop / D.totArea, 'לקמ״ר', 0, 'municipio.density', 100)}
      </div>
      <p class="note">כל מספר באפליקציה נלחץ ומציג את המקור ואת שנת הייחוס שלו.
        המספרים על המפה הם קודי DICOFRE הרשמיים.</p>
    </div>

    <div class="card">
      <h2>שני האזורים <span class="en lat">(NUTS III)</span></h2>
      <p class="sub">החלוקה הרשמית של המחוז, וזו שלפיה INE מפרסם. קו בצבע האזור
        מקיף במפה את העיריות שבו.</p>
      ${beltRows}
      <p class="note">שני האזורים גדולים ממה שמצויר כאן: לאזור המטרופוליטני
        17 עיריות ולטאמגה אה סוזה 11, והשאר יושבות במחוזות אוויירו וויזאו.
        האפליקציה מראה את החלק שבתוך מחוז 13 בלבד.</p>
    </div>

    <div class="grp">18 העיריות — לפי המספור במפה</div>
    <div class="rows">${list}</div>
    ${mineList(null)}`;
  $('#paneText').scrollTop = 0;
}

/* ---------------------------------------------------- level 2: העירייה --- */
function freFeatures(num) {
  if (num === 1) return D.bC;      // Porto: the seven quarters, already numbered
  return { type: 'FeatureCollection',
    features: D.bF.features.filter(ft => ft.properties.mun_num === num) };
}
function freOfFeature(num, props) {
  if (num === 1) {
    const q = D.quarterByNum.get(props.num);
    return D.fre.find(f => f.mun_num === 1 && bare(f.pt) === q.en);
  }
  return D.freByKey.get(props.mun_num + '|' + props.name);
}
// The number the app prints for a parish is the official one: the parish half
// of its DICOFRE code (131202 -> 02), as INE counted it in 2021. The 25 units
// the 2025 reform dissolved keep the code they held until then — it is the
// code their figures were published under, and the card says what replaced them.
const freNum = f => (f.code || '–');
// Sorting key, so a municipality's parish list runs in the official order.
const freOrder = f => (f.code || '99');
// One sentence for a unit the 2025 reform undid, naming its successors.
// Returns HTML, not text: each successor is its own LTR island, or the Hebrew
// paragraph around it reorders the code away from the name it belongs to.
function splitNote(f) {
  if (!f.split2025 || !f.split2025.length) return '';
  const kids = f.split2025.map(s =>
    `<span class="lat" dir="ltr">${html(s.pt)} (${html(s.dicofre)})</span>`).join(' · ');
  return 'ברפורמת 2025 חולק ל־' + f.split2025.length + ' רובעים נפרדים: ' + kids;
}
// The same split as a table, for the card: how the 2021 population divided
// between the parishes that replaced the unit. The shares come from the census
// sub-sections themselves, and they add up to the unit's own total exactly.
function splitTable(f) {
  const kids = (f.split2025 || []).filter(s => s.pop2021 != null);
  if (!kids.length) return '';
  return `<div class="card">
    <h2>מה החליף אותו — 2025</h2>
    <div class="rows">${kids.map(s => `<div class="row row-full">
      <span class="pin pin-sq" style="--c:#dfe6ef">${html(s.code)}</span>
      <span class="row-body">
        <span class="row-t lat" dir="ltr">${html(s.pt)}</span>
        <span class="row-m"><span class="num">${nf(s.pop2021)}</span> תושבים (2021) ·
          <span class="num">${nf(100 * s.pop2021 / f.pop2021, 1)}</span>% מהיחידה ·
          קוד <span class="lat num">${html(s.dicofre)}</span></span>
      </span></div>`).join('')}</div>
    <p class="note">החלוקה מגיעה מטבלת ההמרה של INE בין תת-המקטעים הסטטיסטיים של
      מפקד 2021 לגבולות 2025, וסכומה שווה בדיוק לאוכלוסיית היחידה כאן. הגבולות
      עצמם עדיין אינם באפליקציה — לכך צריך את CAOP 2025.</p>
  </div>`;
}

function drawMun(num) {
  clearMap();
  const rows = D.freByMun.get(num) || [];
  const colourOf = new Map(rows.map(f => [freNum(f), f.colour]));

  LG.fre = L.geoJSON(freFeatures(num), {
    style: ft => {
      const f = freOfFeature(num, ft.properties);
      return { weight: 0, opacity: .95,
        fillColor: (f && f.colour) || colourOf.get(ft.properties.num) || '#ddd', fillOpacity: .78 };
    },
    onEachFeature: (ft, l) => {
      const f = freOfFeature(num, ft.properties);
      if (!f) return;
      l.feature.__key = D.freKey(f);
      l.on('click', () => pickFre(f, 'map'));
      l.bindTooltip(`<b>${html(freNum(f) + '. ' + (f.he || f.pt))}</b><br><span class="lat">${html(bare(f.pt))}</span>`,
        { sticky: true, className: 'tt' });
    },
  }).addTo(map);

  drawLines();

  LG.labels = L.layerGroup(rows.map(f => {
    const mk = L.marker(latlng(f.center), { icon: numIcon(freNum(f)), keyboard: false,
      title: freNum(f) + '. ' + (f.he || f.pt), riseOnHover: true });
    mk.__key = D.freKey(f);
    mk.on('click', () => pickFre(f, 'map'));
    return mk;
  })).addTo(map);

  fit(LG.fre.getBounds());
}

function renderMun(num) {
  const m = D.munByNum.get(num);
  const rows = D.freByMun.get(num) || [];
  const isPorto = num === 1;

  const profile = m.profile.map(p =>
    `<div><dt>${html(p.label)}</dt><dd>${html(p.text)}</dd></div>`).join('');

  const list = rows.map(f => {
    const n = freNum(f);
    const q = isPorto ? D.quarterByNum.get(f.q) : null;
    const desc = q ? q.desc : (f.note || '');
    const flag = !q && f.note && f.note_origin === 'app'
      ? '<span class="flag">תיאור שנכתב לאפליקציה</span>' : '';
    const code = `<span class="lat num">${html(f.dicofre || '')}</span>`
      + (f.split2025 ? ' <span class="flag">פורק ב-2025</span>' : '');
    return `<button class="row row-full" data-fre="${html(D.freKey(f))}">
      <span class="pin" style="--c:${html(f.colour)}">${n}</span>
      <span class="row-body">
        <span class="row-t">${html(f.he || f.pt)} <span class="lat">(${html(bare(f.pt))})</span>${flag}</span>
        <span class="row-d">${desc ? html(desc) : '<span class="muted">' + MISSING + ' — אין תיאור לרובע הזו</span>'}</span>
        <span class="row-m"><span class="num">${shown(f.pop2021, 0, 100)}</span> תושבים (2021) ·
          <span class="num">${nf(f.area_km2, 2)}</span> קמ״ר ·
          <span class="num">${nf(f.density)}</span> לקמ״ר${q ? ' · <span class="num">' + q.bairros.length + '</span> שכונות' : ''}
          · ${code}</span>
        ${f.split2025 ? `<span class="row-m">${splitNote(f)}</span>` : ''}
      </span>
      ${q ? '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>' : ''}
    </button>`;
  }).join('');

  $('#doc').innerHTML = `
    <div class="card">
      <div class="hdr">
        <span class="pin" style="--c:${html(m.fill)}">${html(munCode(m))}</span>
        <div><h1>${html(m.he)} <span class="en lat">(${html(m.en)})</span></h1>
          <p class="sub">${html(m.belt)} · <span class="num">${nf(m.n_freguesias)}</span> רובעים${m.dicofre
            ? ' · קוד רשמי <span class="lat num">' + html(m.dicofre) + '</span>' : ''}</p></div>
      </div>
      <div class="stats">
        ${stat('תושבים', m.pop2021, '', 0, 'municipio.pop2021', 100)}
        ${stat('שטח', m.area_km2, 'קמ״ר', 1, 'municipio.area_km2')}
        ${stat('צפיפות', m.density, 'לקמ״ר', 0, 'municipio.density', 100)}
        ${stat('מפורטו', m.dist_porto_km, 'ק״מ', 1, 'municipio.dist_porto_km')}
      </div>
      <dl class="kv">${profile}
        <div><dt>תחבורה</dt><dd>${html(m.transport)}</dd></div></dl>
    </div>

    ${peopleStats(m, 'municipio')}
    ${housingStats(m, 'municipio')}

    <div class="grp">${rows.length} ${isPorto ? 'רבעי העיר' : 'הרובעים'} — לפי המספור במפה</div>
    ${isPorto ? '<p class="note" style="margin-block-end:8px">לחיצה על רובע פותחת אותו: השכונות שבתוכו באותיות, ואתרים ומוסדות כנקודות שחורות.</p>' : ''}
    <div class="rows">${list}</div>
    ${mineList(p => {
      const at = freguesiaAt(p.ll[0], p.ll[1]);
      return at && at.mun_num === num;
    })}
    <p class="note" style="margin-block-start:10px">המספר על כל רובע הוא הקוד
      הרשמי שלו בתוך העירייה, והרשימה מסודרת לפיו. רובע שמסומן
      <span class="flag">פורק ב-2025</span> חדל להתקיים כיחידה ברפורמת 2025, והקוד
      שלו הוא זה שהחזיק עד אז — בכרטיס שלו רשומים הרובעים שהחליפו אותו.</p>`;
  $('#paneText').scrollTop = 0;
}

/* ---------------------------------------------------------------- photos --- */
/* A point can carry one photo, and the photo is what places it: a picture taken
   on the spot knows where it was taken better than a finger dragging a pin
   across a map.  The EXIF block is read here in the browser and nothing is
   uploaded — there is still no server.

   The image does not go in localStorage.  That store is a few megabytes for the
   whole origin and one phone photo is three, so pictures live in IndexedDB as
   blobs keyed by the point's id, and the record in localStorage keeps only what
   the photo *is*: its size, when it was taken, and whether its own coordinates
   or the map pin placed the point.  Each photo is scaled to PHOTO_MAX on its
   long edge first — a Galaxy A56 frame goes from about 3 MB to about 300 KB and
   is still sharper than the panel can show.

   A GPS block can be present and still say nothing.  The photo this was built
   against — Galaxy A56, 2026-09-07 — carries a full GPSInfo IFD in which both
   refs are empty strings and every rational is 0/0, which is what Android
   writes when the camera's location tagging is off.  Read naively that decodes
   to 0°N 0°E, in the Atlantic south of Ghana, and the point would land there
   with no complaint at all.  gpsFrom rejects that shape and every other one
   that cannot be a real fix, and the form says the photo carried no location
   rather than moving the pin. */
const PHOTO_DB = 'porto-photos';
const PHOTO_STORE = 'img';
const PHOTO_MAX = 1600;         // long edge in px of the stored copy
const PHOTO_Q = 0.82;           // its JPEG quality
const PHOTO_COLOUR = '#8e24aa';

/* ---- the blob store ---- */
let photoDb = null;
function openPhotoDb() {
  if (photoDb) return Promise.resolve(photoDb);
  return new Promise((res, rej) => {
    if (!window.indexedDB) { rej(new Error('אין IndexedDB בדפדפן הזה')); return; }
    const rq = indexedDB.open(PHOTO_DB, 1);
    rq.onupgradeneeded = () => {
      if (!rq.result.objectStoreNames.contains(PHOTO_STORE))
        rq.result.createObjectStore(PHOTO_STORE);
    };
    rq.onsuccess = () => { photoDb = rq.result; res(photoDb); };
    rq.onerror = () => rej(rq.error);
  });
}
function photoTx(mode, fn) {
  return openPhotoDb().then(db => new Promise((res, rej) => {
    let rq;
    const tx = db.transaction(PHOTO_STORE, mode);
    try { rq = fn(tx.objectStore(PHOTO_STORE)); }
    catch (e) { rej(e); return; }
    tx.oncomplete = () => res(rq && rq.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  }));
}
const putPhoto = (id, blob) => photoTx('readwrite', s => s.put(blob, id));
const getPhoto = id => photoTx('readonly', s => s.get(id));
const delPhoto = id => photoTx('readwrite', s => s.delete(id)).catch(() => {});

/* ---- EXIF ---- */
/* Only what a point needs: where, when, and which way up.  A hand-rolled reader
   rather than a library, because the app ships no dependencies and this is
   sixty lines. */
function readExif(buf) {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;   // not a JPEG
  let i = 2;
  while (i + 4 <= v.byteLength) {
    if (v.getUint8(i) !== 0xFF) return null;
    const m = v.getUint8(i + 1);
    if (m === 0xDA || m === 0xD9) return null;      // pixel data starts, no Exif
    const len = v.getUint16(i + 2);
    if (len < 2) return null;
    if (m === 0xE1 && i + 10 <= v.byteLength && v.getUint32(i + 4) === 0x45786966)
      return parseTiff(v, i + 10);                  // "Exif\0\0" then the TIFF
    i += 2 + len;
  }
  return null;
}

const EXIF_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function parseTiff(v, t) {
  if (t + 8 > v.byteLength) return null;
  const le = v.getUint16(t) === 0x4949;
  if (!le && v.getUint16(t) !== 0x4D4D) return null;
  if (v.getUint16(t + 2, le) !== 42) return null;

  const dir = off => {
    const out = {};
    if (off < 0 || off + 2 > v.byteLength) return out;
    const n = v.getUint16(off, le);
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      if (e + 12 > v.byteLength) break;
      out[v.getUint16(e, le)] = {
        type: v.getUint16(e + 2, le), count: v.getUint32(e + 4, le), at: e + 8 };
    }
    return out;
  };
  // a value of four bytes or fewer sits in the entry; anything longer is an
  // offset from the start of the TIFF header
  const start = f => (EXIF_SIZE[f.type] || 1) * f.count <= 4
    ? f.at : t + v.getUint32(f.at, le);
  const num = f => {
    if (!f || !f.count) return null;
    const o = start(f);
    if (o < 0 || o + (EXIF_SIZE[f.type] || 1) > v.byteLength) return null;
    if (f.type === 1 || f.type === 7) return v.getUint8(o);
    if (f.type === 3) return v.getUint16(o, le);
    if (f.type === 4) return v.getUint32(o, le);
    if (f.type === 5) { const d = v.getUint32(o + 4, le); return d ? v.getUint32(o, le) / d : null; }
    if (f.type === 10) { const d = v.getInt32(o + 4, le); return d ? v.getInt32(o, le) / d : null; }
    return null;
  };
  const str = f => {
    if (!f) return '';
    const o = start(f);
    let s = '';
    for (let k = 0; k < f.count && o + k < v.byteLength; k++) {
      const c = v.getUint8(o + k);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  // degrees, minutes, seconds as three rationals.  A zero denominator is not a
  // zero value, it is no value — that is the shape a phone writes when it had
  // no fix to record.
  const dms = f => {
    if (!f || f.type !== 5 || f.count < 3) return null;
    const o = start(f);
    if (o + 24 > v.byteLength) return null;
    const out = [];
    for (let k = 0; k < 3; k++) {
      const d = v.getUint32(o + k * 8 + 4, le);
      if (!d) return null;
      out.push(v.getUint32(o + k * 8, le) / d);
    }
    return out;
  };

  const ifd0 = dir(t + v.getUint32(t + 4, le));
  const out = { orientation: num(ifd0[0x0112]) || 1, taken: '', gps: null };
  if (ifd0[0x8769]) {
    const ex = dir(t + (num(ifd0[0x8769]) || 0));
    out.taken = str(ex[0x9003]) || str(ex[0x9004]) || '';
  }
  if (!out.taken) out.taken = str(ifd0[0x0132]);
  if (ifd0[0x8825]) out.gps = gpsFrom(dir(t + (num(ifd0[0x8825]) || 0)), num, str, dms);
  return out;
}

function gpsFrom(g, num, str, dms) {
  const latRef = str(g[1]).trim().toUpperCase();
  const lonRef = str(g[3]).trim().toUpperCase();
  const lat = dms(g[2]);
  const lon = dms(g[4]);
  // an empty ref is the giveaway: Android writes the whole GPSInfo IFD with
  // blank refs and 0/0 rationals when location tagging is off
  if (!lat || !lon) return null;
  if (latRef !== 'N' && latRef !== 'S') return null;
  if (lonRef !== 'E' && lonRef !== 'W') return null;
  let la = lat[0] + lat[1] / 60 + lat[2] / 3600;
  let lo = lon[0] + lon[1] / 60 + lon[2] / 3600;
  if (latRef === 'S') la = -la;
  if (lonRef === 'W') lo = -lo;
  if (!isFinite(la) || !isFinite(lo)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  // null island: never where a photo was taken, always what an empty block
  // decodes to
  if (Math.abs(la) < 1e-7 && Math.abs(lo) < 1e-7) return null;
  let alt = num(g[6]);
  if (alt !== null && num(g[5]) === 1) alt = -alt;   // below sea level
  return { ll: [la, lo], alt };
}

/* ---- making the stored copy ---- */
function shrinkPhoto(file) {
  const load = window.createImageBitmap
    ? createImageBitmap(file, { imageOrientation: 'from-image' })
    : new Promise((res, rej) => {
        const img = new Image();
        const u = URL.createObjectURL(file);
        img.onload = () => { URL.revokeObjectURL(u); res(img); };
        img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('decode')); };
        img.src = u;
      });
  return load.then(src => {
    const k = Math.min(1, PHOTO_MAX / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * k));
    const h = Math.max(1, Math.round(src.height * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(src, 0, 0, w, h);
    if (src.close) src.close();
    return new Promise((res, rej) => cv.toBlob(
      b => b ? res({ blob: b, w, h }) : rej(new Error('encode')), 'image/jpeg', PHOTO_Q));
  });
}

/* ---- object URLs ---- */
/* One at a time, revoked before the next: an unrevoked blob URL keeps its
   whole image alive for as long as the document does. */
let photoUrl = null;
function setPhotoUrl(blob) {
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = blob ? URL.createObjectURL(blob) : null;
  return photoUrl;
}
function dropPhotoUrl() {
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = null;
}

/* ---- the full-size view ---- */
function openLightbox(url, alt) {
  let el = $('#lightbox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lightbox';
    el.className = 'lb';
    el.innerHTML = '<button class="lb-x" type="button" aria-label="סגירה">✕</button>' +
                   '<img class="lb-img" alt="">';
    document.body.appendChild(el);
    el.addEventListener('click', () => { el.hidden = true; });
  }
  const img = el.querySelector('.lb-img');
  img.src = url;
  img.alt = alt || '';
  el.hidden = false;
}

/* -------------------------------------------------------- my own points --- */
/* Points the user marks are theirs, not data: they are kept apart from
   everything sourced, drawn in their own colour and shape, and stored only in
   this browser.  Nothing is uploaded, and the app says so — there is no server
   here to upload to.  localStorage can be cleared by the browser, so the panel
   offers a copy of them as text. */
function loadMine() {
  try {
    const a = JSON.parse(localStorage.getItem(MINE_KEY) || '[]');
    D.mine = Array.isArray(a) ? a.filter(p => p && Array.isArray(p.ll)) : [];
  } catch (e) { D.mine = []; }
}
function saveMine() {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(D.mine)); }
  catch (e) { mapNote('לא הצלחתי לשמור — ייתכן שהדפדפן חוסם אחסון מקומי.', true); }
}
const mineIcon = () => L.divIcon({ className: 'me-pin', iconSize: [16, 16], iconAnchor: [8, 8],
  html: '<span style="display:block;width:12px;height:12px;margin:2px;' +
        'background:' + MINE_COLOUR + ';border:2px solid #fff;' +
        'box-shadow:0 0 0 1px rgba(0,0,0,.45);transform:rotate(45deg)"></span>' });

const photoPinIcon = () => L.divIcon({ className: 'me-pin', iconSize: [18, 18], iconAnchor: [9, 9],
  html: '<span style="display:block;width:12px;height:12px;margin:1px;border-radius:3px;' +
        'background:' + PHOTO_COLOUR + ';border:2px solid #fff;' +
        'box-shadow:0 0 0 1px rgba(0,0,0,.45)"></span>' });

/* Two groups over one list.  A point that carries a photo is drawn in the photo
   layer and nowhere else, so turning that layer off takes the pictures and
   their pins together — which is what a layer switch is for. */
function drawMine() {
  ['mine', 'photos'].forEach(k => {
    if (LG[k]) { map.removeLayer(LG[k]); delete LG[k]; }
  });
  const pin = p => {
    const mk = L.marker(p.ll, { icon: p.photo ? photoPinIcon() : mineIcon(),
      zIndexOffset: p.photo ? 1250 : 1200, title: p.name });
    mk.bindTooltip(`<b>${html(p.name)}</b>` + (p.desc ? `<br>${html(p.desc)}` : '') +
      (p.photo ? '<br>עם תמונה' : ''), { direction: 'top', className: 'tt' });
    mk.on('click', () => {
      if (S.adding) return;
      if (isSecondTap('mine:' + p.id)) { openInGoogle(p.ll, p.name); return; }
      openMine(p.id);
    });
    return mk;
  };
  const plain = D.mine.filter(p => !p.photo);
  const shots = D.mine.filter(p => p.photo);
  if (S.mine && plain.length) LG.mine = L.layerGroup(plain.map(pin)).addTo(map);
  if (S.photos && shots.length) LG.photos = L.layerGroup(shots.map(pin)).addTo(map);
}

let mineEditing = null;
let minePending = null;      // a photo chosen in this form and not yet saved

function mineWhereHtml() {
  const at = freguesiaAt(mineEditing.ll[0], mineEditing.ll[1]);
  const meta = minePending || mineEditing.photo;
  return `${at ? html((at.he || at.pt) + ', ' + D.munByNum.get(at.mun_num).he)
               : 'מחוץ למחוז פורטו'} ·
    <span class="num">${mineEditing.ll[0].toFixed(5)}, ${mineEditing.ll[1].toFixed(5)}</span>` +
    (meta && meta.from === 'exif' ? ' · <span class="flag">מהתמונה</span>' : '');
}

/* The sentence and the numbers go on separate lines, and the numbers inside a
   <bdi>.  Joined into one run they reorder: a Hebrew line with latin figures in
   the middle of it ends up showing its first word after them. */
function photoMetaHtml(m) {
  const bits = [];
  if (m.w && m.h) bits.push(m.w + '×' + m.h);
  if (m.bytes) bits.push(Math.round(m.bytes / 1024) + ' KB');
  // Exif writes the moment as 2026:09:07 15:50:41
  if (m.taken) bits.push(String(m.taken).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
  return (m.from === 'exif'
      ? 'הנקודה מוקמה לפי הקואורדינטות של התמונה.'
      : 'בתמונה אין מיקום — הנקודה נשארה איפה שסומנה.') +
    (bits.length ? `<br><bdi class="num">${html(bits.join(' · '))}</bdi>` : '');
}

function renderPhotoBox(msg) {
  const box = $('#minePhotoBox');
  if (!box || !mineEditing) return;
  const meta = minePending || mineEditing.photo;
  // the native control labels itself in the browser's language, not the app's,
  // so it is kept off screen and driven by a label — which comes after it in
  // the markup so a plain sibling selector can show the focus ring
  const input = '<input id="minePhotoIn" class="ph-in" type="file" accept="image/*">' +
    `<label class="chip ph-pick" for="minePhotoIn">${
      meta ? 'החלפת התמונה' : 'בחירת תמונה'}</label>`;
  if (!meta) {
    box.innerHTML = `<div class="chips">${input}</div>` +
      `<p class="note ph-note">${msg ? html(msg)
      : 'תמונה שצולמה במקום תמקם את הנקודה לפי הקואורדינטות שלה, במקום לפי הסימון על המפה.'}</p>`;
    return;
  }
  box.innerHTML =
    `<figure class="ph-fig"><img class="ph-img" alt="${html(mineEditing.name || 'תמונת הנקודה')}"></figure>
     <p class="note ph-note">${photoMetaHtml(meta)}${msg ? '<br>' + html(msg) : ''}</p>
     <div class="chips">${input}<button class="chip" type="button" data-pt="rmphoto">הסרת התמונה</button></div>`;
  const fig = box.querySelector('.ph-fig');
  const gone = () => { fig.innerHTML = '<p class="note">התמונה אינה במכשיר הזה. ' +
    'נקודות שיובאו כטקסט מגיעות בלי התמונות שלהן.</p>'; };
  if (minePending) box.querySelector('.ph-img').src = setPhotoUrl(minePending.blob);
  else getPhoto(mineEditing.id).then(
    b => { if (b) box.querySelector('.ph-img').src = setPhotoUrl(b); else gone(); }, gone);
}

/* The photo decides where the point goes.  Only the head of the file is read
   for that — Exif sits at the front of a JPEG, and a three-megabyte frame does
   not need to be in memory twice to answer one question. */
function takePhoto(file) {
  if (!file || !mineEditing) return;
  renderPhotoBox('קורא את התמונה…');
  const head = file.slice(0, Math.min(file.size, 512 * 1024));
  const read = head.arrayBuffer ? head.arrayBuffer() : new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('read'));
    fr.readAsArrayBuffer(head);
  });
  Promise.all([read.then(buf => { try { return readExif(buf); } catch (e) { return null; } }),
               shrinkPhoto(file)])
    .then(([ex, small]) => {
      const gps = ex && ex.gps;
      if (gps) mineEditing.ll = gps.ll;
      minePending = { blob: small.blob, w: small.w, h: small.h, bytes: small.blob.size,
                      taken: (ex && ex.taken) || '', from: gps ? 'exif' : 'pin',
                      alt: gps ? gps.alt : null };
      const where = $('#mineWhere');
      if (where) where.innerHTML = mineWhereHtml();
      renderPhotoBox(gps
        ? 'הנקודה הועברה לקואורדינטות של התמונה.'
        : 'בתמונה אין מיקום שמיש. ייתכן שתיוג המיקום במצלמה כבוי — ' +
          'הנקודה נשארה במקום שסימנת.');
      if (gps) map.setView(gps.ll, Math.max(map.getZoom(), 15));
    })
    .catch(() => {
      minePending = null;
      renderPhotoBox('לא הצלחתי לקרוא את התמונה. ייתכן שהיא בפורמט שהדפדפן ' +
        'לא פותח, כמו HEIC — צילום ב-JPEG יעבוד.');
    });
}

function openMine(id, ll) {
  const p = id ? D.mine.find(x => x.id === id) : null;
  minePending = null;
  dropPhotoUrl();
  mineEditing = p ? { ...p } : { id: 'p' + Date.now().toString(36), ll, name: '', desc: '' };
  openPanel('point', p ? 'עריכת נקודה' : 'נקודה חדשה', `
    <p class="note" id="mineWhere">${mineWhereHtml()}</p>
    <label class="fld-l" for="mineName">שם</label>
    <input id="mineName" type="text" autocomplete="off" placeholder="למשל: דירה שראיתי"
           value="${html(mineEditing.name || '')}">
    <label class="fld-l" for="mineDesc">תיאור</label>
    <textarea id="mineDesc" rows="4" placeholder="מה שחשוב לזכור על המקום הזה">${html(mineEditing.desc || '')}</textarea>
    <label class="fld-l" for="minePhotoIn">תמונה</label>
    <div id="minePhotoBox"></div>
    <div class="btns">
      <button class="cta" data-pt="save">שמירה</button>
      <button class="cta cta-2" data-pt="google">פתיחה במפות גוגל</button>
      ${p ? '<button class="cta cta-danger" data-pt="delete">מחיקת הנקודה</button>' : ''}
    </div>`);
  renderPhotoBox();
  const el = $('#mineName');
  if (el) el.focus();
}
function closeMine() { closePanel(); mineEditing = null; minePending = null; dropPhotoUrl(); }

/* After a point is dealt with the screen goes back to halves — the map to see
   where it landed, the text to read it. */
function backToHalves() {
  if (S.view === 'split') return;
  S.view = 'split'; S.fPort = 50; S.fLand = 50;
  applySplit(); applyView(); save();
}

function panelPointClick(e) {
  if (e.target.classList.contains('ph-img') && e.target.src) {
    openLightbox(e.target.src, e.target.alt);
    return;
  }
  const b = e.target.closest('[data-pt]');
  if (!b || !mineEditing) return;
  if (b.dataset.pt === 'google') { openInGoogle(mineEditing.ll, mineEditing.name); return; }
  if (b.dataset.pt === 'delete') { deleteMine(); return; }
  if (b.dataset.pt === 'rmphoto') {
    // the point keeps the coordinates the photo gave it; only the picture goes,
    // and only once the point is saved
    minePending = null;
    delete mineEditing.photo;
    const where = $('#mineWhere');
    if (where) where.innerHTML = mineWhereHtml();
    renderPhotoBox('התמונה תוסר כשהנקודה תישמר.');
    return;
  }
  commitMine();
}

function commitMine() {
  const name = $('#mineName').value.trim();
  if (!name) { $('#mineName').focus(); return; }
  const rec = { ...mineEditing, name, desc: $('#mineDesc').value.trim(),
    at: mineEditing.at || new Date().toISOString().slice(0, 10) };
  const pend = minePending;
  if (pend) rec.photo = { w: pend.w, h: pend.h, bytes: pend.bytes,
                          taken: pend.taken, from: pend.from, alt: pend.alt };
  const finish = () => {
    const i = D.mine.findIndex(x => x.id === rec.id);
    if (i < 0) D.mine.push(rec); else D.mine[i] = rec;
    saveMine(); closeMine(); drawMine(); redrawText();
    backToHalves();
  };
  if (pend) {
    putPhoto(rec.id, pend.blob).then(finish, err => {
      // a point without its picture is still worth keeping — say what was lost
      // rather than dropping the whole thing
      delete rec.photo;
      mapNote('הנקודה נשמרה, אבל התמונה לא: ' +
        html(String((err && err.message) || err)), true);
      finish();
    });
    return;
  }
  if (!rec.photo) delPhoto(rec.id);        // it was removed in this edit
  finish();
}
function deleteMine() {
  delPhoto(mineEditing.id);
  D.mine = D.mine.filter(x => x.id !== mineEditing.id);
  saveMine(); closeMine(); drawMine(); redrawText();
  backToHalves();
}

/* The points are the one thing here the user made, and the only thing an
   uninstall would take with it.  Both directions are plain text, so they
   survive a new phone, a reinstall, and a message to yourself. */
function exportMine() {
  if (!D.mine.length) { mapNote('אין עדיין נקודות לייצוא.'); return; }
  const text = JSON.stringify(D.mine, null, 1);
  const done = () => mapNote(nf(D.mine.length) + ' נקודות הועתקו. אפשר להדביק אותן ' +
    'בהודעה לעצמך, ולייבא בחזרה בכל מכשיר.');
  try {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } catch (e) { fallbackCopy(text, done); }
}
function fallbackCopy(text, done) {
  // clipboard access needs a secure context and a permission; a hidden
  // textarea and execCommand still work where it is refused
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  if (ok) done();
  else openImport(text);          // could not copy: show it to be selected by hand
}

function openImport(prefill) {
  openPanel('import', prefill ? 'העתקה ידנית' : 'ייבוא נקודות', `
    <p class="note" id="impNote">${prefill
      ? 'לא הצלחתי להעתיק ללוח. אפשר לסמן את הטקסט כאן ולהעתיק ידנית.'
      : 'הדביקו כאן נקודות שיוצאו קודם. נקודה שכבר קיימת לא תשוכפל.'}</p>
    <textarea id="impText" rows="7" dir="ltr" spellcheck="false">${html(prefill || '')}</textarea>
    <div class="btns"><button class="cta" id="impSave">ייבוא</button></div>`);
}
function commitImport() {
  let rows;
  try { rows = JSON.parse($('#impText').value); }
  catch (e) { $('#impNote').textContent = 'זה לא טקסט תקין של נקודות.'; return; }
  if (!Array.isArray(rows)) { $('#impNote').textContent = 'ציפיתי לרשימה של נקודות.'; return; }
  const have = new Set(D.mine.map(p => p.id));
  let added = 0, skipped = 0;
  rows.forEach(r => {
    const ok = r && typeof r.name === 'string' && Array.isArray(r.ll)
      && r.ll.length === 2 && r.ll.every(n => typeof n === 'number' && isFinite(n));
    if (!ok) { skipped++; return; }
    const id = typeof r.id === 'string' && r.id ? r.id : 'p' + Math.random().toString(36).slice(2);
    if (have.has(id)) { skipped++; return; }
    have.add(id);
    D.mine.push({ id: id, name: r.name, desc: typeof r.desc === 'string' ? r.desc : '',
                  ll: [r.ll[0], r.ll[1]], at: typeof r.at === 'string' ? r.at : '' });
    added++;
  });
  saveMine();
  closePanel();
  drawMine(); redrawText();
  mapNote(added ? ('נוספו ' + nf(added) + ' נקודות' + (skipped ? ', ' + nf(skipped) + ' דולגו' : '') + '.')
                : 'לא נוספה אף נקודה חדשה.', !added);
}

let ghost = null;              // the crosshair being positioned

function toggleAdd() {
  S.adding = !S.adding;
  $('#addBtn').setAttribute('aria-pressed', String(S.adding));
  if (S.adding) startPlacing(); else stopPlacing();
}

function startPlacing() {
  // the map gets the whole screen while a point is being placed
  S.viewBefore = S.view;
  S.view = 'map'; applyView();
  const mk = L.marker(map.getCenter(), {
    icon: L.divIcon({ className: 'ghost', iconSize: [46, 46], iconAnchor: [23, 23],
      html: '<span class="ghost-ring"></span><span class="ghost-dot"></span>' }),
    draggable: true, autoPan: true, zIndexOffset: 2000,
  }).addTo(map);
  mk.on('dblclick', fixPlacing);
  // a double tap on a touch screen does not always reach the marker as
  // dblclick, so the same 450 ms rule the rest of the app uses stands in
  mk.on('click', () => { if (isSecondTap('ghost')) fixPlacing(); });
  ghost = mk;
  mapNote('גררו את הסימון למקום המבוקש, ואז לחיצה כפולה עליו כדי לקבוע אותו. ' +
    '<button type="button" data-add="off">ביטול</button>', false, true);
  // the note opened the text half; placing wants the whole map
  S.view = 'map'; applyView();
}

function stopPlacing() {
  if (ghost) { map.removeLayer(ghost); ghost = null; }
  S.adding = false;
  $('#addBtn').setAttribute('aria-pressed', 'false');
  $('#map').style.cursor = '';
  hideNote();
  if (S.viewBefore) { S.view = S.viewBefore; S.viewBefore = null; applyView(); save(); }
}

function fixPlacing() {
  if (!ghost) return;
  const ll = ghost.getLatLng();
  map.removeLayer(ghost);
  ghost = null;
  S.adding = false;
  S.viewBefore = null;
  $('#addBtn').setAttribute('aria-pressed', 'false');
  hideNote();
  // the form gets the whole screen to be filled in
  S.view = 'text'; applyView();
  openMine(null, [ll.lat, ll.lng]);
}

/* ------------------------------------------------- level 3: תוך הרובע --- */
/* Every parish has this level, not only Porto's seven.  What fills it differs,
   and the app says which is which: Porto's quarters carry the 53 neighbourhoods
   the source document names, with a Hebrew name and a description each; the
   other 236 parishes carry what OpenStreetMap actually holds — the localities
   inside them and the landmarks and services in those. */
const zoneOf = key => D.zones[key] || { origin: 'osm', bairros: [], pois: [] };

function drawZone(key) {
  clearMap();
  const f = D.freByKey.get(key);
  const z = zoneOf(key);

  LG.edge = L.geoJSON({ type: 'FeatureCollection',
      features: D.bF.features.filter(ft => ft.properties.mun_num + '|' + ft.properties.name === key) },
    { interactive: false,
      style: { weight: 0, fillColor: f.colour || '#dddddd', fillOpacity: .35 } }).addTo(map);

  drawLines();

  // Locality letters — A, B, C… at the point OSM gives for the place.
  LG.letters = L.layerGroup(!S.letters ? [] : z.bairros.filter(b => b.ll).map(b => {
    const mk = L.marker(b.ll, { icon: numIcon(b.letter, 'lbl-ltr'), keyboard: false,
      // the historic centre carries 341 dots; the letters have to stay on top
      zIndexOffset: 1000, title: b.letter + ' · ' + (b.he || b.en), riseOnHover: true });
    mk.__hi = { kind: 'bairro', id: b.letter };
    mk.on('click', () => pick({ kind: 'bairro', id: b.letter }, 'map'));
    return mk;
  })).addTo(map);

  // Landmarks: black dots, nothing written on the map itself.  Tapping a dot
  // highlights its record in the list, and tapping the record highlights the dot.
  LG.pois = L.layerGroup(z.pois.map((p, i) => {
    if (!S.cats.has(p.cat)) return null;
    const mk = L.circleMarker(p.ll, poiStyle(false, p.cat));
    mk.__hi = { kind: 'poi', id: i };
    mk.__cat = p.cat;
    mk.bindTooltip(`${html(p.name)}<br><span class="note">${html(D.poiLabel[p.cat] || p.cat)}</span>`,
      { direction: 'top', className: 'tt' });
    mk.on('click', () => pick({ kind: 'poi', id: i }, 'map'));
    return mk;
  }).filter(Boolean)).addTo(map);

  fit(LG.edge.getBounds());
}

const poiStyle = (on, cat) => on
  ? { radius: 9, weight: 3, color: '#b7791f', fillColor: CAT_COLOUR[cat] || '#101010',
      fillOpacity: 1, opacity: 1 }
  : { radius: 4.5, weight: 1.4, color: '#ffffff', fillColor: CAT_COLOUR[cat] || '#101010',
      fillOpacity: 1, opacity: 1 };

function renderZone(key) {
  const f = D.freByKey.get(key);
  const z = zoneOf(key);
  const m = D.munByNum.get(f.mun_num);
  const curated = z.origin === 'pdf';

  const bairros = z.bairros.map(b => `<button class="row row-full" data-hi="bairro:${html(b.letter)}">
      <span class="pin pin-sq" style="--c:#cfe0f2">${html(b.letter)}</span>
      <span class="row-body">
        <span class="row-t">${b.he ? html(b.he) + ' ' : ''}<span class="lat">${b.he ? '(' : ''}${html(b.en)}${b.he ? ')' : ''}</span>
          ${b.ll ? '' : '<span class="flag">אין נקודה במפה</span>'}</span>
        ${b.desc ? `<span class="row-d">${html(b.desc)}</span>` : ''}
        <span class="row-m">${html(b.kind_he || '')}${b.pop ? ' · ' + nf(b.pop) + ' תושבים' : ''}${
          b.kind_he && b.note_src ? ' · ' : ''}${html(b.note_src || '')}</span>
      </span></button>`).join('');

  const shown = z.pois.map((p, i) => ({ p, i })).filter(x => S.cats.has(x.p.cat));
  const byCat = new Map();
  shown.forEach(x => {
    if (!byCat.has(x.p.cat)) byCat.set(x.p.cat, []);
    byCat.get(x.p.cat).push(x);
  });
  const pois = D.poiOrder.filter(c => byCat.has(c)).map(c => `<div class="grp">${html(D.poiLabel[c] || c)}
      <span class="note num">${byCat.get(c).length}</span></div>
    <div class="rows">${byCat.get(c).map(x => `<button class="row" data-hi="poi:${x.i}">
        <span class="dot" style="--c:${html(CAT_COLOUR[x.p.cat] || '#101010')}"></span>
        <span class="row-body"><span class="row-t lat">${html(x.p.name)}</span>
          <span class="row-m">${html(D.poiLabel[x.p.cat] || x.p.cat)} ·
            <span class="lat">${html(x.p.osm)}</span></span></span>
      </button>`).join('')}</div>`).join('');

  const chips = D.poiOrder.filter(c => z.pois.some(p => p.cat === c)).map(c =>
    `<button class="chip${S.cats.has(c) ? ' is-on' : ''}" data-cat="${html(c)}">
      <span class="chip-c" style="background:${html(CAT_COLOUR[c] || '#101010')}"></span>${html(D.poiLabel[c] || c)}
      <span class="num">${z.pois.filter(p => p.cat === c).length}</span></button>`).join('');

  $('#doc').innerHTML = `
    <div class="card">
      <div class="hdr">
        <span class="pin" style="--c:${html(f.colour || '#ddd')}">${freNum(f)}</span>
        <div><h1>${html(f.he || f.pt)}</h1>
          <p class="sub lat">${html(f.en || f.pt)}</p></div>
      </div>
      <p class="sub">${html(m.he)} · ${html(m.belt)}${f.dicofre
        ? ' · קוד רשמי <span class="lat num">' + html(f.dicofre) + '</span>' : ''}</p>
      ${f.split2025 ? `<p class="note">${splitNote(f)}. הקוד שלמעלה הוא הקוד שהחזיקה
        עד אז, וזה גם הקוד שלפיו INE ספר אותה ב-2021 — הגבול והנתונים כאן הם של
        היחידה הזו.</p>` : ''}
      <div class="stats">
        ${stat('תושבים', f.pop2021, '', 0, 'freguesia.pop2021', 100)}
        ${stat('שטח', f.area_km2, 'קמ״ר', 1, 'freguesia.area_km2')}
        ${stat('צפיפות', f.density, 'לקמ״ר', 0, 'freguesia.density', 100)}
      </div>
      ${z.desc ? `<p class="lead">${html(z.desc)}</p>` : ''}
      ${f.note ? `<p class="${z.desc ? 'sub' : 'lead'}">${html(f.note)}</p>` : ''}
      ${f.note_origin === 'app'
        ? '<p class="note">התיאור נכתב לאפליקציה ולא הועתק ממקור רשמי.</p>' : ''}
    </div>

    ${splitTable(f)}
    ${peopleStats(f, 'freguesia')}
    ${housingStats(f, 'freguesia')}

    ${z.bairros.length ? `
      <div class="grp">${z.bairros.length} ${curated ? 'שכונות' : 'יישובים ושכונות'} — האותיות במפה</div>
      <div class="rows">${bairros}</div>
      <p class="note" style="margin-block:8px 12px">${curated
        ? `לשכונות אין גבול רשמי. האות במפה מסומנת על נקודת השכונה כפי שהיא
           ב-OpenStreetMap, במרכזה בקירוב.`
        : `היישובים האלה אינם יחידה מנהלית ואין להם גבול. הם מגיעים מ-OpenStreetMap
           כנקודה אחת לכל יישוב, ולכן אין להם שם עברי ואין להם תיאור — לא נכתב
           כזה לאף אחד מהם.`}</p>`
      : '<p class="note">אין ביישוב הזה נקודות place ב-OpenStreetMap.</p>'}

    ${z.pois.length ? `
      <div class="card">
        <h2>נקודות במפה</h2>
        <p class="sub">כל נקודה במפה היא אתר או מוסד, בצבע הקטגוריה שלה. לחיצה על
          נקודה מבליטה את הרישום שלה כאן, ולחיצה על רישום מבליטה את הנקודה במפה.
          <b>לחיצה כפולה</b> — על הנקודה או על הרישום — פותחת אותה במפות גוגל.</p>
        <div class="chips">${chips}</div>
        <p class="note">מקור: OpenStreetMap contributors, ODbL. המיפוי התנדבותי
          ואינו אחיד: היעדר נקודה אינו ראיה שאין שם דבר.</p>
      </div>
      ${shown.length ? pois : '<p class="note">לא נבחרה שום קטגוריה.</p>'}`
      : '<p class="note">לא מופו כאן אתרים או מוסדות ב-OpenStreetMap.</p>'}
    ${mineList(p => {
      const at = freguesiaAt(p.ll[0], p.ll[1]);
      return at && D.freKey(at) === key;
    })}`;
  $('#paneText').scrollTop = 0;
}

/* The user's own points, listed.  `within` decides which ones: everything at
   district level, the ones inside this parish at level 3. */
function mineList(within) {
  const rows = D.mine.filter(p => !within || within(p));
  // at district level the card shows even when empty, so points exported from
  // another phone have somewhere to be pasted in
  if (!rows.length && within) return '';
  return `<div class="card">
      <h2>הנקודות שלי <span class="note num">${rows.length}</span></h2>
      <p class="sub">נשמרות במכשיר הזה בלבד. לא נשלחות לשום מקום ולא מגובות.
      ההעתקה מוציאה את הנקודות כטקסט; התמונות עצמן נשארות במכשיר ולא נכללות בה.</p>
      <div class="chips">
        <button class="chip" data-mine-act="export">העתקת הנקודות</button>
        <button class="chip" data-mine-act="import">ייבוא נקודות</button>
      </div>
    </div>
    <div class="rows">${rows.map(p => `<button class="row" data-mine="${html(p.id)}">
        <span class="dot mine" style="--c:${p.photo ? PHOTO_COLOUR : MINE_COLOUR}"></span>
        <span class="row-body">
          <span class="row-t">${html(p.name)}</span>
          ${p.desc ? `<span class="row-d">${html(p.desc)}</span>` : ''}
          <span class="row-m num">${html(p.ll[0].toFixed(5))}, ${html(p.ll[1].toFixed(5))}
            ${p.at ? ' · ' + html(p.at) : ''}${p.photo ? ' · תמונה' : ''}</span>
        </span></button>`).join('')}</div>`;
}

/* ------------------------------------------------------------ view mode --- */
/* Three states, one button: both halves, the map alone, the text alone.  On a
   phone this is the difference between reading a paragraph through a letterbox
   and reading it. */
const VIEW_NEXT = { split: 'map', map: 'text', text: 'split' };
const VIEW_HE = { split: 'חצי מפה, חצי טקסט', map: 'מפה על כל המסך', text: 'טקסט על כל המסך' };

function applyView() {
  document.body.dataset.view = S.view;
  $('#viewBtn').setAttribute('aria-label', 'פריסת המסך: ' + VIEW_HE[S.view]);
  $('#viewBtn').setAttribute('title', VIEW_HE[S.view] + ' — לחיצה מחליפה');
  // Leaflet has to be told its box changed; the ResizeObserver catches it too,
  // but only after a frame, and the flash is visible
  if (map) requestAnimationFrame(() => map.invalidateSize({ animate: false }));
}
function cycleView() {
  // No toast confirming it: a message forces the split view back open, so the
  // announcement undid the very thing it was announcing. The screen changing
  // is the feedback.
  S.view = VIEW_NEXT[S.view] || 'split';
  // "half" means half: the button is a reset, not a return to whatever the
  // divider happened to be left at.
  if (S.view === 'split') { S.fPort = 50; S.fLand = 50; applySplit(); }
  applyView(); save();
}

/* -------------------------------------------------------------- panel --- */
/* Everything that used to be its own kind of window — the layers menu, the
   form for a new point, an import, a source record, the search — is the same
   thing: a titled box in the text half with a close button.  One pattern, one
   place, one way out of it. */
let panelKind = null;

function openPanel(kind, title, body) {
  panelKind = kind;
  $('#panelTitle').textContent = title;
  $('#panelBody').innerHTML = body;
  $('#panel').hidden = false;
  $('#layersBtn').setAttribute('aria-expanded', String(kind === 'layers'));
  // the panel lives in the text half, so that half has to be on screen
  if (S.view === 'map') { S.view = 'split'; applyView(); save(); }
  $('#paneText').scrollTop = 0;
}
function closePanel() {
  panelKind = null;
  $('#panel').hidden = true;
  $('#panelBody').innerHTML = '';
  $('#layersBtn').setAttribute('aria-expanded', 'false');
}
const panelIs = k => panelKind === k;

/* ------------------------------------------------------------- layers --- */
function renderLayers() {
  const z = S.level === 'zone' ? zoneOf(S.zone) : null;
  const counts = {};
  if (z) z.pois.forEach(p => { counts[p.cat] = (counts[p.cat] || 0) + 1; });

  const row = (on, key, name, colour, square, n) =>
    `<button class="lay" aria-pressed="${on}" data-lay="${html(key)}">
       <span class="lay-x">✓</span>
       ${colour ? `<span class="lay-c${square ? ' sq' : ''}" style="background:${html(colour)}"></span>` : ''}
       <span class="lay-n">${html(name)}</span>
       ${n === undefined ? '' : `<span class="lay-k">${n}</span>`}
     </button>`;

  let h = '<h3>שכבות</h3>' +
    row(S.tiles, 'tiles', 'רקע המפה (רחובות)', 'linear-gradient(135deg,#cfd9e6,#eef1f5)', true) +
    row(S.muncol, 'muncol', 'צבעי 18 העיריות', 'linear-gradient(135deg,#F9C784,#9CC7E8)', true) +
    row(S.water, 'water', 'נהרות ומים', '#4a9ad4', true) +
    row(S.mine, 'mine', 'הנקודות שלי', MINE_COLOUR, true,
        D.mine.filter(p => !p.photo).length) +
    row(S.photos, 'photos', 'נקודות עם תמונה', PHOTO_COLOUR, true,
        D.mine.filter(p => p.photo).length);

  // Which of these are black and which are grey is the level's decision, not
  // the user's; the switch is only whether the line is there at all.
  h += '<h3>קווי גבול</h3>' +
    ['region', 'district', 'mun', 'fre'].map(k =>
      row(S[LINE_ON[k]], 'ln:' + k, LINE_HE[k], lineColour(k), true)).join('') +
    '<p class="note" style="margin-block-start:6px">הקווים ששייכים לרמה שעל ' +
    'המסך מוצגים בשחור, והשאר באפור.</p>';
  // the letters only exist at level 3, and they are neighbourhoods in Porto and
  // localities everywhere else — the row says which, and counts them like the
  // other rows do
  if (z) {
    h += row(S.letters, 'letters',
      z.origin === 'pdf' ? 'אותיות השכונות' : 'אותיות היישובים',
      '#cfe0f2', true, z.bairros.filter(b => b.ll).length);
  }
  if (z && z.pois.length) {
    h += '<h3>נקודות במפה</h3>' + D.poiOrder.filter(c => counts[c])
      .map(c => row(S.cats.has(c), 'cat:' + c, D.poiLabel[c] || c, CAT_COLOUR[c], false, counts[c]))
      .join('');
  } else {
    h += '<p class="note" style="margin-block-start:8px">קטגוריות הנקודות נבחרות ברמת הרובע.</p>';
  }
  if (panelIs('layers')) $('#panelBody').innerHTML = h;
  return h;
}
function toggleLayers(force) {
  const show = force === undefined ? !panelIs('layers') : force;
  if (show) openPanel('layers', 'שכבות המפה', renderLayers());
  else closePanel();
}

// after a change that alters what the text half should say
function redrawText() {
  if (S.level === 'district') renderDistrict();
  else if (S.level === 'mun') renderMun(S.mun);
  else renderZone(S.zone);
  applyHi();
}

/* --------------------------------------------------------- Google Maps --- */
/* A second activation of the same thing within 450 ms opens it in Google Maps.
   One tap keeps doing exactly what it did before.

   Why a coordinate link and not the Google Maps API: their terms forbid storing
   or redrawing their data outside their own map, which is the whole of what
   this app is, and an API key inside a file people pass around is a bill
   waiting to be run up.  A plain URL with a latitude and a longitude asks for
   none of that — no key, no account, nothing stored — and hands over the two
   things Google is genuinely better at: Street View and directions. */
const gmapsUrl = ll =>
  'https://www.google.com/maps/search/?api=1&query=' + ll[0].toFixed(6) + '%2C' + ll[1].toFixed(6);

let lastTap = { key: '', t: 0 };
function isSecondTap(key) {
  const now = Date.now();
  const again = key === lastTap.key && now - lastTap.t < 450;
  lastTap = { key, t: again ? 0 : now };   // a third tap starts over
  return again;
}

function openInGoogle(ll) {
  // A real link click, not window.open. In the Android wrapper the WebView
  // hands the URL to the browser and returns null from window.open, which read
  // as "blocked" while Google Maps was opening in front of the user.
  const a = document.createElement('a');
  a.href = gmapsUrl(ll);
  a.target = '_blank';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* --------------------------------------------------------- highlighting --- */
// One record is "picked" at a time, and both halves show it: the row gets a
// frame and scrolls into view, the shape or dot on the map gets a heavy ring.
function pick(hi, from) {
  if (S.adding) return;               // the tap is placing a point, not choosing one
  if (isSecondTap(hi.kind + ':' + hi.id)) {
    const z = zoneOf(S.zone);
    const it = hi.kind === 'bairro'
      ? z.bairros.find(b => b.letter === hi.id)
      : z.pois[Number(hi.id)];
    if (it && it.ll) { openInGoogle(it.ll, it.name || it.he || it.en); return; }
  }
  const same = S.hi && S.hi.kind === hi.kind && String(S.hi.id) === String(hi.id);
  S.hi = same ? null : hi;
  applyHi(from);
}
// Every parish has a level of its own now, so a tap on one opens it.  The
// second argument is kept because the map and the list both call this.
function pickFre(f) {
  if (S.adding) return;
  if (isSecondTap('fre:' + D.freKey(f))) { openInGoogle(latlng(f.center), f.he || f.pt); return; }
  goZone(D.freKey(f));
}

function applyHi(from) {
  const hi = S.hi;
  // the text half
  $$('#doc .row.is-hi').forEach(el => el.classList.remove('is-hi'));
  if (hi) {
    const sel = hi.kind === 'fre'
      ? `[data-fre="${CSS.escape(hi.id)}"]`
      : `[data-hi="${hi.kind}:${CSS.escape(String(hi.id))}"]`;
    const el = $('#doc ' + sel);
    if (el) {
      el.classList.add('is-hi');
      if (from === 'map') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  // the map half
  if (LG.fre) LG.fre.eachLayer(l => {
    const on = hi && hi.kind === 'fre' && l.feature.__key === hi.id;
    l.setStyle({ weight: on ? 3 : 0, color: '#b7791f', opacity: on ? 1 : 0,
                 fillOpacity: on ? .92 : .78 });
    if (on) l.bringToFront();
  });
  if (LG.labels) LG.labels.eachLayer(l => {
    const on = hi && hi.kind === 'fre' && l.__key === hi.id;
    const e = l.getElement(); if (e) e.classList.toggle('is-hi', !!on);
  });
  if (LG.letters) LG.letters.eachLayer(l => {
    const on = hi && hi.kind === 'bairro' && l.__hi.id === hi.id;
    const e = l.getElement(); if (e) e.classList.toggle('is-hi', !!on);
  });
  if (LG.pois) LG.pois.eachLayer(l => {
    const on = hi && hi.kind === 'poi' && String(l.__hi.id) === String(hi.id);
    l.setStyle(poiStyle(on, l.__cat));
    if (on) l.bringToFront();
  });
  // asked for from the list: make sure the thing is actually on screen
  if (hi && from === 'list') {
    let ll = null;
    if (hi.kind === 'fre') {
      const f = D.freByKey.get(hi.id);
      if (f) ll = latlng(f.center);
    } else if (hi.kind === 'bairro') {
      const b = zoneOf(S.zone).bairros.find(x => x.letter === hi.id);
      if (b && b.ll) ll = b.ll;
    } else if (hi.kind === 'poi') {
      const p = zoneOf(S.zone).pois[Number(hi.id)];
      if (p) ll = p.ll;
    }
    if (ll && !map.getBounds().pad(-0.12).contains(ll)) map.panTo(ll, { animate: true });
  }
}

/* ------------------------------------------------------------ navigation --- */
function goDistrict() {
  S.level = 'district'; S.mun = null; S.zone = null; S.hi = null;
  drawDistrict(); renderDistrict(); afterNav();
}
function goMun(num) {
  S.level = 'mun'; S.mun = num; S.zone = null; S.hi = null;
  drawMun(num); renderMun(num); afterNav();
}
function goZone(key) {
  const f = D.freByKey.get(key);
  if (!f) return;
  S.level = 'zone'; S.mun = f.mun_num; S.zone = key; S.hi = null;
  S.cats = new Set(D.poiOrder);
  drawZone(key); renderZone(key); afterNav();
}
function goUp() {
  if (S.level === 'zone') goMun(S.mun);
  else if (S.level === 'mun') goDistrict();
}

function afterNav() {
  drawMine();
  if (panelIs('layers')) renderLayers();
  const c = [];
  if (S.level === 'district') c.push('<span class="now">מחוז פורטו</span>');
  else {
    c.push('<button data-go="district">מחוז פורטו</button>');
    const m = D.munByNum.get(S.mun);
    if (S.level === 'mun') c.push('<span class="sep" dir="ltr">‹</span><span class="now">' + html(m.he) + '</span>');
    else {
      c.push('<span class="sep" dir="ltr">‹</span><button data-go="mun">' + html(m.he) + '</button>');
      const f = D.freByKey.get(S.zone);
      c.push('<span class="sep" dir="ltr">‹</span><span class="now">' + html(f.he || f.pt) + '</span>');
    }
  }
  $('#crumb').innerHTML = c.join('');
  save();
}

/* --------------------------------------------------------------- divider --- */
const landscape = () => window.matchMedia('(orientation:landscape)').matches;

function applySplit() {
  const f = landscape() ? S.fLand : S.fPort;
  $('#split').style.setProperty('--f', f + '%');
  const d = $('#divider');
  d.setAttribute('aria-orientation', landscape() ? 'vertical' : 'horizontal');
  d.setAttribute('aria-valuenow', String(Math.round(f)));
}
function setSplit(f) {
  f = Math.max(15, Math.min(85, f));
  if (landscape()) S.fLand = f; else S.fPort = f;
  applySplit(); save();
}

function wireDivider() {
  const d = $('#divider');
  let id = null;
  const frac = e => {
    const r = $('#split').getBoundingClientRect();
    // portrait: the map is the top half.  landscape: row-reverse in RTL puts
    // the map against the left edge, so the map's width grows to the right.
    return landscape() ? (e.clientX - r.left) / r.width * 100
                       : (e.clientY - r.top) / r.height * 100;
  };
  d.addEventListener('pointerdown', e => {
    id = e.pointerId; d.setPointerCapture(id);
    document.body.classList.add('is-dragging');
    e.preventDefault();
  });
  d.addEventListener('pointermove', e => { if (id !== null) setSplit(frac(e)); });
  const end = () => {
    if (id === null) return;
    try { d.releasePointerCapture(id); } catch (err) { /* already gone */ }
    id = null; document.body.classList.remove('is-dragging');
  };
  d.addEventListener('pointerup', end);
  d.addEventListener('pointercancel', end);
  d.addEventListener('dblclick', () => setSplit(50));
  d.addEventListener('keydown', e => {
    const cur = landscape() ? S.fLand : S.fPort;
    const k = e.key;
    const step = (landscape() ? (k === 'ArrowLeft' ? -3 : k === 'ArrowRight' ? 3 : 0)
                              : (k === 'ArrowUp' ? -3 : k === 'ArrowDown' ? 3 : 0));
    if (!step && k !== 'Home') return;
    e.preventDefault();
    setSplit(k === 'Home' ? 50 : cur + step);
  });
  window.matchMedia('(orientation:landscape)').addEventListener('change', () => {
    applySplit();
    setTimeout(() => map.invalidateSize({ animate: false }), 60);
  });
}

/* ----------------------------------------------------------------- state --- */
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      level: S.level, mun: S.mun, zone: S.zone, view: S.view,
      letters: S.letters, mine: S.mine, photos: S.photos, water: S.water,
      muncol: S.muncol, lnRegion: S.lnRegion, lnDistrict: S.lnDistrict,
      lnMun: S.lnMun, lnFre: S.lnFre,
      tiles: S.tiles, fPort: S.fPort, fLand: S.fLand,
    }));
  } catch (e) { /* private mode */ }
}
function restore() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (typeof o.tiles === 'boolean') S.tiles = o.tiles;
    if (typeof o.letters === 'boolean') S.letters = o.letters;
    if (typeof o.mine === 'boolean') S.mine = o.mine;
    if (typeof o.photos === 'boolean') S.photos = o.photos;
    ['lnRegion', 'lnDistrict', 'lnMun', 'lnFre'].forEach(k => {
      if (typeof o[k] === 'boolean') S[k] = o[k];
    });
    if (typeof o.water === 'boolean') S.water = o.water;
    if (typeof o.muncol === 'boolean') S.muncol = o.muncol;
    if (o.view === 'split' || o.view === 'map' || o.view === 'text') S.view = o.view;
    if (typeof o.fPort === 'number') S.fPort = o.fPort;
    if (typeof o.fLand === 'number') S.fLand = o.fLand;
    // an older build stored a Porto quarter number under `quarter`; it has no
    // meaning here, and dropping it just opens the district
    if (o.level === 'district' || o.level === 'mun' || o.level === 'zone') {
      S.level = o.level; S.mun = o.mun; S.zone = o.zone || null;
    }
  } catch (e) { /* nothing stored */ }
}

/* ---------------------------------------------------------------- search --- */
function openSearch() {
  openPanel('search', 'חיפוש', `
    <input id="q" type="search" inputmode="search" autocomplete="off" enterkeyhint="search"
           placeholder="עירייה, רובע, יישוב או אתר" aria-label="חיפוש">
    <div id="qres"></div>`);
  const el = $('#q');
  if (el) { el.focus(); runSearch(''); }
}
function panelSearchClick(e) {
  const b = e.target.closest('[data-jump]');
  if (b) jump(b.dataset.jump);
}

function runSearch(term) {
  const t = term.trim().toLowerCase();
  if (t.length < 2) {
    $('#qres').innerHTML = '<p class="note">שתי אותיות ומעלה — בעברית, פורטוגזית או אנגלית.</p>';
    return;
  }
  const hit = s => String(s || '').toLowerCase().includes(t);
  const out = [];
  D.mun.forEach(m => {
    if (hit(m.he) || hit(m.pt) || hit(m.en) || hit(m.dicofre)) out.push({
      t: munCode(m) + ' · ' + m.he, s: m.pt, k: 'עירייה', go: `data-jump="mun:${m.num}"` });
  });
  D.fre.forEach(f => {
    // the official code is searchable too: it is what appears on a form
    if (hit(f.he) || hit(f.pt) || hit(f.dicofre)) out.push({
      t: (f.he || f.pt), s: bare(f.pt) + ' · ' + f.mun_he
        + (f.dicofre ? ' · ' + f.dicofre : ''),
      k: f.mun_num === 1 ? 'רובע בפורטו' : 'רובע',
      go: `data-jump="zone:${html(D.freKey(f))}"` });
  });
  // 1,773 localities and 1,530 dots across the district; stop once the list is
  // long enough rather than walk all of them for every keystroke
  const CAP = 60;
  for (const key of Object.keys(D.zones)) {
    if (out.length > CAP) break;
    const f = D.freByKey.get(key);
    if (!f) continue;
    const where = (f.he || f.pt) + ' · ' + f.mun_he;
    const z = D.zones[key];
    z.bairros.forEach(b => {
      if (hit(b.he) || hit(b.en)) out.push({
        t: b.letter + ' · ' + (b.he || b.en), s: b.en + ' · ' + where,
        k: b.kind_he || 'שכונה', go: `data-jump="bairro:${html(key)}:${html(b.letter)}"` });
    });
    z.pois.forEach((p, i) => {
      if (hit(p.name)) out.push({
        t: p.name, s: (D.poiLabel[p.cat] || p.cat) + ' · ' + where,
        k: 'נקודה', go: `data-jump="poi:${html(key)}:${i}"` });
    });
  }

  const box = $('#qres');
  if (!box) return;
  box.innerHTML = out.length
    ? '<div class="rows">' + out.slice(0, 60).map(r => `<button class="row" ${r.go}>
        <span class="row-body"><span class="row-t">${html(r.t)}</span>
          <span class="row-m"><span class="lat">${html(r.s)}</span></span></span>
        <span class="note">${html(r.k)}</span></button>`).join('') + '</div>' +
      (out.length > 60 ? `<p class="note" style="margin-block-start:8px">${out.length} תוצאות, מוצגות 60.</p>` : '')
    : `<p class="note">אין תוצאות ל״${html(term)}״.</p>`;
}

function jump(spec) {
  const i = spec.indexOf(':');
  const kind = spec.slice(0, i), rest = spec.slice(i + 1);
  if (kind === 'mun') goMun(Number(rest));
  else if (kind === 'zone') goZone(rest);
  else if (kind === 'fre') {
    const f = D.freByKey.get(rest);
    if (!f) return;
    goMun(f.mun_num);
    S.hi = { kind: 'fre', id: rest }; applyHi('list');
  } else if (kind === 'bairro' || kind === 'poi') {
    // "bairro:<mun_num>|<parish>:<letter>" — the parish key itself holds a
    // colon-free "|", so split from the right
    const cut = rest.lastIndexOf(':');
    goZone(rest.slice(0, cut));
    const id = rest.slice(cut + 1);
    S.hi = { kind, id: kind === 'poi' ? Number(id) : id }; applyHi('list');
  }
}

/* ------------------------------------------------------ sources and info --- */
function showSource(key, exact) {
  const f = D.sources.fields[key];
  if (!f) return;
  openPanel('source', f.label_he || key, `
    ${exact ? `<p>הערך המדויק: <b class="num">${html(exact)}</b>
      <span class="note">— המספר במסך מעוגל כדי להיקרא, וזה מה שהמקור מפרסם.</span></p>` : ''}
    <p class="note"><code>${html(key)}</code></p>
    ${f.reference_year ? `<p>שנת ייחוס: <b class="num">${html(f.reference_year)}</b></p>` : ''}
    <p>מקור: ${html(f.source || (f.derived_from || []).join(' / '))}</p>
    ${f.coverage ? `<p class="note">כיסוי: ${html(f.coverage)}</p>` : ''}
    ${f.validation_he ? `<p class="note">בדיקה: ${html(f.validation_he)}</p>` : ''}
    ${f.caveat_he ? `<div class="warn">${html(f.caveat_he)}</div>` : ''}
    ${f.url ? `<p><a href="${html(f.url)}" target="_blank" rel="noopener">${html(f.url)}</a></p>` : ''}`);
}

function renderInfo() {
  const s = D.sources;
  const fields = Object.entries(s.fields).map(([k, f]) => `<div class="card">
      <h3>${html(f.label_he || k)}</h3>
      <p class="note"><code>${html(k)}</code></p>
      ${f.reference_year ? `<p>שנת ייחוס: <b class="num">${html(f.reference_year)}</b></p>` : ''}
      <p>מקור: ${html(f.source || (f.derived_from || []).join(' / '))}</p>
      ${f.coverage ? `<p class="note">כיסוי: ${html(f.coverage)}</p>` : ''}
      ${f.definitions_he ? `<dl class="kv">${Object.entries(f.definitions_he).map(
        ([t, v]) => `<div><dt>${html(t)}</dt><dd class="note">${html(v)}</dd></div>`).join('')}</dl>` : ''}
      ${f.validation_he ? `<p class="note">בדיקה: ${html(f.validation_he)}</p>` : ''}
      ${f.caveat_he ? `<div class="warn">${html(f.caveat_he)}</div>` : ''}
      ${f.url ? `<p><a href="${html(f.url)}" target="_blank" rel="noopener">${html(f.url)}</a></p>` : ''}
    </div>`).join('');

  const miss = s.missing.items.map(m => `<div class="card">
      <h3>${html(m.label_he)}</h3>
      <p class="note"><code>${html(m.field)}</code></p>
      <p>${html(m.why_he)}</p>
      ${m.important_he ? `<div class="warn">${html(m.important_he)}</div>` : ''}
      ${m.decision_he ? `<p>${html(m.decision_he)}</p>` : ''}
      ${(m.candidate_sources || []).map(u =>
        `<p class="note"><a href="${html(u)}" target="_blank" rel="noopener">${html(u)}</a></p>`).join('')}
    </div>`).join('');

  $('#infoBody').innerHTML = `
    <h2>איך קוראים את המספרים</h2>
    <p>לכל יחידה מנהלית בפורטוגל יש קוד רשמי אחד, <b>DICOFRE</b>, והוא בנוי
      בשכבות. מחוז פורטו הוא <span class="num">13</span>; שתי הספרות שאחריו הן
      העירייה, ושתיים נוספות הן הרובע:</p>
    <pre>13 12 02
▔▔ ▔▔ ▔▔
│  │  └── רובע  (Bonfim)
│  └───── עירייה (פורטו)
└──────── מחוז  (פורטו)</pre>
    <p>המספר שמופיע על כל עירייה במפה הוא <b>שתי הספרות הרשמיות שלה</b> —
      פורטו היא <span class="num">12</span>, אמרנטה <span class="num">01</span>,
      טרופה <span class="num">18</span>. זה הקוד שמופיע בטפסים, במסמכי מקרקעין
      ובטבלאות רשמיות, ואפשר להשתמש בו מול כל גורם בפורטוגל.</p>
    <p>המספר שעל כל רובע הוא באותו אופן <b>שתי הספרות הרשמיות שלו</b> בתוך
      העירייה, ובכרטיס של כל רובע מופיע גם הקוד המלא בן שש הספרות. הקודים
      מגיעים מיחידות שמסומנות ב-OpenStreetMap עם <span class="lat">ref:ine</span>
      ועם <span class="lat">source=DGT — CAOP</span>, כלומר הם הקוד שהמדינה
      מפרסמת ולא מספור של האפליקציה.</p>
    <p>הספרות אינן רצות 01, 02, 03 בלי דילוגים, וזה תקין: הרשימה נקבעה לפי סדר
      האלף-בית הפורטוגלי, וכשרובע חדל להתקיים הקוד שלו לא מוחזר לשימוש ולא
      מחולק מחדש. יחידה שנוצרה מאיחוד או מפיצול קיבלה מספר חדש שנוסף בסוף
      הרשימה של אותה עירייה — ולכן עירייה יכולה להציג 02 ליד 44.</p>
    <p><b>רפורמת 2025.</b> חלק מהאיחודים של 2013 בוטלו, ורובעים שאוחדו חזרו
      להיות יחידות נפרדות עם קודים חדשים. במחוז פורטו זה נוגע ל-25 מ-243
      היחידות שהאפליקציה מציירת: הן פורקו ל-57 רובעים חדשים, והקוד של היחידה
      המאוחדת בוטל. הגבולות והנתונים כאן הם CAOP 2020 — כלומר המפה של 2013 —
      ולכן ל-25 האלה מוצג <span class="flag">פורק ב-2025</span> במקום קוד, ובכרטיס
      של כל אחת מהן רשומים בשמם ובקודם הרובעים שהחליפו אותה. 218 הרובעים האחרים
      לא נגעו ברפורמה והקוד שמוצג להם הוא הקוד הרשמי המלא והתקף.</p>
    <p class="note">כדי שהאפליקציה תציג את 275 הרובעים של 2025 עצמם — ולא את
      חלוקת 2020 עם הערה — צריך את שכבת הגבולות CAOP במהדורה 2024 או 2025.
      אין לי אותה כאן, וכל נתוני האוכלוסייה שיש לי הם ממפקד 2021 שנספר לפי
      חלוקת 2013, כך שפיצול היחידות היום היה משאיר 57 רובעים בלי מספר תושבים.</p>

    <h2>מי מודד ומי סופר</h2>
    <p>שני גופים שונים עומדים מאחורי כל מספר כאן, ותפקידם שונה לגמרי.</p>
    <div class="card">
      <h3>INE — <span class="lat">Instituto Nacional de Estatística</span></h3>
      <p>הלשכה המרכזית לסטטיסטיקה של פורטוגל. אחראית על כל הסטטיסטיקה הרשמית,
        והמוצר המרכזי שלה כאן הוא <b>Censos</b> — מפקד האוכלוסין שנערך כל עשר
        שנים. <b>כל נתוני האוכלוסייה באפליקציה הם ממפקד 2021.</b></p>
      <p class="note">INE נותן את <b>המספרים</b>.</p>
    </div>
    <div class="card">
      <h3>CAOP — <span class="lat">Carta Administrativa Oficial de Portugal</span></h3>
      <p>מפת הגבולות המנהליים הרשמית, שמפרסמת <b>DGT</b>
        (<span class="lat">Direção-Geral do Território</span>) — לא INE. היא
        קובעת איפה בדיוק עובר כל גבול. ממנה מגיעות כל הצורות על המפה, וכל שטח
        בקמ״ר שמוצג כאן חושב מהפוליגונים עצמם ולא נלקח מטבלה.</p>
      <p class="note">CAOP נותן את <b>הצורות</b>. קוד DICOFRE הוא מה שמחבר
        ביניהם — אותו מזהה בשני המקורות, ולכן אפשר לצרף מספר לגבול בלי לנחש.</p>
    </div>

    <h2>NUTS III — החלוקה הרשמית של המחוז</h2>
    <p><b>NUTS</b> הוא תקן אירופי לחלוקת שטח לצורך סטטיסטיקה והקצאת תקציבים.
      בפורטוגל יש שלוש רמות; הרמה שבפועל משמשת היא <b>NUTS III</b>, ובה 25
      יחידות. מה שמייחד אותה בפורטוגל: כל יחידה היא גם <b>גוף אמיתי</b> —
      אזור מטרופוליני או התאגדות בין-עירונית עם מועצה ותקציב.</p>
    <p><b>18 העיריות שבאפליקציה מתחלקות בין שתי יחידות כאלה:</b></p>
    <div class="card">
      <h3><span class="lat">Área Metropolitana do Porto</span> (AMP)</h3>
      <p>11 מהעיריות כאן: פורטו, וילה נובה דה גאיה, מטוזיניוש, מאיה, גונדומאר,
        ולונגו, וילה דו קונדה, פובואה דה וארזים, סנטו טירסו, טרופה ופארדש.
        (ל-AMP שייכות עוד שש עיריות ממחוז אָבֵיירו.)</p>
      <p>זהו מטרופולין אחד לכל דבר: <b>רשות תחבורה משותפת</b> — המטרו, כרטיס
        <span class="lat">Andante</span> ותעריפי האזורים — ושוק עבודה אחד.
        כאן חיים כ-1.44 מיליון מתושבי המחוז.</p>
    </div>
    <div class="card">
      <h3><span class="lat">Tâmega e Sousa</span></h3>
      <p>7 מהעיריות כאן: פנאפיאל, פאסוש דה פריירה, לוזאדה, פלגיירש, אמרנטה,
        מרקו דה קנבזש ובאיאו. (ליחידה שייכות עוד ארבע עיריות ממחוזות אחרים.)</p>
      <p>כלכלה נפרדת — רהיטים, נעליים וטקסטיל — <b>מחוץ למערכת התחבורה
        המטרופולינית</b>, עם מחירי נדל״ן נמוכים משמעותית ואוכלוסייה מתכווצת.
        כאן חיים כ-348 אלף תושבים.</p>
    </div>
    <p class="note">להבדל הזה יש משמעות מעשית: הוא קובע אם עירייה נמצאת בתוך
      מערכת הכרטוס והמטרו של פורטו, לאן מגיעים כספי הפיתוח האירופיים, ובאיזו
      יחידה INE מפרסם נתונים. זו גם החלוקה שמסך המחוז מצייר — עד גרסה 1.8 הוא
      צייר שלוש חגורות לפי מרחק ואופי, שהיו קריאה של המסמך המקורי ולא חלוקה
      רשמית.</p>

    <h2>מה יש כאן</h2>
    <p>המסך מחולק לשניים: מפה בחצי אחד, וכל הידע שנוגע למה שרואים בה בחצי השני.
      הקו שביניהם נגרר, המפה נגררת ומתקרבת בתוך החלון שלה, והטקסט נגלל בלי הגבלה.</p>
    <ul>
      <li>18 עיריות · 243 רובעים · 7 רבעי פורטו · 53 שכונות ·
        <span class="num">${D.totPoi}</span> נקודות במפה</li>
      <li>אוכלוסיית 2021, שטח וצפיפות לכל 18 העיריות ולכל 243 הרובעים</li>
      <li>מפקד 2021 לכל יחידה: גיל חציוני, פילוח גיל, אזרחות זרה, ואחת-עשרה
        שורות של דיור ובניינים — דירות ריקות, בעלות מול שכירות, חניה, מצב
        הבניינים ותקופת הבנייה</li>
      <li>נבנה: <span class="lat">${html(D.generated)}</span></li>
    </ul>
    <p class="note">מספרי העיריות והרובעים הם קודי DICOFRE הרשמיים.
      האותיות של השכונות והיישובים הן של האפליקציה: הן נועדו לקשור בין המפה
      לרשימה, ואין להן קיום מחוץ לאפליקציה.</p>
    ${STANDALONE
      ? `<p class="note">זהו קובץ בודד ועצמאי — כל הנתונים בתוכו והוא עובד בלי רשת
         ובלי שרת. המסמך המקורי ‎(PDF)‎ נמצא במאגר, ב-<span class="lat">porto/data/raw/</span>.</p>`
      : `<p><a href="data/raw/porto_district_map_a3.pdf" target="_blank" rel="noopener">פתיחת המסמך המקורי (PDF, 19 עמודים)</a></p>`}

    <h2>מה עוד חסר</h2>
    <p>${html(s.missing.note_he)}</p>
    ${miss}

    <h2>מקור לכל שדה</h2>
    ${fields}

    <h2>גרסה</h2>
    <p>פורטולנד <span class="lat num">${html(D.version)}</span> ·
      הנתונים נבנו ב-<span class="lat">${html(D.generated)}</span></p>

    <h2>רישוי וייחוס</h2>
    ${s.license_notices.map(n => `<p>${html(n)}</p>`).join('')}
    <p class="note">לחיצה כפולה על כל דבר שיש לו קואורדינטה פותחת אותו במפות גוגל —
      קישור עם נ״צ בלבד, בלי מפתח ובלי לשמור דבר, ולכן בלי להפר את תנאי השימוש
      של גוגל שאוסרים לאחסן או להציג את הנתונים שלהם מחוץ למפה שלהם.</p>
    <p class="note">האפליקציה עובדת גם בלי רשת. בלי חיבור אריחי הרקע לא ייטענו,
      המפה תוצג כגבולות בלבד, וכל הנתונים והטקסטים זמינים במלואם.</p>`;
}

/* ------------------------------------------------------------------ wire --- */
function wire() {
  $('#fitBtn').addEventListener('click', refit);
  $('#locBtn').addEventListener('click', toggleLocate);
  $('#viewBtn').addEventListener('click', cycleView);
  $('#layersBtn').addEventListener('click', () => toggleLayers());
  $('#addBtn').addEventListener('click', toggleAdd);
  $('#panelClose').addEventListener('click', () => {
    const wasPoint = panelIs('point');
    closePanel();
    if (wasPoint) { mineEditing = null; backToHalves(); }
  });
  $('#panelBody').addEventListener('click', e => {
    if (panelIs('search')) { panelSearchClick(e); return; }
    if (panelIs('point')) { panelPointClick(e); return; }
    const b = e.target.closest('[data-lay]');
    if (!b) return;
    const k = b.dataset.lay;
    if (k === 'tiles') {
      S.tiles = !S.tiles;
      if (S.tiles) tileLayer.addTo(map); else map.removeLayer(tileLayer);
    }
    else if (k === 'letters') { S.letters = !S.letters; }
    else if (k === 'water') { S.water = !S.water; applyNature(); }
    else if (k === 'muncol') { S.muncol = !S.muncol; if (S.level === 'district') drawDistrict(); }
    else if (k === 'mine') { S.mine = !S.mine; drawMine(); }
    else if (k === 'photos') { S.photos = !S.photos; drawMine(); }
    else if (k.startsWith('ln:')) {
      const key = LINE_ON[k.slice(3)];
      S[key] = !S[key];
      drawLines();
    }
    else if (k.startsWith('cat:')) {
      const c = k.slice(4);
      if (S.cats.has(c)) S.cats.delete(c); else S.cats.add(c);
      if (!S.cats.size) S.cats.add(c);              // never leave the map blank
    }
    save();
    if (S.level === 'zone') { drawZone(S.zone); renderZone(S.zone); }
    drawMine(); renderLayers(); applyHi();
  });
  $('#panelBody').addEventListener('input', e => {
    if (panelIs('search') && e.target.id === 'q') runSearch(e.target.value);
  });
  $('#panelBody').addEventListener('change', e => {
    if (e.target.id === 'minePhotoIn') takePhoto(e.target.files && e.target.files[0]);
  });
  $('#msgs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.add === 'off') { stopPlacing(); return; }
    if (b.dataset.close || b.dataset.loc === 'back') { hideNote(); }
    if (b.dataset.loc === 'back') refit();
    if (b.dataset.jump) { jump(b.dataset.jump); hideNote(); }
  });
  $('#crumb').addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    if (b.dataset.go === 'district') goDistrict(); else goMun(S.mun);
  });

  // one delegated handler for the whole text half
  $('#doc').addEventListener('click', e => {
    const src = e.target.closest('[data-src]');
    if (src) { showSource(src.dataset.src, src.dataset.exact); return; }
    const cat = e.target.closest('[data-cat]');
    if (cat) {
      const c = cat.dataset.cat;
      if (S.cats.has(c)) S.cats.delete(c); else S.cats.add(c);
      if (!S.cats.size) S.cats.add(c);              // never leave the map blank
      drawZone(S.zone); renderZone(S.zone); applyHi();
      return;
    }
    const act = e.target.closest('[data-mine-act]');
    if (act) {
      if (act.dataset.mineAct === 'export') exportMine(); else openImport('');
      return;
    }
    const mine = e.target.closest('[data-mine]');
    if (mine) {
      const p = D.mine.find(x => x.id === mine.dataset.mine);
      if (p && isSecondTap('mine:' + p.id)) { openInGoogle(p.ll, p.name); return; }
      openMine(mine.dataset.mine);
      return;
    }
    const mun = e.target.closest('[data-mun]');
    if (mun) {
      const m = D.munByNum.get(Number(mun.dataset.mun));
      if (isSecondTap('mun:' + m.num)) { openInGoogle(latlng(m.center), m.he); return; }
      goMun(m.num);
      return;
    }
    const fre = e.target.closest('[data-fre]');
    if (fre) { pickFre(D.freByKey.get(fre.dataset.fre), 'list'); return; }
    const hi = e.target.closest('[data-hi]');
    if (hi) {
      const [kind, id] = hi.dataset.hi.split(':');
      pick({ kind, id: kind === 'poi' ? Number(id) : id }, 'list');
    }
  });

  $('#findBtn').addEventListener('click', openSearch);

  $('#infoBtn').addEventListener('click', () => { renderInfo(); $('#infoDrawer').hidden = false; });
  $('#infoClose').addEventListener('click', () => { $('#infoDrawer').hidden = true; });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#panel').hidden) closePanel();
    else if (!$('#infoDrawer').hidden) $('#infoDrawer').hidden = true;
    else goUp();
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (S.level === 'district') drawDistrict();
    else if (S.level === 'mun') drawMun(S.mun);
    else drawZone(S.zone);
    drawMine();
    applyHi();
  });
}

/* ------------------------------------------------------------------ boot --- */
(async function main() {
  restore();
  try {
    await load();
  } catch (err) {
    const b = $('#boot');
    b.classList.add('err');
    b.querySelector('p').textContent = 'טעינת הנתונים נכשלה: ' + err.message +
      ' — יש להריץ את האפליקציה משרת (למשל python3 -m http.server), לא כקובץ מקומי.';
    return;
  }
  // Category labels and their order come from build.py, which also decides
  // which POIs make it into the file at all.
  D.poiOrder = ['station', 'hospital', 'university', 'museum', 'culture', 'market', 'landmark', 'green'];
  D.poiLabel = {
    station: 'תחנות מטרו ורכבת', hospital: 'בתי חולים', university: 'אוניברסיטה והשכלה',
    museum: 'מוזיאונים וגלריות', culture: 'תיאטרון, ספריות ותרבות', market: 'שווקים',
    landmark: 'אתרים ומונומנטים', green: 'פארקים, גנים וחופים',
  };
  S.cats = new Set(D.poiOrder);

  loadMine();
  applyView();
  applySplit();
  initMap();
  initNature();
  wire();
  wireDivider();

  if (S.level === 'zone' && D.freByKey.has(S.zone)) goZone(S.zone);
  else if (S.level === 'mun' && D.munByNum.has(S.mun)) goMun(S.mun);
  else goDistrict();

  $('#boot').remove();

  // The Android wrapper asks this before it lets the system back button close
  // the app, so back climbs the app's own levels first.
  window.__portoBack = function () {
    if (S.level === 'district') return false;
    goUp();
    return true;
  };

  // The standalone build has nothing to precache: it is already one file.
  if (!STANDALONE && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline unavailable */ });
  }
})();
