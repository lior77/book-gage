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
/* ---------------------------------------------------------------- language ---
   Hebrew is the source and the default.  Every string in this file is written in
   Hebrew and stays written in Hebrew; the English is a table beside it, keyed by
   the Hebrew itself, so the code reads as one language rather than as a pair of
   keys and a lookup.

   t() is the IDENTITY FUNCTION while the app is in Hebrew.  That is what makes
   it safe to apply to five hundred strings at once: the Hebrew build cannot
   change, and the whole existing test suite still describes it exactly.

   A string with no English entry falls back to the Hebrew rather than to its own
   key or to an empty box.  An English reader then sees a Hebrew sentence, which
   is honest — that text has not been translated yet — where a machine
   translation presented in the app's own voice would not be. */
const EN = Object.create(null);
function t(s) {
  if (S.lang !== 'en') return s;
  const v = EN[s];
  return v === undefined ? s : v;
}

/* A place's name in the language being read.  Every municipality, parish and
   locality already carries its official Portuguese name — that is what an
   English reader wants, and it is the name on the road signs. */
function nm(o) {
  if (!o) return '';
  return S.lang === 'en' ? (o.pt || o.en || o.he || '') : (o.he || o.pt || o.en || '');
}

/* The name, with the official Portuguese one beside it.  In Hebrew the Latin
   original is context worth showing; in English it IS the name, so there is
   nothing to put in the brackets and the brackets go. */
/* A point's category, translated on the way to the screen and not when the
   table was built — see section 11: a t() evaluated once at load freezes the
   language it happened to open in. */
function poiLabel(cat) {
  return t((D.poiLabel || {})[cat] || cat);
}

function nmPair(o, latin) {
  const main = nm(o);
  const lat = latin === undefined ? (o.pt || o.en || '') : latin;
  if (S.lang === 'en' || !lat || lat === main) return html(main);
  return html(main) + ' <span class="lat">(' + html(lat) + ')</span>';
}

/* The prose written for this app — the municipality profiles, the parish
   notes, the locality descriptions, the source caveats — is translated in
   data/prose_en.json, by the same hand that wrote the Hebrew.  That is the only
   kind of English the app will speak in its own voice: a machine translation
   would have the app asserting something nobody wrote.  heOnly() is what
   remains of the older decision, and it is now a backstop rather than a
   policy: if a Hebrew string ever reaches an English screen untranslated, the
   reader is told so instead of being shown a sentence the app cannot stand
   behind.  Check 7o is what keeps it from ever firing. */
function heOnly(text) {
  if (S.lang !== 'en' || !text || !/[\u0590-\u05ff]/.test(String(text))) return '';
  return ' <span class="flag" dir="ltr">Hebrew only</span>';
}

/* The same prose, written to the page.  A Hebrew paragraph inside an English
   page needs its own direction or the bidi algorithm hands it back with the
   full stop at the wrong end — the rule from section 11, in the other
   direction. */
function prose(text) {
  if (!text) return '';
  const en = t(text);
  const heb = /[\u0590-\u05ff]/.test(String(en));
  const body = html(en);
  if (S.lang !== 'en' || !heb) return body;
  return '<span dir="rtl" lang="he">' + body + '</span>' + heOnly(en);
}

function applyLang() {
  const r = document.documentElement;
  /* The few strings that live in index.html rather than here carry their Hebrew
     in data-t, so they can be written again in the other language. */
  $$('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  r.lang = S.lang === 'en' ? 'en' : 'he';
  r.dir = S.lang === 'en' ? 'ltr' : 'rtl';
}

const MISSING_HE = 'אין נתון';   // the source string; miss() translates it
const miss = () => t(MISSING_HE);
const KEY = 'porto-split-v1';

const S = {
  lang: 'he',          // 'he' | 'en' — Hebrew is the default
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
  water: false,        // rivers and lakes — off until asked for
  // The district-wide constraint view: REN and RAN for all 18 municipalities
  // at once.  The switch is display and the download is storage, and they are
  // deliberately not the same thing — switching this off deletes nothing.
  cons: false,
  // which of the three classes the key is showing; a switch on the page, saved
  consShow: { ran: true, ren: true, both: true },
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
  // השוואת נתונים: one field ranked across the units of the level.  A screen,
  // like the menu, so it never comes back open — and never at level 3.
  cmp: false,
  cmpScope: 'mun',     // level 1 only: 'mun' | 'fre'
  cmpField: null,      // the field being compared; CMP_DEFAULT until chosen
  cmpPick: false,      // the field picker is open in place of the key and list
};
const MINE_KEY = 'porto-mine-v1';
const D = {};

/* ------------------------------------------------------------ formatting --- */
const nf = (v, dec) => v === null || v === undefined ? miss()
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
   asked for at the district's own weight.  What separates them is the pane they
   sit in and the colour the level gives them, not the weight.

   The weights came down a step on every page and every level: at 3.2 the
   municipality outline was thick enough to eat the shape behind it on a phone,
   and the hierarchy survives the thinning because it was never carried by
   width alone. */
const LINE_W = { region: 3.2, district: 2.4, mun: 2.4, fre: 1.2 };
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
  /* While comparing, every unit is a filled colour and the black lines the map
     normally uses read as a second, competing layer over them.  White separates
     the shapes without adding a value of its own — but only over the three
     darkest blues.  Measured against the five fills and the two plates:

       white   1.98  2.47  4.08  6.94  12.26   plate 1.13 (day)  18.43 (night)
       ink     7.83  6.26  3.80  2.23   1.26   plate 13.66       1.19

     Neither colour is a boundary on its own, and the edge of the district —
     white against the day plate at 1.13 — was the one the eye lost first.  So
     the line is drawn twice: a white casing with a dark core inside it.  Under
     every fill and both plates one of the two clears 3:1, which is what SC
     1.4.11 asks of a boundary that carries meaning. */
  if (S.cmp) return own ? '#ffffff' : 'rgba(255,255,255,.7)';
  return isDark()
    ? (own ? '#ffffff' : 'rgba(255,255,255,.5)')
    : (own ? '#000000' : 'rgba(0,0,0,.5)');
};

/* Drawn after the filled shapes of whichever level is on screen, so a boundary
   is never buried under a fill.  The fills carry no stroke of their own any
   more — every line on the map comes from here. */
/* The dark half of the comparison line.  It is drawn inside the white one, at
   half its weight, so what the eye reads is still a single thin boundary — the
   white is a casing, not a second line. */
const CMP_CORE = '#1b2532';
const LINE_KEYS = ['lnRegion', 'lnDistrict', 'lnMun', 'lnFre',
                   'lnRegionC', 'lnDistrictC', 'lnMunC', 'lnFreC'];

function drawLines() {
  LINE_KEYS.forEach(k => {
    if (LG[k]) { map.removeLayer(LG[k]); delete LG[k]; }
  });
  const style = (kind, props) => ({ color: lineColour(kind, props),
    weight: LINE_W[kind], opacity: .95, fill: false,
    lineJoin: 'round', lineCap: 'round' });
  const core = (kind, props) => ({ color: CMP_CORE,
    weight: LINE_W[kind] / 2, opacity: lineColour(kind, props) === '#ffffff' ? .95 : .6,
    fill: false, lineJoin: 'round', lineCap: 'round' });

  /* One boundary, two strokes.  The casing goes in first and the core on top of
     it inside the same pane, where Leaflet keeps insertion order — so the pane
     stacking that decides which kind of line wins is untouched. */
  const add = (key, data, kind, props) => {
    LG[key] = L.geoJSON(data, { pane: PANE_OF[kind], interactive: false,
      style: ft => style(kind, ft.properties) }).addTo(map);
    // the regions are the one line that is a colour rather than an ink; a dark
    // core inside the orange would be a second thing to read, not a casing
    if (S.cmp && kind !== 'region') {
      LG[key + 'C'] = L.geoJSON(data, { pane: PANE_OF[kind], interactive: false,
        style: ft => core(kind, ft.properties) }).addTo(map);
    }
    return LG[key];
  };

  /* The parish lines are not a district-wide layer any more.  At level 2 they
     are the chosen municipality's own parishes and nothing else; at level 3 the
     one parish being looked at, which still needs an outline — the fill under
     it carries none.  At level 1 they are not drawn at all: 243 outlines over
     eighteen municipalities was noise, not context.

     The comparison screen is the exception, and only when the parishes are what
     is being compared.  There all 243 carry a value and a colour of their own,
     and a fill with no edge is not a unit — it is a stain that runs into its
     neighbour.  They stay the receding line, not the black one: the
     municipality outline above them is what says where you are looking. */
  const freHere = S.level === 'mun'
    ? ft => ft.properties.mun_num === S.mun
    : S.level === 'zone'
      ? ft => ft.properties.mun_num + '|' + ft.properties.name === S.zone
      : S.cmp && S.cmpScope === 'fre'
        ? () => true
        : null;
  if (S.lnFre && freHere) {
    add('lnFre', { type: 'FeatureCollection', features: D.bF.features.filter(freHere) }, 'fre');
  }
  if (S.lnMun) {
    /* While comparing at level 2 only one municipality is on the plate, and
       there is no street map under the others to tie their outlines to
       anything.  Drawing them would be eighteen shapes' worth of line around a
       picture of one. */
    const munData = S.cmp && S.level === 'mun'
      ? { type: 'FeatureCollection',
          features: D.bM.features.filter(ft => ft.properties.num === S.mun) }
      : D.bM;
    add('lnMun', munData, 'mun');
    // the chosen municipality's own outline goes on top of its neighbours',
    // or a grey line drawn later would sit over the black one
    if (S.level === 'mun') {
      LG.lnMun.eachLayer(l => {
        if (l.feature && l.feature.properties.num === S.mun) l.bringToFront();
      });
      if (LG.lnMunC) LG.lnMunC.eachLayer(l => {
        if (l.feature && l.feature.properties.num === S.mun) l.bringToFront();
      });
    }
  }
  // The regions and the district share one file; each feature says which it is.
  const pick = kind => ({ type: 'FeatureCollection',
    features: D.bB.features.filter(ft => (ft.properties.kind === 'nuts3'
      ? 'region' : 'district') === kind) });
  /* Same reason as the neighbouring municipalities: while comparing one
     municipality the plate holds that municipality and nothing else, and the
     district edge crossing the empty corner is a line to nowhere.  On the
     ordinary map it is context over a street background; here there is no
     background for it to be context on. */
  const wide = !(S.cmp && S.level === 'mun');
  if (S.lnRegion && wide) add('lnRegion', pick('region'), 'region');
  if (S.lnDistrict && wide) add('lnDistrict', pick('district'), 'district');
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
    <h2>${t('אנשים — מפקד 2021')}</h2>
    <div class="stats">
      ${stat(t('גיל חציוני'), o.median_age, t('שנים'), 0, lvl + '.median_age')}
      ${stat(t('בני 0–14'), o.pct_0_14, '%', 0, lvl + '.pct_0_14')}
      ${stat(t('בני 65+'), o.pct_65plus, '%', 0, lvl + '.pct_65plus')}
      ${stat(t('מדד הזדקנות'), o.ageing_index, '', 0, lvl + '.ageing_index')}
      ${stat(t('אזרחות זרה'), o.foreign_pct, '%', 0, lvl + '.foreign_pct')}
      ${stat(t('השכלה גבוהה — מכלל התושבים'), o.education_pct, '%', 0, lvl + '.education_pct')}
      ${stat(t('אבטלה'), o.unemployment_pct, '%', 0, lvl + '.unemployment_pct')}
      ${D.sources.fields[lvl + '.pop_growth_pct']
        ? stat(t('שינוי מ-2011'), o.pop_growth_pct, '%', 1, lvl + '.pop_growth_pct',
               null, signed)
        : ''}
    </div>
    <p class="note">${t('הגיל החציוני מחושב מפסי גיל של חמש שנים — INE לא מפרסם חציון בקובץ הזה. מדד הזדקנות הוא בני 65 ומעלה לכל מאה בני 0–14. השינוי מ-2011 הוא כפי ש-INE מפרסמת אותו על גאוגרפיית מפקד 2021 — לא חושב כאן, כי חלוקת הרובעים של 2011 אינה זו של 2021.')}</p>
  </div>`;
}
function housingStats(o, lvl) {
  const h = o.housing;
  if (!h) return '';
  const k = lvl + '.housing';
  return `<div class="card">
    <h2>${t('דיור ובניינים — מפקד 2021')}</h2>
    <div class="stats">
      ${stat(t('דירות'), h.dwellings, '', 0, k)}
      ${stat(t('דירות ריקות'), h.vacant_pct, '%', 1, k)}
      ${stat(t('בית שני'), h.second_home_pct, '%', 1, k)}
      ${stat(t('בבעלות הדיירים'), h.owner_pct, '%', 1, k)}
      ${stat(t('בשכירות'), h.rented_pct, '%', 1, k)}
      ${stat(t('עם חניה'), h.parking_pct, '%', 1, k)}
      ${stat(t('בנייני מגורים'), h.buildings, '', 0, k)}
      ${stat(t('זקוקים לתיקון'), h.repair_pct, '%', 1, k)}
      ${stat(t('תיקון עמוק'), h.deep_repair_pct, '%', 1, k)}
      ${stat(t('נבנו לפני 1946'), h.pre1946_pct, '%', 1, k)}
      ${stat(t('נבנו מ-2011'), h.since2011_pct, '%', 1, k)}
    </div>
    <p class="note">${t('׳זקוקים לתיקון׳ כולל אצל INE גם תיקונים קלים, ולכן האחוז גבוה כמעט בכל מקום; ׳תיקון עמוק׳ הוא זה שמעיד על מצב הבניין. **שני השיעורים הם מתוך כלל בנייני המגורים** — ׳תיקון עמוק׳ אינו אחוז מתוך ׳זקוקים לתיקון׳.')}</p>

    <h2>${t('צורת הבנייה')}</h2>
    <div class="stats">
      ${stat(t('בני קומה או שתיים'), h.floors1_2_pct, '%', 1, k)}
      ${stat(t('בני שלוש קומות ומעלה'), h.floors3plus_pct, '%', 1, k)}
      ${stat(t('בני 3–4 קומות'), h.floors3_4_pct, '%', 1, k)}
      ${stat(t('בני 5 קומות ומעלה'), h.floors5plus_pct, '%', 1, k)}
      ${stat(t('למגורים בלבד'), h.only_resid_pct, '%', 1, k)}
      ${stat(t('נבנו לדירה או שתיים'), h.built1_2_pct, '%', 1, k)}
      ${stat(t('נבנו לשלוש דירות ומעלה'), h.built3plus_pct, '%', 1, k)}
    </div>
    <p class="note">${t('כל השיעורים כאן הם מתוך בנייני המגורים של המפקד. ׳קומה או שתיים׳ ו׳שלוש ומעלה׳ מסתכמים ל-100%; הפירוט ל-3–4 ול-5 ומעלה מגיע מקובץ אחר של INE ואינו קיים לרובעים שהמקטעים הסטטיסטיים שלהם נחצים בין שני רובעים של 2025.')}</p>
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

/* A change needs its sign on both sides.  A decline arrives with its minus, so a
   rise shown as "0.5%" reads as a quantity rather than as a direction, and the
   two look like different kinds of number in the same column. */
function signed(val, dec) {
  const t = shown(Math.abs(val), dec);
  return (val > 0 ? '+' : val < 0 ? '−' : '') + t;
}

// The four INE housing-market series. They sit in their own card because they
// are the only figures here that are not Censos 2021, and because the caveat
// under them is not the census caveat: every value is the median of the twelve
// months ending in the quarter named, so two quarters side by side would share
// nine months of the same sales and the difference between them would not be a
// quarterly change. The app therefore shows one quarter and never a delta.
//
// INE publishes at parish level in eleven of the eighteen municipalities. In the
// other seven every parish is empty, and the card says so rather than leaving
// four "אין נתון" chips to look like a bug.
function marketStats(o, lvl) {
  const f = D.sources.fields[lvl + '.price_eur_m2'] || {};
  const per = f.reference_period || '';
  const none = lvl === 'freguesia' && o.price_eur_m2 === undefined
    && o.price_used_eur_m2 === undefined && o.rent_eur_m2 === undefined;
  return `<div class="card">
    <h2>${t('שוק הדיור — INE')}${per ? ' ' + html(per) : ''}</h2>
    <div class="stats">
      ${stat(t('מכירות'), o.price_eur_m2, t('€/מ״ר'), 0, lvl + '.price_eur_m2')}
      ${stat(t('דירות חדשות'), o.price_new_eur_m2, t('€/מ״ר'), 0, lvl + '.price_new_eur_m2')}
      ${stat(t('דירות קיימות'), o.price_used_eur_m2, t('€/מ״ר'), 0, lvl + '.price_used_eur_m2')}
      ${stat(t('שכירות'), o.rent_eur_m2, t('€/מ״ר לחודש'), 2, lvl + '.rent_eur_m2')}
    </div>
    <p class="note">${t('כל ערך הוא החציון של שנים עשר החודשים שמסתיימים ב-')}${
      html(per || t('רבעון הייחוס'))} ${t('— לא של הרבעון עצמו. השכירות היא של חוזים חדשים בלבד, לא של כלל מלאי השכירות.')}${
      none ? t(' INE אינו מפרסם ברמת הרובע בעירייה הזאת, ולכן אין כאן ולו ערך אחד.')
           : ''}</p>
  </div>`;
}

/* Its own card, and only at the municipality level: DGPJ publishes the rate by
   municipality and nothing finer.  The card carries the source's own warning
   rather than a summary of it — "registered offences" is what INE counts, and
   "violent crime" is a different series that exists only by district. */
/* Its own card rather than a row inside the housing one: that card's note
   explains the twelve-month window INE uses for prices, and a figure sitting
   under it would look as though the note covered it too.  This one is annual
   declared income from tax returns — a different source and a different year. */
function incomeStats(o, lvl) {
  const key = lvl + '.median_income';
  const f = D.sources.fields[key];
  if (!f) return '';
  return `<div class="card">
    <h2>${t('הכנסה מוצהרת — INE')}${f.reference_year ? ' ' + html(f.reference_year) : ''}</h2>
    <div class="stats">
      ${stat(t('חציון למשק בית פיסקאלי'), o.median_income, t('€ לשנה'), 0, key)}
    </div>
    <p class="note">${t('הכנסה שנתית ברוטו כפי שהוצהרה לרשות המסים, החציון על פני משקי הבית הפיסקאליים.')} <b>${t('לא ההכנסה הכוללת של משק הבית ולא הכנסה נטו')}</b> ${t('— מי שאינו מגיש דוח אינו נספר. מ-2018 הערך מיוחס לעירייה של מען המס ואינו כולל תושבי חוץ.')}</p>
  </div>`;
}

function safetyStats(o, lvl) {
  const key = lvl + '.crimes_per_1000';
  const f = D.sources.fields[key];
  if (!f) return '';
  const yr = f.reference_year ? ' ' + f.reference_year : '';
  return `<div class="card">
    <h2>${t('עבירות רשומות — INE')}${html(yr)}</h2>
    <div class="stats">
      ${stat(t('לאלף תושבים'), o.crimes_per_1000, t('לאלף'), 1, key)}
    </div>
    <p class="note">${t('סך העבירות שנרשמו בידי רשויות האכיפה, חלקי האוכלוסייה המשוערת של אותה שנה.')} <b>${t('זו אינה ׳פשיעה חמורה׳')}</b> ${t('— ‏criminalidade violenta e grave מתפרסמת לפי מחוז ופיקוד משטרתי בלבד, ואין לה ערך ברמת עירייה.')}</p>
  </div>`;
}

function stat(label, val, unit, dec, srcKey, step, fmt) {
  const f = D.sources.fields[srcKey] || {};
  const has = val !== null && val !== undefined;
  const text = has ? (fmt ? fmt(val, dec) : shown(val, dec, step)) : miss();
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
    <span class="stat-y">${f.reference_year ? html(f.reference_year) : t('מקור')}</span>
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
  const [ind, mun, fre, city, zones, bW, sources, bM, bB, bF, bC, proseEn,
         layersManifest] = await Promise.all([
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
    /* The prose this app wrote about the places, in English.  It is a file of
       its own and not part of app.js: five thousand words of editorial text
       belong beside the data they describe, where a diff can be read. */
    j('data/prose_en.json'),
    /* What REN and RAN weigh, when each municipality's was delimited and by
       which law — 16 KB, so the app can say all of it BEFORE anything is
       downloaded. The polygons themselves are a release asset. */
    j('data/layers_manifest.json'),
  ]);
  Object.assign(EN, proseEn.text || {});
  D.layers = layersManifest;
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
  // Shapes by unit, for the comparison screen, which draws parishes from any
  // municipality at once.  Porto's seven come from porto_city, the rest from
  // the district layer, and freOfFeature() already knows which is which.
  D.munGeo = new Map(D.bM.features.map(ft => [ft.properties.num, ft]));
  D.freGeo = new Map();
  D.bF.features.forEach(ft => {
    const f = D.freByKey.get(ft.properties.mun_num + '|' + ft.properties.name);
    if (f) D.freGeo.set(D.freKey(f), ft);
  });
  D.bC.features.forEach(ft => {
    const f = freOfFeature(1, ft.properties);
    if (f) D.freGeo.set(D.freKey(f), ft);
  });
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
    /* The district and the city are both wide and short, so fitBounds is always
       width-bound and the zoom it wants is rarely a round number.  At quarter
       steps it still had to round DOWN: the district wanted 9.235 and got 9,
       which is 2^0.235 = 18% of the map's size given away on every level.  With
       no snap at all the fit is exact — measured 333px wide in a 412px pane
       before, 392px after. */
    zoomSnap: 0, zoomDelta: 0.5,
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
    const tileNote = () =>
      t('רקע המפה לא נטען — מוצגים הגבולות בלבד. כל הנתונים והטקסטים זמינים.');
    mapNote(tileNote(), false, true, tileNote);
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

/* The comparison screen's own label.  White on the fill, no pill behind it:
   the pill is what the app uses over a photographic background, and there is
   none here.  A dark halo keeps the white readable over the two lightest bands,
   where white alone measures under 2:1 — the halo is what makes "white, no
   background" actually legible rather than only nominally so.
   Codes under ten lose the leading zero: the app prints the official two-digit
   DICOFRE everywhere else, but here the number is a label on a shape and one
   digit reads faster. */
const cmpCode = c => String(c).replace(/^0(?=\d$)/, '');
function cmpIcon(text) {
  const t = cmpCode(text);
  return L.divIcon({ className: 'lbl cmp-lbl' + (t.length > 2 ? ' wide' : ''),
    iconSize: [t.length > 2 ? 28 : 24, 24], iconAnchor: [t.length > 2 ? 14 : 12, 12],
    html: '<i>' + html(t) + '</i>' });
}

function numIcon(text, cls) {
  // Official codes are two digits, and a unit the 2025 reform split shows its
  // first successor with a plus — three characters, which need a wider pill or
  // they spill out of the circle Leaflet sizes from iconSize.
  const wide = String(text).length > 2, w = wide ? 28 : 24;
  return L.divIcon({
    className: 'lbl' + (wide ? ' wide' : '') + (cls ? ' ' + cls : ''),
    html: '<i>' + html(text) + '</i>',
    iconSize: [w, 24], iconAnchor: [w / 2, 12],
  });
}

/* What the map keeps clear, in CSS pixels.  MAP_EDGE is the margin on every
   side; the band along the top is the strip the menu button, the home button
   and the trail share.  Its height is --ctl-size in the stylesheet and is read
   from there rather than repeated here — a second copy of that number is how
   the map's padding and the band drift apart. */
const MAP_EDGE = 10;
const bandSize = () => parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue('--ctl-size')) || 44;
const mapTop = () => MAP_EDGE + bandSize() + MAP_EDGE;
const fitPad = () => ({ paddingTopLeft: [MAP_EDGE, mapTop()],
                        paddingBottomRight: [MAP_EDGE, MAP_EDGE] });

function fit(b, pad) {
  if (!b || !b.isValid()) return;
  fitBounds = b;
  map.fitBounds(b, pad ? { padding: pad } : fitPad());
}
function refit() { if (fitBounds) map.fitBounds(fitBounds, fitPad()); }

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
/* A notice is written in the language that was on when it appeared.  Most of
   them answer something the user just pressed and are gone by the next tap, so
   on a language change they are cleared rather than replayed in the old words.
   A notice that is ambient — the one about tiles that will not load — passes a
   `redraw` and is written again in the new language. */
let lastNote = null;
function mapNote(inner, bad, quiet, redraw) {
  lastNote = redraw ? { redraw, bad } : null;
  const n = $('#msgs');
  n.innerHTML = `<div class="msg${bad ? ' bad' : ''}">
      <div class="msg-body">${inner}</div>
      <button class="msg-x" type="button" data-close="1" aria-label="${t('סגירת ההודעה')}">✕</button>
    </div>`;
  if (quiet) return;
  if (S.view === 'map') { S.view = 'split'; applyView(); save(); }
  $('#paneText').scrollTop = 0;
}
function hideNote() { lastNote = null; $('#msgs').innerHTML = ''; }

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
    mapNote(`${t('אתה ב')}<b>${html(nm(f))}</b>, ${html(nm(m))} ${t('· דיוק')} ${nf(Math.round(acc))} ${t('מ׳ <button type="button" data-jump="fre:')}${html(D.freKey(f))}">${t('פתיחת הרובע')}</button>`);
  } else {
    // Anywhere else on earth: say so, and say how far, instead of dropping the
    // map on an empty spot in the ocean.
    const km = Math.round(map.distance(ll, [41.14961, -8.61099]) / 1000);
    if (first) map.panTo(ll);
    mapNote(`${t('המיקום שלך אינו בתוך מחוז פורטו — כ-')}${nf(km)} ${t('ק״מ ממרכז פורטו. דיוק')} ${nf(Math.round(acc))} ${t('מ׳.')}
      <button type="button" data-loc="back">${t('חזרה למפת המחוז')}</button>`, true);
  }
}

function locError(err) {
  stopLocate();
  const why = {
    1: t('לא ניתנה הרשאת מיקום. אפשר לאשר אותה מהאייקון שליד כתובת האתר בדפדפן.'),
    2: t('הטלפון לא הצליח לקבוע מיקום. כדאי לבדוק שה-GPS דלוק ולנסות שוב בחוץ.'),
    3: t('קביעת המיקום ארכה יותר מדי. נסה שוב.'),
  }[err && err.code] || t('לא הצלחתי לקבל מיקום.');
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
    mapNote(t('הדפדפן הזה לא תומך באיתור מיקום.'), true); return;
  }
  // https or localhost only.  Saying this plainly beats a silent failure that
  // looks like a bug: the standalone file opened from the phone's storage is
  // a file:// page, and no browser will hand it a position.
  if (!window.isSecureContext) {
    mapNote(`${t('הדפדפן נותן מיקום רק בחיבור מאובטח. הדף הזה נפתח מ־')}
      <span class="lat">${html(location.protocol)}</span>${t(', ולכן המיקום חסום. הקישור המקוון (https) יעבוד.')}`, true);
    return;
  }
  renderMenu();
  mapNote(t('מחפש מיקום…'));
  meWatch = navigator.geolocation.watchPosition(showMe, locError, {
    enableHighAccuracy: true, maximumAge: 15000, timeout: 20000,
  });
}

/* --------------------------------------------------------- level 1: מחוז --- */
function drawDistrict() {
  clearMap();
  LG.mun = L.geoJSON(D.bM, {
    style: ft => {
      const m = D.munByNum.get(ft.properties.num) || {};
      /* On the constraints page a municipality DGT publishes no delimitation
         for is hatched, not left blank: blank ground there reads as ground
         with nothing on it, which is the one thing it does not mean. The hatch
         is the same one the comparison screen draws for a missing value. */
      if (S.cons && consNone(m)) return { weight: 0, fillOpacity: 1,
        fillColor: 'url(#' + CMP_PAT + ')' };
      return {
        // no stroke: every boundary on the map is drawn by drawLines()
        weight: 0, opacity: .9,
        fillColor: m.fill || '#ddd',
        // solid, and a switch that empties the fill without losing the outline
        fillOpacity: S.muncol ? 1 : 0,
      };
    },
    onEachFeature: (ft, l) => {
      const m = D.munByNum.get(ft.properties.num);
      l.on('click', () => {
        if (S.adding || S.wp) return;
        if (isSecondTap('mun:' + m.num)) { openInGoogle(latlng(m.center), nm(m)); return; }
        goMun(ft.properties.num);
      });
      l.bindTooltip(`<b>${html(munCode(m) + ' · ' + nm(m))}</b><br><span class="lat">${html(m.pt)}</span>`,
        { sticky: true, className: 'tt' });
    },
  }).addTo(map);
  // the hatch a no-delimitation unit is filled with lives in the overlay pane's
  // <defs>, which Leaflet rebuilds with the layer — so it is made after it
  if (S.cons) cmpPattern();

  drawLines();

  LG.labels = L.layerGroup(D.mun.map(m => {
    const mk = L.marker(latlng(m.center), { icon: numIcon(munCode(m)), keyboard: false,
      title: munCode(m) + ' · ' + nm(m), riseOnHover: true });
    mk.on('click', () => {
      if (S.adding || S.wp) return;
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
        <span class="row-t">${nmPair(b, b.en)}</span>
        <span class="row-d">${prose(b.sub_he)}</span>
        <span class="row-m num">${html(b.nums.map(n => munCode(D.munByNum.get(n))).sort().join(' · '))}</span>
      </span></div>`).join('');
  return `<div class="card" id="regionsDoc">
      <h2>${t('שני האזורים')} <span class="en lat">(NUTS III)</span></h2>
      <p class="sub">${t('החלוקה הרשמית של המחוז, וזו שלפיה INE מפרסם. הקו הכתום במפה מקיף את העיריות של כל אזור.')}</p>
      ${rows}
      <p class="note">${t('שני האזורים גדולים ממה שמצויר כאן: לאזור המטרופוליטני 17 עיריות ולטאמגה אה סוזה 11, והשאר יושבות במחוזות אוויירו וויזאו. האפליקציה מראה את החלק שבתוך מחוז 13 בלבד.')}</p>
    </div>`;
}

function renderDistrict() {
  const list = D.mun.slice().sort((a, b) => munCode(a).localeCompare(munCode(b))).map(m => {
    const chr = (m.profile.find(p => p.label === 'אופי') || {}).text || '';
    return `<button class="row" data-mun="${m.num}">
      <span class="pin" style="--c:${html(m.fill)}">${html(munCode(m))}</span>
      <span class="row-body">
        <span class="row-t">${nmPair(m, m.en)}</span>
        <span class="row-d">${prose(chr)}</span>
        <span class="row-m">${html(t(m.belt))} · <span class="num">${shown(m.pop2021, 0, 100)}</span> ${t('תושבים ·')}
          <span class="num">${nf(m.area_km2, 1)}</span> ${t('קמ״ר ·')}
          <span class="num">${nf(m.n_freguesias)}</span> ${t('רובעים')}</span>
      </span>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
    </button>`;
  }).join('');

  $('#doc').innerHTML = `
    <div class="card">
      <h1>${S.lang === 'en' ? 'Distrito do Porto' : t('מחוז פורטו') + ' <span class="en lat">(Distrito do Porto)</span>'}</h1>
      <!-- The population and the area are the two rows of the table right
           below, and a lead that says them again is the same fact twice. -->
      <p class="lead">${t('18 עיריות ו-243 רובעים בצפון-מערב פורטוגל, מהאוקיינוס האטלנטי במערב ועד הרי מראו במזרח. זהו המחוז הצפוף במדינה.')}</p>
      <div class="stats">
        ${stat(t('תושבים'), D.totPop, '', 0, 'municipio.pop2021', 100)}
        ${stat(t('שטח'), D.totArea, t('קמ״ר'), 1, 'municipio.area_km2')}
        ${stat(t('צפיפות'), D.totPop / D.totArea, t('לקמ״ר'), 0, 'municipio.density', 100)}
      </div>
      <p class="note">${t('כל מספר באפליקציה נלחץ ומציג את המקור ואת שנת הייחוס שלו. המספרים על המפה הם קודי DICOFRE הרשמיים.')}</p>
    </div>

    <div class="grp">${t('18 העיריות — לפי המספור במפה')}</div>
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
/* A parish the 2025 reform created out of a dissolved union.  The app draws
   the 2025 division now, so the thing worth saying is no longer "this will be
   split" but "this was part of something else until 2025, and here is what
   that something else said and counted".

   The rule that makes it publishable: the old unit's figures appear under the
   OLD unit's name, code and reference year, never as this parish's. The same
   number without that attribution is an inherited value wearing a new
   parish's name, which is the unmarked interpolation rule 2 forbids — and it
   is never counted in a comparison, a ranking or the colour scale. */
function wasNote(f) {
  const w = f.was_part_of;
  if (!w) return '';
  return t('עד רפורמת 2025 היה חלק מ־')
    + `<span class="lat" dir="ltr">${html(w.pt)} (${html(w.dicofre)})</span>`;
}

function wasCard(f) {
  const w = f.was_part_of;
  if (!w) return '';
  const rows = [];
  if (w.pop2021 != null) {
    rows.push(`<div><dt>${t('תושבים (2021)')}</dt>
      <dd><span class="num">${nf(w.pop2021)}</span>${f.pop2021 != null
        ? ` <span class="note">${t('· מתוכם ברובע הזה')} <span class="num">${
            nf(100 * f.pop2021 / w.pop2021, 1)}</span>%</span>` : ''}</dd></div>`);
  }
  return `<div class="card" id="wasCard">
    <h2>${t('היחידה שקדמה לו')}</h2>
    <p class="sub">${nmPair(w, w.pt)} <span class="lat num">${html(w.dicofre)}</span></p>
    ${rows.length ? `<dl class="kv">${rows.join('')}</dl>` : ''}
    ${w.note ? `<p class="lead">${prose(w.note)}</p>` : ''}
    ${w.note_origin === 'app'
      ? t('<p class="note">התיאור נכתב לאפליקציה ולא הועתק ממקור רשמי.</p>') : ''}
    <p class="note">${t('המספרים כאן הם של היחידה הקודמת ולא של הרובע הזה, והם אינם נספרים בהשוואות, בדירוגים או בצבעי המפה. הם מוצגים כדי לומר איך נראה השטח לפני שהגבול זז.')}</p>
  </div>`;
}

function drawMun(num) {
  clearMap();
  const rows = D.freByMun.get(num) || [];
  const colourOf = new Map(rows.map(f => [freNum(f), f.colour]));

  LG.fre = L.geoJSON(freFeatures(num), {
    style: ft => {
      const f = freOfFeature(num, ft.properties);
      if (S.cons && consNone(f)) return { weight: 0, fillOpacity: 1,
        fillColor: 'url(#' + CMP_PAT + ')' };
      return { weight: 0, opacity: .95,
        fillColor: (f && f.colour) || colourOf.get(ft.properties.num) || '#ddd',
        fillOpacity: S.muncol ? .78 : 0 };
    },
    onEachFeature: (ft, l) => {
      const f = freOfFeature(num, ft.properties);
      if (!f) return;
      l.feature.__key = D.freKey(f);
      l.on('click', () => pickFre(f, 'map'));
      l.bindTooltip(`<b>${html(freNum(f) + '. ' + nm(f))}</b><br><span class="lat">${html(bare(f.pt))}</span>`,
        { sticky: true, className: 'tt' });
    },
  }).addTo(map);
  if (S.cons) cmpPattern();

  drawLines();

  LG.labels = L.layerGroup(rows.map(f => {
    const mk = L.marker(latlng(f.center), { icon: numIcon(freNum(f)), keyboard: false,
      title: freNum(f) + '. ' + nm(f), riseOnHover: true });
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
    `<div><dt>${html(t(p.label))}</dt><dd>${prose(p.text)}</dd></div>`).join('');

  const list = rows.map(f => {
    const n = freNum(f);
    const q = isPorto ? D.quarterByNum.get(f.q) : null;
    const desc = q ? q.desc : (f.note || '');
    const flag = !q && f.note && f.note_origin === 'app'
      ? t('<span class="flag">תיאור שנכתב לאפליקציה</span>') : '';
    const code = `<span class="lat num">${html(f.dicofre || '')}</span>`
      + (f.was_part_of ? t(' <span class="flag">רובע מ-2025</span>') : '');
    return `<button class="row row-full" data-fre="${html(D.freKey(f))}">
      <span class="pin" style="--c:${html(f.colour)}">${n}</span>
      <span class="row-body">
        <span class="row-t">${nmPair(f, bare(f.pt))}${flag}</span>
        <span class="row-d">${desc ? prose(desc) : '<span class="muted">' + miss() + t(' — אין תיאור לרובע הזו</span>')}</span>
        <span class="row-m"><span class="num">${shown(f.pop2021, 0, 100)}</span> ${t('תושבים (2021) ·')}
          <span class="num">${nf(f.area_km2, 2)}</span> ${t('קמ״ר ·')}
          <span class="num">${nf(f.density)}</span> ${t('לקמ״ר')}${q ? ' · <span class="num">' + q.bairros.length + t('</span> שכונות') : ''}
          · ${code}</span>
        ${f.was_part_of ? `<span class="row-m">${wasNote(f)}</span>` : ''}
      </span>
      ${q ? '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>' : ''}
    </button>`;
  }).join('');

  $('#doc').innerHTML = `
    <div class="card">
      <div class="hdr">
        <span class="pin" style="--c:${html(m.fill)}">${html(munCode(m))}</span>
        <div><h1>${nmPair(m, m.en)}</h1>
          <p class="sub">${html(t(m.belt))} · <span class="num">${nf(m.n_freguesias)}</span> ${t('רובעים')}${m.dicofre
            ? t(' · קוד רשמי <span class="lat num">') + html(m.dicofre) + '</span>' : ''}</p></div>
      </div>
      <div class="stats">
        ${stat(t('תושבים'), m.pop2021, '', 0, 'municipio.pop2021', 100)}
        ${stat(t('שטח'), m.area_km2, t('קמ״ר'), 1, 'municipio.area_km2')}
        ${stat(t('צפיפות'), m.density, t('לקמ״ר'), 0, 'municipio.density', 100)}
        ${stat(t('מפורטו'), m.dist_porto_km, t('ק״מ'), 1, 'municipio.dist_porto_km')}
      </div>
      <dl class="kv">${profile}
        <div><dt>${t('תחבורה')}</dt><dd>${prose(m.transport)}</dd></div></dl>
    </div>

    ${peopleStats(m, 'municipio')}
    ${housingStats(m, 'municipio')}
    ${marketStats(m, 'municipio')}
    ${incomeStats(m, 'municipio')}
    ${safetyStats(m, 'municipio')}
    ${layerCard(m.num)}

    <div class="grp">${rows.length} ${isPorto ? t('רבעי העיר') : t('הרובעים')} ${t('— לפי המספור במפה')}</div>
    ${isPorto ? t('<p class="note" style="margin-block-end:8px">לחיצה על רובע פותחת אותו: השכונות שבתוכו באותיות, ואתרים ומוסדות כנקודות שחורות.</p>') : ''}
    <div class="rows">${list}</div>
    ${mineList(p => {
      const at = freguesiaAt(p.ll[0], p.ll[1]);
      return at && at.mun_num === num;
    })}
    <p class="note" style="margin-block-start:10px">${t('המספר על כל רובע הוא הקוד הרשמי שלו בתוך העירייה, והרשימה מסודרת לפיו. רובע שמסומן')}
      <span class="flag">${t('פורק ב-2025')}</span> ${t('חדל להתקיים כיחידה ברפורמת 2025, והקוד שלו הוא זה שהחזיק עד אז — בכרטיס שלו רשומים הרובעים שהחליפו אותו.')}</p>
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
    if (!window.indexedDB) { rej(new Error(t('אין IndexedDB בדפדפן הזה'))); return; }
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

/* ------------------------------------------- constraint layers, on demand ---
   REN and RAN are 22.8 MB gzipped for this district — 1.56 million vertices
   against an APK of 840 KB — so they are not in the app.  They sit in a GitHub
   release and a reader fetches the municipality they are looking at, once, on
   an explicit tap.  Nothing downloads by itself: this is somebody's mobile
   data, and a layer nobody asked for is not worth spending it on.

   Their own database, not the photo one and not localStorage, so that deleting
   every layer cannot touch a saved point — a property that is tested rather
   than asserted. */
const LAYER_DB = 'porto-layers';
const LAYER_STORE = 'blob';

let layerDb = null;
function openLayerDb() {
  if (layerDb) return Promise.resolve(layerDb);
  return new Promise((res, rej) => {
    if (!window.indexedDB) { rej(new Error(t('אין IndexedDB בדפדפן הזה'))); return; }
    const rq = indexedDB.open(LAYER_DB, 1);
    rq.onupgradeneeded = () => {
      if (!rq.result.objectStoreNames.contains(LAYER_STORE))
        rq.result.createObjectStore(LAYER_STORE);
    };
    rq.onsuccess = () => { layerDb = rq.result; res(layerDb); };
    rq.onerror = () => rej(rq.error);
  });
}
function layerTx(mode, fn) {
  return openLayerDb().then(db => new Promise((res, rej) => {
    let rq;
    const tx = db.transaction(LAYER_STORE, mode);
    try { rq = fn(tx.objectStore(LAYER_STORE)); }
    catch (e) { rej(e); return; }
    tx.oncomplete = () => res(rq && rq.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  }));
}
const layerKey = (kind, code) => kind + ':' + code;
const putLayerRec = (k, rec) => layerTx('readwrite', s => s.put(rec, k));
const getLayerRec = k => layerTx('readonly', s => s.get(k));
const delLayerRec = k => layerTx('readwrite', s => s.delete(k)).catch(() => {});
const allLayerKeys = () => layerTx('readonly', s => s.getAllKeys()).catch(() => []);

/* What is stored, and what the app believes about it, are the same record:
   the bytes, the version they came from, and the digest that was checked. */
async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function layerEntry(kind, code) {
  const L = (D.layers && D.layers.layers && D.layers.layers[kind]) || null;
  return L && L.municipalities ? L.municipalities[code] || null : null;
}

/* A download is all or nothing.  A half-written layer draws half a map without
   saying so, which is worse than no layer: the part that is missing looks
   exactly like ground with no constraint on it. */
async function fetchLayer(kind, code, onProgress, signal) {
  const e = layerEntry(kind, code);
  if (!e) throw new Error(t('אין שכבה כזו לעירייה הזאת'));
  // Two hosts, because one CDN having a bad day should not be the end of it.
  // Both send Access-Control-Allow-Origin; the GitHub release download does
  // not, which is why these files are in the repository at all.
  const hosts = [D.layers.base, D.layers.fallback].filter(Boolean);
  let r = null, lastErr = null;
  for (const base of hosts) {
    try {
      r = await fetch(base + e.asset, { signal });
      if (r.ok) break;
      lastErr = new Error(t('ההורדה נכשלה — השרת השיב ') + r.status);
      r = null;
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      lastErr = err;
      r = null;
    }
  }
  if (!r) throw (lastErr || new Error(t('ההורדה נכשלה')));
  const total = e.bytes;
  const chunks = [];
  let got = 0;
  if (r.body && r.body.getReader) {
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (onProgress) onProgress(got, total);
    }
  } else {
    const b = new Uint8Array(await r.arrayBuffer());
    chunks.push(b); got = b.length;
    if (onProgress) onProgress(got, total);
  }
  const buf = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) { buf.set(c, at); at += c.length; }
  if (buf.length !== e.bytes)
    throw new Error(t('ההורדה נקטעה: הגיעו ') + nf(buf.length) + t(' בתים מתוך ') + nf(e.bytes));
  const sum = await sha256Hex(buf);
  if (sum !== e.sha256)
    throw new Error(t('הקובץ שהגיע אינו הקובץ שפורסם — בדיקת sha256 נכשלה. לא נשמר.'));
  await putLayerRec(layerKey(kind, code), {
    bytes: buf, sha256: sum, version: D.layers.version,
    saved: new Date().toISOString().slice(0, 10),
  });
  return buf;
}

/* Stored gzip in, GeoJSON out.  DecompressionStream is in every WebView this
   app runs on; where it is not, the layer stays undownloadable rather than
   silently absent. */
async function layerGeoJSON(kind, code) {
  const rec = await getLayerRec(layerKey(kind, code));
  if (!rec) return null;
  if (rec.version !== D.layers.version) return { stale: true };
  if (!('DecompressionStream' in window)) throw new Error(t('הדפדפן הזה אינו יודע לפרוס gzip'));
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([rec.bytes]).stream().pipeThrough(ds);
  const text = await new Response(stream).text();
  return JSON.parse(text);
}

/* ---- drawing them ----
   One municipality was a Leaflet GeoJSON layer on a canvas renderer.  The whole
   district is a different problem and needs a different answer.

   The numbers: 1,556,351 vertices, 58 MB of GeoJSON once unpacked.  Handed to
   L.geoJSON that becomes about 1.5 million LatLng objects plus the feature
   objects Leaflet keeps beside them — comfortably past 200 MB of heap, which on
   a phone is not slow, it is a crash.  So the coordinates go into Float64Array
   instead: 2 doubles a vertex, 25 MB for the district, and the parsed JSON of
   each municipality is dropped as soon as it has been copied in.

   They are stored already projected, at one fixed zoom, because projecting a
   million and a half points on every pan is the other way to lock a phone.
   Web Mercator is linear in scale, so a frame is one multiply and one subtract
   per vertex off that stored number.  The projection is Leaflet's own formula
   written out (CRS.EPSG3857 → SphericalMercator + its transformation), and a
   test holds it to map.project() rather than trusting that it is.

   Nothing here simplifies the stored line.  What the draw does is drop a vertex
   that would land within a pixel of the one before it — the same screen-space
   decimation Leaflet's smoothFactor does, at the same scale, and for the same
   reason: it is the display, not the data. */
/* Three classes on the map, and the third is a class rather than a blend:
   ground inside BOTH reserves is its own colour, named in the legend, because
   a reader has to be able to point at a patch and say which regime is on it.
   Two translucent fills stacked would give a blend that changes with whatever
   is underneath — the street background, the level's fill, the page ground —
   and a legend cannot name a colour that moves. */
const CONS_ORDER = ['ran', 'ren', 'both'];
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
/* Three classes, three hues.  The overlap is a class of its own and gets a
   colour of its own — a blend of the other two reads as "somewhere between
   them", which is the one thing ground inside BOTH reserves is not. */
const CONS_RGB = {
  ran: hex2rgb('#8a5a2b'),    // agricultural — brown
  ren: hex2rgb('#1f7a4d'),    // ecological — green
  both: hex2rgb('#8e4ea8'),   // inside both — purple
};

/* What the reader sees on the map is the colour at 40% over the map's own
   ground, so that is what the key's plate is painted: the plate is a sample of
   the map, not a brighter relative of it.  Composited here rather than written
   into the stylesheet, because the ground moves with the theme. */
function consGround() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? hex2rgb(v) : [238, 241, 245];
}
function consPlate(kind) {
  const g = consGround(), c = CONS_RGB[kind];
  return c.map((v, i) => Math.round(v * CONS_FILL + g[i] * (1 - CONS_FILL)));
}
// black or white on it, by the plate's own luminance — the plates are pale in
// the light theme and dark in the dark one, and the ink has to follow
function consInk(rgb) {
  const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  const L = .2126 * f(rgb[0]) + .7152 * f(rgb[1]) + .0722 * f(rgb[2]);
  return (L + .05) / .05 >= 1.05 / (L + .05) ? '#141b26' : '#ffffff';
}
const consShown = k => !S.consShow || S.consShow[k] !== false;
const CONS_COLOUR = {};
CONS_ORDER.forEach(k => { CONS_COLOUR[k] = rgb2hex(CONS_RGB[k]); });
const LAYER_STYLE = {
  ren: { color: CONS_COLOUR.ren, weight: 1, fillColor: CONS_COLOUR.ren },
  ran: { color: CONS_COLOUR.ran, weight: 1, fillColor: CONS_COLOUR.ran },
};
/* 40% — what was asked for. */
const CONS_FILL = .4;
const CONS_REF_Z = 14;                    // the zoom the stored projection is at
const CONS_PAD = .25;                     // drawn beyond the viewport, for panning

/* Leaflet's projection, inlined.  L.CRS.EPSG3857: SphericalMercator.project()
   followed by Transformation(0.5/(PI*R), 0.5, -0.5/(PI*R), 0.5), scaled by
   256 * 2^z. */
const CONS_R = 6378137;
const CONS_MAXLAT = 85.0511287798;
const CONS_K = .5 / (Math.PI * CONS_R);
const CONS_SCALE = 256 * Math.pow(2, CONS_REF_Z);
function consProjX(lng) { return CONS_SCALE * (CONS_K * (CONS_R * lng * Math.PI / 180) + .5); }
function consProjY(lat) {
  const la = lat > CONS_MAXLAT ? CONS_MAXLAT : lat < -CONS_MAXLAT ? -CONS_MAXLAT : lat;
  const s = Math.sin(la * Math.PI / 180);
  return CONS_SCALE * (-CONS_K * (CONS_R * Math.log((1 + s) / (1 - s)) / 2) + .5);
}

/* One municipality's polygons, flattened.  `ring` holds the vertex index each
   ring starts at, `poly` the ring index each polygon starts at, and `box` the
   projected bounding box of each polygon so that one comparison drops every
   polygon that is off the screen. */
function consChunk(gj) {
  const polys = [];
  ((gj && gj.features) || []).forEach(f => {
    const g = f && f.geometry;
    if (!g) return;
    if (g.type === 'Polygon') polys.push(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => polys.push(p));
  });
  let nv = 0, nr = 0;
  polys.forEach(rings => rings.forEach(r => { nr++; nv += r.length; }));
  const xy = new Float64Array(nv * 2);
  const ring = new Int32Array(nr + 1);
  const poly = new Int32Array(polys.length + 1);
  const box = new Float64Array(polys.length * 4);
  let vi = 0, ri = 0;
  polys.forEach((rings, pi) => {
    poly[pi] = ri;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rings.forEach(r => {
      ring[ri++] = vi;
      for (let i = 0; i < r.length; i++) {
        const x = consProjX(r[i][0]), y = consProjY(r[i][1]);
        xy[vi * 2] = x; xy[vi * 2 + 1] = y; vi++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    });
    box[pi * 4] = x0; box[pi * 4 + 1] = y0; box[pi * 4 + 2] = x1; box[pi * 4 + 3] = y1;
  });
  poly[polys.length] = ri;
  ring[nr] = vi;
  return { xy, ring, poly, box, n: polys.length, vertices: nv };
}

/* kind -> the chunks built so far, keyed by municipality so a second build
   does not redo one that is already in memory. */
const consData = { ren: new Map(), ran: new Map() };
function consVertices() {
  let n = 0;
  Object.keys(consData).forEach(k => consData[k].forEach(c => { n += c.vertices; }));
  return n;
}

const ConsLayer = L.Layer ? L.Layer.extend({
  onAdd(map) {
    const cv = this._cv = L.DomUtil.create('canvas', 'cons-cv');
    cv.style.position = 'absolute';
    cv.style.pointerEvents = 'none';
    map.getPane('nature').appendChild(cv);
    map.on('moveend zoomend resize', this._reset, this);
    if (map._zoomAnimated) map.on('zoomanim', this._zoomAnim, this);
    this._reset();
  },
  onRemove(map) {
    map.off('moveend zoomend resize', this._reset, this);
    map.off('zoomanim', this._zoomAnim, this);
    if (this._cv && this._cv.parentNode) this._cv.parentNode.removeChild(this._cv);
    this._cv = null;
  },
  redraw() { if (this._cv) this._reset(); },
  /* The canvas is one bitmap the size of the viewport plus a margin.  Leaflet
     moves the pane while a pan is in flight, so what is already drawn keeps its
     place on the ground; the margin is what stops the edge showing before the
     pan ends. */
  _zoomAnim(e) {
    if (!this._cv || !this._bounds) return;
    const map = this._map;
    const scale = map.getZoomScale(e.zoom, map.getZoom());
    const off = map._latLngBoundsToNewLayerBounds(this._bounds, e.zoom, e.center).min;
    L.DomUtil.setTransform(this._cv, off, scale);
  },
  _reset() {
    const map = this._map, cv = this._cv;
    if (!map || !cv) return;
    const size = map.getSize();
    const pad = L.point(Math.round(size.x * CONS_PAD), Math.round(size.y * CONS_PAD));
    const w = size.x + pad.x * 2, h = size.y + pad.y * 2;
    const origin = L.point(-pad.x, -pad.y);
    L.DomUtil.setTransform(cv, map.containerPointToLayerPoint(origin), 1);
    cv.width = w; cv.height = h;               // also clears it
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    this._bounds = L.latLngBounds(
      map.containerPointToLatLng(origin),
      map.containerPointToLatLng(origin.add(L.point(w, h))));
    this._paint(cv.getContext('2d'), w, h, map, origin);
  },
  _paint(ctx, w, h, map, origin) {
    // one multiply-add per vertex: the stored projection is at CONS_REF_Z, and
    // Web Mercator scales linearly with zoom
    const k = Math.pow(2, map.getZoom() - CONS_REF_Z);
    const o = map.project(map.containerPointToLatLng(origin), CONS_REF_Z);
    const ox = o.x, oy = o.y;
    /* Membership first, colour second.  REN goes into the red channel of an
       off-screen mask and RAN into the green, both fully opaque, so a pixel
       comes out red, green or yellow — in, in, or in both.  One pass then
       turns those three cases into the three colours the legend names, and the
       result is composited once at 40%.  Painting two translucent fills on top
       of each other instead would make the overlap a colour that depends on
       the ground under it, which is not a colour a legend can name. */
    const m = this._mask || (this._mask = document.createElement('canvas'));
    if (m.width !== w || m.height !== h) { m.width = w; m.height = h; }
    const mc = m.getContext('2d', { willReadFrequently: true });
    mc.globalCompositeOperation = 'source-over';
    mc.clearRect(0, 0, w, h);
    mc.globalCompositeOperation = 'lighter';
    mc.fillStyle = '#ff0000';
    consData.ren.forEach(c => this._chunk(mc, c, k, ox, oy, w, h));
    mc.fillStyle = '#00ff00';
    consData.ran.forEach(c => this._chunk(mc, c, k, ox, oy, w, h));

    /* Both channels are always painted, even when a class is switched off:
       the mask is a membership test, and "inside both" cannot be decided
       without the channel of a layer the reader has hidden.  What the switch
       drops is the pixel, after its class is known. */
    const img = mc.getImageData(0, 0, w, h);
    const d = img.data;
    const R = CONS_RGB.ren, A = CONS_RGB.ran, B = CONS_RGB.both;
    const onR = consShown('ren'), onA = consShown('ran'), onB = consShown('both');
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1];
      // the antialiased edge keeps its coverage, so the line stays a line
      const a = r > g ? r : g;
      if (!a) { d[i + 3] = 0; continue; }
      const both = r > 63 && g > 63;
      const on = both ? onB : (r > g ? onR : onA);
      if (!on) { d[i + 3] = 0; continue; }
      const c = both ? B : (r > g ? R : A);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a;
    }
    mc.globalCompositeOperation = 'source-over';
    mc.putImageData(img, 0, 0);
    ctx.globalAlpha = CONS_FILL;
    ctx.drawImage(m, 0, 0);
    ctx.globalAlpha = 1;
  },
  _chunk(ctx, c, k, ox, oy, w, h) {
    const { xy, ring, poly, box } = c;
    for (let p = 0; p < c.n; p++) {
      // off-screen in projected space, before a single vertex is touched
      const bx0 = (box[p * 4] - ox) * k, by0 = (box[p * 4 + 1] - oy) * k;
      const bx1 = (box[p * 4 + 2] - ox) * k, by1 = (box[p * 4 + 3] - oy) * k;
      if (bx1 < 0 || by1 < 0 || bx0 > w || by0 > h) continue;
      ctx.beginPath();
      for (let r = poly[p]; r < poly[p + 1]; r++) {
        const a = ring[r], b = ring[r + 1];
        let lx = 0, ly = 0, put = 0;
        for (let i = a; i < b; i++) {
          const x = (xy[i * 2] - ox) * k, y = (xy[i * 2 + 1] - oy) * k;
          // the same screen-space decimation smoothFactor does: a vertex that
          // lands inside the pixel of the one before it cannot be drawn anyway
          if (put && i !== b - 1 && Math.abs(x - lx) + Math.abs(y - ly) < 1) continue;
          if (put) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          lx = x; ly = y; put++;
        }
        if (put) ctx.closePath();
      }
      // evenodd, so a hole inside a polygon is a hole and not a second shape.
      // No stroke: the mask is a membership test, and a stroke would paint the
      // boundary into the wrong class at every edge.
      ctx.fill('evenodd');
    }
  },
}) : null;

let consLayer = null;
function applyCons() {
  if (consLayer) { map.removeLayer(consLayer); consLayer = null; }
  if (!S.cons || S.cmp) return;
  consLayer = new ConsLayer().addTo(map);
}
const munCodeOf = num => {
  const m = D.munByNum.get(num);
  return m ? m.dicofre : null;
};
const munNameOf = code => {
  const m = D.mun.find(x => x.dicofre === code);
  return m ? nmPair(m) : code;
};

/* ---- what the district needs, and what of it is here ---- */
function consEntries() {
  const out = [];
  if (!D.layers) return out;
  Object.keys(LAYER_STYLE).forEach(kind => {
    const L = D.layers.layers[kind];
    if (!L || !L.municipalities) return;
    Object.keys(L.municipalities).forEach(code =>
      out.push({ kind, code, e: L.municipalities[code] }));
  });
  return out;
}
const consMissing = () =>
  consEntries().filter(x => !(D.layerHave || {})[layerKey(x.kind, x.code)]);
const consBytes = list => list.reduce((a, x) => a + x.e.bytes, 0);
const consMB = n => (n / 1048576).toFixed(n > 1048576 ? 1 : 2);

/* Everything a reader needs before spending their data, and none of it needs
   the network: the manifest ships with the app.

   The card is per municipality and the switch is not.  What the reader gets
   from here is what THIS municipality's two layers weigh, which year and which
   law they carry, whether they are already on the phone, and a way to fetch or
   drop just this one — the display itself is a district-wide mode, because a
   constraint map that stops at a municipal line is a map that says "you may
   build here" about ground nobody looked at. */
function layerRows(num) {
  const code = munCodeOf(num);
  if (!code || !D.layers) return '';
  return Object.keys(LAYER_STYLE).map(kind => {
    const L = D.layers.layers[kind];
    const e = layerEntry(kind, code);
    const state = (D.layerHave || {})[layerKey(kind, code)];
    const title = nm({ he: L.title_he, pt: L.title_en, en: L.title_en });
    if (!e) {
      /* A row that says "no data" and offers nothing reads as a feature that
         does not work — which is exactly how it read on Porto, where BOTH
         layers are absent and the card was two dead lines. It has to say how
         many municipalities do have it, so the reader knows the layer exists
         and where to look. */
      const n = Object.keys(L.municipalities).length;
      return `<div class="row row-full"><span class="row-body">
        <span class="row-t">${html(title)}</span>
        <span class="row-m">${miss()}${t(' — DGT אינו מפרסם אותה לעירייה הזאת. הסיבה אינה מתפרסמת, ולכן אינה נאמרת כאן.')}
          ${t('היא כן מתפרסמת ל-')}<span class="num">${n}</span>${t(' מתוך 18 העיריות.')}</span>
      </span></div>`;
    }
    const size = (e.bytes / 1048576).toFixed(e.bytes > 1048576 ? 1 : 2);
    const armed = layerArmed === kind + ':' + code;
    const shown = !!S.cons && state;
    return `<button class="row row-full" aria-pressed="${shown}" data-layer="${html(kind + ':' + code)}">
      <span class="dot" style="--c:${LAYER_STYLE[kind].fillColor}"></span>
      <span class="row-body">
        <span class="row-t">${html(title)}${!state
          ? (armed ? t(' <span class="flag">להוריד? לחיצה נוספת</span>')
                   : t(' <span class="flag">לא הורדה</span>'))
          : (shown ? t(' <span class="flag">מוצגת</span>')
                   : t(' <span class="flag">שמורה במכשיר · כבויה</span>'))}</span>
        <span class="row-m"><span class="num">${size}</span> MB ·
          ${t('שנת ייחוס')} <span class="num">${html(e.reference_year)}</span> ·
          <span class="lat" dir="ltr">${html((e.law || []).join(', '))}</span></span>
      </span></button>`;
  }).join('');
}

/* Deleting a layer is a separate act with a separate word on it.  It used to
   be the second tap on the row itself, which put "show me this" and "throw
   this away" on the same button — and a reader who switched the layer off
   found it gone. */
function layerDelRows(num) {
  const code = munCodeOf(num);
  if (!code || !D.layers) return '';
  const chips = Object.keys(LAYER_STYLE).map(kind => {
    if (!(D.layerHave || {})[layerKey(kind, code)]) return '';
    const e = layerEntry(kind, code);
    const L = D.layers.layers[kind];
    const title = nm({ he: L.title_he, pt: L.title_en, en: L.title_en });
    const id = kind + ':' + code;
    const armed = layerDelArmed === id;
    const size = (e.bytes / 1048576).toFixed(e.bytes > 1048576 ? 1 : 2);
    return `<button class="chip${armed ? ' wp-arm' : ''}" type="button" data-layer-del="${html(id)}">${
      armed ? t('למחוק? לחיצה נוספת') : t('מחיקת ') + html(title) + ' · ' + size + ' MB'}</button>`;
  }).join('');
  return chips
    ? `<p class="note">${t('כיבוי התצוגה אינו מוחק כלום: השכבה נשארת במכשיר ועובדת בלי רשת. מחיקה היא פעולה נפרדת, וזאת היא:')}</p>
       <div class="chips">${chips}</div>`
    : '';
}

function layerCard(num) {
  const rows = layerRows(num);
  if (!rows) return '';
  const code = munCodeOf(num);
  const none = Object.keys(LAYER_STYLE).every(k => !layerEntry(k, code));
  const missing = consMissing();
  return `<div class="card" id="layerCard">
    <h2>${t('מגבלות בנייה')}</h2>
    <p class="sub">${t('שתי שכבות שקובעות אם והיכן מותר לבנות. הן אינן בתוך האפליקציה — הן שוקלות 21.7 מגה-בייט למחוז כולו — ולכן הן יורדות בלחיצה, פעם אחת. שום דבר לא יורד מעצמו.')}</p>
    <p class="note">${t('התצוגה היא של המחוז כולו, מהתפריט: שכבות ← מגבלות בנייה. השורות כאן אומרות מה יש לעירייה הזאת, ומאפשרות להוריד או למחוק אותה לבדה.')}</p>
    <div class="rows">${rows}</div>
    ${layerDelRows(num)}
    ${none ? `<p class="note">${t('בעירייה הזאת אין אף אחת משתי השכבות, ולכן אין כאן מה להוריד. בשאר המחוז יש: לחצו על הבית, בחרו עירייה אחרת, וגללו לכאן.')}</p>` : ''}
    ${missing.length ? `<p class="note">${t('חסרות עוד ')}<span class="num">${nf(missing.length)}</span>${t(' שכבות במחוז, ')}<span class="num">${consMB(consBytes(missing))}</span>${t(' MB. התצוגה המלאה תוריד אותן בלחיצה אחת.')}</p>` : ''}
    <p class="note">${t('המקור: Direção-Geral do Território (DGT), רישיון CC BY 4.0. הגבול נשמר בדיוק כפי ש-DGT מפרסם אותו — שכבה שאומרת ״כאן אסור לבנות״ לא מפושטת, כי פישוט מזיז את הקו. כל עירייה תוחמה בחוק משלה ובשנה משלה, ולכן אין ״שנת REN״ אחת.')}</p>
    <p class="note">${t('סכנת שריפה אינה כאן ולא תהיה עד שתימצא שנת הייחוס שלה: השדה שנראה כמו תאריך המפה הוא תאריך החוק שהורה עליה.')}</p>
  </div>`;
}

/* ---- the tap ----
   Ask, then download, then draw.  The order matters: this spends somebody's
   mobile data, so the size, the year and the law are on the row BEFORE it is
   pressed, and the first press only arms it.

   Two taps rather than confirm().  A WebView draws confirm() in the system's
   language with the system's buttons, which on a Hebrew phone set to English
   is a dialog the reader cannot read — the same reason the saved-point delete
   arms in place instead (section 7 of the architecture). */
let layerBusy = null;
let layerArmed = null;      // the "kind:code" waiting for a second press
let layerDelArmed = null;   // and the one waiting to be deleted

async function refreshLayerHave() {
  const keys = await allLayerKeys();
  D.layerHave = {};
  (keys || []).forEach(k => { D.layerHave[k] = true; });
}

async function tapLayer(id) {
  const [kind, code] = id.split(':');
  if (!layerEntry(kind, code)) return;
  layerDelArmed = null;
  // Already here: the row is a door onto the district-wide switch, and a
  // switch on something already stored costs nothing, so it does not arm.
  if ((D.layerHave || {})[layerKey(kind, code)]) {
    layerArmed = null;
    await toggleCons();
    return;
  }
  // Not here: this one spends somebody's mobile data, so the first press only
  // arms it.  One municipality, not the district — that is the menu's switch.
  if (layerArmed !== id) { layerArmed = id; redrawText(); return; }
  layerArmed = null;
  await tapLayerFetch(kind, code);
  save(); renderLayers(); redrawText();
}

/* The only thing that removes a downloaded layer. */
async function tapLayerDel(id) {
  const [kind, code] = id.split(':');
  layerArmed = null;
  if (layerDelArmed !== id) { layerDelArmed = id; redrawText(); return; }
  layerDelArmed = null;
  await delLayerRec(layerKey(kind, code));
  await refreshLayerHave();
  consData[kind].delete(code);
  // the district view cannot stand with a hole in it: ground with no layer
  // looks exactly like ground with no constraint on it
  if (S.cons) { S.cons = false; applyCons(); consRestore(); }
  save(); renderLayers(); redrawText();
}

/* The download itself, one municipality.  On success the layer is stored; the
   drawing is the district switch's business, not this one's. */
async function tapLayerFetch(kind, code) {
  const e = layerEntry(kind, code);
  if (!e) return false;
  const L = D.layers.layers[kind];
  const title = nm({ he: L.title_he, pt: L.title_en, en: L.title_en });
  if (layerBusy) { mapNote(t('הורדה אחרת עדיין רצה.'), false); return false; }

  const ctrl = new AbortController();
  layerBusy = ctrl;
  const show = (got, total) => mapNote(
    html(title) + ' · <span class="num">' + Math.round(100 * got / total) + '</span>%'
    + ' <button class="chip" type="button" data-layer-cancel="1">' + t('ביטול') + '</button>',
    false, true);
  show(0, e.bytes);
  try {
    await fetchLayer(kind, code, show, ctrl.signal);
    await refreshLayerHave();
    hideNote();
    return true;
  } catch (err) {
    if (err && err.name === 'AbortError') hideNote();
    // what failed, not that something did
    else mapNote(html(String(err.message || err)), true);
    return false;
  } finally {
    layerBusy = null;
  }
}

/* ---- the district-wide mode ----
   One switch, in the menu, under שכבות.  Turning it on brings the whole
   district: every municipality DGT publishes either layer for, the municipal
   boundaries over them so the reader can tell which is which, and the street
   background underneath — because a constraint is read against streets, and
   without them a green patch is a green patch nowhere.

   What it does turn off is the level's own colour fill.  Two flat colour
   fields on top of each other is not two readings, it is one muddy one, and
   the municipality colours carry nothing here that the boundary lines do not
   carry better. */
let consBefore = null;
function consEnter() {
  consBefore = { tiles: S.tiles, muncol: S.muncol, lnMun: S.lnMun };
  /* No street background by default.  Three flat colour classes have to be
     told apart from each other, and a photograph of roofs under them is one
     more thing competing for the same pixels.  It can still be switched on by
     hand — what cannot is the level's own colour fill, which would put a
     fourth colour field in the same place. */
  if (S.tiles) { S.tiles = false; map.removeLayer(tileLayer); }
  if (S.muncol) { S.muncol = false; redrawLevel(); }
  if (!S.lnMun) { S.lnMun = true; drawLines(); }
  // a note about the street background is stale the moment it is switched off,
  // and this page opens with it off
  hideNote();
}
function consRestore() {
  const b = consBefore;
  consBefore = null;
  if (!b) return;
  if (b.muncol && !S.muncol) { S.muncol = true; redrawLevel(); }
  if (b.tiles && !S.tiles) { S.tiles = true; tileLayer.addTo(map); }
  if (!b.lnMun && S.lnMun) { S.lnMun = false; drawLines(); }
}

/* Every layer the district has, fetched one after another, with the progress
   going to the page itself: the reader is looking at a screen that exists to
   say what is happening, and a floating note over the map would say it twice.

   A cancel stops it where it is. What came down whole is kept — it is paid
   for, and the next attempt will not fetch it again — and the page comes off,
   because a district with a hole in it is worse than no district at all. */
/* The bar moves on tenths of a percent.  fetchLayer reports every chunk, which
   for 33 files is a couple of thousand callbacks, and rebuilding the document
   on each of them spends the phone on a number that did not change. */
let consPainted = -1;
function consPaint(force) {
  if (!S.cons) return;
  const step = Math.round(consProg.pct * 10);
  if (!force && step === consPainted) return;
  consPainted = step;
  const doc = $('#doc');
  if (doc) doc.innerHTML = renderCons();
}

async function consFetchAll() {
  const miss = consMissing();
  if (!miss.length) return true;
  if (layerBusy) { mapNote(t('הורדה אחרת עדיין רצה.'), false); return false; }
  const ctrl = new AbortController();
  layerBusy = ctrl;
  const total = consBytes(miss);
  let done = 0, at = 0;
  consPhase = 'load';
  consProg = { pct: 0, at: 0, of: miss.length, mb: total };
  consPaint(true);
  try {
    for (; at < miss.length; at++) {
      const x = miss[at];
      await fetchLayer(x.kind, x.code, got => {
        consProg = { pct: 100 * (done + got) / total, at: at, of: miss.length, mb: total };
        consPaint();
      }, ctrl.signal);
      done += x.e.bytes;
    }
    await refreshLayerHave();
    return true;
  } catch (err) {
    await refreshLayerHave();
    if (!(err && err.name === 'AbortError')) mapNote(html(String(err.message || err)), true);
    return false;
  } finally {
    layerBusy = null;
  }
}

/* Unpacking is its own wait, and a long one: 58 MB of GeoJSON across 33 files.
   It is done once per run, a file at a time with the loop given back in
   between so the bar actually moves, and what comes out is the Float64Array —
   the parsed JSON of each file is dropped before the next. */
async function consLoad() {
  const all = consEntries().filter(x => (D.layerHave || {})[layerKey(x.kind, x.code)]);
  const todo = all.filter(x => !consData[x.kind].has(x.code));
  if (!todo.length) return true;
  consPhase = 'unpack';
  for (let i = 0; i < todo.length; i++) {
    const x = todo[i];
    consProg = { pct: 100 * i / todo.length, at: i, of: todo.length, mb: 0 };
    consPaint(true);
    await new Promise(r => setTimeout(r, 0));      // let the bar paint
    if (!S.cons) return false;                     // cancelled while unpacking
    let gj;
    try { gj = await layerGeoJSON(x.kind, x.code); }
    catch (e) { mapNote(html(String(e.message || e)), true); return false; }
    if (!gj || gj.stale) {
      mapNote(t('שכבה שמורה היא מגרסה קודמת. מחקו אותה והורידו מחדש.'), true);
      return false;
    }
    consData[x.kind].set(x.code, consChunk(gj));
  }
  return true;
}

function consOff() {
  S.cons = false;
  consPhase = 'off';
  if (layerBusy) { layerBusy.abort(); layerBusy = null; }
  applyCons();
  consRestore();
  save(); applySwitches(); renderLayers(); redrawText();
}

/* One tap opens the page.  The page is what says what is happening — the size,
   the bar, and a cancel — so there is no second tap to arm: the reader is
   looking straight at the thing they would otherwise have been arming.

   The whole district or none of it. A partial constraint map is worse than
   none: the municipality that did not come down looks exactly like ground with
   nothing forbidden on it. */
async function toggleCons() {
  if (S.cons) { consOff(); return; }
  S.cons = true;
  consPhase = consMissing().length ? 'load' : 'unpack';
  consProg = { pct: 0, at: 0, of: consMissing().length, mb: consBytes(consMissing()) };
  consEnter();
  applyCons();
  openMenu(false);
  if (S.view === 'map') { S.view = 'split'; applyView(); }
  /* The page opens on the district: eighteen municipalities on the map and
     eighteen names under the title. Opening it inside whichever parish the
     reader happened to be in would answer a question they had not asked yet. */
  if (S.level !== 'district') goDistrict();
  applySwitches(); renderLayers(); redrawText();

  if (consMissing().length && !await consFetchAll()) { consOff(); return; }
  if (!S.cons) return;                      // cancelled while it was running
  if (!await consLoad()) { if (S.cons) consOff(); return; }
  if (!S.cons) return;
  consPhase = 'ready';
  applyCons();
  save(); applySwitches(); renderLayers(); redrawText();
}

/* ---- the constraints page ----
   Its own screen, not a card among the others.  While it is open the reading
   half shows REN and RAN and nothing else: the population, the housing stock
   and the profile are a different question, and mixing them into a page about
   where you may build makes the reader hunt for the two numbers they came for.

   Level 1 lists the 18 municipalities, level 2 a municipality and its
   parishes, level 3 the parish.  The map underneath is the app's own map at
   the same level, so tapping a municipality on it does what tapping its name
   does. */
const CONS_HE = { ran: 'חקלאית', ren: 'אקולוגית', both: 'משותפת' };
const CONS_FULL = {
  ran: 'עתודת הקרקע החקלאית הלאומית (RAN)',
  ren: 'רשת העתודה האקולוגית הלאומית (REN)',
  both: 'בשתי השכבות — נספר פעם אחת',
};
let consPhase = 'off';        // off | load | unpack | ready
let consProg = { pct: 0, at: 0, of: 0, mb: 0 };

/* The colour index, one line above the title, and each plate is a switch: the
   class it names comes off the map and out of the bars when it is pressed.
   The plate is painted the colour the MAP shows — the class at 40% over the
   map's ground — so the key is a sample of the thing it indexes and not a
   brighter cousin of it. */
function consKeyLine() {
  return `<div class="cons-key">${CONS_ORDER.map(k => {
    const on = consShown(k);
    const rgb = consPlate(k);
    const bg = 'rgb(' + rgb.join(',') + ')';
    return `<button class="cons-k" type="button" data-conskey="${k}" aria-pressed="${on}"
      style="${on ? `background:${bg};color:${consInk(rgb)};border-color:${bg}`
                  : `border-color:${bg}`}">${html(t(CONS_HE[k]))}</button>`;
  }).join('')}</div>`;
}

/* A share of the unit, drawn as the three classes side by side: RAN alone,
   both, REN alone — the same three colours, in the same order as the key. The
   bar runs the width of the card so the filled part can be read against the
   whole, which is the only comparison it is for. */
function consBar(c) {
  if (!c || c.either_pct === undefined) return '';
  const both = c.both_pct || 0;
  const ranOnly = (c.ran_pct || 0) - both;
  const renOnly = (c.ren_pct || 0) - both;
  const seg = (v, k) => v > 0 && consShown(k)
    ? `<i style="width:${v.toFixed(2)}%;background:${CONS_COLOUR[k]}"></i>` : '';
  return `<span class="cons-bar">${seg(ranOnly, 'ran')}${seg(both, 'both')}${seg(renOnly, 'ren')}</span>`;
}

const consOf = o => (o && o.cons) || null;
// no delimitation at all — not a zero, and not a blank patch on the map
const consNone = o => !o || !o.cons || o.cons.either_pct === undefined;
/* Smallest share first, and a unit DGT publishes no delimitation for goes to
   the end — it has no share to be smallest or largest of, and dropping it in at
   zero would put "nothing is restricted here" at the head of the list. */
function consSort(rows) {
  return rows.slice().sort((a, b) => {
    const x = (consOf(a) || {}).either_pct, y = (consOf(b) || {}).either_pct;
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return x - y;
  });
}
const consSrc = () => S.level === 'district' || S.level === 'mun'
  ? 'municipio.cons_pct' : 'freguesia.cons_pct';

/* The four numbers, and the fourth is not the sum of the first two.  REN and
   RAN overlap — up to 16.2% of a municipality — so the total is the union and
   the overlap has a row of its own saying so. */
function consNumbers(o, srcKey) {
  const c = consOf(o);
  const row = (k, cls) => {
    const ha = c ? c[k + '_ha'] : undefined;
    const pc = c ? c[k + '_pct'] : undefined;
    const year = c ? c[k + '_year'] : undefined;
    const law = c ? c[k + '_law'] : undefined;
    const has = pc !== undefined && pc !== null;
    return `<button class="crow${cls ? ' ' + cls : ''}${has ? '' : ' no'}" data-src="${html(srcKey)}">
      <span class="crow-c" style="background:${k === 'either' ? 'transparent' : CONS_COLOUR[k]}"></span>
      <span class="crow-b">
        <span class="crow-l">${html(t(k === 'either' ? 'סך הכול, בקיזוז החפיפה' : CONS_FULL[k]))}</span>
        ${has ? `<span class="crow-m"><span class="num">${nf(ha, 1)}</span> ${t('הקטר')}${
          year ? ' · ' + t('שנת ייחוס') + ' <span class="num">' + html(year) + '</span>' : ''}${
          law && law.length ? ' · <span class="lat" dir="ltr">' + html(law.join(', ')) + '</span>' : ''}</span>`
        : `<span class="crow-m">${t('DGT אינו מפרסם תיחום לעירייה הזאת. הסיבה אינה מתפרסמת, ולכן אינה נאמרת כאן.')}</span>`}
      </span>
      <span class="crow-p">${has ? '<span class="num">' + nf(pc, 1) + '</span>%' : miss()}</span>
    </button>`;
  };
  return `<div class="crows">${row('ran')}${row('ren')}${row('both')}${row('either', 'crow-tot')}</div>`;
}

function consProgHtml() {
  const p = Math.max(0, Math.min(100, consProg.pct));
  const what = consPhase === 'unpack'
    ? t('פורס את השכבות. זה קורה פעם אחת, במכשיר, בלי רשת.')
    : t('מוריד את נתוני מגבלות הבנייה של מחוז פורטו. זה קורה פעם אחת — מכאן הן עובדות בלי רשת.');
  return `<p class="lead">${what}</p>
    <div class="cons-prog"><i style="width:${p.toFixed(1)}%"></i></div>
    <p class="note"><span class="num">${Math.round(p)}</span>% ·
      <span class="num">${nf(consProg.at)}</span>/<span class="num">${nf(consProg.of)}</span>
      ${t('שכבות')}${consPhase === 'load' ? ' · <span class="num">' + consMB(consProg.mb) + '</span> MB' : ''}</p>
    <div class="btns"><button class="chip" type="button" data-cons="cancel">${t('ביטול')}</button></div>`;
}

function renderCons() {
  const ready = consPhase === 'ready';
  let body = '';
  let title = t('מגבלת בנייה חקלאית ואקולוגית');
  let sub = '';

  if (!ready) {
    body = consProgHtml();
  } else if (S.level === 'district') {
    sub = t('שתי שכבות שקובעות איפה הבנייה מוגבלת בשל עתודת הקרקע החקלאית הלאומית ורשת העתודה האקולוגית הלאומית. הן חופפות זו לזו, ולכן שני השיעורים אינם מתחברים — ״סך הכול״ הוא האיחוד.');
    body = `<div class="grp">${t('18 העיריות — לפי שיעור השטח המוגבל')}</div>
      <div class="rows">${consSort(D.mun)
        .map(m => consUnitRow(m, 'mun', m.num)).join('')}</div>`;
  } else if (S.level === 'mun') {
    const m = D.munByNum.get(S.mun);
    title = nmPair(m, m.en);
    body = consNumbers(m, 'municipio.cons_pct') +
      `<div class="grp">${t('הרובעים')}</div>
       <div class="rows">${consSort(D.freByMun.get(S.mun) || [])
         .map(f => consUnitRow(f, 'fre', D.freKey(f))).join('')}</div>`;
  } else {
    const f = D.freByKey.get(S.zone);
    const m = f ? D.munByNum.get(f.mun_num) : null;
    title = f ? nmPair(f, f.en) : t('מגבלות בנייה');
    body = (f ? consNumbers(f, 'freguesia.cons_pct') : '') +
      (m ? `<div class="grp">${t('העירייה')}</div>${consNumbers(m, 'municipio.cons_pct')}` : '');
  }

  return `<div class="card" id="consCard">
    ${ready ? consKeyLine() : ''}
    <h1>${title}</h1>
    ${sub ? `<p class="sub">${sub}</p>` : ''}
    ${body}
    ${ready ? `<p class="note">${t('המקור: Direção-Geral do Território (DGT), רישיון CC BY 4.0. השטח נחתך לגבול היחידה ב-CAOP 2025, בהיטל EPSG:3763. REN ו-RAN הן הגבלות ורישוי, לא איסור בנייה מוחלט — לשתיהן מסלולי חריג בחוק (DL 166/2008, DL 73/2009).')}</p>
    <p class="note">${t('לכל עירייה תיחום משלה, חוק משלה ושנת ייחוס משלה. לחיצה על מספר פותחת את רשומת המקור המלאה.')}</p>` : ''}
  </div>`;
}

/* One municipality or one parish on the list: the name and the chevron on the
   first line, the bar across the whole width on the second, and the figure it
   stands for under it. */
function consUnitRow(o, kind, id) {
  const c = consOf(o);
  const has = c && c.either_pct !== undefined;
  const attr = kind === 'mun' ? `data-mun="${html(String(id))}"` : `data-fre="${html(id)}"`;
  return `<button class="cons-row${has ? '' : ' no'}" ${attr}>
    <span class="cons-head">
      <span class="row-t">${nmPair(o, o.en)}</span>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
    </span>
    ${has
      ? `<span class="cons-line">${consBar(c)}<span class="cons-pct"><span class="num">${
          nf(c.either_pct, 1)}</span>%</span></span>`
      : `<span class="cons-val">${miss()} — ${t('אין תיחום מפורסם')}</span>`}
  </button>`;
}

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
    el.innerHTML = t('<button class="lb-x" type="button" aria-label="סגירה">✕</button>') +
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
  catch (e) { mapNote(t('לא הצלחתי לשמור — ייתכן שהדפדפן חוסם אחסון מקומי.'), true); }
}
/* A push pin: the teardrop everyone already reads as "a place", in red, with
   its point — not its middle — on the coordinate.  The selected one grows and
   takes the highlight colour the rest of the app uses for "this is the one you
   asked about", so a card and its pin are recognisably the same object. */
function pinIcon(on) {
  // The chosen one is the same pin at a larger size — nothing else changes.  A
  // different colour or ring made it read as a different kind of place.
  const w = on ? 34 : 24, h = Math.round(w * 1.32);
  return L.divIcon({ className: 'me-pin', iconSize: [w, h], iconAnchor: [w / 2, h],
    html: `<svg viewBox="0 0 24 32" width="${w}" height="${h}" aria-hidden="true"
        style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">
        <path d="M12 31.2C12 31.2 1.6 18.6 1.6 11.4a10.4 10.4 0 1 1 20.8 0C22.4 18.6 12 31.2 12 31.2z"
              fill="${MINE_COLOUR}" stroke="#ffffff" stroke-width="1.8"/>
        <circle cx="12" cy="11.2" r="3.6" fill="#ffffff"/>
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
               : t('מחוץ למחוז פורטו')}` +
    (meta && meta.from === 'exif' ? t(' · <span class="flag">מהתמונה</span>') : '') +
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
      ? t('הנקודה מוקמה לפי הקואורדינטות של התמונה.')
      : t('בתמונה אין מיקום — הנקודה נשארה איפה שסומנה.')) +
    (bits.length ? `<br><bdi class="num">${html(bits.join(' · '))}</bdi>` : '');
}

function renderPhotoBox(msg) {
  const box = $('#minePhotoBox');
  if (!box || !mineEditing) return;
  const meta = minePending || mineEditing.photo;
  /* A button, not an input: the one file input in this app lives in index.html
     and never moves, because this box is re-rendered the moment a photo is
     picked — and on Android the picker answers the element it was opened from,
     long after that. The native control also labels itself in the browser's
     language rather than the app's, which is the other reason it is off
     screen and driven from here. */
  const input = `<button type="button" class="chip ph-pick" data-wpact="photo">${
      meta ? t('החלפת התמונה') : t('בחירת תמונות')}</button>`;
  if (!meta) {
    box.innerHTML = `<div class="chips">${input}</div>` +
      `<p class="note ph-note">${msg ? html(msg)
      : t('תמונה שצולמה במקום תמקם את הנקודה לפי הקואורדינטות שלה, במקום לפי הסימון על המפה.')}</p>`;
    return;
  }
  box.innerHTML =
    `<figure class="ph-fig"><img class="ph-img" alt="${html(mineEditing.name || t('תמונת הנקודה'))}"></figure>
     <p class="note ph-note">${photoMetaHtml(meta)}${msg ? '<br>' + html(msg) : ''}</p>
     <div class="chips">${input}<button class="chip" type="button" data-pt="rmphoto">${t('הסרת התמונה')}</button></div>`;
  const fig = box.querySelector('.ph-fig');
  const gone = () => { fig.innerHTML = t('<p class="note">התמונה אינה במכשיר הזה. ') +
    t('נקודות שיובאו כטקסט מגיעות בלי התמונות שלהן.</p>'); };
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
  // The photo way starts with no record at all — takePhoto() needs one to put
  // the picture on, so the first file makes it.  Its own coordinates place it
  // if it has any, and the form opens with the photo already on it.
  if (!mineEditing) {
    mineEditing = { id: 'p' + Date.now().toString(36), ll: defaultLL(),
                    name: '', desc: '' };
    S.wpSel = mineEditing.id;
    wpNew = false;
    renderWaypoints();
  }
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
        mapNote(`${t('נוספו')} ${rest.length} ${t('נקודות מהתמונות —')} `
          + `${placed} ${t('לפי הקואורדינטות שבתמונה,')} ${unplaced} ${t('בפינת המפה.')}`, false);
      });
  });
}

function takePhoto(file) {
  if (!file || !mineEditing) return;
  renderPhotoBox(t('קורא את התמונה…'));
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
        ? t('הנקודה הועברה לקואורדינטות של התמונה.')
        : t('בתמונה אין מיקום שמיש. ייתכן שתיוג המיקום במצלמה כבוי — ') +
          t('הנקודה נשארה במקום שסימנת.'));
      if (gps) map.setView(gps.ll, Math.max(map.getZoom(), 15));
    })
    .catch(() => {
      minePending = null;
      renderPhotoBox(t('לא הצלחתי לקרוא את התמונה. ייתכן שהיא בפורמט שהדפדפן ') +
        t('לא פותח, כמו HEIC — צילום ב-JPEG יעבוד.'));
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
  if (!S.wp && S.cmp) toggleCmp();
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
  /* Two buttons on a line and the heading under them.  חדש is at the start edge
     — the right — and רשימה sits to its left; the label on רשימה names the mode
     the next tap gives you, not the one you are in. */
  $('#doc').innerHTML = `
    <div class="card">
      <div class="wp-top">
        <button class="chip is-on" data-wpact="new">${t('חדש')}</button>
        <button class="chip" data-wpact="mode">${S.wpList ? t('מורחב') : t('רשימה')}</button>
      </div>
      <h1>${t('המקומות שלי')}</h1>
    </div>
    ${D.mine.map(p => wpCard(p)).join('')}`;
  renderWpSheet();
  wpThumbs();
  applyWpHi();
}

/* ---- the three ways a place can be started ---- */
/* They live on the new-place screen now, as a row of three at its head: the
   choice changes which fields the form asks for, and the map way shows the map
   before anything else. */
const WAYS = [
  { k: 'map',   he: 'ממפה',   why: 'גוררים סימון על המפה ולוחצים בחירה.' },
  { k: 'photo', he: 'מתמונה', why: 'הקואורדינטות של התמונה קובעות את המקום.' },
  { k: 'place', he: 'מכתובת', why: 'חיפוש בעיריות, ברובעים וביישובים שבאפליקציה.' },
];
let wpWay = null;          // which of the three the new-place screen is on
let wpNew = false;         // the new-place screen is open, with or without a way

/* Not a street geocoder — the app carries no address database and reaches no
   network.  What it can search is its own gazetteer: the eighteen
   municipalities, the 243 parishes, and the localities and named sites inside
   whichever parish they belong to.  Picking one puts the place at that record's
   own coordinate, and the form says which record it came from. */
function placePickerHtml() {
  return `<div class="wp-find">
      <input id="wpQ" type="search" inputmode="search" autocomplete="off"
             placeholder="${t('עירייה, רובע, יישוב או אתר')}" aria-label="${t('חיפוש מקום')}">
      <div id="wpQres"><p class="note">${t('שתי אותיות ומעלה. האפליקציה אינה מחפשת כתובות רחוב — אין בה מאגר כתובות ואין לה רשת.')}</p></div>
    </div>`;
}
function placeHits(term) {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return null;
  const hit = x => String(x || '').toLowerCase().includes(t);
  const out = [];
  D.mun.forEach(m => {
    if (hit(m.he) || hit(m.pt) || hit(m.dicofre)) out.push(
      { t: nm(m), s: m.pt, k: t('עירייה'), ll: latlng(m.center) });
  });
  D.fre.forEach(f => {
    if (hit(f.he) || hit(f.pt) || hit(f.dicofre)) out.push(
      { t: nm(f), s: bare(f.pt) + ' · ' + f.mun_he, k: t('רובע'),
        ll: f.center ? latlng(f.center) : null });
  });
  for (const key of Object.keys(D.zones)) {
    if (out.length > 60) break;
    const f = D.freByKey.get(key);
    if (!f) continue;
    const where = nm(f) + ' · ' + f.mun_he;
    D.zones[key].bairros.forEach(b => {
      if (b.ll && (hit(b.he) || hit(b.en))) out.push(
        { t: b.he || b.en, s: b.en + ' · ' + where, k: t(b.kind_he || 'יישוב'), ll: b.ll });
    });
    D.zones[key].pois.forEach(pp => {
      if (hit(pp.name)) out.push(
        { t: pp.name, s: poiLabel(pp.cat) + ' · ' + where, k: t('אתר'), ll: pp.ll });
    });
  }
  return out.filter(r => r.ll);
}
function runPlaceSearch(term) {
  const box = $('#wpQres');
  if (!box) return;
  const out = placeHits(term);
  if (out === null) {
    box.innerHTML = t('<p class="note">שתי אותיות ומעלה. האפליקציה אינה מחפשת ') +
      t('כתובות רחוב — אין בה מאגר כתובות ואין לה רשת.</p>');
    return;
  }
  box.innerHTML = out.length
    ? '<div class="rows">' + out.slice(0, 40).map((r, i) => `<button class="row"
        data-wpplace="${i}"><span class="row-body"><span class="row-t">${html(r.t)}</span>
        <span class="row-m"><span class="lat">${html(r.s)}</span></span></span>
        <span class="note">${html(r.k)}</span></button>`).join('') + '</div>'
    : `<p class="note">${t('אין תוצאות ל״')}${html(term)}${t('״.')}</p>`;
  wpFound = out.slice(0, 40);
}
let wpFound = [];

function wpCard(p) {
  const at = freguesiaAt(p.ll[0], p.ll[1]);
  const where = at ? nm(at) + ', ' + nm(D.munByNum.get(at.mun_num))
                   : t('מחוץ למחוז פורטו');
  const armed = wpArmed === p.id;
  const on = S.wpSel === p.id;
  /* Two shapes for the same record.  Expanded: the photo under the text it
     belongs to.  List: the same text with a thumbnail beside it, at the far
     end, so a screenful is a screenful of places and not of pictures.

     עריכה and מחיקה appear on the chosen card only.  On every card they were
     two buttons per row of a list, and the list is mostly for reading. */
  /* Rendered on every card and shown only on the chosen one.  Selection is
     applied in place — a re-render would drop the thumbnails already fetched
     and, mid-edit, whatever is half typed — so the two buttons cannot be built
     at selection time; CSS is what decides they are on screen. */
  const acts = `<div class="wp-acts">
        <button class="chip" data-wpact="edit" data-id="${html(p.id)}">${t('עריכה')}</button>
        <button class="chip${armed ? ' wp-arm' : ''}" data-wpact="del" data-id="${html(p.id)}"
          >${armed ? t('למחוק? לחיצה נוספת') : t('מחיקה')}</button>
      </div>`;
  const body = `<div class="wp-txt">
      <div class="wp-h"><span class="dot mine" style="--c:${MINE_COLOUR}"></span>
        <h2>${html(p.name)}</h2></div>
      ${p.desc ? `<p class="lead">${html(p.desc)}</p>` : ''}
      <p class="note"><bdi class="num">${p.ll[0].toFixed(5)}, ${p.ll[1].toFixed(5)}</bdi><br>
        ${html(where)}${p.at ? ' · ' + html(p.at) : ''}</p>
    </div>`;
  const fig = p.photo
    ? `<figure class="ph-fig${S.wpList ? ' ph-thumb' : ''}" data-wpimg="${html(p.id)}"
        ><img class="ph-img" alt="${html(p.name)}"></figure>` : '';
  return `<article class="card wp${on ? ' is-hi' : ''}${S.wpList ? ' wp-row' : ''}"
      data-wp="${html(p.id)}">${acts}
      ${S.wpList ? `<div class="wp-line">${body}${fig}</div>` : body + fig}
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
  if ((!mineEditing && !wpNew) || S.adding) {
    sheet.hidden = true; sheet.innerHTML = ''; return;
  }
  const p = mineEditing;
  const fresh = !p || !D.mine.some(x => x.id === p.id);
  const placed = !!p;
  sheet.hidden = false;
  /* Three ways at the head, one line of what each does, and then the fields the
     chosen way asks for.  The explanations stay after a choice — they are three
     short lines, and the one in force is the one that is not dimmed. */
  const ways = `<div class="way-row">${WAYS.map(w =>
      `<button class="chip${wpWay === w.k ? ' is-on' : ''}" data-wpway="${w.k}"
        >${html(t(w.he))}</button>`).join('')}</div>`;
  /* The lines are buttons too: the words explain the choice, so the words are
     what a finger is aimed at as readily as the chip above them. */
  const why = `<h2 class="way-hd">${t('מקור מקום חדש')}</h2>
    <div class="way-why">${WAYS.map(w =>
      `<button class="way-li${wpWay === w.k ? ' is-on' : ''}" data-wpway="${w.k}"
        ><b>${html(t(w.he))}</b> — ${html(t(w.why))}</button>`).join('')}</div>`;

  const fields = !placed ? (wpWay === 'place' ? placePickerHtml() : '') : `
      <p class="note" id="mineWhere">${mineWhereHtml()}</p>
      <label class="fld-l" for="mineName">${t('שם')}</label>
      ${t('<input id="mineName" type="text" autocomplete="off" placeholder="למשל: דירה שראיתי" value="')}${html(p.name || '')}">
      <label class="fld-l" for="mineDesc">${t('תיאור')}</label>
      <textarea id="mineDesc" rows="2"
        placeholder="${t('מה שחשוב לזכור על המקום הזה')}">${html(p.desc || '')}</textarea>
      <span class="fld-l">${t('תמונה')}</span>
      <div id="minePhotoBox"></div>
      <div class="chips"><button class="chip" data-wpact="pick">${t('בחירת מקום במפה')}</button></div>`;

  sheet.innerHTML = `
    <div class="sheet-h">
      ${fresh ? ways : t('<h2>עריכת מקום</h2>')}
      <div class="wp-acts">
        ${placed ? t('<button class="chip is-on" data-wpact="save">שמירה</button>') : ''}
        ${fresh || !p ? '' : `<button class="chip${wpArmed === p.id ? ' wp-arm' : ''}"
          data-wpact="del" data-id="${html(p.id)}"
          >${wpArmed === p.id ? t('למחוק? לחיצה נוספת') : t('מחיקה')}</button>`}
      </div>
    </div>
    <div class="sheet-b">
      ${fresh ? why : ''}
      ${fields}
    </div>`;
  sizeSheet();
  if (placed) { renderPhotoBox(); growDesc(); }
}

/* The description starts at two lines and grows with what is typed into it —
   a fixed box that scrolls inside itself hides the sentence being written. */
function growDesc() {
  const t = $('#mineDesc');
  if (!t) return;
  const fit = () => {
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, Math.round(innerHeight * 0.4)) + 'px';
  };
  t.addEventListener('input', fit);
  fit();
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
    const gone = () => { fig.innerHTML = t('<p class="note">התמונה אינה במכשיר הזה. ') +
      t('נקודות שיובאו כטקסט מגיעות בלי התמונות שלהן.</p>'); };
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
  wpNew = false; wpWay = null;
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
  return t('נקודת ציון ') + (top + 1);
}

/* חדש opens the screen with no way chosen and no record yet: a place has to
   come from somewhere before there is anything to name. */
/* The one way back, from anywhere. */
function goHome() {
  const busy = S.adding || ghost || mineEditing || wpNew || S.wp || S.cmp || S.cons;
  if (S.adding || ghost) stopPlacing();
  wpWay = null; wpNew = false;
  mineEditing = null; minePending = null; dropPhotoUrl();
  wpArmed = null;
  if (S.wp) toggleWp();
  if (S.cmp) toggleCmp();   // it puts the street background back as it was
  /* Home is the way out of a mode, not a way up inside one.  From the
     constraints page it used to do nothing at level 1 and climb to the page's
     own level 1 from below — either way the reader was still on the page they
     were trying to leave. */
  if (S.cons) consOff();
  renderWpSheet();          // toggleWp redraws the level document, not the sheet
  if (S.level !== 'district') goDistrict();
  else if (!busy) refit();
  save();
}

function openNewSheet() {
  if (!S.wp) toggleWp();
  mineEditing = null; minePending = null; dropPhotoUrl();
  wpWay = null;
  wpNew = true;
  wpArmed = null;
  renderWaypoints();
}
function closeNewSheet() {
  wpWay = null;
  wpNew = false;
  mineEditing = null; minePending = null; dropPhotoUrl();
  wpArmed = null;
  renderWaypoints();
}
/* ---- picking a file ----
   Two ways, and the app's own comes first.

   In a browser a file input is the whole story: the picker runs in the same
   process, the change event fires, and nothing can happen in between.

   On the phone it is another app in front of this one, and THIS ONE CAN BE
   DESTROYED while it is there — the WebView is holding the district's geometry
   and up to 21.7MB of outlines, and the picker is not a small program either.
   When that happens every object this page and the wrapper were holding is
   gone: the callback the WebView was going to answer through, the input the
   answer would have been delivered to, the page's own state. Android restores
   the screen and the reader sees exactly what they left, with nothing said.

   That is what the first two attempts at this bug both failed to fix, because
   both were about objects in memory. So the wrapper now writes the request and
   the answer to disk and the page COLLECTS what is waiting — on load, on being
   shown again, and when nudged. A destroyed page costs nothing: the next one
   finds the same answer. */
function pickBridge() {
  const b = window.PortoPick;
  return b && typeof b.open === 'function' && typeof b.take === 'function' ? b : null;
}

/* The one way to open the photo picker.  Clearing the value first is what lets
   the same file be chosen twice: a file input that already holds it fires no
   change event the second time, and the reader gets silence. */
function pickPhoto() {
  const b = pickBridge();
  if (b) { pickWaiting = 'photo'; b.open('photo'); return; }
  const i = $('#photoIn');
  if (!i) return;
  pickerDone();
  i.value = '';
  i.click();
}

/* The same, for the saved-points file on the import screen. */
function pickData() {
  const b = pickBridge();
  if (b) { pickWaiting = 'data'; b.open('data'); return; }
  const f = $('#dataIn');
  if (f) { f.value = ''; f.click(); }
}

/* What the wrapper left on disk, collected and acted on.  Called at startup,
   whenever the page is shown again, and when the wrapper nudges it — all three,
   because any one of them alone has a case it misses. */
let pickWaiting = null;
function drainPick() {
  const b = pickBridge();
  if (!b) return;
  let s = '';
  try { s = String(b.take() || ''); } catch (e) { s = 'err:' + (e.message || e); }
  if (!s) return;
  if (s.charAt(0) !== '{') { pickFailed(s); return; }
  let got;
  try { got = JSON.parse(s); } catch (e) { pickFailed('err:unreadable answer'); return; }
  const list = (got && got.files) || [];
  if (!list.length) { pickFailed('empty:no-files'); return; }
  pickWaiting = null;
  /* After the app was closed mid-pick it reopens wherever it left off, which
     need not be the places screen — and a photo that quietly becomes a point
     the reader cannot see is the same failure wearing different clothes. */
  if (got.kind !== 'data' && !S.wp) toggleWp();
  Promise.all(list.map(f => fetch(f.url)
      .then(r => r.ok ? r.blob() : Promise.reject(new Error('http ' + r.status)))
      .then(bl => new File([bl], f.name || 'file', { type: f.type || bl.type }))))
    .then(files => {
      if (got.kind === 'data') importPickFile(files[0]);
      else takePhotos(files);
    })
    .catch(e => pickFailed('err:' + (e.message || e)));
}

/* Whatever went wrong, named.  Silence is the one answer this is not allowed to
   give: three rounds of this bug were spent on a screen that did not change and
   did not say why. A cancel is named too — briefly, because the reader knows
   they cancelled, but not by saying nothing, because an answer that LOOKS like
   a cancel is exactly what the failure looks like. */
function pickFailed(s) {
  const kind = pickWaiting;
  pickWaiting = null;
  if (s.indexOf('cancelled:') === 0) { mapNote(t('לא נבחר קובץ.'), false); return; }
  const why = s.indexOf('lost:') === 0
    ? t('הבוחר נסגר בלי לחזור לאפליקציה. זה קורה כשאנדרואיד סוגר את האפליקציה בזמן שהבוחר פתוח; נסו שוב.')
    : s.indexOf('empty:') === 0
      ? t('הבוחר חזר בלי קובץ.')
      : t('בחירת הקובץ נכשלה.');
  mapNote(why + ' <span class="lat" dir="ltr">' + html(s) + '</span>', true);
  if (kind === 'data' && $('#impNote')) $('#impNote').textContent = why;
}
window.__portoPicked = drainPick;

/* ---- what the picker did, said out loud ----
   On a phone the picker is another app: it opens, the reader chooses a photo,
   and everything between that and this input receiving it happens where the
   page cannot see it.  When it fails, the page is left exactly as it was —
   which reads as an app that ignored the tap.  So the wrapper reports the
   outcome and this says what happened.

   Nothing is said on the good path: the form opening IS the answer.  Nothing
   is said on a cancel either, because the reader knows they cancelled. */
let pickerTimer = null;
function pickerDone() {
  if (pickerTimer) { clearTimeout(pickerTimer); pickerTimer = null; }
}
window.__portoPicker = function (what) {
  const s = String(what || '');
  pickerDone();
  if (s.indexOf('cancelled:') === 0) { mapNote(t('לא נבחר קובץ.'), false); return; }
  if (s.indexOf('ok:') !== 0) {
    mapNote(t('בוחר הקבצים לא החזיר קובץ. ') + '<span class="lat" dir="ltr">' + html(s) + '</span>', true);
    return;
  }
  /* The wrapper handed the file over and the browser has to pass it to the
     input. If that does not happen there is nothing more the page can do, but
     it can at least name the layer that swallowed it. */
  pickerTimer = setTimeout(() => {
    pickerTimer = null;
    mapNote(t('הקובץ נבחר אך לא הגיע לעמוד. ') + '<span class="lat" dir="ltr">' + html(s) + '</span>', true);
  }, 3000);
};

function pickWay(k) {
  wpWay = k;
  if (k === 'map') {
    // the map before anything else: there is nothing to fill in until a place
    // has been chosen on it.  startPlacing() is what takes the sheet down —
    // rendering it here would render it while S.adding was still false.
    toggleAdd();
    return;
  }
  renderWaypoints();
  if (k === 'photo') pickPhoto();
  if (k === 'place') { const q = $('#wpQ'); if (q) q.focus(); }
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
    mapNote(t('יש כרטיסייה בעריכה — לשמור או לבטל אותה קודם.'), true);
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
    renderPhotoBox(t('התמונה תוסר כשהנקודה תישמר.'));
    return true;
  }
  const b = e.target.closest('[data-wpact]');
  if (b) {
    const act = b.dataset.wpact;
    if (act !== 'del') wpArmed = null;
    if (act === 'new') { openNewSheet(); return true; }
    if (act === 'mode') { S.wpList = !S.wpList; save(); renderWaypoints(); return true; }
    if (act === 'edit') { startWpEdit(b.dataset.id); return true; }
    if (act === 'cancel') { closeNewSheet(); return true; }
    if (act === 'save') { commitMine(); return true; }
    if (act === 'pick') { harvestWp(); toggleAdd(); return true; }
    if (act === 'photo') { harvestWp(); pickPhoto(); return true; }
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
  const w = e.target.closest('[data-wpway]');
  if (w) { pickWay(w.dataset.wpway); return true; }
  const hit = e.target.closest('[data-wpplace]');
  if (hit) {
    const r = wpFound[Number(hit.dataset.wpplace)];
    if (r) openNewAt(r.ll, r.t);
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
  // The fields are not always on screen — placing takes the form down — and
  // harvestWp() copies what was typed into mineEditing before that happens.
  // So the record is the source, and the inputs only override it when they are
  // there to be read.
  const fld = id => { const el = $(id); return el ? el.value.trim() : null; };
  // No name is not an error: the record is worth keeping for its coordinate
  // alone, and the app names it rather than refusing to save it.
  const name = (fld('#mineName') ?? mineEditing.name ?? '').trim() || autoName();
  const desc = (fld('#mineDesc') ?? mineEditing.desc ?? '').trim();
  const rec = { ...mineEditing, name, desc,
    at: mineEditing.at || new Date().toISOString().slice(0, 10) };
  const pend = minePending;
  if (pend) rec.photo = { w: pend.w, h: pend.h, bytes: pend.bytes,
                          taken: pend.taken, from: pend.from, alt: pend.alt };
  const finish = () => {
    const i = D.mine.findIndex(x => x.id === rec.id);
    if (i < 0) D.mine.push(rec); else D.mine[i] = rec;
    saveMine();
    // back to a plain screen: no crosshair left on the map, no בחירה/ביטול over
    // it, and no way chosen — saving ends the whole business of adding one
    if (S.adding || ghost) stopPlacing();
    wpWay = null; wpNew = false;
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
      mapNote(t('הנקודה נשמרה, אבל התמונה לא: ') +
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

/* ------------------------------------------------------------- export ---
   Three things on this phone were not shipped with the app: the points the
   user marked, the photos attached to them, and the constraint layers that
   were downloaded.  An export that carries only the first is not a backup —
   a reinstall would still lose the pictures, and every layer would have to be
   fetched again over mobile data.  So all three go.

   Which is also why the export is a file and not the clipboard any more.  A
   layer is 0.3 to 3 MB gzipped and base64 makes it a third bigger again; an
   Android clipboard refuses a string of that size (the binder transaction is
   capped around a megabyte) and fails by truncating rather than by saying so.
   The clipboard is still offered for the points alone, which is what it was
   always good at: a message to yourself that survives a new phone.

   The file is JSON, so it can be read by a person and repaired by hand.  The
   binary parts are base64 inside it.  Nothing here is compressed a second
   time: the layers already are. */
const MINE_FILE_V = 1;

/* Big buffers, in the one way that does not blow the argument stack:
   String.fromCharCode.apply on a two-megabyte array throws RangeError on every
   engine, so it goes 32 KB at a time. */
const B64_CHUNK = 0x8000;
function bytesToB64(u8) {
  const a = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
  let s = '';
  for (let i = 0; i < a.length; i += B64_CHUNK)
    s += String.fromCharCode.apply(null, a.subarray(i, i + B64_CHUNK));
  return btoa(s);
}
function b64ToBytes(s) {
  const bin = atob(String(s || '').replace(/\s+/g, ''));
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

async function gatherPhotos() {
  const out = [];
  for (const p of D.mine) {
    if (!p.photo) continue;
    let blob = null;
    try { blob = await getPhoto(p.id); } catch (e) { blob = null; }
    if (!blob) continue;                      // the record says there is one and there is not
    out.push({ id: p.id, type: blob.type || 'image/jpeg',
               b64: bytesToB64(new Uint8Array(await blob.arrayBuffer())) });
  }
  return out;
}
async function gatherLayers() {
  const out = [];
  for (const k of (await allLayerKeys()) || []) {
    const rec = await getLayerRec(k);
    if (!rec || !rec.bytes) continue;
    const [kind, code] = String(k).split(':');
    out.push({ kind: kind, code: code, version: rec.version || '',
               sha256: rec.sha256 || '', saved: rec.saved || '',
               b64: bytesToB64(rec.bytes) });
  }
  return out;
}

/* What an export would weigh, said before it is made rather than after: the
   layers dominate it and the reader is the one paying for the storage. */
async function exportSizes() {
  let photos = 0, layers = 0;
  for (const p of D.mine) if (p.photo && p.photo.bytes) photos += p.photo.bytes;
  for (const k of (await allLayerKeys()) || []) {
    const rec = await getLayerRec(k);
    if (rec && rec.bytes) layers += rec.bytes.length;
  }
  return { photos: photos, layers: layers };
}

function openExport() {
  openPanel('export', t('שמירת נתונים'), `<p class="note" id="expNote">${t('סופר…')}</p>`);
  fillExport();
}
async function fillExport() {
  const nPhoto = D.mine.filter(p => p.photo).length;
  const keys = (await allLayerKeys()) || [];
  const size = await exportSizes();
  if (!panelIs('export')) return;              // it was closed while counting
  const mb = n => (n / 1048576).toFixed(n > 1048576 ? 1 : 2);
  const total = Math.round((size.photos + size.layers) * 4 / 3);   // base64 grows by a third
  const rows = [
    `<div class="row row-full"><span class="row-body"><span class="row-t">${t('מקומות')}</span>
      <span class="row-m"><span class="num">${nf(D.mine.length)}</span></span></span></div>`,
    `<div class="row row-full"><span class="row-body"><span class="row-t">${t('תמונות')}</span>
      <span class="row-m">${nPhoto ? '<span class="num">' + nf(nPhoto) + '</span> · <span class="num">'
        + mb(size.photos) + '</span> MB' : t('אין')}</span></span></div>`,
    `<div class="row row-full"><span class="row-body"><span class="row-t">${t('מגבלות בנייה שהורדו')}</span>
      <span class="row-m">${keys.length ? '<span class="num">' + nf(keys.length) + '</span> · <span class="num">'
        + mb(size.layers) + '</span> MB' : t('אין')}</span></span></div>`,
  ].join('');
  const heavy = nPhoto || keys.length;
  $('#panelBody').innerHTML = `
    <p class="note">${t('הקובץ נושא את שלושת הדברים שאינם מגיעים עם האפליקציה: המקומות שסומנו, התמונות שצורפו אליהם, ושכבות מגבלות הבנייה שהורדו. ייבוא שלו במכשיר אחר מחזיר את שלושתם.')}</p>
    <div class="rows">${rows}</div>
    <div class="btns">
      <button class="cta" id="expFile">${t('שמירה כקובץ')}${heavy ? ' · <span class="num">≈' + mb(total) + '</span> MB' : ''}</button>
      <button class="chip" id="expClip">${t('העתקת המקומות ללוח')}</button>
    </div>
    <p class="note" id="expNote">${heavy
      ? t('הלוח נושא את המקומות בלבד. תמונות ושכבות אינן נכנסות אליו — מחרוזת בגודל כזה נחתכת בדרך בלי להודיע — ולכן הן בקובץ.')
      : t('אין כאן תמונות ולא שכבות, ולכן שתי הדרכים נושאות אותו דבר.')}</p>`;
}

/* Everything that goes in the file, in one place, so that what the test packs
   is what the button packs. */
async function exportPayload() {
  return {
    portoland: MINE_FILE_V,
    app: D.version || '',
    saved: new Date().toISOString(),
    points: D.mine,
    photos: await gatherPhotos(),
    layers: await gatherLayers(),
  };
}

/* The file itself.  In a browser this is an <a download>; in the app there is
   no download manager behind the WebView, so the bytes go through a bridge
   that writes them into the app's own Download folder and answers with the
   path — which the note then shows, because a file the reader cannot find is
   not saved. */
async function exportFile() {
  const btn = $('#expFile');
  if (btn) { btn.disabled = true; btn.textContent = t('אורז…'); }
  let text;
  try {
    text = JSON.stringify(await exportPayload());
  } catch (e) {
    if ($('#expNote')) $('#expNote').textContent = t('האריזה נכשלה: ') + String(e.message || e);
    if (btn) { btn.disabled = false; }
    return;
  }
  const name = 'portoland-' + new Date().toISOString().slice(0, 10) + '.json';
  const where = await saveFile(name, text);
  closePanel();
  mapNote(where.ok
    ? t('נשמר: ') + '<span class="lat" dir="ltr">' + html(where.where || name) + '</span>'
    : t('השמירה נכשלה: ') + html(where.err || ''), !where.ok);
}

/* Two ways out, and the app one first: a WebView with no DownloadListener
   swallows an <a download> click silently, which is exactly the failure that
   looks like a broken button. */
async function saveFile(name, text) {
  const bridge = window.PortoSave;
  if (bridge && typeof bridge.save === 'function') {
    try {
      const bytes = new TextEncoder().encode(text);
      const answer = String(bridge.save(name, bytesToB64(bytes)) || '');
      if (answer.startsWith('ok:')) return { ok: true, where: answer.slice(3) };
      return { ok: false, err: answer.replace(/^err:/, '') };
    } catch (e) { return { ok: false, err: String(e.message || e) }; }
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { ok: true, where: name };
  } catch (e) { return { ok: false, err: String(e.message || e) }; }
}

/* The clipboard keeps doing the one job it does well. */
function exportMine() {
  if (!D.mine.length) { mapNote(t('אין עדיין נקודות לייצוא.')); return; }
  const text = JSON.stringify(D.mine, null, 1);
  const done = () => mapNote(nf(D.mine.length) + t(' נקודות הועתקו. אפשר להדביק אותן ') +
    t('בהודעה לעצמך, ולייבא בחזרה בכל מכשיר.'));
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

/* -------------------------------------------------------------- import ---
   Two mouths, one throat: a file picked from the phone and text pasted into
   the box both end up in importPayload(). */
function openImport(prefill) {
  openPanel('import', prefill ? t('העתקה ידנית') : t('ייבוא נתונים'), `
    <p class="note" id="impNote">${prefill
      ? t('לא הצלחתי להעתיק ללוח. אפשר לסמן את הטקסט כאן ולהעתיק ידנית.')
      : t('בחרו קובץ שנשמר קודם, או הדביקו כאן נקודות. מה שכבר קיים לא ישוכפל.')}</p>
    ${prefill ? '' : `<div class="btns"><button class="cta" id="impPick">${t('בחירת קובץ')}</button></div>`}
    <textarea id="impText" rows="7" dir="ltr" spellcheck="false">${html(prefill || '')}</textarea>
    <div class="btns"><button class="cta" id="impSave">${t('ייבוא')}</button></div>`);
}
function importPickFile(file) {
  if (!file) return;
  const note = $('#impNote');
  if (note) note.textContent = t('קורא את הקובץ…');
  const r = new FileReader();
  r.onload = () => commitImport(String(r.result || ''));
  r.onerror = () => { if ($('#impNote')) $('#impNote').textContent = t('לא הצלחתי לקרוא את הקובץ.'); };
  r.readAsText(file);
}

function commitImport(fromFile) {
  let data;
  const raw = fromFile !== undefined ? fromFile : $('#impText').value;
  try { data = JSON.parse(raw); }
  catch (e) { $('#impNote').textContent = t('זה לא טקסט תקין של נקודות.'); return; }
  // Version 0 of this format was the bare array of points, and files of it are
  // in people's messages to themselves; it still reads.
  const rows = Array.isArray(data) ? data : data && Array.isArray(data.points) ? data.points : null;
  if (!rows) { $('#impNote').textContent = t('ציפיתי לרשימה של נקודות.'); return; }
  const bag = Array.isArray(data) ? {} : data;
  importAll(rows, bag);
}

async function importAll(rows, bag) {
  const have = new Set(D.mine.map(p => p.id));
  let added = 0, skipped = 0;
  const kept = new Set();
  rows.forEach(r => {
    const ok = r && typeof r.name === 'string' && Array.isArray(r.ll)
      && r.ll.length === 2 && r.ll.every(n => typeof n === 'number' && isFinite(n));
    if (!ok) { skipped++; return; }
    const id = typeof r.id === 'string' && r.id ? r.id : 'p' + Math.random().toString(36).slice(2);
    if (have.has(id)) { skipped++; return; }
    have.add(id); kept.add(id);
    const rec = { id: id, name: r.name, desc: typeof r.desc === 'string' ? r.desc : '',
                  ll: [r.ll[0], r.ll[1]], at: typeof r.at === 'string' ? r.at : '' };
    // the photo's own record travels with the point; the bytes are restored
    // below, and a point whose bytes did not arrive loses the record too
    if (r.photo && typeof r.photo === 'object') rec.photo = r.photo;
    D.mine.push(rec);
    added++;
  });

  /* Photos, for the points that were actually added.  A picture belonging to a
     point that was already here is not written over it. */
  let photos = 0;
  for (const ph of (Array.isArray(bag.photos) ? bag.photos : [])) {
    if (!ph || !kept.has(ph.id) || typeof ph.b64 !== 'string') continue;
    try {
      await putPhoto(ph.id, new Blob([b64ToBytes(ph.b64)],
        { type: typeof ph.type === 'string' ? ph.type : 'image/jpeg' }));
      photos++;
    } catch (e) { /* the point stays; the card will say the picture is missing */ }
  }
  // a point that says it carries a photo and does not is a card that renders a
  // hole, so the claim goes when the bytes did not come
  for (const id of kept) {
    const p = D.mine.find(x => x.id === id);
    if (!p || !p.photo) continue;
    let blob = null;
    try { blob = await getPhoto(id); } catch (e) { blob = null; }
    if (!blob) delete p.photo;
  }

  /* Layers.  Nothing is trusted here: the bytes are hashed and the hash has to
     equal what THIS app's manifest publishes for that municipality.  A file
     from an older release carries older polygons, and a boundary that says
     "here you may not build" is not a thing to accept on a stranger's word. */
  let layers = 0, layersBad = 0;
  for (const L of (Array.isArray(bag.layers) ? bag.layers : [])) {
    if (!L || typeof L.b64 !== 'string') { layersBad++; continue; }
    const e = layerEntry(L.kind, L.code);
    if (!e) { layersBad++; continue; }
    if ((D.layerHave || {})[layerKey(L.kind, L.code)]) continue;   // already here
    let bytes;
    try { bytes = b64ToBytes(L.b64); } catch (err) { layersBad++; continue; }
    if (bytes.length !== e.bytes) { layersBad++; continue; }
    let sum;
    try { sum = await sha256Hex(bytes); } catch (err) { layersBad++; continue; }
    if (sum !== e.sha256) { layersBad++; continue; }
    try {
      await putLayerRec(layerKey(L.kind, L.code), {
        bytes: bytes, sha256: sum, version: D.layers.version,
        saved: typeof L.saved === 'string' ? L.saved : new Date().toISOString().slice(0, 10),
      });
      layers++;
    } catch (err) { layersBad++; }
  }
  if (layers) await refreshLayerHave();

  saveMine();
  closePanel();
  drawMine(); redrawText();
  if (layers) { renderLayers(); }

  const parts = [];
  if (added) parts.push(added === 1 ? t('מקום אחד') : nf(added) + t(' מקומות'));
  if (photos) parts.push(photos === 1 ? t('תמונה אחת') : nf(photos) + t(' תמונות'));
  if (layers) parts.push(layers === 1 ? t('שכבת מגבלות אחת') : nf(layers) + t(' שכבות מגבלות'));
  const tail = [];
  if (skipped) tail.push(skipped === 1 ? t('אחת דולגה') : nf(skipped) + t(' דולגו'));
  if (layersBad) tail.push(layersBad === 1
    ? t('שכבה אחת נדחתה — אינה תואמת את מה שהאפליקציה מפרסמת')
    : nf(layersBad) + t(' שכבות נדחו — אינן תואמות את מה שהאפליקציה מפרסמת'));
  mapNote(parts.length
    ? t('נוספו: ') + parts.join(', ') + (tail.length ? '. ' + tail.join(', ') : '') + '.'
    : (tail.length ? tail.join(', ') + '.' : t('לא נוסף דבר חדש.')), !parts.length);
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
  renderWpSheet();          // S.adding is set now, so the sheet goes down
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

  /* The constraints page is about where the ground is restricted, and a parish
     carries up to 341 landmark dots and a letter on every locality. On this
     page they are somebody else's answer on top of this one's. */
  const bare = !!S.cons;
  // Locality letters — A, B, C… at the point OSM gives for the place.
  LG.letters = L.layerGroup(!S.letters || bare ? [] : z.bairros.filter(b => b.ll).map(b => {
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
    if (!S.cats.has(p.cat) || bare) return null;
    const mk = L.circleMarker(p.ll, poiStyle(false, p.cat));
    mk.__hi = { kind: 'poi', id: i };
    mk.__cat = p.cat;
    mk.bindTooltip(`${html(p.name)}<br><span class="note">${html(poiLabel(p.cat))}</span>`,
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
        <span class="row-t">${nmPair(b, b.en)}
          ${b.ll ? '' : t('<span class="flag">אין נקודה במפה</span>')}</span>
        ${b.desc ? `<span class="row-d">${prose(b.desc)}</span>` : ''}
        <span class="row-m">${html(t(b.kind_he || ''))}${b.pop ? ' · ' + nf(b.pop) + t(' תושבים') : ''}${
          b.kind_he && b.note_src ? ' · ' : ''}${prose(b.note_src || '')}</span>
      </span></button>`).join('');

  const shown = z.pois.map((p, i) => ({ p, i })).filter(x => S.cats.has(x.p.cat));
  const byCat = new Map();
  shown.forEach(x => {
    if (!byCat.has(x.p.cat)) byCat.set(x.p.cat, []);
    byCat.get(x.p.cat).push(x);
  });
  const pois = D.poiOrder.filter(c => byCat.has(c)).map(c => `<div class="grp">${html(poiLabel(c))}
      <span class="note num">${byCat.get(c).length}</span></div>
    <div class="rows">${byCat.get(c).map(x => `<button class="row" data-hi="poi:${x.i}">
        <span class="dot" style="--c:${html(CAT_COLOUR[x.p.cat] || '#101010')}"></span>
        <span class="row-body"><span class="row-t lat">${html(x.p.name)}</span>
          <span class="row-m">${html(poiLabel(x.p.cat))} ·
            <span class="lat">${html(x.p.osm)}</span></span></span>
      </button>`).join('')}</div>`).join('');

  const chips = D.poiOrder.filter(c => z.pois.some(p => p.cat === c)).map(c =>
    `<button class="chip${S.cats.has(c) ? ' is-on' : ''}" data-cat="${html(c)}">
      <span class="chip-c" style="background:${html(CAT_COLOUR[c] || '#101010')}"></span>${html(poiLabel(c))}
      <span class="num">${z.pois.filter(p => p.cat === c).length}</span></button>`).join('');

  $('#doc').innerHTML = `
    <div class="card">
      <div class="hdr">
        <span class="pin" style="--c:${html(f.colour || '#ddd')}">${freNum(f)}</span>
        <div><h1>${html(nm(f))}</h1>
          <p class="sub lat">${html(f.en || f.pt)}</p></div>
      </div>
      <p class="sub">${html(nm(m))} · ${html(t(m.belt))}${f.dicofre
        ? t(' · קוד רשמי <span class="lat num">') + html(f.dicofre) + '</span>' : ''}</p>
      ${f.was_part_of ? `<p class="note">${wasNote(f)}${t('. הקוד והגבול שלמעלה הם של הרובע הזה, בחלוקה של 2025.')}</p>` : ''}
      ${f.census_partial ? t('<p class="note">גיל חציוני, אזרחות זרה, השכלה ואבטלה אינם מוצגים לרובע הזה: מפקד 2021 נספר לפי גבולות 2013, וחלק מהמקטעים הסטטיסטיים שלו נחצים בין שני רובעים של 2025. שיעור שהיה מחושב מהחלק שנופל בפנים הוא שיעור של רוב הרובע המוצג כשיעור שלו.</p>') : ''}
      <div class="stats">
        ${stat(t('תושבים'), f.pop2021, '', 0, 'freguesia.pop2021', 100)}
        ${stat(t('שטח'), f.area_km2, t('קמ״ר'), 1, 'freguesia.area_km2')}
        ${stat(t('צפיפות'), f.density, t('לקמ״ר'), 0, 'freguesia.density', 100)}
      </div>
      ${z.desc ? `<p class="lead">${prose(z.desc)}</p>` : ''}
      ${f.note ? `<p class="${z.desc ? 'sub' : 'lead'}">${prose(f.note)}</p>` : ''}
      ${f.note_origin === 'app'
        ? t('<p class="note">התיאור נכתב לאפליקציה ולא הועתק ממקור רשמי.</p>') : ''}
    </div>

    ${wasCard(f)}
    ${peopleStats(f, 'freguesia')}
    ${housingStats(f, 'freguesia')}
    ${marketStats(f, 'freguesia')}

    ${z.bairros.length ? `
      <div class="grp">${z.bairros.length} ${curated ? t('שכונות') : t('יישובים ושכונות')} ${t('— האותיות במפה')}</div>
      <div class="rows">${bairros}</div>
      <p class="note" style="margin-block:8px 12px">${curated
        ? t('לשכונות אין גבול רשמי. האות במפה מסומנת על נקודת השכונה כפי שהיא ב-OpenStreetMap, במרכזה בקירוב.')
        : t('היישובים האלה אינם יחידה מנהלית ואין להם גבול. הם מגיעים מ-OpenStreetMap כנקודה אחת לכל יישוב, ולכן אין להם שם עברי ואין להם תיאור — לא נכתב כזה לאף אחד מהם.')}</p>`
      : t('<p class="note">אין ביישוב הזה נקודות place ב-OpenStreetMap.</p>')}

    ${z.pois.length ? `
      <div class="card">
        <h2>${t('נקודות במפה')}</h2>
        <p class="sub">${t('כל נקודה במפה היא אתר או מוסד, בצבע הקטגוריה שלה. לחיצה על נקודה מבליטה את הרישום שלה כאן, ולחיצה על רישום מבליטה את הנקודה במפה.')}
          ${t('<b>לחיצה כפולה</b> — על הנקודה או על הרישום — פותחת אותה במפות גוגל.')}</p>
        <div class="chips">${chips}</div>
        <p class="note">${t('מקור: OpenStreetMap contributors, ODbL. המיפוי התנדבותי ואינו אחיד: היעדר נקודה אינו ראיה שאין שם דבר.')}</p>
      </div>
      ${shown.length ? pois : t('<p class="note">לא נבחרה שום קטגוריה.</p>')}`
      : t('<p class="note">לא מופו כאן אתרים או מוסדות ב-OpenStreetMap.</p>')}
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
      <h2>${t('המקומות שלי')}</h2>
    </div>
    <div class="rows">${rows.map(p => `<button class="row" data-mine="${html(p.id)}">
        <span class="dot mine" style="--c:${MINE_COLOUR}"></span>
        <span class="row-body">
          <span class="row-t">${html(p.name)}</span>
          ${p.desc ? `<span class="row-d">${prose(p.desc)}</span>` : ''}
          <span class="row-m num">${html(p.ll[0].toFixed(5))}, ${html(p.ll[1].toFixed(5))}
            ${p.at ? ' · ' + html(p.at) : ''}${p.photo ? t(' · תמונה') : ''}</span>
        </span></button>`).join('')}</div>`;
}

/* ------------------------------------------------------------ view mode --- */
/* Three states, one button: both halves, the map alone, the text alone.  On a
   phone this is the difference between reading a paragraph through a letterbox
   and reading it. */
const VIEW_HE = { split: t('חצי מפה, חצי טקסט'), map: t('מפה על כל המסך'), text: t('טקסט על כל המסך') };

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
/* Returns whether it actually flipped.  Two flat colour fields on top of each
   other is one muddy reading, not two, so the level's own fill is not offered
   while the constraint view is on — and it says so rather than being a switch
   that does nothing. */
function toggleFills() {
  if (!S.muncol && S.cons) {
    mapNote(t('ויטרז׳ העיריות אינו מוצג בתצוגת מגבלות בנייה: שני מישורי צבע זה על זה אינם שתי קריאות אלא אחת עכורה. כבו את מגבלות הבנייה תחילה.'), false);
    return false;
  }
  S.muncol = !S.muncol;
  redrawLevel();
  applySwitches(); save();
  return true;
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
  if (S.cmp) { drawCmp(); return; }
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
const BOUNDS_HE = { d: t('המחוז'), m: t('העיריות'), f: t('הרובעים') };
/* Four states cannot be a tick, so the row says which one it is in. */
function boundsOff() {
  return [['d', S.lnDistrict], ['m', S.lnMun], ['f', S.lnFre]]
    .filter(([, on]) => !on).map(([k]) => k);
}
/* What the menu row says after the name: what is still to download, or
   nothing at all once the district is here.  The price is on the control
   before it is pressed. */
function consHe() {
  if (!D.layers) return '';
  const miss = consMissing();
  return miss.length ? ' · ' + consMB(consBytes(miss)) + ' MB' : '';
}

function boundsHe() {
  const off = boundsOff();
  return off.length ? t(' · בלי ') + off.map(k => BOUNDS_HE[k]).join(', ') : t(' · הכל');
}
function paintBounds() {
  const b = $('#bordersBtn'); if (!b) return;
  const off = boundsOff();
  b.setAttribute('data-b', off.join(' '));
  b.setAttribute('aria-label', t('גבולות') + boundsHe());
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
  /* half sun, half moon: the setting is "whichever the phone is on", so the
     icon is the two of them sharing one circle rather than a third symbol */
  auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  /* a globe: the one thing on the menu that is about the words themselves */
  lang: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>',
  tiles: '<path d="M12 3 3 7.5 12 12l9-4.5L12 3zM3 12l9 4.5L21 12M3 16.5 12 21l9-4.5"/>',
  glass: '<path d="M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z" fill="currentColor" fill-opacity=".28"/><path d="M4 5h16v15H4z"/>',
  borders: '<circle cx="12" cy="12" r="9.5" stroke-width="3"/><circle cx="12" cy="12" r="6" stroke-width="2"/><circle cx="12" cy="12" r="2.75" stroke-width="1"/>',
  more: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  regions: '<path d="M3 8h8v9H3zM11 5h10v11H11z"/>',
  // a parcel with a hatched no-build patch across it
  cons: '<path d="M3.5 5h17v14h-17z"/><path d="M6 16 16 6M10 18 20 8" stroke-width="1.6" opacity=".85"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  dots: '<circle cx="7" cy="8" r="2"/><circle cx="15" cy="6" r="2"/><circle cx="18" cy="14" r="2"/><circle cx="9" cy="16" r="2"/><circle cx="5" cy="18" r="1.4"/>',
  save: '<path d="M12 3v11M8 10.5l4 3.5 4-3.5"/><path d="M4 16v3.5h16V16"/>',
  load: '<path d="M12 14V3M8 6.5 12 3l4 3.5"/><path d="M4 16v3.5h16V16"/>',
  cmp: '<path d="M4 20V11M10 20V5M16 20v-6M22 20V8"/>',
};

/* The eight point categories are the same eight the data ships, in the same
   order and under the same Hebrew names — the menu does not rename them. */
/* ==================================================== השוואת נתונים === */
/* One field at a time, across the units of one level: five colours on the map,
   a key that says what range each colour stands for, and the same units listed
   underneath from the smallest value to the largest.

   Five classes and not one shade per unit.  Eighteen steps of a single hue are
   not eighteen steps anyone can tell apart — measured, the worst neighbouring
   pair lands at ΔE 1.8, which is invisible.  Five classes hold ΔE 12.6 at their
   weakest whatever the unit count, so the map reads at a glance and the exact
   value is one line away in the list.

   The five blues were chosen by measurement, not by taste, and three things
   about them are deliberate:

     · The first step keeps its lightness and the second comes close to it; what
       that frees is handed to the three darker gaps, which widen from 11.2 to
       12.6 at their weakest.  The price is 1→2 at 6.7, and it is affordable
       only because of the next point.
     · A unit with no value is a HATCH, not a colour.  It therefore does not
       compete for the light end of the ramp, which is what made the first two
       steps able to sit close together.  It also survives colour blindness,
       greyscale and forced colours, which no fill does.
     · One hue, five lightnesses, so "darker is more" needs no key to learn —
       and lightness is the one channel colour blindness leaves alone: the
       weakest gap measures the same 10.7 with and without the red channel.

   Both ends were checked against the two grounds the app actually paints:
   ΔE 18.0 from the day ground and 14.8 from the night one.  Neither end is
   swallowed by the map behind it. */

const CMP_BLUES = ['#a1bbd9', '#82a8d3', '#4380c7', '#265b97', '#13365d'];
const CMP_BANDS = CMP_BLUES.length;
/* 1.2px diagonals 4px apart, in the same grey the map's own lines take for the
   theme.  The pattern is injected into Leaflet's own SVG once per draw. */
const CMP_HATCH = { light: '#9aa6b4', dark: '#6d7b90', w: 1.2, gap: 4 };
const CMP_PAT = 'cmp-nodata';

// Black or white on top of a swatch, by its own luminance — not by the theme.
function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const l = (.299 * (n >> 16) + .587 * ((n >> 8) & 255) + .114 * (n & 255)) / 255;
  return l > .58 ? '#12212f' : '#ffffff';
}

const CMP_HOUSING = new Set(['dwellings', 'vacant_pct', 'second_home_pct', 'owner_pct',
  'rented_pct', 'parking_pct', 'buildings', 'repair_pct', 'deep_repair_pct',
  'pre1946_pct', 'since2011_pct',
  'floors1_2_pct', 'floors3plus_pct', 'floors3_4_pct', 'floors5plus_pct',
  'only_resid_pct', 'built1_2_pct', 'built3plus_pct']);

/* The fields offered, grouped the way the cards already group them elsewhere in
   the app.  `src` is the source record the value chip opens — every number in
   this screen is clickable like every other number in the app, and cmpFields()
   drops any field whose record is missing rather than showing a number with no
   source behind it. */
const CMP_ALL = [
  { g: 'אנשים', k: 'pop2021', he: 'תושבים', unit: '', dec: 0 },
  { g: 'אנשים', k: 'pop_growth_pct', he: 'שינוי מ-2011', unit: '%', dec: 1 },
  { g: 'אנשים', k: 'density', he: 'צפיפות', unit: 'לקמ״ר', dec: 0 },
  { g: 'אנשים', k: 'median_age', he: 'גיל חציוני', unit: 'שנים', dec: 1 },
  { g: 'אנשים', k: 'ageing_index', he: 'מדד הזדקנות', unit: '', dec: 1 },
  { g: 'אנשים', k: 'pct_0_14', he: 'בני 0–14', unit: '%', dec: 1 },
  { g: 'אנשים', k: 'pct_65plus', he: 'בני 65+', unit: '%', dec: 1 },
  { g: 'אנשים', k: 'foreign_pct', he: 'אזרחות זרה', unit: '%', dec: 1 },
  { g: 'אנשים', k: 'education_pct', he: 'השכלה גבוהה — מכלל התושבים', unit: '%', dec: 1 },
  { g: 'אנשים', k: 'unemployment_pct', he: 'אבטלה', unit: '%', dec: 1 },
  /* Not in 'אנשים': the census counts people, this comes from tax returns and
     covers only what was declared. Beside the housing market is where it is
     actually read — what a household here declares, next to what a home costs. */
  { g: 'שוק הדיור', k: 'median_income', he: 'הכנסה מוצהרת (חציון)', unit: '€',
    dec: 0, only: 'municipio' },
  { g: 'שוק הדיור', k: 'price_eur_m2', he: 'מכירות', unit: '€/מ״ר', dec: 0 },
  { g: 'שוק הדיור', k: 'price_new_eur_m2', he: 'דירות חדשות', unit: '€/מ״ר', dec: 0 },
  { g: 'שוק הדיור', k: 'price_used_eur_m2', he: 'דירות קיימות', unit: '€/מ״ר', dec: 0 },
  { g: 'שוק הדיור', k: 'rent_eur_m2', he: 'שכירות', unit: '€/מ״ר', dec: 2 },
  { g: 'דיור ובניינים', k: 'dwellings', he: 'דירות', unit: '', dec: 0 },
  { g: 'דיור ובניינים', k: 'vacant_pct', he: 'דירות ריקות', unit: '%', dec: 1 },
  { g: 'דיור ובניינים', k: 'second_home_pct', he: 'בית שני', unit: '%', dec: 1 },
  { g: 'דיור ובניינים', k: 'owner_pct', he: 'בבעלות הדיירים', unit: '%', dec: 1 },
  { g: 'דיור ובניינים', k: 'rented_pct', he: 'בשכירות', unit: '%', dec: 1 },
  { g: 'דיור ובניינים', k: 'parking_pct', he: 'עם חניה', unit: '%', dec: 1 },
  { g: 'דיור ובניינים', k: 'buildings', he: 'בנייני מגורים', unit: '', dec: 0 },
  { g: 'דיור ובניינים', k: 'repair_pct', he: 'זקוקים לתיקון', unit: '%', dec: 1 },
  { g: 'דיור ובניינים', k: 'deep_repair_pct', he: 'תיקון עמוק', unit: '%', dec: 1 },
  { g: 'דיור ובניינים', k: 'pre1946_pct', he: 'נבנו לפני 1946', unit: '%', dec: 1 },
  { g: 'דיור ובניינים', k: 'since2011_pct', he: 'נבנו מ-2011', unit: '%', dec: 1 },
  /* The shape of the stock. Floors and what a building was built to hold are
     subsection counts, so they cover all 275; the finer 3-4 / 5+ split comes
     from the section file and reaches 218. */
  { g: 'צורת הבנייה', k: 'floors1_2_pct', he: 'בני קומה או שתיים', unit: '%', dec: 1 },
  { g: 'צורת הבנייה', k: 'floors3plus_pct', he: 'בני שלוש קומות ומעלה', unit: '%', dec: 1 },
  { g: 'צורת הבנייה', k: 'floors3_4_pct', he: 'בני 3–4 קומות', unit: '%', dec: 1 },
  { g: 'צורת הבנייה', k: 'floors5plus_pct', he: 'בני 5 קומות ומעלה', unit: '%', dec: 1 },
  { g: 'צורת הבנייה', k: 'only_resid_pct', he: 'למגורים בלבד', unit: '%', dec: 1 },
  { g: 'צורת הבנייה', k: 'built1_2_pct', he: 'נבנו לדירה או שתיים', unit: '%', dec: 1 },
  { g: 'צורת הבנייה', k: 'built3plus_pct', he: 'נבנו לשלוש דירות ומעלה', unit: '%', dec: 1 },
  /* Its own group: this is the one figure on the screen where a high value is
     bad, and putting it beside the housing market or the census would invite
     reading the ramp the same way in all of them. */
  { g: 'ביטחון', k: 'crimes_per_1000', he: 'עבירות רשומות', unit: 'לאלף',
    dec: 1, only: 'municipio' },
  /* REN and RAN overlap, so the two shares must never be added: 'סך הכול' is
     the union and the overlap has a field of its own saying how much of it
     there is. Four fields, and the fourth is not the sum of the first two. */
  { g: 'מגבלות בנייה', k: 'either_pct', he: 'סך המגבלות, בקיזוז החפיפה', unit: '%', dec: 1 },
  { g: 'מגבלות בנייה', k: 'ran_pct', he: 'מגבלה חקלאית (RAN)', unit: '%', dec: 1 },
  { g: 'מגבלות בנייה', k: 'ren_pct', he: 'מגבלה אקולוגית (REN)', unit: '%', dec: 1 },
  { g: 'מגבלות בנייה', k: 'both_pct', he: 'בשתי השכבות', unit: '%', dec: 1 },
  { g: 'שטח ומרחק', k: 'area_km2', he: 'שטח', unit: 'קמ״ר', dec: 1 },
  { g: 'שטח ומרחק', k: 'dist_porto_km', he: 'מרחק אווירי מפורטו', unit: 'ק״מ', dec: 1,
    only: 'municipio' },
];

/* Three places a comparable number can live on a unit: on the record itself,
   inside `housing`, or inside `cons`. The source record each maps to differs
   with it, and one table decides both so they cannot drift apart. */
const CMP_CONS = new Set(['ran_pct', 'ren_pct', 'both_pct', 'either_pct']);
const cmpSrcKey = (lvl, k) => lvl + '.' +
  (CMP_HOUSING.has(k) ? 'housing' : CMP_CONS.has(k) ? 'cons_pct' : k);
const cmpValue = (o, k) => {
  const v = CMP_HOUSING.has(k) ? (o.housing || {})[k]
          : CMP_CONS.has(k) ? (o.cons || {})[k] : o[k];
  return v === undefined ? null : v;
};

// 'municipio' when the units being compared are municipalities, 'freguesia'
// when they are parishes — the source records are keyed by that word.
function cmpLevelWord() { return cmpUnits().kind === 'mun' ? 'municipio' : 'freguesia'; }

function cmpFields() {
  const lvl = cmpLevelWord();
  return CMP_ALL.filter(f => (!f.only || f.only === lvl)
    && D.sources.fields[cmpSrcKey(lvl, f.k)]);
}
function cmpField() {
  const f = cmpFields();
  return f.find(x => x.k === S.cmpField) || f.find(x => x.k === CMP_DEFAULT) || f[0] || null;
}

/* Which units this screen is comparing.  Level 1 offers the choice between the
   eighteen municipalities and the parishes; level 2 has none to offer — there
   the parishes of the open municipality are the only thing there is to compare,
   which is why the two buttons are not drawn. */
function cmpUnits() {
  if (S.level === 'mun') {
    return { kind: 'fre', all: false, rows: (D.freByMun.get(S.mun) || []).slice() };
  }
  if (S.cmpScope === 'fre') return { kind: 'fre', all: true, rows: D.fre.slice() };
  return { kind: 'mun', all: false, rows: D.mun.slice() };
}

const cmpName = o => nm(o);
const cmpId = o => (o.mun_num === undefined ? 'm' + o.num : 'f' + D.freKey(o));

/* Smallest first, so the ranking and the list run the same way and one number
   means one thing.  The five classes hold an equal count each; a class is the
   claim the colour makes, and the key underneath prints the range it covers. */
function cmpRank(field) {
  const u = cmpUnits();
  const have = [], none = [];
  u.rows.forEach(o => {
    const v = cmpValue(o, field.k);
    (v === null ? none : have).push({ o, v });
  });
  have.sort((a, b) => a.v - b.v);
  const n = have.length;
  have.forEach((r, i) => {
    r.rank = i + 1;
    r.band = n ? Math.min(CMP_BANDS - 1, Math.floor(i * CMP_BANDS / n)) : 0;
    r.c = CMP_BLUES[r.band];
  });
  // what each colour actually covers, read off the members rather than assumed
  const bands = CMP_BLUES.map((c, b) => {
    const m = have.filter(r => r.band === b);
    return { c, n: m.length, lo: m.length ? m[0].v : null,
             hi: m.length ? m[m.length - 1].v : null };
  });
  none.sort((a, b) => cmpName(a.o).localeCompare(cmpName(b.o), 'he'));
  return { have, none, bands, n, total: u.rows.length, kind: u.kind, all: u.all };
}

/* All of them.  An earlier cut drew the ten smallest and the ten largest at
   level 1, because 243 shades of one hue is not a map anyone can read — but
   that was the continuous ramp's problem, and five classes do not have it.
   243 shapes in five colours is exactly the picture the screen is for. */
function cmpShown(rk) { return { list: rk.have, cut: 0 }; }

/* ------------------------------------------------------------ the map --- */
function cmpGeo(o) {
  if (o.mun_num === undefined) return D.munGeo.get(o.num) || null;
  return D.freGeo.get(D.freKey(o)) || null;
}

/* Leaflet writes options.fillColor straight into the fill attribute, so a
   pattern reference works — but the pattern has to exist in the same SVG.  It
   is (re)written on every draw because the theme decides its colour. */
function cmpPattern() {
  const root = document.querySelector('#map .leaflet-overlay-pane svg');
  if (!root) return;
  const old = root.querySelector('#' + CMP_PAT);
  if (old) old.parentNode.removeChild(old);
  const NS = 'http://www.w3.org/2000/svg';
  let defs = root.querySelector('defs');
  if (!defs) { defs = document.createElementNS(NS, 'defs'); root.insertBefore(defs, root.firstChild); }
  const g = CMP_HATCH.gap;
  const pat = document.createElementNS(NS, 'pattern');
  pat.setAttribute('id', CMP_PAT);
  pat.setAttribute('width', g); pat.setAttribute('height', g);
  pat.setAttribute('patternUnits', 'userSpaceOnUse');
  pat.setAttribute('patternTransform', 'rotate(45)');
  const line = document.createElementNS(NS, 'line');
  line.setAttribute('x1', 0); line.setAttribute('y1', 0);
  line.setAttribute('x2', 0); line.setAttribute('y2', g);
  line.setAttribute('stroke', CMP_HATCH[isDark() ? 'dark' : 'light']);
  line.setAttribute('stroke-width', CMP_HATCH.w);
  pat.appendChild(line);
  defs.appendChild(pat);
}

function drawCmp() {
  clearMap();
  const field = cmpField();
  const rk = field ? cmpRank(field) : null;
  const paint = new Map();
  if (rk) cmpShown(rk).list.forEach(r =>
    paint.set(cmpId(r.o), { c: r.c, rank: r.rank, v: r.v, band: r.band }));

  const parishes = S.level === 'mun' || S.cmpScope === 'fre';
  const base = S.level === 'mun' ? freFeatures(S.mun)
             : S.cmpScope === 'fre' ? D.bF : D.bM;
  const unitOf = ft => S.level === 'mun'
    ? freOfFeature(S.mun, ft.properties)
    : S.cmpScope === 'fre'
      ? D.freByKey.get(ft.properties.mun_num + '|' + ft.properties.name)
      : D.munByNum.get(ft.properties.num);
  // a unit with no value is hatched, never given an end of the scale
  const fillOf = o => {
    const p = o && paint.get(cmpId(o));
    return p ? p.c : 'url(#' + CMP_PAT + ')';
  };

  LG.mun = L.geoJSON(base, {
    style: ft => ({ weight: 0, opacity: .9, fillColor: fillOf(unitOf(ft)), fillOpacity: 1 }),
    onEachFeature: (ft, l) => {
      const o = unitOf(ft);
      if (!o) return;
      const p = paint.get(cmpId(o));
      l.on('click', () => {
        // a municipality opens — that is how level 2 is reached from here; a
        // parish does not descend, because level 3 is not part of this screen
        if (parishes) { cmpFocus(cmpId(o)); return; }
        goMun(o.num);
      });
      l.bindTooltip(`<b>${html(cmpName(o))}</b><br>${
        field ? (p ? `${html(t(field.he))}: <b>${html(nf(p.v, field.dec))}</b> ${html(t(field.unit))}`
                   : html(t(field.he)) + ': ' + miss())
              : `<span class="lat">${html(o.pt)}</span>`}`,
        { sticky: true, className: 'tt' });
    },
  }).addTo(map);

  drawLines();
  cmpPattern();

  /* The labels are the app's own: the official DICOFRE code, as on every other
     map here.  The colour says which fifth the unit is in and the list says the
     number — the label has no third job to do. */
  /* At level 1 with the parishes chosen there are 243 shapes: a number on each
     is not a map.  The labels there name the eighteen municipalities that hold
     them, which is what tells you where you are looking. */
  const rows = S.level === 'mun' ? (D.freByMun.get(S.mun) || []) : D.mun;
  LG.labels = L.layerGroup(rows.map(o => {
    const code = o.mun_num === undefined ? munCode(o) : freNum(o);
    const mk = L.marker(latlng(o.center), { icon: cmpIcon(code), keyboard: false,
      title: cmpCode(code) + ' · ' + cmpName(o), riseOnHover: true });
    mk.on('click', () => {
      if (S.level === 'mun') { cmpFocus(cmpId(o)); return; }
      goMun(o.num);
    });
    return mk;
  })).addTo(map);

  fit(LG.mun.getBounds());
}

function cmpFocus(id) {
  const el = $(`#doc [data-cmpu="${CSS.escape(id)}"]`);
  if (!el) return;
  $$('#doc .cmp-row.is-hi').forEach(e => e.classList.remove('is-hi'));
  el.classList.add('is-hi');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ----------------------------------------------------------- the text --- */
const cmpFmt = (v, f) => v === null || v === undefined ? miss() : nf(v, f.dec);

function cmpRowHtml(r, field, lvl, rk) {
  const ink = inkOn(r.c);
  const mun = r.o.mun_num === undefined;
  const code = mun ? munCode(r.o) : freNum(r.o);
  return `<div class="cmp-row" data-cmpu="${html(cmpId(r.o))}"${
      mun ? ` data-mun="${r.o.num}"` : ''}>
    <span class="cmp-sw" style="background:${r.c};color:${ink}">${html(cmpCode(code))}</span>
    <span class="cmp-body">
      <span class="cmp-n">${html(cmpName(r.o))}
        <span class="lat">${html(bare(r.o.pt))}</span></span>
    </span>
    <button class="cmp-v" data-src="${html(cmpSrcKey(lvl, field.k))}">
      <span class="num">${html(cmpFmt(r.v, field))}</span>${
      field.unit ? ' <span class="cmp-u">' + html(t(field.unit)) + '</span>' : ''}
    </button>${mun ? '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>' : ''}
  </div>`;
}

function renderCmp() {
  const lvl = cmpLevelWord();
  const field = cmpField();
  const atDistrict = S.level !== 'mun';
  const m = S.level === 'mun' ? D.munByNum.get(S.mun) : null;

  /* The field picker replaces the key and the list; it is the one screen that
     does, because choosing a field is the only thing you are doing while it is
     open. */
  if (S.cmpPick) {
    const fields = cmpFields();
    const groups = [...new Set(fields.map(f => f.g))].map(g => `
      <div class="grp">${html(t(g))}</div>
      <div class="cmp-fields">${fields.filter(f => f.g === g).map(f => {
        const rows = cmpUnits().rows;
        const n = rows.filter(o => cmpValue(o, f.k) !== null).length;
        return `<button class="cmp-f${n < rows.length ? ' part' : ''}" data-cmpf="${html(f.k)}">
          <span class="cmp-f-t">${html(t(f.he))}</span>
          <span class="cmp-f-u">${html(f.unit ? t(f.unit) : '—')}</span>
          <span class="cmp-f-c num">${n}/${rows.length}</span>
        </button>`;
      }).join('')}</div>`).join('');
    return `<div class="cmp-top">
        <h1 class="cmp-h">${t('החלפת נתון')}</h1>
        <button class="cmp-swap" data-cmppick="0">${t('חזרה')}</button>
      </div>
      <p class="note cmp-note">${t('המספר על הכרטיסייה הוא כמה יחידות יש להן ערך בשדה הזה. ביתר יוצג ׳אין נתון׳, והן לא ידורגו.')}</p>
      ${groups}`;
  }

  const rk = cmpRank(field);
  const sh = cmpShown(rk);

  const scope = atDistrict ? `
    <div class="cmp-scope" role="group" aria-label="${t('מה להשוות')}">
      <button class="cmp-sc" data-cmpscope="mun"
        aria-pressed="${S.cmpScope !== 'fre'}">${t('עיריות')}</button>
      <button class="cmp-sc" data-cmpscope="fre"
        aria-pressed="${S.cmpScope === 'fre'}">${t('רובעים')}</button>
    </div>` : '<div class="cmp-scope"></div>';

  /* The key: five colours, and the range of the field each of them covers.
     The ranges are read off the units themselves, so the key can never claim
     a band the data does not have. */
  const key = `<div class="cmp-key">${rk.bands.map(b => b.n ? `
      <div class="cmp-k">
        <span class="cmp-k-sw" style="background:${b.c}"></span>
        <span class="cmp-k-r"><span class="num">${html(cmpFmt(b.lo, field))}</span>${
          b.lo === b.hi ? '' : ' – <span class="num">' + html(cmpFmt(b.hi, field)) + '</span>'}</span>
        <span class="cmp-k-n">${b.n}</span>
      </div>` : '').join('')}
    ${rk.none.length ? `<div class="cmp-k">
        <span class="cmp-k-sw cmp-k-nd"></span>
        <span class="cmp-k-r">${miss()}</span>
        <span class="cmp-k-n">${rk.none.length}</span>
      </div>` : ''}
    </div>`;

  const list = `<div class="cmp-rows">${sh.list
    .map(r => cmpRowHtml(r, field, lvl, rk)).join('')}</div>`;

  const none = rk.none.length ? `
    <div class="grp">${nf(rk.none.length)} ${t('בלי נתון — לא מדורגים')}</div>
    <div class="cmp-rows">${rk.none.map(r => {
      const mun = r.o.mun_num === undefined;
      return `<div class="cmp-row no" data-cmpu="${html(cmpId(r.o))}"${
          mun ? ` data-mun="${r.o.num}"` : ''}>
        <span class="cmp-sw cmp-sw-nd">${html(cmpCode(mun ? munCode(r.o) : freNum(r.o)))}</span>
        <span class="cmp-body"><span class="cmp-n">${html(cmpName(r.o))}
          <span class="lat">${html(bare(r.o.pt))}</span></span></span>
        <button class="cmp-v" data-src="${html(cmpSrcKey(lvl, field.k))}">${miss()}</button>
      </div>`;
    }).join('')}</div>
    <p class="note">${t('ערך חסר אינו מקום אחרון. היחידות האלה אינן מדורגות, אינן צבועות ואינן נספרות — במפה הן מפוספסות.')}</p>` : '';

  return `<div class="cmp-top">
      ${scope}
      <button class="cmp-swap" data-cmppick="1">${t('החלפת נתון')}</button>
    </div>
    <h1 class="cmp-h">${html(t(field.he))}${
      field.unit ? ' <span class="cmp-u">' + html(t(field.unit)) + '</span>' : ''}</h1>
    <p class="cmp-what">${atDistrict
      ? (S.cmpScope === 'fre'
         ? t('243 רובעי המחוז')
         : t('18 עיריות המחוז'))
      : `${html((D.freByMun.get(S.mun) || []).length)} ${t('הרובעים של')} ${html(nm(m))}`
        + t(' — ברמה הזאת אין מה לבחור, ולכן אין כאן שני הכפתורים')}
      ${t('· מהקטן לגדול')}</p>
    ${key}
    ${list}
    ${none}
    <p class="note">${t('הצבע מייצג את החמישון ולא את גודל הערך, כדי שכל קבוצה תיקרא במבט אחד; הערך המדויק בשורה. המספרים על המפה הם קודי DICOFRE, כמו בכל מסך אחר. אין כאן צד ״טוב״ ואין צד ״רע״ — רק קטן וגדול.')}</p>`;
}

/* The screen.  The street background comes off while it is open and goes back
   as it was on the way out: what is being compared is the data, and a
   photograph of roads underneath it is noise. */
const CMP_DEFAULT = 'area_km2';
function toggleCmp() {
  if (S.adding) stopPlacing();
  S.cmp = !S.cmp;
  if (S.cmp) {
    if (S.wp) { S.wp = false; S.wpSel = null; }
    if (S.level === 'zone') { S.level = 'mun'; S.zone = null; S.hi = null; }
    if (S.view === 'map') { S.view = 'split'; applyView(); }
    S.cmpScope = 'mun';
    S.cmpField = S.cmpField || CMP_DEFAULT;
    S.cmpPick = false;
    cmpTilesWere = S.tiles;
    if (S.tiles) { S.tiles = false; map.removeLayer(tileLayer); }
    /* The rivers are geography, and this screen is not showing geography: a
       blue line crossing a blue fill is read as part of the scale.  Off with
       the streets, and back with them if they were on. */
    cmpWaterWere = S.water;
    if (S.water) { S.water = false; applyNature(); }
    if (S.level !== 'district') goDistrict();
  } else {
    S.cmpPick = false;
    if (cmpTilesWere && !S.tiles) { S.tiles = true; tileLayer.addTo(map); }
    if (cmpWaterWere && !S.water) { S.water = true; applyNature(); }
  }
  // The comparison screen is a chart drawn on a map outline; a second colour
  // field on it is the same muddy reading the level fill would be.
  applyCons();
  closePanel();
  applySwitches();
  redrawLevel(); drawMine(); redrawText();
  if (S.cmp) $('#paneText').scrollTop = 0;
  save();
}
let cmpTilesWere = true;
let cmpWaterWere = false;

function cmpClick(e) {
  const pick = e.target.closest('[data-cmppick]');
  if (pick) {
    S.cmpPick = pick.dataset.cmppick === '1';
    redrawText(); $('#paneText').scrollTop = 0;
    return true;
  }
  const f = e.target.closest('[data-cmpf]');
  if (f) {
    S.cmpField = f.dataset.cmpf;
    S.cmpPick = false;
    redrawLevel(); redrawText();
    $('#paneText').scrollTop = 0;
    return true;
  }
  const sc = e.target.closest('[data-cmpscope]');
  if (sc) {
    S.cmpScope = sc.dataset.cmpscope;
    redrawLevel(); redrawText();
    return true;
  }
  // a municipality row opens it, exactly as a tap on the map does
  const mn = e.target.closest('.cmp-row[data-mun]');
  if (mn && S.level !== 'mun') { goMun(Number(mn.dataset.mun)); return true; }
  return false;
}

const menuRows = () => [
  { k: 'search', he: t('חיפוש'), icon: 'search', kind: 'act' },
  { k: 'mine', he: t('המקומות שלי'), icon: 'pin', kind: 'act' },
  { k: 'locate', he: t('המיקום שלי'), icon: 'locate', kind: 'act', mapOnly: true },
  /* The eight categories under one heading that switches them together, with a
     chevron beside it that opens the list so each can be set on its own.  Eight
     rows at the top of the menu were eight-ninths of what you scrolled past to
     reach anything else. */
  { k: 'cats', he: t('נקודות ציון'), icon: 'dots', kind: 'tog', more: 'cats-open' },
  ...(S.catsOpen
    ? D.poiOrder.map(c => ({ k: 'cat:' + c, he: poiLabel(c), icon: c, kind: 'tog', sub: true }))
    : []),
  // Below the eight, not between the heading and them: the expanded categories
  // have to follow their own heading with nothing in between or they stop
  // reading as belonging to it.
  { k: 'cmp', he: t('השוואת נתונים'), icon: 'cmp', kind: 'tog' },
  { grp: t('תצוגה') },
  { k: 'view:split', he: t('גרפיקה וטקסט'), icon: 'split', kind: 'radio' },
  { k: 'view:map', he: t('גרפיקה בלבד'), icon: 'maponly', kind: 'radio' },
  { k: 'view:text', he: t('טקסט בלבד'), icon: 'textonly', kind: 'radio' },
  /* Three, not two.  `auto` is the value the app opens on and the only one that
     follows the phone, but with only light and dark on the list there was no way
     back to it: the first choice was permanent.  A set of mutually exclusive
     options is shown whole with the one in force marked — Material 3 puts this
     as a Do/Don't ("switches control binary options, not opposing ones") and
     Apple's segmented control says the same.  So the menu keeps naming all three
     rather than offering only the one you are not in: the label on a control
     must not change with its state, or a screen reader cannot tell whether the
     word it reads is what the control IS or what it WILL DO. */
  { k: 'theme:auto', he: t('תצוגה לפי המכשיר'), icon: 'auto', kind: 'radio' },
  { k: 'theme:light', he: t('תצוגת יום'), icon: 'day', kind: 'radio' },
  { k: 'theme:dark', he: t('תצוגת לילה'), icon: 'night', kind: 'radio' },
  /* Its own heading, and both languages always named.  A control's label must
     not change with its state — the same rule that keeps all three themes on
     the list — so this is not a single row that says "English" while you are
     reading Hebrew. */
  { grp: t('שפה') },
  { k: 'lang:he', he: t('עברית'), icon: 'lang', kind: 'radio' },
  { k: 'lang:en', he: 'English', icon: 'lang', kind: 'radio' },
  { grp: t('שכבות') },
  { k: 'tiles', he: t('מפת רקע'), icon: 'tiles', kind: 'tog' },
  { k: 'glass', he: t('ויטרז׳ מפות'), icon: 'glass', kind: 'tog' },
  /* The district's constraint view, above the boundaries because that is what
     it draws them over.  The row carries what is still to download, so the
     price is on it before it is pressed. */
  { k: 'cons', he: t('מגבלות בנייה') + consHe(), icon: 'cons', kind: 'tog' },
  // Not on the list that was asked for, and kept anyway: the three-ring cycle
  // was designed row by row two versions ago, and the full panel is the only
  // way to נהרות, אותיות and one border kind at a time.  Dropping a control
  // because a later list did not repeat it is how a feature disappears.
  { k: 'borders', he: t('גבולות') + boundsHe(), icon: 'borders', kind: 'act' },
  { k: 'more', he: t('עוד שכבות'), icon: 'more', kind: 'act' },
  { grp: '' },
  { k: 'regions', he: t('אזורים'), icon: 'regions', kind: 'tog' },
  { grp: t('נתונים') },
  // The points the user marked, and only those — everything else in the app
  // ships with it and needs no saving.  Both were reachable only from inside
  // the נ.צ. screen before.
  { k: 'save', he: t('שמירת נתונים'), icon: 'save', kind: 'act' },
  { k: 'load', he: t('ייבוא נתונים'), icon: 'load', kind: 'act' },
  { grp: '' },
  { k: 'info', he: t('מידע'), icon: 'info', kind: 'act' },
];

// what a row's mark should read, or null when the row carries no state
function menuState(k) {
  if (k === 'cats') return S.cats.size > 0;
  if (k.startsWith('cat:')) return S.cats.has(k.slice(4));
  if (k.startsWith('view:')) return S.view === k.slice(5);
  /* The mark is on the setting that is in force, not on the theme it resolves
     to: "auto" is a choice of its own, and marking light while auto is set
     would say the user had picked light. */
  if (k.startsWith('theme:')) return (S.theme || 'auto') === k.slice(6);
  if (k.startsWith('lang:')) return (S.lang || 'he') === k.slice(5);
  if (k === 'tiles') return S.tiles;
  if (k === 'glass') return S.muncol;
  if (k === 'cons') return S.cons;
  if (k === 'regions') return S.lnRegion;
  if (k === 'locate') return !!meWatch;
  if (k === 'mine') return S.wp;
  if (k === 'cmp') return S.cmp;
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
        <span class="mrow-l">${html(t(r.he))}</span>
        <span class="mrow-k" aria-hidden="true">${r.kind === 'radio' ? '●' : '✓'}</span>
      </button>`;
    if (!r.more) return row;
    // the heading switches all eight; the chevron beside it opens the list
    return `<div class="mrow-pair">${row}
        <button class="mrow-more" data-m="${html(r.more)}"
                aria-expanded="${!!S.catsOpen}${t('" aria-label="פירוט נקודות הציון">')}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </button>
      </div>`;
  }).join('') + (S.level === 'zone' ? '' :
    t('<p class="mnote">הנקודות עצמן מצוירות ברמת הרובע; הבחירה כאן נשמרת וחלה שם.</p>'));
}

function openMenu(on) {
  S.menu = on;
  $('#menu').hidden = !on;
  $('#menuBtn').setAttribute('aria-expanded', String(on));
  if (on) { renderMenu(); $('#menu').scrollTop = 0; }
}

function menuTap() { openMenu(!S.menu); }

/* Day and night are a choice the user makes, not only what the phone is set to.
   'auto' follows the phone, and it is a row of its own on the menu — without it
   the first choice was final, because nothing offered the way back. */
function themeAttr() {
  const r = document.documentElement;
  if (S.theme === 'auto') delete r.dataset.theme; else r.dataset.theme = S.theme;
}
// At boot the attribute is all there is to do — nothing is drawn yet.  After
// that the colours the level picked have to be picked again.
function applyTheme() {
  themeAttr();
  if (!map) return;
  // The comparison ramp has a light set and a dark set, so the list beside the
  // map has to be written again too, not only the shapes on it.
  redrawLevel(); drawMine(); if (S.cmp) redrawText(); else applyHi();
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
  if (k.startsWith('lang:')) {
    S.lang = k.slice(5);
    applyLang();
    /* Everything on screen is written in the language, including the map's own
       labels and the text half, so all of it is drawn again. The menu stays
       open: the effect is visible on the menu itself. */
    /* Everything already on screen was written in the old language, including
       the trail, the notice above the text and the map's own labels. */
    save(); afterNav(); redrawLevel(); drawMine(); redrawText(); renderMenu();
    const n = lastNote;
    hideNote();
    if (n) mapNote(n.redraw(), n.bad, true, n.redraw);
    return;
  }
  switch (k) {
    case 'search':  openMenu(false); openSearch(); break;
    case 'mine':    openMenu(false); toggleWp(); break;
    case 'cmp':     openMenu(false); toggleCmp(); break;
    case 'locate':  openMenu(false); toggleLocate(); break;
    case 'tiles':   toggleTiles(); renderMenu(); break;
    case 'glass':   toggleFills(); renderMenu(); break;
    case 'cons':    toggleCons(); break;
    case 'borders': cycleBounds(); renderMenu(); break;
    case 'more':    openMenu(false); toggleLayers(true); break;
    case 'regions': toggleRegions(); renderMenu(); break;
    case 'save':    openMenu(false); openExport(); break;
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

  let h = t('<h3>שכבות</h3>') +
    row(S.tiles, 'tiles', t('רקע המפה (רחובות)'), 'linear-gradient(135deg,#cfd9e6,#eef1f5)', true) +
    row(S.muncol, 'muncol', t('צבעי 18 העיריות'), 'linear-gradient(135deg,#F9C784,#9CC7E8)', true) +
    row(S.water, 'water', t('נהרות ומים'), '#4a9ad4', true) +
    row(S.mine, 'mine', t('המקומות שלי'), MINE_COLOUR, true, D.mine.length) +
    (S.wp ? t('<p class="note">בזמן ניהול המקומות מוצגים כולם, והשכבה הזאת ') +
            t('חוזרת לפעול ביציאה ממנו.</p>') : '');

  /* One row, and it is the district's.  A constraint layer that stops at a
     municipal line is a map that says "you may build here" about ground nobody
     looked at, so the switch brings the whole district or nothing — which is
     why the row carries what the rest of it still weighs. */
  if (!S.cmp && D.layers) {
    const miss = consMissing();
    h += t('<h3>מגבלות בנייה</h3>') +
      row(!!S.cons, 'lay:cons',
          t('מגבלות בנייה במחוז') + (miss.length
            ? ' · ' + consMB(consBytes(miss)) + ' MB'
            : ''),
          LAYER_STYLE.ren.fillColor, true) +
      t('<p class="note" style="margin-block-start:6px">הרשת האקולוגית הלאומית ועתודת הקרקע החקלאית, לכל 18 העיריות, בשקיפות של 40% מעל מפת הרקע ומתחת לגבולות העיריות. ההפעלה הראשונה מורידה אותן פעם אחת ומכאן הן עובדות בלי רשת; כיבוי אינו מוחק אותן. ויטרז׳ העיריות אינו מוצג בתצוגה הזאת — שני מישורי צבע זה על זה אינם שתי קריאות אלא אחת עכורה.</p>');
  }

  // Which of these are black and which are grey is the level's decision, not
  // the user's; the switch is only whether the line is there at all.
  h += t('<h3>קווי גבול</h3>') +
    ['region', 'district', 'mun', 'fre'].map(k =>
      row(S[LINE_ON[k]], 'ln:' + k, t(LINE_HE[k]), lineColour(k), true)).join('') +
    t('<p class="note" style="margin-block-start:6px">הקווים ששייכים למה שעל ') +
    t('המסך מוצגים בשחור, והשאר באפור. קו האזורים ') +
    t('אפור תמיד.</p>');
  // the letters only exist at level 3, and they are neighbourhoods in Porto and
  // localities everywhere else — the row says which, and counts them like the
  // other rows do
  if (z) {
    h += row(S.letters, 'letters',
      z.origin === 'pdf' ? t('אותיות השכונות') : t('אותיות היישובים'),
      '#cfe0f2', true, z.bairros.filter(b => b.ll).length);
  }
  if (z && z.pois.length) {
    h += t('<h3>נקודות במפה</h3>') + D.poiOrder.filter(c => counts[c])
      .map(c => row(S.cats.has(c), 'cat:' + c, poiLabel(c), CAT_COLOUR[c], false, counts[c]))
      .join('');
  } else {
    h += t('<p class="note" style="margin-block-start:8px">קטגוריות הנקודות נבחרות ברמת הרובע.</p>');
  }
  if (panelIs('layers')) $('#panelBody').innerHTML = h;
  return h;
}
function toggleLayers(force) {
  const show = force === undefined ? !panelIs('layers') : force;
  if (show) openPanel('layers', t('שכבות המפה'), renderLayers());
  else closePanel();
}

// after a change that alters what the text half should say
function redrawText() {
  // management replaces the level document: the map is still at its level and
  // still navigable, but the text half is the list of נ.צ. until it is closed
  if (S.cmp) { $('#doc').innerHTML = renderCmp(); return; }
  if (S.wp) { renderWaypoints(); return; }
  /* The constraints page replaces the level document rather than adding a card
     to it: it is a screen about one question, and the population and the
     housing stock are a different one. */
  if (S.cons) { $('#doc').innerHTML = renderCons(); $('#paneText').scrollTop = 0; return; }
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

/* While the places screen is up the map is for looking at and for the pins.
   A tap on a municipality or a parish would take you off the screen you are
   working on, so navigation is off — panning and zooming are not. */
/* --------------------------------------------------------- highlighting --- */
// One record is "picked" at a time, and both halves show it: the row gets a
// frame and scrolls into view, the shape or dot on the map gets a heavy ring.
function pick(hi, from) {
  if (S.adding || S.wp) return;               // the tap is placing a point, not choosing one
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
  if (S.adding || S.wp) return;
  if (S.cmp) { cmpFocus('f' + D.freKey(f)); return; }
  if (isSecondTap('fre:' + D.freKey(f))) { openInGoogle(latlng(f.center), nm(f)); return; }
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
  redrawLevel(); redrawText(); afterNav();
}
function goMun(num) {
  S.level = 'mun'; S.mun = num; S.zone = null; S.hi = null;
  redrawLevel(); redrawText(); afterNav();
}
function goZone(key) {
  const f = D.freByKey.get(key);
  if (!f) return;
  // Level 3 is not part of the comparison screen; asking for it leaves it.
  if (S.cmp) toggleCmp();
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
  /* Where you came from, not where you are.  The page under it already carries
     the name of the unit being looked at, in a heading, in full — and the trail
     repeating it in an ellipsis spent both of its lines saying one thing. So it
     names the levels ABOVE this one: the district at level 2, the district and
     the municipality at level 3, and at level 1 the district itself, because
     there is nothing above it to name.  Every line is a way back. */
  const c = [];
  if (S.level === 'district') {
    c.push(t('<span class="now">מחוז פורטו</span>'));
  } else if (S.level === 'mun') {
    c.push(t('<button class="now" data-go="district">מחוז פורטו</button>'));
  } else {
    c.push(t('<button data-go="district">מחוז פורטו</button>'));
    c.push('<button class="now" data-go="mun">' +
           html(nm(D.munByNum.get(S.mun))) + '</button>');
  }
  const crumb = $('#crumb');
  crumb.innerHTML = c.join('');
  crumb.classList.toggle('one', c.length === 1);
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
      letters: S.letters, mine: S.mine, water: S.water, cons: S.cons,
      consShow: S.consShow, rev: PREF_REV,
      lang: S.lang,
      muncol: S.muncol, wpList: S.wpList,
      lnRegion: S.lnRegion, lnDistrict: S.lnDistrict,
      lnMun: S.lnMun, lnFre: S.lnFre,
      tiles: S.tiles,
    }));
  } catch (e) { /* private mode */ }
}
/* A default that changes still has to reach a phone that already has the app.
   The old value is sitting in localStorage, and restore() would put it back —
   so changing a default in the code alone changes nothing for the only person
   using it.  Bumping PREF_REV drops the switches named here once, after which
   the user's own choice sticks again. */
const PREF_REV = 1;
const DEFAULT_RESET = ['water'];

function restore() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    const fresh = k => !((o.rev | 0) < PREF_REV && DEFAULT_RESET.indexOf(k) >= 0);
    if (typeof o.tiles === 'boolean') S.tiles = o.tiles;
    if (typeof o.letters === 'boolean') S.letters = o.letters;
    if (typeof o.mine === 'boolean') S.mine = o.mine;
    ['lnRegion', 'lnDistrict', 'lnMun', 'lnFre'].forEach(k => {
      if (typeof o[k] === 'boolean') S[k] = o[k];
    });
    if (o.lang === 'he' || o.lang === 'en') S.lang = o.lang;
    if (typeof o.water === 'boolean' && fresh('water')) S.water = o.water;
    if (typeof o.cons === 'boolean') S.cons = o.cons;
    if (o.consShow && typeof o.consShow === 'object')
      CONS_ORDER.forEach(k => { if (typeof o.consShow[k] === 'boolean') S.consShow[k] = o.consShow[k]; });
    if (typeof o.muncol === 'boolean') S.muncol = o.muncol;
    if (typeof o.wpList === 'boolean') S.wpList = o.wpList;
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
  openPanel('search', t('חיפוש'), `
    <input id="q" type="search" inputmode="search" autocomplete="off" enterkeyhint="search"
           placeholder="${t('עירייה, רובע, יישוב או אתר')}" aria-label="${t('חיפוש')}">
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
    $('#qres').innerHTML = t('<p class="note">שתי אותיות ומעלה — בעברית, פורטוגזית או אנגלית.</p>');
    return;
  }
  const hit = s => String(s || '').toLowerCase().includes(t);
  const out = [];
  D.mun.forEach(m => {
    if (hit(m.he) || hit(m.pt) || hit(m.en) || hit(m.dicofre)) out.push({
      t: munCode(m) + ' · ' + m.he, s: m.pt, k: t('עירייה'), go: `data-jump="mun:${m.num}"` });
  });
  D.fre.forEach(f => {
    // the official code is searchable too: it is what appears on a form
    if (hit(f.he) || hit(f.pt) || hit(f.dicofre)) out.push({
      t: (f.he || f.pt), s: bare(f.pt) + ' · ' + f.mun_he
        + (f.dicofre ? ' · ' + f.dicofre : ''),
      k: f.mun_num === 1 ? t('רובע בפורטו') : t('רובע'),
      go: `data-jump="zone:${html(D.freKey(f))}"` });
  });
  // 1,773 localities and 1,530 dots across the district; stop once the list is
  // long enough rather than walk all of them for every keystroke
  const CAP = 60;
  for (const key of Object.keys(D.zones)) {
    if (out.length > CAP) break;
    const f = D.freByKey.get(key);
    if (!f) continue;
    const where = nm(f) + ' · ' + f.mun_he;
    const z = D.zones[key];
    z.bairros.forEach(b => {
      if (hit(b.he) || hit(b.en)) out.push({
        t: b.letter + ' · ' + (b.he || b.en), s: b.en + ' · ' + where,
        k: t(b.kind_he || 'שכונה'), go: `data-jump="bairro:${html(key)}:${html(b.letter)}"` });
    });
    z.pois.forEach((p, i) => {
      if (hit(p.name)) out.push({
        t: p.name, s: poiLabel(p.cat) + ' · ' + where,
        k: t('נקודה'), go: `data-jump="poi:${html(key)}:${i}"` });
    });
  }

  const box = $('#qres');
  if (!box) return;
  box.innerHTML = out.length
    ? '<div class="rows">' + out.slice(0, 60).map(r => `<button class="row" ${r.go}>
        <span class="row-body"><span class="row-t">${html(r.t)}</span>
          <span class="row-m"><span class="lat">${html(r.s)}</span></span></span>
        <span class="note">${html(r.k)}</span></button>`).join('') + '</div>' +
      (out.length > 60 ? `<p class="note" style="margin-block-start:8px">${out.length} ${t('תוצאות, מוצגות 60.')}</p>` : '')
    : `<p class="note">${t('אין תוצאות ל״')}${html(term)}${t('״.')}</p>`;
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
  openPanel('source', t(f.label_he || key), `
    ${exact ? `<p>${t('הערך המדויק:')} <b class="num">${html(exact)}</b>
      <span class="note">${t('— המספר במסך מעוגל כדי להיקרא, וזה מה שהמקור מפרסם.')}</span></p>` : ''}
    <p class="note"><code>${html(key)}</code></p>
    ${f.reference_year ? `<p>${t('שנת ייחוס:')} <b class="num">${prose(String(f.reference_year))}</b></p>` : ''}
    <p>${t('מקור:')} ${prose(f.source || (f.derived_from || []).join(' / '))}</p>
    ${f.coverage ? `<p class="note">${t('כיסוי:')} ${prose(f.coverage)}</p>` : ''}
    ${f.validation_he ? `<p class="note">${t('בדיקה:')} ${prose(f.validation_he)}</p>` : ''}
    ${f.caveat_he ? `<div class="warn">${prose(f.caveat_he)}</div>` : ''}
    ${f.url ? `<p><a href="${html(f.url)}" target="_blank" rel="noopener">${html(f.url)}</a></p>` : ''}`);
}

function renderInfo() {
  const s = D.sources;
  const fields = Object.entries(s.fields).map(([k, f]) => `<div class="card">
      <h3>${html(t(f.label_he || k))}</h3>
      <p class="note"><code>${html(k)}</code></p>
      ${f.reference_year ? `<p>${t('שנת ייחוס:')} <b class="num">${prose(String(f.reference_year))}</b></p>` : ''}
      <p>${t('מקור:')} ${prose(f.source || (f.derived_from || []).join(' / '))}</p>
      ${f.coverage ? `<p class="note">${t('כיסוי:')} ${prose(f.coverage)}</p>` : ''}
      ${f.definitions_he ? `<dl class="kv">${Object.entries(f.definitions_he).map(
        ([term, v]) => `<div><dt>${html(t(term))}</dt><dd class="note">${prose(v)}</dd></div>`).join('')}</dl>` : ''}
      ${f.validation_he ? `<p class="note">${t('בדיקה:')} ${prose(f.validation_he)}</p>` : ''}
      ${f.caveat_he ? `<div class="warn">${prose(f.caveat_he)}</div>` : ''}
      ${f.url ? `<p><a href="${html(f.url)}" target="_blank" rel="noopener">${html(f.url)}</a></p>` : ''}
    </div>`).join('');

  const miss = s.missing.items.map(m => `<div class="card">
      <h3>${html(t(m.label_he))}</h3>
      <p class="note"><code>${prose(m.field)}</code></p>
      <p>${prose(m.why_he)}</p>
      ${m.important_he ? `<div class="warn">${prose(m.important_he)}</div>` : ''}
      ${m.decision_he ? `<p>${prose(m.decision_he)}</p>` : ''}
      ${(m.candidate_sources || []).map(u =>
        `<p class="note"><a href="${html(u)}" target="_blank" rel="noopener">${html(u)}</a></p>`).join('')}
    </div>`).join('');

  $('#infoBody').innerHTML = `
    <h2>${t('איך קוראים את המספרים')}</h2>
    <p>${t('לכל יחידה מנהלית בפורטוגל יש קוד רשמי אחד,')} <b>DICOFRE</b>${t(', והוא בנוי בשכבות. מחוז פורטו הוא')} <span class="num">13</span>${t('; שתי הספרות שאחריו הן העירייה, ושתיים נוספות הן הרובע:')}</p>
    <pre>${t('13 12 02 ▔▔ ▔▔ ▔▔ │  │  └── רובע  (Bonfim) │  └───── עירייה (פורטו) └──────── מחוז  (פורטו)')}</pre>
    <p>${t('המספר שמופיע על כל עירייה במפה הוא')} <b>${t('שתי הספרות הרשמיות שלה')}</b> ${t('— פורטו היא')} <span class="num">12</span>${t(', אמרנטה')} <span class="num">01</span>${t(', טרופה')} <span class="num">18</span>${t('. זה הקוד שמופיע בטפסים, במסמכי מקרקעין ובטבלאות רשמיות, ואפשר להשתמש בו מול כל גורם בפורטוגל.')}</p>
    <p>${t('המספר שעל כל רובע הוא באותו אופן')} <b>${t('שתי הספרות הרשמיות שלו')}</b> ${t('בתוך העירייה, ובכרטיס של כל רובע מופיע גם הקוד המלא בן שש הספרות. הקודים מגיעים מיחידות שמסומנות ב-OpenStreetMap עם')} <span class="lat">ref:ine</span>
      ${t('ועם')} <span class="lat">source=DGT — CAOP</span>${t(', כלומר הם הקוד שהמדינה מפרסמת ולא מספור של האפליקציה.')}</p>
    <p>${t('הספרות אינן רצות 01, 02, 03 בלי דילוגים, וזה תקין: הרשימה נקבעה לפי סדר האלף-בית הפורטוגלי, וכשרובע חדל להתקיים הקוד שלו לא מוחזר לשימוש ולא מחולק מחדש. יחידה שנוצרה מאיחוד או מפיצול קיבלה מספר חדש שנוסף בסוף הרשימה של אותה עירייה — ולכן עירייה יכולה להציג 02 ליד 44.')}</p>
    <p><b>${t('רפורמת 2025.')}</b> ${t('חלק מהאיחודים של 2013 בוטלו, ורובעים שאוחדו חזרו להיות יחידות נפרדות עם קודים חדשים. במחוז פורטו זה נוגע ל-25 מ-243 היחידות שהאפליקציה מציירת: הן פורקו ל-57 רובעים חדשים, והקוד של היחידה המאוחדת בוטל. הגבולות והנתונים כאן הם CAOP 2020 — כלומר המפה של 2013 — ולכן ל-25 האלה מוצג')} <span class="flag">${t('פורק ב-2025')}</span> ${t('במקום קוד, ובכרטיס של כל אחת מהן רשומים בשמם ובקודם הרובעים שהחליפו אותה. 218 הרובעים האחרים לא נגעו ברפורמה והקוד שמוצג להם הוא הקוד הרשמי המלא והתקף.')}</p>
    <p class="note">${t('כדי שהאפליקציה תציג את 275 הרובעים של 2025 עצמם — ולא את חלוקת 2020 עם הערה — צריך את שכבת הגבולות CAOP במהדורה 2024 או 2025. אין לי אותה כאן, וכל נתוני האוכלוסייה שיש לי הם ממפקד 2021 שנספר לפי חלוקת 2013, כך שפיצול היחידות היום היה משאיר 57 רובעים בלי מספר תושבים.')}</p>

    <h2>${t('מי מודד ומי סופר')}</h2>
    <p>${t('שני גופים שונים עומדים מאחורי כל מספר כאן, ותפקידם שונה לגמרי.')}</p>
    <div class="card">
      <h3>INE — <span class="lat">Instituto Nacional de Estatística</span></h3>
      <p>${t('הלשכה המרכזית לסטטיסטיקה של פורטוגל. אחראית על כל הסטטיסטיקה הרשמית, והמוצר המרכזי שלה כאן הוא')} <b>Censos</b> ${t('— מפקד האוכלוסין שנערך כל עשר שנים.')} <b>${t('כל נתוני האוכלוסייה באפליקציה הם ממפקד 2021.')}</b></p>
      <p class="note">${t('INE נותן את')} <b>${t('המספרים')}</b>.</p>
    </div>
    <div class="card">
      <h3>CAOP — <span class="lat">Carta Administrativa Oficial de Portugal</span></h3>
      <p>${t('מפת הגבולות המנהליים הרשמית, שמפרסמת')} <b>DGT</b>
        (<span class="lat">Direção-Geral do Território</span>${t(') — לא INE. היא קובעת איפה בדיוק עובר כל גבול. ממנה מגיעות כל הצורות על המפה, וכל שטח בקמ״ר שמוצג כאן חושב מהפוליגונים עצמם ולא נלקח מטבלה.')}</p>
      <p class="note">${t('CAOP נותן את')} <b>${t('הצורות')}</b>${t('. קוד DICOFRE הוא מה שמחבר ביניהם — אותו מזהה בשני המקורות, ולכן אפשר לצרף מספר לגבול בלי לנחש.')}</p>
    </div>

    <h2>${t('NUTS III — החלוקה הרשמית של המחוז')}</h2>
    <p><b>NUTS</b> ${t('הוא תקן אירופי לחלוקת שטח לצורך סטטיסטיקה והקצאת תקציבים. בפורטוגל יש שלוש רמות; הרמה שבפועל משמשת היא')} <b>NUTS III</b>${t(', ובה 25 יחידות. מה שמייחד אותה בפורטוגל: כל יחידה היא גם')} <b>${t('גוף אמיתי')}</b> ${t('— אזור מטרופוליני או התאגדות בין-עירונית עם מועצה ותקציב.')}</p>
    <p><b>${t('18 העיריות שבאפליקציה מתחלקות בין שתי יחידות כאלה:')}</b></p>
    <div class="card">
      <h3><span class="lat">Área Metropolitana do Porto</span> (AMP)</h3>
      <p>${t('11 מהעיריות כאן: פורטו, וילה נובה דה גאיה, מטוזיניוש, מאיה, גונדומאר, ולונגו, וילה דו קונדה, פובואה דה וארזים, סנטו טירסו, טרופה ופארדש. (ל-AMP שייכות עוד שש עיריות ממחוז אָבֵיירו.)')}</p>
      <p>${t('זהו מטרופולין אחד לכל דבר:')} <b>${t('רשות תחבורה משותפת')}</b> ${t('— המטרו, כרטיס')}
        <span class="lat">Andante</span> ${t('ותעריפי האזורים — ושוק עבודה אחד. כאן חיים כ-1.44 מיליון מתושבי המחוז.')}</p>
    </div>
    <div class="card">
      <h3><span class="lat">Tâmega e Sousa</span></h3>
      <p>${t('7 מהעיריות כאן: פנאפיאל, פאסוש דה פריירה, לוזאדה, פלגיירש, אמרנטה, מרקו דה קנבזש ובאיאו. (ליחידה שייכות עוד ארבע עיריות ממחוזות אחרים.)')}</p>
      <p>${t('כלכלה נפרדת — רהיטים, נעליים וטקסטיל —')} <b>${t('מחוץ למערכת התחבורה המטרופולינית')}</b>${t(', עם מחירי נדל״ן נמוכים משמעותית ואוכלוסייה מתכווצת. כאן חיים כ-348 אלף תושבים.')}</p>
    </div>
    <p class="note">${t('להבדל הזה יש משמעות מעשית: הוא קובע אם עירייה נמצאת בתוך מערכת הכרטוס והמטרו של פורטו, לאן מגיעים כספי הפיתוח האירופיים, ובאיזו יחידה INE מפרסם נתונים. זו גם החלוקה שמסך המחוז מצייר — עד גרסה 1.8 הוא צייר שלוש חגורות לפי מרחק ואופי, שהיו קריאה של המסמך המקורי ולא חלוקה רשמית.')}</p>

    <h2>${t('מה יש כאן')}</h2>
    <p>${t('המסך מחולק לשניים: מפה בחצי אחד, וכל הידע שנוגע למה שרואים בה בחצי השני. הקו שביניהם נגרר, המפה נגררת ומתקרבת בתוך החלון שלה, והטקסט נגלל בלי הגבלה.')}</p>
    <ul>
      <li>${t('18 עיריות · 243 רובעים · 7 רבעי פורטו · 53 שכונות ·')}
        <span class="num">${D.totPoi}</span> ${t('נקודות במפה')}</li>
      <li>${t('אוכלוסיית 2021, שטח וצפיפות לכל 18 העיריות ולכל 243 הרובעים')}</li>
      <li>${t('מפקד 2021 לכל יחידה: גיל חציוני, פילוח גיל, אזרחות זרה, ואחת-עשרה שורות של דיור ובניינים — דירות ריקות, בעלות מול שכירות, חניה, מצב הבניינים ותקופת הבנייה')}</li>
      <li>${t('נבנה:')} <span class="lat">${html(D.generated)}</span></li>
    </ul>
    <p class="note">${t('מספרי העיריות והרובעים הם קודי DICOFRE הרשמיים. האותיות של השכונות והיישובים הן של האפליקציה: הן נועדו לקשור בין המפה לרשימה, ואין להן קיום מחוץ לאפליקציה.')}</p>
    ${STANDALONE
      ? `<p class="note">${t('זהו קובץ בודד ועצמאי — כל הנתונים בתוכו והוא עובד בלי רשת ובלי שרת. המסמך המקורי ‎(PDF)‎ נמצא במאגר, ב-')}<span class="lat">porto/data/raw/</span>.</p>`
      : `<p><a href="data/raw/porto_district_map_a3.pdf" target="_blank" rel="noopener">${t('פתיחת המסמך המקורי (PDF, 19 עמודים)')}</a></p>`}

    <h2>${t('מה עוד חסר')}</h2>
    <p>${prose(s.missing.note_he)}</p>
    ${miss}

    <h2>${t('מקור לכל שדה')}</h2>
    ${fields}

    <h2>${t('גרסה')}</h2>
    <p>${t('פורטולנד')} <span class="lat num">${html(D.version)}</span> ${t('· הנתונים נבנו ב-')}<span class="lat">${html(D.generated)}</span></p>

    <h2>${t('רישוי וייחוס')}</h2>
    ${s.license_notices.map(n => `<p>${prose(n)}</p>`).join('')}
    <p class="note">${t('לחיצה כפולה על כל דבר שיש לו קואורדינטה פותחת אותו במפות גוגל — קישור עם נ״צ בלבד, בלי מפתח ובלי לשמור דבר, ולכן בלי להפר את תנאי השימוש של גוגל שאוסרים לאחסן או להציג את הנתונים שלהם מחוץ למפה שלהם.')}</p>
    <p class="note">${t('האפליקציה עובדת גם בלי רשת. בלי חיבור אריחי הרקע לא ייטענו, המפה תוצג כגבולות בלבד, וכל הנתונים והטקסטים זמינים במלואם.')}</p>

    <h2>${t('נקודות הציון שלכם')}</h2>
    <p>${t('הן נשמרות')} <b>${t('במכשיר הזה בלבד')}</b>${t('. לא נשלחות לשום מקום ולא מגובות.')}</p>
    <p>${t('לחיצה על כרטיסייה מדגישה את הנקודה שלה במפה, ולחיצה על נקודה במפה פותחת את הכרטיסייה שלה. לחיצה כפולה על נקודה פותחת אותה במפות גוגל.')}</p>
    <p>${t('בבחירת תמונה אפשר לסמן כמה תמונות בבת אחת. הראשונה נכנסת לכרטיסייה הפתוחה, וכל אחת מהשאר הופכת לנקודה משלה. תמונה שיש בה קואורדינטות נוחתת עליהן; תמונה שאין בה נוחתת בפינה השמאלית העליונה של המפה — מקום שאפשר לראות ולגרור ממנו, ולא טענה על היכן היא צולמה.')}</p>
    <p>${t('בסימון נ.צ. על המפה: גוררים את הסימון למקום, ולחיצה כפולה עליו קובעת אותו.')}</p>
    <p class="note">${t('שמירת נתונים כותבת קובץ אחד שנושא את שלושת הדברים שאינם מגיעים עם האפליקציה: המקומות, התמונות שעליהם, ושכבות מגבלות הבנייה שהורדו. ייבוא הקובץ במכשיר אחר מחזיר את שלושתם. ההעתקה ללוח נושאת את המקומות בלבד — מחרוזת שכוללת תמונות או שכבות נחתכת בדרך — ולכן היא מוצעת לצידו ולא במקומו.')}</p>`;
}

/* ------------------------------------------------------------------ wire --- */
function wire() {
  // Home is live on every screen, and it is also the way out of one: it drops
  // whatever is half done — a place being placed, a form being filled, the
  // places screen itself — and comes back to the district.  There is no cancel
  // button anywhere any more; this is it.
  $('#homeBtn').addEventListener('click', goHome);
  $('#menuBtn').addEventListener('click', menuTap);
  $('#menuClose').addEventListener('click', () => openMenu(false));
  $('#menuIn').addEventListener('click', e => {
    const r = e.target.closest('[data-m]');
    if (r) menuPick(r.dataset.m);
  });
  $('#panelClose').addEventListener('click', closePanel);
  $('#panelBody').addEventListener('click', e => {
    if (panelIs('search')) { panelSearchClick(e); return; }
    if (panelIs('export')) {
      if (e.target.closest('#expFile')) exportFile();
      else if (e.target.closest('#expClip')) { closePanel(); exportMine(); }
      return;
    }
    if (panelIs('import')) {
      if (e.target.closest('#impSave')) commitImport();
      // the input itself is in index.html and never moves; this is the button
      // in front of it
      else if (e.target.closest('#impPick')) pickData();
      return;
    }
    const b = e.target.closest('[data-lay]');
    if (!b) return;
    const k = b.dataset.lay;
    /* A constraint layer. Switching it on fetches it first if it is not here
       yet, which is why this one branch is asynchronous and returns early:
       everything below assumes the switch has already flipped. */
    if (k === 'lay:cons') { toggleCons(); return; }
    if (k === 'tiles') {
      S.tiles = !S.tiles;
      if (S.tiles) tileLayer.addTo(map); else map.removeLayer(tileLayer);
    }
    else if (k === 'letters') { S.letters = !S.letters; }
    else if (k === 'water') { S.water = !S.water; applyNature(); }
    else if (k === 'muncol') { if (!toggleFills()) return; }
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
  /* Both file inputs are in index.html and are never re-rendered, so these two
     listeners are bound once to the element the picker will actually answer.
     They used to be delegated onto panels whose innerHTML is rebuilt, which is
     a listener that works until the moment it matters. */
  $('#photoIn').addEventListener('change', e => {
    pickerDone();
    const files = e.target.files;
    if (files && files.length) takePhotos(files);
    e.target.value = '';
  });
  $('#dataIn').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) importPickFile(f);
    e.target.value = '';
  });
  /* Three triggers, and each covers a case the others miss: the nudge is the
     fast path when the page survived; pageshow catches a page restored from the
     back-forward cache; visibility catches the app coming back to the front
     after the wrapper answered while it was away — which is the case that was
     silent, because it is the one where the page that asked no longer exists. */
  window.addEventListener('pageshow', drainPick);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) drainPick();
  });
  $('#wpSheet').addEventListener('input', e => {
    if (e.target.id === 'wpQ') runPlaceSearch(e.target.value);
  });
  $('#wpSheet').addEventListener('click', e => { wpClick(e); });
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
    if (e.target.closest('[data-layer-cancel]')) {
      if (layerBusy) layerBusy.abort();
      return;
    }
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
    if (S.cmp && cmpClick(e)) return;
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
      if (act.dataset.mineAct === 'export') openExport(); else openImport('');
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
    const layDel = e.target.closest('[data-layer-del]');
    if (layDel) { tapLayerDel(layDel.dataset.layerDel); return; }
    const ckey = e.target.closest('[data-conskey]');
    if (ckey) {
      const k = ckey.dataset.conskey;
      S.consShow[k] = !consShown(k);
      if (consLayer) consLayer.redraw();
      save(); redrawText();
      return;
    }
    const cons = e.target.closest('[data-cons]');
    if (cons) { if (cons.dataset.cons === 'cancel') consOff(); return; }
    const lay = e.target.closest('[data-layer]');
    if (lay) { tapLayer(lay.dataset.layer); return; }
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
    b.querySelector('p').textContent = t('טעינת הנתונים נכשלה: ') + err.message +
      t(' — יש להריץ את האפליקציה משרת (למשל python3 -m http.server), לא כקובץ מקומי.');
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
  applyLang();
  themeAttr();
  applySwitches();
  initMap();
  initNature();
  wire();
  watchOrientation();

  if (S.level === 'zone' && D.freByKey.has(S.zone)) goZone(S.zone);
  else if (S.level === 'mun' && D.munByNum.has(S.mun)) goMun(S.mun);
  else goDistrict();

  /* Last, because a photo collected here is drawn into the level document and
     onto the map, and neither exists until the three lines above have run. */
  drainPick();

  $('#boot').remove();

  /* What is already on the phone, read before anything claims otherwise.
     Without this every stored layer reads as "not downloaded" on a fresh
     start, and the menu row offers to buy again what is already paid for. */
  refreshLayerHave().then(async () => {
    renderMenu(); redrawText();
    if (!S.cons) return;
    /* It was on when the app was last closed. Nothing downloads by itself, so
       a district that is no longer complete simply comes back off. */
    if (consMissing().length) { S.cons = false; save(); renderMenu(); redrawText(); return; }
    if (await consLoad()) {
      /* No `before` to restore to: what the app reopened on IS the state the
         reader last saw, and inventing a previous one would put back a switch
         they never set. */
      consBefore = null;
      if (S.muncol) { S.muncol = false; redrawLevel(); }
      applyCons();
    } else S.cons = false;
    save(); applySwitches(); renderLayers(); redrawText();
  });

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

/* ------------------------------------------------------------- the English ---
   Keyed by the Hebrew, which is the source language: the code above reads as
   Hebrew and this is the only place that knows there is a second language.

   A key that is missing here falls back to its Hebrew, on purpose — see t().
   scripts/checks.py compares this table against every t() call in the file, so
   a new Hebrew string cannot quietly reach an English reader untranslated. */
Object.assign(EN, {
  'השכלה גבוהה — מכלל התושבים': 'Higher education — of all residents',
  '<h3>מגבלות בנייה</h3>': '<h3>Building constraints</h3>',
  'צורת הבנייה': 'The shape of the stock',
  'בני קומה או שתיים': 'One or two floors',
  'בני שלוש קומות ומעלה': 'Three floors or more',
  'בני 3–4 קומות': 'Three or four floors',
  'בני 5 קומות ומעלה': 'Five floors or more',
  'למגורים בלבד': 'Residential only',
  'נבנו לדירה או שתיים': 'Built for one or two dwellings',
  'נבנו לשלוש דירות ומעלה': 'Built for three or more',
  'תיקון עמוק': 'Deep repair',
  '׳זקוקים לתיקון׳ כולל אצל INE גם תיקונים קלים, ולכן האחוז גבוה כמעט בכל מקום; ׳תיקון עמוק׳ הוא זה שמעיד על מצב הבניין. **שני השיעורים הם מתוך כלל בנייני המגורים** — ׳תיקון עמוק׳ אינו אחוז מתוך ׳זקוקים לתיקון׳.': 'INE\'s \'needing repair\' includes minor repairs, which is why the share is high almost everywhere; \'deep repair\' is the one that says something about a building\'s condition. **Both are shares of all residential buildings** — \'deep repair\' is not a percentage of \'needing repair\'.',
  'כל השיעורים כאן הם מתוך בנייני המגורים של המפקד. ׳קומה או שתיים׳ ו׳שלוש ומעלה׳ מסתכמים ל-100%; הפירוט ל-3–4 ול-5 ומעלה מגיע מקובץ אחר של INE ואינו קיים לרובעים שהמקטעים הסטטיסטיים שלהם נחצים בין שני רובעים של 2025.': 'Every share here is out of the census\'s residential buildings. \'One or two\' and \'three or more\' add to 100%; the finer split into 3–4 and 5-or-more comes from a different INE file and does not exist for parishes whose statistical sections are cut in two by the 2025 boundaries.',
  'בנייני מגורים': 'Residential buildings',
  'היא כן מתפרסמת ל-': 'It is published for ',
  ' מתוך 18 העיריות.': ' of the 18 municipalities.',
  'בעירייה הזאת אין אף אחת משתי השכבות, ולכן אין כאן מה להוריד. בשאר המחוז יש: לחצו על הבית, בחרו עירייה אחרת, וגללו לכאן.': 'Neither layer exists for this municipality, so there is nothing here to download. The rest of the district has them: tap home, choose another municipality, and scroll back to here.',
  'ההורדה נכשלה': 'The download failed',
  ' <span class="flag">לא הורדה</span>': ' <span class="flag">not downloaded</span>',
  ' <span class="flag">להוריד? לחיצה נוספת</span>': ' <span class="flag">download? tap again</span>',
  ' בתים מתוך ': ' bytes out of ',
  ' — DGT אינו מפרסם אותה לעירייה הזאת. הסיבה אינה מתפרסמת, ולכן אינה נאמרת כאן.': ' — DGT does not publish it for this municipality. The reason is not published, so none is given here.',
  'אין שכבה כזו לעירייה הזאת': 'There is no such layer for this municipality',
  'הדפדפן הזה אינו יודע לפרוס gzip': 'This browser cannot decompress gzip',
  'ההורדה נכשלה — השרת השיב ': 'The download failed — the server answered ',
  'ההורדה נקטעה: הגיעו ': 'The download was cut short: ',
  'הורדה אחרת עדיין רצה.': 'Another download is still running.',
  'המקור: Direção-Geral do Território (DGT), רישיון CC BY 4.0. הגבול נשמר בדיוק כפי ש-DGT מפרסם אותו — שכבה שאומרת ״כאן אסור לבנות״ לא מפושטת, כי פישוט מזיז את הקו. כל עירייה תוחמה בחוק משלה ובשנה משלה, ולכן אין ״שנת REN״ אחת.': 'Source: Direção-Geral do Território (DGT), licensed CC BY 4.0. The boundary is kept exactly as DGT publishes it — a layer that says "you may not build here" is not simplified, because simplifying moves the line. Each municipality was delimited by its own law in its own year, so there is no single "REN year".',
  'הקובץ שהגיע אינו הקובץ שפורסם — בדיקת sha256 נכשלה. לא נשמר.': 'What arrived is not what was published — the sha256 check failed. Nothing was saved.',
  'מגבלות בנייה': 'Building constraints',
  'סכנת שריפה אינה כאן ולא תהיה עד שתימצא שנת הייחוס שלה: השדה שנראה כמו תאריך המפה הוא תאריך החוק שהורה עליה.': 'Fire hazard is not here and will not be until its reference year is found: the field that looks like the map’s date is the date of the law that ordered it.',
  'שנת ייחוס': 'reference year',
  ' <span class="flag">רובע מ-2025</span>': ' <span class="flag">a 2025 parish</span>',
  '. הקוד והגבול שלמעלה הם של הרובע הזה, בחלוקה של 2025.': '. The code and the boundary above are this parish’s, in the 2025 division.',
  '<p class="note">גיל חציוני, אזרחות זרה, השכלה ואבטלה אינם מוצגים לרובע הזה: מפקד 2021 נספר לפי גבולות 2013, וחלק מהמקטעים הסטטיסטיים שלו נחצים בין שני רובעים של 2025. שיעור שהיה מחושב מהחלק שנופל בפנים הוא שיעור של רוב הרובע המוצג כשיעור שלו.</p>': '<p class="note">Median age, foreign citizenship, higher education and unemployment are not shown for this parish: the 2021 census was counted on the 2013 boundaries, and some of its statistical sections are cut in two by the 2025 ones. A share computed from the part that falls inside would be a share of most of the parish, presented as the parish’s.</p>',
  '· מתוכם ברובע הזה': '· of them in this parish',
  'היחידה שקדמה לו': 'The unit it came out of',
  'המספרים כאן הם של היחידה הקודמת ולא של הרובע הזה, והם אינם נספרים בהשוואות, בדירוגים או בצבעי המפה. הם מוצגים כדי לומר איך נראה השטח לפני שהגבול זז.': 'These figures belong to the earlier unit and not to this parish, and they are never counted in a comparison, a ranking or the map’s colours. They are here to say what the ground looked like before the boundary moved.',
  'עד רפורמת 2025 היה חלק מ־': 'Until the 2025 reform it was part of ',
  'תושבים (2021)': 'Residents (2021)',
  '% מהיחידה ·': '% of the unit ·',
  '. הקוד שלמעלה הוא הקוד שהחזיקה עד אז, וזה גם הקוד שלפיו INE ספר אותה ב-2021 — הגבול והנתונים כאן הם של היחידה הזו.': '. The code above is the one it held until then, and it is also the code INE counted it under in 2021 — the boundary and the data here are that unit’s.',
  '18 עיריות המחוז': 'the district\'s 18 municipalities',
  '243 רובעי המחוז': 'the district\'s 243 parishes',
  '<b>לחיצה כפולה</b> — על הנקודה או על הרישום — פותחת אותה במפות גוגל.': '<b>A double tap</b> — on the point or on the entry — opens it in Google Maps.',
  'בדיקה:': 'Validation:',
  'היישובים האלה אינם יחידה מנהלית ואין להם גבול. הם מגיעים מ-OpenStreetMap כנקודה אחת לכל יישוב, ולכן אין להם שם עברי ואין להם תיאור — לא נכתב כזה לאף אחד מהם.': 'These settlements are not an administrative unit and have no boundary. They come from OpenStreetMap as one point each, and so they carry neither a Hebrew name nor a description — none was ever written for any of them.',
  'הערך המדויק:': 'The exact value:',
  'זהו קובץ בודד ועצמאי — כל הנתונים בתוכו והוא עובד בלי רשת ובלי שרת. המסמך המקורי ‎(PDF)‎ נמצא במאגר, ב-': 'This is a single, self-contained file — all the data is inside it and it works with no network and no server. The source document ‎(PDF)‎ is in the repository, under ',
  'כיסוי:': 'Coverage:',
  'כל נקודה במפה היא אתר או מוסד, בצבע הקטגוריה שלה. לחיצה על נקודה מבליטה את הרישום שלה כאן, ולחיצה על רישום מבליטה את הנקודה במפה.': 'Every point on the map is a site or an institution, in the colour of its category. Tapping a point highlights its entry here, and tapping an entry highlights the point on the map.',
  'לשכונות אין גבול רשמי. האות במפה מסומנת על נקודת השכונה כפי שהיא ב-OpenStreetMap, במרכזה בקירוב.': 'Neighbourhoods have no official boundary. The letter on the map is placed on the neighbourhood point as OpenStreetMap holds it, roughly at its centre.',
  'מקור: OpenStreetMap contributors, ODbL. המיפוי התנדבותי ואינו אחיד: היעדר נקודה אינו ראיה שאין שם דבר.': 'Source: OpenStreetMap contributors, ODbL. The mapping is volunteer work and is uneven: a missing point is not evidence that there is nothing there.',
  'פתיחת המסמך המקורי (PDF, 19 עמודים)': 'Open the source document (PDF, 19 pages)',
  'קוד': 'code',
  'שנת ייחוס:': 'Reference year:',
  '— האותיות במפה': '— the letters on the map',
  '— המספר במסך מעוגל כדי להיקרא, וזה מה שהמקור מפרסם.': '— the figure on screen is rounded to be read, and this is what the source publishes.',
  'בחירה':
    'Choose',
  'ביטול':
    'Cancel',
  'מקורות, דיוק ומה שחסר':
    'Sources, accuracy and what is missing',
  'טוען את נתוני המחוז…':
    'Loading the district data…',
  'הרובעים של':
    'The parishes of',
  /* The two NUTS III regions, and the seven labels a municipality profile uses.
     Both are small closed vocabularies that come from the data rather than from
     this file, so they are translated here by value. */
  'האזור המטרופוליטני של פורטו':
    'Área Metropolitana do Porto',
  'טאמגה אה סוזה':
    'Tâmega e Sousa',
  'אופי':
    'Character',
  'כלכלה':
    'Economy',
  'נדל״ן':
    'Property',
  'שכונות':
    'Neighbourhoods',
  'יתרון':
    'Strength',
  'חיסרון':
    'Weakness',
  'מגמה':
    'Trend',
  'ממפה':
    'On the map',
  'גוררים סימון על המפה ולוחצים בחירה.':
    'Drag a marker on the map and tap Choose.',
  'מתמונה':
    'From a photo',
  'הקואורדינטות של התמונה קובעות את המקום.':
    "The photo's coordinates decide the place.",
  'מכתובת':
    'By name',
  'חיפוש בעיריות, ברובעים וביישובים שבאפליקציה.':
    'Search the municipalities, parishes and localities in the app.',
  /* A language names itself in its own language — that is how a reader who does
     not yet have the interface in their language finds their way back. */
  'עברית':
    'עברית',
  ' <span class="flag">פורק ב-2025</span>':
    ' <span class="flag">split in 2025</span>',
  ' INE אינו מפרסם ברמת הרובע בעירייה הזאת, ולכן אין כאן ולו ערך אחד.':
    ' INE does not publish parish-level figures in this municipality, so there is not one value here.',
  ' · <span class="flag">מהתמונה</span>':
    ' · <span class="flag">from the photo</span>',
  ' · בלי ':
    ' · without ',
  ' · הכל':
    ' · all',
  ' · קוד רשמי <span class="lat num">':
    ' · official code <span class="lat num">',
  ' · תמונה':
    ' · photo',
  ' דולגו':
    ' skipped',
  ' נקודות':
    ' points',
  ' נקודות הועתקו. אפשר להדביק אותן ':
    ' points copied. Paste them ',
  ' רובעים נפרדים: ':
    ' separate parishes: ',
  ' תושבים':
    ' residents',
  ' — אין תיאור לרובע הזו</span>':
    ' — no description for this parish</span>',
  ' — ברמה הזאת אין מה לבחור, ולכן אין כאן שני הכפתורים':
    ' — at this level there is nothing to choose, so the two buttons are not here',
  ' — יש להריץ את האפליקציה משרת (למשל python3 -m http.server), לא כקובץ מקומי.':
    ' — run the app from a server (for example python3 -m http.server), not as a local file.',
  '" aria-label="פירוט נקודות הציון">':
    '" aria-label="List the landmark categories">',
  ') — לא INE. היא קובעת איפה בדיוק עובר כל גבול. ממנה מגיעות כל הצורות על המפה, וכל שטח בקמ״ר שמוצג כאן חושב מהפוליגונים עצמם ולא נלקח מטבלה.':
    ') — not INE. It settles exactly where every boundary runs. Every shape on the map comes from it, and every area in km² shown here was computed from the polygons themselves rather than taken from a table.',
  ', אמרנטה':
    ', Amarante',
  ', ובה 25 יחידות. מה שמייחד אותה בפורטוגל: כל יחידה היא גם':
    ', with 25 units. What is distinctive about it in Portugal: every unit is also',
  ', והוא בנוי בשכבות. מחוז פורטו הוא':
    ', and it is built in layers. Porto district is',
  ', ולכן המיקום חסום. הקישור המקוון (https) יעבוד.':
    ', so location is blocked. The online link (https) will work.',
  ', טרופה':
    ', Trofa',
  ', כלומר הם הקוד שהמדינה מפרסמת ולא מספור של האפליקציה.':
    ", so they are the code the state publishes and not a numbering of the app's own.",
  ', עם מחירי נדל״ן נמוכים משמעותית ואוכלוסייה מתכווצת. כאן חיים כ-348 אלף תושבים.':
    ', with markedly lower property prices and a shrinking population. About 348,000 residents live here.',
  '. זה הקוד שמופיע בטפסים, במסמכי מקרקעין ובטבלאות רשמיות, ואפשר להשתמש בו מול כל גורם בפורטוגל.':
    '. This is the code that appears on forms, in property documents and in official tables, and it can be used with any body in Portugal.',
  '. לא נשלחות לשום מקום ולא מגובות.':
    '. They are sent nowhere and backed up nowhere.',
  '. קוד DICOFRE הוא מה שמחבר ביניהם — אותו מזהה בשני המקורות, ולכן אפשר לצרף מספר לגבול בלי לנחש.':
    '. The DICOFRE code is what joins them — the same identifier in both sources, so a number can be attached to a boundary without guessing.',
  '11 מהעיריות כאן: פורטו, וילה נובה דה גאיה, מטוזיניוש, מאיה, גונדומאר, ולונגו, וילה דו קונדה, פובואה דה וארזים, סנטו טירסו, טרופה ופארדש. (ל-AMP שייכות עוד שש עיריות ממחוז אָבֵיירו.)':
    '11 of the municipalities here: Porto, Vila Nova de Gaia, Matosinhos, Maia, Gondomar, Valongo, Vila do Conde, Póvoa de Varzim, Santo Tirso, Trofa and Paredes. (Six more municipalities from the Aveiro district also belong to the AMP.)',
  '13 12 02 ▔▔ ▔▔ ▔▔ │  │  └── רובע  (Bonfim) │  └───── עירייה (פורטו) └──────── מחוז  (פורטו)':
    '13 12 02 ▔▔ ▔▔ ▔▔ │  │  └── parish       (Bonfim) │  └───── municipality (Porto) └──────── district     (Porto)',
  '18 העיריות שבאפליקציה מתחלקות בין שתי יחידות כאלה:':
    'The 18 municipalities in the app are divided between two such units:',
  '18 העיריות — לפי המספור במפה':
    'The 18 municipalities — by the numbering on the map',
  '18 עיריות · 243 רובעים · 7 רבעי פורטו · 53 שכונות ·':
    '18 municipalities · 243 parishes · 7 Porto quarters · 53 neighbourhoods ·',
  '18 עיריות ו-243 רובעים בצפון-מערב פורטוגל, מהאוקיינוס האטלנטי במערב ועד הרי מראו במזרח. זהו המחוז הצפוף במדינה.':
    '18 municipalities and 243 parishes in north-west Portugal, from the Atlantic in the west to the Marão mountains in the east. It is the most densely populated district in the country.',
  '7 מהעיריות כאן: פנאפיאל, פאסוש דה פריירה, לוזאדה, פלגיירש, אמרנטה, מרקו דה קנבזש ובאיאו. (ליחידה שייכות עוד ארבע עיריות ממחוזות אחרים.)':
    '7 of the municipalities here: Penafiel, Paços de Ferreira, Lousada, Felgueiras, Amarante, Marco de Canaveses and Baião. (Four more municipalities from other districts belong to the unit.)',
  '; שתי הספרות שאחריו הן העירייה, ושתיים נוספות הן הרובע:':
    '; the next two digits are the municipality, and two more are the parish:',
  '</span> שכונות':
    '</span> neighbourhoods',
  '<button class="chip is-on" data-wpact="save">שמירה</button>':
    '<button class="chip is-on" data-wpact="save">Save</button>',
  '<button class="lb-x" type="button" aria-label="סגירה">✕</button>':
    '<button class="lb-x" type="button" aria-label="Close">✕</button>',
  '<button data-go="district">מחוז פורטו</button>':
    '<button data-go="district">Porto District</button>',
  '<h2>עריכת מקום</h2>':
    '<h2>Edit place</h2>',
  '<h3>נקודות במפה</h3>':
    '<h3>Points on the map</h3>',
  '<h3>קווי גבול</h3>':
    '<h3>Boundary lines</h3>',
  '<h3>שכבות</h3>':
    '<h3>Layers</h3>',
  '<input id="mineName" type="text" autocomplete="off" placeholder="למשל: דירה שראיתי" value="':
    '<input id="mineName" type="text" autocomplete="off" placeholder="e.g. a flat I saw" value="',
  '<p class="mnote">הנקודות עצמן מצוירות ברמת הרובע; הבחירה כאן נשמרת וחלה שם.</p>':
    '<p class="mnote">The points themselves are drawn at parish level; the choice here is kept and applies there.</p>',
  '<p class="note" style="margin-block-end:8px">לחיצה על רובע פותחת אותו: השכונות שבתוכו באותיות, ואתרים ומוסדות כנקודות שחורות.</p>':
    '<p class="note" style="margin-block-end:8px">Tapping a parish opens it: the neighbourhoods inside it as letters, and sites and institutions as black points.</p>',
  '<p class="note" style="margin-block-start:6px">הקווים ששייכים למה שעל ':
    '<p class="note" style="margin-block-start:6px">The lines that belong to what is ',
  '<p class="note" style="margin-block-start:8px">קטגוריות הנקודות נבחרות ברמת הרובע.</p>':
    '<p class="note" style="margin-block-start:8px">Point categories are chosen at parish level.</p>',
  '<p class="note">אין ביישוב הזה נקודות place ב-OpenStreetMap.</p>':
    '<p class="note">This locality has no place points in OpenStreetMap.</p>',
  '<p class="note">בזמן ניהול המקומות מוצגים כולם, והשכבה הזאת ':
    '<p class="note">While managing places they are all shown, and this layer ',
  '<p class="note">התיאור נכתב לאפליקציה ולא הועתק ממקור רשמי.</p>':
    '<p class="note">The description was written for this app, not copied from an official source.</p>',
  '<p class="note">התמונה אינה במכשיר הזה. ':
    '<p class="note">The photo is not on this device. ',
  '<p class="note">לא מופו כאן אתרים או מוסדות ב-OpenStreetMap.</p>':
    '<p class="note">No sites or institutions are mapped here in OpenStreetMap.</p>',
  '<p class="note">לא נבחרה שום קטגוריה.</p>':
    '<p class="note">No category is selected.</p>',
  '<p class="note">שתי אותיות ומעלה — בעברית, פורטוגזית או אנגלית.</p>':
    '<p class="note">Two letters or more — in Hebrew, Portuguese or English.</p>',
  '<p class="note">שתי אותיות ומעלה. האפליקציה אינה מחפשת ':
    '<p class="note">Two letters or more. The app does not search ',
  '<span class="flag">אין נקודה במפה</span>':
    '<span class="flag">no point on the map</span>',
  '<span class="flag">תיאור שנכתב לאפליקציה</span>':
    '<span class="flag">description written for this app</span>',
  '<span class="now">מחוז פורטו</span>':
    '<span class="now">Porto District</span>',
  'CAOP נותן את':
    'CAOP supplies the',
  'INE נותן את':
    'INE supplies the',
  'NUTS III — החלוקה הרשמית של המחוז':
    "NUTS III — the district's official division",
  '· דיוק':
    '· accuracy',
  '· הנתונים נבנו ב-':
    '· data built on ',
  '· מהקטן לגדול':
    '· smallest to largest',
  'אבטלה':
    'Unemployment',
  'אוכלוסיית 2021, שטח וצפיפות לכל 18 העיריות ולכל 243 הרובעים':
    '2021 population, area and density for all 18 municipalities and all 243 parishes',
  'אוניברסיטה והשכלה':
    'University and education',
  'אופי':
    'Character',
  'אותיות היישובים':
    'Locality letters',
  'אותיות השכונות':
    'Neighbourhood letters',
  'אזורים':
    'Regions',
  'אזרחות זרה':
    'Foreign citizenship',
  'אחת דולגה':
    'one skipped',
  'איך קוראים את המספרים':
    'How to read the numbers',
  'אין IndexedDB בדפדפן הזה':
    'This browser has no IndexedDB',
  'אין נתון':
    'no data',
  'אין עדיין נקודות לייצוא.':
    'There are no points to export yet.',
  'אין תוצאות ל״':
    'No results for “',
  'אנשים':
    'People',
  'אנשים — מפקד 2021':
    'People — Census 2021',
  'אפור תמיד.</p>':
    'always grey.</p>',
  'אתה ב':
    'You are in ',
  'אתר':
    'Site',
  'אתרים ומונומנטים':
    'Sites and monuments',
  'בבחירת תמונה אפשר לסמן כמה תמונות בבת אחת. הראשונה נכנסת לכרטיסייה הפתוחה, וכל אחת מהשאר הופכת לנקודה משלה. תמונה שיש בה קואורדינטות נוחתת עליהן; תמונה שאין בה נוחתת בפינה השמאלית העליונה של המפה — מקום שאפשר לראות ולגרור ממנו, ולא טענה על היכן היא צולמה.':
    'When choosing photos you can select several at once. The first goes into the open card, and each of the rest becomes a point of its own. A photo carrying coordinates lands on them; one without lands in the top corner of the map — somewhere visible to drag from, not a claim about where it was taken.',
  'בבעלות הדיירים':
    'Owner-occupied',
  'בהודעה לעצמך, ולייבא בחזרה בכל מכשיר.':
    'into a message to yourself, and import them back on any device.',
  'בחירת מקום במפה':
    'Pick a place on the map',
  'בחירת תמונות':
    'Choose photos',
  'ביטחון':
    'Safety',
  'בית שני':
    'Second homes',
  'בלי נתון — לא מדורגים':
    'No value — not ranked',
  'במכשיר הזה בלבד':
    'on this device only',
  'במקום קוד, ובכרטיס של כל אחת מהן רשומים בשמם ובקודם הרובעים שהחליפו אותה. 218 הרובעים האחרים לא נגעו ברפורמה והקוד שמוצג להם הוא הקוד הרשמי המלא והתקף.':
    'instead of a code, and each of their cards lists by name and code the parishes that replaced it. The other 218 parishes were untouched by the reform and the code shown for them is the full, valid official one.',
  'בני 0–14':
    'Aged 0–14',
  'בני 0–14 ':
    'Aged 0–14 ',
  'בני 65+':
    'Aged 65+',
  'בניינים':
    'Buildings',
  'בסימון נ.צ. על המפה: גוררים את הסימון למקום, ולחיצה כפולה עליו קובעת אותו.':
    'When placing a point on the map: drag the marker to the spot, and a double tap fixes it.',
  'בפינת המפה.':
    'in the corner of the map.',
  'ברפורמת 2025 חולק ל־':
    'The 2025 reform split it into ',
  'בשכירות':
    'Rented',
  'בתוך העירייה, ובכרטיס של כל רובע מופיע גם הקוד המלא בן שש הספרות. הקודים מגיעים מיחידות שמסומנות ב-OpenStreetMap עם':
    'within the municipality, and each parish card also shows the full six-digit code. The codes come from units tagged in OpenStreetMap with',
  'בתי חולים':
    'Hospitals',
  'בתמונה אין מיקום שמיש. ייתכן שתיוג המיקום במצלמה כבוי — ':
    'The photo has no usable location. Location tagging may be off in the camera — ',
  'בתמונה אין מיקום — הנקודה נשארה איפה שסומנה.':
    'The photo carries no location — the point stayed where it was placed.',
  'גבול מחוז פורטו':
    'Porto district boundary',
  'גבולות':
    'Boundaries',
  'גבולות האזורים':
    'Region boundaries',
  'גבולות העיריות':
    'Municipality boundaries',
  'גבולות הרובעים':
    'Parish boundaries',
  'גוף אמיתי':
    'a real body',
  'גיל חציוני':
    'Median age',
  'גרסה':
    'Version',
  'גרפיקה בלבד':
    'Graphics only',
  'גרפיקה וטקסט':
    'Graphics and text',
  'דיור ובניינים':
    'Housing and buildings',
  'דיור ובניינים — מפקד 2021':
    'Housing and buildings — Census 2021',
  'דירות':
    'Dwellings',
  'דירות חדשות':
    'New dwellings',
  'דירות קיימות':
    'Existing dwellings',
  'דירות ריקות':
    'Vacant dwellings',
  'האפליקציה עובדת גם בלי רשת. בלי חיבור אריחי הרקע לא ייטענו, המפה תוצג כגבולות בלבד, וכל הנתונים והטקסטים זמינים במלואם.':
    'The app works without a network. With no connection the background tiles will not load, the map shows boundaries only, and all the data and text remain fully available.',
  'הגיל החציוני מחושב מפסי גיל של חמש שנים — INE לא מפרסם חציון בקובץ הזה. מדד הזדקנות הוא בני 65 ומעלה לכל מאה בני 0–14. השינוי מ-2011 הוא כפי ש-INE מפרסמת אותו על גאוגרפיית מפקד 2021 — לא חושב כאן, כי חלוקת הרובעים של 2011 אינה זו של 2021.':
    'Median age is interpolated from five-year age bands — INE publishes no median in this file. The ageing index is people aged 65 and over per hundred aged 0–14. The change since 2011 is as INE publishes it, on the 2021 census geography: it is not computed here, because the 2011 parishes are not the 2021 parishes.',
  'הדפדפן הזה לא תומך באיתור מיקום.':
    'This browser does not support geolocation.',
  'הדפדפן נותן מיקום רק בחיבור מאובטח. הדף הזה נפתח מ־':
    'Browsers give a location only over a secure connection. This page was opened from ',
  'שמירת נתונים כותבת קובץ אחד שנושא את שלושת הדברים שאינם מגיעים עם האפליקציה: המקומות, התמונות שעליהם, ושכבות מגבלות הבנייה שהורדו. ייבוא הקובץ במכשיר אחר מחזיר את שלושתם. ההעתקה ללוח נושאת את המקומות בלבד — מחרוזת שכוללת תמונות או שכבות נחתכת בדרך — ולכן היא מוצעת לצידו ולא במקומו.':
    'Saving writes one file carrying the three things the app does not ship with: the places, the photos on them, and the building-constraint layers that were downloaded. Importing that file on another device brings all three back. The clipboard carries the places alone — a string that includes photos or layers is truncated on the way — so it is offered alongside the file rather than instead of it.',
  'הוא תקן אירופי לחלוקת שטח לצורך סטטיסטיקה והקצאת תקציבים. בפורטוגל יש שלוש רמות; הרמה שבפועל משמשת היא':
    'is a European standard for dividing territory for statistics and budget allocation. Portugal has three levels; the one actually used is',
  'החלוקה הרשמית של המחוז, וזו שלפיה INE מפרסם. הקו הכתום במפה מקיף את העיריות של כל אזור.':
    "The district's official division, and the one INE publishes by. The orange line on the map encloses each region's municipalities.",
  'החלוקה מגיעה מטבלת ההמרה של INE בין תת-המקטעים הסטטיסטיים של מפקד 2021 לגבולות 2025, וסכומה שווה בדיוק לאוכלוסיית היחידה כאן. הגבולות עצמם עדיין אינם באפליקציה — לכך צריך את CAOP 2025.':
    "The split comes from INE's conversion table between the 2021 census sub-sections and the 2025 boundaries, and it sums exactly to the population of the unit here. The boundaries themselves are not in the app yet — that needs CAOP 2025.",
  'החלפת התמונה':
    'Replace the photo',
  'החלפת נתון':
    'Change field',
  'הטלפון לא הצליח לקבוע מיקום. כדאי לבדוק שה-GPS דלוק ולנסות שוב בחוץ.':
    'The phone could not fix a position. Check that GPS is on and try again outdoors.',
  'הכנסה מוצהרת (חציון)':
    'Declared income (median)',
  'הכנסה מוצהרת — INE':
    'Declared income — INE',
  'הכנסה שנתית ברוטו כפי שהוצהרה לרשות המסים, החציון על פני משקי הבית הפיסקאליים.':
    'Annual gross income as declared to the tax authority, the median across fiscal households.',
  'הלשכה המרכזית לסטטיסטיקה של פורטוגל. אחראית על כל הסטטיסטיקה הרשמית, והמוצר המרכזי שלה כאן הוא':
    "Portugal's national statistics institute. It is responsible for all official statistics, and its central product here is",
  'המחוז':
    'The district',
  'המיקום שלי':
    'My location',
  'המיקום שלך אינו בתוך מחוז פורטו — כ-':
    'You are outside Porto district — about ',
  'המסך מוצגים בשחור, והשאר באפור. קו האזורים ':
    'on screen are black, the rest grey. The region line is ',
  'המסך מחולק לשניים: מפה בחצי אחד, וכל הידע שנוגע למה שרואים בה בחצי השני. הקו שביניהם נגרר, המפה נגררת ומתקרבת בתוך החלון שלה, והטקסט נגלל בלי הגבלה.':
    'The screen is split in two: a map in one half, and everything known about what is on it in the other. The map pans and zooms inside its own window, and the text scrolls without limit.',
  'המספר על הכרטיסייה הוא כמה יחידות יש להן ערך בשדה הזה. ביתר יוצג ׳אין נתון׳, והן לא ידורגו.':
    'The number on the card is how many units have a value for that field. The rest show “no data” and are not ranked.',
  'המספר על כל רובע הוא הקוד הרשמי שלו בתוך העירייה, והרשימה מסודרת לפיו. רובע שמסומן':
    'The number on each parish is its official code within the municipality, and the list is ordered by it. A parish marked',
  'המספר שמופיע על כל עירייה במפה הוא':
    'The number on each municipality on the map is',
  'המספר שעל כל רובע הוא באותו אופן':
    'The number on each parish is likewise',
  'המספרים':
    'numbers',
  'המקומות שלי':
    'My places',
  'הן נשמרות':
    'are kept',
  'הנקודה הועברה לקואורדינטות של התמונה.':
    "Moved to the photo's coordinates.",
  'הנקודה מוקמה לפי הקואורדינטות של התמונה.':
    "Placed at the photo's coordinates.",
  'הנקודה נשארה במקום שסימנת.':
    'The point stayed where you placed it.',
  'הנקודה נשמרה, אבל התמונה לא: ':
    'The point was saved, but the photo was not: ',
  'הספרות אינן רצות 01, 02, 03 בלי דילוגים, וזה תקין: הרשימה נקבעה לפי סדר האלף-בית הפורטוגלי, וכשרובע חדל להתקיים הקוד שלו לא מוחזר לשימוש ולא מחולק מחדש. יחידה שנוצרה מאיחוד או מפיצול קיבלה מספר חדש שנוסף בסוף הרשימה של אותה עירייה — ולכן עירייה יכולה להציג 02 ליד 44.':
    "The digits do not run 01, 02, 03 without gaps, and that is correct: the list was set in Portuguese alphabetical order, and when a parish ceases to exist its code is not returned to use and not reassigned. A unit created by a merger or a split was given a new number added at the end of that municipality's list — which is why a municipality can show 02 next to 44.",
  'הסרת התמונה':
    'Remove the photo',
  'העיריות':
    'Municipalities',
  'העתקה ידנית':
    'Copy manually',
  'הצבע מייצג את החמישון ולא את גודל הערך, כדי שכל קבוצה תיקרא במבט אחד; הערך המדויק בשורה. המספרים על המפה הם קודי DICOFRE, כמו בכל מסך אחר. אין כאן צד ״טוב״ ואין צד ״רע״ — רק קטן וגדול.':
    'The colour stands for the fifth, not for the size of the value, so each group reads at a glance; the exact value is in the row. The numbers on the map are DICOFRE codes, as on every other screen. There is no “good” side and no “bad” side here — only smaller and larger.',
  'הצורות':
    'shapes',
  'הרובעים':
    'Parishes',
  'השוואת נתונים':
    'Compare data',
  'השכלה גבוהה':
    'Higher education',
  'התמונה תוסר כשהנקודה תישמר.':
    'The photo will be removed when the point is saved.',
  'ויטרז׳ מפות':
    'Stained-glass fills',
  'ועם':
    'and',
  'ותעריפי האזורים — ושוק עבודה אחד. כאן חיים כ-1.44 מיליון מתושבי המחוז.':
    "pass and the zone fares — and one labour market. About 1.44 million of the district's residents live here.",
  'זה לא טקסט תקין של נקודות.':
    'That is not valid point text.',
  'זהו מטרופולין אחד לכל דבר:':
    'This is a metropolis in every sense:',
  'זו אינה ׳פשיעה חמורה׳':
    'this is not “violent crime”',
  'זקוקים לתיקון':
    'Need repair',
  'חדל להתקיים כיחידה ברפורמת 2025, והקוד שלו הוא זה שהחזיק עד אז — בכרטיס שלו רשומים הרובעים שהחליפו אותו.':
    'ceased to exist as a unit in the 2025 reform, and its code is the one it held until then — its card lists the parishes that replaced it.',
  'חדש':
    'New',
  'חוזרת לפעול ביציאה ממנו.</p>':
    'takes effect again on leaving.</p>',
  'חזרה':
    'Back',
  'חזרה למחוז':
    'Back to the district',
  'חזרה למפת המחוז':
    'Back to the district map',
  'חיפוש':
    'Search',
  'חיפוש מקום':
    'Search for a place',
  'חלק מהאיחודים של 2013 בוטלו, ורובעים שאוחדו חזרו להיות יחידות נפרדות עם קודים חדשים. במחוז פורטו זה נוגע ל-25 מ-243 היחידות שהאפליקציה מציירת: הן פורקו ל-57 רובעים חדשים, והקוד של היחידה המאוחדת בוטל. הגבולות והנתונים כאן הם CAOP 2020 — כלומר המפה של 2013 — ולכן ל-25 האלה מוצג':
    "Some of the 2013 mergers were undone, and merged parishes became separate units again with new codes. In Porto district this touches 25 of the 243 units the app draws: they were split into 57 new parishes, and the merged unit's code was withdrawn. The boundaries and data here are CAOP 2020 — the 2013 map — so those 25 show",
  'חצי מפה, חצי טקסט':
    'Half map, half text',
  'חציון למשק בית פיסקאלי':
    'Median per fiscal household',
  'טעינת הנתונים נכשלה: ':
    'Loading the data failed: ',
  'טקסט בלבד':
    'Text only',
  'טקסט על כל המסך':
    'Text full screen',
  'ייבוא':
    'Import',
  'ייבוא נתונים':
    'Import data',
  'יישוב':
    'Locality',
  'יישובים ושכונות':
    'Localities and neighbourhoods',
  'יש כרטיסייה בעריכה — לשמור או לבטל אותה קודם.':
    'A card is open for editing — save or cancel it first.',
  'כדי שהאפליקציה תציג את 275 הרובעים של 2025 עצמם — ולא את חלוקת 2020 עם הערה — צריך את שכבת הגבולות CAOP במהדורה 2024 או 2025. אין לי אותה כאן, וכל נתוני האוכלוסייה שיש לי הם ממפקד 2021 שנספר לפי חלוקת 2013, כך שפיצול היחידות היום היה משאיר 57 רובעים בלי מספר תושבים.':
    'For the app to show the 275 parishes of 2025 themselves — rather than the 2020 division with a note — the CAOP boundary layer in its 2024 or 2025 edition is needed. It is not here, and all the population data available was counted on the 2013 division in the 2021 census, so splitting the units today would leave 57 parishes with no population figure.',
  'כל מספר באפליקציה נלחץ ומציג את המקור ואת שנת הייחוס שלו. המספרים על המפה הם קודי DICOFRE הרשמיים.':
    'Every number in the app is tappable and shows its source and reference year. The numbers on the map are the official DICOFRE codes.',
  'כל נתוני האוכלוסייה באפליקציה הם ממפקד 2021.':
    'All the population data in the app comes from the 2021 census.',
  'כל ערך הוא החציון של שנים עשר החודשים שמסתיימים ב-':
    'Every value is the median of the twelve months ending in ',
  'כלכלה נפרדת — רהיטים, נעליים וטקסטיל —':
    'a separate economy — furniture, footwear and textiles —',
  'כתובות רחוב — אין בה מאגר כתובות ואין לה רשת.</p>':
    'street addresses — it holds no address database and has no network.</p>',
  'לא ההכנסה הכוללת של משק הבית ולא הכנסה נטו':
    'not total household income and not net income',
  'לא הצלחתי להעתיק ללוח. אפשר לסמן את הטקסט כאן ולהעתיק ידנית.':
    'Could not copy to the clipboard. Select the text here and copy it manually.',
  'לא הצלחתי לקבל מיקום.':
    'Could not get a location.',
  'לא הצלחתי לקרוא את התמונה. ייתכן שהיא בפורמט שהדפדפן ':
    'Could not read the photo. It may be in a format the browser ',
  'לא הצלחתי לשמור — ייתכן שהדפדפן חוסם אחסון מקומי.':
    'Could not save — the browser may be blocking local storage.',
  'לא ניתנה הרשאת מיקום. אפשר לאשר אותה מהאייקון שליד כתובת האתר בדפדפן.':
    'Location permission was refused. You can allow it from the icon beside the address bar.',
  'לא פותח, כמו HEIC — צילום ב-JPEG יעבוד.':
    'does not open, such as HEIC — a JPEG will work.',
  'לאלף':
    'per 1,000',
  'לאלף תושבים':
    'per 1,000 residents',
  'להבדל הזה יש משמעות מעשית: הוא קובע אם עירייה נמצאת בתוך מערכת הכרטוס והמטרו של פורטו, לאן מגיעים כספי הפיתוח האירופיים, ובאיזו יחידה INE מפרסם נתונים. זו גם החלוקה שמסך המחוז מצייר — עד גרסה 1.8 הוא צייר שלוש חגורות לפי מרחק ואופי, שהיו קריאה של המסמך המקורי ולא חלוקה רשמית.':
    "The difference has practical weight: it settles whether a municipality is inside Porto's ticketing and metro system, where European development money goes, and which unit INE publishes its figures under. It is also the division the district screen draws — until version 1.8 it drew three belts by distance and character, which were a reading of the original document and not an official division.",
  'לחיצה כפולה על כל דבר שיש לו קואורדינטה פותחת אותו במפות גוגל — קישור עם נ״צ בלבד, בלי מפתח ובלי לשמור דבר, ולכן בלי להפר את תנאי השימוש של גוגל שאוסרים לאחסן או להציג את הנתונים שלהם מחוץ למפה שלהם.':
    "Double-tapping anything that has a coordinate opens it in Google Maps — a link with the coordinate only, no key and nothing stored, and so without breaching Google's terms, which forbid storing or displaying their data outside their own map.",
  'לחיצה על כרטיסייה מדגישה את הנקודה שלה במפה, ולחיצה על נקודה במפה פותחת את הכרטיסייה שלה. לחיצה כפולה על נקודה פותחת אותה במפות גוגל.':
    'Tapping a card highlights its point on the map, and tapping a point on the map opens its card. Double-tapping a point opens it in Google Maps.',
  'לכל יחידה מנהלית בפורטוגל יש קוד רשמי אחד,':
    'Every administrative unit in Portugal has one official code,',
  'למחוק? לחיצה נוספת':
    'Delete? Tap again',
  'לפי הקואורדינטות שבתמונה,':
    'at the coordinates in the photo,',
  'לקמ״ר':
    'per km²',
  'מדד הזדקנות':
    'Ageing index',
  'מה החליף אותו — 2025':
    'What replaced it — 2025',
  'מה יש כאן':
    'What is here',
  'מה להשוות':
    'What to compare',
  'מה עוד חסר':
    'What is still missing',
  'מה שחשוב לזכור על המקום הזה':
    'What matters about this place',
  'מהם תיקון עמוק':
    'of those, major repair',
  'מוזיאונים וגלריות':
    'Museums and galleries',
  'מורחב':
    'Expanded',
  'מחוז פורטו':
    'Porto District',
  'מחוץ למחוז פורטו':
    'Outside Porto district',
  'מחוץ למערכת התחבורה המטרופולינית':
    'outside the metropolitan transport system',
  'מחיקה':
    'Delete',
  'מחפש מיקום…':
    'Locating…',
  'מי מודד ומי סופר':
    'Who measures and who counts',
  'מידע':
    'About',
  'מכירות':
    'Sales',
  'מסלול ניווט':
    'Breadcrumb',
  'מספרי העיריות והרובעים הם קודי DICOFRE הרשמיים. האותיות של השכונות והיישובים הן של האפליקציה: הן נועדו לקשור בין המפה לרשימה, ואין להן קיום מחוץ לאפליקציה.':
    "The municipality and parish numbers are the official DICOFRE codes. The letters on neighbourhoods and localities are the app's own: they exist to tie the map to the list, and have no existence outside the app.",
  'מפה':
    'Map',
  'מפה על כל המסך':
    'Map full screen',
  'מפורטו':
    'From Porto',
  'מפקד 2021 לכל יחידה: גיל חציוני, פילוח גיל, אזרחות זרה, ואחת-עשרה שורות של דיור ובניינים — דירות ריקות, בעלות מול שכירות, חניה, מצב הבניינים ותקופת הבנייה':
    'Census 2021 for every unit: median age, age breakdown, foreign citizenship, and eleven rows of housing and buildings — vacant dwellings, ownership against renting, parking, the state of the buildings and the period they were built',
  'מפת הגבולות המנהליים הרשמית, שמפרסמת':
    'The official administrative boundary map, published by',
  'מפת מחוז פורטו':
    'Map of Porto District',
  'מפת רקע':
    'Base map',
  'מקור':
    'Source',
  'מקור לכל שדה':
    'A source for every field',
  'מקור מקום חדש':
    'Where a new place comes from',
  'מקור:':
    'Source:',
  'מרחק אווירי מפורטו':
    'Straight-line distance from Porto',
  'מ׳ <button type="button" data-jump="fre:':
    'm <button type="button" data-jump="fre:',
  'מ׳.':
    'm.',
  'נבנה:':
    'Built:',
  'נבנו לפני 1946':
    'Built before 1946',
  'נבנו מ-2011':
    'Built from 2011',
  'נהרות ומים':
    'Rivers and water',
  'נוספה נקודה אחת':
    'One point added',
  'נוספו':
    'Added',
  'נוספו ':
    'Added ',
  'נפש':
    'people',
  'נפש/קמ״ר':
    'people/km²',
  'נקודה':
    'Point',
  'נקודות במפה':
    'points on the map',
  'נקודות הציון שלכם':
    'Your own points',
  'נקודות מהתמונות —':
    'points from the photos —',
  'נקודות ציון':
    'Landmarks',
  'נקודות שיובאו כטקסט מגיעות בלי התמונות שלהן.</p>':
    'Points imported as text arrive without their photos.</p>',
  'נקודת ציון ':
    'Point ',
  'נתונים':
    'Data',
  'סגירה':
    'Close',
  'סגירת ההודעה':
    'Dismiss',
  'סגירת התפריט':
    'Close the menu',
  'סך העבירות שנרשמו בידי רשויות האכיפה, חלקי האוכלוסייה המשוערת של אותה שנה.':
    "Total offences recorded by the enforcement authorities, over that year's estimated population.",
  'עבירות רשומות':
    'Recorded offences',
  'עבירות רשומות — INE':
    'Recorded offences — INE',
  'עוד שכבות':
    'More layers',
  'עיריות':
    'Municipalities',
  'עירייה':
    'Municipality',
  'עירייה, רובע, יישוב או אתר':
    'Municipality, parish, locality or site',
  'עם חניה':
    'With parking',
  'עריכה':
    'Edit',
  'ערך חסר אינו מקום אחרון. היחידות האלה אינן מדורגות, אינן צבועות ואינן נספרות — במפה הן מפוספסות.':
    'A missing value is not last place. Those units are not ranked, not coloured and not counted — on the map they are hatched.',
  'פארקים, גנים וחופים':
    'Parks, gardens and beaches',
  'פורטולנד':
    'Portoland',
  'פורק ב-2025':
    'split in 2025',
  'פירוט נקודות הציון':
    'List the landmark categories',
  'פתיחת הרובע':
    'Open the parish',
  'צבעי 18 העיריות':
    'The 18 municipality colours',
  'ציפיתי לרשימה של נקודות.':
    'A list of points was expected.',
  'צפיפות':
    'Density',
  'קביעת המיקום ארכה יותר מדי. נסה שוב.':
    'Locating took too long. Try again.',
  'קורא את התמונה…':
    'Reading the photo…',
  'קמ״ר':
    'km²',
  'קמ״ר ·':
    'km² ·',
  'ק״מ':
    'km',
  'ק״מ ממרכז פורטו. דיוק':
    'km from central Porto. Accuracy',
  'רבעון הייחוס':
    'the reference quarter',
  'רבעי העיר':
    'City quarters',
  'רובע':
    'Parish',
  'רובע בפורטו':
    'Porto city parish',
  'רובעים':
    'parishes',
  'רישוי וייחוס':
    'Licensing and attribution',
  'רפורמת 2025.':
    'The 2025 reform.',
  'רקע המפה (רחובות)':
    'Base map (streets)',
  'רקע המפה לא נטען — מוצגים הגבולות בלבד. כל הנתונים והטקסטים זמינים.':
    'The base map did not load — boundaries only. All data and text are available.',
  'רשות תחבורה משותפת':
    'a shared transport authority',
  'רשימה':
    'List',
  'שווקים':
    'Markets',
  'שוק הדיור':
    'Housing market',
  'שוק הדיור — INE':
    'Housing market — INE',
  'שטח':
    'Area',
  'שטח ומרחק':
    'Area and distance',
  'שינוי מ-2011':
    'Change since 2011',
  'שינוי מ-2011 ':
    'Change since 2011 ',
  'שכבות':
    'Layers',
  'שכבות המפה':
    'Map layers',
  'שכונה':
    'Neighbourhood',
  'שכונות':
    'Neighbourhoods',
  'שכירות':
    'Rent',
  'שם':
    'Name',
  'שמירת נתונים':
    'Export data',
  'שני גופים שונים עומדים מאחורי כל מספר כאן, ותפקידם שונה לגמרי.':
    'Two different bodies stand behind every number here, and their roles are entirely different.',
  'שני האזורים':
    'The two regions',
  'שני האזורים גדולים ממה שמצויר כאן: לאזור המטרופוליטני 17 עיריות ולטאמגה אה סוזה 11, והשאר יושבות במחוזות אוויירו וויזאו. האפליקציה מראה את החלק שבתוך מחוז 13 בלבד.':
    'Both regions are larger than what is drawn here: the metropolitan area has 17 municipalities and Tâmega e Sousa 11, and the rest sit in the Aveiro and Viseu districts. The app shows only the part inside district 13.',
  'שנים':
    'years',
  'שפה':
    'Language',
  'שתי אותיות ומעלה. האפליקציה אינה מחפשת כתובות רחוב — אין בה מאגר כתובות ואין לה רשת.':
    'Two letters or more. The app does not search street addresses — it holds no address database and has no network.',
  'שתי הספרות הרשמיות שלה':
    'its two official digits',
  'שתי הספרות הרשמיות שלו':
    'its two official digits',
  'תוצאות, מוצגות 60.':
    'results; 60 shown.',
  'תושבים':
    'Residents',
  'תושבים (2021) ·':
    'residents (2021) ·',
  'תושבים ·':
    'residents ·',
  'תחבורה':
    'Transport',
  'תחנות מטרו ורכבת':
    'Metro and rail stations',
  'תיאור':
    'Description',
  'תיאטרון, ספריות ותרבות':
    'Theatre, libraries and culture',
  'תמונה':
    'Photo',
  'תמונה שצולמה במקום תמקם את הנקודה לפי הקואורדינטות שלה, במקום לפי הסימון על המפה.':
    'A photo taken on the spot places the point at its own coordinates rather than at the mark on the map.',
  'תמונת הנקודה':
    'Point photo',
  'תפריט':
    'Menu',
  'תצוגה':
    'View',
  'תצוגה לפי המכשיר':
    'Follow the device',
  'תצוגת יום':
    'Day',
  'תצוגת לילה':
    'Night',
  '׳זקוקים לתיקון׳ כולל אצל INE גם תיקונים קלים, ולכן האחוז גבוה כמעט בכל מקום; השורה שמתחתיו — תיקון עמוק — היא זו שמעידה על מצב הבניין.':
    'INE counts minor work under “need repair”, so the share is high almost everywhere; the line below it — major repair — is the one that says something about the state of the building.',
  '״.':
    '”.',
  '— אזור מטרופוליני או התאגדות בין-עירונית עם מועצה ותקציב.':
    '— a metropolitan area or an inter-municipal association with a council and a budget.',
  '— המטרו, כרטיס':
    '— the metro, the',
  '— לא של הרבעון עצמו. השכירות היא של חוזים חדשים בלבד, לא של כלל מלאי השכירות.':
    '— not of the quarter itself. Rent is for new contracts only, not the whole rented stock.',
  '— לפי המספור במפה':
    '— by the numbering on the map',
  '— מי שאינו מגיש דוח אינו נספר. מ-2018 הערך מיוחס לעירייה של מען המס ואינו כולל תושבי חוץ.':
    "— anyone who files no return is not counted. From 2018 the figure is attributed to the municipality of the taxpayer's fiscal address and excludes non-residents.",
  '— מפקד האוכלוסין שנערך כל עשר שנים.':
    '— the census, held every ten years.',
  '— פורטו היא':
    '— Porto is',
  '— ‏criminalidade violenta e grave מתפרסמת לפי מחוז ופיקוד משטרתי בלבד, ואין לה ערך ברמת עירייה.':
    '— criminalidade violenta e grave is published by district and police command only, and has no municipal figure.',
  '€ לשנה':
    '€ per year',
  '€/מ״ר':
    '€/m²',
  '€/מ״ר לחודש':
    '€/m² per month',

  /* ---- the constraint rows, the export file, and the import that reads it ---- */
  ' <span class="flag">מוצגת</span>':
    ' <span class="flag">shown</span>',
  ' <span class="flag">שמורה במכשיר · כבויה</span>':
    ' <span class="flag">on the device · off</span>',
  'מחיקת ':
    'Delete ',
  'כיבוי התצוגה אינו מוחק כלום: השכבה נשארת במכשיר ועובדת בלי רשת. מחיקה היא פעולה נפרדת, וזאת היא:':
    'Switching the display off deletes nothing: the layer stays on the device and works with no network. Deleting it is a separate act, and this is it:',
  'סופר…':
    'Counting…',
  'מקומות':
    'Places',
  'תמונות':
    'Photos',
  'אין':
    'none',
  'מגבלות בנייה שהורדו':
    'Building constraints downloaded',
  'הקובץ נושא את שלושת הדברים שאינם מגיעים עם האפליקציה: המקומות שסומנו, התמונות שצורפו אליהם, ושכבות מגבלות הבנייה שהורדו. ייבוא שלו במכשיר אחר מחזיר את שלושתם.':
    'The file carries the three things the app does not ship with: the places that were marked, the photos attached to them, and the building-constraint layers that were downloaded. Importing it on another device brings all three back.',
  'שמירה כקובץ':
    'Save as a file',
  'העתקת המקומות ללוח':
    'Copy the places to the clipboard',
  'הלוח נושא את המקומות בלבד. תמונות ושכבות אינן נכנסות אליו — מחרוזת בגודל כזה נחתכת בדרך בלי להודיע — ולכן הן בקובץ.':
    'The clipboard carries the places alone. Photos and layers do not fit in it — a string that size is truncated on the way with no warning — which is why they are in the file.',
  'אין כאן תמונות ולא שכבות, ולכן שתי הדרכים נושאות אותו דבר.':
    'There are no photos and no layers here, so both ways carry the same thing.',
  'אורז…':
    'Packing…',
  'האריזה נכשלה: ':
    'Packing failed: ',
  'נשמר: ':
    'Saved: ',
  'השמירה נכשלה: ':
    'Saving failed: ',
  'בחרו קובץ שנשמר קודם, או הדביקו כאן נקודות. מה שכבר קיים לא ישוכפל.':
    'Choose a file saved earlier, or paste places here. Anything already present is not duplicated.',
  'בחירת קובץ':
    'Choose a file',
  'קורא את הקובץ…':
    'Reading the file…',
  'לא הצלחתי לקרוא את הקובץ.':
    'I could not read the file.',
  'מקום אחד':
    'one place',
  ' מקומות':
    ' places',
  'תמונה אחת':
    'one photo',
  ' תמונות':
    ' photos',
  'שכבת מגבלות אחת':
    'one constraint layer',
  ' שכבות מגבלות':
    ' constraint layers',
  'שכבה אחת נדחתה — אינה תואמת את מה שהאפליקציה מפרסמת':
    'one layer was rejected — it does not match what the app publishes',
  ' שכבות נדחו — אינן תואמות את מה שהאפליקציה מפרסמת':
    ' layers were rejected — they do not match what the app publishes',
  'נוספו: ':
    'Added: ',
  'לא נוסף דבר חדש.':
    'Nothing new was added.',

  /* ---- the district-wide constraint view ---- */
  '<p class="note" style="margin-block-start:6px">הרשת האקולוגית הלאומית ועתודת הקרקע החקלאית, לכל 18 העיריות, בשקיפות של 40% מעל מפת הרקע ומתחת לגבולות העיריות. ההפעלה הראשונה מורידה אותן פעם אחת ומכאן הן עובדות בלי רשת; כיבוי אינו מוחק אותן. ויטרז׳ העיריות אינו מוצג בתצוגה הזאת — שני מישורי צבע זה על זה אינם שתי קריאות אלא אחת עכורה.</p>':
    '<p class="note" style="margin-block-start:6px">The national ecological network and the national agricultural land reserve, for all 18 municipalities, at 40% opacity over the street background and under the municipal boundaries. The first activation downloads them once and from then on they work with no network; switching off does not delete them. The municipality colours are not shown in this view — two flat colour fields on top of each other are not two readings but one muddy one.</p>',
  'מגבלות בנייה במחוז':
    'Building constraints across the district',
  'שתי שכבות שקובעות אם והיכן מותר לבנות. הן אינן בתוך האפליקציה — הן שוקלות 21.7 מגה-בייט למחוז כולו — ולכן הן יורדות בלחיצה, פעם אחת. שום דבר לא יורד מעצמו.':
    'Two layers that decide whether and where building is allowed. They are not inside the app — they weigh 21.7 MB for the whole district — so they are downloaded on a tap, once. Nothing downloads by itself.',
  'התצוגה היא של המחוז כולו, מהתפריט: שכבות ← מגבלות בנייה. השורות כאן אומרות מה יש לעירייה הזאת, ומאפשרות להוריד או למחוק אותה לבדה.':
    'The view itself covers the whole district and is switched on from the menu: Layers → Building constraints. The rows here say what this municipality has, and let it be downloaded or deleted on its own.',
  'חסרות עוד ':
    'Still missing: ',
  ' שכבות במחוז, ':
    ' layers across the district, ',
  ' MB. התצוגה המלאה תוריד אותן בלחיצה אחת.':
    ' MB. The full view downloads them in one tap.',
  'שכבה שמורה היא מגרסה קודמת. מחקו אותה והורידו מחדש.':
    'A stored layer is from an earlier release. Delete it and download it again.',
  'ויטרז׳ העיריות אינו מוצג בתצוגת מגבלות בנייה: שני מישורי צבע זה על זה אינם שתי קריאות אלא אחת עכורה. כבו את מגבלות הבנייה תחילה.':
    'The municipality colours are not shown in the building-constraint view: two flat colour fields on top of each other are not two readings but one muddy one. Switch the constraints off first.',

  /* ---- the constraints page ---- */
  'עתודת הקרקע החקלאית הלאומית (RAN)':
    'National Agricultural Reserve (RAN)',
  'רשת העתודה האקולוגית הלאומית (REN)':
    'National Ecological Reserve (REN)',
  'בשתי השכבות — נספר פעם אחת':
    'Inside both — counted once',
  'סך הכול, בקיזוז החפיפה':
    'Total, net of the overlap',
  'הקטר':
    'ha',
  'מתוך':
    'of',
  'העירייה':
    'The municipality',
  'אין תיחום מפורסם':
    'no published delimitation',
  '18 העיריות — לפי שיעור השטח המוגבל':
    'The 18 municipalities — by the share of the area under restriction',
  'DGT אינו מפרסם תיחום לעירייה הזאת. הסיבה אינה מתפרסמת, ולכן אינה נאמרת כאן.':
    'DGT publishes no delimitation for this municipality. The reason is not published, so none is given here.',
  'פורס את השכבות. זה קורה פעם אחת, במכשיר, בלי רשת.':
    'Unpacking the layers. This happens once, on the device, with no network.',
  'מוריד את נתוני מגבלות הבנייה של מחוז פורטו. זה קורה פעם אחת — מכאן הן עובדות בלי רשת.':
    'Downloading the building-constraint data for Porto district. This happens once — from here on they work with no network.',
  'שתי שכבות שקובעות איפה הבנייה מוגבלת: עתודת הקרקע החקלאית הלאומית ורשת העתודה האקולוגית הלאומית. הן חופפות זו לזו, ולכן שני השיעורים אינם מתחברים — ״סך הכול״ הוא האיחוד.':
    'Two layers that decide where building is restricted: the National Agricultural Reserve and the National Ecological Reserve. They overlap each other, so the two shares do not add up — "total" is the union.',
  'המקור: Direção-Geral do Território (DGT), רישיון CC BY 4.0. השטח נחתך לגבול היחידה ב-CAOP 2025, בהיטל EPSG:3763. REN ו-RAN הן הגבלות ורישוי, לא איסור בנייה מוחלט — לשתיהן מסלולי חריג בחוק (DL 166/2008, DL 73/2009).':
    'Source: Direção-Geral do Território (DGT), CC BY 4.0. The area is clipped to the unit boundary in CAOP 2025, in the EPSG:3763 projection. REN and RAN are restrictions and licensing, not an outright ban on building — both have exception routes in law (DL 166/2008, DL 73/2009).',
  'לכל עירייה תיחום משלה, חוק משלה ושנת ייחוס משלה. לחיצה על מספר פותחת את רשומת המקור המלאה.':
    'Each municipality has its own delimitation, its own law and its own reference year. Tapping a number opens the full source record.',
  '<button class="now" data-go="district">מחוז פורטו</button>':
    '<button class="now" data-go="district">Porto District</button>',
  'חקלאית':
    'Agricultural',
  'אקולוגית':
    'Ecological',
  'משותפת':
    'Both',
  'מגבלת בנייה חקלאית ואקולוגית':
    'Agricultural and ecological building restrictions',
  'שתי שכבות שקובעות איפה הבנייה מוגבלת בשל עתודת הקרקע החקלאית הלאומית ורשת העתודה האקולוגית הלאומית. הן חופפות זו לזו, ולכן שני השיעורים אינם מתחברים — ״סך הכול״ הוא האיחוד.':
    'Two layers that decide where building is restricted on account of the National Agricultural Reserve and the National Ecological Reserve. They overlap each other, so the two shares do not add up — "total" is the union.',
  'סך המגבלות, בקיזוז החפיפה':
    'Total restricted, net of the overlap',
  'מגבלה חקלאית (RAN)':
    'Agricultural restriction (RAN)',
  'מגבלה אקולוגית (REN)':
    'Ecological restriction (REN)',
  'בשתי השכבות':
    'Inside both layers',
  'בוחר הקבצים לא החזיר קובץ. ':
    'The file picker returned no file. ',
  'הקובץ נבחר אך לא הגיע לעמוד. ':
    'The file was chosen but never reached the page. ',
  'לא נבחר קובץ.':
    'No file was chosen.',
  'הבוחר נסגר בלי לחזור לאפליקציה. זה קורה כשאנדרואיד סוגר את האפליקציה בזמן שהבוחר פתוח; נסו שוב.':
    'The picker closed without returning to the app. That happens when Android '
    + 'shuts the app down while the picker is open; try again.',
  'הבוחר חזר בלי קובץ.':
    'The picker came back with no file.',
  'בחירת הקובץ נכשלה.':
    'Choosing the file failed.',
});
