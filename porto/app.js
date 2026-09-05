/* מחוז פורטו — app logic.
   Data: data/processed/*.json built by scripts/build.py from the PDF project's
   own texts, CAOP 2020 boundaries and INE Censos 2021.  Nothing is invented:
   a field with no verified value renders as "אין נתון". */
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const NBSP = ' ';

const PALETTE = ['#eff6fb', '#d3e6f4', '#aed3ea', '#82badd', '#5499c7', '#2e6da4', '#164a7d'];
const BELT_COLOUR = { 'החגורה העירונית': '#1B4F8C', 'החגורה הצפונית': '#2E7D32', 'החגורה המזרחית': '#6A1B9A' };
const MISSING = 'אין נתון';

const S = {                       // app state
  level: 'municipio',
  indicator: 'pop2021',
  tiles: true,
  sort: 'pop2021',
  compare: [],
  filters: { maxDist: null, minPop: null, belts: [], railOnly: false, maxPrice: null },
  sel: null,
};
const D = {};                     // loaded data

/* ------------------------------------------------------------ formatting --- */
const nf = (v, dec) => v === null || v === undefined ? MISSING
  : new Intl.NumberFormat('he-IL', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec === undefined ? 0 : dec }).format(v);

function fmtVal(v, ind) {
  if (v === null || v === undefined) return MISSING;
  return nf(v, ind ? (ind.decimals ?? 0) : 0);
}
const html = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------- load data --- */
async function j(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' → ' + r.status);
  return r.json();
}

async function load() {
  const [ind, mun, fre, city, sources, bM, bF, bC] = await Promise.all([
    j('data/processed/indicators.json'),
    j('data/processed/municipios.json'),
    j('data/processed/freguesias.json'),
    j('data/processed/porto_city.json'),
    j('data/sources.json'),
    j('data/processed/boundaries_municipios.geojson'),
    j('data/processed/boundaries_freguesias.geojson'),
    j('data/processed/boundaries_porto_city.geojson'),
  ]);
  D.indicators = ind.items;
  D.belts = mun.belts;
  D.mun = mun.items;
  D.fre = fre.items;
  D.city = city.quarters;
  D.places = city.places;
  D.sources = sources;
  D.bM = bM; D.bF = bF; D.bC = bC;
  D.generated = mun.generated;

  D.munByNum = new Map(D.mun.map(m => [m.num, m]));
  D.freKey = f => f.mun_num + '|' + f.pt;
  D.freByKey = new Map(D.fre.map(f => [D.freKey(f), f]));
  D.indByKey = new Map(D.indicators.map(i => [i.key, i]));
  D.mun.forEach(m => { m.rail = /מטרו|רכבת|מסילת/.test(m.transport || ''); });
  D.fre.forEach(f => { f.mun_he = D.munByNum.get(f.mun_num).he; });
}

/* --------------------------------------------------------------- scaling --- */
function quantiles(values, k) {
  const v = values.filter(x => x !== null && x !== undefined).sort((a, b) => a - b);
  if (!v.length) return null;
  const cuts = [];
  for (let i = 1; i < k; i++) cuts.push(v[Math.floor(i * v.length / k)]);
  return { cuts, min: v[0], max: v[v.length - 1] };
}
function binOf(val, q) {
  if (val === null || val === undefined || !q) return -1;
  let i = 0;
  while (i < q.cuts.length && val >= q.cuts[i]) i++;
  return i;
}
const colourFor = (val, q) => { const b = binOf(val, q); return b < 0 ? null : PALETTE[b]; };

/* ------------------------------------------------------------- filtering --- */
function munPasses(m) {
  const f = S.filters;
  if (f.maxDist !== null && (m.dist_porto_km ?? 1e9) > f.maxDist) return false;
  if (f.minPop !== null && (m.pop2021 ?? 0) < f.minPop) return false;
  if (f.belts.length && !f.belts.includes(m.belt)) return false;
  if (f.railOnly && !m.rail) return false;
  if (f.maxPrice !== null && m.price_eur_m2 !== undefined && m.price_eur_m2 > f.maxPrice) return false;
  return true;
}
const frePasses = f => munPasses(D.munByNum.get(f.mun_num));
function activeFilterCount() {
  const f = S.filters;
  return (f.maxDist !== null) + (f.minPop !== null) + (f.belts.length ? 1 : 0) +
    (f.railOnly ? 1 : 0) + (f.maxPrice !== null);
}

/* ------------------------------------------------------------------- map --- */
let map, tileLayer, layerM, layerF, layerC, placeLayer;

function initMap() {
  map = L.map('map', {
    zoomControl: true, attributionControl: false,
    minZoom: 8, maxZoom: 17, tap: true,
    // the district and the city are both wide and short; with whole-number
    // zoom only, fitBounds lands a level short and leaves them half-size
    zoomSnap: 0.25, zoomDelta: 0.5,
  });
  map.setView([41.22, -8.25], 9);
  tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, crossOrigin: true,
    attribution: '© OpenStreetMap contributors',
  });
  if (S.tiles) tileLayer.addTo(map);

  const stroke = getComputedStyle(document.body).getPropertyValue('--card').trim() || '#fff';
  const baseStyle = () => ({ weight: 1, color: stroke, opacity: .85, fillOpacity: .82 });

  layerM = L.geoJSON(D.bM, {
    style: baseStyle,
    onEachFeature: (ft, l) => {
      l.on('click', () => selectMun(ft.properties.num, false));
      l.bindTooltip(() => tipMun(ft.properties.num), { direction: 'top', sticky: true, className: 'tt' });
    },
  });
  layerF = L.geoJSON(D.bF, {
    style: baseStyle,
    onEachFeature: (ft, l) => {
      const key = ft.properties.mun_num + '|' + ft.properties.name;
      l.on('click', () => selectFre(key, false));
      l.bindTooltip(() => tipFre(key), { direction: 'top', sticky: true, className: 'tt' });
    },
  });
  layerC = L.geoJSON(D.bC, {
    style: baseStyle,
    onEachFeature: (ft, l) => {
      l.on('click', () => selectCity(ft.properties.num, false));
      l.bindTooltip(() => {
        const q = D.city.find(c => c.num === ft.properties.num);
        return `<b>${html(q.he)}</b><br>${nf(q.pop2021)} תושבים`;
      }, { direction: 'top', sticky: true, className: 'tt' });
    },
  });
  placeLayer = L.layerGroup(D.places.map(p => L.circleMarker(p.ll, {
    radius: 3, weight: 1, color: '#c2410c', fillColor: '#fb923c', fillOpacity: .9,
  }).bindTooltip(p.name, { direction: 'top', className: 'tt' })));

  map.on('zoomend', syncPlaces);
  drawLevel();
}

function tipMun(num) {
  const m = D.munByNum.get(num), ind = D.indByKey.get(S.indicator);
  const v = m[S.indicator];
  return `<b>${html(m.he)}</b> <span class="lat">${html(m.pt)}</span><br>` +
    `${html(ind.label_he)}: ${fmtVal(v, ind)}${v == null ? '' : NBSP + html(ind.unit || '')}`;
}
function tipFre(key) {
  const f = D.freByKey.get(key), ind = D.indByKey.get(S.indicator);
  const v = f[S.indicator];
  const nm = f.he ? f.he : f.pt;
  return `<b>${html(nm)}</b><br><span class="lat">${html(f.pt)}</span><br>` +
    `${html(f.mun_he)} · ${html(ind.label_he)}: ${fmtVal(v, ind)}`;
}

function currentSet() {
  if (S.level === 'municipio') return { rows: D.mun, layer: layerM, pass: munPasses, key: r => r.num };
  if (S.level === 'freguesia') return { rows: D.fre, layer: layerF, pass: frePasses, key: D.freKey };
  return { rows: D.city, layer: layerC, pass: () => true, key: r => r.num };
}

function drawLevel(fit) {
  const same = layerOf(S.level);
  [layerM, layerF, layerC, placeLayer].forEach(l => {
    if (l !== same && map.hasLayer(l)) map.removeLayer(l);
  });
  const { rows, layer, pass } = currentSet();
  if (!map.hasLayer(layer)) { layer.addTo(map); fit = fit !== false; }
  syncPlaces();

  const ind = D.indByKey.get(S.indicator);
  const vals = rows.filter(pass).map(r => r[S.indicator]).filter(v => v != null);
  const q = quantiles(vals, PALETTE.length);
  // a neutral translucent stroke reads against every fill in the ramp, and also
  // against bare background when the tile layer is off or offline
  const stroke = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'rgba(232,236,243,.45)' : 'rgba(20,25,34,.35)';

  layer.eachLayer(l => {
    const p = l.feature.properties;
    let row, ok;
    if (S.level === 'municipio') { row = D.munByNum.get(p.num); ok = munPasses(row); }
    else if (S.level === 'freguesia') { row = D.freByKey.get(p.mun_num + '|' + p.name); ok = frePasses(row); }
    else { row = D.city.find(c => c.num === p.num); ok = true; }
    const c = colourFor(row ? row[S.indicator] : null, q);
    l.setStyle({
      color: stroke, weight: S.level === 'freguesia' ? .7 : 1,
      fillColor: c || 'transparent',
      fillOpacity: ok ? (c ? .84 : .12) : .06,
      opacity: ok ? .85 : .25,
      dashArray: c ? null : '2,3',
    });
  });
  highlight();

  if (fit) fitLayer(layer);
  renderLegend(q, ind, vals.length, rows.filter(pass).length);
}

// 339 neighbourhood points cover the city in orange when zoomed out; show them
// only once the map is close enough for them to mean something.
function syncPlaces() {
  const want = S.level === 'city' && map.getZoom() >= 12.5;
  if (want && !map.hasLayer(placeLayer)) placeLayer.addTo(map);
  if (!want && map.hasLayer(placeLayer)) map.removeLayer(placeLayer);
}

function layerOf(level) {
  return level === 'municipio' ? layerM : level === 'freguesia' ? layerF : layerC;
}

// Outline whatever the sheet is showing, so a selected area stays findable even
// when its fill sits at the pale end of the ramp.
function highlight() {
  const layer = layerOf(S.level);
  if (!layer) return;
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  layer.eachLayer(l => {
    const p = l.feature.properties;
    let on = false;
    if (S.sel && S.level === 'municipio' && S.sel.kind === 'mun') on = p.num === S.sel.id;
    if (S.sel && S.level === 'freguesia' && S.sel.kind === 'fre') on = (p.mun_num + '|' + p.name) === S.sel.id;
    if (S.sel && S.level === 'city' && S.sel.kind === 'city') on = p.num === S.sel.id;
    if (on) {
      l.setStyle({ color: dark ? '#ffd166' : '#b3261e', weight: 3, opacity: 1 });
      l.bringToFront();
    }
  });
}

// Both the whole-layer fit and the single-area zoom are deferred a frame, so a
// selection made in the same tick as a level change must be able to cancel the
// layer fit that would otherwise land after it.
let fitToken = 0;

function fitLayer(layer) {
  // invalidateSize first: on the initial draw Leaflet may still be holding the
  // container size from before the CSS layout settled, which fits the district
  // into a fraction of the screen.
  const mine = ++fitToken;
  requestAnimationFrame(() => {
    if (mine !== fitToken) return;
    map.invalidateSize({ animate: false });
    try {
      map.fitBounds(layer.getBounds(), { padding: [8, 8], animate: false });
    } catch (e) { /* layer has no drawable bounds */ }
    syncPlaces();
  });
}

function renderLegend(q, ind, have, total) {
  const el = $('#legend');
  if (!q) {
    el.hidden = false;
    el.innerHTML = `<b>${html(ind.label_he)}</b><div class="lg-row">${MISSING} לאף אזור</div>` +
      (ind.fetch ? `<div class="lg-src">להשלמה: <code>${html(ind.fetch)}</code></div>` : '');
    return;
  }
  const edges = [q.min, ...q.cuts, q.max];
  let rows = '';
  for (let i = PALETTE.length - 1; i >= 0; i--) {
    const a = edges[i], b = edges[i + 1];
    if (a === undefined || b === undefined) continue;
    rows += `<div class="lg-row"><i class="lg-sw" style="background:${PALETTE[i]}"></i>` +
      `<span class="num">${fmtVal(a, ind)}–${fmtVal(b, ind)}</span></div>`;
  }
  el.hidden = false;
  el.innerHTML = `<b>${html(ind.label_he)}${ind.unit ? ' (' + html(ind.unit) + ')' : ''}</b>${rows}` +
    `<div class="lg-src">${have}/${total} אזורים · ${ind.reference_year ? html(ind.reference_year) : ''}` +
    (have < total ? ` · השאר: ${MISSING}` : '') + `</div>`;
}

/* ----------------------------------------------------------------- sheet --- */
function openSheet(inner) {
  const sh = $('#sheet');
  sh.hidden = false;
  $('#sheetScroll').innerHTML = inner;
  $('#sheetScroll').scrollTop = 0;
}
function closeSheet() {
  $('#sheet').hidden = true;
  S.sel = null;
  if (map) drawLevel(false);
}

function srcChip(key) {
  const f = D.sources.fields[key];
  if (!f) return '';
  const y = f.reference_year ? f.reference_year : '';
  return `<span class="chip" data-src="${html(key)}">${html(y)}${y ? ' · ' : ''}מקור${NBSP}ℹ︎</span>`;
}

function kpi(label, value, unit, year, opts) {
  opts = opts || {};
  if (value === null || value === undefined) {
    return `<div class="kpi no"><div class="k-l">${html(label)}</div>` +
      `<div class="k-v">${MISSING}</div>` +
      (opts.fetch ? `<div class="k-y">להשלמה: <code>${html(opts.fetch)}</code></div>` : '') +
      `</div>`;
  }
  return `<div class="kpi"><div class="k-l">${html(label)}` +
    (opts.info ? `<span class="k-i" data-info="${html(opts.info)}">i</span>` : '') + `</div>` +
    `<div class="k-v num">${html(value)}${unit ? `<span class="k-u">${NBSP}${html(unit)}</span>` : ''}</div>` +
    (year ? `<div class="k-y">${html(year)}</div>` : '') + `</div>`;
}

function gapBlock(gaps) {
  if (!gaps.length) return '';
  return `<div class="gap">
    <b>${MISSING}:</b> ${gaps.map(g => html(g.label_he)).join(' · ')}
    <details><summary>איך משלימים</summary>
      ${gaps.map(g => `<pre>python3 ${html(g.fetch || '')}</pre>`).join('')}
      <pre>python3 scripts/build.py &amp;&amp; python3 scripts/checks.py</pre>
      <p class="note">הסקריפטים האלה צריכים גישה חופשית לרשת. אחרי הרצה, השדות
        האלה יופיעו כאן, בהשוואה, בסינון וכשכבת צבע במפה — בלי לגעת בקוד.</p>
    </details></div>`;
}

function munSheet(num) {
  const m = D.munByNum.get(num);
  const kids = D.fre.filter(f => f.mun_num === num)
    .sort((a, b) => (b.pop2021 ?? -1) - (a.pop2021 ?? -1));
  const beltCol = BELT_COLOUR[m.belt] || m.colour;

  let k = '';
  k += kpi('תושבים', nf(m.pop2021), '', 'מפקד 2021');
  k += kpi('שטח', nf(m.area_km2, 2), 'קמ״ר', 'CAOP 2020');
  k += kpi('צפיפות', nf(m.density), 'נפש/קמ״ר', 'מפקד 2021');
  k += kpi('מרחק מפורטו', num === 1 ? '0' : nf(m.dist_porto_km, 1), 'ק״מ', 'קו אווירי');
  k += kpi('פרגזיות', nf(m.n_freguesias), '', 'CAOP 2020');
  const gaps = [];
  for (const key of ['price_eur_m2', 'median_age', 'median_income', 'foreign_pct', 'crimes_per_1000']) {
    const ind = D.indByKey.get(key);
    if (!ind) continue;
    if (m[key] === undefined || m[key] === null) { gaps.push(ind); continue; }
    k += kpi(ind.label_he, nf(m[key], ind.decimals ?? 1), ind.unit, ind.reference_year,
      { info: ind.warning_he });
  }

  const fields = m.profile.map(f =>
    `<div class="fld"><dt>${html(f.label)}</dt><dd>${html(f.text)}</dd></div>`).join('');

  const rows = kids.map(f => `<tr class="tap" data-fre="${html(D.freKey(f))}">
      <td>${html(f.he || f.pt)}<div class="sub lat">${html(f.pt)}</div></td>
      <td class="n">${f.pop2021 == null ? MISSING : nf(f.pop2021)}</td>
      <td class="n">${nf(f.area_km2, 1)}</td>
      <td class="n">${f.density == null ? '—' : nf(f.density)}</td></tr>`).join('');

  const inCmp = S.compare.includes(num);
  return `
  <div class="sh-head">
    <div style="flex:1">
      <h2>${html(m.he)}</h2>
      <div class="sub lat">${html(m.pt === m.en ? m.pt : m.pt + ' · ' + m.en)}</div>
    </div>
    <button class="sh-x" data-close aria-label="סגירה"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </div>
  <div class="chips">
    <span class="chip belt" style="background:${beltCol}">${html(m.belt || '')}</span>
    <span class="chip">עירייה ${m.num} מתוך 18</span>
    ${m.ine ? `<span class="chip">קוד INE <span class="lat">${html(m.ine)}</span></span>` : ''}
    <span class="chip ${inCmp ? 'on' : ''}" data-cmp="${m.num}">${inCmp ? '✓ בהשוואה' : '+ להשוואה'}</span>
  </div>
  <div class="kpis">${k}</div>
  ${gapBlock(gaps)}
  <div class="fld"><dt>תחבורה לפורטו</dt><dd>${html(m.transport || MISSING)}</dd></div>
  <div class="fields"><dl>${fields}</dl></div>
  <details class="acc" open><summary>${kids.length} פרגזיות</summary>
    <table class="mini"><thead><tr><th>פרגזיה</th><th class="n">תושבים</th>
      <th class="n">קמ״ר</th><th class="n">צפיפות</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td><b>סכום</b></td><td class="n"><b>${nf(m.freg_pop_sum)}</b></td>
        <td class="n"><b>${nf(kids.reduce((s, f) => s + f.area_km2, 0), 1)}</b></td><td></td></tr></tfoot>
    </table>
    ${m.freg_pop_sum && m.pop2021 && m.freg_pop_sum !== m.pop2021 ? `<p class="note">
      סכום הפרגזיות ${nf(m.freg_pop_sum)} מול ${nf(m.pop2021)} לעירייה — הפרש
      ${nf(Math.abs(m.freg_pop_sum - m.pop2021))} (${nf(100 * (m.freg_pop_sum - m.pop2021) / m.pop2021, 2)}%),
      נובע מגרסאות פרסום שונות של מפקד 2021.</p>` : ''}
  </details>
  ${num === 1 ? `<button class="bl" data-goto-city="1"><b>שבעת רבעי העיר ו-53 השכונות ›</b>
     <span class="sub">מפה ותיאור לכל רובע</span></button>` : ''}
  <div class="chips" style="margin-top:10px">${srcChip('municipio.pop2021')}${srcChip('municipio.area_km2')}</div>`;
}

function freSheet(key) {
  const f = D.freByKey.get(key);
  const m = D.munByNum.get(f.mun_num);
  let k = '';
  k += kpi('תושבים', f.pop2021 == null ? null : nf(f.pop2021), '', 'מפקד 2021');
  k += kpi('שטח', nf(f.area_km2, 2), 'קמ״ר', 'CAOP 2020');
  k += kpi('צפיפות', f.density == null ? null : nf(f.density), 'נפש/קמ״ר', 'מפקד 2021');
  const pInd = D.indByKey.get('price_eur_m2');
  const gaps = [];
  if (f.price_eur_m2 === undefined || f.price_eur_m2 === null) gaps.push(pInd);
  else k += kpi(pInd.label_he, nf(f.price_eur_m2), pInd.unit, pInd.reference_year);

  return `
  <div class="sh-head">
    <div style="flex:1">
      <h2>${html(f.he || f.pt)}</h2>
      <div class="sub lat">${html(f.pt)}${f.en && f.en !== f.pt ? ' · ' + html(f.en) : ''}</div>
    </div>
    <button class="sh-x" data-close aria-label="סגירה"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </div>
  <div class="chips">
    <span class="chip" data-mun="${m.num}">בעירייה ${html(m.he)} ›</span>
    ${f.he_origin === 'app' ? '<span class="chip">תעתיק עברי נוסף באפליקציה</span>' : ''}
    ${f.pop_src === 'collected' ? '<span class="chip">אוכלוסייה הושלמה כאן</span>' : ''}
  </div>
  <div class="kpis">${k}</div>
  ${gapBlock(gaps)}
  ${f.note ? `<div class="fld"><dt>תיאור</dt><dd>${html(f.note)}</dd></div>` : `
    <p class="note">למסמך המקורי אין תיאור לפרגזיה הזאת — היא אחת מ-103 הפרגזיות
    שהיו חסרות בו לגמרי.</p>`}
  <div class="chips" style="margin-top:10px">${srcChip('freguesia.pop2021')}${srcChip('freguesia.area_km2')}${srcChip('freguesia.he')}</div>`;
}

function citySheet(num) {
  const q = D.city.find(c => c.num === num);
  const b = q.bairros.map(x => `<div class="fld"><dt>${html(x.he)} <span class="sub lat">${html(x.en)}</span></dt>
      <dd>${html(x.desc)}</dd></div>`).join('');
  return `
  <div class="sh-head">
    <div style="flex:1"><h2>${html(q.he)}</h2><div class="sub lat">${html(q.en)}</div></div>
    <button class="sh-x" data-close aria-label="סגירה"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </div>
  <div class="chips"><span class="chip belt" style="background:${q.colour};color:#1b1b1b">רובע ${q.num} מ-7</span>
    <span class="chip" data-mun="1">עיריית פורטו ›</span></div>
  <div class="kpis">${kpi('תושבים', nf(q.pop2021), '', 'מפקד 2021')}</div>
  <p>${html(q.desc)}</p>
  <details class="acc" open><summary>${q.bairros.length} שכונות — ${html(q.bairros_title_he)}</summary>
    <div class="fields">${b}</div>
    <p class="note">מתחת לרמת הפרגזיה אין בפורטוגל שכבה מנהלית רשמית, ולכן אין
      גבולות שכונה. הנקודות הכתומות במפה הן <span class="lat">place=neighbourhood/quarter/suburb</span>
      מ-OpenStreetMap — נקודות בלבד.</p>
  </details>`;
}

function selectMun(num, fly) {
  S.sel = { kind: 'mun', id: num };
  openSheet(munSheet(num));
  highlight();
  if (fly !== false) zoomTo(layerM, p => p.num === num);
}
function selectFre(key, fly) {
  S.sel = { kind: 'fre', id: key };
  openSheet(freSheet(key));
  highlight();
  if (fly !== false) zoomTo(layerF, p => p.mun_num + '|' + p.name === key);
}
function selectCity(num, fly) {
  S.sel = { kind: 'city', id: num };
  openSheet(citySheet(num));
  highlight();
  if (fly !== false) zoomTo(layerC, p => p.num === num);
}
function zoomTo(layer, test) {
  const mine = ++fitToken;                       // cancels any pending layer fit
  requestAnimationFrame(() => {
    if (mine !== fitToken) return;
    map.invalidateSize({ animate: false });
    // keep the selected area in the strip of map the bottom sheet does not cover
    const sheet = $('#sheet');
    const cover = sheet.hidden ? 0 : Math.min(sheet.getBoundingClientRect().height,
      $('#map').getBoundingClientRect().height - 140);
    layer.eachLayer(l => {
      if (!test(l.feature.properties)) return;
      // fit into the height that stays visible, then slide the view down so the
      // area lands in that strip rather than under the sheet
      map.fitBounds(l.getBounds(), { padding: [18, 18 + cover / 2], animate: false });
      if (cover) map.panBy([0, cover / 2], { animate: false });
    });
    syncPlaces();
  });
}

/* ------------------------------------------------------------------ list --- */
function sortOptions() {
  const lvl = S.level === 'city' ? 'municipio' : S.level;
  return D.indicators.filter(i => i.levels.includes(lvl) && i.available !== false);
}
function fillSelects() {
  const lvl = S.level === 'city' ? 'municipio' : S.level;
  const opts = D.indicators.filter(i => i.levels.includes(lvl));
  const mk = i => `<option value="${i.key}"${i.key === S.indicator ? ' selected' : ''}>` +
    html(i.label_he) + (i.available === false ? ' — ' + MISSING : '') + '</option>';
  $('#indicator').innerHTML = opts.map(mk).join('');
  if (!opts.some(i => i.key === S.indicator)) { S.indicator = opts[0].key; $('#indicator').value = S.indicator; }
  const so = sortOptions();
  $('#sortBy').innerHTML = so.map(i =>
    `<option value="${i.key}"${i.key === S.sort ? ' selected' : ''}>${html(i.label_he)}</option>`).join('') +
    `<option value="name"${S.sort === 'name' ? ' selected' : ''}>שם</option>`;
}

function renderList() {
  const ind = D.indByKey.get(S.sort) || D.indByKey.get('pop2021');
  let rows, mkRow;
  if (S.level === 'city') {
    rows = D.city.slice();
    $('#listTitle').textContent = '7 רבעי עיריית פורטו';
    rows.sort((a, b) => b.pop2021 - a.pop2021);
    mkRow = q => `<button class="row" data-city="${q.num}">
        <i class="row-bar" style="background:${q.colour}"></i>
        <span class="row-main"><span class="row-t">${html(q.he)}</span>
          <span class="row-s lat">${html(q.en)}</span></span>
        <span class="row-v"><b class="num">${nf(q.pop2021)}</b><span>תושבים</span></span></button>`;
  } else if (S.level === 'freguesia') {
    rows = D.fre.filter(frePasses);
    $('#listTitle').textContent = `${rows.length} פרגזיות`;
    rows.sort(cmp(S.sort, f => f.he || f.pt));
    mkRow = f => `<button class="row" data-fre="${html(D.freKey(f))}">
        <i class="row-bar" style="background:${BELT_COLOUR[D.munByNum.get(f.mun_num).belt] || '#888'}"></i>
        <span class="row-main"><span class="row-t">${html(f.he || f.pt)}</span>
          <span class="row-s">${html(f.mun_he)} · <span class="lat">${html(f.pt)}</span></span></span>
        <span class="row-v"><b class="num">${fmtVal(f[S.sort], ind)}</b><span>${html(ind.unit || '')}</span></span></button>`;
  } else {
    rows = D.mun.filter(munPasses);
    $('#listTitle').textContent = `${rows.length} עיריות`;
    rows.sort(cmp(S.sort, m => m.he));
    mkRow = m => {
      const on = S.compare.includes(m.num);
      return `<div class="row" data-mun="${m.num}">
        <i class="row-bar" style="background:${BELT_COLOUR[m.belt] || m.colour}"></i>
        <span class="row-main"><span class="row-t">${html(m.he)}</span>
          <span class="row-s lat">${html(m.pt)}</span></span>
        <span class="row-v"><b class="num">${fmtVal(m[S.sort], ind)}</b><span>${html(ind.unit || '')}</span></span>
        <span class="row-pick ${on ? 'on' : ''}" data-cmp="${m.num}" role="checkbox"
          aria-checked="${on}" aria-label="להשוואה"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></span>
      </div>`;
    };
  }
  $('#rows').innerHTML = rows.length ? rows.map(mkRow).join('')
    : `<p class="muted" style="padding:14px">אין אזורים שעומדים בסינון.</p>`;
}
function cmp(key, nameOf) {
  if (key === 'name') return (a, b) => nameOf(a).localeCompare(nameOf(b), 'he');
  const ind = D.indByKey.get(key);
  const asc = ind && ind.high_is === 'low';
  return (a, b) => {
    const x = a[key], y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return asc ? x - y : y - x;
  };
}

/* --------------------------------------------------------------- compare --- */
function toggleCompare(num) {
  const i = S.compare.indexOf(num);
  if (i >= 0) S.compare.splice(i, 1);
  else if (S.compare.length < 4) S.compare.push(num);
  else { S.compare.shift(); S.compare.push(num); }
  save(); renderCompare(); renderList();
  if (S.sel && S.sel.kind === 'mun') openSheet(munSheet(S.sel.id));
}

function renderCompare() {
  const chips = D.mun.filter(m => S.compare.includes(m.num))
    .map(m => `<span class="chip on" data-cmp="${m.num}">${html(m.he)} ✕</span>`).join('');
  $('#cmpChips').innerHTML = chips;
  $('#cmpAll').innerHTML = D.mun.map(m =>
    `<span class="chip ${S.compare.includes(m.num) ? 'on' : ''}" data-cmp="${m.num}">${html(m.he)}</span>`).join('');
  $('#cmpHint').textContent = S.compare.length < 2
    ? 'בחרו 2–4 עיריות — מהמפה, מהרשימה או מהתפריט כאן.'
    : `${S.compare.length} עיריות בהשוואה.`;

  const sel = S.compare.map(n => D.munByNum.get(n));
  if (sel.length < 2) { $('#cmpBody').innerHTML = ''; return; }

  const keys = D.indicators.filter(i => i.levels.includes('municipio') &&
    sel.some(m => m[i.key] !== undefined && m[i.key] !== null));
  let head = `<tr><th>אינדיקטור</th>${sel.map(m => `<th>${html(m.he)}</th>`).join('')}</tr>`;
  let body = '';
  for (const ind of keys) {
    const vals = sel.map(m => m[ind.key]);
    const nums = vals.filter(v => v != null);
    const best = ind.high_is === 'low' ? Math.min(...nums) : Math.max(...nums);
    body += `<tr><td>${html(ind.label_he)}${ind.unit ? ` <span class="sub">${html(ind.unit)}</span>` : ''}` +
      `${ind.reference_year ? `<div class="sub">${ind.reference_year}</div>` : ''}</td>` +
      vals.map(v => `<td class="${v != null && v === best && ind.high_is !== 'neutral' ? 'best' : ''}">` +
        `${fmtVal(v, ind)}</td>`).join('') + '</tr>';
  }
  body += `<tr><td>חגורה</td>${sel.map(m => `<td>${html((m.belt || '').replace('החגורה ', ''))}</td>`).join('')}</tr>`;
  body += `<tr><td>מסילה לפורטו</td>${sel.map(m => `<td>${m.rail ? 'כן' : 'לא'}</td>`).join('')}</tr>`;
  body += `<tr><td>פרגזיות</td>${sel.map(m => `<td>${m.n_freguesias}</td>`).join('')}</tr>`;

  let bars = '';
  for (const ind of keys) {
    const vals = sel.map(m => m[ind.key]).filter(v => v != null);
    if (!vals.length) continue;
    const max = Math.max(...vals);
    bars += `<div class="bars"><h3>${html(ind.label_he)}<span>${html(ind.unit || '')}` +
      `${ind.reference_year ? ' · ' + ind.reference_year : ''}</span></h3>` +
      sel.map(m => {
        const v = m[ind.key];
        const w = v == null ? 0 : Math.max(2, 100 * v / max);
        return `<div class="bar"><span class="bar-n">${html(m.he)}</span>
          <span class="bar-t"><span class="bar-f" style="width:${w}%;background:${BELT_COLOUR[m.belt] || m.colour}"></span></span>
          <span class="bar-v">${fmtVal(v, ind)}</span></div>`;
      }).join('') + '</div>';
  }

  const missing = D.indicators.filter(i => i.available === false && i.levels.includes('municipio'));
  $('#cmpBody').innerHTML =
    `<table class="cmp-tbl"><thead>${head}</thead><tbody>${body}</tbody></table>${bars}` +
    (missing.length ? `<div class="card"><h3>לא נכנס להשוואה</h3><p class="note">
      ${missing.map(i => html(i.label_he)).join(', ')} — ${MISSING} לאף עירייה.
      ראו לשונית ״מקורות״ לאופן ההשלמה.</p></div>` : '') +
    sel.map(m => `<details class="acc"><summary>${html(m.he)} — הפרופיל מהמסמך</summary>
      <div class="fields"><dl>${m.profile.map(f =>
      `<div class="fld"><dt>${html(f.label)}</dt><dd>${html(f.text)}</dd></div>`).join('')}</dl></div>
      </details>`).join('');
}

/* ---------------------------------------------------------------- search --- */
function fold(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function runSearch(term) {
  const t = fold(term.trim());
  if (t.length < 2) {
    $('#qres').innerHTML = `<p class="muted" style="padding:14px">
      אפשר לחפש עירייה, פרגזיה, רובע או שכונה — בעברית, פורטוגזית או אנגלית.
      סה״כ ${D.mun.length} עיריות, ${D.fre.length} פרגזיות,
      ${D.city.reduce((s, q) => s + q.bairros.length, 0)} שכונות בפורטו
      ו-${D.places.length} נקודות OSM.</p>`;
    return;
  }
  const out = [];
  const hit = (...xs) => xs.some(x => fold(x).includes(t));
  D.mun.forEach(m => { if (hit(m.he, m.pt, m.en)) out.push({ t: 'עירייה', n: m.he, s: m.pt, a: `data-mun="${m.num}"` }); });
  D.fre.forEach(f => { if (hit(f.he, f.pt, f.en)) out.push({ t: 'פרגזיה', n: f.he || f.pt, s: `${f.mun_he} · ${f.pt}`, a: `data-fre="${html(D.freKey(f))}"` }); });
  D.city.forEach(q => {
    if (hit(q.he, q.en)) out.push({ t: 'רובע בפורטו', n: q.he, s: q.en, a: `data-city="${q.num}"` });
    q.bairros.forEach(b => { if (hit(b.he, b.en)) out.push({ t: 'שכונה בפורטו', n: b.he, s: `${q.he} · ${b.en}`, a: `data-city="${q.num}"` }); });
  });
  const seenPlace = new Set();
  D.places.forEach(p => {
    if (!hit(p.name) || seenPlace.has(p.name)) return;   // OSM repeats some names
    seenPlace.add(p.name);
    out.push({ t: 'נקודת OSM', n: p.name, s: p.kind, a: `data-ll="${p.ll[0]},${p.ll[1]}"` });
  });

  $('#qres').innerHTML = out.length
    ? out.slice(0, 80).map(r => `<button class="row" ${r.a}>
        <span class="row-main"><span class="row-t">${html(r.n)}</span>
          <span class="row-s lat">${html(r.s)}</span></span>
        <span class="row-v"><span>${html(r.t)}</span></span></button>`).join('') +
    (out.length > 80 ? `<p class="muted" style="padding:8px 4px">${out.length} תוצאות, מוצגות 80.</p>` : '')
    : `<p class="muted" style="padding:14px">אין תוצאות ל״${html(term)}״.</p>`;
}

/* ------------------------------------------------------------------ info --- */
function renderInfo() {
  const s = D.sources;
  const fields = Object.entries(s.fields).map(([k, f]) => `<div class="card">
      <h3>${html(f.label_he || k)}</h3>
      <p class="note"><code>${html(k)}</code></p>
      ${f.reference_year ? `<p>שנת ייחוס: <b>${html(f.reference_year)}</b></p>` : ''}
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
      ${m.fetch ? `<pre>python3 ${html(m.fetch)}\npython3 scripts/build.py &amp;&amp; python3 scripts/checks.py</pre>` : ''}
      ${(m.candidate_sources || []).map(u => `<p class="note"><a href="${html(u)}" target="_blank" rel="noopener">${html(u)}</a></p>`).join('')}
    </div>`).join('');

  $('#infoBody').innerHTML = `
    <h2>מה יש כאן</h2>
    <p>כל הידע מהמסמך <span class="lat">porto_district_map_a3.pdf</span> — 18 פרופילי
      עיריות, 243 פרגזיות, שבעת רבעי עיריית פורטו ו-53 השכונות שלה — עם גבולות
      רשמיים, אוכלוסייה, שטח וצפיפות.</p>
    <ul>
      <li>18 עיריות · 243 פרגזיות · 7 רבעים · 53 שכונות · ${D.places.length} נקודות OSM</li>
      <li>אוכלוסיית 2021 לכל 243 הפרגזיות (במסמך היו 119 מתוכן)</li>
      <li>שטח וצפיפות לכל 18 העיריות ו-243 הפרגזיות</li>
      <li>נבנה: <span class="lat">${html(D.generated)}</span></li>
    </ul>
    <p><a href="data/raw/porto_district_map_a3.pdf" target="_blank" rel="noopener">פתיחת המסמך המקורי (PDF, 19 עמודים)</a></p>

    <h2>מה עוד חסר</h2>
    <p>${html(s.missing.note_he)}</p>
    ${miss}

    <h2>מקור לכל שדה</h2>
    ${fields}

    <h2>רישוי וייחוס</h2>
    ${s.license_notices.map(n => `<p>${html(n)}</p>`).join('')}
    <p class="note">האפליקציה עובדת גם בלי רשת. בלי חיבור, אריחי הרקע לא ייטענו —
      המפה תוצג כגבולות בלבד, וכל הנתונים והטקסטים זמינים במלואם.</p>`;
}

/* --------------------------------------------------------------- filters --- */
function renderFilters() {
  const dists = D.mun.map(m => m.dist_porto_km).filter(v => v != null);
  const maxD = Math.ceil(Math.max(...dists));
  const pops = D.mun.map(m => m.pop2021).filter(v => v != null);
  const maxP = Math.max(...pops);
  const f = S.filters;
  const priceInd = D.indByKey.get('price_eur_m2');
  const prices = D.mun.map(m => m.price_eur_m2).filter(v => v != null);

  $('#filtBody').innerHTML = `
    <div class="f-grp">
      <h3>מרחק אווירי מפורטו <span class="f-val" id="vDist">${f.maxDist === null ? 'הכול' : 'עד ' + f.maxDist + ' ק״מ'}</span></h3>
      <input type="range" id="fDist" min="0" max="${maxD}" step="1" value="${f.maxDist === null ? maxD : f.maxDist}">
    </div>
    <div class="f-grp">
      <h3>אוכלוסייה מינימלית <span class="f-val" id="vPop">${f.minPop === null ? 'הכול' : 'מ-' + nf(f.minPop)}</span></h3>
      <input type="range" id="fPop" min="0" max="${maxP}" step="1000" value="${f.minPop === null ? 0 : f.minPop}">
    </div>
    <div class="f-grp">
      <h3>חגורה</h3>
      ${D.belts.map(b => `<label class="sw"><input type="checkbox" class="fBelt" value="${html(b.he)}"
          ${f.belts.includes(b.he) ? 'checked' : ''}><span style="color:${b.colour};font-weight:700">■</span>
          ${html(b.he)} <span class="muted">(${b.nums.length})</span></label>`).join('')}
    </div>
    <div class="f-grp">
      <label class="sw"><input type="checkbox" id="fRail" ${f.railOnly ? 'checked' : ''}>
        רק עיריות עם מטרו או רכבת לפורטו</label>
      <p class="note">נגזר מטקסט התחבורה במסמך המקורי.</p>
    </div>
    <div class="f-grp">
      <h3>מחיר למ״ר <span class="f-val" id="vPrice">${prices.length ? (f.maxPrice === null ? 'הכול' : 'עד ' + nf(f.maxPrice)) : MISSING}</span></h3>
      ${prices.length
      ? `<input type="range" id="fPrice" min="${Math.floor(Math.min(...prices))}" max="${Math.ceil(Math.max(...prices))}" step="25" value="${f.maxPrice === null ? Math.ceil(Math.max(...prices)) : f.maxPrice}">`
      : `<p class="note">אין נתוני מחיר. להשלמה: <code>${html(priceInd.fetch)}</code>, ואז
           <code>scripts/build.py</code> — והמסנן הזה יופעל מעצמו.</p>`}
    </div>`;

  const bind = (id, out, fmt, set) => {
    const el = $(id); if (!el) return;
    el.addEventListener('input', () => { set(+el.value); $(out).textContent = fmt(+el.value); });
  };
  bind('#fDist', '#vDist', v => v >= maxD ? 'הכול' : 'עד ' + v + ' ק״מ',
    v => { f.maxDist = v >= maxD ? null : v; });
  bind('#fPop', '#vPop', v => v <= 0 ? 'הכול' : 'מ-' + nf(v),
    v => { f.minPop = v <= 0 ? null : v; });
  if (prices.length) {
    const hi = Math.ceil(Math.max(...prices));
    bind('#fPrice', '#vPrice', v => v >= hi ? 'הכול' : 'עד ' + nf(v),
      v => { f.maxPrice = v >= hi ? null : v; });
  }
  $$('.fBelt').forEach(cb => cb.addEventListener('change', () => {
    f.belts = $$('.fBelt').filter(x => x.checked).map(x => x.value);
  }));
  const rail = $('#fRail');
  if (rail) rail.addEventListener('change', () => { f.railOnly = rail.checked; });
}
function applyFilters() {
  const n = activeFilterCount();
  const b = $('#filterBadge');
  b.hidden = n === 0; b.textContent = n;
  save(); drawLevel(); renderList();
}

/* ----------------------------------------------------------- persistence --- */
function save() {
  try {
    localStorage.setItem('porto.v1', JSON.stringify({
      level: S.level, indicator: S.indicator, tiles: S.tiles,
      sort: S.sort, compare: S.compare, filters: S.filters,
    }));
  } catch (e) { /* private mode, blocked storage — the app works without it */ }
}
function restore() {
  try {
    const raw = localStorage.getItem('porto.v1');
    if (!raw) return;
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') {
      if (o.level) S.level = o.level;
      if (o.indicator) S.indicator = o.indicator;
      if (typeof o.tiles === 'boolean') S.tiles = o.tiles;
      if (o.sort) S.sort = o.sort;
      if (Array.isArray(o.compare)) S.compare = o.compare.slice(0, 4);
      if (o.filters) Object.assign(S.filters, o.filters);
    }
  } catch (e) { /* ignore corrupt or unreadable storage */ }
}

/* ------------------------------------------------------------------ view --- */
function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('is-on', v.id === 'view-' + name));
  $$('.tab').forEach(t => {
    const on = t.dataset.view === name;
    t.classList.toggle('is-on', on); t.setAttribute('aria-selected', on);
  });
  $('.top').style.display = (name === 'map' || name === 'list') ? '' : 'none';
  document.querySelector('main').style.insetBlockStart =
    (name === 'map' || name === 'list') ? 'var(--top-h)' : 'calc(var(--safe-t) + 4px)';
  if (name === 'map') setTimeout(() => map.invalidateSize(), 60);
  if (name === 'compare') renderCompare();
  if (name === 'info') renderInfo();
  if (name === 'search') $('#q').focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ wire --- */
function wire() {
  $$('#levelSeg .seg-b').forEach(b => b.addEventListener('click', () => {
    S.level = b.dataset.level;
    $$('#levelSeg .seg-b').forEach(x => {
      const on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', on);
    });
    closeSheet(); fillSelects(); save(); drawLevel(); renderList();
  }));

  $('#indicator').addEventListener('change', e => {
    S.indicator = e.target.value; save(); drawLevel();
  });
  $('#sortBy').addEventListener('change', e => { S.sort = e.target.value; save(); renderList(); });

  $('#tilesBtn').addEventListener('click', () => {
    S.tiles = !S.tiles;
    $('#tilesBtn').setAttribute('aria-pressed', String(S.tiles));
    if (S.tiles) tileLayer.addTo(map); else map.removeLayer(tileLayer);
    save();
  });

  $('#filterBtn').addEventListener('click', () => { renderFilters(); $('#filters').hidden = false; });
  $('#filtClose').addEventListener('click', () => { $('#filters').hidden = true; });
  $('#filtApply').addEventListener('click', () => { $('#filters').hidden = true; applyFilters(); });
  $('#filtClear').addEventListener('click', () => {
    S.filters = { maxDist: null, minPop: null, belts: [], railOnly: false, maxPrice: null };
    renderFilters(); applyFilters();
  });
  $('#filters').addEventListener('click', e => { if (e.target.id === 'filters') $('#filters').hidden = true; });

  $$('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

  $('#grab').addEventListener('click', () => $('#sheet').classList.toggle('big'));

  $('#q').addEventListener('input', e => runSearch(e.target.value));

  // one delegated handler for every data-* action in the document
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-mun],[data-fre],[data-city],[data-cmp],[data-close],[data-src],[data-info],[data-ll],[data-goto-city]');
    if (!t) return;
    if (t.dataset.close !== undefined) { closeSheet(); return; }
    if (t.dataset.cmp !== undefined) { e.stopPropagation(); toggleCompare(+t.dataset.cmp); return; }
    if (t.dataset.src !== undefined) { alertSource(t.dataset.src); return; }
    if (t.dataset.info !== undefined) { window.alert(t.dataset.info); return; }
    if (t.dataset.gotoCity !== undefined) {
      S.level = 'city';
      $$('#levelSeg .seg-b').forEach(x => x.classList.toggle('is-on', x.dataset.level === 'city'));
      fillSelects(); drawLevel(); renderList(); showView('map'); closeSheet(); return;
    }
    if (t.dataset.ll !== undefined) {
      const [la, lo] = t.dataset.ll.split(',').map(Number);
      showView('map'); map.setView([la, lo], 15); return;
    }
    if (t.dataset.mun !== undefined) { showView('map'); ensureLevel('municipio'); selectMun(+t.dataset.mun); return; }
    if (t.dataset.fre !== undefined) { showView('map'); ensureLevel('freguesia'); selectFre(t.dataset.fre); return; }
    if (t.dataset.city !== undefined) { showView('map'); ensureLevel('city'); selectCity(+t.dataset.city); return; }
  });

  window.addEventListener('resize', () => { if (map) map.invalidateSize(); });
}

function ensureLevel(lvl) {
  if (S.level === lvl) return;
  S.level = lvl;
  $$('#levelSeg .seg-b').forEach(x => {
    const on = x.dataset.level === lvl;
    x.classList.toggle('is-on', on); x.setAttribute('aria-selected', on);
  });
  fillSelects(); save(); drawLevel(); renderList();
}

function alertSource(key) {
  const f = D.sources.fields[key];
  if (!f) return;
  const lines = [f.label_he, '', 'מקור: ' + (f.source || ''),
    f.reference_year ? 'שנת ייחוס: ' + f.reference_year : '',
    f.coverage ? 'כיסוי: ' + f.coverage : '',
    f.validation_he ? '' + f.validation_he : '',
    f.caveat_he ? '' + f.caveat_he : '',
    f.url || ''].filter(Boolean);
  window.alert(lines.join('\n'));
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
  fillSelects();
  initMap();
  renderList();
  wire();
  $('#tilesBtn').setAttribute('aria-pressed', String(S.tiles));
  applyFilters();
  runSearch('');
  $('#boot').remove();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode unavailable */ });
  }
})();
