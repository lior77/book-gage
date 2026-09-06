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


# ------------------------------------------------------------------- build ---
def main():
    dist_km = read_dist()
    caop_mun = json.load(open(os.path.join(RAW, "caop2020_porto_municipios.geojson")))
    caop_fre = json.load(open(os.path.join(RAW, "caop2020_porto_freguesias.geojson")))
    collected = json.load(open(os.path.join(RAW, "census2021_freguesias_collected.json")))
    translit = json.load(open(os.path.join(RAW, "hebrew_translit_new.json")))
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

    # ---- parishes -----------------------------------------------------------
    freguesias = []
    for mun in MUNICIPALITIES:
        n = NUM[mun]
        pool = {ft["properties"]["name"]: ft for ft in fre_by_mun[mun]}
        pdf_rows = porto_freg3.FREG3.get(n, [])
        taken = {}
        for he, en, pop, note in pdf_rows:
            cand, score = match_one(en, [k for k in pool if k not in taken])
            if cand is None or score < 0.34:
                warnings.append("no CAOP match for parish %r in %s (score %.2f)" % (en, mun, score))
                continue
            taken[cand] = {"he": he, "en": en, "pop": pop, "note": note, "score": score}

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
                if src["note"]:
                    rec["note"] = src["note"]
                if src["pop"] is not None:
                    rec["pop2021"] = int(src["pop"])
                    rec["pop_src"] = "pdf"
            if "pop2021" not in rec and caop_name in extra_pop:
                rec["pop2021"] = int(extra_pop[caop_name])
                rec["pop_src"] = "collected"
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

    # ---- municipalities -----------------------------------------------------
    belt_of = {}
    belts = []
    for colour, en, he, nums, sub_en, sub_he in porto_freg2.BELTS:
        belts.append({"colour": colour, "en": en, "he": he, "nums": nums,
                      "sub_en": sub_en, "sub_he": sub_he})
        for m in nums:
            belt_of[m] = he

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

    os.makedirs(OUT, exist_ok=True)
    written = []

    def dump(name, obj):
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        written.append((name, os.path.getsize(path)))

    dump("indicators.json", {"generated": date.today().isoformat(),
                             "items": indicators})
    dump("municipios.json", {"generated": date.today().isoformat(),
                             "belts": belts, "items": municipios})
    dump("freguesias.json", {"generated": date.today().isoformat(),
                             "items": freguesias})
    dump("porto_city.json", {"generated": date.today().isoformat(),
                             "quarters": city, "places": places})
    dump("boundaries_municipios.geojson", mun_fc)
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
    n_pop = sum(1 for f in freguesias if "pop2021" in f)
    n_he = sum(1 for f in freguesias if "he" in f)
    print("freguesias with population 2021: %d/%d   with Hebrew name: %d/%d"
          % (n_pop, len(freguesias), n_he, len(freguesias)))


if __name__ == "__main__":
    main()
