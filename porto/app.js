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
  cats: null,          // level 3: which landmark categories are shown
  hi: null,            // { kind, id } — the record highlighted on both halves
  view: 'split',       // split | map | text — which half fills the screen
  menu: false,        // the menu screen is open (never restored open)
  catsOpen: false,    // the eight point categories are listed one by one
  theme: 'auto',      // 'auto' | 'light' | 'dark' — day/night is a choice
  viewBefore: null,    // the layout to restore after placing a point
  letters: true,       // draw the locality letters
  water: true,         // rivers and lakes
  muncol: true,        // ★ the level's own colour fill: 18 municipalities at
                       //   level 1, the parishes at 2, the parish itself at 3
  mine: true,          // draw the points the user added
  // The four boundary layers.  Each is drawn at every level and switched on
  // its own; the level decides which of them are black and which recede.
  lnRegion: false,     // the two NUTS III regions — off until asked for
  lnDistrict: true,    // Porto district
  lnMun: true,         // the 18 municipalities
  lnFre: true,         // the 243 parishes
  adding: false,       // waiting for a tap on the map to place a new point
  wp: false,           // נ.צ. management: the cards in the text half
  wpSel: null,         // the id of the card and pin being looked at
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
/* One kind of point, one pin.  A photo is something a point may carry, not a
   different sort of point, so there is no second colour and no second layer. */
const MINE_COLOUR = '#d32f2f';

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
/* Three widths were the hierarchy; two are, now that the municipalities were
   asked for at the district's own 3.2.  What separates them is the pane they
   sit in and the colour the level gives them, not the weight. */
const LINE_W = { region: 4, district: 3.2, mun: 3.2, fre: 1.6 };
/* The two NUTS III regions are the one line that is not a shade of the ink.
   They are neither the subject of any level nor part of the district's own
   hierarchy, and a fourth grey among three greys said nothing about that. */
const REGION_COLOUR = '#e2761b';
/* Which lines are black at each level.  The regions are never in this list:
   they are context at every level, and drawn grey whenever they are on at all.

   At level 2 it is not the whole layer that goes black but one municipality
   and its own parishes — everything belonging to the place being looked at,
   and nothing else.  So the colour is decided per feature there, not per
   layer, which is what `own` in the table below is for. */
const LINE_BLACK = {
  district: ['district', 'mun'],   // level 1: the district and its municipalities
  mun: ['mun', 'fre'],             // level 2: but only the chosen one — see own()
  zone: ['fre'],                   // level 3: the parishes
};

/* Does this particular feature belong to what is on screen?  Only level 2
   narrows a layer down; everywhere else the whole layer is one or the other. */
function ownFeature(kind, props) {
  if (S.level !== 'mun') return true;
  if (kind === 'mun') return props.num === S.mun;
  if (kind === 'fre') return props.mun_num === S.mun;
  return true;
}
const LINE_ON = { region: 'lnRegion', district: 'lnDistrict',
                  mun: 'lnMun', fre: 'lnFre' };
// bottom to top — the array order IS the stacking order
const LINE_PANE = ['ln-region', 'ln-district', 'ln-mun', 'ln-fre'];
const PANE_OF = { region: 'ln-region', district: 'ln-district',
                  mun: 'ln-mun', fre: 'ln-fre' };
const LINE_HE = { region: 'גבולות האזורים', district: 'גבול מחוז פורטו',
                  mun: 'גבולות העיריות', fre: 'גבולות הרובעים' };

/* Black, and black at 50% for the rest — a grey of its own would be a third
   colour to keep in step, and half of the line is exactly what "recedes" means.

   In the dark theme it inverts.  "Black" there is a line on a near-black map,
   which is not a quiet line but an absent one; what was asked for is the
   strongest contrast the background allows, and that flips with the
   background.  The same 50% then does the same job. */
const lineColour = (kind, props) => {
  if (kind === 'region') return REGION_COLOUR;
  const own = kind !== 'region'
    && (LINE_BLACK[S.level] || []).indexOf(kind) >= 0
    && (!props || ownFeature(kind, props));
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
  const style = (kind, props) => ({ color: lineColour(kind, props),
    weight: LINE_W[kind], opacity: .95, fill: false,
    lineJoin: 'round', lineCap: 'round' });

  /* The parish lines are not a district-wide layer any more.  At level 2 they
     are the chosen municipality's own parishes and nothing else; at level 3 the
     one parish being looked at, which still needs an outline — the fill under
     it carries none.  At level 1 they are not drawn at all: 243 outlines over
     eighteen municipalities was noise, not context. */
  const freHere = S.level === 'mun'
    ? ft => ft.properties.mun_num === S.mun
    : S.level === 'zone'
      ? ft => ft.properties.mun_num + '|' + ft.properties.name === S.zone
      : null;
  if (S.lnFre && freHere) {
    LG.lnFre = L.geoJSON({ type: 'FeatureCollection', features: D.bF.features.filter(freHere) },
      { pane: PANE_OF.fre, interactive: false,
        style: ft => style('fre', ft.properties) }).addTo(map);
  }
  if (S.lnMun) {
    LG.lnMun = L.geoJSON(D.bM, { pane: PANE_OF.mun, interactive: false,
      style: ft => style('mun', ft.properties) }).addTo(map);
    // the chosen municipality's own outline goes on top of its neighbours',
    // or a grey line drawn later would sit over the black one
    if (S.level === 'mun') {
      LG.lnMun.eachLayer(l => {
        if (l.feature && l.feature.properties.num === S.mun) l.bringToFront();
      });
    }
  }
  // The regions and the district share one file; each feature says which it is.
  const pick = kind => ({ type: 'FeatureCollection',
    features: D.bB.features.filter(ft => (ft.properties.kind === 'nuts3'
      ? 'region' : 'district') === kind) });
  if (S.lnRegion) {
    LG.lnRegion = L.geoJSON(pick('region'), { pane: PANE_OF.region,
      interactive: false, style: () => style('region') }).addTo(map);
  }
  if (S.lnDistrict) {
    LG.lnDistrict = L.geoJSON(pick('district'), { pane: PANE_OF.district,
      interactive: false, style: () => style('district') }).addTo(map);
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
    // freely inside its half.  How big that half is, is not a gesture — the
    // layout button decides it and nothing else does.
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
    applySwitches();
    mapNote('רקע המפה לא נטען — מוצגים הגבולות בלבד. כל הנתונים והטקסטים זמינים.',
            false, true);
  });
  if (S.tiles) tileLayer.addTo(map);

  // The map half changes size when the layout button switches views and when
  // the phone turns.
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

  // One pane per boundary level, in the order they contain each other: the
  // regions at the bottom, then the district, then the municipalities, then the
  // parishes on top.  Where two levels follow the same border the smaller one
  // stays whole and the larger steps aside for it.
  //
  // Panes rather than draw order on purpose.  Draw order is whatever drawLines()
  // happened to append last, and every level redraws a different subset — so the
  // stack held at level 1 and quietly inverted at level 3.  A pane's z-index is
  // the same at all three.
  LINE_PANE.forEach((pane, i) => {
    map.createPane(pane);
    map.getPane(pane).style.zIndex = 460 + i;
    map.getPane(pane).style.pointerEvents = 'none';
  });

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
  renderMenu();
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
  renderMenu();
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

/* The two NUTS III regions, explained where the line that draws them is on.
   It used to sit in the district card whether the layer was on or not, which
   made it a paragraph about something that was not on the map.  Now it is the
   last thing in the reading half at every level, and only while אזורים is on. */
function regionsDoc() {
  if (!S.lnRegion || !D.belts) return '';
  const rows = D.belts.map(b => `<div class="belt">
      <span class="belt-sw" style="--c:${html(b.colour)}"></span>
      <span class="row-body">
        <span class="row-t">${html(b.he)} <span class="lat">(${html(b.en)})</span></span>
        <span class="row-d">${html(b.sub_he)}</span>
        <span class="row-m num">${html(b.nums.map(n => munCode(D.munByNum.get(n))).sort().join(' · '))}</span>
      </span></div>`).join('');
  return `<div class="card" id="regionsDoc">
      <h2>שני האזורים <span class="en lat">(NUTS III)</span></h2>
      <p class="sub">החלוקה הרשמית של המחוז, וזו שלפיה INE מפרסם. הקו הכתום במפה
        מקיף את העיריות של כל אזור.</p>
      ${rows}
      <p class="note">שני האזורים גדולים ממה שמצויר כאן: לאזור המטרופוליטני
        17 עיריות ולטאמגה אה סוזה 11, והשאר יושבות במחוזות אוויירו וויזאו.
        האפליקציה מראה את החלק שבתוך מחוז 13 בלבד.</p>
    </div>`;
}

function renderDistrict() {
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
      <!-- The population and the area are the two rows of the table right
           below, and a lead that says them again is the same fact twice. -->
      <p class="lead">18 עיריות ו-243 רובעים בצפון-מערב פורטוגל, מהאוקיינוס האטלנטי
        במערב ועד הרי מראו במזרח. זהו המחוז הצפוף במדינה.</p>
      <div class="stats">
        ${stat('תושבים', D.totPop, '', 0, 'municipio.pop2021', 100)}
        ${stat('שטח', D.totArea, 'קמ״ר', 1, 'municipio.area_km2')}
        ${stat('צפיפות', D.totPop / D.totArea, 'לקמ״ר', 0, 'municipio.density', 100)}
      </div>
      <p class="note">כל מספר באפליקציה נלחץ ומציג את המקור ואת שנת הייחוס שלו.
        המספרים על המפה הם קודי DICOFRE הרשמיים.</p>
    </div>

    <div class="grp">18 העיריות — לפי המספור במפה</div>
    <div class="rows">${list}</div>
    ${mineList(null)}
    ${regionsDoc()}`;
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
        fillColor: (f && f.colour) || colourOf.get(ft.properties.num) || '#ddd',
        fillOpacity: S.muncol ? .78 : 0 };
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
      שלו הוא זה שהחזיק עד אז — בכרטיס שלו רשומים הרובעים שהחליפו אותו.</p>
    ${regionsDoc()}`;
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
/* A push pin: the teardrop everyone already reads as "a place", in red, with
   its point — not its middle — on the coordinate.  The selected one grows and
   takes the highlight colour the rest of the app uses for "this is the one you
   asked about", so a card and its pin are recognisably the same object. */
function pinIcon(on) {
  const w = on ? 30 : 24, h = Math.round(w * 1.32);
  const ring = on ? 'var(--hi-line)' : '#ffffff';
  return L.divIcon({ className: 'me-pin', iconSize: [w, h], iconAnchor: [w / 2, h],
    html: `<svg viewBox="0 0 24 32" width="${w}" height="${h}" aria-hidden="true"
        style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">
        <path d="M12 31.2C12 31.2 1.6 18.6 1.6 11.4a10.4 10.4 0 1 1 20.8 0C22.4 18.6 12 31.2 12 31.2z"
              fill="${MINE_COLOUR}" stroke="${ring}" stroke-width="${on ? 2.4 : 1.8}"/>
        <circle cx="12" cy="11.2" r="3.6" fill="${ring}"/>
      </svg>` });
}
const mineIcon = () => pinIcon(false);
const wpIcon = (p, on) => pinIcon(on);

/* One layer over one list.  Management overrides it: it shows every place there
   is, whatever the switch says, and takes the other points off the map so what
   is left on it is only what the cards are about. */
function drawMine() {
  ['mine', 'photos', 'wp'].forEach(k => {
    if (LG[k]) { map.removeLayer(LG[k]); delete LG[k]; }
  });
  const pin = p => {
    const mk = L.marker(p.ll, { icon: mineIcon(), zIndexOffset: 1200, title: p.name });
    mk.bindTooltip(`<b>${html(p.name)}</b>` + (p.desc ? `<br>${html(p.desc)}` : ''),
      { direction: 'top', className: 'tt' });
    mk.on('click', () => {
      if (S.adding) return;
      if (isSecondTap('mine:' + p.id)) { openInGoogle(p.ll, p.name); return; }
      openWp(p.id);
    });
    return mk;
  };
  if (S.wp) {
    LG.wp = L.layerGroup(D.mine.map(p => {
      const mk = L.marker(p.ll, { icon: wpIcon(p, p.id === S.wpSel),
        zIndexOffset: p.id === S.wpSel ? 2200 : 1300, title: p.name });
      mk.__wp = p.id;
      mk.__on = p.id === S.wpSel;
      mk.on('click', () => {
        if (S.adding) return;
        if (isSecondTap('mine:' + p.id)) { openInGoogle(p.ll, p.name); return; }
        selectWp(p.id, 'map');
      });
      return mk;
    })).addTo(map);
    otherPoints(false);
    return;
  }
  otherPoints(true);
  if (S.mine && D.mine.length) LG.mine = L.layerGroup(D.mine.map(pin)).addTo(map);
}

/* The landmark dots and the locality letters — the other things on the map that
   are points.  They are put aside rather than rebuilt, so coming out of
   management costs nothing and the categories chosen before it are still
   chosen after. */
function otherPoints(on) {
  ['pois', 'letters'].forEach(k => {
    if (!LG[k]) return;
    if (on && !map.hasLayer(LG[k])) LG[k].addTo(map);
    else if (!on && map.hasLayer(LG[k])) map.removeLayer(LG[k]);
  });
}

let mineEditing = null;
let minePending = null;      // a photo chosen in this form and not yet saved

function mineWhereHtml() {
  const at = freguesiaAt(mineEditing.ll[0], mineEditing.ll[1]);
  const meta = minePending || mineEditing.photo;
  return `${at ? html((at.he || at.pt) + ', ' + D.munByNum.get(at.mun_num).he)
               : 'מחוץ למחוז פורטו'}` +
    (meta && meta.from === 'exif' ? ' · <span class="flag">מהתמונה</span>' : '') +
    `<br><bdi class="num">${mineEditing.ll[0].toFixed(5)}, ${mineEditing.ll[1].toFixed(5)}</bdi>`;
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
  const input = '<input id="minePhotoIn" class="ph-in" type="file" accept="image/*" multiple>' +
    `<label class="chip ph-pick" for="minePhotoIn">${
      meta ? 'החלפת התמונה' : 'בחירת תמונות'}</label>`;
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
/* One photo fills the card that is open.  More than one is a different act:
   each of the others becomes a point of its own, because a photo already
   carries the two things a point needs — where it was taken and when — and
   making the user add five points by hand to attach five photos to them was
   asking them to do the file's work.

   A photo with no usable coordinates lands at the top-left of the view, where
   defaultLL() puts anything that has nowhere else to be: visible, reachable,
   and obviously not a claim about where the picture was taken. */
function takePhotos(list) {
  const files = Array.from(list || []);
  if (!files.length) return;
  takePhoto(files[0]);
  if (files.length === 1) return;

  const rest = files.slice(1);
  let placed = 0, unplaced = 0, done = 0;
  rest.forEach((file, i) => {
    const head = file.slice(0, Math.min(file.size, 512 * 1024));
    const read = head.arrayBuffer ? head.arrayBuffer() : Promise.reject(new Error('read'));
    Promise.all([read.then(buf => { try { return readExif(buf); } catch (e) { return null; } },
                           () => null),
                 shrinkPhoto(file)])
      .then(([ex, small]) => {
        const gps = ex && ex.gps;
        if (gps) placed++; else unplaced++;
        const p = {
          // the index keeps two photos picked in the same millisecond apart
          id: 'p' + Date.now().toString(36) + i.toString(36),
          ll: gps ? gps.ll : defaultLL(),
          name: '', desc: '', at: new Date().toISOString(),
          photo: { w: small.w, h: small.h, bytes: small.blob.size,
                   taken: (ex && ex.taken) || '', from: gps ? 'exif' : 'pin',
                   alt: gps ? gps.alt : null },
        };
        D.mine.push(p);
        return putPhoto(p.id, small.blob).catch(() => {
          // the point is still worth keeping; the card says the photo is missing
        });
      })
      .catch(() => { unplaced++; })
      .then(() => {
        if (++done < rest.length) return;
        saveMine();
        drawMine();
        renderWaypoints();
        mapNote(`נוספו ${rest.length} נקודות מהתמונות — `
          + `${placed} לפי הקואורדינטות שבתמונה, ${unplaced} בפינת המפה.`, false);
      });
  });
}

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

/* ------------------------------------------------------ נ.צ. management --- */
/* One mode, not a form on top of a screen.  The map shows every נ.צ. and
   nothing else that is a point; the text half is the list of them, one card
   each, holding what was typed.  A card is the record — it is edited in place,
   so there is never a copy of it open somewhere else to disagree with.

   The two halves point at each other: the card that is open highlights its pin,
   and a pin that is tapped scrolls its card into view.  Which of them the user
   started from is the only difference, and that is what `from` carries. */

let wpArmed = null;      // the id whose delete is waiting for a second tap
let wpUrls = [];         // blob URLs of the thumbnails now on screen
let wpObs = null;

function wpUrl(blob) { const u = URL.createObjectURL(blob); wpUrls.push(u); return u; }
function dropWpUrls() { wpUrls.forEach(u => URL.revokeObjectURL(u)); wpUrls = []; }

function toggleWp() {
  if (S.adding) stopPlacing();
  S.wp = !S.wp;
  renderMenu();
  if (!S.wp) {
    mineEditing = null; minePending = null; dropPhotoUrl();
    S.wpSel = null; wpArmed = null;
  } else if (S.view === 'map') { S.view = 'split'; applyView(); save(); }
  closePanel();
  drawMine();
  redrawText();
  if (S.wp) $('#paneText').scrollTop = 0;
}

/* Reached from a pin outside management, and from the lists inside the level
   documents: both mean "show me this one", and there is one place that does. */
function openWp(id) {
  if (!S.wp) {
    S.wp = true;
    renderMenu();
    if (S.view === 'map') { S.view = 'split'; applyView(); save(); }
    closePanel();
  }
  S.wpSel = id;
  mineEditing = null; minePending = null;
  drawMine();
  renderWaypoints();
  applyWpHi('map');
}

function selectWp(id, from) {
  S.wpSel = S.wpSel === id ? null : id;
  applyWpHi(from);
}

/* Selection only ever changes two classes and two icons, so it is done in place
   rather than by rendering the list again — a re-render would drop the
   thumbnails that have been fetched and, mid-edit, whatever is half typed. */
function applyWpHi(from) {
  $$('#doc .wp.is-hi').forEach(el => el.classList.remove('is-hi'));
  if (S.wpSel) {
    const el = $('#doc [data-wp="' + CSS.escape(S.wpSel) + '"]');
    if (el) {
      el.classList.add('is-hi');
      if (from === 'map') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  if (LG.wp) LG.wp.eachLayer(l => {
    const on = l.__wp === S.wpSel;
    if (on === l.__on) return;
    l.__on = on;
    const p = D.mine.find(x => x.id === l.__wp);
    if (p) l.setIcon(wpIcon(p, on));
    l.setZIndexOffset(on ? 2200 : 1300);
  });
  if (from === 'list' && S.wpSel) {
    const p = D.mine.find(x => x.id === S.wpSel);
    if (p && !map.getBounds().pad(-0.12).contains(p.ll)) map.panTo(p.ll, { animate: true });
  }
}

/* Whatever is in the two fields belongs to the record the moment anything else
   happens to the list — picking coordinates on the map, or the list being drawn
   again for any other reason.  Without this a re-render would quietly throw
   away what had been typed but not saved. */
function harvestWp() {
  if (!mineEditing) return;
  const nm = $('#mineName'), ds = $('#mineDesc');
  if (nm) mineEditing.name = nm.value;
  if (ds) mineEditing.desc = ds.value;
}

function renderWaypoints() {
  dropWpUrls();
  const rows = D.mine;
  const cards = rows.map(p => wpCard(p));
  /* Heading on one line with the button that starts a place, and nothing else:
     the count said nothing the list does not, and saving and importing live in
     the menu now — one place for them, not two. */
  $('#doc').innerHTML = `
    <div class="card">
      <div class="wp-top">
        <h1>המקומות שלי</h1>
        <button class="chip${wpAdding ? '' : ' is-on'}" data-wpact="${wpAdding ? 'addoff' : 'add'}"
          >${wpAdding ? 'ביטול' : 'הוספת מיקום'}</button>
      </div>
      ${wpAdding ? `<div class="chips wp-ways">
        <button class="chip" data-wpact="way-map">בחירת מקום במפה</button>
        <button class="chip" data-wpact="way-photo">בחירת מקום מתמונה</button>
        <button class="chip" data-wpact="way-place">בחירת כתובת מקום</button>
      </div>
      <input id="wpPhotoIn" type="file" accept="image/*" multiple hidden>
      ${wpPlacing ? placePickerHtml() : ''}` : ''}
    </div>
    ${cards.length ? cards.join('') : ''}`;
  renderWpSheet();
  wpThumbs();
  applyWpHi();
}

/* ---- the three ways a place can be started ---- */
let wpAdding = false;      // the הוספת מיקום button is armed and the ways are up
let wpPlacing = false;     // "בחירת כתובת מקום" is showing its search box

function wpAddOn(on) {
  wpAdding = on;
  if (!on) wpPlacing = false;
  renderWaypoints();
}

/* Not a street geocoder — the app carries no address database and reaches no
   network.  What it can search is its own gazetteer: the eighteen
   municipalities, the 243 parishes, and the localities and named sites inside
   whichever parish they belong to.  Picking one puts the place at that record's
   own coordinate, and the form says which record it came from. */
function placePickerHtml() {
  return `<div class="wp-find">
      <input id="wpQ" type="search" inputmode="search" autocomplete="off"
             placeholder="עירייה, רובע, יישוב או אתר" aria-label="חיפוש מקום">
      <div id="wpQres"><p class="note">שתי אותיות ומעלה. האפליקציה אינה מחפשת
        כתובות רחוב — אין בה מאגר כתובות ואין לה רשת.</p></div>
    </div>`;
}
function placeHits(term) {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return null;
  const hit = x => String(x || '').toLowerCase().includes(t);
  const out = [];
  D.mun.forEach(m => {
    if (hit(m.he) || hit(m.pt) || hit(m.dicofre)) out.push(
      { t: m.he, s: m.pt, k: 'עירייה', ll: latlng(m.center) });
  });
  D.fre.forEach(f => {
    if (hit(f.he) || hit(f.pt) || hit(f.dicofre)) out.push(
      { t: f.he || f.pt, s: bare(f.pt) + ' · ' + f.mun_he, k: 'רובע',
        ll: f.center ? latlng(f.center) : null });
  });
  for (const key of Object.keys(D.zones)) {
    if (out.length > 60) break;
    const f = D.freByKey.get(key);
    if (!f) continue;
    const where = (f.he || f.pt) + ' · ' + f.mun_he;
    D.zones[key].bairros.forEach(b => {
      if (b.ll && (hit(b.he) || hit(b.en))) out.push(
        { t: b.he || b.en, s: b.en + ' · ' + where, k: b.kind_he || 'יישוב', ll: b.ll });
    });
    D.zones[key].pois.forEach(pp => {
      if (hit(pp.name)) out.push(
        { t: pp.name, s: (D.poiLabel[pp.cat] || pp.cat) + ' · ' + where, k: 'אתר', ll: pp.ll });
    });
  }
  return out.filter(r => r.ll);
}
function runPlaceSearch(term) {
  const box = $('#wpQres');
  if (!box) return;
  const out = placeHits(term);
  if (out === null) {
    box.innerHTML = '<p class="note">שתי אותיות ומעלה. האפליקציה אינה מחפשת ' +
      'כתובות רחוב — אין בה מאגר כתובות ואין לה רשת.</p>';
    return;
  }
  box.innerHTML = out.length
    ? '<div class="rows">' + out.slice(0, 40).map((r, i) => `<button class="row"
        data-wpplace="${i}"><span class="row-body"><span class="row-t">${html(r.t)}</span>
        <span class="row-m"><span class="lat">${html(r.s)}</span></span></span>
        <span class="note">${html(r.k)}</span></button>`).join('') + '</div>'
    : `<p class="note">אין תוצאות ל״${html(term)}״.</p>`;
  wpFound = out.slice(0, 40);
}
let wpFound = [];

function wpCard(p) {
  const at = freguesiaAt(p.ll[0], p.ll[1]);
  const where = at ? (at.he || at.pt) + ', ' + D.munByNum.get(at.mun_num).he
                   : 'מחוץ למחוז פורטו';
  const armed = wpArmed === p.id;
  return `<article class="card wp" data-wp="${html(p.id)}">
      <div class="wp-h">
        <span class="dot mine" style="--c:${MINE_COLOUR}"></span>
        <h2>${html(p.name)}</h2>
        <span class="wp-acts">
          <button class="chip" data-wpact="edit" data-id="${html(p.id)}">עריכה</button>
          <button class="chip${armed ? ' wp-arm' : ''}" data-wpact="del" data-id="${html(p.id)}"
            >${armed ? 'למחוק? לחיצה נוספת' : 'מחיקה'}</button>
        </span>
      </div>
      ${p.desc ? `<p class="lead">${html(p.desc)}</p>` : ''}
      <p class="note"><bdi class="num">${p.ll[0].toFixed(5)}, ${p.ll[1].toFixed(5)}</bdi><br>
        ${html(where)}${p.at ? ' · ' + html(p.at) : ''}</p>
      ${p.photo ? `<figure class="ph-fig" data-wpimg="${html(p.id)}"
        ><img class="ph-img" alt="${html(p.name)}"></figure>` : ''}
    </article>`;
}

/* The form is a screen, not a card in a list: it runs from the top of the
   display down to whatever the keyboard leaves — visualViewport reports that,
   and 100dvh stands in where it does not exist.  Save and cancel are at the
   head, where a thumb reaching for the top of a phone lands and where they stay
   put while the fields below scroll. */
function renderWpSheet() {
  const sheet = $('#wpSheet');
  if (!sheet) return;
  // never over the map while the map is what is being used: the sheet covers
  // the whole display, and the crosshair and its two buttons are under it
  if (!mineEditing || S.adding) { sheet.hidden = true; sheet.innerHTML = ''; return; }
  const p = mineEditing;
  const fresh = !D.mine.some(x => x.id === p.id);
  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="sheet-h">
      <h2>${fresh ? 'מקום חדש' : 'עריכת מקום'}</h2>
      <span class="wp-acts">
        <button class="chip is-on" data-wpact="save">שמירה</button>
        <button class="chip" data-wpact="cancel">ביטול</button>
        ${fresh ? '' : `<button class="chip${wpArmed === p.id ? ' wp-arm' : ''}"
          data-wpact="del" data-id="${html(p.id)}"
          >${wpArmed === p.id ? 'למחוק? לחיצה נוספת' : 'מחיקה'}</button>`}
      </span>
    </div>
    <div class="sheet-b">
      <p class="note" id="mineWhere">${mineWhereHtml()}</p>
      <label class="fld-l" for="mineName">שם</label>
      <input id="mineName" type="text" autocomplete="off" placeholder="למשל: דירה שראיתי"
             value="${html(p.name || '')}">
      <label class="fld-l" for="mineDesc">תיאור</label>
      <textarea id="mineDesc" rows="4"
        placeholder="מה שחשוב לזכור על המקום הזה">${html(p.desc || '')}</textarea>
      <label class="fld-l" for="minePhotoIn">תמונה</label>
      <div id="minePhotoBox"></div>
      <div class="chips"><button class="chip" data-wpact="pick">בחירת מקום במפה</button></div>
    </div>`;
  sizeSheet();
  renderPhotoBox();
}

/* The keyboard does not resize the window on Android, it resizes the visual
   viewport — so the sheet is told its own height rather than left to guess. */
function sizeSheet() {
  const sheet = $('#wpSheet');
  if (!sheet || sheet.hidden) return;
  const vv = window.visualViewport;
  sheet.style.height = vv ? vv.height + 'px' : '';
  sheet.style.insetBlockStart = vv ? vv.offsetTop + 'px' : '0';
}

/* The thumbnails are fetched as they come into view.  A shrunk photo is still
   a third of a megabyte, and a list of them all decoded at once is a list that
   stutters — the observer means only what is being looked at is in memory. */
function wpThumbs() {
  if (wpObs) { wpObs.disconnect(); wpObs = null; }
  const figs = $$('#doc [data-wpimg]');
  if (!figs.length) return;
  const load = fig => {
    if (fig.dataset.done) return;
    fig.dataset.done = '1';
    const gone = () => { fig.innerHTML = '<p class="note">התמונה אינה במכשיר הזה. ' +
      'נקודות שיובאו כטקסט מגיעות בלי התמונות שלהן.</p>'; };
    getPhoto(fig.dataset.wpimg).then(b => {
      const img = fig.querySelector('img');
      if (b && img) img.src = wpUrl(b); else gone();
    }, gone);
  };
  if (!window.IntersectionObserver) { figs.forEach(load); return; }
  wpObs = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    load(e.target);
    wpObs.unobserve(e.target);
  }), { root: $('#paneText'), rootMargin: '250px' });
  figs.forEach(f => wpObs.observe(f));
}

function startWpEdit(id) {
  const p = D.mine.find(x => x.id === id);
  if (!p) return;
  if (mineEditing && mineEditing.id !== id) harvestWp();
  minePending = null;
  dropPhotoUrl();
  mineEditing = { ...p };
  S.wpSel = id;
  wpArmed = null;
  drawMine();
  renderWaypoints();
  const el = $('#mineName');
  if (el) el.focus();
}

function cancelWpEdit() {
  mineEditing = null; minePending = null; dropPhotoUrl();
  wpArmed = null;
  renderWaypoints();
}

/* A place the user did not name still has to be findable in the list, so it is
   given the next free number rather than an empty heading.  The next free one,
   not the count: deleting the third of three and adding one back should not
   produce a second "נקודת ציון 3". */
function autoName() {
  let top = 0;
  D.mine.forEach(p => {
    const m = /^נקודת ציון (\d+)$/.exec(String(p.name || '').trim());
    if (m) top = Math.max(top, Number(m[1]));
  });
  return 'נקודת ציון ' + (top + 1);
}

/* One way in for all three: a fresh record at a known place, with the form up. */
function openNewAt(ll, from) {
  minePending = null;
  dropPhotoUrl();
  mineEditing = { id: 'p' + Date.now().toString(36), ll: [ll[0], ll[1]],
                  name: from || '', desc: '' };
  S.wpSel = mineEditing.id;
  if (!S.wp) toggleWp();
  closePanel();
  drawMine();
  renderWaypoints();
  save();
  const el = $('#mineName');
  if (el) el.focus();
}

/* A new one starts as a placement, not as an empty card: the coordinates are
   the point of the record, and a card with nowhere on it is not one. */
function startWpAdd() {
  if (mineEditing) {
    harvestWp();
    mapNote('יש כרטיסייה בעריכה — לשמור או לבטל אותה קודם.', true);
    const el = $('#doc .wp.is-edit');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (!S.wp) toggleWp();
  // A new point starts as a card to fill in, not as a crosshair.  It is given
  // the middle of the map to stand on so that it has a place from the first
  // moment; "בחירת נ.צ. על המפה" inside the card moves it, and a photo with
  // coordinates overrides it outright.
  minePending = null;
  dropPhotoUrl();
  mineEditing = { id: 'p' + Date.now().toString(36), ll: defaultLL(), name: '', desc: '' };
  S.wpSel = mineEditing.id;
  if (S.view === 'map') { S.view = 'split'; applyView(); }
  closePanel();
  drawMine();
  renderWaypoints();
  save();
  const el = $('#mineName');
  if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); }
}

/* Where a point goes when nothing has said where it goes.
   The top-left corner of what is on screen, inset a little so the marker is
   whole and not half off the edge — a spot the user can see and drag from,
   rather than the middle of the view where it would sit under whatever they
   were looking at. */
function defaultLL() {
  if (!map) return [41.15, -8.61];
  const b = map.getBounds();
  const dLat = (b.getNorth() - b.getSouth()) * 0.12;
  const dLon = (b.getEast() - b.getWest()) * 0.12;
  return [b.getNorth() - dLat, b.getWest() + dLon];
}

/* After a point is dealt with the screen goes back to halves — the map to see
   where it landed, the text to read it. */
function backToHalves() {
  if (S.view === 'split') return;
  S.view = 'split';
  applyView(); save();
}

/* Everything a card offers, in the order a tap has to be read: the picture
   first, then a button, then the card itself — a tap that hit no button at all
   is the card saying "this one". */
function wpClick(e) {
  if (e.target.classList.contains('ph-img') && e.target.src) {
    openLightbox(e.target.src, e.target.alt);
    return true;
  }
  const rm = e.target.closest('[data-pt="rmphoto"]');
  if (rm && mineEditing) {
    // the point keeps the coordinates the photo gave it; only the picture goes,
    // and only once the point is saved
    minePending = null;
    delete mineEditing.photo;
    const where = $('#mineWhere');
    if (where) where.innerHTML = mineWhereHtml();
    renderPhotoBox('התמונה תוסר כשהנקודה תישמר.');
    return true;
  }
  const b = e.target.closest('[data-wpact]');
  if (b) {
    const act = b.dataset.wpact;
    if (act !== 'del') wpArmed = null;
    if (act === 'add') { wpAddOn(true); return true; }
    if (act === 'addoff') { wpAddOn(false); return true; }
    if (act === 'way-map') {
      wpAddOn(false);
      if (!S.wp) toggleWp();
      mineEditing = null; minePending = null; dropPhotoUrl();
      renderWaypoints();
      toggleAdd();
      return true;
    }
    if (act === 'way-photo') {
      const inp = $('#wpPhotoIn');
      if (inp) inp.click();
      return true;
    }
    if (act === 'way-place') {
      wpPlacing = !wpPlacing;
      renderWaypoints();
      const q = $('#wpQ');
      if (q) q.focus();
      return true;
    }
    if (act === 'edit') { startWpEdit(b.dataset.id); return true; }
    if (act === 'cancel') { cancelWpEdit(); return true; }
    if (act === 'save') { commitMine(); return true; }
    if (act === 'pick') { harvestWp(); toggleAdd(); return true; }
    if (act === 'fix') { fixPlacing(); return true; }
    if (act === 'del') {
      // two taps, because a card is the only copy of what is on it and the
      // list puts the button under a thumb that is scrolling past
      if (wpArmed !== b.dataset.id) { wpArmed = b.dataset.id; renderWaypoints(); return true; }
      wpArmed = null;
      deleteMine(b.dataset.id);
      return true;
    }
  }
  const hit = e.target.closest('[data-wpplace]');
  if (hit) {
    const r = wpFound[Number(hit.dataset.wpplace)];
    if (r) { wpAddOn(false); openNewAt(r.ll, r.t); }
    return true;
  }
  const card = e.target.closest('[data-wp]');
  if (card) {
    const id = card.dataset.wp;
    if (mineEditing && mineEditing.id === id) return true;   // it is being typed in
    if (isSecondTap('mine:' + id)) {
      const p = D.mine.find(x => x.id === id);
      if (p) { openInGoogle(p.ll, p.name); return true; }
    }
    selectWp(id, 'list');
    return true;
  }
  return false;
}

function commitMine() {
  if (!mineEditing) return;
  // No name is not an error: the record is worth keeping for its coordinate
  // alone, and the app names it rather than refusing to save it.
  const name = $('#mineName').value.trim() || autoName();
  const rec = { ...mineEditing, name, desc: $('#mineDesc').value.trim(),
    at: mineEditing.at || new Date().toISOString().slice(0, 10) };
  const pend = minePending;
  if (pend) rec.photo = { w: pend.w, h: pend.h, bytes: pend.bytes,
                          taken: pend.taken, from: pend.from, alt: pend.alt };
  const finish = () => {
    const i = D.mine.findIndex(x => x.id === rec.id);
    if (i < 0) D.mine.push(rec); else D.mine[i] = rec;
    saveMine();
    mineEditing = null; minePending = null; dropPhotoUrl();
    S.wpSel = rec.id;
    drawMine(); redrawText();
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
function deleteMine(id) {
  const gone = id || (mineEditing && mineEditing.id);
  if (!gone) return;
  delPhoto(gone);
  D.mine = D.mine.filter(x => x.id !== gone);
  saveMine();
  if (mineEditing && mineEditing.id === gone) {
    mineEditing = null; minePending = null; dropPhotoUrl();
  }
  if (S.wpSel === gone) S.wpSel = null;
  drawMine(); redrawText();
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
  mapNote(added
    ? ((added === 1 ? 'נוספה נקודה אחת' : 'נוספו ' + nf(added) + ' נקודות') +
       (skipped ? ', ' + (skipped === 1 ? 'אחת דולגה' : nf(skipped) + ' דולגו') : '') + '.')
    : 'לא נוספה אף נקודה חדשה.', !added);
}

let ghost = null;              // the crosshair being positioned

function toggleAdd() {
  S.adding = !S.adding;

  if (S.adding) startPlacing(); else stopPlacing();
}

function startPlacing() {
  // the map gets the whole screen while a point is being placed
  S.viewBefore = S.view;
  S.view = 'map'; applyView();
  // a card being edited already has somewhere; the crosshair starts there
  // rather than in the middle of whatever the map happens to be showing
  const at = mineEditing && mineEditing.ll ? mineEditing.ll : map.getCenter();
  const mk = L.marker(at, {
    icon: L.divIcon({ className: 'ghost', iconSize: [46, 46], iconAnchor: [23, 23],
      html: '<span class="ghost-ring"></span><span class="ghost-dot"></span>' }),
    draggable: true, autoPan: true, zIndexOffset: 2000,
  }).addTo(map);
  mk.on('dblclick', fixPlacing);
  // a double tap on a touch screen does not always reach the marker as
  // dblclick, so the same 450 ms rule the rest of the app uses stands in
  mk.on('click', () => { if (isSecondTap('ghost')) fixPlacing(); });
  ghost = mk;
  // The map fills both halves while a place is being chosen, so the two buttons
  // that end it have to be on the map itself — a note in the text half would be
  // off screen.  Drag the crosshair, then בחירה.
  const bar = $('#pickBar');
  if (bar) bar.hidden = false;
  hideNote();
  S.view = 'map'; applyView();
}

function stopPlacing() {
  if (ghost) { map.removeLayer(ghost); ghost = null; }
  S.adding = false;
  const bar = $('#pickBar');
  if (bar) bar.hidden = true;

  $('#map').style.cursor = '';
  hideNote();
  if (S.viewBefore) { S.view = S.viewBefore; S.viewBefore = null; applyView(); save(); }
  if (S.wp) renderWaypoints();      // brings the form back if one was open
}

/* Where the crosshair was let go.  It is either the נ.צ. of the card being
   edited — the "בחירת נ.צ. על המפה" button — or a new card, which is what the
   + button means.  Both end in management, with the card open. */
function fixPlacing() {
  if (!ghost) return;
  const at = ghost.getLatLng();
  const ll = [at.lat, at.lng];
  map.removeLayer(ghost);
  ghost = null;
  S.adding = false;
  S.viewBefore = null;
  const bar = $('#pickBar');
  if (bar) bar.hidden = true;

  hideNote();
  if (mineEditing) mineEditing.ll = ll;
  else {
    minePending = null;
    dropPhotoUrl();
    mineEditing = { id: 'p' + Date.now().toString(36), ll, name: '', desc: '' };
  }
  if (!S.wp) { S.wp = true; renderMenu(); }
  S.wpSel = mineEditing.id;
  // both halves: the card to fill in, the map to see that it landed right
  S.view = 'split'; applyView(); save();
  closePanel();
  drawMine();
  renderWaypoints();
  const el = $('#mineName');
  if (el) el.focus();
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
      style: { weight: 0, fillColor: f.colour || '#dddddd',
               fillOpacity: S.muncol ? .35 : 0 } }).addTo(map);

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
    })}
    ${regionsDoc()}`;
  $('#paneText').scrollTop = 0;
}

/* The user's own points, listed.  `within` decides which ones: everything at
   district level, the ones inside this parish at level 3. */
function mineList(within) {
  const rows = D.mine.filter(p => !within || within(p));
  // at district level the card shows even when empty, so points exported from
  // another phone have somewhere to be pasted in
  if (!rows.length && within) return '';
  // Saving and importing live in the menu, and only there — three doorways to
  // the same two actions was three places to keep in step.
  return `<div class="card">
      <h2>המקומות שלי</h2>
    </div>
    <div class="rows">${rows.map(p => `<button class="row" data-mine="${html(p.id)}">
        <span class="dot mine" style="--c:${MINE_COLOUR}"></span>
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
const VIEW_HE = { split: 'חצי מפה, חצי טקסט', map: 'מפה על כל המסך', text: 'טקסט על כל המסך' };

function applyView() {
  document.body.dataset.view = S.view;
  // Leaflet has to be told its box changed; the ResizeObserver catches it too,
  // but only after a frame, and the flash is visible
  if (map) requestAnimationFrame(() => map.invalidateSize({ animate: false }));
}

/* The four map switches.  Each is one thing the map either shows or does not,
   pressed state on the button and nothing else to read. */
function toggleTiles() {
  S.tiles = !S.tiles;
  if (S.tiles) tileLayer.addTo(map); else map.removeLayer(tileLayer);
  applySwitches(); save();
}
function toggleFills() {
  S.muncol = !S.muncol;
  redrawLevel();
  applySwitches(); save();
}
/* Four states, not two.  All three levels drawn, then each one dropped in turn,
   outside in: מחוז, then עיריות, then רובעים, then everything back.  The state
   is the three flags themselves — the same ones the layer panel sets one by one
   — so there is no cycle counter to drift out of step with what is on the map.
   A combination the panel made that is not one of the four lands on "all on"
   next, which is the one step from anywhere that is easy to predict. */
const BOUNDS_CYCLE = [
  [true,  true,  true ],   // הכל
  [false, true,  true ],   // בלי גבול המחוז
  [true,  false, true ],   // בלי גבולות העיריות
  [true,  true,  false],   // בלי גבולות הרובעים
];
function boundsStep() {
  const now = [S.lnDistrict, S.lnMun, S.lnFre];
  const i = BOUNDS_CYCLE.findIndex(c => c.every((v, n) => v === now[n]));
  return i < 0 ? 0 : (i + 1) % BOUNDS_CYCLE.length;
}
function cycleBounds() {
  [S.lnDistrict, S.lnMun, S.lnFre] = BOUNDS_CYCLE[boundsStep()];
  drawLines(); applySwitches(); renderLayers(); save();
}
// The explanation at the foot of the page belongs to this line, so the text
// half is redrawn with it rather than only the map.
function toggleRegions() {
  S.lnRegion = !S.lnRegion;
  drawLines(); redrawText(); applySwitches(); save();
}

/* Redraw whichever level is on screen, because the fill belongs to the level
   and each level draws its own. */
function redrawLevel() {
  if (S.level === 'district') drawDistrict();
  else if (S.level === 'mun') drawMun(S.mun);
  else drawZone(S.zone);
}

function applySwitches() {
  const set = (id, on) => { const b = $(id); if (b) b.setAttribute('aria-pressed', String(!!on)); };
  set('#layersBtn', S.tiles);
  set('#fillsBtn', S.muncol);
  set('#regionsBtn', S.lnRegion);
  paintBounds();
  renderMenu();
}

/* The rings read straight off the flags, so the button tells the truth whether
   the change came from itself or from a row in the layer panel. */
const BOUNDS_HE = { d: 'המחוז', m: 'העיריות', f: 'הרובעים' };
/* Four states cannot be a tick, so the row says which one it is in. */
function boundsOff() {
  return [['d', S.lnDistrict], ['m', S.lnMun], ['f', S.lnFre]]
    .filter(([, on]) => !on).map(([k]) => k);
}
function boundsHe() {
  const off = boundsOff();
  return off.length ? ' · בלי ' + off.map(k => BOUNDS_HE[k]).join(', ') : ' · הכל';
}
function paintBounds() {
  const b = $('#bordersBtn'); if (!b) return;
  const off = boundsOff();
  b.setAttribute('data-b', off.join(' '));
  b.setAttribute('aria-label', 'גבולות' + boundsHe());
}

/* ------------------------------------------------------------------ menu --- */
/* One screen, one list, and every row says its own state.  The rows are data
   rather than markup because the state is what makes them worth reading: a
   category that is off, a view that is on, a theme that is in force.

   kind:
     act    does something and closes the menu — you are being sent somewhere
     tog    a switch; the menu stays open, because these come in handfuls
     radio  one of a set; the view ones close, the theme ones do not, because
            the theme's effect is visible on the menu itself */
const ICON = {
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  pin: '<path d="M12 21.5s6.5-6 6.5-10.5a6.5 6.5 0 1 0-13 0c0 4.5 6.5 10.5 6.5 10.5z"/><circle cx="12" cy="10.5" r="2.4"/>',
  locate: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  station: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 20l-2 2M15 20l2 2"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M8 16h8"/>',
  hospital: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M12 9v7M8.5 12.5h7"/>',
  university: '<path d="M12 4 2.5 9 12 14l9.5-5L12 4z"/><path d="M6 11.5V16c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4.5"/>',
  museum: '<path d="M3 9 12 4l9 5"/><path d="M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 20h18"/>',
  culture: '<path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2z"/><path d="M12 6.5v13"/>',
  market: '<path d="M4 8h16l-1.2 11H5.2L4 8z"/><path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2"/>',
  landmark: '<path d="M12 3 9 8h6l-3-5z"/><path d="M10.5 8v9h3V8"/><path d="M6 17h12M4 20h16"/>',
  green: '<path d="M12 3c3.3 0 6 2.5 6 5.6 0 3-2.3 5.4-5 5.9V21h-2v-6.5c-2.7-.5-5-2.9-5-5.9C6 5.5 8.7 3 12 3z"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/>',
  maponly: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>',
  textonly: '<path d="M4 6h16M4 10h16M4 14h12M4 18h8"/>',
  day: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',
  night: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  tiles: '<path d="M12 3 3 7.5 12 12l9-4.5L12 3zM3 12l9 4.5L21 12M3 16.5 12 21l9-4.5"/>',
  glass: '<path d="M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z" fill="currentColor" fill-opacity=".28"/><path d="M4 5h16v15H4z"/>',
  borders: '<circle cx="12" cy="12" r="9.5" stroke-width="3"/><circle cx="12" cy="12" r="6" stroke-width="2"/><circle cx="12" cy="12" r="2.75" stroke-width="1"/>',
  more: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  regions: '<path d="M3 8h8v9H3zM11 5h10v11H11z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  dots: '<circle cx="7" cy="8" r="2"/><circle cx="15" cy="6" r="2"/><circle cx="18" cy="14" r="2"/><circle cx="9" cy="16" r="2"/><circle cx="5" cy="18" r="1.4"/>',
  save: '<path d="M12 3v11M8 10.5l4 3.5 4-3.5"/><path d="M4 16v3.5h16V16"/>',
  load: '<path d="M12 14V3M8 6.5 12 3l4 3.5"/><path d="M4 16v3.5h16V16"/>',
};

/* The eight point categories are the same eight the data ships, in the same
   order and under the same Hebrew names — the menu does not rename them. */
const menuRows = () => [
  { k: 'search', he: 'חיפוש', icon: 'search', kind: 'act' },
  { k: 'mine', he: 'המקומות שלי', icon: 'pin', kind: 'act' },
  { k: 'locate', he: 'המיקום שלי', icon: 'locate', kind: 'act', mapOnly: true },
  /* The eight categories under one heading that switches them together, with a
     chevron beside it that opens the list so each can be set on its own.  Eight
     rows at the top of the menu were eight-ninths of what you scrolled past to
     reach anything else. */
  { k: 'cats', he: 'נקודות ציון', icon: 'dots', kind: 'tog', more: 'cats-open' },
  ...(S.catsOpen
    ? D.poiOrder.map(c => ({ k: 'cat:' + c, he: D.poiLabel[c], icon: c, kind: 'tog', sub: true }))
    : []),
  { grp: 'תצוגה' },
  { k: 'view:split', he: 'גרפיקה וטקסט', icon: 'split', kind: 'radio' },
  { k: 'view:map', he: 'גרפיקה בלבד', icon: 'maponly', kind: 'radio' },
  { k: 'view:text', he: 'טקסט בלבד', icon: 'textonly', kind: 'radio' },
  { k: 'theme:light', he: 'תצוגת יום', icon: 'day', kind: 'radio' },
  { k: 'theme:dark', he: 'תצוגת לילה', icon: 'night', kind: 'radio' },
  { grp: 'שכבות' },
  { k: 'tiles', he: 'מפת רקע', icon: 'tiles', kind: 'tog' },
  { k: 'glass', he: 'ויטרז׳ מפות', icon: 'glass', kind: 'tog' },
  // Not on the list that was asked for, and kept anyway: the three-ring cycle
  // was designed row by row two versions ago, and the full panel is the only
  // way to נהרות, אותיות and one border kind at a time.  Dropping a control
  // because a later list did not repeat it is how a feature disappears.
  { k: 'borders', he: 'גבולות' + boundsHe(), icon: 'borders', kind: 'act' },
  { k: 'more', he: 'עוד שכבות', icon: 'more', kind: 'act' },
  { grp: '' },
  { k: 'regions', he: 'אזורים', icon: 'regions', kind: 'tog' },
  { grp: 'נתונים' },
  // The points the user marked, and only those — everything else in the app
  // ships with it and needs no saving.  Both were reachable only from inside
  // the נ.צ. screen before.
  { k: 'save', he: 'שמירת נתונים', icon: 'save', kind: 'act' },
  { k: 'load', he: 'ייבוא נתונים', icon: 'load', kind: 'act' },
  { grp: '' },
  { k: 'info', he: 'מידע', icon: 'info', kind: 'act' },
];

// what a row's mark should read, or null when the row carries no state
function menuState(k) {
  if (k === 'cats') return S.cats.size > 0;
  if (k.startsWith('cat:')) return S.cats.has(k.slice(4));
  if (k.startsWith('view:')) return S.view === k.slice(5);
  if (k.startsWith('theme:')) return (isDark() ? 'dark' : 'light') === k.slice(6);
  if (k === 'tiles') return S.tiles;
  if (k === 'glass') return S.muncol;
  if (k === 'regions') return S.lnRegion;
  if (k === 'locate') return !!meWatch;
  if (k === 'mine') return S.wp;
  return null;
}

function renderMenu() {
  const box = $('#menuIn');
  if (!box) return;
  box.innerHTML = menuRows().map(r => {
    if (r.grp !== undefined) return r.grp ? `<div class="mgrp">${html(r.grp)}</div>`
                                          : '<div class="mgrp" aria-hidden="true"></div>';
    const on = menuState(r.k);
    const flag = on === null ? ''
      : (r.kind === 'radio' ? ` aria-current="${on}"` : ` aria-pressed="${on}"`);
    const row = `<button class="mrow${r.mapOnly ? ' map-only' : ''}${r.sub ? ' mrow-sub' : ''}"
        data-m="${html(r.k)}"${flag}>
        <svg viewBox="0 0 24 24" aria-hidden="true">${ICON[r.icon] || ''}</svg>
        <span class="mrow-l">${html(r.he)}</span>
        <span class="mrow-k" aria-hidden="true">${r.kind === 'radio' ? '●' : '✓'}</span>
      </button>`;
    if (!r.more) return row;
    // the heading switches all eight; the chevron beside it opens the list
    return `<div class="mrow-pair">${row}
        <button class="mrow-more" data-m="${html(r.more)}"
                aria-expanded="${!!S.catsOpen}" aria-label="פירוט נקודות הציון">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </button>
      </div>`;
  }).join('') + (S.level === 'zone' ? '' :
    '<p class="mnote">הנקודות עצמן מצוירות ברמת הרובע; הבחירה כאן נשמרת וחלה שם.</p>');
}

function openMenu(on) {
  S.menu = on;
  $('#menu').hidden = !on;
  $('#menuBtn').setAttribute('aria-expanded', String(on));
  if (on) { renderMenu(); $('#menu').scrollTop = 0; }
}

function menuTap() { openMenu(!S.menu); }

/* Day and night are a choice the user makes, not only what the phone is set to.
   'auto' is the state before any choice: the row that matches what the system
   resolves to is the one marked, so the menu never lies about what is on
   screen. */
function themeAttr() {
  const r = document.documentElement;
  if (S.theme === 'auto') delete r.dataset.theme; else r.dataset.theme = S.theme;
}
// At boot the attribute is all there is to do — nothing is drawn yet.  After
// that the colours the level picked have to be picked again.
function applyTheme() {
  themeAttr();
  if (!map) return;
  redrawLevel(); drawMine(); applyHi();
}

/* Sources, accuracy and what is missing — the one full-screen window. */
function openInfo() { renderInfo(); $('#infoDrawer').hidden = false; }

function menuPick(k) {
  if (k === 'cats-open') { S.catsOpen = !S.catsOpen; renderMenu(); return; }
  if (k === 'cats') {
    // one tap sets all eight the same way: off if any were on, on if none were
    const any = S.cats.size > 0;
    S.cats = new Set(any ? [] : D.poiOrder);
    if (S.level === 'zone') { drawZone(S.zone); redrawText(); }
    save(); renderMenu(); return;
  }
  if (k.startsWith('cat:')) {
    const c = k.slice(4);
    // All eight can be off at once.  A guard used to put the last one back —
    // "never leave the map blank" — which made one switch refuse to switch.
    if (S.cats.has(c)) S.cats.delete(c); else S.cats.add(c);
    if (S.level === 'zone') { drawZone(S.zone); redrawText(); }
    save(); renderMenu(); return;
  }
  if (k.startsWith('view:')) {
    S.view = k.slice(5); applyView(); save(); openMenu(false); return;
  }
  if (k.startsWith('theme:')) {
    S.theme = k.slice(6); applyTheme(); save(); renderMenu(); return;
  }
  switch (k) {
    case 'search':  openMenu(false); openSearch(); break;
    case 'mine':    openMenu(false); toggleWp(); break;
    case 'locate':  openMenu(false); toggleLocate(); break;
    case 'tiles':   toggleTiles(); renderMenu(); break;
    case 'glass':   toggleFills(); renderMenu(); break;
    case 'borders': cycleBounds(); renderMenu(); break;
    case 'more':    openMenu(false); toggleLayers(true); break;
    case 'regions': toggleRegions(); renderMenu(); break;
    case 'save':    openMenu(false); exportMine(); break;
    case 'load':    openMenu(false); openImport(); break;
    case 'info':    openMenu(false); openInfo(); break;
  }
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
  { const b = $('#layerListBtn'); if (b) b.setAttribute('aria-expanded', String(kind === 'layers')); }
  // the panel lives in the text half, so that half has to be on screen
  if (S.view === 'map') { S.view = 'split'; applyView(); save(); }
  $('#paneText').scrollTop = 0;
}
function closePanel() {
  panelKind = null;
  $('#panel').hidden = true;
  $('#panelBody').innerHTML = '';
  { const b = $('#layerListBtn'); if (b) b.setAttribute('aria-expanded', 'false'); }
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
    row(S.mine, 'mine', 'המקומות שלי', MINE_COLOUR, true, D.mine.length) +
    (S.wp ? '<p class="note">בזמן ניהול המקומות מוצגים כולם, והשכבה הזאת ' +
            'חוזרת לפעול ביציאה ממנו.</p>' : '');

  // Which of these are black and which are grey is the level's decision, not
  // the user's; the switch is only whether the line is there at all.
  h += '<h3>קווי גבול</h3>' +
    ['region', 'district', 'mun', 'fre'].map(k =>
      row(S[LINE_ON[k]], 'ln:' + k, LINE_HE[k], lineColour(k), true)).join('') +
    '<p class="note" style="margin-block-start:6px">הקווים ששייכים למה שעל ' +
    'המסך מוצגים בשחור, והשאר באפור. קו האזורים ' +
    'אפור תמיד.</p>';
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
  // management replaces the level document: the map is still at its level and
  // still navigable, but the text half is the list of נ.צ. until it is closed
  if (S.wp) { renderWaypoints(); return; }
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
                 fillOpacity: S.muncol ? (on ? .92 : .78) : 0 });
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
  drawDistrict(); redrawText(); afterNav();
}
function goMun(num) {
  S.level = 'mun'; S.mun = num; S.zone = null; S.hi = null;
  drawMun(num); redrawText(); afterNav();
}
function goZone(key) {
  const f = D.freByKey.get(key);
  if (!f) return;
  S.level = 'zone'; S.mun = f.mun_num; S.zone = key; S.hi = null;
  S.cats = new Set(D.poiOrder);
  drawZone(key); redrawText(); afterNav();
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

/* ------------------------------------------------------------------ split --- */
/* Half and half, and no way to drag it: --f is a constant in the stylesheet,
   the seam between the halves is a 1px line, and the layout button is the only
   thing that changes which halves are on screen.  The two shares that used to
   be remembered per orientation are gone from the saved state with it. */
const landscape = () => window.matchMedia('(orientation:landscape)').matches;

function watchOrientation() {
  window.matchMedia('(orientation:landscape)').addEventListener('change', () => {
    setTimeout(() => map.invalidateSize({ animate: false }), 60);
  });
}

/* ----------------------------------------------------------------- state --- */
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      level: S.level, mun: S.mun, zone: S.zone, view: S.view, theme: S.theme,
      letters: S.letters, mine: S.mine, water: S.water,
      muncol: S.muncol,
      lnRegion: S.lnRegion, lnDistrict: S.lnDistrict,
      lnMun: S.lnMun, lnFre: S.lnFre,
      tiles: S.tiles,
    }));
  } catch (e) { /* private mode */ }
}
function restore() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (typeof o.tiles === 'boolean') S.tiles = o.tiles;
    if (typeof o.letters === 'boolean') S.letters = o.letters;
    if (typeof o.mine === 'boolean') S.mine = o.mine;
    ['lnRegion', 'lnDistrict', 'lnMun', 'lnFre'].forEach(k => {
      if (typeof o[k] === 'boolean') S[k] = o[k];
    });
    if (typeof o.water === 'boolean') S.water = o.water;
    if (typeof o.muncol === 'boolean') S.muncol = o.muncol;
    if (o.view === 'split' || o.view === 'map' || o.view === 'text') S.view = o.view;
    if (o.theme === 'light' || o.theme === 'dark' || o.theme === 'auto') S.theme = o.theme;
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
      המפה תוצג כגבולות בלבד, וכל הנתונים והטקסטים זמינים במלואם.</p>

    <h2>נקודות הציון שלכם</h2>
    <p>הן נשמרות <b>במכשיר הזה בלבד</b>. לא נשלחות לשום מקום ולא מגובות.</p>
    <p>לחיצה על כרטיסייה מדגישה את הנקודה שלה במפה, ולחיצה על נקודה במפה פותחת
      את הכרטיסייה שלה. לחיצה כפולה על נקודה פותחת אותה במפות גוגל.</p>
    <p>בבחירת תמונה אפשר לסמן כמה תמונות בבת אחת. הראשונה נכנסת לכרטיסייה
      הפתוחה, וכל אחת מהשאר הופכת לנקודה משלה. תמונה שיש בה קואורדינטות נוחתת
      עליהן; תמונה שאין בה נוחתת בפינה השמאלית העליונה של המפה — מקום שאפשר
      לראות ולגרור ממנו, ולא טענה על היכן היא צולמה.</p>
    <p>בסימון נ.צ. על המפה: גוררים את הסימון למקום, ולחיצה כפולה עליו קובעת
      אותו.</p>
    <p class="note">ההעתקה מוציאה את הנקודות כטקסט. התמונות עצמן נשארות במכשיר
      ולא נכללות בה, ולכן נקודה שתיובא במכשיר אחר תגיע בלי התמונה שלה.</p>`;
}

/* ------------------------------------------------------------------ wire --- */
function wire() {
  $('#resetBtn').addEventListener('click', refit);
  $('#menuBtn').addEventListener('click', menuTap);
  $('#menuClose').addEventListener('click', () => openMenu(false));
  $('#menuIn').addEventListener('click', e => {
    const r = e.target.closest('[data-m]');
    if (r) menuPick(r.dataset.m);
  });
  $('#panelClose').addEventListener('click', closePanel);
  $('#panelBody').addEventListener('click', e => {
    if (panelIs('search')) { panelSearchClick(e); return; }
    if (panelIs('import')) {
      if (e.target.closest('#impSave')) commitImport();
      return;
    }
    const b = e.target.closest('[data-lay]');
    if (!b) return;
    const k = b.dataset.lay;
    if (k === 'tiles') {
      S.tiles = !S.tiles;
      if (S.tiles) tileLayer.addTo(map); else map.removeLayer(tileLayer);
    }
    else if (k === 'letters') { S.letters = !S.letters; }
    else if (k === 'water') { S.water = !S.water; applyNature(); }
    else if (k === 'muncol') { S.muncol = !S.muncol; redrawLevel(); }
    else if (k === 'mine') { S.mine = !S.mine; drawMine(); }
    else if (k.startsWith('ln:')) {
      const key = LINE_ON[k.slice(3)];
      S[key] = !S[key];
      drawLines();
    }
    else if (k.startsWith('cat:')) {
      const c = k.slice(4);
      if (S.cats.has(c)) S.cats.delete(c); else S.cats.add(c);
    }
    save();
    if (S.level === 'zone') { drawZone(S.zone); redrawText(); }
    drawMine(); renderLayers(); applyHi(); applySwitches();
  });
  $('#panelBody').addEventListener('input', e => {
    if (panelIs('search') && e.target.id === 'q') runSearch(e.target.value);
  });
  // the photo picker lives on the form sheet now; the one on the מקומות screen
  // is the "בחירת מקום מתמונה" way in and starts a place rather than adding to one
  $('#wpSheet').addEventListener('change', e => {
    if (e.target.id === 'minePhotoIn') takePhotos(e.target.files);
  });
  $('#wpSheet').addEventListener('click', e => { wpClick(e); });
  $('#doc').addEventListener('change', e => {
    if (e.target.id === 'wpPhotoIn') { wpAddOn(false); takePhotos(e.target.files); }
  });
  $('#doc').addEventListener('input', e => {
    if (e.target.id === 'wpQ') runPlaceSearch(e.target.value);
  });
  $('#pickBar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.add === 'off') stopPlacing();
    else if (b.dataset.wpact === 'fix') fixPlacing();
  });
  // the keyboard resizes the visual viewport, not the window
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', sizeSheet);
    window.visualViewport.addEventListener('scroll', sizeSheet);
  }
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
    // the נ.צ. cards come first: while they are on screen they are the screen
    if (S.wp && wpClick(e)) return;
    const src = e.target.closest('[data-src]');
    if (src) { showSource(src.dataset.src, src.dataset.exact); return; }
    const cat = e.target.closest('[data-cat]');
    if (cat) {
      const c = cat.dataset.cat;
      // Third copy of the same toggle — menu row, layer panel row, and this
      // chip — and the guard survived here after the other two lost it, because
      // the check only ever clicked the menu.
      if (S.cats.has(c)) S.cats.delete(c); else S.cats.add(c);
      save();
      drawZone(S.zone); renderZone(S.zone); applyHi(); renderMenu();
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
      openWp(mine.dataset.mine);
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

  $('#infoClose').addEventListener('click', () => { $('#infoDrawer').hidden = true; });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (S.menu) openMenu(false);
    else if (!$('#panel').hidden) closePanel();
    else if (!$('#infoDrawer').hidden) $('#infoDrawer').hidden = true;
    else if (S.adding) stopPlacing();
    else if (mineEditing) cancelWpEdit();
    else if (S.wp) toggleWp();
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
  themeAttr();
  applySwitches();
  initMap();
  initNature();
  wire();
  watchOrientation();

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
