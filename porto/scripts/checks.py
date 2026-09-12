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
     lists: the internal parish order runs 1..N with
     no gaps and no repeats, every parish has a description whose origin is
     recorded, every bairro has a letter, and every belt outline names the
     municipalities it encloses
  7b. every number the app prints is an official DICOFRE code: the municipality
     code is four digits under district 13, a parish code sits under its own
     municipality and appears once, and a parish without a code is one the 2025
     reform split, carrying its successors instead

Exit code 0 = all green, 1 = at least one hard failure.
"""
import json
import io
import os
import re
import sys
import unicodedata

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

def load_raw(name):
    """A file from data/raw — the sources kept beside the processed output."""
    return json.load(open(os.path.join(ROOT, "data", "raw", name), encoding="utf-8"))



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




def point_in_ring(x, y, ring):
    """Ray casting. ring is [[lon,lat], ...]."""
    inside = False
    n = len(ring)
    for i in range(n):
        j = (i - 1) % n
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
    return inside


def ring_distance_m(x, y, ring):
    """Shortest distance from a point to a ring, in metres.

    To the segments, not just the vertices: a parish outline can run half a
    kilometre between two vertices, and measuring to the nearest corner turns a
    point sitting on the boundary into one that looks a field away.
    """
    import math
    k = math.cos(math.radians(y))
    best = float("inf")
    for i in range(len(ring)):
        ax, ay = ring[i - 1][0], ring[i - 1][1]
        bx, by = ring[i][0], ring[i][1]
        ax, bx, px = (ax - x) * k, (bx - x) * k, 0.0
        ay, by, py = ay - y, by - y, 0.0
        dx, dy = bx - ax, by - ay
        d2 = dx * dx + dy * dy
        t = 0.0 if d2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / d2))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best * 111320

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

    # ---- 7b. the official codes the app prints -----------------------------
    # Every unit has either its own DICOFRE code or, if the 2025 reform undid
    # it, the successors that replaced it. Never neither, and never a code the
    # app made up.
    for m in mun:
        if not m.get("dicofre") or len(m["dicofre"]) != 4:
            fail("%s: no four-digit DICOFRE code" % m["pt"])
        if m["dicofre"][:2] != "13":
            fail("%s: DICOFRE %s is not in district 13" % (m["pt"], m["dicofre"]))
        if m.get("code") != m["dicofre"][2:]:
            fail("%s: printed number %r does not match DICOFRE %s"
                 % (m["pt"], m.get("code"), m["dicofre"]))
    mun_code = {m["num"]: m["dicofre"] for m in mun}
    seen = {}
    for f in fre:
        if f.get("dicofre"):
            want = mun_code.get(f["mun_num"], "") + f.get("code", "")
            if f["dicofre"] != want:
                fail("%s: DICOFRE %s does not sit under its municipality (%s)"
                     % (f["pt"], f["dicofre"], want))
            if f["dicofre"] in seen:
                fail("DICOFRE %s is on two parishes: %s and %s"
                     % (f["dicofre"], seen[f["dicofre"]], f["pt"]))
            seen[f["dicofre"]] = f["pt"]
        if f.get("split2025"):
            if not all(k.get("code") and k.get("pt") for k in f["split2025"]):
                fail("%s: a 2025 successor has no code or no name" % f["pt"])
            # A split that does not account for everyone the census counted is
            # worse than no split at all, because it looks like a breakdown.
            pops = [k["pop2021"] for k in f["split2025"] if "pop2021" in k]
            if pops and len(pops) != len(f["split2025"]):
                fail("%s: some 2025 successors carry a population and some do not"
                     % f["pt"])
            if pops and sum(pops) != f.get("pop2021"):
                fail("%s: successors add to %d, the census counted %s"
                     % (f["pt"], sum(pops), f.get("pop2021")))
        if not f.get("dicofre"):
            fail("%s: no official code" % f["pt"])
    # ---- 7c. the census figures -------------------------------------------
    # A municipality is the sum of its parishes, exactly: both come out of one
    # INE file. Anything else means the two levels drifted apart again.
    kids = {}
    for f in fre:
        kids.setdefault(f["mun_num"], []).append(f)
    for m in mun:
        if m.get("pop_src") != "ine":
            continue
        s_ = sum(f.get("pop2021", 0) for f in kids.get(m["num"], []))
        if s_ != m.get("pop2021"):
            fail("%s: municipality %s but its parishes add to %s"
                 % (m["pt"], m.get("pop2021"), s_))
    # Every share is a share, every count is positive, and a value is never
    # present without a source record behind it.
    SHARES = ("pct_65plus", "pct_0_14", "foreign_pct", "education_pct",
              "unemployment_pct", "vacant_pct",
              "second_home_pct", "owner_pct", "rented_pct", "parking_pct",
              "repair_pct", "deep_repair_pct", "pre1946_pct", "since2011_pct")
    for level, rows in (("municipio", mun), ("freguesia", fre)):
        for r in rows:
            for key in ("median_age", "ageing_index", "education_pct",
                        "unemployment_pct") + SHARES[:3]:
                if key in r and "%s.%s" % (level, key) not in sources["fields"]:
                    fail("%s.%s has no source record" % (level, key))
            for key in SHARES:
                v = r.get(key, r.get("housing", {}).get(key))
                if v is not None and not 0 <= v <= 100:
                    fail("%s %s: %s is %s, which is not a share"
                         % (level, r["pt"], key, v))
            if r.get("housing") and "%s.housing" % level not in sources["fields"]:
                fail("%s.housing has no source record" % level)
            age = r.get("median_age")
            if age is not None and not 15 <= age <= 75:
                fail("%s %s: median age %s is outside anything plausible"
                     % (level, r["pt"], age))
            if r.get("housing", {}).get("deep_repair_pct") is not None \
                    and r["housing"]["deep_repair_pct"] > r["housing"]["repair_pct"]:
                fail("%s %s: deep repairs exceed all repairs" % (level, r["pt"]))

    if "freguesia.number" not in sources["fields"]:
        fail("the parish numbering is not documented in sources.json")
    if "municipio.number" not in sources["fields"]:
        fail("the municipality numbering is not documented in sources.json")

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

    # ---- 7d. the INE housing-market figures --------------------------------
    # Four series, one source, and one way for them to go wrong that would be
    # invisible on screen: a parish inheriting its municipality's median. INE
    # publishes at parish level in eleven municipalities and in no other, so a
    # value on a parish of the other seven means something filled it in.
    MARKET = ("price_eur_m2", "price_new_eur_m2", "price_used_eur_m2",
              "rent_eur_m2")
    # DICOFRE of the eleven INE publishes parishes for.  The list is in
    # scripts/import_ine_habitacao.py too; here it is the assertion, there it is
    # the filter, and the two disagreeing is exactly what this is meant to catch.
    FRE_PUBLISHED = {"1304", "1306", "1308", "1310", "1312", "1313", "1314",
                     "1315", "1316", "1317", "1318"}
    # The band each series stays inside.  Not a guess: the published Porto-
    # district range at 2026Q1 is 841-4252 EUR/m2 for sales and 3.13-15.17
    # EUR/m2 for rent, and these bounds sit well outside it.  They exist to
    # catch a unit slip or the two files swapping places, not to second-guess
    # INE.
    BAND = {"price_eur_m2": (200, 20000), "price_new_eur_m2": (200, 20000),
            "price_used_eur_m2": (200, 20000), "rent_eur_m2": (1, 100)}
    for level, rows in (("municipio", mun), ("freguesia", fre)):
        for key in MARKET:
            skey = "%s.%s" % (level, key)
            present = [r for r in rows if r.get(key) is not None]
            if not present:
                continue
            entry = sources["fields"].get(skey)
            if not entry:
                fail("%s has no source record" % skey)
                continue
            for want in ("source", "reference_year", "reference_period",
                         "caveat_he", "confidence"):
                if not entry.get(want):
                    fail("%s: no %s recorded" % (skey, want))
            # Rule 4 of the accuracy contract, enforced where it was actually
            # broken: the caveat may quote INE's definition of its own missing
            # marker, and may not offer a reason of our own for a cell INE does
            # not publish.  A plausible reason is still not what the source
            # said, and it reads as helpful, which is why it slipped through.
            cav = entry.get("caveat_he") or ""
            if "Dado nulo ou não aplicável" not in cav:
                fail("%s: the caveat does not quote INE's own definition of "
                     "its missing marker" % skey)
            for guess in ("מספר העסקאות", "סודיות", "מעט מדי"):
                if guess in cav:
                    fail("%s: the caveat gives a reason for a cell INE does not "
                         "publish (%r). INE publishes no reason." % (skey, guess))
            # A single source is `reported`.  Calling it verified would need a
            # second, independent source reaching the same number.
            if entry.get("confidence") != "reported":
                fail("%s: confidence is %r, but INE is the only source"
                     % (skey, entry.get("confidence")))
            lo, hi = BAND[key]
            for r in present:
                v = r[key]
                if not isinstance(v, (int, float)) or v <= 0:
                    fail("%s %s: %s is %r" % (level, r["pt"], key, v))
                elif not lo <= v <= hi:
                    fail("%s %s: %s is %s EUR/m2, outside %s-%s"
                         % (level, r["pt"], key, v, lo, hi))
    for f in fre:
        if f.get("dicofre", "")[:4] in FRE_PUBLISHED:
            continue
        for key in MARKET:
            if f.get(key) is not None:
                fail("freguesia %s (%s): %s is %s, but INE publishes no parish "
                     "figure in that municipality — something filled it in"
                     % (f["pt"], f.get("dicofre"), key, f[key]))
    # Rent is EUR/m2 per month and a sale price is EUR/m2 outright; they differ
    # by two orders of magnitude everywhere.  If one unit ever comes out of the
    # same range as the other, the two series have been crossed.
    for level, rows in (("municipio", mun), ("freguesia", fre)):
        for r in rows:
            price, rent = r.get("price_eur_m2"), r.get("rent_eur_m2")
            if price is not None and rent is not None and price < rent * 10:
                fail("%s %s: sale %s and rent %s are not two different units"
                     % (level, r["pt"], price, rent))

    # ---- 7e. the comparison screen offers nothing without a source ---------
    # app.js filters a field out of השוואת נתונים when its source record is
    # missing, which is the right behaviour and a silent one: rename a key in
    # sources.json and a column of the screen simply stops existing. So the
    # list is read back out of app.js and every entry checked here, where a
    # missing record is a failed run rather than a quietly shorter menu.
    app = open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()
    block = re.search(r"const CMP_ALL = \[(.*?)\n\];", app, re.S)
    if not block:
        fail("app.js: CMP_ALL is not where checks.py looks for it")
    else:
        house = set(re.findall(r"'([a-z0-9_]+)'",
                               re.search(r"CMP_HOUSING = new Set\(\[(.*?)\]\)",
                                         app, re.S).group(1)))
        n_cmp = 0
        for m in re.finditer(r"\{ g: '[^']*', k: '([a-z0-9_]+)'(.*?)\}", block.group(1), re.S):
            key, rest = m.group(1), m.group(2)
            only = re.search(r"only: '(\w+)'", rest)
            for level in ("municipio", "freguesia"):
                if only and only.group(1) != level:
                    continue
                skey = "%s.%s" % (level, "housing" if key in house else key)
                if skey not in sources["fields"]:
                    fail("the comparison screen offers %s at %s, and %s has no "
                         "source record" % (key, level, skey))
                n_cmp += 1
        if n_cmp < 40:
            fail("only %d comparable fields were read out of CMP_ALL" % n_cmp)

    # ---- 7f. the design document is generated, not written -----------------
    # docs/DESIGN.html states the app's own colours, spacing and type. A hand-
    # kept copy of those values drifts the moment app.css changes, and a design
    # document that disagrees with the code is worse than none: it is a second
    # source that looks authoritative. The generator is re-run here and the file
    # on disk has to be exactly what it produces.
    import subprocess
    r = subprocess.run([sys.executable, os.path.join(HERE, "build_design.py"), "--check"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        fail("docs/DESIGN.html has drifted from app.css — "
             "run python3 scripts/build_design.py  (%s)" % r.stdout.strip())

    # ---- 7i. the design document shows every icon and claims every class ---
    # Two ways docs/DESIGN.html can be quietly incomplete rather than wrong: an
    # icon the generator's regex dropped (it skipped every second one and 13 of
    # 27 reached the page), and a class in app.css that belongs to no pattern.
    # The second is a build error inside build_design.py; this is the first.
    appjs = io.open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()
    icons = re.findall(r"\n  ([a-z0-9]+):\s*'", appjs[appjs.index("const ICON = {"):])
    doc_i = io.open(os.path.join(ROOT, "docs", "DESIGN.html"), encoding="utf-8").read()
    shown = set(re.findall(r'<span dir="ltr">([a-z0-9]+)</span></div>', doc_i))
    gone = [i for i in icons if i not in shown]
    if gone:
        fail("docs/DESIGN.html draws %d of the %d icons in ICON — missing %s"
             % (len(icons) - len(gone), len(icons), gone[:5]))

    # ---- 7h. a label sits where a label can be read ------------------------
    # The number on a municipality used to come from representative_point(),
    # which only promises to land inside the shape: GEOS takes a horizontal line
    # through the polygon and returns the middle of one crossing. On Matosinhos
    # that was 0.0035° from the border — about three pixels at the opening zoom,
    # so the label touched the line. build.py now takes the pole of
    # inaccessibility instead, and this is what makes sure it stays taken: every
    # stored centre has to be inside its own shape and no closer to the edge
    # than either of the two cheap answers it replaced.
    # No try/except around this import. A check that skips itself when a library
    # is missing is a check that cannot fail, and this file has been caught that
    # way three times — see section 11. build.py needs shapely anyway, so an
    # environment that can build can run this.
    import numpy as _np
    import shapely as _sh
    from shapely.geometry import shape as _shape, Point as _Point

    def edge_gap(geom, x, y):
        pt = _Point(x, y)
        return geom.boundary.distance(pt) if geom.contains(pt) else -1.0

    # The test is a grid, not a second run of build.py's own function: re-running
    # the code that produced the number proves only that the file is not stale.
    # A 24x24 lattice over the shape is an independent opinion about where the
    # roomiest spot is, and the stored centre has to beat every point on it.
    def best_on_grid(poly, n=24):
        minx, miny, maxx, maxy = poly.bounds
        gx, gy = _np.meshgrid(_np.linspace(minx, maxx, n), _np.linspace(miny, maxy, n))
        gx, gy = gx.ravel(), gy.ravel()
        inside = _sh.contains_xy(poly, gx, gy)
        if not inside.any():
            return 0.0
        return float(_sh.distance(poly.boundary, _sh.points(gx[inside], gy[inside])).max())

    def check_centres(features, key_of, centres, what):
        bad = []
        for ft in features:
            k = key_of(ft["properties"])
            c = centres.get(k)
            if c is None:
                bad.append("%s: on the map but not in the data" % (k,))
                continue
            g = _shape(ft["geometry"]).buffer(0)
            parts = [g] if g.geom_type == "Polygon" else list(g.geoms)
            big = max(parts, key=lambda q: q.area)
            got = edge_gap(big, c[0], c[1])
            if got < 0:
                bad.append("%s: the centre is outside the shape" % (k,))
                continue
            # the lattice is coarse, so it is allowed to come within a tenth of
            # the stored point — what it must not do is beat it outright
            grid = best_on_grid(big)
            if grid > got * 1.1:
                bad.append("%s: %.5f from the edge, but a plain grid finds %.5f"
                           % (k, got, grid))
        if bad:
            fail("%d %s labels sit badly — run python3 scripts/build.py: %s"
                 % (len(bad), what, bad[:3]))

    check_centres(load("boundaries_municipios.geojson")["features"],
                  lambda pr: pr["num"],
                  {m["num"]: m["center"] for m in load("municipios.json")["items"]},
                  "municipality")
    check_centres(load("boundaries_freguesias.geojson")["features"],
                  lambda pr: (pr["mun_num"], pr["name"]),
                  {(f["mun_num"], f["pt"]): f["center"]
                   for f in load("freguesias.json")["items"]},
                  "parish")

    # ---- 7k. the income figure says what it is a median of -----------------
    # "הכנסה חציונית" claims the median income of a household. What INE
    # publishes is the median of the gross income DECLARED to the tax authority
    # per fiscal household: households that file nothing are not counted, and
    # it is gross, not net. Calling the narrow thing by the broad name is the
    # restatement rule 4 forbids — and it is the mistake this project already
    # made once, in 1.25.0, with an invented reason for a blank INE cell.
    inc = {m["num"]: m.get("median_income") for m in mun}
    blank_i = [n for n, v in inc.items() if v is None]
    if blank_i:
        fail("%d municipalities have no income figure: %s" % (len(blank_i), blank_i[:4]))
    odd_i = [(n, v) for n, v in inc.items() if v is not None and not (3000 < v < 80000)]
    if odd_i:
        fail("declared income outside a plausible annual band (€): %s" % odd_i[:3])
    leaked_i = [(f["mun_num"], f["pt"]) for f in fre if f.get("median_income") is not None]
    if leaked_i:
        fail("%d parishes carry an income figure — INE publishes it by "
             "municipality only: %s" % (len(leaked_i), leaked_i[:3]))
    rec_i = sources["fields"].get("municipio.median_income")
    if not rec_i:
        fail("municipio.median_income has no source record")
    else:
        lab = rec_i.get("label_he", "")
        if "מוצהרת" not in lab:
            fail("the income label must say the income is DECLARED — %r claims "
                 "more than INE publishes" % lab)
        if "ברוטו" not in lab and "ברוטו" not in rec_i.get("warning_he", ""):
            fail("the income record must say the figure is gross, not net")
        if rec_i.get("confidence") != "reported":
            fail("the income figure has one producer; the older NUTS-2013 series "
                 "is frozen and disagrees for 2021, so it confirms nothing — "
                 "'reported', not %r" % rec_i.get("confidence"))

    # ---- 7m. the two municipality-code tables agree ------------------------
    # When indicator_store had 1315/1318 swapped, fetch_dgt_ogcapi had them
    # right — the correct mapping was already in the repository, in another
    # file, and nothing compared them. Two hand-kept copies of the same table
    # is one copy too many; this makes them check each other.
    import re as _re
    dgt = io.open(os.path.join(HERE, "fetch_dgt_ogcapi.py"), encoding="utf-8").read()
    blk = dgt[dgt.index("CRUS_MUNICIPIOS = {"):]
    blk = blk[:blk.index("}")]
    crus = dict(_re.findall(r'"(\d{4})":\s*"([a-z_]+)"', blk))
    if len(crus) != 18:
        fail("CRUS_MUNICIPIOS holds %d codes, not 18" % len(crus))
    slug = lambda t: _re.sub(r"[^a-z]+", "_",
                             unicodedata.normalize("NFD", t.lower())
                             .encode("ascii", "ignore").decode()).strip("_")
    by_code = {}
    for f in fre:
        code = str(f.get("dicofre") or "")
        if len(code) >= 6:
            by_code[code[:4]] = f["mun"]
    for code, name in sorted(crus.items()):
        want = by_code.get(code)
        if want is None:
            fail("CRUS names code %s, which no parish carries" % code)
        elif slug(want) != name:
            fail("code %s is %r in the parishes' DICOFRE and %r in "
                 "fetch_dgt_ogcapi — one of the two tables is wrong"
                 % (code, slug(want), name))

    # ---- 7l. the population change reconciles with the 2011 census ---------
    # This is the check that caught a real swap. indicator_store typed the INE
    # municipality codes by hand and had 1315/1318 the wrong way round — Trofa
    # was created in 1998 out of Santo Tirso and took the LAST code, not its
    # alphabetical one — so every series joined on those codes gave Trofa
    # Valongo's number and Valongo Trofa's. Nothing looks wrong on screen when
    # that happens: both places exist and both get a plausible figure.
    #
    # pop2021 / (1 + rate) has to come back to the 2011 census population INE
    # published separately. There is no such test at parish level: the 2011
    # parishes are not the 2021 parishes, which is exactly why INE computes the
    # parish change itself rather than leaving it to be derived.
    c11 = load_raw("censos2011_municipios.json")["municipios"]
    by_name = {m["pt"]: m for m in mun}
    off = []
    for name, p11 in c11.items():
        m = by_name.get(name)
        if not m:
            fail("censos2011_municipios.json names %r, which is not a municipality" % name)
            continue
        p21, rate = m.get("pop2021"), m.get("pop_growth_pct")
        if p21 is None or rate is None:
            fail("%s has no population or no change rate" % name)
            continue
        implied = p21 / (1.0 + rate / 100.0)
        gap = abs(implied / p11 - 1) * 100
        # 0.3%, not 0.01%. Two INE publications do not agree to the person:
        # Amarante's rate implies 56,263 residents in 2011 against the 56,217
        # the 2011 census publishes — 46 people, 0.08%. That is INE's own
        # spread between a rate and a count, and it is recorded in the source
        # record rather than tuned away. A swapped municipality is out by tens
        # of thousands, so this threshold still catches the thing it was
        # written for.
        if gap > 0.3:
            off.append((name, round(implied), p11, round(gap, 2)))
    if len(c11) != 18:
        fail("the 2011 census file holds %d municipalities, not 18" % len(c11))
    if off:
        fail("%d municipalities do not reconcile with the 2011 census — "
             "pop2021/(1+rate) vs INE 2011: %s" % (len(off), off[:3]))

    # ---- 7j. the crime rate is the municipality's, and stays there ---------
    # DGPJ publishes Taxa de criminalidade by municipality and nothing finer.
    # The temptation is the same one the housing prices already have: give a
    # parish its municipality's number so the map has no holes. That is an
    # unmarked interpolation, and it erases exactly the difference between two
    # parishes that a reader came to find.
    crime = {m["num"]: m.get("crimes_per_1000") for m in mun}
    blank = [n for n, v in crime.items() if v is None]
    if blank:
        fail("%d municipalities have no crime rate: %s" % (len(blank), blank[:4]))
    # fail() records and carries on, so this line still runs after a missing
    # value was reported — and None < 500 raises rather than reporting.
    odd = [(n, v) for n, v in crime.items() if v is not None and not (0 < v < 500)]
    if odd:
        fail("crime rate outside a plausible band (per 1000): %s" % odd[:3])
    leaked = [(f["mun_num"], f["pt"]) for f in fre if f.get("crimes_per_1000") is not None]
    if leaked:
        fail("%d parishes carry a crime rate — DGPJ publishes it by municipality "
             "only, so this can only be its municipality's number copied down: %s"
             % (len(leaked), leaked[:3]))
    rec = sources["fields"].get("municipio.crimes_per_1000")
    if not rec:
        fail("municipio.crimes_per_1000 has no source record")
    else:
        # rule 4: the source counts registered offences. Calling that "violent
        # crime" is the restatement the contract forbids, and the warning is
        # what stops the next person from writing it.
        warn_he = rec.get("warning_he", "")
        if "violenta e grave" not in warn_he or "RASI" not in warn_he:
            fail("the crime record must keep the source's own distinction: "
                 "criminalidade violenta e grave is a different series (RASI)")
        if rec.get("confidence") != "reported":
            fail("the crime rate has one producer and no independent second "
                 "source, so it is 'reported' — not %r" % rec.get("confidence"))

    # ---- 7g. a ≥ in Hebrew prose keeps its direction -----------------------
    # The bidi algorithm mirrors ≥ into ≤ when it resolves inside an RTL run, so
    # "טקסט ≥ 4.5:1" is read by the user as the opposite requirement. The source
    # looks right in the editor, which is why this has to be checked on the
    # output. Every ≥ has to sit inside U+2066..U+2069.
    doc = io.open(os.path.join(ROOT, "docs", "DESIGN.html"), encoding="utf-8").read()
    bare = [m.start() for m in re.finditer("\u2265", doc)
            if "\u2066" not in doc[max(0, m.start() - 3):m.start()]]
    if bare:
        fail("%d ≥ in docs/DESIGN.html are not bidi-isolated and render as ≤ — "
             "wrap them with U+2066..U+2069 (see bidi_math in build_design.py): %s"
             % (len(bare), [doc[i - 12:i + 10] for i in bare[:2]]))

    # The same algorithm moves a leading # to the end of a colour in an RTL line:
    # "#1b2532" is read as "1b2532#". Only text the reader sees is examined — a
    # hex inside <style> or an attribute is not prose — and it has to sit under
    # an element that declares dir="ltr". This caught one in a paragraph the
    # generator itself writes, in a section added after the rule was recorded.
    from html.parser import HTMLParser

    class LooseHex(HTMLParser):
        def __init__(self):
            HTMLParser.__init__(self)
            self.stack = []
            self.mute = 0
            self.found = []

        def handle_starttag(self, tag, attrs):
            if tag in ("style", "script"):
                self.mute += 1
            if tag not in ("br", "meta", "img", "hr", "input"):
                self.stack.append(dict(attrs).get("dir") == "ltr")

        def handle_endtag(self, tag):
            if tag in ("style", "script") and self.mute:
                self.mute -= 1
            if self.stack:
                self.stack.pop()

        def handle_data(self, data):
            if self.mute or any(self.stack):
                return
            for m in re.finditer(r"#[0-9a-fA-F]{6}\b", data):
                self.found.append(data[max(0, m.start() - 30):m.end()].strip())

    seen = LooseHex()
    seen.feed(doc)
    if seen.found:
        fail('%d colours in docs/DESIGN.html sit in RTL text without dir="ltr" '
             "and render back to front: %s" % (len(seen.found), seen.found[:2]))

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

    # A letter drawn outside the shape it belongs to is the one map error a
    # reader cannot talk themselves out of.  The tolerance is the difference
    # between the CAOP outline the app draws and the OSM one the points were
    # matched against — tens of metres — and nothing more.
    OUTSIDE_TOL_M = 150
    fre_poly = {}
    for ft in load("boundaries_freguesias.geojson")["features"]:
        rings = (ft["geometry"]["coordinates"] if ft["geometry"]["type"] == "Polygon"
                 else [r for poly in ft["geometry"]["coordinates"] for r in poly[:1]])
        fre_poly["%d|%s" % (ft["properties"]["mun_num"], ft["properties"]["name"])] = rings
    stray = []
    for key, z in zones.items():
        rings = fre_poly.get(key)
        if not rings:
            continue
        for b in z["bairros"]:
            if not b.get("ll"):
                continue
            lon, lat = b["ll"][1], b["ll"][0]
            if any(point_in_ring(lon, lat, r) for r in rings):
                continue
            d = min(ring_distance_m(lon, lat, r) for r in rings)
            if d > OUTSIDE_TOL_M:
                stray.append("%s %s (%s) is %.0f m outside" % (key, b["letter"], b.get("en"), d))
    if stray:
        fail("%d map letters fall outside their own parish: %s" % (len(stray), stray[:3]))

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
    # ---- the level-1 outlines ---------------------------------------------
    # Two NUTS III regions and the district, each split into the stretch that
    # is its own and the stretch it shares with a neighbour.  The split is
    # what makes three lines readable where they run together, so it is worth
    # checking that both halves of it survived the build.
    belts = load("boundaries_belts.geojson")["features"]
    nuts = [f for f in belts if f["properties"].get("kind") == "nuts3"]
    dist = [f for f in belts if f["properties"].get("kind") == "district"]
    codes = sorted({f["properties"]["code"] for f in nuts})
    if codes != ["11A", "11C"]:
        fail("expected NUTS III 11A and 11C, got %s" % codes)
    covered = sorted({n for f in nuts for n in f["properties"]["nums"]})
    if covered != list(range(1, 19)):
        fail("the NUTS III regions cover %s, not all 18 municipalities" % covered)
    for code in codes:
        parts = {f["properties"]["part"] for f in nuts
                 if f["properties"]["code"] == code}
        if "solo" not in parts:
            fail("NUTS III %s has no line of its own" % code)
        if "shared" not in parts:
            fail("NUTS III %s has no stepped-in line along the shared border, "
                 "so the two regions would draw one line on top of the other"
                 % code)
    if {f["properties"]["part"] for f in dist} != {"solo", "inset"}:
        fail("the district outline is not split into solo and inset")
    for f in belts:
        if f["geometry"]["type"] not in ("LineString", "MultiLineString"):
            fail("outline %s/%s is a %s; these are lines, not areas"
                 % (f["properties"].get("kind"), f["properties"].get("part"),
                    f["geometry"]["type"]))

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
