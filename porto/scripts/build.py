#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the app's processed data from data/raw/.

Inputs (all under data/raw/):
  pdf_source/porto_pages.py    PROFILES  - the 18 municipality profile texts
  pdf_source/porto_freg2.py    BELTS, TRANSPORT
  pdf_source/porto_freg3.py    FREG3     - 140 parishes: Hebrew, English, pop 2021, note
  pdf_source/porto_city.py     PORTO_FREG, BAIRROS - Porto city quarters and bairros
  pdf_source/porto_map.py      DIST      - straight-line distance to Porto
  caop2020_porto_*.geojson     official boundaries, 18 municipalities + 243 parishes
  census2021_freguesias_collected.json   the 131 parish populations the PDF was missing
  hebrew_translit_new.json     Hebrew names for those 103 newly added parishes
  freguesia_notes_app.json     descriptions for the 103 parishes the PDF never described
  osm/porto_freguesias.geojson OSM: Porto city parishes + 190 neighbourhood places

Outputs (data/processed/ and data/sources.json).  Nothing is invented: a field
that has no verified value is simply absent, and the UI renders "אין נתון".

Confidence
----------
Every value belongs to one of three levels, defined in scripts/ingest_overpass.py:
"verified" (cross-checked against a second source), "reported" (one source says
so) and "approx" (derived or proxied, never a measurement).  Anything below
"verified" carries a note saying what is uncertain, and the line that produces
it carries a comment saying the same.  Search this file for CONFIDENCE.
"""
import csv
import hashlib
import json
import itertools
import math
import os
import re
import sys
import unicodedata
from datetime import date

from geographiclib.geodesic import Geodesic
from shapely.geometry import Point, shape, mapping

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "processed")
sys.path.insert(0, os.path.join(RAW, "pdf_source"))

import porto_pages          # noqa: E402
import porto_freg2          # noqa: E402
import porto_freg3          # noqa: E402
import porto_city           # noqa: E402

MUNICIPALITIES = [
    "Porto", "Vila Nova de Gaia", "Matosinhos", "Maia", "Gondomar", "Valongo",
    "Vila do Conde", "Póvoa de Varzim", "Santo Tirso", "Trofa", "Paredes",
    "Penafiel", "Paços de Ferreira", "Lousada", "Felgueiras", "Amarante",
    "Marco de Canaveses", "Baião",
]
NUM = {name: i for i, name in enumerate(MUNICIPALITIES, 1)}

# Straight-line distance to central Porto, in km, as printed in the PDF.
# Parsed out of pdf_source/porto_map.py so the two can never drift apart.
def read_dist():
    txt = open(os.path.join(RAW, "pdf_source", "porto_map.py"), encoding="utf-8").read()
    block = re.search(r"^DIST\s*=\s*\{(.*?)\}", txt, re.S | re.M).group(1)
    return {int(k): float(v) for k, v in re.findall(r"(\d+)\s*:\s*\"([\d.]+) km\"", block)}


# ---------------------------------------------------------------- geometry ---
def ring_area(coords):
    """Geodesic area of a lon/lat ring on the WGS84 ellipsoid, in m^2.

    Matches the areas DGT publishes for CAOP to the last printed digit
    (Porto 41.42, Amarante 301.33, Baiao 174.52 km^2).
    """
    poly = Geodesic.WGS84.Polygon()
    pts = list(coords)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    for lon, lat in ((p[0], p[1]) for p in pts):
        poly.AddPoint(lat, lon)
    _n, _perimeter, area = poly.Compute(False, True)
    return abs(area)


def geom_area_km2(geom):
    """Area of a (Multi)Polygon in km^2, holes subtracted."""
    polys = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    total = 0.0
    for p in polys:
        total += abs(ring_area(list(p.exterior.coords)))
        for hole in p.interiors:
            total -= abs(ring_area(list(hole.coords)))
    return total / 1e6


def label_point(geom):
    """The point inside the shape that is farthest from its edge.

    ``representative_point`` only promises to land inside the polygon: GEOS
    takes a horizontal line through the shape and returns the middle of one
    crossing, so on a bent or lobed municipality the label can sit right up
    against a border — Penafiel's ``5`` did.  What a label wants is the pole of
    inaccessibility: the most interior point there is, which is what reads as
    optically centred.

    This is Mapbox's polylabel — a grid of square cells in a priority queue,
    each split in four while its best possible distance still beats the best
    point found so far.  On a MultiPolygon the label belongs in the largest
    part; the small islands are not where the name goes.
    """
    import heapq

    polys = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    poly = max(polys, key=lambda p: p.area)
    boundary = poly.boundary
    minx, miny, maxx, maxy = poly.bounds
    w, h = maxx - minx, maxy - miny
    size = min(w, h)
    if size == 0:
        return poly.representative_point()

    def signed(x, y):
        """Distance to the edge — negative outside, so cells outside lose."""
        pt = Point(x, y)
        d = boundary.distance(pt)
        return d if poly.contains(pt) else -d

    def cell(x, y, half):
        d = signed(x, y)
        # the most any point in this cell could be worth
        return (-(d + half * math.sqrt(2)), next(seq), x, y, half, d)

    # The walk is over the cells' left and bottom edges, not their centres: step
    # by centre and the last column and row fall outside the loop, which loses a
    # whole cell of the shape along two sides. Guilhufe e Urrô's label landed
    # 15% short of the roomiest spot that way, and check 7h is what said so.
    seq = itertools.count()
    queue = []
    half = size / 2.0
    x = minx
    while x < maxx:
        y = miny
        while y < maxy:
            heapq.heappush(queue, cell(x + half, y + half, half))
            y += size
        x += size

    best = poly.representative_point()
    best_d = signed(best.x, best.y)
    start = poly.centroid
    if poly.contains(start):
        d = signed(start.x, start.y)
        if d > best_d:
            best, best_d = start, d

    # a hundredth of the shape is close enough for a label; it stops the queue
    precision = size / 100.0
    while queue:
        bound, _, x, y, half, d = heapq.heappop(queue)
        if d > best_d:
            best, best_d = Point(x, y), d
        if -bound - best_d <= precision:
            continue
        q = half / 2.0
        for dx, dy in ((-q, -q), (q, -q), (-q, q), (q, q)):
            heapq.heappush(queue, cell(x + dx, y + dy, q))
    return best


# What the app actually draws. The label has to be centred on that shape and not
# on the source polygon: at these tolerances a border moves by up to a hundred
# metres, which is the same order as the clearance that decides whether a number
# touches the line it sits next to.
SIMPLIFY_MUN = 0.0006
SIMPLIFY_FRE = 0.0004


def simplify_geom(geom, tol):
    g = geom.simplify(tol, preserve_topology=True).buffer(0)
    return geom if g.is_empty else g


def simplify(geom, tol, ndigits=5):
    g = simplify_geom(geom, tol)
    return json.loads(json.dumps(mapping(g)), parse_float=lambda s: round(float(s), ndigits))


# ------------------------------------------------------------ name matching ---
_STOP = {"de", "do", "da", "dos", "das", "e"}


def norm(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"\buniao (?:das|de) freguesias (?:de|da|do)?\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(w for w in s.split() if w not in _STOP)


def jaccard(a, b):
    ta, tb = set(norm(a).split()), set(norm(b).split())
    return len(ta & tb) / max(1, len(ta | tb))


def match_one(label, pool):
    best, score = None, 0.0
    for cand in pool:
        s = jaccard(label, cand)
        if s > score:
            best, score = cand, s
    return best, score


# --------------------------------------------------------------- indicators ---
# The indicators the app can colour the map by.  Everything the PDF project was
# missing (median age, income, share of foreign residents, registered crime,
# EUR/m2) arrives through data/raw/extra_indicators.json, which the fetch_*
# scripts write when they are run on a machine with open network access.  Until
# then the indicator is simply absent and the UI says "אין נתון".
BASE_INDICATORS = [
    {"key": "pop2021", "label_he": "מספר תושבים", "unit": "נפש",
     "reference_year": 2021, "source_he": "מפקד INE 2021",
     "decimals": 0, "high_is": "neutral", "levels": ["municipio", "freguesia"]},
    {"key": "density", "label_he": "צפיפות אוכלוסין", "unit": "נפש/קמ״ר",
     "reference_year": 2021, "source_he": "נגזר: אוכלוסייה 2021 / שטח CAOP 2020",
     "decimals": 0, "high_is": "neutral", "levels": ["municipio", "freguesia"]},
    {"key": "area_km2", "label_he": "שטח", "unit": "קמ״ר",
     "reference_year": 2020, "source_he": "CAOP 2020 (DGT), שטח גיאודזי",
     "decimals": 1, "high_is": "neutral", "levels": ["municipio", "freguesia"]},
    {"key": "dist_porto_km", "label_he": "מרחק אווירי מפורטו", "unit": "ק״מ",
     "reference_year": None, "source_he": "המסמך המקורי (porto_map.py, DIST)",
     "decimals": 1, "high_is": "low", "levels": ["municipio"]},
]

# Indicators the brief asks for but which nothing verified could be found for.
# Listed so the UI can show them as explicitly missing rather than hide them.
PENDING_INDICATORS = [
    {"key": "foreign_pct", "label_he": "אחוז תושבים זרים", "unit": "%",
     "fetch": "scripts/import_censos_seccoes.py",
     "levels": ["municipio", "freguesia"]},
    {"key": "median_age", "label_he": "גיל חציוני", "unit": "שנים",
     "fetch": "scripts/import_censos_seccoes.py", "levels": ["municipio", "freguesia"],
     "warning_he": "אם קובץ המפקד מפרסם גיל חציוני — זה הערך שלו. אם יש בו רק פסי "
                   "גיל, הערך מחושב באינטרפולציה ומסומן כמקורב; ובפסים הרחבים של "
                   "INE (25–64) הסקריפט מסרב לחשב."},
    # A real median, and named for what it is a median OF.  "הכנסה חציונית"
    # would say the median income of a household; what INE publishes is the
    # median of the gross income DECLARED to the tax authority per fiscal
    # household, which is a narrower thing.
    {"key": "median_income",
     "label_he": "ערך חציוני של הכנסה ברוטו מוצהרת למשק בית פיסקאלי",
     "unit": "€", "decimals": 0, "high_is": "neutral",
     "fetch": "scripts/fetch_ine.py --varcd 0012712 --period S7A2024",
     "levels": ["municipio"],
     "note_he": "הכנסה שנתית ברוטו כפי שהוצהרה לרשות המסים, החציון על פני "
                "משקי הבית הפיסקאליים בעירייה. מ-2018 המידע מיוחס לעירייה של "
                "מען המס של הנישום ואינו כולל תושבי חוץ.",
     "warning_he": "לא ההכנסה הכוללת של משק הבית ולא הכנסה נטו. מי שאינו מגיש "
                   "דוח אינו נספר."},
    # Arrived 2026-09-12 from INE, not from PORDATA: dados.gov.pt carries the
    # varcd for every INE indicator, which is what made it findable at all.
    {"key": "crimes_per_1000", "label_he": "עבירות רשומות לאלף תושבים", "unit": "לאלף",
     "fetch": "scripts/fetch_ine.py --varcd 0012260 --period S7A2024 --dim dim_3=T",
     "levels": ["municipio"], "decimals": 1, "high_is": "low",
     "warning_he": "סך העבירות הרשומות — לא ׳פשיעה חמורה׳. RASI מפרסמת criminalidade "
                   "violenta e grave לפי מחוז ופיקוד משטרתי בלבד, ולא לפי עירייה.",
     "note_he": "המדד הוא Taxa de criminalidade של INE, בקטגוריה Total. המפיק "
                "הוא המנהל הכללי למדיניות המשפט (DGPJ), וההערה של INE מפרטת "
                "אילו גופים נכללים בסכום: PJ, PSP, GNR, AT, PM, PJM, ASAE, "
                "ו-SEF עד 2023 — וגם עבירות שמיקומן אינו ידוע או אינו ניתן "
                "לסיווג, שנרשמו בידי גופים הפועלים ברמה ארצית.",
     "caveat_he": "נתוני 2021–2025 עודכנו בעקבות עדכון אומדני האוכלוסייה "
                  "השנתיים שפרסם INE ב-22 ביוני 2026. ערכי 2025 ארעיים, ולכן "
                  "מוצגת כאן שנת 2024."},
    # The four INE housing-market series.  scripts/import_ine_habitacao.py writes
    # them; the labels and the twelve-month-window caveat travel in their meta,
    # so nothing here restates what INE publishes.  INE gives a parish figure for
    # eleven of the eighteen municipalities only — the parishes of the other
    # seven stay empty rather than inherit their municipality's median.
    {"key": "price_eur_m2", "label_he": "ערך חציוני של מכירות דירות למ״ר",
     "unit": "€/מ״ר", "fetch": "scripts/import_ine_habitacao.py",
     "levels": ["municipio", "freguesia"]},
    {"key": "price_new_eur_m2", "label_he": "ערך חציוני של מכירות דירות חדשות למ״ר",
     "unit": "€/מ״ר", "fetch": "scripts/import_ine_habitacao.py",
     "levels": ["municipio", "freguesia"]},
    {"key": "price_used_eur_m2", "label_he": "ערך חציוני של מכירות דירות קיימות למ״ר",
     "unit": "€/מ״ר", "fetch": "scripts/import_ine_habitacao.py",
     "levels": ["municipio", "freguesia"]},
    {"key": "rent_eur_m2", "label_he": "ערך חציוני של שכר דירה בחוזים חדשים למ״ר",
     "unit": "€/מ״ר", "fetch": "scripts/import_ine_habitacao.py",
     "levels": ["municipio", "freguesia"]},
    # One INE Censos 2021 download fills all five of these at once, for the 18
    # municipalities and the 243 freguesias together.
    {"key": "ageing_index", "label_he": "מדד הזדקנות", "unit": "65+/0-14 ×100",
     "fetch": "scripts/import_censos_seccoes.py", "levels": ["municipio", "freguesia"]},
    {"key": "pct_65plus", "label_he": "אחוז בני 65+", "unit": "%",
     "fetch": "scripts/import_censos_seccoes.py", "levels": ["municipio", "freguesia"]},
    {"key": "pct_0_14", "label_he": "אחוז בני 0–14", "unit": "%",
     "fetch": "scripts/import_censos_seccoes.py", "levels": ["municipio", "freguesia"]},
    # INE computes the change itself and publishes it on the 2021 census
    # geography, which is what makes a parish figure possible at all: the 2011
    # parishes are not the 2021 parishes, so we could not have derived it.
    {"key": "pop_growth_pct", "label_he": "שינוי באוכלוסייה בין מפקד 2011 למפקד 2021",
     "unit": "%", "decimals": 1, "high_is": "neutral",
     "fetch": "scripts/fetch_ine.py --varcd 0012272 --period S7A2021 "
              "--dim dim_3=T --dim dim_4=T --freguesias",
     "levels": ["municipio", "freguesia"],
     "note_he": "השינוי כפי ש-INE מפרסמת אותו, לא כפי שחושב כאן. גאוגרפיית "
                "מפקד 2021, שני המינים, כל קבוצות הגיל."},
    {"key": "education_pct", "label_he": "בעלי השכלה גבוהה", "unit": "%",
     "fetch": "scripts/import_censos_seccoes.py", "levels": ["municipio", "freguesia"]},
    {"key": "unemployment_pct", "label_he": "אבטלה", "unit": "%",
     "fetch": "scripts/import_censos_seccoes.py", "levels": ["municipio", "freguesia"]},
]


def load_extra():
    """Optional file written by the fetch_* scripts.  Absent by default."""
    path = os.path.join(RAW, "extra_indicators.json")
    if not os.path.exists(path):
        return {}
    return json.load(open(path, encoding="utf-8"))


def read_dem():
    """Elevation and mean slope per unit, from Copernicus DEM GLO-30.

    Written by scripts/fetch_dem.py, which needs rasterio and 81 MB of tiles;
    a build needs neither, because the measuring already happened and what is
    left is a table keyed on DICOFRE.

    Absent, the build carries on and the fields render "אין נתון" like any
    other missing value — the tiles are a re-fetchable source, not a part of
    the repository.
    """
    path = os.path.join(RAW, "elevation_dem.json")
    if not os.path.exists(path):
        print("  elevation_dem.json missing — no elevation, no slope")
        return {}, {}
    doc = json.load(open(path, encoding="utf-8"))
    def by_code(rows):
        return {str(r["code"]): r for r in rows if r.get("code")}
    return by_code(doc.get("municipios", [])), by_code(doc.get("freguesias", []))


def read_ine_series(named_here):
    """Every quarter INE published, for every unit THIS ATLAS holds.

    Move א׳ of docs/INFORMATION-PLAN.md.  Until 2.0.9 the app showed ONE
    quarter of these two indicators — the latest — and the other twenty-five
    were read, parsed and thrown away on every build.  Measured before the
    change: 6,058 published values across the 84 units of this district that
    INE publishes for (18 municipalities and 66 parishes), of which the app
    showed the last quarter of four fields.

    2.0.9 packed all of Portugal here — 706 units, 49,897 values, 115 KB
    gzipped — to feed a national comparison level.  **2.1.0 took that out at
    the user's decision**: a level that can hold price and rent and nothing
    else was not worth its screen, and 100 KB of the 115 were about units this
    atlas does not draw.  The withdrawal is recorded in INFORMATION-PLAN.md
    under move א׳ and in ARCHITECTURE.md §5.6.7 rather than erased, because
    what was built and why it was dropped is worth more than a tidy history.
    The district's own twenty-six quarters — the thing the move was for — stay.

    Four decisions, and each of them is a rule of the accuracy contract:

    1.  **A quarter with no value is a HOLE, not a continuation.**  INE marks
        it `-`, which its own metadata defines as `Dado nulo ou não aplicável`.
        The arrays here are aligned to `periods` and carry `null` there, so a
        gap in the line is a gap on the screen.  No interpolation, no last
        known value, no smoothing (rule 2).
    2.  **No quarter-over-quarter change is derived, here or anywhere.**  Every
        point is the median of the TWELVE MONTHS ending in that quarter, so two
        neighbouring points share nine months of the same sales and their
        difference is not a quarterly change.  ARCHITECTURE.md §11 has carried
        that trap since 1.25.0; the only non-overlapping comparison is four
        quarters apart.
    3.  **The wording is INE's own**, taken from data/raw/ine/fetch_report.json
        rather than retyped: `Valor mediano das vendas… (€/ m²)` is a median
        VALUE of sales, not a market price and not a valuation (rule 4).
    4.  **No name is carried here at all.**  Every unit in this file is one
        the app already holds a Hebrew and a Portuguese name for, and a second
        copy of a name is a second thing that can drift.  A unit INE publishes
        for that this atlas does not draw — every parish outside the district,
        and the unions of 2013 that the 2025 reform dissolved — is simply not
        in the file: it has no screen to appear on.
    """
    files = [("ine_precos_venda.csv", {"Total": "sale", "Novos": "sale_new",
                                       "Existentes": "sale_used"}),
             ("ine_rendas.csv", {"": "rent"})]
    report = {}
    rpath = os.path.join(RAW, "ine", "fetch_report.json")
    if os.path.exists(rpath):
        for rec in json.load(open(rpath, encoding="utf-8")):
            report[rec["file"]] = rec

    periods, rows = set(), []
    for name, series_of in files:
        path = os.path.join(RAW, "ine", name)
        if not os.path.exists(path):
            warnings.append("no %s — the quarterly series are not in this build" % name)
            return None
        with open(path, encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if r["geo_level"] not in ("municipio", "freguesia"):
                    continue          # nuts2, nuts3, continente and país are not units here
                # The periods come from the whole file on purpose: the axis is
                # INE's publication calendar, not this district's coverage, so a
                # quarter in which nothing local was published is still a
                # quarter — and it shows as a hole rather than closing the gap.
                periods.add(r["period"])
                if r["flag"] == "-" or r["value_eur_m2"] == "":
                    continue          # the marker is the absence; it is not a value
                key = ("m" if r["geo_level"] == "municipio" else "f") + r["dicofre"]
                if key not in named_here:
                    continue          # not a unit this atlas draws
                rows.append((r, series_of[r["dwelling_type"]]))
    periods = sorted(periods)
    at = {p: i for i, p in enumerate(periods)}

    units, n_values = {}, 0
    for r, field in rows:
        key = ("m" if r["geo_level"] == "municipio" else "f") + r["dicofre"]
        u = units.setdefault(key, {"lv": key[0]})
        arr = u.setdefault(field, [None] * len(periods))
        v = float(r["value_eur_m2"])
        arr[at[r["period"]]] = int(v) if v.is_integer() else round(v, 2)
        n_values += 1

    return {
        "meta": {
            "source_he": "‏INE — שני אינדיקטורים רבעוניים, בניסוח של INE עצמה",
            "datasets": {k: v.get("dataset") for k, v in sorted(report.items())},
            "indicator_codes": {k: v.get("indicator_code") for k, v in sorted(report.items())},
            "publication_date": {k: v.get("publication_date") for k, v in sorted(report.items())},
            "retrieved": min([v.get("extracted", "")[:10] for v in report.values()] or [""]),
            "confidence": "reported",
            "window_he": "כל נקודה היא החציון של שנים-עשר החודשים שמסתיימים ברבעון "
                         "הנקוב, ולא של הרבעון עצמו. שני רבעונים סמוכים חולקים "
                         "תשעה חודשים, ולכן אין ולא יוצג שינוי רבעוני.",
            "missing_he": "רבעון שאין בו ערך הוא חור בקו. ‏INE מסמנת אותו `-`, "
                          "שמשמעותו במטא-נתונים שלה ״נתון ריק או לא ישים״, וזה כל "
                          "מה שהמקור אומר.",
            "levels": ["municipio", "freguesia"],
            "district": "13",   # every Porto-district DICOFRE starts here
            "scope_he": "יחידות מחוז פורטו בלבד — אלה שהאפליקציה מציירת. "
                        "‏INE מפרסם את שתי הסדרות לכל המדינה, וגרסה 2.0.9 ארזה "
                        "את כולן כדי להזין רמת השוואה ארצית; היא בוטלה ב-2.1.0.",
            "units": len(units),
            "values": n_values,
            "series": ["sale", "sale_new", "sale_used", "rent"],
        },
        "periods": periods,
        "units": {k: units[k] for k in sorted(units)},
    }


def read_tipau():
    """INE's urban-area typology, one class per parish: APU, AMU or APR.

    The file is the category export of version V05635 (TIPAU 2025) from INE's
    meta-information system, written by scripts/fetch_tipau.py.  Three levels:
    the typology, the named urban area inside a municipality, and the parish
    with its six-digit code.  Only the parish rows are read, and only their
    code and the typology above them.

    TIPAU 2025 stands on CAOP 2020, so the 57 parishes the 2025 reform created
    have no row and get no value — the class of the union they came out of is
    the union's, not theirs (rule 2).  The 25 dissolved unions do have rows and
    simply find no parish to attach to.
    """
    path = os.path.join(RAW, "ine", "tipau2025_v05635.csv")
    if not os.path.exists(path):
        return {}
    out, cur = {}, None
    with open(path, encoding="utf-8", newline="") as fh:
        rows = list(csv.reader(fh))
    start = next(i for i, r in enumerate(rows) if r and r[0] == "Nível") + 1
    for r in rows[start:]:
        if len(r) < 2:
            continue
        if r[0] == "1":
            cur = r[1]
        elif r[0] == "3" and cur in ("APU", "AMU", "APR"):
            out[r[1]] = cur
    return out


def load_raw(name):
    """Optional raw file produced by ingest_overpass.py."""
    path = os.path.join(RAW, name)
    if not os.path.exists(path):
        return None
    return json.load(open(path, encoding="utf-8"))


# ----------------------------------------------------------- app palettes ---
def read_mcol():
    """The 18 municipality colours the PDF prints, read out of porto_map.py.

    Reusing them means the app and the printed page show the same district.
    """
    txt = open(os.path.join(RAW, "pdf_source", "porto_map.py"), encoding="utf-8").read()
    block = re.search(r"^MCOL\s*=\s*\{(.*?)\}", txt, re.S | re.M).group(1)
    return {int(k): v for k, v in re.findall(r"(\d+)\s*:\s*\"(#[0-9A-Fa-f]{6})\"", block)}


def read_caop2025():
    """CAOP 2025 as the parish layer, in the shape the build already expects.

    Until now the parishes were CAOP 2020 — the 2013 division — and a parish
    was found by matching its name against the source document. A name is how
    the document refers to a place; DICOFRE is how the state does, and it is
    what every INE series joins on. Matching on the code removes a whole class
    of failure at once: two parishes called Lordelo in different
    municipalities, an accent written two ways, a União whose members are
    listed in a different order.

    The 2025 division is also simply the current one. 25 of this district's
    units were dissolved back into 57 separate parishes in 2025, and an app
    drawing the 2013 boundaries draws a map that no longer matches the
    addresses on the doors.
    """
    path = os.path.join(RAW, "dgt", "caop_freguesias.geojson")
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    out = []
    for ft in raw["features"]:
        pr = ft["properties"]
        code = pr.get("dtmnfr") or ""
        if not code.startswith("13"):
            continue
        mun = pr["municipio"]
        out.append({"type": "Feature",
                    "properties": {"mun_num": NUM[mun], "mun": mun,
                                   "name": pr["freguesia"], "dtmnfr": code},
                    "geometry": ft["geometry"]})
    return {"type": "FeatureCollection", "features": out}


CONS_KEYS = ("area_ha", "ran_ha", "ran_pct", "ren_ha", "ren_pct",
             "both_ha", "both_pct", "either_ha", "either_pct",
             "ran_year", "ran_law", "ren_year", "ren_law")


def read_constraints():
    """How much of each unit is inside REN and inside RAN.

    Built by scripts/build_constraints.py against CAOP 2025 in EPSG:3763, and
    read here rather than recomputed: it is a 50-second overlay of 1.56 million
    vertices and it only changes when the DGT layers do.

    A unit whose municipality has no published delimitation carries no key for
    that layer at all, so the app renders אין נתון and never a zero. That is
    Porto for both reserves, and Vila do Conde for REN."""
    raw = load_raw("constraints_caop2025.json")
    if not raw:
        return {}, {}
    pick = lambda d: {k: {x: v[x] for x in CONS_KEYS if x in v} for k, v in d.items()}
    return pick(raw.get("municipios", {})), pick(raw.get("freguesias", {}))


# CRUS speaks the vocabulary of the Portuguese planning law, and every one of
# these is the source's own term.  The Hebrew beside each is a translation and
# never a reading: `Solo Rústico` is not "agricultural land" — it is everything
# outside the urban perimeter, which includes forest, quarries and scattered
# housing — and `Discrepância` is the source's own name for ground its own
# harmonisation did not reconcile.  A term with no line here stops the build
# rather than reaching a screen in Portuguese or, worse, in a guess.
CRUS_HE = {
    # The classes.  There are five in this district and not two: besides the
    # pair the law is built on, DGT also publishes a transitional urbanisable
    # class, a class for ground its own harmonisation did not reconcile, and
    # one for ground it did not assign.  Folding any of them into `Solo Urbano`
    # or `Solo Rústico` would be this project answering a question the source
    # left open.
    "Solo Urbano": "קרקע עירונית",
    "Solo Rústico": "קרקע לא-עירונית",
    "Solo Urbano (urbanizável – transitório)":
        "קרקע עירונית — מיועדת לעיור, הוראת מעבר",
    "Não Atribuída": "לא שויכה",
    # the categories, as DGT writes them
    "Espaço Florestal": "שטח יער",
    "Espaço Agrícola": "שטח חקלאי",
    "Espaço Natural e Paisagístico": "שטח טבעי ונופי",
    "Aglomerado Rural": "מקבץ כפרי",
    "Área de Edificação Dispersa": "אזור בנייה מפוזרת",
    "Espaço Habitacional": "שטח מגורים",
    "Espaço Central": "שטח מרכזי",
    "Espaço de Atividades Económicas": "שטח לפעילות כלכלית",
    "Espaço Urbano de Baixa Densidade": "שטח עירוני בצפיפות נמוכה",
    "Espaço Verde": "שטח ירוק",
    "Espaço de Uso Especial Equipamentos e Infraestruturas":
        "שטח לשימוש מיוחד — מוסדות ותשתיות",
    "Espaço de Uso Especial - Turístico": "שטח לשימוש מיוחד — תיירות",
    "Espaço de Equipamentos e Infraestruturas": "שטח מוסדות ותשתיות",
    "Espaço Cultural": "שטח תרבות",
    "Espaço de Exploração de Recursos Energéticos e Geológicos":
        "שטח להפקת משאבי אנרגיה וגאולוגיה",
    "Espaço de Atividades Industriais": "שטח לפעילות תעשייתית",
    "Espaço de Ocupação Turística": "שטח לתפוסה תיירותית",
    "Espaço Agrícola ou Florestal (transitório)":
        "שטח חקלאי או יערני — הוראת מעבר",
    "Discrepância": "אי-התאמה",
}

# The class each colour on the card belongs to is the app's business; what the
# build owes is the order, and the order is the source's: largest first.

# Below this share of the municipality a category is still listed, because the
# list is the source's own and dropping its tail would be an edit; the app
# decides how many rows to draw, not the build.
def read_crus():
    """The land-use regime of each municipality, as hectares per class.

    Written by scripts/import_crus.py from DGT's CRUS. The polygons are not
    here and will not be: 15,194 of them, 369 MB of GeoJSON for this district.
    What is here is DGT's own published `area_ha` for each of them, added up —
    so the hectares are sums of published values and the shares are computed
    against CRUS's own total for that municipality, never against a boundary
    from another source. That leaves the comparison with CAOP's area a real
    cross-check, which checks.py makes.

    The reference year is the publication date of that municipality's PDM, and
    they range across a decade: there is no single CRUS year, exactly as there
    is no single REN year."""
    raw = load_raw("crus_porto.json")
    if not raw:
        return {}
    out = {}
    for code, rec in raw.get("municipios", {}).items():
        total = rec.get("total_ha") or 0
        if not total:
            continue
        classes = rec.get("classes", {})
        unknown = [k for k in classes if k not in CRUS_HE]
        unknown += [c["categoria"] for c in rec.get("categorias", [])
                    if c["categoria"] not in CRUS_HE]
        if unknown:
            sys.exit("CRUS term with no Hebrew in CRUS_HE (scripts/build.py): "
                     + ", ".join(sorted(set(unknown))))
        pct = lambda ha: round(100.0 * ha / total, 1)
        out[code] = {
            "total_ha": rec["total_ha"],
            "polygons": rec["polygons"],
            # No "urban vs rural" pair.  A headline of two numbers over five
            # classes is a summary this project is not entitled to write: the
            # transitional class is neither, and `Não Atribuída` is the source
            # saying it does not know.  The classes are listed as they are.
            "classes": [{"pt": k, "lbl": CRUS_HE[k], "ha": round(v, 1),
                         "pct": pct(v)}
                        for k, v in sorted(classes.items(), key=lambda kv: -kv[1])],
            "pdm_year": rec.get("pdm_year"),
            "pdm_date": rec.get("pdm_date"),
            "registo": rec.get("registo_ou_deposito"),
            "situacao": rec.get("situacao_pdm"),
            "escala": rec.get("escala_origem"),
            # NOT "he".  Check 7o skips a key called `he` because those are
            # place names that stay Portuguese in English; a category label is
            # a translated term and has to reach prose_en.json like every other
            # string on the screen.  Named `lbl`, it does.
            "cats": [{"pt": c["categoria"], "lbl": CRUS_HE[c["categoria"]],
                      "cls": c["classe"], "cls_lbl": CRUS_HE[c["classe"]],
                      "ha": c["ha"], "pct": pct(c["ha"])}
                     for c in rec.get("categorias", [])],
        }
    return out


def read_censos_2025():
    """The 2021 census rebuilt on the 2025 boundaries, by DICOFRE.

    Written by import_censos_2025.py from BGRI subsections. A missing file is
    fatal rather than quiet: the 2025 layer without it would draw 275 parishes
    of which 57 had no population at all, and a map that silently loses a
    quarter of a million people is worse than one that refuses to build.
    """
    path = os.path.join(RAW, "censos2021_caop2025.json")
    if not os.path.exists(path):
        sys.exit("missing %s — run scripts/import_censos_2025.py" % path)
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)
    return d["freguesias"], d.get("municipios", {})


def read_translit_2025():
    """Hebrew for the 57 parishes the 2025 reform created."""
    path = os.path.join(RAW, "hebrew_translit_2025.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["names"]


def read_official_codes():
    """The official DICOFRE code of every parish, from ingest_freguesia_codes.py.

    Missing file is not fatal: the app then prints no official number rather
    than a number of its own invention.
    """
    path = os.path.join(RAW, "freguesia_official_codes.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["freguesias"]


# The housing block, as (field, numerator, denominator). A denominator of None
# means the figure is a count and not a share. Every one of these is a Censos
# 2021 variable read straight out of INE's file — nothing here is estimated,
# and a unit missing the denominator simply has no value for that row.
HOUSING = [
    ("dwellings", ["N_ALOJAMENTOS_FAMILIARES"], None),
    ("vacant_pct", ["N_ALOJAMENTOS_VAGOS_TOTAL"], "N_ALOJAMENTOS_FAM_CLASSICOS"),
    ("second_home_pct", ["N_ALOJAMENTOS_FAM_CLASS_RES_SECUNDARIA"],
     "N_ALOJAMENTOS_FAM_CLASSICOS"),
    ("owner_pct", ["N_RHABITUAL_PROP_OCUP"], "N_CLASSICOS_RES_HABITUAL"),
    ("rented_pct", ["N_RHABITUAL_ARRENDADOS"], "N_CLASSICOS_RES_HABITUAL"),
    ("parking_pct", ["N_RHABITUAL_COM_ESTACIONAMENTO"], "N_CLASSICOS_RES_HABITUAL"),
    ("buildings", ["N_EDIFICIOS_CLASSICOS"], None),
    ("repair_pct", ["N_EDIFICIOS_COM_NEC_REPARACAO"], "N_EDIFICIOS_CLASSICOS"),
    ("deep_repair_pct", ["N_EDIFICIOS_COM_NEC_REPARACAO_PROFUNDAS"],
     "N_EDIFICIOS_CLASSICOS"),
    ("pre1946_pct", ["N_EDIFICIOS_CONSTR_ANTES_1919", "N_EDIFICIOS_CONSTR_1919A1945"],
     "N_EDIFICIOS_CLASSICOS"),
    ("since2011_pct", ["N_EDIFICIOS_CONSTR_2011A2015", "N_EDIFICIOS_CONSTR_2016A2021"],
     "N_EDIFICIOS_CLASSICOS"),
    # No lift row. N_EDIFICIOS_COM_ELEVADOR and N_EDIFICIOS_SEM_ELEVADOR are
    # transposed in INE's file: Baião, where 92% of buildings have one or two
    # floors, comes out with 10 668 of 10 700 buildings "com elevador". The two
    # add up to the total, so the counts are right and only the labels are
    # swapped — but publishing a figure by guessing which header INE meant is
    # exactly what this project does not do. Recorded under "what is missing".
]


def housing_block(census):
    """The eleven housing figures, or nothing at all if the census row is absent."""
    if not census:
        return None
    out = {}
    for field, parts, whole in HOUSING:
        if any(census.get(p) is None for p in parts):
            continue
        top = sum(census[p] for p in parts)
        if whole is None:
            out[field] = top
        elif census.get(whole):
            out[field] = round(100.0 * top / census[whole], 1)
    return out or None


def read_censos():
    """Censos 2021 by DICOFRE, from import_censos_seccoes.py.

    The census is the authority on population: the municipality figure and its
    parishes come out of one file, so they add up. Without it the app falls
    back on the source document and the hand-collected file, which do not.
    """
    path = os.path.join(RAW, "censos2021_ine.json")
    if not os.path.exists(path):
        return {}, {}
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)
    return d.get("municipios", {}), d.get("freguesias", {})


# A ring of pastels for the parishes inside one municipality. Neighbouring
# numbers land on different hues, and every one of them takes dark text.
# The housing block, in the order it is read. One list, used at both levels:
# it was written out twice and adding a field meant editing both, which is how
# a municipality and its parishes come to show different rows.
HOUSING_KEYS = (
    "dwellings", "vacant_pct", "second_home_pct", "owner_pct", "rented_pct",
    "parking_pct", "buildings", "repair_pct", "deep_repair_pct",
    "pre1946_pct", "since2011_pct",
    # how the stock is shaped — floors, what it was built to hold, and whether
    # it is residential and nothing else
    "floors1_2_pct", "floors3plus_pct", "floors3_4_pct", "floors5plus_pct",
    "only_resid_pct", "built1_2_pct", "built3plus_pct",
)

# The four the section file alone can answer: a median needs five-year bands,
# and BGRI carries no education, employment or nationality at all.
SECTION_BOUND = ("median_age", "foreign_pct", "education_pct", "unemployment_pct")

PARISH_PALETTE = [
    "#F6C99A", "#9CC7E8", "#A8D9C9", "#C9DF9B", "#F3AFAF", "#CDB6E0",
    "#F2D98C", "#8FCFD6", "#E9B5CE", "#B9C9EC", "#D8DE93", "#F0BFA0",
]


def number_parishes(freguesias):
    """Give every parish the number and colour the map shows on it.

    Order follows the source document wherever it has one — the seven Porto
    quarters keep the document's own 1-7, municipalities 2-12 keep the order
    of their parish list — and falls back to population, largest first, for
    the six municipalities the document never listed.
    """
    by_mun = {}
    for f in freguesias:
        by_mun.setdefault(f["mun_num"], []).append(f)
    for num, rows in by_mun.items():
        rows.sort(key=lambda f: (f.get("_order", 10 ** 6), -(f.get("pop2021") or 0), f["pt"]))
        for i, f in enumerate(rows, 1):
            f["n"] = i
            f["colour"] = PARISH_PALETTE[(i - 1) % len(PARISH_PALETTE)]
            f.pop("_order", None)


# --- the level-1 outlines: two NUTS III regions and the district ------------
#
# The regions are drawn whole, not clipped to the district: Área Metropolitana
# do Porto runs south into Aveiro and Tâmega e Sousa east into Viseu, and a
# line that stopped at the district edge would be describing something that
# does not exist.  So the geometry comes from CAOP's own NUTS III layer rather
# than from a union of the eighteen municipalities this atlas holds.
#
# Where the two regions meet they share one border, and a single line there
# would have to belong to one of them.  It is split instead: each region's own
# stretch stays on the true boundary, and the shared stretch is drawn twice,
# each copy stepped into its own region so the two run side by side.
#
# THE OFFSET IS IN METRES, WHICH IS A COMPROMISE.  A line drawn a fixed number
# of metres inside another separates by a number of pixels that depends on the
# zoom: OFFSET_M is chosen to read as about one line-width at the zoom level 1
# opens at, and the gap widens if you zoom in.  Doing it properly means
# recomputing the offset in screen space on every zoom, which is a lot of
# machinery for a line; this is the honest version of the cheap answer.
NUTS3_SRC = "caop_nuts3.geojson"
OFFSET_M = 150.0        # each region steps this far in along the shared border
CORRIDOR_M = 600.0      # how close counts as "the same border"
TOUCH_M = 60.0          # tolerance for two boundaries being the same line
SIMPLIFY_M = 20.0       # coordinate thinning, in metres


def _to_metres():
    """CRS84 -> EPSG:3763 (PT-TM06), the projection CAOP itself is published in."""
    from pyproj import Transformer
    fwd = Transformer.from_crs("EPSG:4326", "EPSG:3763", always_xy=True)
    inv = Transformer.from_crs("EPSG:3763", "EPSG:4326", always_xy=True)
    return fwd, inv


def _project(geom, tr):
    from shapely.ops import transform
    return transform(lambda x, y, z=None: tr.transform(x, y), geom)


def belt_outlines(belts, mun_geom, name_of):
    from shapely.geometry import mapping
    from shapely.ops import unary_union
    fwd, inv = _to_metres()

    path = os.path.join(RAW, "dgt", NUTS3_SRC)
    with open(path, encoding="utf-8") as fh:
        src = json.load(fh)
    by_code = {f["properties"]["codigo"]: shape(f["geometry"]).buffer(0)
               for f in src["features"]}

    # belts are listed metropolitan-first; CAOP codes them 11A and 11C
    codes = ["11A", "11C"]
    if set(codes) - set(by_code):
        raise SystemExit("caop_nuts3.geojson is missing %s — run "
                         "scripts/fetch_dgt_ogcapi.py caop_nuts3"
                         % ", ".join(sorted(set(codes) - set(by_code))))

    regions = [_project(by_code[c], fwd) for c in codes]
    district = _project(
        unary_union([mun_geom[name_of[n]] for n in range(1, 19)]).buffer(0), fwd)

    fc = {"type": "FeatureCollection", "features": []}

    def add(geom, props):
        # Simplified in metres, before projecting back: the full CAOP outline
        # of two whole regions is 1.4 MB of coordinates, and this file has to
        # be carried offline.  20 m is a third of a pixel at the zoom level 1
        # opens at, and well under one at any zoom that shows a whole region.
        # Not simplify() — that one buffers, which erases a line.
        if geom.is_empty:
            return
        thin = geom.simplify(SIMPLIFY_M, preserve_topology=True)
        if thin.is_empty:
            thin = geom
        fc["features"].append({
            "type": "Feature", "properties": props,
            "geometry": json.loads(json.dumps(mapping(_project(thin, inv))),
                                   parse_float=lambda v: round(float(v), 5))})

    # the border the two regions share, and a corridor around it
    shared = regions[0].boundary.intersection(regions[1].buffer(TOUCH_M))
    corridor = shared.buffer(CORRIDOR_M) if not shared.is_empty else None

    for i, (belt, poly) in enumerate(zip(belts, regions)):
        base = {"kind": "nuts3", "code": codes[i], "he": belt["he"],
                "en": belt["en"], "colour": belt["colour"], "nums": belt["nums"]}
        # The region as an AREA, not only as a line.  The app fills the chosen
        # region, and until 2.0.1 it filled the region's municipalities INSIDE
        # the district instead — so the colour stopped at the district edge
        # while the outline around it did not.  Same simplification as the
        # outline, so the fill and the line coincide at every zoom.
        add(poly, dict(base, part="area"))
        if corridor is None:
            add(poly.boundary, dict(base, part="solo"))
            continue
        # its own stretch, full width, on the true boundary
        add(poly.boundary.difference(corridor), dict(base, part="solo"))
        # the shared stretch, stepped inside this region, half width
        add(poly.buffer(-OFFSET_M).boundary.intersection(corridor),
            dict(base, part="shared"))

    # No district line.  The district is the outer edge of the eighteen
    # municipalities — `district` above is their union — and the app draws
    # that edge once, as the municipality layer, at the district's weight.
    # Until 2.0.0 this file also emitted the union's boundary, stepped 420 m
    # inside wherever it ran beside a region border: the same fact drawn
    # twice, with a gap that widened as you zoomed in.

    return fc


# The categories always shown; everything else needs a notability signal.
POI_CORE = {"station", "hospital", "university", "museum", "culture", "market"}
POI_CORE = POI_CORE | {"civic"}
POI_LABEL = {"station": "תחנות מטרו ורכבת", "hospital": "בתי חולים",
             "university": "אוניברסיטה והשכלה", "museum": "מוזיאונים וגלריות",
             "culture": "תיאטרון, ספריות ותרבות", "market": "שווקים",
             "landmark": "אתרים ומונומנטים", "green": "פארקים, גנים וחופים",
             "civic": "מוסדות ציבור"}


def city_extras(city):
    """Attach the bairro letters and the POI dots to each Porto quarter."""
    pts = load_raw("bairro_points.json")
    pois = load_raw("pois.json")
    stats = {"letters": 0, "no_point": 0, "pois": 0}

    by_key = {}
    absent, wrong = set(), {}
    if pts:
        for r in pts["items"]:
            by_key[(r["quarter"], r["en"])] = r
        for r in pts.get("not_in_osm", []):
            absent.add((r["quarter"], r["en"]))
        # a name match that landed outside the quarter: the ingest dropped it,
        # and the app says that rather than leaving a blank
        for r in pts.get("wrong_place", []):
            wrong[(r["quarter"], r["en"])] = r["note"]

    selected = []
    if pois:
        for r in pois["items"]:
            # CONFIDENCE: every one of these is "reported" — an OSM coordinate
            # from a single contributor. The record carries that and its note.
            if r["cat"] in POI_CORE or r.get("notable"):
                selected.append(r)

    for q in city:
        for i, b in enumerate(q["bairros"]):
            b["letter"] = letter_at(i)
            hit = by_key.get((q["num"], b["en"]))
            if hit:
                b["ll"] = hit["ll"]
                b["confidence"] = hit["confidence"]
                if hit["confidence"] != "verified":
                    b["note_src"] = hit["note"]
                stats["letters"] += 1
            else:
                # No coordinate: the app lists the bairro and draws no letter.
                b["confidence"] = "none"
                b["note_src"] = ("אין ל" + b["he"] + " נקודה במפה. "
                                 + wrong.get((q["num"], b["en"]),
                                             "לא קיים ב-OpenStreetMap."
                                             if (q["num"], b["en"]) in absent
                                             else "לא נמצאה התאמה בנתוני OSM."))
                stats["no_point"] += 1

        mine = [r for r in selected if r.get("quarter") == q["num"]]
        mine.sort(key=lambda r: (list(POI_LABEL).index(r["cat"]), r["name"]))
        q["pois"] = [{"name": r["name"], "cat": r["cat"], "ll": r["ll"],
                      "osm": r.get("osm", "")} for r in mine]
        stats["pois"] += len(mine)
    return stats


PLACE_HE = {"city": "עיר", "town": "עיירה", "village": "כפר", "hamlet": "כפר קטן",
            "suburb": "פרבר", "quarter": "רובע", "neighbourhood": "שכונה"}
PLACE_RANK = ["city", "town", "village", "suburb", "quarter", "neighbourhood", "hamlet"]


def letter_at(i):
    """A, B, C … Z, AA, AB … AZ, BA … — the label a locality carries on the map.

    Spreadsheet-column order, because one parish (Gondomar São Cosme, Valbom e
    Jovim) holds more than 52 localities and a two-letter scheme that wrapped
    would hand two of them the same label.
    """
    out = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        out = chr(65 + r) + out
    return out


def build_zones(freguesias, city, fre_geom=None):
    """Level 3, for all 243 parishes rather than only Porto's seven.

    Porto keeps the curated material: 53 named neighbourhoods with a Hebrew
    name and a description, from the source document.  Nothing equivalent is
    published for the other 236 parishes and none was invented — what they get
    instead is what OpenStreetMap actually holds: the localities inside the
    parish (a village, a hamlet, a suburb) and the landmarks and services in
    it.  A locality carries no Hebrew name and no description here, because
    nobody wrote one; it carries its Portuguese name and what OSM calls it.
    """
    zones = {}
    stats = {"porto": 0, "osm": 0, "letters": 0, "pois": 0, "empty": 0}

    # Porto: reuse the quarters exactly as they are already built.
    # CAOP prints "União das freguesias de X" where the document prints "X";
    # norm() drops that prefix, so match on it rather than on the raw name.
    q_by_en = {norm(q["en"]): q for q in city}
    for f in freguesias:
        if f["mun_num"] != 1:
            continue
        q = q_by_en.get(norm(f["pt"]))
        if not q:
            continue
        zones["%d|%s" % (f["mun_num"], f["pt"])] = {
            "origin": "pdf", "desc": q.get("desc"),
            "bairros": q["bairros"], "pois": q["pois"],
        }
        stats["porto"] += 1
        stats["letters"] += sum(1 for b in q["bairros"] if b.get("ll"))
        stats["pois"] += len(q["pois"])

    district = load_raw("district_points.json")
    if district:
        # Every point carries a `freg` key that ingest_overpass.py worked out
        # against the 2013 boundaries. On the 2025 division that key is stale:
        # it names a parish that may no longer exist, or one whose edge has
        # moved. Twenty-one letters landed outside the parish they were filed
        # under — Modelos still filed under Paços de Ferreira, 1.1 km away —
        # and a letter drawn outside its own shape is a map that contradicts
        # its own list. The point decides, not the key.
        assign = None
        if fre_geom:
            from shapely.strtree import STRtree
            keys = list(fre_geom)
            shapes = [fre_geom[k] for k in keys]
            tree = STRtree(shapes)

            def assign(ll):
                pt = Point(ll[1], ll[0])
                for idx in tree.query(pt):
                    if shapes[idx].contains(pt):
                        return keys[idx]
                return None

        places, pois, moved, lost = {}, {}, 0, 0
        for r in district["places"]:
            key = (assign(r["ll"]) if assign else None) or r["freg"]
            if assign and key != r["freg"]:
                moved += 1
            if assign and key is None:
                lost += 1
            places.setdefault(key, []).append(r)
        for r in district["pois"]:
            if r["cat"] in POI_CORE or r.get("notable") or r["cat"] == "landmark":
                key = (assign(r["ll"]) if assign else None) or r["freg"]
                pois.setdefault(key, []).append(r)
        stats["moved"] = moved
        stats["lost"] = lost

        for f in freguesias:
            key = "%d|%s" % (f["mun_num"], f["pt"])
            if key in zones:                       # Porto, already done
                continue
            rows = places.get(key, [])
            # biggest first: a village of 900 belongs above a hamlet of 40, and
            # a place with no population tag sorts under one that has it
            rows.sort(key=lambda r: (PLACE_RANK.index(r["kind"]), -(r["pop"] or 0), r["name"]))
            bairros = []
            for i, r in enumerate(rows):
                bairros.append({
                    "letter": letter_at(i), "en": r["name"], "ll": r["ll"],
                    "kind": r["kind"], "kind_he": PLACE_HE[r["kind"]],
                    "pop": r.get("pop"), "osm": r.get("osm", ""),
                    # CONFIDENCE: "reported". One OSM contributor placed this
                    # point; nothing here cross-checks it.
                    "confidence": "reported",
                    "note_src": "נקודת היישוב מ-OpenStreetMap, מקור יחיד.",
                })
            mine = pois.get(key, [])
            mine.sort(key=lambda r: (list(POI_LABEL).index(r["cat"]), r["name"]))
            zones[key] = {
                "origin": "osm", "desc": None,
                "bairros": bairros,
                "pois": [{"name": r["name"], "cat": r["cat"], "ll": r["ll"],
                          "osm": r.get("osm", "")} for r in mine],
            }
            stats["osm"] += 1
            stats["letters"] += len(bairros)
            stats["pois"] += len(mine)
            if not bairros and not mine:
                stats["empty"] += 1
    return zones, stats


# Display layers: the rivers and the open ground.  Both come back from Overpass
# with full geometry, and both arrive far too heavy to ship — 11 MB between them
# — so they are clipped to the district, dropped below a size that would be a
# single pixel anyway, and simplified.  The tolerances are chosen for a map that
# tops out at zoom 19: 20 m on a river bank, 13 m on a park edge.
LAYER_SPECS = [
    ("district_water.geojson", "boundaries_water.geojson", 0.0002, 3000,
     ("waterway", "natural", "water", "landuse")),
]


def layer_geoms(mun_fc):
    """Clip, filter and simplify the water and green exports for the map."""
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    district = unary_union([shape(f["geometry"]).buffer(0) for f in mun_fc["features"]])
    out = {}
    for src, dest, tol, min_m2, tags in LAYER_SPECS:
        path = os.path.join(RAW, src)
        if not os.path.exists(path):
            out[dest] = None
            continue
        doc = json.load(open(path, encoding="utf-8"))
        fc = {"type": "FeatureCollection", "features": []}
        stats = {"kept": 0, "outside": 0, "small": 0}
        for ft in doc["features"]:
            gt = ft["geometry"]["type"]
            if gt == "Point":
                continue
            try:
                g = shape(ft["geometry"])
                if gt in ("Polygon", "MultiPolygon"):
                    g = g.buffer(0)
            except Exception:
                continue
            if g.is_empty or not g.intersects(district):
                stats["outside"] += 1
                continue
            if gt in ("Polygon", "MultiPolygon") and g.area * 111320 * 111320 * 0.56 < min_m2:
                stats["small"] += 1
                continue
            g = g.intersection(district)
            if g.is_empty:
                stats["outside"] += 1
                continue
            g = g.simplify(tol, preserve_topology=True)
            if g.is_empty:
                continue
            p = ft["properties"]
            props = {"name": p.get("name") or ""}
            for t in tags:
                if p.get(t):
                    props["kind"] = "%s=%s" % (t, p[t])
                    break
            fc["features"].append({"type": "Feature", "properties": props,
                                   "geometry": round_geom(mapping(g))})
            stats["kept"] += 1
        out[dest] = (fc, stats)
    return out


def round_geom(g, nd=5):
    """5 decimals is about a metre: past that the file is storing noise."""
    def r(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], nd), round(c[1], nd)]
        return [r(x) for x in c]
    return {"type": g["type"], "coordinates": r(g["coordinates"])}


# ------------------------------------------------------------------- build ---
def main():
    dist_km = read_dist()
    caop_mun = json.load(open(os.path.join(RAW, "caop2020_porto_municipios.geojson")))
    caop_fre = read_caop2025()
    collected = json.load(open(os.path.join(RAW, "census2021_freguesias_collected.json")))
    translit = json.load(open(os.path.join(RAW, "hebrew_translit_new.json")))
    app_notes = load_raw("freguesia_notes_app.json")
    osm = json.load(open(os.path.join(RAW, "osm", "porto_freguesias.geojson")))
    osm_mun = json.load(open(os.path.join(RAW, "osm", "porto_municipios.geojson")))

    # Municipality population, Censos 2021, read off the population tag on the
    # OSM boundary relations.
    # CONFIDENCE: "reported", not "verified" — this is a single source. The tag
    # says Censos 2021 and the values are consistent with it, but nothing here
    # cross-checks them against INE directly; scripts/fetch_ine.py does that on
    # a machine with open network access. The parish sums land 0.00-0.12% below
    # these numbers, which is the gap between INE's publication rounds rather
    # than an error in either. See data/sources.json → municipio.pop2021.
    osm_pop = {}
    osm_ine = {}
    for ft in osm_mun["features"]:
        p = ft["properties"]
        if p.get("admin_level") == "7" and p.get("population"):
            osm_pop[p["name"]] = int(p["population"])
            osm_ine[p["name"]] = p.get("ref:ine")

    mun_geom = {ft["properties"]["name"]: shape(ft["geometry"]).buffer(0)
                for ft in caop_mun["features"]}
    fre_by_mun = {}
    for ft in caop_fre["features"]:
        fre_by_mun.setdefault(ft["properties"]["mun"], []).append(ft)

    warnings = []
    codes = read_official_codes()
    ine_mun, ine_fre = read_censos()
    ine_2025, mun25 = read_censos_2025()
    cons_mun, cons_fre = read_constraints()
    tipau = read_tipau()
    dem_mun, dem_fre = read_dem()
    crus_mun = read_crus()
    app_note_of = {(i["mun_num"], i["pt"]): i["note"] for i in app_notes["items"]}
    translit_2025 = read_translit_2025()
    # what each 2025 parish was part of before the reform, so a new parish can
    # show the figures of the unit it came out of without wearing them
    was_part_of = {}
    for key, rec in codes.items():
        for kid in rec.get("split2025") or []:
            # NUM[mun] is the app's own municipality number and it is NOT the
            # municipality half of the DICOFRE: Póvoa de Varzim is 8 to the app
            # and 13 to the state. Reading one as the other looked up an empty
            # row list and quietly enriched nothing.
            was_part_of[kid["dicofre"]] = {"dicofre": rec["dicofre"],
                                           "pt": rec["pt"],
                                           "mun_num": NUM[rec["mun"]]}
    # The source document describes the 2013 units. A unit that was dissolved
    # is not any one of the parishes that replaced it, so its row must not be
    # matched to one of them — see below.
    born_2025 = set(was_part_of)
    codes_by_dicofre = {v["dicofre"]: v for v in codes.values()}
    MUN_OF = {NUM[m]: m for m in MUNICIPALITIES}

    # What each dissolved unit itself said and counted, so a parish born in
    # 2025 can offer it without wearing it. Paços de Ferreira is why this has
    # no exception for a matching name: the 2013 unit and the 2025 parish are
    # both called Paços de Ferreira, and they are not the same ground — Modelos
    # left. A description written for one is not a description of the other,
    # however well it happens to read.
    # match_one, not exact equality: the document writes "Santa Marinha e S.
    # Pedro da Afurada" where CAOP writes "São Pedro". An exact key missed it
    # and two parishes silently lost the description of the unit they left —
    # the same abbreviation the main loop's matcher has always handled.
    pdf_rows_by_mun = {}
    for num, rows in porto_freg3.FREG3.items():
        pdf_rows_by_mun[num] = {en: {"he": he, "note": note, "pop2021": pop}
                                for he, en, pop, note in rows}
    for kid, before in was_part_of.items():
        mun_num = before.pop("mun_num")
        rows = pdf_rows_by_mun.get(mun_num, {})
        cand, score = match_one(before["pt"], list(rows))
        was = rows[cand] if cand is not None and score >= 0.34 else None
        if was:
            for k in ("he", "note", "pop2021"):
                if was.get(k) is not None:
                    before[k] = was[k]
        app_key = (mun_num, before["pt"])
        if "note" not in before and app_key in app_note_of:
            before["note"] = app_note_of[app_key]
            before["note_origin"] = "app"
        elif "note" in before:
            before["note_origin"] = "pdf"
        # six of the dissolved units are among the 103 whose Hebrew was written
        # for the app rather than taken from the document
        if "he" not in before:
            he = (translit.get(MUN_OF.get(mun_num, "")) or {}).get(before["pt"])
            if he:
                before["he"] = he
                before["he_origin"] = "app"
        elif was:
            before["he_origin"] = "pdf"
        # The dissolved unit's population is the sum of the parishes that
        # replaced it — that is what the reform did, and INE's reassignment
        # table reconciles to it exactly. Taken this way it is always available
        # and always right, rather than depending on a name matching a row.
        kids_pop = [k2["pop2021"] for k2 in (codes_by_dicofre.get(before["dicofre"], {})
                                             .get("split2025") or [])
                    if k2.get("pop2021") is not None]
        if kids_pop:
            before["pop2021"] = sum(kids_pop)
            before["pop_src"] = "sum of the parishes that replaced it"

    # ---- parishes -----------------------------------------------------------
    freguesias = []
    for mun in MUNICIPALITIES:
        n = NUM[mun]
        pool = {ft["properties"]["name"]: ft for ft in fre_by_mun[mun]}
        # A parish the 2025 reform created takes no row from the document, and
        # this is not a detail. The rows describe the 2013 units; matched by
        # name against the new division, "União das freguesias da Póvoa de
        # Varzim, Beiriz e Argivai" landed on the parish now called Póvoa de
        # Varzim and labelled it with two neighbours that are no longer part of
        # it, note and all. Nothing on screen looked broken — a real Hebrew
        # name over a real Portuguese one. Identity for these comes from the
        # transliteration file, and what the dissolved unit said about the
        # ground is offered separately, under that unit's own name.
        matchable = [k for k, ft in pool.items()
                     if ft["properties"]["dtmnfr"] not in born_2025]
        pdf_rows = porto_freg3.FREG3.get(n, [])
        taken = {}
        for order, (he, en, pop, note) in enumerate(pdf_rows):
            cand, score = match_one(en, [k for k in matchable if k not in taken])
            if cand is None or score < 0.34:
                warnings.append("no CAOP match for parish %r in %s (score %.2f)" % (en, mun, score))
                continue
            taken[cand] = {"he": he, "en": en, "pop": pop, "note": note,
                           "score": score, "order": order}

        extra_pop = collected["values"].get(mun, {})
        extra_he = translit.get(mun, {})
        for caop_name, ft in pool.items():
            src = taken.get(caop_name)
            geom = shape(ft["geometry"]).buffer(0)
            area = geom_area_km2(geom)
            pt = label_point(simplify_geom(geom, SIMPLIFY_FRE))
            rec = {
                "mun_num": n,
                "mun": mun,
                "pt": caop_name,
                "area_km2": round(area, 2),
                "center": [round(pt.x, 5), round(pt.y, 5)],
            }
            # The official number, not one of the app's own: the parish half of
            # the DICOFRE code. A unit the 2025 reform split back into separate
            # parishes has no code of its own any more, so it carries its
            # successors instead and the UI says so.
            # The official number comes off the boundary itself now. CAOP 2025
            # carries dtmnfr on every polygon, so there is nothing to look up
            # and nothing to match: the code and the shape are the same record.
            rec["dicofre"] = ft["properties"]["dtmnfr"]
            rec["code"] = rec["dicofre"][4:]
            # A parish the 2025 reform created out of a dissolved union. The
            # figures of that union are not this parish's and are never shown
            # as such — they are offered beside it, under the old unit's own
            # name, code and reference year, for a reader who wants to know
            # what the ground looked like before the boundary moved.
            before = was_part_of.get(rec["dicofre"])
            if before:
                rec["was_part_of"] = before
            if src:
                rec["he"] = src["he"]
                rec["he_origin"] = "pdf"
                rec["en"] = src["en"]
                rec["_order"] = src["order"]
                if src["note"]:
                    rec["note"] = src["note"]
                if src["pop"] is not None:
                    rec["pop2021"] = int(src["pop"])
                    rec["pop_src"] = "pdf"
            # The census figure wins over both the document and the collected
            # file: it is the same publication the municipality total comes
            # from, so a municipality equals the sum of its parishes exactly.
            # On the 2025 boundaries it is rebuilt from BGRI subsections, which
            # is the only way the 57 new parishes have a figure at all.
            c25 = ine_2025.get(rec["dicofre"]) or {}
            if c25.get("pop2021") is not None:
                was = rec.get("pop2021")
                rec["pop2021"] = int(c25["pop2021"])
                rec["pop_src"] = "ine"
                if was is not None and was != rec["pop2021"]:
                    warnings.append("%s: population %d -> %d (Censos 2021 on CAOP 2025)"
                                    % (caop_name, was, rec["pop2021"]))
            for key in ("median_age", "pct_0_14", "pct_65plus", "ageing_index",
                        "foreign_pct", "education_pct", "unemployment_pct"):
                if c25.get(key) is not None:
                    rec[key] = c25[key]
            housing = {k: c25[k] for k in
                       HOUSING_KEYS
                       if c25.get(k) is not None}
            if housing:
                rec["housing"] = housing
            # A parish whose 2021 sections do not account for all of it keeps
            # its population and loses the four fields a section is needed for.
            # The UI says which, rather than showing a share of most of it.
            if c25.get("section_cover") == "partial":
                rec["census_partial"] = True
            cons = cons_fre.get(rec["dicofre"])
            if cons:
                rec["cons"] = cons
            # CONFIDENCE: reported.  One class per parish, straight off INE's
            # own table by the parish's own code; a parish born in 2025 has no
            # code in that table and gets nothing.
            if rec["dicofre"] in tipau and not before:
                rec["tipau"] = tipau[rec["dicofre"]]
            # CONFIDENCE: approx.  Measured, not published: a statistic this
            # project computed by cutting a 30 m raster to the parish outline.
            # Copernicus GLO-30 is a SURFACE model, so in a built-up parish the
            # maximum includes roofs, and a coastal minimum can read a metre or
            # two below zero where the radar saw water against the EGM2008
            # geoid.  The values are written as measured; the source record and
            # the note in the app are what say so, rather than a clamp that
            # would hide it.
            d = dem_fre.get(rec["dicofre"])
            if d:
                rec["ele"] = {"min": d["min_m"], "mean": d["mean_m"],
                              "max": d["max_m"], "slope": d["slope_deg"]}
            if "pop2021" not in rec and caop_name in extra_pop:
                rec["pop2021"] = int(extra_pop[caop_name])
                rec["pop_src"] = "collected"
            if "note" not in rec and rec["dicofre"] in born_2025:
                pass          # its description belongs to the unit it left
            elif "note" not in rec and (n, caop_name) in app_note_of:
                # CONFIDENCE: approx. No official source publishes descriptive
                # text for a parish, so these 103 were written for the app.
                # They carry no figures — every number in the record above comes
                # from a documented source. note_origin marks them so the UI can
                # say so, and they live in one raw file so they stay editable.
                rec["note"] = app_note_of[(n, caop_name)]
                rec["note_origin"] = "app"
            elif "note" in rec:
                rec["note_origin"] = "pdf"
            if "he" not in rec and rec["dicofre"] in translit_2025:
                # CONFIDENCE: not verified. Written by hand for the parishes the
                # 2025 reform created — mostly the component exactly as it
                # already reads inside the dissolved union's name, so one place
                # is not spelled two ways. Rule 6 forbids generating these.
                rec["he"] = translit_2025[rec["dicofre"]]
                rec["he_origin"] = "app2025"
            if "he" not in rec and caop_name in extra_he:
                # CONFIDENCE: not verified. These 103 Hebrew names were written
                # for the app from the pronunciation rules the source document
                # set out; nobody has reviewed them. he_origin marks them so the
                # UI can say so and so they stay editable in one raw file.
                rec["he"] = extra_he[caop_name]
                rec["he_origin"] = "app"
            if "pop2021" in rec and rec["area_km2"] > 0:
                rec["density"] = round(rec["pop2021"] / rec["area_km2"], 1)
            freguesias.append(rec)

    number_parishes(freguesias)

    # ---- municipalities -----------------------------------------------------
    belt_of = {}
    belts = []
    for colour, en, he, nums, sub_en, sub_he in porto_freg2.BELTS:
        belts.append({"colour": colour, "en": en, "he": he, "nums": nums,
                      "sub_en": sub_en, "sub_he": sub_he})
        for m in nums:
            belt_of[m] = he

    mcol = read_mcol()
    municipios = []
    for mun in MUNICIPALITIES:
        n = NUM[mun]
        en, he, colour, fields = porto_pages.PROFILES[n]
        geom = mun_geom[mun]
        area = geom_area_km2(geom)
        pt = label_point(simplify_geom(geom, SIMPLIFY_MUN))
        kids = [f for f in freguesias if f["mun_num"] == n]
        known = [f["pop2021"] for f in kids if "pop2021" in f]
        rec = {
            "num": n, "pt": mun, "en": en, "he": he, "colour": colour,
            # the pastel the PDF prints for this municipality, so the app's
            # opening map and page 1 of the document are the same picture
            "fill": mcol.get(n, "#dddddd"),
            "belt": belt_of.get(n), "area_km2": round(area, 2),
            "dist_porto_km": dist_km.get(n),
            "transport": porto_freg2.TRANSPORT.get(n),
            "profile": [{"label": lab, "text": txt} for lab, txt in fields],
            "center": [round(pt.x, 5), round(pt.y, 5)],
            "n_freguesias": len(kids),
            "freg_pop_known": len(known),
            "freg_pop_sum": sum(known) if known else None,
            "ine": osm_ine.get(mun),
        }
        # The official number of the municipality inside the district: the last
        # two digits of its DICOFRE code. 13 is Porto district; 12 is Porto, 01
        # is Amarante. This is what appears on forms, in INE tables and in CAOP,
        # and it is what the app prints, rather than a number of its own.
        if rec["ine"] and len(str(rec["ine"])) == 4:
            rec["code"] = str(rec["ine"])[2:]
            rec["dicofre"] = str(rec["ine"])
        # CONFIDENCE: approx.  See the parish block above — same raster, same
        # caveats, cut to the municipality outline instead.
        d = dem_mun.get(rec.get("dicofre", ""))
        if d:
            rec["ele"] = {"min": d["min_m"], "mean": d["mean_m"],
                          "max": d["max_m"], "slope": d["slope_deg"]}
        census = ine_mun.get(rec.get("dicofre", ""))
        # The municipality comes from the same subsections as its parishes, so
        # the two levels agree by construction. Read from the 2013-boundary
        # file instead, Maia came out 33 people short of its own parishes and
        # Trofa 33 over — the 2025 correction crosses a municipality line, and
        # a municipality that does not equal the sum of its parts is the kind
        # of thing a reader finds before the build does.
        m25 = mun25.get(rec.get("dicofre", "")) or {}
        if m25.get("pop2021") is not None:
            rec["pop2021"] = int(m25["pop2021"])
            rec["pop_src"] = "ine"
            if census:
                rec["nuts3"] = census.get("nuts3")
            for key in ("median_age", "pct_0_14", "pct_65plus", "ageing_index",
                        "foreign_pct", "education_pct", "unemployment_pct"):
                if m25.get(key) is not None:
                    rec[key] = m25[key]
            housing = {k: m25[k] for k in
                       HOUSING_KEYS
                       if m25.get(k) is not None}
            if housing:
                rec["housing"] = housing
        elif mun in osm_pop:
            rec["pop2021"] = osm_pop[mun]
            rec["pop_src"] = "osm"
        cons = cons_mun.get(rec.get("dicofre", ""))
        if cons:
            rec["cons"] = cons
        crus = crus_mun.get(rec.get("dicofre", ""))
        if crus:
            # CRUS tiles a whole municipality, so its own total ought to be that
            # municipality's area — and for sixteen of the eighteen it is, to
            # within 0.04%. Where it is not, the gap is the finding: it is
            # written here so the app can say it on the card rather than let a
            # reader assume the two numbers agree. The shares are unaffected,
            # because they are taken against CRUS's own total and never against
            # this one.
            if rec.get("area_km2"):
                gap = 100.0 * (crus["total_ha"] / (rec["area_km2"] * 100.0) - 1)
                crus = dict(crus, caop_ha=round(rec["area_km2"] * 100.0, 1),
                            caop_gap_pct=round(gap, 2))
            rec["crus"] = crus
        if rec.get("pop2021"):
            rec["density"] = round(rec["pop2021"] / area, 1)
        municipios.append(rec)

    # ---- Porto city: 7 quarters and 53 bairros ------------------------------
    city = []
    for num, he, en, pop, colour, desc in porto_city.PORTO_FREG:
        title_he, title_en, bcol, cells = porto_city.BAIRROS[num]
        city.append({
            "num": num, "he": he, "en": en, "pop2021": pop, "colour": colour,
            "desc": desc, "bairros_title_he": title_he, "bairros_title_en": title_en,
            "bairros": [{"he": c[3], "en": c[4], "desc": c[5]} for c in cells],
        })

    # OSM place points inside the city (neighbourhood / quarter / suburb)
    places = []
    for ft in osm["features"]:
        p, g = ft["properties"], ft["geometry"]
        if p.get("place") not in ("neighbourhood", "quarter", "suburb"):
            continue
        if g["type"] == "Point":
            lon, lat = g["coordinates"]
        else:
            ring = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"][0][0]
            lon = sum(c[0] for c in ring) / len(ring)
            lat = sum(c[1] for c in ring) / len(ring)
        if p.get("name"):
            places.append({"name": p["name"], "ll": [round(lat, 5), round(lon, 5)],
                           "kind": p["place"]})

    # OSM boundaries of the 7 Porto city parishes (admin_level 8)
    city_bounds = {"type": "FeatureCollection", "features": []}
    city_names = {
        1: "Cedofeita, Santo Ildefonso, Sé, Miragaia, São Nicolau e Vitória",
        2: "Bonfim", 3: "Campanhã", 4: "Paranhos", 5: "Ramalde",
        6: "Aldoar, Foz do Douro e Nevogilde", 7: "Lordelo do Ouro e Massarelos",
    }
    rev = {v: k for k, v in city_names.items()}
    for ft in osm["features"]:
        p = ft["properties"]
        if p.get("admin_level") == "8" and p.get("name") in rev:
            g = shape(ft["geometry"]).buffer(0)
            city_bounds["features"].append({
                "type": "Feature",
                "properties": {"num": rev[p["name"]], "name": p["name"]},
                "geometry": simplify(g, 0.00015),
            })

    # ---- simplified boundaries for the map ---------------------------------
    mun_fc = {"type": "FeatureCollection", "features": []}
    for mun in MUNICIPALITIES:
        mun_fc["features"].append({
            "type": "Feature",
            "properties": {"num": NUM[mun], "name": mun},
            "geometry": simplify(mun_geom[mun], SIMPLIFY_MUN),
        })
    fre_fc = {"type": "FeatureCollection", "features": []}
    for ft in caop_fre["features"]:
        pr = ft["properties"]
        fre_fc["features"].append({
            "type": "Feature",
            "properties": {"mun_num": pr["mun_num"], "name": pr["name"]},
            "geometry": simplify(shape(ft["geometry"]).buffer(0), SIMPLIFY_FRE),
        })

    # ---- optional indicators from the fetch_* scripts ----------------------
    extra = load_extra()
    indicators = [dict(i) for i in BASE_INDICATORS]
    for spec in PENDING_INDICATORS:
        got = extra.get(spec["key"])
        item = dict(spec)
        if not got:
            item["available"] = False
            indicators.append(item)
            continue
        meta = got.get("meta", {})
        item.update({k: v for k, v in meta.items() if k != "values"})
        item["available"] = True
        n_m = n_f = 0
        # by DICOFRE first: three parishes are named differently by CAOP and by
        # INE (Vila Meã, Penhalonga, Vila Nova do Campo), and a join on the name
        # silently drops them. The code is the same in both.
        by_code = got.get("by_dicofre", {})
        for m in municipios:
            v = by_code.get(m.get("dicofre")) or got.get("municipios", {}).get(m["pt"])
            if v is not None:
                m[spec["key"]] = v
                n_m += 1
        for f in freguesias:
            # By code only. The name fallback that used to sit here put the
            # dissolved union's figures on whichever 2025 parish kept its name:
            # Paços de Ferreira (130925) took the numbers of Paços de Ferreira
            # (130918), which also contained Modelos. The values looked
            # ordinary and were 0.6pp out. A 2025 code did not exist in 2013,
            # so matching on the code cannot make this mistake.
            v = by_code.get(f.get("dicofre"))
            # A parish whose 2021 sections do not account for all of it must
            # not receive these four from here either. The indicator files are
            # on the 2013 boundaries, and for Nogueira e Silva Escura and
            # Coronado that is 33 people out — 0.4%, four times the tenth of a
            # point these are rounded to. Their population and every share the
            # subsections can answer stay exact; these four do not.
            if v is not None and f.get("census_partial") and spec["key"] in SECTION_BOUND:
                v = None
            if v is not None:
                f[spec["key"]] = v
                n_f += 1
        item["coverage"] = {"municipio": "%d/18" % n_m,
                            "freguesia": "%d/%d" % (n_f, len(freguesias))}
        indicators.append(item)
        warnings.append("merged indicator %s: %d municipalities, %d freguesias"
                        % (spec["key"], n_m, n_f))

    city_stats = city_extras(city)
    fre_geom = {"%d|%s" % (ft["properties"]["mun_num"], ft["properties"]["name"]):
                shape(ft["geometry"]).buffer(0) for ft in caop_fre["features"]}
    zones, zone_stats = build_zones(freguesias, city, fre_geom)
    belt_fc = belt_outlines(belts, mun_geom, {NUM[m]: m for m in MUNICIPALITIES})

    os.makedirs(OUT, exist_ok=True)
    written = []

    def dump(name, obj):
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        written.append((name, os.path.getsize(path)))

    version = open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip()
    # No date and no version INSIDE the data.  Both used to be stamped into
    # five of these files, and both are properties of the BUILD, not of the
    # district: a release that changed nothing but the day showed five data
    # files as modified, and a diff of what the release did to the data was
    # unreadable.  They live in manifest.json now — move ו׳ of
    # docs/INFORMATION-PLAN.md, and the reason build_diff.py can say "not one
    # field changed" and be believed.
    dump("indicators.json", {"items": indicators})
    dump("municipios.json", {"belts": belts, "items": municipios})
    # The number on the map is the app's own: 1..N inside each municipality,
    # in the official order (by DICOFRE), so the map and the list read the
    # same thing and no municipality shows 02 next to 44. The official code
    # stays in `code`/`dicofre` and is printed in the text beside every unit.
    # Municipalities already carry `num` (1–18; 1–11 are the metropolitan
    # area, 12–18 Tâmega e Sousa — the running number says the region).
    by_mun = {}
    for f in freguesias:
        by_mun.setdefault(f["mun_num"], []).append(f)
    for kids in by_mun.values():
        for i, f in enumerate(sorted(kids, key=lambda f: f["code"]), 1):
            f["num"] = i
    dump("freguesias.json", {"items": freguesias})
    dump("porto_city.json", {"quarters": city, "places": places})
    dump("zones.json", {"zones": zones})
    # The quarterly series.  A file of its own rather than fields on the units:
    # twenty-six quarters × four series is a shape the unit records have no room
    # for, and one screen reads it.  15 KB gzipped for the district's 84 units.
    named_here = ({"m" + m["dicofre"] for m in municipios if m.get("dicofre")}
                  | {"f" + f["dicofre"] for f in freguesias if f.get("dicofre")})
    series = read_ine_series(named_here)
    if series:
        dump("series.json", series)
    # The climate normals pass through untouched: there is nothing to compute.
    # They are per STATION, and this build has no station-to-unit step because
    # two stations cannot give 275 parishes a temperature — see
    # scripts/fetch_ipma_normals.py.  Copied rather than read from raw/ so the
    # app keeps loading everything it needs from data/processed.
    clim_path = os.path.join(RAW, "climate_normals.json")
    if os.path.exists(clim_path):
        dump("climate.json", json.load(open(clim_path, encoding="utf-8")))
    else:
        print("  climate_normals.json missing — no climate screen")
    dump("boundaries_municipios.geojson", mun_fc)
    layers = layer_geoms(mun_fc)
    layer_report = []
    for dest, got in layers.items():
        if not got:
            continue
        fc, st = got
        dump(dest, fc)
        layer_report.append("%s: %d kept, %d outside the district, %d too small to see"
                            % (dest.replace("boundaries_", "").replace(".geojson", ""),
                               st["kept"], st["outside"], st["small"]))
    dump("boundaries_belts.geojson", belt_fc)
    dump("boundaries_freguesias.geojson", fre_fc)
    dump("boundaries_porto_city.geojson", city_bounds)

    # ---- manifest.json: what the build stamped, and what it produced -------
    # Three jobs in one small file:
    #   1. it carries the build date and the app version, which used to be
    #      stamped inside the data itself;
    #   2. it is the app's only source for both, so the info page still says
    #      when the data was built and which version is running;
    #   3. it records a sha256 per file, so a hand-edited file in
    #      data/processed — the one rule this project could state but never
    #      enforce — is caught by checks.py §7ai.  "Trust, but verify":
    #      chapter 13 has S3 and HDFS read their own files back and compare.
    #
    # It covers EVERY file in data/processed, not only the ones dumped above,
    # because a file another script wrote (boundaries_floods.geojson comes from
    # build_floods.py) is just as much of the output.  Running one of those
    # scripts alone therefore makes the manifest stale and §7ai says so — the
    # right answer being to run build.py, which is the last step of the loop
    # anyway.
    def sha256_of(path):
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 16), b""):
                h.update(chunk)
        return h.hexdigest()

    files = {}
    for name in sorted(os.listdir(OUT)):
        path = os.path.join(OUT, name)
        if name == "manifest.json" or name.startswith(".") or not os.path.isfile(path):
            continue
        files[name] = {"bytes": os.path.getsize(path), "sha256": sha256_of(path)}
    man = os.path.join(OUT, "manifest.json")
    # Indented and key-sorted, unlike the data files: this one is read by people
    # in a diff, and it is 1.5 KB either way.
    with open(man, "w", encoding="utf-8") as fh:
        json.dump({"generated": date.today().isoformat(), "app_version": version,
                   "files": files}, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    written.append(("manifest.json", os.path.getsize(man)))

    for name, size in written:
        print("  %-38s %7.1f KB" % (name, size / 1024))
    if warnings:
        print("\nwarnings:")
        for w in warnings:
            print("  -", w)
    print("\n%d municipalities, %d freguesias, %d city quarters, %d OSM places"
          % (len(municipios), len(freguesias), len(city), len(places)))
    print("bairro letters placed %d, without a point %d;  POI dots %d;  belt outlines %d"
          % (city_stats["letters"], city_stats["no_point"], city_stats["pois"],
             len(belt_fc["features"])))
    n_pop = sum(1 for f in freguesias if "pop2021" in f)
    n_he = sum(1 for f in freguesias if "he" in f)
    for line in layer_report:
        print("layer " + line)
    print("level 3: %d parishes from the document, %d from OSM, %d with nothing to show"
          % (zone_stats["porto"], zone_stats["osm"], zone_stats["empty"]))
    print("         %d letters, %d dots" % (zone_stats["letters"], zone_stats["pois"]))
    n_note = sum(1 for f in freguesias if "note" in f)
    n_app = sum(1 for f in freguesias if f.get("note_origin") == "app")
    print("freguesias with population 2021: %d/%d   with Hebrew name: %d/%d"
          % (n_pop, len(freguesias), n_he, len(freguesias)))
    print("freguesias with a description: %d/%d   of them written for the app: %d"
          % (n_note, len(freguesias), n_app))
    n_tipau = sum(1 for f in freguesias if "tipau" in f)
    print("freguesias with a TIPAU 2025 class: %d/%d   (the %d born in 2025 have no row)"
          % (n_tipau, len(freguesias), sum(1 for f in freguesias if f.get("was_part_of"))))


if __name__ == "__main__":
    main()
