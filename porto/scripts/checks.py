#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Automatic sanity checks over data/processed/.

Rules enforced (from BRIEF.md):
  1. every numeric field has a source and a reference year in data/sources.json
  2. no filler values - a missing field is absent, never 0 and never an estimate
  3. the district has exactly 243 freguesias, and each municipality has the
     expected number
  4. sum of parish populations == municipality population (within tolerance,
     because INE published the two at different moments)
  5. density == population / area
  6. every geometry is valid and lies inside the district bounding box
  7. level 3 covers all 243 parishes, and what the app draws matches what it
     lists: the parish numbers run 1..N with
     no gaps and no repeats, every parish has a description whose origin is
     recorded, every bairro has a letter, and every belt outline names the
     municipalities it encloses

Exit code 0 = all green, 1 = at least one hard failure.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROC = os.path.join(ROOT, "data", "processed")

EXPECTED_FREG = {
    1: 7, 2: 15, 3: 4, 4: 10, 5: 7, 6: 4, 7: 21, 8: 7, 9: 14, 10: 5,
    11: 18, 12: 28, 13: 12, 14: 15, 15: 20, 16: 26, 17: 16, 18: 14,
}
SUM_TOLERANCE_PCT = 0.5      # municipality total vs sum of its parishes
DISTRICT_BBOX = (-9.0, 40.9, -7.6, 41.6)

fails, warns = [], []


def fail(msg):
    fails.append(msg)


def warn(msg):
    warns.append(msg)


def load(name):
    return json.load(open(os.path.join(PROC, name), encoding="utf-8"))


def coords_of(geom):
    t = geom["type"]
    if t == "Polygon":
        for ring in geom["coordinates"]:
            for c in ring:
                yield c
    elif t == "MultiPolygon":
        for poly in geom["coordinates"]:
            for ring in poly:
                for c in ring:
                    yield c
    else:
        fail("unexpected geometry type %s" % t)


def main():
    mun = load("municipios.json")["items"]
    fre = load("freguesias.json")["items"]
    city = load("porto_city.json")
    sources = json.load(open(os.path.join(ROOT, "data", "sources.json"), encoding="utf-8"))

    # ---- 3. counts ---------------------------------------------------------
    if len(mun) != 18:
        fail("expected 18 municipalities, got %d" % len(mun))
    if len(fre) != 243:
        fail("expected 243 freguesias in the district, got %d" % len(fre))
    per = {}
    for f in fre:
        per[f["mun_num"]] = per.get(f["mun_num"], 0) + 1
    for num, want in EXPECTED_FREG.items():
        if per.get(num, 0) != want:
            fail("municipality %d: %d freguesias, expected %d" % (num, per.get(num, 0), want))

    # ---- 2. no filler values ----------------------------------------------
    for f in fre:
        for k in ("pop2021", "area_km2", "density"):
            if k in f and (f[k] is None or f[k] == 0):
                fail("freguesia %s: %s is a filler value (%r)" % (f["pt"], k, f[k]))
    for m in mun:
        for k in ("pop2021", "area_km2", "density", "dist_porto_km"):
            if k in m and m[k] is None:
                fail("municipality %s: %s present but null" % (m["pt"], k))
        if m["num"] != 1 and m.get("dist_porto_km") in (0, None):
            fail("municipality %s: distance to Porto missing" % m["pt"])

    # ---- 4. parish sum == municipality total ------------------------------
    for m in mun:
        kids = [f for f in fre if f["mun_num"] == m["num"]]
        known = [f["pop2021"] for f in kids if "pop2021" in f]
        if len(known) != len(kids):
            warn("%s: %d/%d freguesias have a 2021 population"
                 % (m["pt"], len(known), len(kids)))
            continue
        if "pop2021" not in m:
            warn("%s: no municipality population to compare against" % m["pt"])
            continue
        s, t = sum(known), m["pop2021"]
        pct = 100.0 * (s - t) / t
        if abs(pct) > SUM_TOLERANCE_PCT:
            fail("%s: parish sum %d vs municipality %d (%+.2f%%)" % (m["pt"], s, t, pct))
        elif s != t:
            warn("%s: parish sum %d vs municipality %d (%+.2f%%)" % (m["pt"], s, t, pct))

    # ---- 5. density is consistent -----------------------------------------
    for rows, label in ((mun, "municipality"), (fre, "freguesia")):
        for r in rows:
            if "density" not in r:
                continue
            want = r["pop2021"] / r["area_km2"]
            if abs(want - r["density"]) > max(0.1, want * 0.001):
                fail("%s %s: density %s != %.1f" % (label, r["pt"], r["density"], want))

    # ---- 1. every numeric field is documented -----------------------------
    documented = set(sources["fields"])
    for key in ("municipio.pop2021", "municipio.area_km2", "municipio.density",
                "municipio.dist_porto_km", "freguesia.pop2021", "freguesia.area_km2",
                "freguesia.density"):
        if key not in documented:
            fail("data/sources.json has no entry for %s" % key)
        else:
            entry = sources["fields"][key]
            if "source" not in entry and "derived_from" not in entry:
                fail("%s: no source recorded" % key)
            if "reference_year" not in entry and "derived_from" not in entry \
                    and not key.endswith("dist_porto_km"):
                fail("%s: no reference year recorded" % key)

    # ---- 6. geometry --------------------------------------------------------
    lo0, la0, lo1, la1 = DISTRICT_BBOX
    for name in ("boundaries_municipios.geojson", "boundaries_freguesias.geojson",
                 "boundaries_porto_city.geojson"):
        fc = load(name)
        for ft in fc["features"]:
            pts = list(coords_of(ft["geometry"]))
            if len(pts) < 4:
                fail("%s: %r has only %d points" % (name, ft["properties"], len(pts)))
            for lon, lat in pts:
                if not (lo0 <= lon <= lo1 and la0 <= lat <= la1):
                    fail("%s: %r has a point outside the district (%s, %s)"
                         % (name, ft["properties"].get("name"), lon, lat))
                    break

    # every municipality and freguesia in the tables has a polygon
    have_m = {ft["properties"]["num"] for ft in load("boundaries_municipios.geojson")["features"]}
    if have_m != {m["num"] for m in mun}:
        fail("municipality polygons do not cover the same set as municipios.json")
    have_f = {(ft["properties"]["mun_num"], ft["properties"]["name"])
              for ft in load("boundaries_freguesias.geojson")["features"]}
    missing = {(f["mun_num"], f["pt"]) for f in fre} - have_f
    if missing:
        fail("%d freguesias have no polygon, e.g. %s" % (len(missing), sorted(missing)[:3]))

    # ---- 7. what the app draws matches what it lists -----------------------
    by_mun = {}
    for f in fre:
        by_mun.setdefault(f["mun_num"], []).append(f)
    for num, rows in sorted(by_mun.items()):
        got = sorted(r.get("n") for r in rows)
        if got != list(range(1, len(rows) + 1)):
            fail("municipality %d: parish numbers are %s, expected 1..%d"
                 % (num, got, len(rows)))
        if any(not r.get("colour") for r in rows):
            fail("municipality %d: a parish has no map colour" % num)
    for m in mun:
        if not m.get("fill"):
            fail("%s: no map fill colour" % m["pt"])

    # A description is allowed to be missing, but it is never allowed to be
    # present without saying where it came from.
    no_origin = [f["pt"] for f in fre if f.get("note") and not f.get("note_origin")]
    if no_origin:
        fail("%d descriptions do not record their origin, e.g. %s"
             % (len(no_origin), no_origin[:3]))
    origins = {}
    for f in fre:
        if f.get("note"):
            o = f.get("note_origin")
            origins[o] = origins.get(o, 0) + 1
    for o in origins:
        if o not in ("pdf", "app"):
            fail("unknown note_origin %r" % o)
    if origins.get("app") and "freguesia.note" not in sources["fields"]:
        fail("descriptions written for the app are not documented in sources.json")

    # ---- level 3 covers every parish, not only Porto's seven ---------------
    zones = load("zones.json")["zones"]
    missing_z = [f["pt"] for f in fre if "%d|%s" % (f["mun_num"], f["pt"]) not in zones]
    if missing_z:
        fail("%d parishes have no level-3 record, e.g. %s" % (len(missing_z), missing_z[:3]))
    labelled = {"station", "hospital", "university", "museum", "culture",
                "market", "landmark", "green", "civic"}
    for key, z in zones.items():
        seen = [b["letter"] for b in z["bairros"]]
        if len(set(seen)) != len(seen):
            fail("%s repeats a locality letter" % key)
        for b in z["bairros"]:
            if b.get("ll") and not b.get("confidence"):
                fail("%s: locality %s has a point but no confidence" % (key, b.get("en")))
        for r in z["pois"]:
            if r["cat"] not in labelled:
                fail("%s: point %r has category %r, which the app cannot label"
                     % (key, r["name"], r["cat"]))
            if not r.get("ll"):
                fail("%s: point %r has no coordinate" % (key, r["name"]))
    if zones and "freguesia.locality" not in sources["fields"]:
        fail("the level-3 localities are not documented in sources.json")

    letters = [b for q in city["quarters"] for b in q["bairros"] if not b.get("letter")]
    if letters:
        fail("%d bairros have no letter" % len(letters))
    for q in city["quarters"]:
        seen = [b.get("letter") for b in q["bairros"] if b.get("letter")]
        if len(set(seen)) != len(seen):
            fail("quarter %d repeats a bairro letter" % q["num"])
        for b in q["bairros"]:
            # no coordinate is fine; a coordinate with no confidence is not
            if b.get("ll") and not b.get("confidence"):
                fail("bairro %s has a point but no confidence" % b["en"])
    belts = load("boundaries_belts.geojson")["features"]
    covered = sorted(n for ft in belts for n in ft["properties"]["nums"])
    if covered != list(range(1, 19)):
        fail("the belt outlines cover %s, not all 18 municipalities" % covered)

    # ---- city --------------------------------------------------------------
    if len(city["quarters"]) != 7:
        fail("expected 7 Porto city quarters, got %d" % len(city["quarters"]))
    n_bairros = sum(len(q["bairros"]) for q in city["quarters"])
    if n_bairros != 53:
        warn("expected 53 bairros in Porto city, got %d" % n_bairros)

    # ---- report -----------------------------------------------------------
    print("municipalities %d   freguesias %d   city quarters %d   bairros %d"
          % (len(mun), len(fre), len(city["quarters"]), n_bairros))
    print("level 3: %d parishes, %d localities, %d points"
          % (len(zones), sum(len(z["bairros"]) for z in zones.values()),
             sum(len(z["pois"]) for z in zones.values())))
    print("freguesias with a description %d/%d (%d of them written for the app)"
          % (sum(1 for f in fre if f.get("note")), len(fre), origins.get("app", 0)))
    print("freguesias with population %d/%d, with Hebrew name %d/%d, with area %d/%d"
          % (sum(1 for f in fre if "pop2021" in f), len(fre),
             sum(1 for f in fre if "he" in f), len(fre),
             sum(1 for f in fre if "area_km2" in f), len(fre)))
    for w in warns:
        print("WARN  " + w)
    for f in fails:
        print("FAIL  " + f)
    print("\n%s  (%d warnings)" % ("ALL CHECKS PASSED" if not fails
                                   else "%d CHECKS FAILED" % len(fails), len(warns)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
