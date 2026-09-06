#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Validate the Overpass exports and turn them into normalised raw data.

    python3 scripts/ingest_overpass.py

Reads whatever exists under data/raw/:
    osm_porto_pois.geojson      query 01 — points of interest inside Porto
    osm_district_ele.geojson    query 03 — anything tagged with an elevation
    porto_places.geojson        query 02a — optional
    porto_streets.geojson       query 02b — optional
    porto_matadouro.geojson     query 02c — optional

Writes:
    data/raw/pois.json                POIs, deduplicated, categorised, per quarter
    data/raw/bairro_points.json       a coordinate for each of the 53 bairros
    data/raw/elevation_osm.json       highest *tagged* point per municipality


CONFIDENCE — the rule this project runs on
==========================================
Every value carries `confidence`, and anything that is not "verified" also
carries `note` saying, in Hebrew, exactly what is uncertain about it.  The UI
shows that note next to the value.  The three levels:

    "verified"  cross-checked against a second independent source, or it
                matches an official publication exactly.
                Example: the 2021 parish populations, whose sum was checked
                against the municipality total.

    "reported"  one source states it.  Plausible, nothing contradicts it, but
                nothing independent confirms it either.
                Example: a museum's coordinate as a single OSM contributor
                placed it.

    "approx"    derived, proxied or estimated.  Never a measurement, and never
                presented as one.
                Example: the bairro Carvalhido located by the church that
                carries its name, because the bairro itself is not in OSM.

Anywhere below that produces a non-"verified" value, the reason is spelled out
in a comment right at that line.  If you add a field, keep that habit.
"""
import json
import math
import os
import re
import sys
import unicodedata
from datetime import date

from shapely.geometry import shape, Point

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw")
sys.path.insert(0, os.path.join(RAW, "pdf_source"))

import porto_city  # noqa: E402

VERIFIED, REPORTED, APPROX = "verified", "reported", "approx"

# Category, in priority order: the first rule that matches a feature wins, and
# the order is also the order the app numbers them in.
CATEGORIES = [
    ("station",  lambda p: p.get("railway") in ("station", "halt")
                 or p.get("station") or p.get("public_transport") == "station"),
    ("hospital", lambda p: p.get("amenity") == "hospital" or p.get("healthcare") == "hospital"),
    ("university", lambda p: p.get("amenity") in ("university", "college")
                   or p.get("building") == "university"),
    ("museum",   lambda p: p.get("tourism") in ("museum", "gallery")),
    ("culture",  lambda p: p.get("amenity") in ("theatre", "arts_centre", "library")),
    ("market",   lambda p: p.get("amenity") == "marketplace"),
    ("landmark", lambda p: p.get("tourism") in ("attraction", "viewpoint")
                 or p.get("historic") or p.get("heritage")
                 or p.get("man_made") == "bridge" or p.get("bridge") == "yes"
                 or p.get("amenity") == "place_of_worship" or p.get("place") == "square"),
    ("green",    lambda p: p.get("leisure") in ("park", "garden") or p.get("natural") == "beach"),
]
CATEGORY_HE = {
    "station": "תחנה", "hospital": "בית חולים", "university": "השכלה",
    "museum": "מוזיאון", "culture": "תרבות", "market": "שוק",
    "landmark": "אתר", "green": "שטח פתוח",
}

_STOP = {"de", "do", "da", "dos", "das", "e", "of", "the"}
# Generic leading words a bairro name may carry that the OSM object does not:
# the neighbourhood "Estação de Campanhã" is just "Campanhã" in OSM.
GENERIC_HEAD = {"estacao", "praia", "jardim", "parque", "mercado", "praca",
                "campo", "avenida", "rua", "monte", "quinta"}


def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(w for w in s.split() if w not in _STOP)


def load(name):
    path = os.path.join(RAW, name)
    if not os.path.exists(path):
        return []
    doc = json.load(open(path, encoding="utf-8"))
    if doc.get("type") != "FeatureCollection":
        sys.exit("%s is not a FeatureCollection" % name)
    return doc["features"]


def metres(a, b):
    """Rough distance between two lon/lat pairs, good enough for de-duplication."""
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111320


def categorise(props):
    for name, test in CATEGORIES:
        if test(props):
            return name
    return None


# ------------------------------------------------------------------- POIs ---
def ingest_pois(quarters):
    feats = load("osm_porto_pois.geojson")
    if not feats:
        print("  osm_porto_pois.geojson missing — skipping POIs")
        return None

    kept, dropped_uncat = [], 0
    for ft in feats:
        p = ft["properties"]
        name = p.get("name")
        if not name or ft["geometry"]["type"] != "Point":
            continue
        cat = categorise(p)
        if not cat:
            dropped_uncat += 1
            continue
        lon, lat = ft["geometry"]["coordinates"]
        kept.append({
            "name": name, "cat": cat, "ll": [round(lat, 6), round(lon, 6)],
            "osm": p.get("@id", ""), "tags": len(p),
            # A wikidata or wikipedia link is the one notability signal in the
            # data. Porto holds 1255 named "landmarks", most of them a single
            # listed doorway; the app uses this flag to keep the well-known ones
            # without anybody hand-picking a list.
            "notable": bool(p.get("wikidata") or p.get("wikipedia")),
        })

    # OSM often holds the same place twice, as a node and as a way. Collapse
    # entries with the same name and category within 250 m, keeping the record
    # that carries more tags.
    kept.sort(key=lambda r: -r["tags"])
    out, seen = [], {}
    for r in kept:
        key = (norm(r["name"]), r["cat"])
        twin = seen.get(key)
        if twin and metres(list(reversed(twin["ll"])), list(reversed(r["ll"]))) < 250:
            continue
        seen[key] = r
        out.append(r)

    outside = 0
    for r in out:
        pt = Point(r["ll"][1], r["ll"][0])
        r["quarter"] = None
        for num, poly in quarters.items():
            if poly.contains(pt):
                r["quarter"] = num
                break
        if r["quarter"] is None:
            outside += 1
        # confidence: a coordinate one OSM contributor placed. Nothing here
        # cross-checks it, so it is "reported" and never "verified".
        r["confidence"] = REPORTED
        r["note"] = "מיקום מ-OpenStreetMap, מקור יחיד ולא מאומת מול מקור שני."
        r.pop("tags", None)

    by_cat = {}
    for r in out:
        by_cat[r["cat"]] = by_cat.get(r["cat"], 0) + 1
    print("  POIs: %d features → %d named and categorised → %d after de-duplication"
          % (len(feats), len(kept), len(out)))
    print("       (%d had no category we use, %d fell outside every quarter polygon)"
          % (dropped_uncat, outside))
    print("       " + "  ".join("%s=%d" % (CATEGORY_HE[k], v) for k, v in sorted(by_cat.items())))
    return {
        "meta": {
            "source": "OpenStreetMap via Overpass (scripts/overpass/01_porto_pois.overpassql)",
            "licence": "ODbL — © OpenStreetMap contributors",
            "retrieved": "2026-09-05",
            "confidence": REPORTED,
            "note_he": "כל הנקודות הן מ-OSM: מקור יחיד, לא מאומת מול מקור שני. "
                       "המיקומים טובים בדרך כלל אבל אינם מדידה רשמית.",
        },
        "items": out,
    }


# ---------------------------------------------------------------- bairros ---
def ingest_bairros(pois_feats, quarters):
    """A coordinate for each of the 53 curated bairros.

    Only a name match on a place=* feature is treated as the bairro itself.
    Everything else — a metro station, a park, a church, a street that carries
    the name — is a proxy for where the bairro is, so it is "approx" and says
    which object it borrowed the position from.
    """
    pool = []
    for src in ("osm_porto_pois.geojson", "porto_places.geojson",
                "porto_streets.geojson", "porto_matadouro.geojson"):
        for ft in load(src):
            if ft["geometry"]["type"] == "Point" and ft["properties"].get("name"):
                pool.append(ft)
    # the original OSM export the PDF project used, which carries place=* points
    for ft in load(os.path.join("osm", "porto_freguesias.geojson")):
        g = ft["geometry"]
        if not g or not ft["properties"].get("name"):
            continue
        if g["type"] == "Point":
            pool.append(ft)
        elif g["type"] in ("Polygon", "MultiPolygon"):
            c = shape(g).representative_point()
            pool.append({"properties": ft["properties"],
                         "geometry": {"type": "Point", "coordinates": [c.x, c.y]}})

    by_name = {}
    for ft in pool:
        by_name.setdefault(norm(ft["properties"]["name"]), []).append(ft)

    def kind_of(p):
        for k in ("place", "railway", "station", "leisure", "natural", "amenity",
                  "historic", "tourism", "landuse", "highway", "building", "man_made",
                  "boundary"):
            if p.get(k):
                return "%s=%s" % (k, p[k]) if p[k] != "yes" else k
        return "אובייקט"

    items, missing = [], []
    for qnum in sorted(porto_city.BAIRROS):
        for cell in porto_city.BAIRROS[qnum][3]:
            he, en = cell[3], cell[4]
            cands = [c.strip() for c in en.replace("(", "/").replace(")", "").split("/")]
            hit = kind = None
            for c in cands:
                if norm(c) in by_name:
                    hit = by_name[norm(c)][0]
                    kind = "exact"
                    break
            if not hit:                       # fall back to a containing match
                for c in cands:
                    nc = norm(c)
                    for k, v in by_name.items():
                        if nc and nc in k:
                            hit, kind = v[0], "partial"
                            break
                    if hit:
                        break
            if not hit:
                # Last resort: drop a leading generic word and retry, so
                # "Estação de Campanhã" finds the station tagged just "Campanhã".
                # Only an exact match on the remainder counts, to keep this from
                # matching on a fragment.
                for c in cands:
                    parts = norm(c).split()
                    if len(parts) > 1 and parts[0] in GENERIC_HEAD:
                        rest = " ".join(parts[1:])
                        if rest in by_name:
                            hit, kind = by_name[rest][0], "partial"
                            break
            if not hit:
                missing.append((qnum, he, en))
                continue

            p = hit["properties"]
            lon, lat = hit["geometry"]["coordinates"]
            rec = {"quarter": qnum, "he": he, "en": en,
                   "ll": [round(lat, 6), round(lon, 6)],
                   "matched": p["name"], "kind": kind_of(p)}
            if kind == "exact" and p.get("place"):
                # the OSM object *is* the neighbourhood: still a single source
                rec["confidence"] = REPORTED
                rec["note"] = "נקודת השכונה מ-OSM, מקור יחיד."
            elif kind == "exact":
                # same name, different kind of object — a station or a park that
                # sits inside the bairro, not the bairro's centre
                rec["confidence"] = APPROX
                rec["note"] = ("מיקום מקורב: אין ב-OSM אובייקט של השכונה עצמה, "
                               "והנקודה נלקחה מ״%s״ (%s) ששמו זהה." % (p["name"], rec["kind"]))
            else:
                # only a partial name match — the weakest case of all
                rec["confidence"] = APPROX
                rec["note"] = ("מיקום מקורב: לא נמצא אובייקט בשם הזה, והנקודה נלקחה "
                               "מ״%s״ (%s) ששמו מכיל את שם השכונה." % (p["name"], rec["kind"]))
            items.append(rec)

    n_rep = sum(1 for r in items if r["confidence"] == REPORTED)
    print("  bairros: %d/53 located  (%d מהם נקודת שכונה ממש, %d מיקום מקורב)"
          % (len(items), n_rep, len(items) - n_rep))
    for q, he, en in missing:
        print("       ✗ רובע %d · %s (%s) — אין נקודה" % (q, he, en))
    return {
        "meta": {
            "source": "OpenStreetMap via Overpass",
            "licence": "ODbL — © OpenStreetMap contributors",
            "retrieved": "2026-09-06",
            "note_he": "מתחת לפרגזיה אין בפורטוגל שכבה מנהלית רשמית. השמות אינם "
                       "רשמיים ואין להם גבולות — הנקודות מסמנות איפה השכונה נמצאת, "
                       "לא את מרכזה המדויק ולא את שטחה.",
        },
        # Recorded rather than silently dropped: a targeted Overpass query over
        # eastern Porto returned nothing for these, so they are absent from OSM
        # and not merely un-matched by the rules above. Without a coordinate the
        # app lists them but puts no letter on the map.
        "not_in_osm": [{"quarter": q, "he": he, "en": en,
                        "note": "לא קיים ב-OpenStreetMap. שאילתה ייעודית על אזור "
                                "מזרח פורטו לא החזירה שום אובייקט בשם הזה."}
                       for q, he, en in missing],
        "items": items,
    }


# -------------------------------------------------------------- elevation ---
def ingest_elevation(municipalities):
    feats = load("osm_district_ele.geojson")
    if not feats:
        print("  osm_district_ele.geojson missing — skipping elevation")
        return None

    # Only peaks, hills and geodetic survey marks. Everything else that happens
    # to carry an ele tag — a hotel roof, a wind turbine hub — reports the height
    # of a structure, not of the ground, and skews the maximum upwards.
    def usable(p):
        return p.get("natural") in ("peak", "hill") or p.get("man_made") == "survey_point"

    best, counts, rejected = {}, {}, 0
    for ft in feats:
        p = ft["properties"]
        if not p.get("ele"):
            continue
        try:
            ele = float(str(p["ele"]).replace(",", "."))
        except ValueError:
            continue
        if not usable(p):
            rejected += 1
            continue
        pt = Point(*ft["geometry"]["coordinates"])
        for num, (name, poly) in municipalities.items():
            if poly.contains(pt):
                counts[num] = counts.get(num, 0) + 1
                if num not in best or ele > best[num]["ele_m"]:
                    best[num] = {"num": num, "mun": name, "ele_m": round(ele, 1),
                                 "at": p.get("name") or p.get("man_made") or "—"}
                break

    for num, rec in best.items():
        rec["n_points"] = counts.get(num, 0)
        # This is the highest point somebody happened to tag, out of a few dozen
        # in each municipality. The real summit may simply not be in OSM, so this
        # is a lower bound and must never be labelled "the highest point".
        rec["confidence"] = APPROX
        rec["note"] = ("הנקודה הגבוהה ביותר מבין %d הנקודות שמתויגות ב-OSM בעירייה — "
                       "לא הנקודה הגבוהה ביותר בפועל. זהו חסם תחתון. "
                       "לערך אמיתי נדרש מודל גבהים (DEM)." % rec["n_points"])

    print("  elevation: %d/%d municipalities have a tagged peak or survey point"
          % (len(best), len(municipalities)))
    print("       (%d values ignored: an ele tag on something that is not ground level)"
          % rejected)
    return {
        "meta": {
            "indicator": "highest tagged point (NOT the highest point)",
            "source": "OpenStreetMap, natural=peak|hill and man_made=survey_point",
            "licence": "ODbL — © OpenStreetMap contributors",
            "retrieved": "2026-09-05",
            "confidence": APPROX,
            "note_he": "חסם תחתון בלבד. הנקודה הגבוהה באמת עשויה לא להיות מתויגת. "
                       "המקור הנכון הוא מודל גבהים (Copernicus GLO-30 או SRTM).",
        },
        "items": [best[k] for k in sorted(best)],
    }


def main():
    city = json.load(open(os.path.join(ROOT, "data", "processed",
                                       "boundaries_porto_city.geojson"), encoding="utf-8"))
    # the unsimplified OSM outlines, so a point near an edge is not lost to the
    # 15 m simplification used for the map
    quarters = {}
    for ft in load(os.path.join("osm", "porto_freguesias.geojson")):
        p = ft["properties"]
        if p.get("admin_level") == "8" and ft["geometry"]["type"] in ("Polygon", "MultiPolygon"):
            for f2 in city["features"]:
                if norm(f2["properties"]["name"]) == norm(p["name"]):
                    quarters[f2["properties"]["num"]] = shape(ft["geometry"]).buffer(0)
    if len(quarters) != 7:
        sys.exit("expected 7 Porto quarters, matched %d" % len(quarters))

    mun_fc = json.load(open(os.path.join(ROOT, "data", "processed",
                                         "boundaries_municipios.geojson"), encoding="utf-8"))
    municipalities = {ft["properties"]["num"]: (ft["properties"]["name"], shape(ft["geometry"]))
                      for ft in mun_fc["features"]}

    print("ingesting Overpass exports")
    outputs = {
        "pois.json": ingest_pois(quarters),
        "bairro_points.json": ingest_bairros(None, quarters),
        "elevation_osm.json": ingest_elevation(municipalities),
    }
    for name, payload in outputs.items():
        if payload is None:
            continue
        payload["generated"] = date.today().isoformat()
        path = os.path.join(RAW, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=1)
        print("  wrote data/raw/%-22s %6.1f KB" % (name, os.path.getsize(path) / 1024))


if __name__ == "__main__":
    main()
