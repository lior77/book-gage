#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Automatic sanity checks over data/processed/.

Rules enforced (from BRIEF.md):
  1. every numeric field has a source and a reference year in data/sources.json
  2. no filler values - a missing field is absent, never 0 and never an estimate
  3. the district has exactly 275 freguesias, and each municipality has the
     expected number
  4. sum of parish populations == municipality population (within tolerance,
     because INE published the two at different moments)
  5. density == population / area
  6. every geometry is valid and lies inside the district bounding box
  7. level 3 covers all 275 parishes, and what the app draws matches what it
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
import glob
import hashlib
import json
import io
import os
import re
import xml.etree.ElementTree as ET
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROC = os.path.join(ROOT, "data", "processed")

# CAOP 2025. The 2013 division had 243 and these counts are the reform's:
# 25 unions dissolved back into 57 parishes, so Gaia goes from 15 to 24 and
# Matosinhos from 4 to 10. The number is written here rather than counted from
# the file, because a check that counts what it is checking cannot fail.
EXPECTED_FREG = {
    1: 7, 2: 24, 3: 10, 4: 10, 5: 7, 6: 5, 7: 25, 8: 12, 9: 14, 10: 6,
    11: 18, 12: 28, 13: 16, 14: 16, 15: 20, 16: 26, 17: 17, 18: 14,
}
EXPECTED_FREG_TOTAL = 275
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
    if len(fre) != EXPECTED_FREG_TOTAL:
        fail("expected %d freguesias in the district, got %d"
             % (EXPECTED_FREG_TOTAL, len(fre)))
    if sum(EXPECTED_FREG.values()) != EXPECTED_FREG_TOTAL:
        fail("the per-municipality counts add to %d, not %d — one of the two "
             "was edited without the other"
             % (sum(EXPECTED_FREG.values()), EXPECTED_FREG_TOTAL))
    per = {}
    for f in fre:
        per[f["mun_num"]] = per.get(f["mun_num"], 0) + 1
    for num, want in EXPECTED_FREG.items():
        if per.get(num, 0) != want:
            fail("municipality %d: %d freguesias, expected %d" % (num, per.get(num, 0), want))
    # The running number the map shows: exactly 1..N per municipality, in the
    # official (DICOFRE) order, so the map, the list and the legend agree.
    for num, want in EXPECTED_FREG.items():
        kids = sorted((f for f in fre if f["mun_num"] == num), key=lambda f: f["code"])
        nums = [f.get("num") for f in kids]
        if nums != list(range(1, want + 1)):
            fail("municipality %d: running numbers are %s, not 1..%d in code order"
                 % (num, nums[:6], want))
    if sorted(m["num"] for m in mun) != list(range(1, 19)):
        fail("municipality running numbers are not 1..18")

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
        if not f.get("dicofre"):
            fail("%s: no official code" % f["pt"])
    # ---- 7r. a parish born in 2025 says what it came out of, and wears none
    # of it. The app draws the 2025 division now, so the record that matters is
    # the other way round from before: not "this will be split" but "this was
    # part of X". Two things make the old unit's figures publishable beside a
    # parish rather than as one — they must be attributed to the old unit, and
    # the parish must not silently take its name, its description or its
    # numbers. Both were violated while this was being built, by fuzzy name
    # matching in two different places, and neither looked wrong on screen.
    born = [f for f in fre if f.get("was_part_of")]
    if len(born) != 57:
        fail("expected 57 parishes created by the 2025 reform, got %d" % len(born))
    by_old = {}
    for f in born:
        w = f["was_part_of"]
        for need in ("dicofre", "pt"):
            if not w.get(need):
                fail("%s: was_part_of has no %s" % (f["pt"], need))
        if w.get("dicofre") == f.get("dicofre"):
            fail("%s: says it was part of itself" % f["pt"])
        if f.get("note"):
            fail("%s was created in 2025 and carries a description written for "
                 "the unit it left — %r" % (f["pt"], f["note"][:40]))
        # Sharing the Hebrew is only wrong when the Portuguese differs. The
        # 2013 unit Paços de Ferreira became Paços de Ferreira and Modelos, so
        # the town legitimately keeps its own name; what must never happen is
        # "Póvoa de Varzim" reading פובואה דה וארזים, ביריז ואַרז'יבאי, which
        # names two parishes that left.
        if (f.get("he") and w.get("he") and f["he"] == w["he"]
                and f.get("pt") != w.get("pt")):
            fail("%s carries the dissolved union's Hebrew name (%s), which "
                 "names parishes that are no longer part of it" % (f["pt"], f["he"]))
        by_old.setdefault(w["dicofre"], []).append(f)
    # the dissolved unit's population is the sum of the parishes that replaced
    # it — the reform moved nobody, and a total that does not add up is a
    # breakdown that looks like one and is not
    for old, kids in by_old.items():
        want = kids[0]["was_part_of"].get("pop2021")
        got = sum(k.get("pop2021", 0) for k in kids)
        if want is not None and want != got:
            fail("the unit %s is given %d residents but the %d parishes that "
                 "replaced it add to %d" % (old, want, len(kids), got))
    if len(by_old) != 25:
        fail("expected 25 dissolved units, got %d" % len(by_old))
    # a parish whose 2021 sections straddle keeps its population and loses the
    # four fields a section is needed for — it must not have them anyway
    for f in fre:
        if f.get("census_partial"):
            for k in ("median_age", "foreign_pct", "education_pct",
                      "unemployment_pct"):
                if f.get(k) is not None:
                    fail("%s: sections do not account for all of it, yet it "
                         "carries %s = %r" % (f["pt"], k, f[k]))

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
        # a third nest, and the same rule: the field's source record is the
        # block's, not one per key
        cons_set = set(re.findall(r"'([a-z0-9_]+)'",
                                  re.search(r"CMP_CONS = new Set\(\[(.*?)\]\)",
                                            app, re.S).group(1)))
        n_cmp = 0
        for m in re.finditer(r"\{ g: '[^']*', k: '([a-z0-9_]+)'(.*?)\}", block.group(1), re.S):
            key, rest = m.group(1), m.group(2)
            only = re.search(r"only: '(\w+)'", rest)
            for level in ("municipio", "freguesia"):
                if only and only.group(1) != level:
                    continue
                skey = "%s.%s" % (level, "housing" if key in house
                                  else "cons_pct" if key in cons_set else key)
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
    # Bounded at the table's own closing brace, the way build_design.py bounds
    # it.  Unbounded, this read every `name: '…'` line in the REST of app.js as
    # an icon — 2.2.0 added a three-line lookup of the confidence words and the
    # check demanded that "verified", "reported" and "approx" be drawn in the
    # icon gallery.  A check that reads past the end of the thing it is about
    # accuses the innocent, and gets switched off.
    icon_blk = appjs[appjs.index("const ICON = {"):]
    icon_blk = icon_blk[:icon_blk.index("\n};")]
    icons = re.findall(r"\n  ([a-z0-9]+):\s*'", icon_blk)
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

    # ---- 7n. every Hebrew string the UI shows has an English one -----------
    # t() falls back to the Hebrew when a key is missing, which is the right
    # behaviour at runtime and a silent one in a diff: a new Hebrew label would
    # simply appear, in Hebrew, in the middle of the English build. This reads
    # every t('...') call in app.js and requires the table to answer it.
    appjs2 = io.open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()
    head = appjs2[:appjs2.index("Object.assign(EN, {")]
    calls = set()
    for m in re.finditer(r"(?<![A-Za-z0-9_$])t\(\s*('((?:[^'\\]|\\.)*)'"
                         r'|"((?:[^"\\]|\\.)*)")\s*\)', head):
        calls.add(m.group(2) if m.group(2) is not None else m.group(3))
    table = appjs2[appjs2.index("Object.assign(EN, {"):]
    have = set()
    for m in re.finditer(r"\n  ('((?:[^'\\]|\\.)*)'" r'|"((?:[^"\\]|\\.)*)")\s*:',
                         table):
        have.add(m.group(2) if m.group(2) is not None else m.group(3))
    gone = sorted(k for k in calls if k not in have)
    if gone:
        fail("%d Hebrew strings reach the screen with no English: %s"
             % (len(gone), [g[:40] for g in gone[:3]]))
    # a value that is still Hebrew is a translation that was never written
    untranslated = []
    for m in re.finditer(r"\n  (?:'((?:[^'\\]|\\.)*)'" r'|"((?:[^"\\]|\\.)*)")\s*:\s*\n?\s*'
                         r"(?:'((?:[^'\\]|\\.)*)'" r'|"((?:[^"\\]|\\.)*)")', table):
        k = m.group(1) if m.group(1) is not None else m.group(2)
        v = m.group(3) if m.group(3) is not None else m.group(4)
        if k is None or v is None:
            continue
        # a language names itself in its own language — that one is deliberate
        if k == v and k != "עברית":
            untranslated.append(k)
        elif re.search("[\u0590-\u05ff]", v or "") and k != "עברית":
            untranslated.append(k)
    if untranslated:
        fail("%d entries in EN are still Hebrew: %s"
             % (len(untranslated), untranslated[:3]))

    # ---- 7o. every Hebrew string in the data has an English one ------------
    # 7n guards app.js. The data is the other half and the larger one: the
    # parish notes, the municipality profiles, the source records and their
    # caveats all live in JSON, and t() falls back to the Hebrew for any of
    # them that prose_en.json does not answer. That fallback is right at
    # runtime and invisible in a diff — a parish note added in Hebrew would
    # simply appear, in Hebrew, in the middle of an English screen, with no
    # error anywhere. This walks the built data and this file's own records and
    # requires an answer for every string that reaches a reader.
    #
    # The `he` key is the one exclusion, and it is not a hole: those are place
    # names, and nm() shows the official Portuguese name in English rather than
    # a transliteration of a transliteration.
    HEBREW = re.compile(u"[\u0590-\u05ff]")
    prose_en = json.load(io.open(os.path.join(ROOT, "data", "prose_en.json"),
                                 encoding="utf-8"))["text"]

    def hebrew_strings(node, path=()):
        if isinstance(node, dict):
            for k, v in node.items():
                # a definitions_he key is a label on screen, so it counts
                if HEBREW.search(k):
                    yield path + ("<key>",), k
                for item in hebrew_strings(v, path + (k,)):
                    yield item
        elif isinstance(node, list):
            for v in node:
                for item in hebrew_strings(v, path + ("[]",)):
                    yield item
        elif isinstance(node, str) and HEBREW.search(node):
            yield path, node

    seen, absent, still_he = set(), [], []
    files = sorted(glob.glob(os.path.join(ROOT, "data", "processed", "*.json")))
    files.append(os.path.join(ROOT, "data", "sources.json"))
    for path_ in files:
        doc = json.load(io.open(path_, encoding="utf-8"))
        for keys, value in hebrew_strings(doc):
            if keys and keys[-1] == "he":
                continue
            if value in seen:
                continue
            seen.add(value)
            where = os.path.basename(path_) + ":" + "/".join(keys)
            english = prose_en.get(value)
            if english is None:
                # app.js may already answer it; that table is checked by 7n
                if value not in have:
                    absent.append((where, value[:50]))
            elif not english.strip() or HEBREW.search(english):
                still_he.append((where, value[:50]))
    if absent:
        fail("%d Hebrew strings in the data reach the screen with no English "
             "(add them to data/prose_en.json): %s" % (len(absent), absent[:3]))
    if still_he:
        fail("%d entries in prose_en.json are empty or still Hebrew: %s"
             % (len(still_he), still_he[:3]))
    print("data prose translated %d/%d strings" % (len(seen) - len(absent), len(seen)))

    # ---- 7p. every file the app loads is in every list that ships it -------
    # data/prose_en.json was added to the loader and to the standalone bundle,
    # and the Android copy task — a third hand-kept copy of the same list, in
    # another language, in another directory — went on shipping the old set.
    # The APK built, published, and would have opened to a white screen: the
    # loader's Promise.all rejects on a 404. Nothing compared the lists,
    # exactly as nothing compared the two municipality-code tables before 7m.
    # The loader is the authority here; the other two answer to it.
    wanted = set(re.findall(r"j\('([^']+\.(?:json|geojson))'\)", appjs2))
    if len(wanted) < 8:
        fail("7p read only %d data files out of app.js — the loader's shape "
             "changed and this check is now looking at the wrong thing" % len(wanted))

    bundle = io.open(os.path.join(ROOT, "scripts", "bundle_standalone.py"),
                     encoding="utf-8").read()
    listed = set(re.findall(r'"([^"]+\.(?:json|geojson))"', bundle))
    missing_bundle = sorted(w for w in wanted if w not in listed)
    if missing_bundle:
        fail("%d files the app loads are not in bundle_standalone.py's "
             "DATA_FILES, so the single-file build would 404: %s"
             % (len(missing_bundle), missing_bundle))

    gradle = io.open(os.path.join(ROOT, "android", "app", "build.gradle"),
                     encoding="utf-8").read()
    includes = re.findall(r"include\s+(.+)", gradle)
    patterns = set()
    for line in includes:
        patterns.update(re.findall(r"'([^']+)'", line))
    def shipped(rel):
        for pat in patterns:
            if pat == rel:
                return True
            if pat.endswith("/**") and rel.startswith(pat[:-2]):
                return True
        return False
    missing_apk = sorted(w for w in wanted if not shipped(w))
    if missing_apk:
        fail("%d files the app loads are not copied into the APK by "
             "android/app/build.gradle, so the phone build opens to nothing: %s"
             % (len(missing_apk), missing_apk))
    # THE THIRD AND FOURTH LISTS, added 2026-09-17 with move ו׳.  This check
    # said "every list that ships it" and compared two of the four.  The other
    # two were both already wrong:
    #
    #   sw.js ASSETS — the precache list. FOUR files the loader fetches were
    #   missing (boundaries_floods, climate, prose_en, layers_manifest), each
    #   added to the loader in a later release than this list. A copy installed
    #   from a browser therefore had no offline copy of them, and its loader's
    #   Promise.all rejects on the first run with no network. The APK was fine,
    #   which is why nobody saw it: the WebView serves its assets locally
    #   whether the worker holds them or not.
    #
    #   the APK workflow's path filter — a data file outside its globs builds
    #   no APK at all. That is the VERSION bug of 2.0.7, in the same file, and
    #   the same lesson as ARCHITECTURE.md §11: a list that does not know every
    #   input is a green build that proves nothing.
    sw = io.open(os.path.join(ROOT, "sw.js"), encoding="utf-8").read()
    sw_listed = set(re.findall(r"'\./([^']+\.(?:json|geojson))'", sw))
    missing_sw = sorted(w for w in wanted if w not in sw_listed)
    if missing_sw:
        fail("%d files the app loads are not in sw.js ASSETS, so a copy installed "
             "from a browser has no offline copy of them and fails to open on the "
             "first run without network: %s" % (len(missing_sw), missing_sw))

    wf = os.path.join(os.path.dirname(ROOT), ".github", "workflows",
                      "porto-android-apk.yml")
    if not os.path.exists(wf):
        warn("the APK workflow is not where §7p looks for it (%s) — the path "
             "filter is unchecked" % wf)
    else:
        filt = set(re.findall(r"^\s*-\s*'([^']+)'", io.open(wf, encoding="utf-8").read(), re.M))
        def triggers(rel):
            full = "porto/" + rel
            for pat in filt:
                if pat == full:
                    return True
                if pat.endswith("/**") and full.startswith(pat[:-2]):
                    return True
            return False
        missing_wf = sorted(w for w in wanted if not triggers(w))
        if missing_wf:
            fail("%d files the app loads are not in the APK workflow's path filter, "
                 "so changing one of them publishes no APK: %s"
                 % (len(missing_wf), missing_wf))

    print("data files shipped %d/%d by the bundle, the APK, the worker and the "
          "build trigger" % (len(wanted), len(wanted)))

    # ---- 7q. nothing is FULLY published and still listed as missing --------
    # missing.items is part of the product: it is the app telling the reader
    # what it will not claim and why. A record that stays there after the field
    # arrives is the app making a false statement about itself — and a quiet
    # one, because the number shows on screen while the record sits in a panel
    # nobody re-reads. municipio.foreign_pct and municipio.median_age both said
    # "PORDATA and AIMA are blocked" while sitting at 18/18 and 243/243 from
    # the 2021 census, and i18n.prose said the prose was deliberately
    # untranslated on the very build that translated it.
    #
    # The test is COMPLETE coverage, not any coverage. The first version asked
    # whether the field had any values at all and flagged
    # freguesia.price_eur_m2, which is published for 70 parishes of 243 and
    # absent in seven whole municipalities — a partial gap with a reason is
    # exactly what this list exists to carry. That finding was the check being
    # wrong, not the data.
    rows_at = {"municipio": mun, "freguesia": fre}
    contradictions = []
    for item in sources["missing"]["items"]:
        head = item["field"].split(" — ")[0]
        for name in re.split(r"\s*/\s*", head):
            name = name.strip()
            level, _, key = name.partition(".")
            rows = rows_at.get(level)
            if not rows or name not in sources["fields"]:
                continue
            have = sum(1 for r in rows if r.get(key) is not None)
            if have == len(rows):
                contradictions.append((name, "%d/%d" % (have, len(rows))))
    if contradictions:
        fail("%d fields are fully published AND listed in missing.items — the "
             "missing list is telling the reader something untrue about the "
             "app: %s" % (len(contradictions), contradictions[:3]))
    print("missing.items %d records, none of them fully published"
          % len(sources["missing"]["items"]))

    # ---- 7s. the building count says which buildings ----------------------
    # N_EDIFICIOS_CLASSICOS is INE's edifícios clássicos — permanent
    # constructions intended for habitation. It is NOT the number of buildings
    # in a parish: anything with no dwelling in it (a factory, an office block,
    # a school, a church) is outside the universe entirely. The app labelled it
    # "בניינים", flat, which a reader takes as every building there is — and in
    # Porto, where the office blocks and the factories are, that is materially
    # wrong. Same shape as calling crimes registados "violent crime": the
    # source's own word is narrower than the app's.
    #
    # Both levels' figures come from the same column, so both labels are held
    # to the same thing.
    appjs3 = io.open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()
    if re.search(r"t\('בניינים'\)", appjs3):
        fail("the building count is labelled 'בניינים' — INE counts only "
             "edifícios clássicos, buildings meant for habitation, so a bare "
             "'buildings' claims a universe the number does not cover")
    for level in ("municipio", "freguesia"):
        rec = sources["fields"].get(level + ".housing")
        if not rec:
            fail("%s.housing has no source record" % level)
            continue
        defs = rec.get("definitions_he") or {}
        key = [k for k in defs if "בניינ" in k]
        if not key:
            fail("%s.housing does not define what it counts as a building"
                 % level)
            continue
        text = defs[key[0]]
        # the column, and the fact that the universe is narrower than "buildings"
        for need in ("N_EDIFICIOS_CLASSICOS", "למגורים"):
            if need not in text:
                fail("%s.housing's building definition does not say %r — the "
                     "reader cannot tell which buildings are counted"
                     % (level, need))
        # A share is only readable if its denominator is. Three of these are
        # out of usual residences and not out of all dwellings, and deep repair
        # is out of ALL buildings and not out of those needing repair — which
        # is exactly what the label "מהם תיקון עמוק" used to claim.
        for term, need in (("בבעלות הדיירים", "מגורי הקבע"),
                           ("בשכירות", "מגורי קבע"),
                           ("עם חניה", "מגורי קבע"),
                           ("תיקון עמוק", "כלל בנייני המגורים")):
            got = defs.get(term)
            if not got:
                fail("%s.housing does not define %r" % (level, term))
            elif need not in got:
                fail("%s.housing's %r does not name its denominator (%r) — a "
                     "share whose denominator is unstated reads as a share of "
                     "everything" % (level, term, need))

    # the education share counts children in the denominator, and the label has
    # to carry that: 17.4% of everyone is not 17.4% of adults
    if re.search(r"t\('השכלה גבוהה'\)", appjs3):
        fail("the education share is labelled 'השכלה גבוהה' — INE divides by "
             "ALL residents, children included, so a bare label reads as a "
             "share of adults")

    # ---- 7t. REN and RAN: four numbers, and the fourth is not the sum -------
    # The thing that makes this table dangerous is that REN and RAN OVERLAP —
    # by up to 16.2% of a municipality — so REN% + RAN% is not the constrained
    # share and never was. The identity below is the one the page rests on, and
    # it is checked on the shipped numbers rather than trusted from the build.
    #
    # The other half is Porto. DGT publishes no delimitation for it and none
    # for Vila do Conde's REN, and the temptation there is a zero: a zero says
    # "nothing is restricted here", which is a claim nobody made.
    HEBREW_RE = re.compile(u"[\u0590-\u05ff]")
    CONS_PCT = ("ren_pct", "ran_pct", "both_pct", "either_pct")
    cons_cov = {"ren": 0, "ran": 0}
    fre_sum = {}
    for level, rows, skey in (("municipio", mun, "municipio.cons_pct"),
                              ("freguesia", fre, "freguesia.cons_pct")):
        for r in rows:
            c = r.get("cons")
            name = r.get("he") or r.get("pt")
            if not c:
                fail("%s %s has no cons block at all" % (level, name))
                continue
            if c.get("area_ha") is None:
                fail("%s %s: cons has no area_ha" % (level, name))
                continue
            # the denominator is the unit's own area, and the app already
            # publishes that in km2 from the same polygons
            if r.get("area_km2"):
                gap = abs(c["area_ha"] / 100.0 / r["area_km2"] - 1) * 100
                if gap > 0.6:
                    fail("%s %s: cons area %.1f ha against area_km2 %.2f, %.2f%% apart"
                         % (level, name, c["area_ha"], r["area_km2"], gap))
            for k in CONS_PCT:
                v = c.get(k)
                if v is None:
                    continue
                if not (0 <= v <= 100):
                    fail("%s %s: %s is %r" % (level, name, k, v))
            if all(c.get(k) is not None for k in CONS_PCT):
                got = c["ren_pct"] + c["ran_pct"] - c["both_pct"]
                if abs(got - c["either_pct"]) > 0.25:
                    fail("%s %s: REN+RAN-both is %.1f but the total says %.1f — "
                         "the total must be the union, never the sum"
                         % (level, name, got, c["either_pct"]))
                if c["both_pct"] > min(c["ren_pct"], c["ran_pct"]) + 0.05:
                    fail("%s %s: the overlap (%.1f) is larger than one of the two"
                         % (level, name, c["both_pct"]))
            elif c.get("either_pct") is not None:
                # only one reserve published: the total is that one, unchanged
                only = [k for k in ("ren_pct", "ran_pct") if c.get(k) is not None]
                if len(only) != 1 or abs(c[only[0]] - c["either_pct"]) > 0.05:
                    fail("%s %s: one reserve published but the total is not it"
                         % (level, name))
            if level == "municipio":
                for kind in ("ren", "ran"):
                    if c.get(kind + "_pct") is not None:
                        cons_cov[kind] += 1
                        if not c.get(kind + "_year"):
                            fail("municipio %s: %s has a share but no reference "
                                 "year" % (name, kind.upper()))
            else:
                b = fre_sum.setdefault(r["dicofre"][:4], {"ren": 0.0, "ran": 0.0, "n": 0})
                b["n"] += 1
                for kind in ("ren", "ran"):
                    if c.get(kind + "_ha") is not None:
                        b[kind] += c[kind + "_ha"]
            if sources["fields"].get(skey) is None:
                fail("%s has no source record" % skey)

    if cons_cov != {"ren": 16, "ran": 17}:
        fail("REN/RAN coverage is %r, not 16 and 17 of 18" % cons_cov)
    # the two DGT does not publish carry no key at all — not a zero
    for code, missing_kinds in (("1312", ("ren", "ran")), ("1316", ("ren",))):
        row = next((m for m in mun if m.get("dicofre") == code), None)
        if row is None:
            fail("no municipality %s" % code)
            continue
        for kind in missing_kinds:
            for suffix in ("_pct", "_ha"):
                if (row.get("cons") or {}).get(kind + suffix) is not None:
                    fail("%s has a %s%s and DGT publishes no delimitation for it "
                         "— that has to be absent, not zero"
                         % (row.get("he"), kind, suffix))
        for f in fre:
            if f.get("dicofre", "").startswith(code):
                for kind in missing_kinds:
                    if (f.get("cons") or {}).get(kind + "_pct") is not None:
                        fail("%s: a parish of a municipality with no %s "
                             "delimitation has a share" % (f.get("he"), kind.upper()))
    # every piece adds back up to the whole it came from
    for code, b in fre_sum.items():
        row = next((m for m in mun if m.get("dicofre") == code), None)
        c = (row or {}).get("cons") or {}
        for kind in ("ren", "ran"):
            whole = c.get(kind + "_ha")
            if whole is None:
                continue
            if abs(b[kind] - whole) > max(1.0, 0.002 * whole):
                fail("%s %s: the parishes add to %.1f ha, the municipality is "
                     "%.1f ha" % (row.get("he"), kind.upper(), b[kind], whole))

    # Rule 4, where this data is most likely to break it: REN and RAN are
    # restrições de utilidade pública. They restrict and they license; they are
    # not a ban, and the app must not say they are.
    for skey in ("municipio.cons_pct", "freguesia.cons_pct"):
        entry = sources["fields"].get(skey) or {}
        for want in ("source", "reference_year", "caveat_he", "confidence",
                     "validation_he", "coverage"):
            if not entry.get(want):
                fail("%s: no %s recorded" % (skey, want))
        cav = entry.get("caveat_he") or ""
        if "restrições de utilidade pública" not in cav:
            fail("%s: the caveat does not name what REN and RAN legally are" % skey)
        if entry.get("confidence") != "approx":
            fail("%s: a derived share with no parallel publication is approx"
                 % skey)
    appjs4 = io.open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()
    for bad in ("אסור לבנות בו", "אחוז השטח שאסור", "איסור בנייה'",
                "שטח אסור לבנייה"):
        if bad in appjs4:
            fail("app.js calls REN/RAN an outright ban (%r). They are "
                 "restrictions with an exception regime." % bad)

    # ---- 7ae. CRUS: the land-use regime, and where it does not add up -----
    # This is the only block in the app whose reference year is the date a
    # municipality published its own plan, and whose hectares are the source's
    # own rather than anything measured here. Two things can therefore go wrong
    # quietly: a share taken against the wrong denominator, and a total that
    # does not equal the municipality it describes.
    #
    # The second one is real. CRUS tiles a whole municipality, so its hectares
    # ought to be that municipality's area, and for seventeen of the eighteen
    # they are to within 0.04%. Paços de Ferreira is 2.7% larger. The app says
    # so on the card; this table is what makes a NEW outlier fail the build
    # instead of joining it silently.
    CRUS_GAP_KNOWN = {"1309": 2.71}      # dicofre → the gap, in per cent
    CRUS_GAP_QUIET = 0.5                 # below this it is rounding
    # The other finding in this table, and the more serious one: a plan that is
    # not in force. DGT marks Santo Tirso's `Não vigente`, which makes every
    # figure above it a description of something nobody is bound by. The app
    # says so. A municipality joining this list is a change of meaning, not of
    # data, so it fails the build until someone has looked.
    CRUS_NOT_IN_FORCE = {"1314"}
    crus_n = 0
    for r in mun:
        c = r.get("crus")
        name = r.get("he") or r.get("pt")
        code = r.get("dicofre", "")
        if not c:
            fail("municipio %s has no crus block" % name)
            continue
        crus_n += 1
        for want in ("total_ha", "classes", "cats", "pdm_year", "registo",
                     "situacao", "escala", "polygons"):
            if c.get(want) in (None, "", [], {}):
                fail("crus %s: no %s" % (name, want))
        if not (1990 <= (c.get("pdm_year") or 0) <= 2030):
            fail("crus %s: pdm_year is %r" % (name, c.get("pdm_year")))
        classes = c.get("classes") or []
        # Five classes in this district, not two: `Solo Urbano`, `Solo Rústico`,
        # the transitional urbanisable one, and the two that are the source
        # saying it does not know. Adding only the first two to 100 is the
        # mistake this replaces — it was in here for an afternoon.
        if abs(sum(x["pct"] for x in classes) - 100) > 0.3:
            fail("crus %s: the classes add to %.1f%% and not to a whole"
                 % (name, sum(x["pct"] for x in classes)))
        # Every hectare figure here is rounded to one place, so a sum of n of
        # them can be 0.05n away from the total before anything is wrong. A
        # flat tolerance failed Póvoa de Varzim on eighteen categories that
        # were right.
        slack = lambda n: max(0.3, 0.05 * n)
        if abs(sum(x["ha"] for x in classes)
               - (c.get("total_ha") or 0)) > slack(len(classes)):
            fail("crus %s: the class hectares do not add to the total" % name)
        for x in classes:
            if not x.get("lbl"):
                fail("crus %s: class %r has no label" % (name, x.get("pt")))
            if not (0 <= x.get("pct", -1) <= 100):
                fail("crus %s: class %r is %r%%" % (name, x.get("pt"), x.get("pct")))
        cats = c.get("cats") or []
        if not cats:
            fail("crus %s: no categories at all" % name)
        if abs(sum(x["ha"] for x in cats)
               - (c.get("total_ha") or 0)) > slack(len(cats)):
            fail("crus %s: the categories do not add to the total" % name)
        for x in classes:
            mine = [y for y in cats if y["cls"] == x["pt"]]
            got = sum(y["ha"] for y in mine)
            if abs(got - x["ha"]) > slack(len(mine)):
                fail("crus %s: %s categories add to %.1f, the class is %.1f"
                     % (name, x["pt"], got, x["ha"]))
        for x in cats:
            # a category reaching the screen in Portuguese, or with no label at
            # all, is how the constraint page nearly shipped its class names
            if not x.get("lbl") or not x.get("cls_lbl"):
                fail("crus %s: category %r has no label" % (name, x.get("pt")))
            if not (0 <= x.get("pct", -1) <= 100):
                fail("crus %s: category %r is %r%%" % (name, x.get("pt"), x.get("pct")))
        in_force = c.get("situacao") == "Vigente"
        if in_force and code in CRUS_NOT_IN_FORCE:
            fail("crus %s: it was marked %r and now says Vigente — if DGT "
                 "published a new plan, take it out of CRUS_NOT_IN_FORCE"
                 % (name, "Não vigente"))
        if not in_force and code not in CRUS_NOT_IN_FORCE:
            fail("crus %s: the plan is %r and nothing says so. A municipality "
                 "whose PDM is not in force describes ground nobody is bound "
                 "by, and that has to be on the card before it is in a table"
                 % (name, c.get("situacao")))
        gap = c.get("caop_gap_pct")
        if gap is None:
            fail("crus %s: no comparison with the CAOP area" % name)
        elif abs(gap) >= CRUS_GAP_QUIET:
            known = CRUS_GAP_KNOWN.get(code)
            if known is None:
                fail("crus %s: CRUS is %.2f%% away from the CAOP area and this "
                     "is a new finding — put it in CRUS_GAP_KNOWN once it is "
                     "understood, and make sure the card says it" % (name, gap))
            elif abs(gap - known) > 0.1:
                fail("crus %s: the CAOP gap moved from %.2f%% to %.2f%%"
                     % (name, known, gap))
    if crus_n != 18:
        fail("CRUS covers %d of 18 municipalities" % crus_n)

    entry = sources["fields"].get("municipio.crus") or {}
    for want in ("source", "reference_year", "confidence", "coverage",
                 "caveat_he", "validation_he", "definitions_he", "url"):
        if not entry.get(want):
            fail("municipio.crus: no %s recorded" % want)
    # The hectares are DGT's; the share is a division this project did. Rule 3
    # calls anything derived approx, and the temptation here is to call it
    # reported because the inputs are published.
    if entry.get("confidence") != "approx":
        fail("municipio.crus: the share is derived, so it is approx")
    if "Solo Rústico" not in (entry.get("definitions_he") or {}):
        fail("municipio.crus: the two legal classes are not defined")

    # Rule 4, where this data is most likely to break it. `Solo Rústico` is not
    # agricultural land — it is everything outside the urban perimeter — and
    # `Solo Urbano` is not permission to build on a particular plot.
    appjs5 = io.open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()
    for bad in ("קרקע חקלאית'", "'קרקע זמינה לבנייה", "מותר לבנות כאן",
                "אדמה חקלאית"):
        if bad in appjs5:
            fail("app.js restates CRUS into something stronger (%r)" % bad)
    # Both findings above are only findings if the app says them. These are the
    # two functions that do; a card that stopped calling them would leave the
    # table looking exactly as authoritative as the other seventeen.
    for fn in ("crusPlanNote", "crusGapNote"):
        if appjs5.count(fn) < 2:
            fail("app.js does not both define and use %s()" % fn)

    # ---- 7u. a label carried in a table still has to reach the translator ---
    # 7n reads every literal t('...') in app.js. It cannot see t(CONS_HE[k]),
    # and that is exactly how the constraint page's three class names would
    # have shipped in Hebrew inside the English build — the same shape as the
    # POI labels, which froze the language once already.
    en_table = appjs4[appjs4.index("Object.assign(EN, {"):]
    en_keys = set()
    for m in re.finditer(r"\n  ('((?:[^'\\]|\\.)*)')\s*:", en_table):
        en_keys.add(m.group(2))
    for tbl in ("CONS_HE", "CONS_FULL"):
        block = re.search(tbl + r"\s*=\s*\{(.*?)\}", appjs4, re.S)
        if not block:
            fail("app.js has no %s table" % tbl)
            continue
        vals = re.findall(r":\s*'((?:[^'\\]|\\.)*)'", block.group(1))
        if not vals:
            fail("%s holds no labels" % tbl)
        for v in vals:
            if HEBREW_RE.search(v) and v not in en_keys:
                fail("%s carries %r and the English table does not answer it"
                     % (tbl, v))

    # ---- 7v. the Android manifest is XML, and the build is not the reader ---
    # 1.41.2 shipped a manifest whose explanatory comment sat INSIDE the
    # <activity> start tag, between two attributes. XML forbids that, the
    # manifest merger said only "Error parsing", and the failure surfaced
    # eleven minutes later in a CI log rather than here. The manifest is a
    # source file like any other: it gets parsed before it is pushed.
    man = os.path.join(ROOT, "android", "app", "src", "main", "AndroidManifest.xml")
    if not os.path.exists(man):
        fail("the Android manifest is gone")
    else:
        try:
            ET.parse(man)
        except ET.ParseError as e:
            fail("AndroidManifest.xml is not well-formed XML: %s" % e)

    # ---- 7w. the page and the wrapper agree on every word between them ------
    # The photo picker failed three times running, and each time the symptom was
    # the same: NOTHING HAPPENED AND NOTHING WAS SAID. The channel between the
    # page and the Android wrapper is now a handful of bare strings — a bridge
    # name, the method names on it, the path the picked bytes are served from,
    # the function the wrapper calls to nudge the page, and the prefixes that
    # say what went wrong. Every one of them is spelled out separately on each
    # side, in a different language, and a typo in any of them is silence again.
    # So both files are read and required to say the same thing.
    java = os.path.join(ROOT, "android", "app", "src", "main", "java",
                        "app", "porto", "atlas", "MainActivity.java")
    if not os.path.exists(java):
        fail("MainActivity.java is gone")
    else:
        jv = io.open(java, encoding="utf-8").read()
        if '"PortoPick"' not in jv:
            fail("the wrapper does not register the PortoPick bridge")
        if "window.PortoPick" not in appjs4:
            fail("app.js never looks for the PortoPick bridge")
        if '"/__picked/"' not in jv:
            fail("the wrapper does not serve the picked bytes under /__picked/")
        if "window.__portoPicked" not in jv or "window.__portoPicked" not in appjs4:
            fail("the nudge window.__portoPicked is not on both sides")
        for m in ("open", "take"):
            if ('public void %s(' % m) not in jv and ('public String %s(' % m) not in jv:
                fail("the bridge has no %s() for the page to call" % m)
            if ("b.%s(" % m) not in appjs4:
                fail("app.js never calls the bridge's %s()" % m)
        # Every outcome the wrapper can write has to be one the page can read.
        said = set(re.findall(r'finishPick\("([a-z]+):', jv))
        heard = set(re.findall(r"s\.indexOf\('([a-z]+):'\)", appjs4))
        heard.add("err")          # the catch-all branch, which needs no prefix test
        for w in sorted(said - heard):
            fail("the wrapper can answer %r and app.js has no branch for it" % (w + ":"))

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
    # Two NUTS III regions, each split into the stretch that is its own and
    # the stretch it shares with the other.  The split is what makes two lines
    # readable where they run together, so it is worth checking that both
    # halves survived the build.  The district is not here any more: it is
    # the municipalities' outer edge and is drawn once, by them (2.0.0).
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
        # the area polygon: what the app fills when a region is chosen.  Until
        # 2.0.1 there was none and the app filled the region's municipalities
        # inside the district, so the colour stopped at the district edge while
        # the outline around it did not.
        if "area" not in parts:
            fail("NUTS III %s has no area polygon, so the app cannot fill the "
                 "whole region — only the part inside the district" % code)
        else:
            area = [f for f in nuts if f["properties"]["code"] == code
                    and f["properties"]["part"] == "area"]
            if len(area) != 1:
                fail("NUTS III %s has %d area polygons; one is expected" % (code, len(area)))
            elif area[0]["geometry"]["type"] not in ("Polygon", "MultiPolygon"):
                fail("NUTS III %s: the area is a %s, which cannot be filled"
                     % (code, area[0]["geometry"]["type"]))
        if "shared" not in parts:
            fail("NUTS III %s has no stepped-in line along the shared border, "
                 "so the two regions would draw one line on top of the other"
                 % code)
    if dist:
        fail("boundaries_belts.geojson carries a district outline again; the district "
             "is the municipalities' outer edge and is drawn once, by them")
    for f in belts:
        # `area` is the one feature here that is meant to be a polygon — it is
        # what the app fills.  Every other feature is a line, and a polygon
        # among them would be a filled shape where a border was meant.
        if f["properties"].get("part") == "area":
            continue
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
    # ---- 7x. the prose agrees with the data it sits next to ----------------
    # Found on 2026-09-15 while reading the info page: it told the reader the
    # district has 243 parishes on CAOP 2020, that the 2025 boundaries were
    # "not in the app yet", and explained a "split in 2025" flag no row can
    # carry — while section 3 above enforces 275 and sources.json names CAOP
    # 2025 in ten fields. Every check in this file validated data; none read
    # the sentences beside it, so a page explaining the numbers contradicted
    # the numbers for several releases. This reads app.js as text — every
    # literal, Hebrew and English, comments included — and binds each count
    # or edition it names to the value the data actually holds.
    appjs_txt = io.open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()
    zones_all = load("zones.json")["zones"]
    n_new25 = sum(1 for f in fre if f.get("was_part_of"))
    n_unions = len({f["was_part_of"]["dicofre"] for f in fre if f.get("was_part_of")})
    n_untouched = len(fre) - n_new25
    n_quarters = len(city["quarters"])
    n_city_bairros = sum(len(z.get("bairros", []))
                         for k, z in zones_all.items() if k.startswith("1|"))
    # (?<!\d)…(?!\d) keeps "2011 parishes" from reading as 011 or 201.
    # The bare "N parishes" may name the district (275) or the untouched
    # remainder (218); anything else is a number that once was true.
    bound = [  # (pattern, expected, what the number is)
        (r"(?<!\d)(\d{3})(?!\d)\s*(?:רובעים|parishes|shapes)",
         {len(fre), n_untouched, len(fre) - n_quarters},
         "parishes (district, untouched remainder, or outside Porto city)"),
        (r"(?:מ-|of the )(\d{3}) (?:היחידות|units)", len(fre), "units the app draws"),
        (r"(\d+) (?:רובעים חדשים|new parishes)", n_new25, "parishes the 2025 reform created"),
        (r"(\d+) (?:איחודים|unions)", n_unions, "unions the 2025 reform dissolved"),
        (r"(\d+) (?:הרובעים האחרים|other parishes)", n_untouched, "parishes the reform left alone"),
        (r"(\d+) (?:רבעי פורטו|Porto quarters)", n_quarters, "Porto quarters"),
        (r"(\d+) (?:שכונות|neighbourhoods)", n_city_bairros, "Porto neighbourhoods"),
    ]
    for pat, want, what in bound:
        wants = want if isinstance(want, set) else {want}
        for m in re.finditer(pat, appjs_txt):
            got = int(m.group(1))
            if got not in wants:
                fail("app.js prose says %d %s; the data holds %s (…%s…)"
                     % (got, what, "/".join(str(w) for w in sorted(wants)),
                        appjs_txt[max(0, m.start()-25):m.end()+10].replace("\n", " ")))
    # The edition the app draws is the one sources.json names. Any other CAOP
    # year in app.js is either history (2013 — the division the reform undid,
    # and TIPAU's base) or a sentence nobody updated. Naming a new historical
    # edition here is a deliberate act, which is the point.
    CAOP_CURRENT = str(sources["fields"]["map.caop_2025"]["reference_year"])
    CAOP_HISTORY_OK = {"2013"}
    # the licence notices are prose too, and one of them said CAOP 2020 until 2026-09-15
    years = set(re.findall(r"CAOP\s*(20\d\d)", appjs_txt + " " + " ".join(sources["license_notices"])))
    if CAOP_CURRENT not in years:
        fail("app.js never names the CAOP edition it draws (%s)" % CAOP_CURRENT)
    for y in sorted(years - {CAOP_CURRENT} - CAOP_HISTORY_OK):
        fail("app.js names CAOP %s; the app draws CAOP %s and %s is not a "
             "listed historical edition" % (y, CAOP_CURRENT, y))
    # Two claims that were true once and cannot be true now: the boundaries
    # are in (map.caop_2025 exists), and every row is a 2025 parish with a
    # 2025 code, so no row can be a dissolved union wearing a "split" flag.
    for phrase in ("עדיין אינם באפליקציה", "not in the app yet",
                   "פורק ב-2025", "split in 2025"):
        if phrase in appjs_txt:
            fail("app.js still says '%s' — the 2025 division is what it draws"
                 % phrase)

    # THE SAME RULE, over the documents.  Until 2.0.4 this section read app.js
    # and nothing else, and README.md — the first page a new reader opens —
    # had been saying "243 parishes", "CAOP 2020" and "the 2025 boundaries are
    # not in the app yet" for several releases while every one of those was
    # false.  The rule was never "app.js must not lie"; it was "the prose must
    # agree with the data", and prose is mostly in the documents.
    #
    # A document may still narrate history, and must be able to: "from 243 to
    # 275" is the project explaining itself, not a stale claim.  Two things
    # make that safe rather than a hole:
    #
    #   1. Every .md is declared LIVE or RECORD below.  A RECORD is a dated
    #      snapshot — a revision document, a work plan written for a version
    #      that shipped — and is read as history entire.  An undeclared file
    #      FAILS, so adding a document forces the decision rather than
    #      defaulting to unchecked.
    #   2. Inside a LIVE document a number may still appear in a TRANSITION —
    #      "243 → 275", "מ-243 ל-275", "from 243 to 275".  That shape names
    #      the old value and the new one together, so it cannot mislead, and
    #      it is the only exemption.
    DOC_KIND = {
        # LIVE — says what is true now.  Every count and edition is bound.
        "README.md": "live",
        "docs/ARCHITECTURE.md": "live",
        "docs/HANDOFF.md": "live",
        "docs/NETWORK-ALLOWLIST.md": "live",
        # RECORD — a dated snapshot, read as history.  Each says so in its own
        # opening lines, and that is why it is exempt, not convenience.
        "docs/UX-2.0.0.md": "record",          # "the UX document for 2.0.0"
        "docs/UI-2.0.0.md": "record",          # ditto, with §9 the built record
        "docs/REVISION-2.0.0.md": "record",    # the revision's own findings
        "docs/WORKPLAN.md": "record",          # "נכתב ל-1.30.0"
        "docs/DATA-REQUEST.md": "record",      # the brief sent out, as sent
        "docs/DATA-ACQUIRED.md": "record",     # "מה נמשך בפועל — 2026-09-07"
        "docs/DELIVERY.md": "record",          # "ההחלטות שהתקבלו ב-13.9.2026"
        "docs/INFORMATION-PLAN.md": "record",  # "נכתב ב-2026-09-17 מול 2.0.6"
    }
    # A generated change record is a RECORD by construction: build_diff.py
    # writes one per release, dated, naming the revision it was taken against,
    # and nobody edits it.  Declared by PATTERN and not by name, because a rule
    # that has to be edited at every release is a rule that will be forgotten —
    # and the alternative, leaving them undeclared, is the hole §7x exists to
    # close.  §7ai checks that each one really is generated.
    DOC_PATTERNS = [(re.compile(r"^docs/CHANGES-\d+\.\d+\.\d+\.md$"), "record")]

    def doc_kind(rel):
        if rel in DOC_KIND:
            return DOC_KIND[rel]
        for pat, kind in DOC_PATTERNS:
            if pat.match(rel):
                return kind
        return None
    md_paths = sorted(
        os.path.relpath(x, ROOT).replace(os.sep, "/")
        for x in glob.glob(os.path.join(ROOT, "*.md"))
        + glob.glob(os.path.join(ROOT, "docs", "*.md")))
    for rel in md_paths:
        if doc_kind(rel) is None:
            fail("%s is not declared live or record in checks.py §7x DOC_KIND. "
                 "A document nobody classified is a document nobody checks — "
                 "say which it is" % rel)
    for rel in sorted(DOC_KIND):
        if rel not in md_paths:
            fail("checks.py §7x DOC_KIND names %s, which does not exist" % rel)

    # "243 → 275", "מ-243 ל-275", "from 243 to 275" — the old number beside the
    # new one.  Matched on the pair, so a lone stale number is never exempt.
    def in_transition(txt, start, end):
        w = txt[max(0, start - 40):end + 40]
        return bool(re.search(r"(?<!\d)\d{2,4}\s*(?:→|->|–|—)\s*\d{2,4}(?!\d)", w)
                    or re.search(r"מ-\s*\d{2,4}\s*ל-\s*\d{2,4}", w)
                    or re.search(r"from\s+\d{2,4}\s+to\s+\d{2,4}", w, re.I))

    # A LIVE document is checked for SUPERSEDED values, not for every number
    # it names.  The first cut of this bound each "N parishes" to the set of
    # current counts, the way the app.js half does, and it was wrong for prose:
    # it flagged "3,092 parishes nationally" (TIPAU's own figure), "131
    # parishes — all four values empty" (a legitimate subset), and the lines
    # where ARCHITECTURE.md QUOTES the old string while describing this very
    # check.  A document has to be able to say "it used to say 243".  So what
    # is bound is the short list of values that were true once and cannot be
    # true now.
    STALE = [
        # Only the UNIT-COUNT forms: "243 parishes", "243 הרובעים". Deliberately
        # NOT fractions ("70/243", "119 מתוך 243") and NOT a bare "**243**" in
        # a table cell. Both cuts that tried to cover those flagged true
        # sentences — INE really did publish a price for 70 of the 243 parishes
        # of the 2013 division, and saying so is not a stale claim. A check
        # that cries wolf on correct prose gets switched off, and then it
        # protects nothing.
        (r"(?<![\d,/])243(?![\d/])\s*(?:ה)?(?:רובעים|פרגזיות|parishes)",
         "243 parishes", len(fre)),
        # "the other 236" always meant the parishes outside Porto city, which
        # is 275 - 7 quarters, and never the reform's untouched remainder.
        (r"(?<![\d,])236(?![\d])\s*(?:הרובעים|הפרגזיות|parishes)",
         "236 parishes outside Porto city", len(fre) - n_quarters),
        (r"(?<![\d,])1,720(?![\d])", "1,720 localities", None),
        (r"(?<![\d,])1,530(?![\d])\s*(?:אתרים|sites)", "1,530 sites", None),
        (r"CAOP\s*2020", "CAOP 2020 as the edition drawn", None),
    ]

    # The superseded value is sometimes the TRUE one, and no pattern can see
    # the difference: TIPAU 2025 really does stand on CAOP 2020 and really does
    # carry 243 parishes in this district, and the raw file named in the source
    # table really is the 2020 one.  Each exemption names the line it excuses
    # and why.
    #
    # It is keyed on a distinctive FRAGMENT of that line, so it cannot drift
    # onto some other sentence — but editing the line around the fragment does
    # NOT cancel it, and the first version of this comment claimed it did.
    # What stands guard instead is the dead-exemption check below: an entry
    # that matches nothing has outlived its sentence and fails, so an exemption
    # cannot quietly become a licence for a line nobody has read in a year.
    STALE_OK = [
        ("docs/ARCHITECTURE.md", "raw/caop2020_porto_freguesias.geojson",
         "the source table describing the 2020 raw file, which is what it is"),
        ("docs/ARCHITECTURE.md", "היא עומדת על **CAOP 2020**",
         "TIPAU 2025 is published on the CAOP 2020 division — true, and the "
         "reason 57 parishes have no class"),
        ("docs/ARCHITECTURE.md", "ו-243 במחוז פורטו, כמ",
         "the count inside TIPAU's own export, on its 2020 base"),
        ("docs/ARCHITECTURE.md", "CAOP 2020. ‏`build.py → read_tipau()`",
         "same TIPAU base, in the sentence that says how it is read"),
        ("docs/ARCHITECTURE.md", "7x · הפרוזה תואמת לנתונים",
         "the checks table describing this very rule"),
        ("docs/ARCHITECTURE.md", "עמוד ״מידע״ אחד לשני קהלים",
         "§11, the record of a trap that was fixed"),
        ("docs/ARCHITECTURE.md", "מחירי INE ברמת הרובע בשבע עיריות",
         "§11, a closed finding about codes that resolve against CAOP 2020"),
        ("docs/ARCHITECTURE.md", "`missing.items` היא חלק מהמוצר",
         "the checks table describing 7q"),
    ]

    def excused(rel, line):
        return any(f == rel and frag in line for f, frag, _why in STALE_OK)

    # An exemption that excuses nothing is an exemption nobody re-read.
    for f, frag, why in STALE_OK:
        path_ = os.path.join(ROOT, f)
        if not os.path.exists(path_) or frag not in io.open(path_, encoding="utf-8").read():
            fail("checks.py §7x STALE_OK excuses %r in %s (%s), and that text is "
                 "no longer there — drop the exemption or fix the line" % (frag, f, why))

    def quoted(line, start, end):
        """Is the match inside quotation marks on its own line?

        A document quoting the old wording — "the info page said ״243
        parishes״" — is the project describing its own history, and that is
        the sentence this check exists to make possible, not to forbid."""
        for op, cl in (("\u05f4", "\u05f4"), ('"', '"'), ("\u201c", "\u201d"),
                       ("\u00ab", "\u00bb"), ("`", "`")):
            i = 0
            while True:
                o = line.find(op, i)
                if o < 0:
                    break
                c = line.find(cl, o + 1)
                if c < 0:
                    break
                if o < start and end <= c + 1:
                    return True
                i = c + 1
        return False

    # A live document still carries sections that are pure record: the table of
    # traps already fixed, the findings already closed. They exist to say what
    # WAS true, and binding them to what is true now would forbid the project
    # from remembering anything. The heading marks them.
    RECORD_HEADING = re.compile(
        r"(מלכודות|נסגר|מה נדחה|שגיאות שנעשו|היסטוריה|traps|closed|rejected)", re.I)

    def live_spans(txt):
        """The byte ranges of a document that are NOT inside a record section."""
        heads = [(m.start(), m.group(0)) for m in re.finditer(r"(?m)^#{1,4} .*$", txt)]
        spans, i = [], 0
        for n, (pos, head) in enumerate(heads):
            end = heads[n + 1][0] if n + 1 < len(heads) else len(txt)
            if RECORD_HEADING.search(head):
                spans.append((i, pos))
                i = end
        spans.append((i, len(txt)))
        return spans

    for rel in md_paths:
        if doc_kind(rel) != "live":
            continue
        txt = io.open(os.path.join(ROOT, rel), encoding="utf-8").read()
        lines = txt.split("\n")
        spans = live_spans(txt)
        def is_live(pos):
            return any(a <= pos < b for a, b in spans)
        for pat, what, now in STALE:
            for m in re.finditer(pat, txt):
                ln = txt.count("\n", 0, m.start())
                line = lines[ln]
                col = m.start() - (sum(len(x) + 1 for x in lines[:ln]))
                if not is_live(m.start()) or in_transition(txt, m.start(), m.end()):
                    continue
                if quoted(line, col, col + (m.end() - m.start())) or excused(rel, line):
                    continue
                fail("%s line %d still says %s%s — %s"
                     % (rel, ln + 1, what,
                        "" if now is None else " (it is %d now)" % now,
                        line.strip()[:90]))
        for phrase in ("עדיין אינם באפליקציה", "עדיין לא באפליקציה",
                       "not in the app yet"):
            for m in re.finditer(re.escape(phrase), txt):
                if not is_live(m.start()):
                    continue
                ln = txt.count("\n", 0, m.start())
                line = lines[ln]
                col = m.start() - (sum(len(x) + 1 for x in lines[:ln]))
                if quoted(line, col, col + (m.end() - m.start())):
                    continue
                fail("%s line %d still says '%s' — the 2025 division is what "
                     "the app draws" % (rel, ln + 1, phrase))

    # ---- 7y. the launcher icon survives Android's mask ---------------------
    # Measured 2026-09-15: icons/icon-512.png spread the district over 87% of
    # its width, and android/…/mipmap-xxhdpi/ic_launcher.png was that very
    # file (same md5). Android masks a launcher icon to 72dp of a 108dp
    # canvas and guarantees only a 66dp circle, so the coast and the eastern
    # tip — the two ends of the one shape the icon is — were cut off on every
    # phone. The padded file already existed (icon-maskable-512.png, 54%) and
    # served the PWA; Android shipped the wrong one. And make_icons.py still
    # coloured by the three belts the app dropped in 1.8, so a re-run would
    # have painted all 18 municipalities the grey fallback.
    from PIL import Image
    SAFE = 66.0 / 108.0
    RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
    def art_reach(path):
        """How far, as a fraction of the width, the art reaches from the centre.
        The ground is read at the top-centre edge (a round icon's corner is
        transparent); a transparent pixel is ground on any layer."""
        im = Image.open(path).convert("RGBA"); w, h = im.size; px = im.load()
        # w/8 in from the top edge: past a round icon's anti-aliased rim, and
        # still outside the disc on a transparent layer. Any translucent pixel
        # is a mask edge, never art — the art in these files is fully opaque.
        bg = px[w // 2, w // 8]
        def ground(a): return a[3] < 255 or all(abs(x - y) <= 28 for x, y in zip(a[:3], bg[:3]))
        cx, cy, worst = w / 2.0, h / 2.0, 0.0
        for y in range(0, h, 2):
            for x in range(0, w, 2):
                if not ground(px[x, y]):
                    r = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / w
                    if r > worst: worst = r
        return 2 * worst   # diameter, comparable to SAFE
    launchers = []
    for d in os.listdir(RES) if os.path.isdir(RES) else []:
        if d.startswith("mipmap-") and d != "mipmap-anydpi-v26":
            for name in ("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"):
                f = os.path.join(RES, d, name)
                if os.path.exists(f):
                    launchers.append(f)
    if not launchers:
        fail("no launcher PNGs under android/…/res/mipmap-*")
    for f in launchers:
        reach = art_reach(f)
        if reach > SAFE + 0.01:
            fail("%s: the map reaches a %.0f%% disc; Android guarantees only %.0f%% (66dp of 108)"
                 % (os.path.relpath(f, ROOT), 100 * reach, 100 * SAFE))
    for d in ("mipmap-mdpi", "mipmap-hdpi", "mipmap-xhdpi", "mipmap-xxhdpi", "mipmap-xxxhdpi"):
        if not os.path.exists(os.path.join(RES, d, "ic_launcher.png")):
            fail("android: no ic_launcher.png for %s — the launcher will scale another density" % d)
    xml = os.path.join(RES, "mipmap-anydpi-v26", "ic_launcher.xml")
    if not os.path.exists(xml):
        fail("android: no adaptive icon (mipmap-anydpi-v26/ic_launcher.xml)")
    else:
        x = io.open(xml, encoding="utf-8").read()
        for layer in ("<background", "<foreground", "<monochrome"):
            if layer not in x:
                fail("android adaptive icon lacks a %s> layer" % layer)
    # the generator colours from the data, so it cannot drift from it again
    gen = io.open(os.path.join(ROOT, "scripts", "make_icons.py"), encoding="utf-8").read()
    if "החגורה" in gen:
        fail("make_icons.py still names the three belts the app dropped in 1.8")
    belts_he = {b["he"] for b in load("municipios.json")["belts"]}
    for m in mun:
        if m.get("belt") not in belts_he:
            fail("municipality %s: belt %r is not one of the regions in municipios.json → belts"
                 % (m.get("he"), m.get("belt")))


    # ---- 7z. a size, a colour, a radius or a shadow is named once, in the tokens
    # Measured 2026-09-15 before 2.0.0: app.css named 25 font sizes, 9 radii and
    # 17 shadows in its rules, 6 colours outside :root, and app.js 64 hex
    # colours in 40 places; the dark theme re-used the light theme's shadows,
    # which on a near-black ground are invisible — so a card, a panel and a
    # menu all sat at the same depth at night.  The tokens are the one place a
    # value is decided, and this is what keeps the next size from being typed
    # straight into a rule again.
    css_src = io.open(os.path.join(ROOT, "app.css"), encoding="utf-8").read()
    js_src = io.open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()
    css_bare = re.sub(r"/\*.*?\*/", "", css_src, flags=re.S)
    tok_blocks = []
    for m in re.finditer(r':root(?:\[data-theme="dark"\]|:not\(\[data-theme="light"\]\))?\s*\{', css_bare):
        tok_blocks.append((m.end(), css_bare.index("}", m.end())))
    if len(tok_blocks) != 3:
        fail("app.css: expected the light block and the two dark blocks of tokens, found %d" % len(tok_blocks))
    css_rules = css_bare
    for a, b in reversed(tok_blocks):
        css_rules = css_rules[:a] + css_rules[b:]
    def css_line(pos):
        return css_rules.count("\n", 0, pos) + 1
    colour_lit = r"#[0-9a-fA-F]{3,8}(?![\w-])(?!\s*[{.\[>~+#])|rgba?\(\s*\d"
    for m in re.finditer(colour_lit, css_rules):
        fail("app.css line ~%d names a colour in a rule (%s) — every colour is a token in :root"
             % (css_line(m.start()), m.group(0)))
    for prop, ok_re, what in (
            ("font-size", r"^var\(--t-[0-9a-z]+\)$", "a --t-* token"),
            ("line-height", r"^(var\(--lh-[0-9a-z]+\)|inherit)$", "a --lh-* token"),
            ("font-weight", r"^(400|700)$", "400 or 700 — two weights, not three"),
            ("border-radius", r"^(var\(--r-[a-z]+\)|50%|0)$", "a --r-* token or 50%"),
            ("letter-spacing", r"^-?[\d.]+em$", "an em value")):
        for m in re.finditer(r"(?<![\w-])%s:([^;}]+)" % prop, css_rules):
            v = m.group(1).strip()
            if not re.match(ok_re, v):
                fail("app.css line ~%d: %s:%s — must be %s" % (css_line(m.start()), prop, v, what))
    for m in re.finditer(r"(?<![\w-])font:([^;}]+)", css_rules):
        if m.group(1).strip() != "inherit":
            fail("app.css line ~%d: font:%s — the shorthand hides a size and a line height; use the tokens"
                 % (css_line(m.start()), m.group(1).strip()))
    ring = r"^(inset\s+)?-?[\d.]+(px)?\s+-?[\d.]+(px)?\s+0(px)?(\s+[\d.]+px)?\s+var\(--[\w-]+\)$"
    for m in re.finditer(r"(?<![\w-])box-shadow:([^;}]+)", css_rules):
        for part in re.split(r",(?![^(]*\))", m.group(1)):
            part = part.strip()
            if part in ("none",) or re.match(r"^var\(--shadow-(raised|overlay)\)$", part):
                continue
            if re.match(ring, part):
                continue   # a hairline ring drawn with a token colour, no blur: an outline, not depth
            fail("app.css line ~%d: box-shadow %r — depth is --shadow-raised or --shadow-overlay, nothing else"
                 % (css_line(m.start()), part))
    # the tokens themselves
    def toks(block):
        return dict(re.findall(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", block))
    light_t = toks(css_bare[tok_blocks[0][0]:tok_blocks[0][1]])
    sizes = [k for k in light_t if k.startswith("--t-")]
    if len(sizes) != 8:
        fail("app.css: %d --t-* sizes; the scale is eight steps" % len(sizes))
    for k in sizes:
        sz, lh = int(light_t[k][:-2]), int(light_t.get("--lh-" + k[4:], "0px")[:-2])
        if lh % 4 or lh < sz * 1.2:
            fail("app.css: %s is %dpx with a line height of %dpx — every line height divides by 4 and is at least 1.2× the size" % (k, sz, lh))
    for k, v in light_t.items():
        if re.match(r"--s\d$", k) and int(v[:-2]) % 4:
            fail("app.css: %s:%s is off the 4-point grid" % (k, v))
    def lum(h):
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
        f = lambda c: c / 12.92 if c <= .03928 else ((c + .055) / 1.055) ** 2.4
        return .2126 * f(r) + .7152 * f(g) + .0722 * f(b)
    for a, b in tok_blocks[1:]:
        dark_t = toks(css_bare[a:b])
        for k in ("--shadow-raised", "--shadow-overlay"):
            if dark_t.get(k) != "none":
                fail("app.css dark theme: %s is %r — at night depth is colour, not shadow" % (k, dark_t.get(k)))
        if not all(k in dark_t for k in ("--bg", "--card", "--overlay")):
            fail("app.css dark theme: the three surfaces --bg, --card, --overlay must all be redefined")
        elif not (lum(dark_t["--bg"]) < lum(dark_t["--card"]) < lum(dark_t["--overlay"])):
            fail("app.css dark theme: the surfaces must step up base < raised < overlay: %s %s %s"
                 % (dark_t["--bg"], dark_t["--card"], dark_t["--overlay"]))
    if "--overlay" not in light_t:
        fail("app.css: no --overlay surface in the light theme")
    # app.js: the map's colours live in one block
    pa, pb = js_src.find("/* PALETTE-START"), js_src.find("/* PALETTE-END */")
    if pa < 0 or pb < pa:
        fail("app.js: no PALETTE-START … PALETTE-END block")
    else:
        for m in re.finditer(r"#[0-9a-fA-F]{6}(?![\w-])|rgba?\(\s*\d", js_src):
            if not (pa <= m.start() <= pb):
                fail("app.js line %d names a colour (%s) outside the palette block"
                     % (js_src.count("\n", 0, m.start()) + 1, m.group(0)))


    # ---- 7aa. TIPAU: one class per parish, and none for a parish INE never saw
    # Added 2026-09-15 with the field.  The planning documents assumed TIPAU
    # 2014 was the version in force; INE's meta-information system lists TIPAU
    # 2025 (V05635), in force since 14-04-2025 and standing on CAOP 2020.  So
    # 218 parishes carry a class and the 57 the 2025 reform created carry
    # none — and the trap this guards is the obvious shortcut: giving a new
    # parish the class of the union it came out of (rule 2, no unmarked
    # inference).  It also pins the raw file's shape, so a re-fetch that comes
    # back short or on another geography cannot pass as the same table.
    tipau_raw = os.path.join(ROOT, "data", "raw", "ine", "tipau2025_v05635.csv")
    if not os.path.exists(tipau_raw):
        fail("data/raw/ine/tipau2025_v05635.csv is missing — run scripts/fetch_tipau.py")
    else:
        rows = io.open(tipau_raw, encoding="utf-8").read().splitlines()
        if "V05635" not in "\n".join(rows[:8]):
            fail("tipau2025_v05635.csv is not the V05635 export (TIPAU 2025)")
        n_d13 = sum(1 for r in rows if r.startswith("3,13"))
        if n_d13 != 243:
            fail("tipau2025_v05635.csv holds %d Porto-district parishes; CAOP 2020 had 243" % n_d13)
    with_class = [f for f in fre if "tipau" in f]
    for f in with_class:
        if f["tipau"] not in ("APU", "AMU", "APR"):
            fail("parish %s: tipau %r is not APU/AMU/APR" % (f.get("pt"), f["tipau"]))
        if f.get("was_part_of"):
            fail("parish %s was created in 2025 and yet carries a TIPAU class — INE never classified it; "
                 "that is the dissolved union's class, not this parish's" % f.get("pt"))
    if len(with_class) != n_untouched:
        fail("TIPAU: %d parishes carry a class; every one of the %d parishes the 2025 reform left alone should, and no other"
             % (len(with_class), n_untouched))
    tip = sources["fields"].get("freguesia.tipau")
    if not tip:
        fail("sources.json has no record for freguesia.tipau")
    else:
        want = "%d/%d" % (len(with_class), len(fre))
        if tip.get("coverage") != want:
            fail("freguesia.tipau coverage is %r; the data says %s" % (tip.get("coverage"), want))
        if tip.get("reference_year") != 2025 or "2025" not in tip.get("source", ""):
            fail("freguesia.tipau must name TIPAU 2025 — 2014 is the superseded version")
    if re.search(r"TIPAU 2014", io.open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()):
        fail("app.js names TIPAU 2014; the version in force is 2025")


    # ---- 7ab. every host the app can reach is on the list it shows the reader
    # The app said "works without a network" while the street background was
    # fetched from OpenStreetMap and the constraint layers from two CDNs.  The
    # honest statement is "offline, with these online features", and the
    # ONLINE list in app.js is that statement, printed on the about page.
    # This reads every URL out of app.js, sw.js, index.html and the layers
    # manifest and requires its host on that list — so a fetch added anywhere
    # has to be declared where the reader can see it.
    online_src = io.open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()
    m_on = re.search(r"const ONLINE = \(\) => \[(.*?)\n\];", online_src, re.S)
    declared = set(re.findall(r"host: '([^']+)'", m_on.group(1))) if m_on else set()
    if not declared:
        fail("app.js: no ONLINE list (const ONLINE = () => [...])")
    reached = {}
    for name in ("app.js", "sw.js", "index.html"):
        txt = io.open(os.path.join(ROOT, name), encoding="utf-8").read()
        for u in re.findall(r"https?://([A-Za-z0-9.-]+\.[a-z]{2,})", txt):
            reached.setdefault(u, set()).add(name)
    lm = json.load(io.open(os.path.join(ROOT, "data", "layers_manifest.json"), encoding="utf-8"))
    for k in ("base", "fallback"):
        h = re.match(r"https?://([A-Za-z0-9.-]+)", lm.get(k, ""))
        if h:
            reached.setdefault(h.group(1), set()).add("layers_manifest.json")
    reached.pop("www.w3.org", None)          # an XML namespace, not a request
    for host, where in sorted(reached.items()):
        if host not in declared:
            fail("%s reaches %s and the ONLINE list on the about page does not name it" % ("/".join(sorted(where)), host))
    for host in sorted(declared - set(reached)):
        fail("the ONLINE list names %s and nothing in the app reaches it" % host)
    if re.search(r"עובדת גם בלי רשת", online_src):
        fail("app.js still promises plain offline; say which features need a network")

    # ---- 7ac. a note beside a value is one line; the reasons live in the record
    # Measured 2026-09-15: 41 class="note" strings, median 119 characters, the
    # longest 282, nineteen over 120 — half the notes were paragraphs, not a
    # line.  The three tiers (UX-2.0.0 §5, principle 3): the value and its year
    # always; one quiet line when a caveat changes how to read the number; and
    # everything else one tap away in the source record.  A caveat that needs
    # two lines belongs in sources.json, so this measures every note literal
    # in app.js and fails on one that runs past 120 characters of text.
    NOTE_MAX = 120
    # the translation table at the foot of app.js repeats every literal as a
    # key — measure the code above it, where the notes are written
    code_part = online_src[:online_src.index("Object.assign(EN, {")]
    for m in re.finditer(r'<p class="note[^"]*"[^>]*>(.*?)</p>', code_part, re.S):
        raw = m.group(1)
        if "${" in raw and not re.search(r"[֐-׿]", raw):
            continue                          # composed at runtime from data, measured where the data is
        txt = re.sub(r"\$\{[^}]*\}", "", raw)   # a data value is not the note's own text
        txt = re.sub(r"<[^>]+>", "", txt)
        txt = re.sub(r"'\s*\)\s*\+\s*t\(\s*'", "", txt)   # t('…') + t('…')
        txt = re.sub(r"\s+", " ", txt).strip()
        if len(txt) > NOTE_MAX:
            fail("app.js line %d: a note of %d characters — over %d it is a paragraph, and belongs in the source record: %s…"
                 % (code_part.count("\n", 0, m.start()) + 1, len(txt), NOTE_MAX, txt[:60]))


    # ---- 7ad. statistics and listings never on one screen — structurally ---
    # The user's rule, and it is enforced on what a screen can reach rather
    # than on wording: an earlier draft of the property card separated the two
    # with a background, a heading, a click and a date, argued each one, and
    # still put INE's median beside an asking price.  So: everything that
    # touches a listing sits between LISTINGS-START and LISTINGS-END in app.js;
    # inside, nothing reads sources.json, no chip opens a source record and no
    # official field is named; outside, nothing reads a listing except the
    # handful of dispatch calls named here.  Also: no listing ever enters
    # data/processed, the fetch scripts never enter the APK, and no key-shaped
    # literal enters the source.
    lst_a, lst_b = appjs_txt.find("/* ======================================================= LISTINGS-START"), appjs_txt.find("LISTINGS-END")
    if lst_a < 0 or lst_b < lst_a:
        fail("app.js: no LISTINGS-START … LISTINGS-END block")
    else:
        inside = appjs_txt[lst_a:lst_b]
        outside = appjs_txt[:lst_a] + appjs_txt[lst_b:]
        outside = outside[:outside.index("Object.assign(EN, {")]      # the translation table names both
        for pat, what in ((r"\bstat\(|\bstatText\(|\bsrcLine\(|data-src=|D\.sources|showSource\(", "a source-record chip or sources.json"),
                          (r"\.pop2021\b|\.price_eur_m2\b|\.rent_eur_m2\b|\.tipau\b|\.cons_pct\b|\.crus\b|\.median_age\b|\.density\b", "an official field")):
            for m in re.finditer(pat, inside):
                fail("app.js listings block line %d reaches %s (%s) — a listing screen shows no statistics"
                     % (appjs_txt.count("\n", 0, lst_a + m.start()) + 1, what, m.group(0)))
        allowed = {"renderListings(", "drawListings(", "lstAfterRender(", "toggleLst(", "lstOff(", "importListings(",
                   "lstClick(", "lstInput(", "lstLoad(", "lstSavedHtml("}
        for m in re.finditer(r"\bD\.lst\b|\blst[A-Z]\w*\(|\bLST_\w+", outside):
            if m.group(0) in allowed:
                continue
            fail("app.js line %d outside the listings block reads a listing (%s) — a statistics screen shows no listings"
                 % (outside.count("\n", 0, m.start()) + 1, m.group(0)))
    for path_ in sorted(glob.glob(os.path.join(ROOT, "data", "processed", "*.json"))):
        txt = io.open(path_, encoding="utf-8").read()
        if "propertyCode" in txt or '"kind": "listings"' in txt or "idealista.pt/imovel" in txt:
            fail("%s carries listing data — listings live in the user's own file, never in data/processed" % os.path.basename(path_))
    gradle_txt = io.open(os.path.join(ROOT, "android", "app", "build.gradle"), encoding="utf-8").read()
    if re.search(r"include\s+.*'scripts", gradle_txt):
        fail("build.gradle copies scripts/ into the APK — the fetch scripts and their fixtures never ship")
    bundle_txt = io.open(os.path.join(ROOT, "scripts", "bundle_standalone.py"), encoding="utf-8").read()
    if "fixtures" in bundle_txt:
        fail("bundle_standalone.py inlines a fixture")
    for name in ("app.js", "sw.js", "scripts/fetch_listings.py"):
        txt = io.open(os.path.join(ROOT, name), encoding="utf-8").read()
        for m in re.finditer(r"(?i)(apikey|secret|client_id|client_secret)\s*[:=]\s*['\"]([A-Za-z0-9+/=_-]{16,})['\"]", txt):
            fail("%s line %d: a key-shaped literal (%s=…) — the key is typed by the user and never sits in the source"
                 % (name, txt.count("\n", 0, m.start()) + 1, m.group(1)))


    # ---- 7ag. elevation and slope: measured here, so measured consistently --
    # These are the project's first fields that no body published — they were
    # computed by cutting a raster to a boundary.  A derived field can be wrong
    # in ways a transcribed one cannot: a key that does not match silently
    # attaches one unit's terrain to another, and the page still looks right.
    # So the invariants are checked against the boundaries themselves.
    dem_path = os.path.join(ROOT, "data", "raw", "elevation_dem.json")
    have_dem = os.path.exists(dem_path)
    mun_ele = [m for m in mun if "ele" in m]
    fre_ele = [f for f in fre if "ele" in f]
    if not have_dem:
        # The tiles are 81 MB and re-fetchable, so a checkout without them is a
        # legitimate state.  What is NOT legitimate is a build that half has it.
        if mun_ele or fre_ele:
            fail("elevation_dem.json is absent but %d units carry an elevation — "
                 "stale processed data, rebuild" % (len(mun_ele) + len(fre_ele)))
    else:
        if len(mun_ele) != len(mun) or len(fre_ele) != len(fre):
            fail("elevation covers %d/%d municipalities and %d/%d parishes — "
                 "a partial cover means a key that did not match, not a gap in the raster"
                 % (len(mun_ele), len(mun), len(fre_ele), len(fre)))
        for lab, rows in (("municipality", mun_ele), ("parish", fre_ele)):
            for r in rows:
                e = r["ele"]
                for k in ("min", "mean", "max", "slope"):
                    if e.get(k) is None:
                        fail("%s %s: elevation has no %s" % (lab, r["pt"], k))
                        break
                else:
                    if not (e["min"] <= e["mean"] <= e["max"]):
                        fail("%s %s: elevation %s/%s/%s is not min <= mean <= max"
                             % (lab, r["pt"], e["min"], e["mean"], e["max"]))
                    # Marão, the highest ground in the district, is 1415 m; a
                    # value far past it means the wrong tile or the wrong units.
                    if not (-10 <= e["min"] and e["max"] <= 1500):
                        fail("%s %s: elevation %s..%s is outside the district's range"
                             % (lab, r["pt"], e["min"], e["max"]))
                    if not (0 <= e["slope"] <= 45):
                        fail("%s %s: mean slope %s is not a hillside"
                             % (lab, r["pt"], e["slope"]))
        # The containment test is the one that catches a mis-key: a parish is
        # inside its municipality, so its ground cannot be higher or lower.
        mun_by_num = {m["num"]: m for m in mun}
        for f in fre_ele:
            m = mun_by_num.get(f["mun_num"])
            if not m or "ele" not in m:
                continue
            e, me = f["ele"], m["ele"]
            if e["min"] < me["min"] - 0.05 or e["max"] > me["max"] + 0.05:
                fail("parish %s (%s): %s..%s m lies outside its municipality's %s..%s m — "
                     "the elevation is keyed to the wrong unit"
                     % (f["pt"], m["pt"], e["min"], e["max"], me["min"], me["max"]))
    # Whatever the tiles' state, the records and the attribution are not optional.
    for key in ("municipio.ele", "municipio.slope", "freguesia.ele", "freguesia.slope"):
        rec = sources["fields"].get(key)
        if not rec:
            fail("data/sources.json has no entry for %s" % key)
            continue
        if rec.get("confidence") != "approx":
            fail("%s: a value this project computed is approx, never reported or verified" % key)
        if "method_he" not in rec:
            fail("%s: a derived value has to say how it was derived (method_he)" % key)
        if "Copernicus" not in rec.get("source", ""):
            fail("%s: the source line does not name Copernicus" % key)
    # Licence article 6(b): a user who ADAPTS the data owes this notice, and a
    # per-unit statistic is an adaptation.  Same rule as ODbL's attribution,
    # and it is checked the same way — the notice reaches the terms page.
    notices = " ".join(sources["license_notices"])
    for frag in ("Copernicus WorldDEM-30", "DLR e.V.", "Airbus Defence and Space",
                 "European Union and ESA"):
        if frag not in notices:
            fail("data/sources.json license_notices is missing %r — the Copernicus DEM "
                 "licence requires the full notice wherever the derived data is shown" % frag)

    # ---- 7ah. the read-path measurement says what it measured --------------
    # Added with move ח׳ of INFORMATION-PLAN.md, 2026-09-17.  Until then the
    # app had never been measured: the bundle is 3MB and every sentence about
    # "fast enough" was an opinion.  scripts/measure_readpath.js writes one
    # file per release under data/readpath/, and this reads those files the way
    # chapter 2 of Designing Data-Intensive Applications says a latency
    # measurement has to be read:
    #
    #   1. the HISTOGRAM is the measurement, and the percentiles are derived
    #      from it — so they are recomputed here and must match to the digit.
    #      A hand-edited percentile is the whole point of this check.
    #   2. every file shares one set of bucket edges, because pooling two
    #      releases means ADDING their counts, and counts over different
    #      buckets cannot be added.
    #   3. a percentile needs at least 1/(1-p) samples to exist.  p99 out of
    #      40 runs is the largest of 40 numbers wearing a name it did not
    #      earn, so it is null — rule 2 of the accuracy contract, applied to
    #      our own numbers.
    #   4. no mean, anywhere.  "The mean is not a good metric... percentiles
    #      are better" is the reason this file measures at all, and a mean
    #      added later would quietly undo it.
    rp_dir = os.path.join(ROOT, "data", "readpath")
    rp_files = sorted(glob.glob(os.path.join(rp_dir, "*.json")))
    version_now = io.open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip()
    OPS = ("first_paint", "level_switch", "search")
    edges_seen = {}

    def nearest_rank(counts, edges, p):
        """The percentile the histogram supports: the upper edge of the bucket
        the rank falls in, or None when there are too few samples to name it or
        the rank lands in the overflow slot, which has no upper edge."""
        n = sum(counts)
        import math
        if n < math.ceil(1.0 / (1.0 - p)):
            return None
        rank, seen = math.ceil(p * n), 0
        for i, c in enumerate(counts):
            seen += c
            if seen >= rank:
                return edges[i] if i < len(edges) else None
        return None

    if not rp_files:
        warn("data/readpath/ holds no measurement at all — the read path is "
             "unmeasured again, which is the state move ח׳ existed to end")
    for path_ in rp_files:
        rel = os.path.relpath(path_, ROOT).replace(os.sep, "/")
        base = os.path.basename(path_)[:-len(".json")]
        try:
            m = json.load(io.open(path_, encoding="utf-8"))
        except Exception as exc:
            fail("%s is not readable JSON: %s" % (rel, exc))
            continue
        if not re.match(r"^\d+\.\d+\.\d+$", base):
            fail("%s: a measurement is named after the release it measured "
                 "(2.0.8.json), so the file name is the version" % rel)
        if m.get("version") != base:
            fail("%s declares version %r inside — a measurement filed under the "
                 "wrong release is worse than none" % (rel, m.get("version")))
        if not re.match(r"^20\d\d-\d\d-\d\d$", str(m.get("measured_at", ""))):
            fail("%s: measured_at has to be a YYYY-MM-DD date" % rel)
        if not str(m.get("device", "")).strip():
            fail("%s: a latency without the machine it was measured on is not a "
                 "measurement" % rel)
        if m.get("device_class") not in ("headless-container", "phone"):
            fail("%s: device_class is 'headless-container' or 'phone'. The app is "
                 "for a mid-range Android and a container is faster than one; "
                 "the file has to say which it was" % rel)
        if m.get("phone_measured") is not (m.get("device_class") == "phone"):
            fail("%s: phone_measured must agree with device_class" % rel)
        flat = json.dumps(m)
        for word in ('"mean"', '"avg"', '"average"'):
            if word in flat:
                fail("%s carries %s. Chapter 2: the mean hides the tail this "
                     "whole file exists to see. Percentiles, or nothing" % (rel, word))
        ops = m.get("operations") or {}
        for op in OPS:
            if op not in ops:
                fail("%s does not measure %s — the three operations are the read "
                     "path: opening, moving a level, searching" % (rel, op))
                continue
            o = ops[op]
            h = o.get("histogram") or {}
            edges_, counts = h.get("edges"), h.get("counts")
            if not isinstance(edges_, list) or not isinstance(counts, list):
                fail("%s %s: the histogram IS the measurement; it cannot be absent"
                     % (rel, op))
                continue
            if any(edges_[i] >= edges_[i + 1] for i in range(len(edges_) - 1)):
                fail("%s %s: histogram edges have to ascend" % (rel, op))
            if len(counts) != len(edges_) + 1:
                fail("%s %s: %d buckets for %d edges — the last slot is the "
                     "overflow, so there is exactly one more count than edges"
                     % (rel, op, len(counts), len(edges_)))
                continue
            if sum(counts) != o.get("n"):
                fail("%s %s: n is %r and the histogram holds %d samples"
                     % (rel, op, o.get("n"), sum(counts)))
            for key, p in (("p50_ms", 0.50), ("p95_ms", 0.95), ("p99_ms", 0.99)):
                want = nearest_rank(counts, edges_, p)
                if o.get(key) != want:
                    fail("%s %s: %s says %r, and the histogram says %r. The "
                         "percentile is derived, never typed" % (rel, op, key,
                                                                o.get(key), want))
            edges_seen.setdefault(tuple(edges_), []).append("%s/%s" % (base, op))
    if len(edges_seen) > 1:
        fail("data/readpath/ holds %d different sets of bucket edges (%s). Two "
             "releases are compared by ADDING their histograms, and counts over "
             "different buckets cannot be added"
             % (len(edges_seen), "; ".join(sorted(v[0] for v in edges_seen.values()))))
    if rp_files and not os.path.exists(os.path.join(rp_dir, version_now + ".json")):
        warn("no read-path measurement for %s. Run scripts/measure_readpath.js "
             "before the release, or the next move's cost is unknowable" % version_now)

    # ---- 7ai. the build stamps itself, and hashes what it produced ---------
    # Added with move ו׳ of INFORMATION-PLAN.md, 2026-09-17, and it closed a
    # bug that had already shipped.  Two things came out of that move:
    #
    #   1. `generated` and `app_version` no longer sit INSIDE five data files.
    #      They are properties of the build, not of the district, and stamped
    #      into the data they made every release look like a data change — so
    #      a diff of what a release did to the data could not be read.  They
    #      live in data/processed/manifest.json now.
    #   2. The manifest carries a sha256 per file, which finally ENFORCES the
    #      rule this project has stated since the first commit: data/processed
    #      is generated and must never be hand-edited.  "Trust, but verify" —
    #      chapter 13 has S3 and HDFS read their own files back and compare;
    #      this compares the bytes on disk with what the build recorded.
    #
    # The shipped bug: until 2.0.8 the release gate bumped VERSION LAST, after
    # the build, so data/processed always carried the PREVIOUS version — and
    # since the app's info page reads it, the 2.0.7 APK told the reader it was
    # 2.0.6.  build_diff.py found it by comparing the release with its
    # predecessor, which is exactly what it exists for.  The app_version line
    # below makes it impossible to ship again: VERSION rises FIRST, then the
    # build, or this check fails.
    man_path = os.path.join(PROC, "manifest.json")
    version_file = io.open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip()
    if not os.path.exists(man_path):
        fail("data/processed/manifest.json is missing — run scripts/build.py. "
             "Without it the app has no build date and no version to show")
    else:
        man = json.load(io.open(man_path, encoding="utf-8"))
        if not re.match(r"^20\d\d-\d\d-\d\d$", str(man.get("generated", ""))):
            fail("manifest.json: generated has to be a YYYY-MM-DD date")
        if man.get("app_version") != version_file:
            fail("manifest.json says app_version %r and VERSION says %r. The app's "
                 "info page shows the manifest's value, so this is what the reader "
                 "would be told. Raise VERSION *before* running build.py"
                 % (man.get("app_version"), version_file))
        on_disk = {n for n in os.listdir(PROC)
                   if os.path.isfile(os.path.join(PROC, n)) and n != "manifest.json"
                   and not n.startswith(".")}
        recorded = set((man.get("files") or {}).keys())
        for n in sorted(on_disk - recorded):
            fail("data/processed/%s is not in manifest.json. Every file in the "
                 "output is part of the output — run scripts/build.py, which "
                 "writes the manifest last" % n)
        for n in sorted(recorded - on_disk):
            fail("manifest.json records data/processed/%s, which is not there" % n)
        for n in sorted(on_disk & recorded):
            rec = man["files"][n]
            path_ = os.path.join(PROC, n)
            got_bytes = os.path.getsize(path_)
            h = hashlib.sha256()
            with open(path_, "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 16), b""):
                    h.update(chunk)
            if rec.get("bytes") != got_bytes or rec.get("sha256") != h.hexdigest():
                fail("data/processed/%s does not match the manifest (%s bytes "
                     "recorded, %s on disk). Either it was edited by hand — which "
                     "the next build would silently undo — or a script rewrote it "
                     "without rebuilding" % (n, rec.get("bytes"), got_bytes))
    # The stamp must not come back into the data.  A future edit that re-adds it
    # would quietly restore the noisy diff this move removed.
    for n in ("indicators.json", "municipios.json", "freguesias.json",
              "porto_city.json", "zones.json"):
        d = load(n)
        for k in ("generated", "app_version"):
            if k in d:
                fail("data/processed/%s carries %r again. The build's own stamp "
                     "belongs in manifest.json; inside the data it makes every "
                     "release look like a data change" % (n, k))

    # The generated change record, one per release: §7x declares it a record by
    # pattern, and this is what makes that safe — it has to really be generated.
    for rel in sorted(os.path.basename(x) for x in
                      glob.glob(os.path.join(ROOT, "docs", "CHANGES-*.md"))):
        txt = io.open(os.path.join(ROOT, "docs", rel), encoding="utf-8").read()
        ver = rel[len("CHANGES-"):-len(".md")]
        if "scripts/build_diff.py" not in txt:
            fail("docs/%s does not say it was generated by scripts/build_diff.py. "
                 "A change record that was typed is a changelog, and a changelog "
                 "says what its author remembered" % rel)
        if ver not in txt.splitlines()[0]:
            fail("docs/%s does not name %s in its heading — a record filed under "
                 "the wrong release" % (rel, ver))

    # ---- 7aj. a nested comparison field names the record it came from ------
    # Move ג׳, 2026-09-17.  The comparison screen read FLAT keys only, so
    # `ele` and `slope` — on every unit since 2.0.3 — could not be compared at
    # all.  Dotted keys work now, and they bring a failure mode that a flat key
    # does not have: the source record is NOT derivable from the path.
    # `ele.min`, `ele.mean` and `ele.max` answer to the one `ele` record, while
    # `ele.slope` lives inside the same object and has a record of its own.
    # A dotted key with no entry in CMP_NESTED would silently look for a record
    # called `municipio.ele.slope`, find nothing, and cmpFields() would DROP the
    # field — a feature that disappears in silence, which is the worst kind.
    # So: every dotted key is mapped, every mapping is used, and every mapped
    # record exists at both levels.
    cmp_block = re.search(r"const CMP_ALL = \[(.*?)\n\];", appjs_txt, re.S)
    if not cmp_block:
        fail("7aj cannot find CMP_ALL in app.js — the comparison screen's shape "
             "changed and this check is looking at the wrong thing")
    else:
        # Commented-out rows do not count: the first cut of this check read the
        # block as text, so a field that had been commented out still looked
        # offered — and "the nested fields were taken away again" passed.
        live_cmp = "\n".join(l for l in cmp_block.group(1).splitlines()
                             if not l.lstrip().startswith(("//", "/*", "*")))
        cmp_keys = re.findall(r"k: '([^']+)'", live_cmp)
        nested_block = re.search(r"const CMP_NESTED = \{(.*?)\};", appjs_txt, re.S)
        mapping = dict(re.findall(r"'([^']+)':\s*'([^']+)'",
                                  nested_block.group(1) if nested_block else ""))
        dotted = [k for k in cmp_keys if "." in k]
        if not dotted:
            fail("7aj: no nested comparison field is offered any more. ele and "
                 "slope were added in 2.0.8 because they were unreachable; "
                 "losing them again is a regression, not a simplification")
        for k in dotted:
            if k not in mapping:
                fail("app.js offers the comparison field %r and CMP_NESTED does "
                     "not say which source record it answers to. cmpFields() "
                     "would drop it in silence" % k)
                continue
            for lvl in ("municipio", "freguesia"):
                key = "%s.%s" % (lvl, mapping[k])
                if key not in sources["fields"]:
                    fail("comparison field %r maps to %r, which is not in "
                         "data/sources.json" % (k, key))
        for k in mapping:
            if k not in cmp_keys:
                fail("checks.py §7aj: CMP_NESTED maps %r and no comparison field "
                     "uses it — a mapping nobody reads is a mapping nobody "
                     "maintains" % k)

    # ---- 7ak. a coverage string is counted, never remembered ---------------
    # Found 2026-09-17 while implementing move א׳, and it was thirteen records
    # deep: `freguesia.price_eur_m2` told the reader "70/243", every other
    # parish record said "243/243", and the app has drawn 275 parishes since
    # 1.34.0.  The true numbers are 55/275 for the sale price, 218/275 for the
    # descriptions, and 0/275 for the population change — INE publishes that
    # one per parish on the 2013 division and the join is by DICOFRE alone, so
    # not one 2025 parish receives it.
    #
    # Why nothing caught it: §7x binds the COUNTS in prose, and a fraction was
    # deliberately exempted there — "70/243" was a true sentence about the 2013
    # division, and a check that cried wolf on it would have been switched off.
    # The right rule is not "243 may not appear" but "the fraction must equal
    # what the data holds", and that is arithmetic, not pattern matching.
    #
    # Every record whose coverage reads N/M is counted here: N is the units
    # that actually carry a value, M is the units at that level.  A field the
    # data stores under another name is listed in FIELD_AT; a record whose N/M
    # counts something else entirely is exempted BY NAME, with its reason.
    FIELD_AT = {           # record key suffix -> where the value really lives
        "name_pt": "pt", "number": "num", "split2025": "was_part_of",
        "ele": ("ele", "mean"), "slope": ("ele", "slope"),
    }
    COVERAGE_NOT_UNITS = {
        # "25/25" is the dissolved UNIONS whose population was split, not units
        # carrying a value — the 25 became 57 parishes.  Its own validation_he
        # says so.
        "freguesia.split2025": "counts the 25 dissolved unions, not units",
    }

    def value_at(obj, field):
        where = FIELD_AT.get(field, field)
        if isinstance(where, tuple):
            return (obj.get(where[0]) or {}).get(where[1])
        if where in obj:
            return obj[where]
        for holder in ("housing", "cons"):
            if where in (obj.get(holder) or {}):
                return obj[holder][where]
        return None

    LEVEL_ITEMS = {"municipio": mun, "freguesia": fre}
    counted = 0
    for key, rec in sorted(sources["fields"].items()):
        cov = str(rec.get("coverage", ""))
        if not re.match(r"^\d+/\d+$", cov) or key in COVERAGE_NOT_UNITS:
            continue
        lvl, _, field = key.partition(".")
        items = LEVEL_ITEMS.get(lvl)
        if items is None:
            continue
        have = sum(1 for o in items
                   if value_at(o, field) not in (None, "", [], {}))
        want = "%d/%d" % (have, len(items))
        counted += 1
        if cov != want:
            fail("data/sources.json %s says coverage %s and the data holds %s. "
                 "The reader sees this number in the source record; a coverage "
                 "string is counted, never remembered" % (key, cov, want))
    print("coverage strings counted %d" % counted)
    for key, why in COVERAGE_NOT_UNITS.items():
        if key not in sources["fields"]:
            fail("checks.py §7ak exempts %s (%s) and there is no such record" % (key, why))

    # ---- 7al. the quarterly series: counted from the source, not trusted ---
    # Move א׳, 2.0.9.  The plan set the test itself: "the number of points in
    # the payload equals exactly the number of rows the filter keeps from the
    # CSV — a check in checks.py, not an eyeball".  So this re-reads the two
    # raw CSVs and counts, which is the only way to know that nothing was
    # dropped on the way and nothing was invented.
    #
    # The second half is the one that matters more.  The app now has TWO paths
    # to the same number: data/processed carries the latest quarter as a field
    # on the unit, and series.json carries every quarter including that one.
    # Two paths to one number is how a screen ends up contradicting itself, so
    # they are compared here, unit by unit, and must agree exactly.
    ser_path = os.path.join(PROC, "series.json")
    if not os.path.exists(ser_path):
        warn("data/processed/series.json is missing — the quarterly series are "
             "not in this build. The unit cards will say so; run build.py with "
             "data/raw/ine/ present")
    else:
        ser = json.load(io.open(ser_path, encoding="utf-8"))
        periods = ser.get("periods") or []
        if not periods:
            fail("series.json has no periods")
        for q in periods:
            if not re.match(r"^\d{4}Q[1-4]$", str(q)):
                fail("series.json: %r is not a quarter" % q)
        if periods != sorted(periods):
            fail("series.json: the periods are not in order — an aligned array "
                 "whose axis is unsorted draws the line backwards in places")
        if len(set(periods)) != len(periods):
            fail("series.json: a period appears twice")
        SER_KEYS = ("sale", "sale_new", "sale_used", "rent")
        units = ser.get("units") or {}
        # Whether this app can NAME the unit, which is the only reason the file
        # carries a name at all.  Not "does its code start with 13": INE
        # publishes at parish level on the 2013 division, so a union this
        # district dissolved in 2025 has a 13xxxx code and no unit here to be
        # named by, and it needs its Portuguese name like any other stranger.
        named_here = ({"m" + m["dicofre"] for m in mun if m.get("dicofre")} |
                      {"f" + f["dicofre"] for f in fre if f.get("dicofre")})
        n_points = 0
        for key, u in sorted(units.items()):
            # Letters are legitimate here: eight parishes of Barcelos carry
            # codes like 0302FG, which is INE's own code for a union created in
            # 2013 after the numeric space under that municipality ran out.  The
            # first cut of this check demanded digits and failed all eight.
            if not re.match(r"^[mf][0-9A-Z]+$", key):
                fail("series.json: %r is not a unit key" % key)
                continue
            lv, code = key[0], key[1:]
            if u.get("lv") != lv:
                fail("series.json %s: lv is %r" % (key, u.get("lv")))
            if len(code) != (4 if lv == "m" else 6):
                fail("series.json %s: a municipality code is four characters and "
                     "a parish code six" % key)
            # 2.0.9 packed all of Portugal here to feed a national comparison
            # level; 2.1.0 withdrew that level, so the file holds only units the
            # app draws.  Both halves of the rule matter: a foreign unit has no
            # screen to appear on, and a name here would be a second copy of one
            # the app already holds.
            if key not in named_here:
                fail("series.json %s is not a unit this atlas draws. Since 2.1.0 "
                     "the file is the district's own; INE publishes for the whole "
                     "country and the rest has no screen to appear on" % key)
            if "pt" in u or "he" in u:
                fail("series.json %s carries a name. Every unit here is one the "
                     "app already names, and a second copy is a second thing to "
                     "drift" % key)
            have_any = False
            for f in SER_KEYS:
                if f not in u:
                    continue
                arr = u[f]
                if not isinstance(arr, list) or len(arr) != len(periods):
                    fail("series.json %s.%s: %d values for %d periods — the array "
                         "is aligned to the periods, and a hole is a null in it"
                         % (key, f, len(arr) if isinstance(arr, list) else -1, len(periods)))
                    continue
                for v in arr:
                    if v is None:
                        continue
                    if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                        fail("series.json %s.%s carries %r" % (key, f, v))
                    else:
                        n_points += 1
                        have_any = True
            if not have_any:
                fail("series.json %s has no value at all — a unit with nothing "
                     "published does not belong in the file" % key)
        if ser.get("meta", {}).get("values") != n_points:
            fail("series.json meta.values is %r and the arrays hold %d"
                 % (ser.get("meta", {}).get("values"), n_points))
        if ser.get("meta", {}).get("units") != len(units):
            fail("series.json meta.units is %r and there are %d"
                 % (ser.get("meta", {}).get("units"), len(units)))

        # ---- counted from the raw CSVs, which is the test the plan asked for
        import csv as _csv
        FIELD_OF = {"Total": "sale", "Novos": "sale_new", "Existentes": "sale_used"}
        raw_n, raw_units = 0, set()
        latest = {}
        # Counted over the SAME filter the build uses — the district's own units.
        # The first cut of this counted the whole country and reported a 43,839
        # value difference as a bug, which it was not: it was the scope.
        for name, is_rent in (("ine_precos_venda.csv", False), ("ine_rendas.csv", True)):
            path_ = os.path.join(ROOT, "data", "raw", "ine", name)
            if not os.path.exists(path_):
                warn("%s is not in this checkout — §7al counted what it could" % name)
                raw_n = None
                break
            with io.open(path_, encoding="utf-8") as fh:
                for r in _csv.DictReader(fh):
                    if r["geo_level"] not in ("municipio", "freguesia"):
                        continue
                    if r["flag"] == "-" or r["value_eur_m2"] == "":
                        continue
                    k = ("m" if r["geo_level"] == "municipio" else "f") + r["dicofre"]
                    if k not in named_here:
                        continue
                    raw_n += 1
                    raw_units.add(k)
                    f = "rent" if is_rent else FIELD_OF[r["dwelling_type"]]
                    if r["period"] == periods[-1]:
                        latest[(k, f)] = float(r["value_eur_m2"])
        if raw_n is not None:
            if raw_n != n_points:
                fail("the CSVs hold %d published values and series.json holds %d. "
                     "Every value INE published is in the file or the difference is "
                     "a bug, not a decision" % (raw_n, n_points))
            if raw_units != set(units):
                only_raw = sorted(raw_units - set(units))[:3]
                only_ser = sorted(set(units) - raw_units)[:3]
                fail("the units in the CSVs and in series.json differ: %d only in "
                     "the CSVs (%s), %d only in the file (%s)"
                     % (len(raw_units - set(units)), only_raw,
                        len(set(units) - raw_units), only_ser))

        # ---- the two paths to the latest quarter must not disagree
        FIELD_TO_SER = {"price_eur_m2": "sale", "price_new_eur_m2": "sale_new",
                        "price_used_eur_m2": "sale_used", "rent_eur_m2": "rent"}
        disagreed = 0
        for lvl, items in (("m", mun), ("f", fre)):
            for o in items:
                code = o.get("dicofre")
                if not code:
                    continue
                u = units.get(lvl + code) or {}
                for field, sk in FIELD_TO_SER.items():
                    on_unit = o.get(field)
                    arr = u.get(sk)
                    in_series = arr[-1] if arr else None
                    if on_unit is None and in_series is None:
                        continue
                    if on_unit is None or in_series is None or abs(on_unit - in_series) > 1e-9:
                        disagreed += 1
                        if disagreed <= 3:
                            fail("%s %s: data/processed says %r for %s and the "
                                 "series says %r. The app reads the series now, so "
                                 "the two must be the same number"
                                 % (lvl + code, field, on_unit, periods[-1], in_series))
        if disagreed > 3:
            fail("...and %d more fields where the unit and its series disagree"
                 % (disagreed - 3))
        print("series %d units, %d values, %d quarters — counted from the CSVs"
              % (len(units), n_points, len(periods)))

    # ---- 7am. the filter never turns a missing value into a passing one ----
    # Move ב׳, 2.2.0.  The filter is the one screen where rule 2 can be broken
    # by a single character: `cmpValue(o, k) || 0` reads as "the value, or zero"
    # and turns every unit the source never published into a unit whose price is
    # zero — which passes "at most 1,200" and lands in the answer as a match.
    # Nothing on screen would look wrong.  The whole screen would be wrong.
    #
    # So this is structural, like §7ad: inside the filter's own block, a value
    # may only reach a comparison through fltTest(), and the block may not
    # contain a defaulting operator at all.  It also checks the two sentences
    # the screen owes the reader — the count of units that were NOT tested, and
    # the line saying what that means — because a filter that reports only its
    # matches is the quiet lie the move was written against.
    flt_a = appjs_txt.find("/* ------------------------------------------------------------- the filter --- */")
    flt_b = appjs_txt.find("function cmpClick(e) {")
    if flt_a < 0 or flt_b < flt_a:
        fail("7am cannot find the filter block in app.js — it moved, and this "
             "check is now looking at nothing")
    else:
        blk = appjs_txt[flt_a:flt_b]
        for bad, why in ((r"cmpValue\([^)]*\)\s*\|\|", "`|| something` after cmpValue"),
                         (r"cmpValue\([^)]*\)\s*\?\?", "`?? something` after cmpValue"),
                         (r"Number\(cmpValue", "Number() straight around cmpValue — null becomes 0")):
            m = re.search(bad, blk)
            if m:
                fail("app.js filter block: %s (%r). A unit the source never "
                     "published is not a unit whose value is zero — rule 2, and "
                     "on this screen it is one character away" % (why, m.group(0)))
        if "FLT_NONE" not in blk or blk.count("FLT_NONE") < 3:
            fail("the filter has lost its third outcome. A condition answers "
                 "pass, fail, or NOT TESTED — two outcomes is the bug")
        for owed in ("לא נבדקו", "אין להם נתון באחד השדות"):
            if owed not in blk:
                fail("the filter screen no longer says %r. The count of units it "
                     "could not test is half of its answer" % owed)
        if "fltTest(" not in blk:
            fail("the filter no longer tests through fltTest() — the one place "
                 "that knows a missing value is not a failed one")

    # ---- 7an. every number says how sure it is, in one of three words -----
    # Move י׳, 2.2.0.  Rule 3 of the accuracy contract has three words and the
    # data had a fourth state: nothing.  Twenty-seven of the sixty-seven records
    # carried no `confidence` at all, nine of them numeric — population, area,
    # density, distance, the housing block, the 2025 split.  A reader looking at
    # forty numbers could not tell which had been checked against a second
    # source, which came from one body's word, and which this project worked out
    # for itself, because for nine of them nobody had said.
    #
    # The nine were classified from the evidence their own records carry, and
    # the rule is now enforced: a NUMERIC field must say one of the three words.
    # Non-numeric fields — a name, a description, a letter on the map, an
    # outline — carry none, and that is not laziness: rule 3 is about a second
    # source reaching the same NUMBER, and there is no number to reach.
    CONF_WORDS = {"verified", "reported", "approx"}
    CONF_NUMERIC = {"number", "integer", "metres", "degrees", "°C", "mm"}
    # A category from a published typology is not a number, but rule 3 reads the
    # same way on it: one body assigned the class, and either a second source
    # reached the same class or none did.  `freguesia.tipau` says so in its own
    # validation_he — 218 codes matched by name against CAOP 2025, no second
    # source for the classification itself, therefore `reported`.  So a category
    # MAY carry a confidence word without it being a copy-paste; prose, a point,
    # an outline may not.
    # A derived LIST is the same case: `municipio.adj` is not a number, but
    # "computed here" is exactly what `approx` means, and a second derivation
    # could reach the same list — which is what the audit does for numbers.
    CONF_CLASSIFIABLE = CONF_NUMERIC | {"category", "list"}
    # And the other direction, named rather than inferred: these are the types
    # for which a confidence word means nothing at all.  A type in NEITHER set
    # also warns, because a value type §7an has never been told about is one
    # nobody has decided the question for.
    CONF_PROSE = {"text", "string", "point", "geometry"}
    n_conf = {"verified": 0, "reported": 0, "approx": 0}
    for key, rec in sorted(sources["fields"].items()):
        conf, vt = rec.get("confidence"), rec.get("value_type")
        if conf is None:
            if vt in CONF_NUMERIC:
                fail("data/sources.json %s is a %s and carries no confidence. "
                     "Rule 3 has three words — verified, reported, approx — and "
                     "a number that says none of them tells the reader nothing "
                     "about how sure it is" % (key, vt))
            continue
        if conf not in CONF_WORDS:
            fail("data/sources.json %s: confidence %r is not one of %s"
                 % (key, conf, sorted(CONF_WORDS)))
            continue
        n_conf[conf] += 1
        if vt in CONF_PROSE:
            # Not a failure, but worth seeing: a confidence word on a paragraph
            # of prose, on a coordinate or on an outline is usually a
            # copy-paste from the field above it.
            warn("data/sources.json %s is a %s and carries confidence %r — rule 3 "
                 "is about a second source reaching the same value, and a %s "
                 "has none to reach" % (key, vt, conf, vt))
        elif vt is not None and vt not in CONF_CLASSIFIABLE:
            warn("data/sources.json %s is a %s and carries confidence %r, and "
                 "§7an has never been told whether that means anything. Add "
                 "%r to CONF_CLASSIFIABLE or to CONF_PROSE, with the reason"
                 % (key, vt, conf, vt))
    print("confidence: %d verified, %d reported, %d approx, %d fields in all"
          % (n_conf["verified"], n_conf["reported"], n_conf["approx"],
             len(sources["fields"])))
    # And the screen that shows them has to exist and name all three, or the
    # classification is a field in a file nobody reads.
    for owed in ("CONF_HE", "renderSources", "'verified'", "'reported'", "'approx'"):
        if owed.strip("'") not in appjs_txt:
            fail("app.js no longer carries %s — move י׳ put the sources and the "
                 "absences on a screen of their own, and CLAUDE.md calls that "
                 "list part of the product" % owed)
    if "missing" not in appjs_txt or "missing.items" not in appjs_txt:
        fail("app.js no longer reads sources.json's missing.items — the list of "
             "what is NOT known is half of that screen")

    # ---- 7as. a fetched quarter is checked before it is believed ------------
    # Move יא.1, 2.5.0.  A number that arrives over the network after the app
    # shipped is still a number under the accuracy contract: it needs a source,
    # a reference period and a classification, and it needs to be the file that
    # was published rather than whatever the network handed over.
    #
    # The plan chose GitHub Releases and that cannot be used: a release
    # download sends no Access-Control-Allow-Origin, which is exactly why the
    # constraint layers are in the repository and go out through jsDelivr with
    # raw.githubusercontent behind them.  So the quarter files take the same
    # two hosts — and this checks that no THIRD host crept in, because §7ab
    # reads the online list and a host the app reaches but does not list is the
    # promise broken quietly.
    qdir = os.path.join(ROOT, "data", "quarter")
    qindex = os.path.join(qdir, "index.json")
    if not os.path.exists(qindex):
        fail("data/quarter/index.json is missing — run scripts/pack_quarter.py. "
             "Without it the app has nothing to ask for and the row in the menu "
             "is a button that cannot work")
    else:
        idx = json.load(io.open(qindex, encoding="utf-8"))
        series_units = set(json.load(io.open(
            os.path.join(ROOT, "data", "processed", "series.json"),
            encoding="utf-8"))["units"])
        lay = json.load(io.open(os.path.join(ROOT, "data", "layers_manifest.json"),
                                encoding="utf-8"))
        for k in ("base", "fallback"):
            want = lay[k].replace("/data/layers/", "/data/quarter/")
            if idx.get(k) != want:
                fail("data/quarter/index.json %s is %r and the layers use %r. "
                     "One host list, or the online page and the code disagree"
                     % (k, idx.get(k), want))
        seen = set()
        for q in idx.get("quarters", []):
            for field in ("period", "file", "bytes", "sha256"):
                if not q.get(field):
                    fail("a quarter in index.json has no %s. Every one of the "
                         "four is what the app checks before it stores the "
                         "file" % field)
            path = os.path.join(qdir, q.get("file") or "")
            if not os.path.exists(path):
                fail("index.json names %s and the file is not there" % q.get("file"))
                continue
            raw = open(path, "rb").read()
            if len(raw) != q["bytes"] or hashlib.sha256(raw).hexdigest() != q["sha256"]:
                fail("%s does not match its own index entry (%d bytes, sha %s "
                     "on disk). The app refuses a file that does not match, so "
                     "this one could never be downloaded"
                     % (q["file"], len(raw), hashlib.sha256(raw).hexdigest()[:12]))
            body = json.loads(raw.decode("utf-8"))
            if body.get("period") != q["period"]:
                fail("%s says it is %s and the index calls it %s"
                     % (q["file"], body.get("period"), q["period"]))
            if body.get("confidence") != "reported":
                fail("%s carries confidence %r. A fetched number is one source's "
                     "word like any other — rule 3" % (q["file"], body.get("confidence")))
            if not body.get("source"):
                fail("%s carries no source. Rule 1 does not stop at the network "
                     "boundary" % q["file"])
            for key in body.get("units", {}):
                if key not in series_units:
                    fail("%s carries unit %s, which this atlas does not draw"
                         % (q["file"], key))
            seen.add(q["period"])
        print("quarters published: %d (%s)"
              % (len(seen), ", ".join(sorted(seen)) or "none"))
    # And the app side: the refusals have to exist, each with its own sentence.
    for owed in ("function quarterCheck", "function quarterApply",
                 "function quarterFetch", "QUARTER_KEY", "quarterLoad()"):
        if owed not in appjs_txt:
            fail("app.js no longer carries %s — a quarter that arrives over the "
                 "network with nothing checking it is a number from a stranger "
                 "on a screen that promises sources" % owed)
    i = appjs_txt.find("function quarterCheck")
    body = appjs_txt[i:i + 2200] if i >= 0 else ""
    for rule, why in (("portoland_quarter !== 1", "it has to BE a quarter file"),
                      ("QPERIOD.test", "the period has to be a period"),
                      ("per.indexOf(body.period) >= 0", "it may not rewrite a packed quarter"),
                      ("body.period <= per[per.length - 1]", "it has to be NEWER than what is here"),
                      ("D.series.units[k]", "it may only name units this atlas draws")):
        if rule not in body:
            fail("quarterCheck() no longer tests %r — %s. The sha256 proves the "
                 "bytes arrived intact, not that they say anything true"
                 % (rule, why))
    if "quarterApply" in appjs_txt and "u[s].push(" not in appjs_txt:
        fail("quarterApply no longer APPENDS. Adding a quarter grows every "
             "array by one and touches nothing already in the bundle; anything "
             "else is a fetched file editing what shipped")

    # ---- 7ar. a deletion is a fact, and it travels ---------------------------
    # Move ט׳, 2.5.0.  The import merged by union: an id already here was
    # skipped, a new id was added.  Which means a place DELETED on this phone
    # came back the moment a file exported before the deletion was imported —
    # the shopping-cart anomaly of chapter 6, word for word, on someone's own
    # list of places they had ruled out.  And it is the worst kind of bug to
    # find: nothing errors, nothing is lost, a place you deliberately removed
    # is simply back among the ones you are still considering.
    #
    # What this enforces is the shape of the answer, because the behaviour
    # itself is proved by browser assertions that delete and re-import:
    # tombstones exist and are written on delete, they leave in BOTH exports,
    # the import reads them, and the merge does not throw a loser away in
    # silence — every outcome is counted and printed.
    for owed in ("MINE_GONE_KEY", "function mineAlive", "D.gone[gone] = nowStamp()",
                 "removed:", "bag.removed"):
        if owed not in appjs_txt:
            fail("app.js no longer carries %s — without it a place deleted here "
                 "comes back from any file written before the deletion, which "
                 "is the one thing move ט׳ exists to stop" % owed)
    # Both exports, or the two disagree about what the phone knows.
    n_removed = appjs_txt.count("removed: Object.keys(D.gone)")
    if n_removed < 2:
        fail("only %d of the two exports carries `removed`. The file export and "
             "the clipboard export are two ways out of the same phone, and a "
             "deletion that leaves by one and not the other is a deletion that "
             "comes back" % n_removed)
    # And the merge has to say what it did with every row.
    i = appjs_txt.find("async function importAll")
    body = appjs_txt[i:i + 4200] if i >= 0 else ""
    for word in ("added++", "updated++", "held++", "removed++", "skipped++"):
        if word not in body:
            fail("importAll() no longer counts %s. Chapter 6's objection to "
                 "last-write-wins is not that it picks a winner, it is that it "
                 "discards the loser in silence — so every outcome is counted "
                 "and printed" % word)
    for owed in ("מקומות עודכנו", "העותק כאן חדש יותר", "המחיקה מאוחרת מהקובץ"):
        if owed not in appjs_txt:
            fail("the import note no longer says %r. A merge that reports only "
                 "what it added is a merge whose losses are invisible" % owed)
    # `rev` is what decides both questions; `at` is what the card shows.  One
    # field cannot be both, and reusing `at` would silently change what the
    # card means.
    if "rev: nowStamp()" not in appjs_txt:
        fail("commitMine no longer stamps `rev`. Without a moment of last "
             "write there is nothing to compare when both sides hold the same "
             "id, and the merge is back to first-wins by accident")
    print("my places: tombstones kept, both exports carry them, five outcomes counted")

    # ---- 7aq. next to is a relation, and a relation has laws ----------------
    # Move ה׳, 2.4.0.  The neighbour lists are derived from geometry, and
    # geometry is exactly where a derivation goes wrong quietly: a polygon that
    # fails to clean, a sliver of a border that rounds to nothing, an R-tree
    # query that returns a candidate the intersection then rejects.  None of
    # that looks wrong in the output — it looks like a parish with one fewer
    # neighbour than it has.
    #
    # What a relation does have is laws, and they do not need a second source:
    # if A borders B then B borders A, nothing borders itself, and in one
    # continuous district nothing borders nothing.  §7ag is the same idea for
    # a derived NUMBER; this is it for a derived EDGE.
    for lvl, rows, key in (("freguesia", fre, "dicofre"),
                           ("municipio", mun, "dicofre")):
        by = {}
        missing_list = 0
        for r in rows:
            if "adj" not in r:
                missing_list += 1
                continue
            by[r[key]] = set(r["adj"])
        if missing_list:
            fail("%d %s records carry no `adj` at all. Move ה׳ derives it for "
                 "every unit; a record without one is a unit the build did not "
                 "find in the boundary file" % (missing_list, lvl))
        for code, nb in sorted(by.items()):
            if not nb:
                fail("%s %s borders nothing. The district is one continuous "
                     "area and has no islands in it" % (lvl, code))
            if code in nb:
                fail("%s %s is its own neighbour. `touches` against itself is "
                     "how that happens, and the answer is meaningless" % (lvl, code))
            for other in sorted(nb):
                if other not in by:
                    fail("%s %s names %s as a neighbour and no such unit is in "
                         "the app. A neighbour list that points outside the "
                         "data is a dead link on a screen" % (lvl, code, other))
                elif code not in by[other]:
                    fail("%s: %s borders %s and %s does not border %s. Sharing "
                         "a border is symmetric — there is one line and it has "
                         "two sides" % (lvl, code, other, other, code))
        if by:
            n = [len(v) for v in by.values()]
            print("%s adjacency: %d units, %d..%d neighbours each, symmetric"
                  % (lvl, len(by), min(n), max(n)))
    # And the app has to be able to turn a code back into a unit, or the list
    # is a set of codes nobody can follow.
    # The rows have to be reachable, not only present.  The first version of
    # adjCard used `data-jump`, which #doc does not delegate — every row
    # rendered, looked like a button and did nothing, and only a browser
    # assertion that CLICKED one found it.  So both halves are named here.
    for owed in ("data-adjmun", "data-adjfre",
                 "closest('[data-adjmun]')", "closest('[data-adjfre]')"):
        if owed not in appjs_txt:
            fail("app.js no longer carries %s. A neighbour row that #doc does "
                 "not delegate renders as a button and does nothing — which is "
                 "exactly how the first version of this card shipped" % owed)
    for owed in ("D.freByDicofre", "D.munByDicofre", "function adjCard"):
        if owed not in appjs_txt:
            fail("app.js no longer carries %s — the neighbour lists are DICOFRE "
                 "codes, and without the lookup and the card they are data that "
                 "never reaches a screen" % owed)
    # Rule 4, in the one place it is easy to lose: the card may not call a
    # shared border a distance, a nearness or a travel time.
    i = appjs_txt.find("function adjCard")
    card = appjs_txt[i:i + 2600] if i >= 0 else ""
    for bad in ("דקות", "מרחק נסיעה", "ק״מ מ"):
        if bad in card:
            fail("adjCard() says %r. A shared border is not a distance and not "
                 "a journey: two parishes across the Douro border each other "
                 "and are twenty minutes apart. Rule 4" % bad)

    # ---- 7ap. the search answers with everything it found -------------------
    # Move ד׳, 2.4.0.  What was there before was a substring scan with
    # `if (out.length > 60) break;` INSIDE the loop over the 275 parishes — and
    # the bug was never speed (search measured 1/2/3ms then and does now).  The
    # break made the ANSWER WRONG: "מטרו" returned whichever stations sat in the
    # parishes `Object.keys` happened to reach first, stopped, and then printed
    # the number it had reached as though it were the number there are.  A list
    # truncated in an order the reader cannot see, with a count that looks like
    # a fact, is the same fault as a filter that counts a missing value as a
    # pass — §7am — wearing different clothes.
    #
    # So: both search paths go through the one index, the cap applies to the
    # DRAWING and never to the counting, and neither path may grow a substring
    # scan again.  The second half matters because the scan is the obvious
    # thing to reach for — it is four lines and it looks like it works.
    for owed in ("function srchBuild", "function srchQuery", "function srchLower",
                 "srchTokens", "D.poiTerms"):
        if owed not in appjs_txt:
            fail("app.js no longer carries %s — move ד׳ put every name behind "
                 "one index, and both the search screen and the place picker "
                 "read it" % owed)
    for fn in ("function runSearch", "function placeHits"):
        i = appjs_txt.find(fn)
        if i < 0:
            fail("app.js no longer defines %s" % fn)
            continue
        body = appjs_txt[i:i + 2600]
        if "srchQuery(" not in body:
            fail("%s no longer goes through srchQuery(). Two search paths that "
                 "scan the same names separately can disagree about what the "
                 "app contains, and they did" % fn)
        if ".includes(q)" in body or ".indexOf(q) >= 0" in body:
            fail("%s has grown a substring scan again. It is four lines and it "
                 "looks like it works; what it cannot do is stop early without "
                 "lying about the count" % fn)
        if re.search(r"out\.length\s*>\s*\d+\s*\)\s*break", body):
            fail("%s caps the SEARCH and not the drawing. The number on screen "
                 "then counts what was reached, not what matched" % fn)
    # The count printed has to be the length of the whole answer.  `.slice` is
    # what draws sixty of them; a count taken after the slice is the old bug.
    m = re.search(r"const SHOW = (\d+);", appjs_txt)
    if not m:
        fail("app.js no longer declares the search's draw cap as SHOW — the cap "
             "has to be visibly separate from the count, which is the whole "
             "point of §7ap")
    else:
        i = appjs_txt.find("function runSearch")
        body = appjs_txt[i:i + 2600]
        if "out.length > SHOW" not in body or "${out.length}" not in body:
            fail("runSearch no longer prints out.length as the number of "
                 "results. A count taken from the drawn slice is the number "
                 "the reader was shown, not the number there are")
    # Rule 6: the index READS `he`.  Folding is for the query and the index
    # key; a folded string that reaches a name is a transliteration this
    # project generated, which rule 6 forbids outright.
    for bad in (".he = srchFold", ".he = srchTokens", "he: srchFold"):
        if bad in appjs_txt:
            fail("app.js writes a folded string into a name (%s). Rule 6: "
                 "transliterations are read, never generated, corrected or "
                 "suggested" % bad)
    print("search: one index, two renderings, the count is the whole answer")

    # ---- 7ao. the audit stays a SECOND path, and does not become the first --
    # Move ז׳, 2.3.0.  The audit re-derives published numbers from data/raw and
    # compares; its entire value rests on getting there by a different route.
    # The day someone writes `from build import geom_area_km2` to save twenty
    # lines, the area probe stops being evidence and becomes build.py agreeing
    # with itself — and nothing would look wrong: the run would still be green,
    # faster, and shorter.  That is the failure this check exists to prevent,
    # because it is the one that leaves no trace.
    #
    # It also holds the shape: every probe_* function is registered, and every
    # one carries a docstring.  A probe with no docstring is a probe whose
    # author never wrote down what agreement means, and a tolerance nobody
    # justified is a tolerance that will be widened the first time it fails.
    audit_path = os.path.join(ROOT, "scripts", "audit_e2e.py")
    if not os.path.exists(audit_path):
        fail("scripts/audit_e2e.py is gone. It is the only thing that reads the "
             "shipped numbers back out of data/raw; checks.py validates the "
             "shape of the output and the arithmetic inside it, and neither is "
             "the same question")
    else:
        au = io.open(audit_path, encoding="utf-8").read()
        for bad in ("from build import", "import build\n", "from porto_map",
                    "import build_constraints", "from build_constraints"):
            if bad in au:
                fail("scripts/audit_e2e.py contains %r. The audit's whole value "
                     "is that it reaches the number by a different route; a "
                     "probe that calls the build's own function confirms only "
                     "that the build agrees with itself" % bad)
        probes = set(re.findall(r"^def (probe_[a-z_]+)\(", au, re.M))
        block = re.search(r"^PROBES = \[(.*?)^\]", au, re.S | re.M)
        listed = set(re.findall(r"probe_[a-z_]+", block.group(1))) if block else set()
        if not block:
            fail("scripts/audit_e2e.py no longer declares a PROBES list — "
                 "nothing then says which probes a full run covers")
        for orphan in sorted(probes - listed):
            fail("scripts/audit_e2e.py defines %s() and never registers it in "
                 "PROBES, so a full run does not call it" % orphan)
        for ghost in sorted(listed - probes):
            fail("PROBES names %s and no such function exists" % ghost)
        undoc = sorted(n for n in probes
                       if not re.search(r"^def %s\(.*?\):\n    \"\"\"" % n, au, re.S | re.M))
        for n in undoc:
            fail("scripts/audit_e2e.py: %s() carries no docstring. Every probe "
                 "has to say what it re-derives, by which route, and inside "
                 "what tolerance — a tolerance nobody wrote down is one that "
                 "gets widened the first time it fails" % n)
        print("audit %d probes, all registered and documented, no build import"
              % len(probes))
        # And the loop has to name it, or it is a script that exists and never
        # runs.  ARCHITECTURE section 9 is the loop the project actually runs.
        arch_txt = io.open(os.path.join(ROOT, "docs", "ARCHITECTURE.md"),
                           encoding="utf-8").read()
        if "audit_e2e.py" not in arch_txt:
            fail("docs/ARCHITECTURE.md does not mention scripts/audit_e2e.py — "
                 "a verification step that no document names is a step nobody "
                 "runs")

    # ---- 7af. every check in this file answers to one label, and only one ---
    # Found 2026-09-15 while counting the sections for the 2.0.0 documents:
    # 7v was the Android manifest check and ALSO the CRUS check, and both were
    # cited as "§7v" in ARCHITECTURE.md and HANDOFF.md — so "see 7v" pointed at
    # two different rules. The letter is how every document refers to a rule;
    # a duplicate makes the reference useless and a rename silently orphans it.
    # The CRUS one became 7ae. This keeps the next one from happening.
    me = io.open(os.path.abspath(__file__), encoding="utf-8").read()
    labels = re.findall(r"^    # ---- ([0-9a-z]+)\. ", me, re.M)
    dup = sorted({l for l in labels if labels.count(l) > 1})
    if dup:
        fail("checks.py uses the same section label twice: %s — the letter is how "
             "ARCHITECTURE.md and HANDOFF.md cite a rule, and two rules cannot share one"
             % ", ".join(dup))
    else:
        print("check sections %d, every label its own" % len(labels))

    for w in warns:
        print("WARN  " + w)
    for f in fails:
        print("FAIL  " + f)
    print("\n%s  (%d warnings)" % ("ALL CHECKS PASSED" if not fails
                                   else "%d CHECKS FAILED" % len(fails), len(warns)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
