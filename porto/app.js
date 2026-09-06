/* מחוז פורטו — split-screen app.
   Data: data/processed/*.json, built by scripts/build.py from the source
   document's own texts, CAOP 2020 boundaries, INE Censos 2021 and OSM.
   Nothing here is invented: a field with no value renders "אין נתון", and every
   number carries the source and the reference year it came with.

   Three levels, one screen split in two:
     district   18 numbered municipalities + the three belt outlines
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
  letters: true,       // draw the locality letters
  water: true,         // rivers and lakes
  green: true,         // parks, gardens and beaches
  mine: true,          // draw the points the user added
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

function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/* A number, its unit, and the year it refers to — the year is on screen next to
   every value, and the whole chip opens the full source record. */
function stat(label, val, unit, dec, srcKey) {
  const f = D.sources.fields[srcKey] || {};
  const has = val !== null && val !== undefined;
  return `<button class="stat${has ? '' : ' no'}" data-src="${html(srcKey)}">
    <span class="stat-l">${html(label)}</span>
    <span class="stat-v ${has ? 'num' : ''}">${has ? nf(val, dec) : MISSING}${has && unit ? ' ' + html(unit) : ''}</span>
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
  const [ind, mun, fre, city, zones, bW, bG, sources, bM, bB, bF, bC] = await Promise.all([
    j('data/processed/indicators.json'),
    j('data/processed/municipios.json'),
    j('data/processed/freguesias.json'),
    j('data/processed/porto_city.json'),
    j('data/processed/zones.json'),
    j('data/processed/boundaries_water.geojson'),
    j('data/processed/boundaries_green.geojson'),
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
  D.bM = bM; D.bB = bB; D.bF = bF; D.bC = bC; D.bW = bW; D.bG = bG;
  // an undefined layer renders as nothing at all, in silence; say so instead
  for (const [k, v] of Object.entries({ bM, bB, bF, bC, bW, bG })) {
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
  D.freByMun.forEach(list => list.sort((a, b) => a.n - b.n));
  D.quarterByNum = new Map(D.city.map(q => [q.num, q]));
  // Porto's seven parishes *are* the seven city quarters; keep one numbering
  // for both so level 2 and level 3 agree.
  D.quarterOfFre = new Map(D.city.map(q => [q.en, q.num]));
  D.fre.filter(f => f.mun_num === 1).forEach(f => { f.q = D.quarterOfFre.get(bare(f.pt)) || null; });
  // Porto's list is printed with the quarter numbers, so it has to be ordered
  // by them too, not by the per-municipality numbering build.py assigned.
  D.freByMun.get(1).sort((a, b) => (a.q || 99) - (b.q || 99));
  D.totPop = D.mun.reduce((a, m) => a + (m.pop2021 || 0), 0);
  D.totArea = D.mun.reduce((a, m) => a + (m.area_km2 || 0), 0);
  D.totPoi = D.city.reduce((a, q) => a + q.pois.length, 0);
}

/* ------------------------------------------------------------------- map --- */
let map, tileLayer;
const LG = {};                      // the layers currently on the map
let fitBounds = null;               // what the "fit" button goes back to

function stroke() { return isDark() ? 'rgba(232,236,243,.55)' : 'rgba(20,25,34,.45)'; }
// the contour that says "this is the municipality you picked": solid, not the
// translucent line every other boundary uses, or it disappears among them
function edge() { return isDark() ? '#f2f5fa' : '#10151f'; }

function initMap() {
  map = L.map('map', {
    // Every gesture stays on: the map can be panned, pinched and zoomed
    // freely inside its half, and the divider changes how big that half is.
    zoomControl: true, attributionControl: false,
    dragging: true, touchZoom: true, scrollWheelZoom: true, doubleClickZoom: true,
    boxZoom: false, keyboard: true, tap: true,
    minZoom: 7, maxZoom: 19,
    // the district and the city are both wide and short; with whole-number
    // zoom only, fitBounds lands a level short and leaves them half-size
    zoomSnap: 0.25, zoomDelta: 0.5,
  });
  map.zoomControl.setPosition('topright');
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
    $('#tilesBtn').setAttribute('aria-pressed', 'false');
    const n = $('#tileNote');
    n.hidden = false;
    n.textContent = 'רקע המפה לא נטען — מוצגים הגבולות בלבד. כל הנתונים זמינים.';
    setTimeout(() => { n.hidden = true; }, 6000);
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

  NAT.water = L.geoJSON(D.bW, {
    pane: 'nature', interactive: false,
    style: ft => /LineString/.test(ft.geometry.type)
      ? { color: '#2f7fc1', weight: 1.8, opacity: .85, fill: false }
      : { color: '#2f7fc1', weight: .8, opacity: .8, fillColor: '#4a9ad4', fillOpacity: .55 },
  });
  NAT.green = L.geoJSON(D.bG, {
    pane: 'nature', interactive: false,
    style: { color: '#3f8a45', weight: .8, opacity: .75, fillColor: '#5aa860', fillOpacity: .45 },
  });
  applyNature();
}
function applyNature() {
  [['water', S.water], ['green', S.green]].forEach(([k, on]) => {
    if (!NAT[k]) return;
    if (on && !map.hasLayer(NAT[k])) NAT[k].addTo(map);
    if (!on && map.hasLayer(NAT[k])) map.removeLayer(NAT[k]);
  });
}

function clearMap() {
  Object.keys(LG).forEach(k => { if (LG[k]) { map.removeLayer(LG[k]); delete LG[k]; } });
}

function numIcon(text, cls) {
  return L.divIcon({
    className: 'lbl' + (cls ? ' ' + cls : ''), html: html(text),
    iconSize: [24, 24], iconAnchor: [12, 12],
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

function mapNote(inner, bad) {
  const n = $('#locNote');
  n.className = 'map-note' + (bad ? ' bad' : '');
  n.innerHTML = '<button class="x" type="button" data-close="1" aria-label="סגירה">✕</button>' + inner;
  n.hidden = false;
}
function hideNote() { $('#locNote').hidden = true; }

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

  const f = freguesiaAt(lat, lon);
  const m = f ? D.munByNum.get(f.mun_num) : null;
  if (f) {
    map.setView(ll, Math.max(map.getZoom(), 14));
    mapNote(`אתה ב<b>${html(f.he || f.pt)}</b>, ${html(m.he)} ·
      דיוק ${nf(Math.round(acc))} מ׳
      <button type="button" data-jump="fre:${html(D.freKey(f))}">פתיחת הפרגזיה</button>`);
  } else {
    // Anywhere else on earth: say so, and say how far, instead of dropping the
    // map on an empty spot in the ocean.
    const km = Math.round(map.distance(ll, [41.14961, -8.61099]) / 1000);
    map.setView(ll, 9);
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
      color: stroke(), weight: 1, opacity: .9,
      fillColor: (D.munByNum.get(ft.properties.num) || {}).fill || '#ddd', fillOpacity: .8,
    }),
    onEachFeature: (ft, l) => {
      const m = D.munByNum.get(ft.properties.num);
      l.on('click', () => {
        if (S.adding) return;
        if (isSecondTap('mun:' + m.num)) { openInGoogle(latlng(m.center), m.he); return; }
        goMun(ft.properties.num);
      });
      l.bindTooltip(`<b>${html(m.num + '. ' + m.he)}</b><br><span class="lat">${html(m.pt)}</span>`,
        { sticky: true, className: 'tt' });
    },
  }).addTo(map);

  // The grouping line the source document draws: one outline per belt, in the
  // belt's own colour, over the municipality fills.
  LG.belts = L.geoJSON(D.bB, {
    interactive: false,
    style: ft => ({ color: ft.properties.colour, weight: 3.5, opacity: .95, fill: false, lineJoin: 'round' }),
  }).addTo(map);

  LG.labels = L.layerGroup(D.mun.map(m => {
    const mk = L.marker(latlng(m.center), { icon: numIcon(m.num), keyboard: false,
      title: m.num + '. ' + m.he, riseOnHover: true });
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
        <span class="row-m num">עיריות ${html(b.nums.join(', '))}</span>
      </span></div>`).join('');

  const list = D.mun.slice().sort((a, b) => a.num - b.num).map(m => {
    const chr = (m.profile.find(p => p.label === 'אופי') || {}).text || '';
    return `<button class="row" data-mun="${m.num}">
      <span class="pin" style="--c:${html(m.fill)}">${m.num}</span>
      <span class="row-body">
        <span class="row-t">${html(m.he)} <span class="lat">(${html(m.en)})</span></span>
        <span class="row-d">${html(chr)}</span>
        <span class="row-m">${html(m.belt)} · <span class="num">${nf(m.pop2021)}</span> תושבים ·
          <span class="num">${nf(m.area_km2, 1)}</span> קמ״ר ·
          <span class="num">${nf(m.n_freguesias)}</span> פרגזיות</span>
      </span>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
    </button>`;
  }).join('');

  $('#doc').innerHTML = `
    <div class="card">
      <h1>מחוז פורטו <span class="en lat">(Distrito do Porto)</span></h1>
      <p class="lead">18 עיריות ו-243 פרגזיות בצפון-מערב פורטוגל, מהאוקיינוס האטלנטי
        במערב ועד הרי מראו במזרח. זהו המחוז הצפוף במדינה: כאן חיים
        <span class="num">${nf(D.totPop)}</span> תושבים על
        <span class="num">${nf(D.totArea, 1)}</span> קמ״ר.</p>
      <div class="stats">
        ${stat('תושבים', D.totPop, '', 0, 'municipio.pop2021')}
        ${stat('שטח', D.totArea, 'קמ״ר', 1, 'municipio.area_km2')}
        ${stat('צפיפות', D.totPop / D.totArea, 'לקמ״ר', 0, 'municipio.density')}
      </div>
      <p class="note">כל מספר באפליקציה נלחץ ומציג את המקור ואת שנת הייחוס שלו.
        מספרי העיריות במפה הם המספרים מהמסמך המקורי.</p>
    </div>

    <div class="card">
      <h2>שלוש החגורות</h2>
      <p class="sub">קו בצבע החגורה מקיף במפה את העיריות שבה.</p>
      ${beltRows}
      <p class="note">החלוקה לשלוש חגורות היא חלוקה עורכתית מהמסמך המקורי, לא
        חלוקה מנהלית רשמית.</p>
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
// The number the app prints for a parish: Porto keeps the city-quarter number,
// everyone else uses build.py's per-municipality 1..N.
const freNum = f => (f.mun_num === 1 ? f.q : f.n);

function drawMun(num) {
  clearMap();
  const rows = D.freByMun.get(num) || [];
  const colourOf = new Map(rows.map(f => [freNum(f), f.colour]));

  LG.edge = L.geoJSON({ type: 'FeatureCollection',
      features: D.bM.features.filter(ft => ft.properties.num === num) },
    { interactive: false, style: { color: isDark() ? '#e8ecf3' : '#101010',
      weight: 3, opacity: .8, fill: false } }).addTo(map);

  LG.fre = L.geoJSON(freFeatures(num), {
    style: ft => {
      const f = freOfFeature(num, ft.properties);
      return { color: stroke(), weight: 1, opacity: .9,
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

  // the outer border of the municipality, over the parish fills
  LG.munEdge = L.geoJSON({ type: 'FeatureCollection',
      features: D.bM.features.filter(ft => ft.properties.num === num) },
    { interactive: false, style: { color: edge(), weight: 3, opacity: .95, fill: false } }).addTo(map);

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
    const q = isPorto ? D.quarterByNum.get(n) : null;
    const desc = q ? q.desc : (f.note || '');
    const flag = !q && f.note && f.note_origin === 'app'
      ? '<span class="flag">תיאור שנכתב לאפליקציה</span>' : '';
    return `<button class="row row-full" data-fre="${html(D.freKey(f))}">
      <span class="pin" style="--c:${html(f.colour)}">${n}</span>
      <span class="row-body">
        <span class="row-t">${html(f.he || f.pt)} <span class="lat">(${html(bare(f.pt))})</span>${flag}</span>
        <span class="row-d">${desc ? html(desc) : '<span class="muted">' + MISSING + ' — אין תיאור לפרגזיה הזו</span>'}</span>
        <span class="row-m"><span class="num">${nf(f.pop2021)}</span> תושבים (2021) ·
          <span class="num">${nf(f.area_km2, 2)}</span> קמ״ר ·
          <span class="num">${nf(f.density)}</span> לקמ״ר${q ? ' · <span class="num">' + q.bairros.length + '</span> שכונות' : ''}</span>
      </span>
      ${q ? '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>' : ''}
    </button>`;
  }).join('');

  $('#doc').innerHTML = `
    <div class="card">
      <div class="hdr">
        <span class="pin" style="--c:${html(m.fill)}">${m.num}</span>
        <div><h1>${html(m.he)} <span class="en lat">(${html(m.en)})</span></h1>
          <p class="sub">${html(m.belt)} · <span class="num">${nf(m.n_freguesias)}</span> פרגזיות</p></div>
      </div>
      <div class="stats">
        ${stat('תושבים', m.pop2021, '', 0, 'municipio.pop2021')}
        ${stat('שטח', m.area_km2, 'קמ״ר', 2, 'municipio.area_km2')}
        ${stat('צפיפות', m.density, 'לקמ״ר', 0, 'municipio.density')}
        ${stat('מפורטו', m.dist_porto_km, 'ק״מ', 1, 'municipio.dist_porto_km')}
      </div>
      <dl class="kv">${profile}
        <div><dt>תחבורה</dt><dd>${html(m.transport)}</dd></div></dl>
    </div>

    <div class="grp">${rows.length} ${isPorto ? 'רבעי העיר' : 'הפרגזיות'} — לפי המספור במפה</div>
    ${isPorto ? '<p class="note" style="margin-block-end:8px">לחיצה על רובע פותחת אותו: השכונות שבתוכו באותיות, ואתרים ומוסדות כנקודות שחורות.</p>' : ''}
    <div class="rows">${list}</div>
    ${mineList(p => {
      const at = freguesiaAt(p.ll[0], p.ll[1]);
      return at && at.mun_num === num;
    })}
    ${isPorto ? '' : `<p class="note" style="margin-block-start:10px">המספור של הפרגזיות הוא מספור של האפליקציה
      ולא מספור רשמי; הוא נועד לקשור בין המפה לרשימה. סדר הפרגזיות נלקח מהמסמך
      המקורי היכן שהוא מפרט אותן, ובשש העיריות שהוא לא מפרט — לפי גודל אוכלוסייה.</p>`}`;
  $('#paneText').scrollTop = 0;
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

function drawMine() {
  if (LG.mine) { map.removeLayer(LG.mine); delete LG.mine; }
  if (!S.mine || !D.mine.length) return;
  LG.mine = L.layerGroup(D.mine.map(p => {
    const mk = L.marker(p.ll, { icon: mineIcon(), zIndexOffset: 1200, title: p.name });
    mk.bindTooltip(`<b>${html(p.name)}</b>` + (p.desc ? `<br>${html(p.desc)}` : ''),
      { direction: 'top', className: 'tt' });
    mk.on('click', () => {
      if (S.adding) return;
      if (isSecondTap('mine:' + p.id)) { openInGoogle(p.ll, p.name); return; }
      openMine(p.id);
    });
    return mk;
  })).addTo(map);
}

let mineEditing = null;
function openMine(id, ll) {
  const p = id ? D.mine.find(x => x.id === id) : null;
  mineEditing = p ? { ...p } : { id: 'p' + Date.now().toString(36), ll, name: '', desc: '' };
  const at = freguesiaAt(mineEditing.ll[0], mineEditing.ll[1]);
  $('#mineWhere').textContent = at
    ? (at.he || at.pt) + ', ' + D.munByNum.get(at.mun_num).he
    : 'מחוץ למחוז פורטו';
  $('#mineName').value = mineEditing.name || '';
  $('#mineDesc').value = mineEditing.desc || '';
  $('#mineDelete').hidden = !p;
  $('#mineModal').hidden = false;
  $('#mineName').focus();
}
function closeMine() { $('#mineModal').hidden = true; mineEditing = null; }

function commitMine() {
  const name = $('#mineName').value.trim();
  if (!name) { $('#mineName').focus(); return; }
  const rec = { ...mineEditing, name, desc: $('#mineDesc').value.trim(),
    at: mineEditing.at || new Date().toISOString().slice(0, 10) };
  const i = D.mine.findIndex(x => x.id === rec.id);
  if (i < 0) D.mine.push(rec); else D.mine[i] = rec;
  saveMine(); closeMine(); drawMine(); redrawText();
}
function deleteMine() {
  D.mine = D.mine.filter(x => x.id !== mineEditing.id);
  saveMine(); closeMine(); drawMine(); redrawText();
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
  $('#impText').value = prefill || '';
  $('#impNote').textContent = prefill
    ? 'לא הצלחתי להעתיק ללוח. אפשר לסמן את הטקסט כאן ולהעתיק ידנית.'
    : 'הדביקו כאן נקודות שיוצאו קודם. נקודה שכבר קיימת לא תשוכפל.';
  $('#impModal').hidden = false;
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
  $('#impModal').hidden = true;
  drawMine(); redrawText();
  mapNote(added ? ('נוספו ' + nf(added) + ' נקודות' + (skipped ? ', ' + nf(skipped) + ' דולגו' : '') + '.')
                : 'לא נוספה אף נקודה חדשה.', !added);
}

function toggleAdd() {
  S.adding = !S.adding;
  $('#addBtn').setAttribute('aria-pressed', String(S.adding));
  $('#map').style.cursor = S.adding ? 'crosshair' : '';
  const n = $('#addNote');
  n.hidden = !S.adding;
  if (S.adding) n.innerHTML = 'לחץ על המפה במקום שבו תרצה לסמן נקודה. ' +
    '<button type="button" data-add="off">ביטול</button>';
}

/* ------------------------------------------------- level 3: תוך הפרגזיה --- */
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
      style: { color: stroke(), weight: 2, opacity: .9,
               fillColor: f.colour || '#dddddd', fillOpacity: .35 } }).addTo(map);

  // The municipality this parish sits in, so level 3 still says where you are.
  LG.munEdge = L.geoJSON({ type: 'FeatureCollection',
      features: D.bM.features.filter(ft => ft.properties.num === f.mun_num) },
    { interactive: false,
      style: { color: edge(), weight: 2, opacity: .55, fill: false, dashArray: '6,4' } }).addTo(map);

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
      <p class="sub">${html(m.he)} · ${html(m.belt)}</p>
      <div class="stats">
        ${stat('תושבים', f.pop2021, '', 0, 'freguesia.pop2021')}
        ${stat('שטח', f.area_km2, 'קמ״ר', 2, 'freguesia.area_km2')}
        ${stat('צפיפות', f.density, 'לקמ״ר', 0, 'freguesia.density')}
      </div>
      ${z.desc ? `<p class="lead">${html(z.desc)}</p>` : ''}
      ${f.note ? `<p class="${z.desc ? 'sub' : 'lead'}">${html(f.note)}</p>` : ''}
      ${f.note_origin === 'app'
        ? '<p class="note">התיאור נכתב לאפליקציה ולא הועתק ממקור רשמי.</p>' : ''}
    </div>

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
      <p class="sub">נשמרות במכשיר הזה בלבד. לא נשלחות לשום מקום ולא מגובות.</p>
      <div class="chips">
        <button class="chip" data-mine-act="export">העתקת הנקודות</button>
        <button class="chip" data-mine-act="import">ייבוא נקודות</button>
      </div>
    </div>
    <div class="rows">${rows.map(p => `<button class="row" data-mine="${html(p.id)}">
        <span class="dot mine" style="--c:${MINE_COLOUR}"></span>
        <span class="row-body">
          <span class="row-t">${html(p.name)}</span>
          ${p.desc ? `<span class="row-d">${html(p.desc)}</span>` : ''}
          <span class="row-m num">${html(p.ll[0].toFixed(5))}, ${html(p.ll[1].toFixed(5))}
            ${p.at ? ' · ' + html(p.at) : ''}</span>
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
  S.view = VIEW_NEXT[S.view] || 'split';
  applyView(); save();
  mapNote(VIEW_HE[S.view]);
  clearTimeout(cycleView._t);
  cycleView._t = setTimeout(hideNote, 1600);
}

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
    row(S.water, 'water', 'נהרות ומים', '#4a9ad4', true) +
    row(S.green, 'green', 'שטחים ירוקים וחופים', '#5aa860', true) +
    row(S.mine, 'mine', 'הנקודות שלי', MINE_COLOUR, true, D.mine.length);
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
    h += '<p class="note" style="margin-block-start:8px">קטגוריות הנקודות נבחרות ברמת הפרגזיה.</p>';
  }
  $('#layerPanel').innerHTML = h;
}
function toggleLayers(force) {
  const p = $('#layerPanel');
  const show = force === undefined ? p.hidden : force;
  if (show) renderLayers();
  p.hidden = !show;
  $('#layersBtn').setAttribute('aria-expanded', String(show));
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

function openInGoogle(ll, name) {
  const url = gmapsUrl(ll);
  let w = null;
  try { w = window.open(url, '_blank', 'noopener'); } catch (e) { w = null; }
  if (!w) {
    // a sandboxed frame can refuse to open a window, and refuses in silence
    mapNote(`הדפדפן חסם את פתיחת החלון. אפשר לפתוח ידנית:
      <a href="${html(url)}" target="_blank" rel="noopener">${html(name || 'מפות גוגל')}</a>`, true);
  }
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
    l.setStyle({ weight: on ? 3.5 : 1, color: on ? '#b7791f' : stroke(), fillOpacity: on ? .92 : .78 });
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
  if (!$('#layerPanel').hidden) renderLayers();
  const c = [];
  if (S.level === 'district') c.push('<span class="now">מחוז פורטו</span>');
  else {
    c.push('<button data-go="district">מחוז פורטו</button>');
    const m = D.munByNum.get(S.mun);
    if (S.level === 'mun') c.push('<span class="sep">›</span><span class="now">' + html(m.he) + '</span>');
    else {
      c.push('<span class="sep">›</span><button data-go="mun">' + html(m.he) + '</button>');
      const f = D.freByKey.get(S.zone);
      c.push('<span class="sep">›</span><span class="now">' + html(f.he || f.pt) + '</span>');
    }
  }
  $('#crumb').innerHTML = c.join('');
  $('#upBtn').hidden = S.level === 'district';
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
      letters: S.letters, mine: S.mine, water: S.water, green: S.green,
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
    if (typeof o.water === 'boolean') S.water = o.water;
    if (typeof o.green === 'boolean') S.green = o.green;
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
function runSearch(term) {
  const t = term.trim().toLowerCase();
  if (t.length < 2) {
    $('#qres').innerHTML = '<p class="note">שתי אותיות ומעלה — בעברית, פורטוגזית או אנגלית.</p>';
    return;
  }
  const hit = s => String(s || '').toLowerCase().includes(t);
  const out = [];
  D.mun.forEach(m => {
    if (hit(m.he) || hit(m.pt) || hit(m.en)) out.push({
      t: m.num + '. ' + m.he, s: m.pt, k: 'עירייה', go: `data-jump="mun:${m.num}"` });
  });
  D.fre.forEach(f => {
    if (hit(f.he) || hit(f.pt)) out.push({
      t: (f.he || f.pt), s: bare(f.pt) + ' · ' + f.mun_he,
      k: f.mun_num === 1 ? 'רובע בפורטו' : 'פרגזיה',
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

  $('#qres').innerHTML = out.length
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
  $('#findDrawer').hidden = true;
}

/* ------------------------------------------------------ sources and info --- */
function showSource(key) {
  const f = D.sources.fields[key];
  if (!f) return;
  $('#srcTitle').textContent = f.label_he || key;
  $('#srcBody').innerHTML = `
    <p class="note"><code>${html(key)}</code></p>
    ${f.reference_year ? `<p>שנת ייחוס: <b class="num">${html(f.reference_year)}</b></p>` : ''}
    <p>מקור: ${html(f.source || (f.derived_from || []).join(' / '))}</p>
    ${f.coverage ? `<p class="note">כיסוי: ${html(f.coverage)}</p>` : ''}
    ${f.validation_he ? `<p class="note">בדיקה: ${html(f.validation_he)}</p>` : ''}
    ${f.caveat_he ? `<div class="warn">${html(f.caveat_he)}</div>` : ''}
    ${f.url ? `<p><a href="${html(f.url)}" target="_blank" rel="noopener">${html(f.url)}</a></p>` : ''}`;
  $('#srcModal').hidden = false;
}

function renderInfo() {
  const s = D.sources;
  const fields = Object.entries(s.fields).map(([k, f]) => `<div class="card">
      <h3>${html(f.label_he || k)}</h3>
      <p class="note"><code>${html(k)}</code></p>
      ${f.reference_year ? `<p>שנת ייחוס: <b class="num">${html(f.reference_year)}</b></p>` : ''}
      <p>מקור: ${html(f.source || (f.derived_from || []).join(' / '))}</p>
      ${f.coverage ? `<p class="note">כיסוי: ${html(f.coverage)}</p>` : ''}
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
    <h2>מה יש כאן</h2>
    <p>המסך מחולק לשניים: מפה בחצי אחד, וכל הידע שנוגע למה שרואים בה בחצי השני.
      הקו שביניהם נגרר, המפה נגררת ומתקרבת בתוך החלון שלה, והטקסט נגלל בלי הגבלה.</p>
    <ul>
      <li>18 עיריות · 243 פרגזיות · 7 רבעי פורטו · 53 שכונות ·
        <span class="num">${D.totPoi}</span> נקודות במפה</li>
      <li>אוכלוסיית 2021, שטח וצפיפות לכל 18 העיריות ולכל 243 הפרגזיות</li>
      <li>נבנה: <span class="lat">${html(D.generated)}</span></li>
    </ul>
    <p class="note">מספרי העיריות הם המספרים מהמסמך המקורי. מספרי הפרגזיות
      והאותיות של השכונות הם של האפליקציה, נועדו לקשור בין המפה לרשימה, ואינם
      מספור רשמי.</p>
    ${STANDALONE
      ? `<p class="note">זהו קובץ בודד ועצמאי — כל הנתונים בתוכו והוא עובד בלי רשת
         ובלי שרת. המסמך המקורי ‎(PDF)‎ נמצא במאגר, ב-<span class="lat">porto/data/raw/</span>.</p>`
      : `<p><a href="data/raw/porto_district_map_a3.pdf" target="_blank" rel="noopener">פתיחת המסמך המקורי (PDF, 19 עמודים)</a></p>`}

    <h2>מה עוד חסר</h2>
    <p>${html(s.missing.note_he)}</p>
    ${miss}

    <h2>מקור לכל שדה</h2>
    ${fields}

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
  $('#upBtn').addEventListener('click', goUp);
  $('#fitBtn').addEventListener('click', refit);
  $('#locBtn').addEventListener('click', toggleLocate);
  $('#viewBtn').addEventListener('click', cycleView);
  $('#layersBtn').addEventListener('click', () => toggleLayers());
  $('#addBtn').addEventListener('click', toggleAdd);
  $('#addNote').addEventListener('click', e => {
    if (e.target.closest('[data-add="off"]')) toggleAdd();
  });
  map.on('click', e => {
    if (!S.adding) return;
    toggleAdd();
    openMine(null, [e.latlng.lat, e.latlng.lng]);
  });
  $('#mineSave').addEventListener('click', commitMine);
  $('#mineCancel').addEventListener('click', closeMine);
  $('#mineDelete').addEventListener('click', deleteMine);
  $('#impSave').addEventListener('click', commitImport);
  $('#impCancel').addEventListener('click', () => { $('#impModal').hidden = true; });
  $('#impModal').addEventListener('click', e => {
    if (e.target.id === 'impModal') $('#impModal').hidden = true;
  });
  $('#mineGoogle').addEventListener('click', () => {
    if (mineEditing) openInGoogle(mineEditing.ll, mineEditing.name);
  });
  $('#mineModal').addEventListener('click', e => { if (e.target.id === 'mineModal') closeMine(); });
  $('#layerPanel').addEventListener('click', e => {
    const b = e.target.closest('[data-lay]');
    if (!b) return;
    const k = b.dataset.lay;
    if (k === 'letters') { S.letters = !S.letters; }
    else if (k === 'water') { S.water = !S.water; applyNature(); }
    else if (k === 'green') { S.green = !S.green; applyNature(); }
    else if (k === 'mine') { S.mine = !S.mine; drawMine(); }
    else if (k.startsWith('cat:')) {
      const c = k.slice(4);
      if (S.cats.has(c)) S.cats.delete(c); else S.cats.add(c);
      if (!S.cats.size) S.cats.add(c);              // never leave the map blank
    }
    save();
    if (S.level === 'zone') { drawZone(S.zone); renderZone(S.zone); }
    drawMine(); renderLayers(); applyHi();
  });
  $('#locNote').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.close || b.dataset.loc === 'back') { hideNote(); }
    if (b.dataset.loc === 'back') refit();
    if (b.dataset.jump) { jump(b.dataset.jump); hideNote(); }
  });
  $('#crumb').addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    if (b.dataset.go === 'district') goDistrict(); else goMun(S.mun);
  });
  $('#tilesBtn').addEventListener('click', () => {
    S.tiles = !S.tiles;
    if (S.tiles) tileLayer.addTo(map); else map.removeLayer(tileLayer);
    $('#tilesBtn').setAttribute('aria-pressed', String(S.tiles));
    save();
  });

  // one delegated handler for the whole text half
  $('#doc').addEventListener('click', e => {
    const src = e.target.closest('[data-src]');
    if (src) { showSource(src.dataset.src); return; }
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

  $('#findBtn').addEventListener('click', () => {
    $('#findDrawer').hidden = false;
    runSearch($('#q').value);
    $('#q').focus();
  });
  $('#findClose').addEventListener('click', () => { $('#findDrawer').hidden = true; });
  $('#q').addEventListener('input', e => runSearch(e.target.value));
  $('#qres').addEventListener('click', e => {
    const b = e.target.closest('[data-jump]');
    if (b) jump(b.dataset.jump);
  });

  $('#infoBtn').addEventListener('click', () => { renderInfo(); $('#infoDrawer').hidden = false; });
  $('#infoClose').addEventListener('click', () => { $('#infoDrawer').hidden = true; });
  $('#srcClose').addEventListener('click', () => { $('#srcModal').hidden = true; });
  $('#srcModal').addEventListener('click', e => { if (e.target.id === 'srcModal') $('#srcModal').hidden = true; });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#srcModal').hidden) $('#srcModal').hidden = true;
    else if (!$('#findDrawer').hidden) $('#findDrawer').hidden = true;
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
  $('#tilesBtn').setAttribute('aria-pressed', String(S.tiles));

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
