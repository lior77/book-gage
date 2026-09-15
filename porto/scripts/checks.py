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
    print("data files shipped %d/%d by both the bundle and the APK"
          % (len(wanted), len(wanted)))

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

    # ---- 7v. CRUS: the land-use regime, and where it does not add up -------
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
        (r"(?<!\d)(\d{3})(?!\d)\s*(?:רובעים|parishes)",
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
    years = set(re.findall(r"CAOP\s*(20\d\d)", appjs_txt))
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

    for w in warns:
        print("WARN  " + w)
    for f in fails:
        print("FAIL  " + f)
    print("\n%s  (%d warnings)" % ("ALL CHECKS PASSED" if not fails
                                   else "%d CHECKS FAILED" % len(fails), len(warns)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
