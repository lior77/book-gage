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
import json
import math
import os
import re
import sys
import unicodedata
from datetime import date

from geographiclib.geodesic import Geodesic
from shapely.geometry import shape, mapping

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


def simplify(geom, tol, ndigits=5):
    g = geom.simplify(tol, preserve_topology=True).buffer(0)
    if g.is_empty:
        g = geom
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
     "fetch": "scripts/fetch_pordata.py --indicator foreign", "levels": ["municipio"]},
    {"key": "median_age", "label_he": "גיל חציוני", "unit": "שנים",
     "fetch": "scripts/import_censos.py <קובץ INE>", "levels": ["municipio", "freguesia"],
     "warning_he": "אם קובץ המפקד מפרסם גיל חציוני — זה הערך שלו. אם יש בו רק פסי "
                   "גיל, הערך מחושב באינטרפולציה ומסומן כמקורב; ובפסים הרחבים של "
                   "INE (25–64) הסקריפט מסרב לחשב."},
    {"key": "median_income", "label_he": "הכנסה חציונית", "unit": "€/שנה",
     "fetch": "scripts/fetch_ine.py --indicator income", "levels": ["municipio"]},
    {"key": "crimes_per_1000", "label_he": "עבירות רשומות לאלף תושבים", "unit": "לאלף",
     "fetch": "scripts/fetch_pordata.py --indicator crime", "levels": ["municipio"],
     "warning_he": "סך העבירות הרשומות — לא ׳פשיעה חמורה׳. RASI מפרסמת criminalidade "
                   "violenta e grave לפי מחוז ופיקוד משטרתי בלבד, ולא לפי עירייה."},
    {"key": "price_eur_m2", "label_he": "מחיר למ״ר", "unit": "€/מ״ר",
     "fetch": "scripts/fetch_idealista.py", "levels": ["municipio", "freguesia"]},
    # One INE Censos 2021 download fills all five of these at once, for the 18
    # municipalities and the 243 freguesias together.
    {"key": "ageing_index", "label_he": "מדד הזדקנות", "unit": "65+/0-14 ×100",
     "fetch": "scripts/import_censos.py <קובץ INE>", "levels": ["municipio", "freguesia"]},
    {"key": "pct_65plus", "label_he": "אחוז בני 65+", "unit": "%",
     "fetch": "scripts/import_censos.py <קובץ INE>", "levels": ["municipio", "freguesia"]},
    {"key": "pct_0_14", "label_he": "אחוז בני 0–14", "unit": "%",
     "fetch": "scripts/import_censos.py <קובץ INE>", "levels": ["municipio", "freguesia"]},
    {"key": "pop_growth_pct", "label_he": "שינוי אוכלוסייה 2011→2021", "unit": "%",
     "fetch": "scripts/import_censos.py <קובץ INE>", "levels": ["municipio", "freguesia"]},
]


def load_extra():
    """Optional file written by the fetch_* scripts.  Absent by default."""
    path = os.path.join(RAW, "extra_indicators.json")
    if not os.path.exists(path):
        return {}
    return json.load(open(path, encoding="utf-8"))


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


# A ring of pastels for the parishes inside one municipality. Neighbouring
# numbers land on different hues, and every one of them takes dark text.
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


def belt_outlines(belts, mun_geom, name_of):
    """One outline per belt, as the union of its municipalities.

    The PDF draws these as a thick coloured line around each group; computing
    the union keeps the line on the real boundary instead of tracing it.
    """
    from shapely.ops import unary_union
    fc = {"type": "FeatureCollection", "features": []}
    for b in belts:
        merged = unary_union([mun_geom[name_of[n]] for n in b["nums"]]).buffer(0)
        fc["features"].append({
            "type": "Feature",
            "properties": {"he": b["he"], "en": b["en"], "colour": b["colour"],
                           "nums": b["nums"]},
            "geometry": simplify(merged, 0.0004),
        })
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


def build_zones(freguesias, city):
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
        places, pois = {}, {}
        for r in district["places"]:
            places.setdefault(r["freg"], []).append(r)
        for r in district["pois"]:
            if r["cat"] in POI_CORE or r.get("notable") or r["cat"] == "landmark":
                pois.setdefault(r["freg"], []).append(r)

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
    caop_fre = json.load(open(os.path.join(RAW, "caop2020_porto_freguesias.geojson")))
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
    app_note_of = {(i["mun_num"], i["pt"]): i["note"] for i in app_notes["items"]}

    # ---- parishes -----------------------------------------------------------
    freguesias = []
    for mun in MUNICIPALITIES:
        n = NUM[mun]
        pool = {ft["properties"]["name"]: ft for ft in fre_by_mun[mun]}
        pdf_rows = porto_freg3.FREG3.get(n, [])
        taken = {}
        for order, (he, en, pop, note) in enumerate(pdf_rows):
            cand, score = match_one(en, [k for k in pool if k not in taken])
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
            pt = geom.representative_point()
            rec = {
                "mun_num": n,
                "mun": mun,
                "pt": caop_name,
                "area_km2": round(area, 2),
                "center": [round(pt.x, 5), round(pt.y, 5)],
            }
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
            if "pop2021" not in rec and caop_name in extra_pop:
                rec["pop2021"] = int(extra_pop[caop_name])
                rec["pop_src"] = "collected"
            if "note" not in rec and (n, caop_name) in app_note_of:
                # CONFIDENCE: approx. No official source publishes descriptive
                # text for a parish, so these 103 were written for the app.
                # They carry no figures — every number in the record above comes
                # from a documented source. note_origin marks them so the UI can
                # say so, and they live in one raw file so they stay editable.
                rec["note"] = app_note_of[(n, caop_name)]
                rec["note_origin"] = "app"
            elif "note" in rec:
                rec["note_origin"] = "pdf"
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
        pt = geom.representative_point()
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
        if mun in osm_pop:
            rec["pop2021"] = osm_pop[mun]
            rec["density"] = round(osm_pop[mun] / area, 1)
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
            "geometry": simplify(mun_geom[mun], 0.0006),
        })
    fre_fc = {"type": "FeatureCollection", "features": []}
    for ft in caop_fre["features"]:
        pr = ft["properties"]
        fre_fc["features"].append({
            "type": "Feature",
            "properties": {"mun_num": pr["mun_num"], "name": pr["name"]},
            "geometry": simplify(shape(ft["geometry"]).buffer(0), 0.0004),
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
        for m in municipios:
            v = got.get("municipios", {}).get(m["pt"])
            if v is not None:
                m[spec["key"]] = v
                n_m += 1
        for f in freguesias:
            v = got.get("freguesias", {}).get("%s|%s" % (f["mun"], f["pt"]))
            if v is not None:
                f[spec["key"]] = v
                n_f += 1
        item["coverage"] = {"municipio": "%d/18" % n_m, "freguesia": "%d/243" % n_f}
        indicators.append(item)
        warnings.append("merged indicator %s: %d municipalities, %d freguesias"
                        % (spec["key"], n_m, n_f))

    city_stats = city_extras(city)
    zones, zone_stats = build_zones(freguesias, city)
    belt_fc = belt_outlines(belts, mun_geom, {NUM[m]: m for m in MUNICIPALITIES})

    os.makedirs(OUT, exist_ok=True)
    written = []

    def dump(name, obj):
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        written.append((name, os.path.getsize(path)))

    version = open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip()
    dump("indicators.json", {"generated": date.today().isoformat(),
                             "app_version": version,
                             "items": indicators})
    dump("municipios.json", {"generated": date.today().isoformat(),
                             "belts": belts, "items": municipios})
    dump("freguesias.json", {"generated": date.today().isoformat(),
                             "items": freguesias})
    dump("porto_city.json", {"generated": date.today().isoformat(),
                             "quarters": city, "places": places})
    dump("zones.json", {"generated": date.today().isoformat(), "zones": zones})
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


if __name__ == "__main__":
    main()
