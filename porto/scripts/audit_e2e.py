#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""End-to-end audit: re-derive what the app ships, by a second code path.

    python3 scripts/audit_e2e.py                 # a sample of 40 units per probe
    python3 scripts/audit_e2e.py --all           # every unit, every probe
    python3 scripts/audit_e2e.py --seed 7        # a different sample, repeatably
    python3 scripts/audit_e2e.py --probe area    # one probe only

Move ז׳ of docs/INFORMATION-PLAN.md, and the reason it exists is one sentence
from chapter 13 of *Designing Data-Intensive Applications*: "if you want to be
sure that your data is still there, you have to read it and check".  HDFS and
S3 run background processes that read files back and compare them to their
copies; nothing here did.  checks.py validates the SHAPE of the output and the
arithmetic BETWEEN its fields, and crosscheck_baseline.py compares seven
measures against one prepared file — but no machine ever went back to
data/raw and worked the published numbers out again.

WHY A SECOND CODE PATH, AND NOT A SECOND CALL TO THE FIRST.  An audit that
imports build.py's own functions confirms that build.py agrees with itself,
which it always will.  So nothing here imports from build.py.  Where the
build uses geographiclib's geodesic polygon, this projects to an equal-area
projection and measures the plane.  Where the build reads a prepared parish
total, this sums the census sections and groups them itself.  Where the build
carries a typology class down from the level-1 row above it, this reads the
class out of the level-2 code beside it.  Two paths that reach the same number
are evidence; one path that reaches itself is not.

That is the same principle as rule 3 of the accuracy contract — `verified`
only once a second, independent source reached the same number — applied to
the DERIVATION rather than to the source.  Two halves of one idea.

WHAT A DISAGREEMENT MEANS.  Not always a bug in the build: two honest paths
can differ by a rounding step, and one probe here (parish population) is
EXPECTED to differ for a known, named reason, which is why it reports rather
than fails.  Every probe states its tolerance and why that tolerance and not
a tighter one.  A probe with no stated tolerance would be a probe whose author
had not decided what agreement means.
"""
import argparse
import csv
import hashlib
import io
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw")
PROC = os.path.join(ROOT, "data", "processed")

FAIL = []
NOTE = []


def fail(msg):
    FAIL.append(msg)
    print("FAIL  " + msg)


def note(msg):
    NOTE.append(msg)
    print("note  " + msg)


def load(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def items(name):
    d = load(os.path.join(PROC, name))
    return d["items"] if isinstance(d, dict) and "items" in d else d


def sample(rows, n, rnd):
    """A sample, or everything when n is 0 — sorted so output is comparable."""
    if not n or n >= len(rows):
        return rows
    return sorted(rnd.sample(rows, n), key=lambda r: str(r.get("dicofre", "")))


# --------------------------------------------------------------------------
# 1. the manifest — read every shipped byte back, not just the ones in memory
# --------------------------------------------------------------------------
def probe_manifest(_args, _rnd):
    """Silent corruption: a file that changed after the build wrote it.

    §7ai already checks that the manifest's own numbers are self-consistent
    and that its app_version matches VERSION.  It does NOT re-read the files.
    A byte flipped by a bad disk, a half-finished copy, or an editor saving
    over a generated file leaves the manifest intact and the data wrong, and
    every check downstream then validates the corrupted copy.
    """
    man = load(os.path.join(PROC, "manifest.json"))
    files = man.get("files", {})
    if not files:
        return fail("manifest.json lists no files at all")
    seen, bad = 0, 0
    for name, rec in sorted(files.items()):
        path = os.path.join(PROC, name)
        if not os.path.exists(path):
            fail("manifest names %s and it is not on disk" % name)
            bad += 1
            continue
        raw = open(path, "rb").read()
        got = hashlib.sha256(raw).hexdigest()
        if got != rec.get("sha256"):
            fail("%s: sha256 on disk %s, manifest says %s — the file changed "
                 "after the build wrote it" % (name, got[:12], str(rec.get("sha256"))[:12]))
            bad += 1
        elif len(raw) != rec.get("bytes"):
            fail("%s: %d bytes on disk, manifest says %s"
                 % (name, len(raw), rec.get("bytes")))
            bad += 1
        seen += 1
    on_disk = {f for f in os.listdir(PROC) if f != "manifest.json"}
    extra = sorted(on_disk - set(files))
    if extra:
        fail("data/processed carries %d file(s) the manifest does not name: %s "
             "— an unlisted file ships unchecked" % (len(extra), ", ".join(extra)))
        bad += 1
    print("  manifest: %d files read back, %d disagreements" % (seen, bad))


# --------------------------------------------------------------------------
# 2. population — summed from the census SECTIONS, grouped here
# --------------------------------------------------------------------------
def probe_pop(args, rnd):
    """The build's population comes from BGRI subsection totals, already summed
    per 2025 parish by fetch_bgri.py.  This path never opens that total: it
    reads the section-level Ficheiro Síntese — a different INE product, on the
    2021 boundaries — and adds the sections up itself.

    WHAT THE TWO PATHS CAN AND CANNOT BOTH KNOW.  A census section is the
    coarser unit: 1,410 of this district's 1,476 sit wholly inside one 2025
    parish, and 66 straddle two.  `section_to_2025` gives the straddlers no
    parish at all (a null), which is the honest answer at that resolution —
    the build resolves them because BGRI goes one level finer, to subsections.
    So this path CANNOT reproduce a parish figure that includes part of a
    straddling section, and pretending otherwise would make the probe noise.

    What it can do is the identity that must hold whatever the resolution:

        every person in the section file is a person in some parish

    So the DISTRICT total is exact and any difference is a failure; and per
    unit, the published figure must be at least what the whole sections
    account for, with the whole shortfall explained by the straddlers — no
    unit may be short by more people than the straddlers carry, and the
    shortfalls must add up to exactly the straddlers' population.  A parish
    that published FEWER people than its own whole sections hold is a failure
    at any resolution: sections that sit entirely inside it cannot leave.
    """
    sec = load(os.path.join(RAW, "censos2021_seccoes_d13.json"))["seccoes"]
    bgri = load(os.path.join(RAW, "bgri2021_to_caop2025_d13.json"))
    to2025 = bgri["section_to_2025"]

    by_fre, by_mun, straddle = {}, {}, 0
    for code, rec in sec.items():
        n = int(rec.get("N_INDIVIDUOS") or 0)
        fre = to2025.get(code)
        if fre is None:
            straddle += n                  # a section in two parishes at once
            continue
        by_fre[fre] = by_fre.get(fre, 0) + n
        by_mun[fre[:4]] = by_mun.get(fre[:4], 0) + n

    total_sec = sum(int(r.get("N_INDIVIDUOS") or 0) for r in sec.values())
    for which, name in (("parish", "freguesias.json"),
                        ("municipality", "municipios.json")):
        rows = items(name)
        pub = sum(r["pop2021"] for r in rows)
        if pub != total_sec:
            fail("the %s figures add up to %d people and the census sections "
                 "to %d. Every person in a section lives in some %s, so these "
                 "two numbers are the same number" % (which, pub, total_sec, which))
        else:
            print("  population · district via %s: %d, identical to the "
                  "sections read and summed here" % (which, pub))

    for which, name, tally in (("parish", "freguesias.json", by_fre),
                               ("municipality", "municipios.json", by_mun)):
        rows = items(name)
        short = []
        for r in rows:
            got = tally.get(r["dicofre"], 0)
            d = r["pop2021"] - got
            if d < 0:
                fail("%s %s publishes %d people and its WHOLE sections already "
                     "hold %d. A section inside a %s cannot leave it"
                     % (which, r["pt"], r["pop2021"], got, which))
            elif d:
                short.append((r, d))
        missing = sum(d for _r, d in short)
        if missing != straddle:
            fail("%s: the published figures exceed the whole sections by %d "
                 "people in all, and the straddling sections carry %d. Those "
                 "are the same people and the two numbers must match"
                 % (which, missing, straddle))
        exact = len(rows) - len(short)
        print("  population · %s: %d of %d re-derived exactly; %d take part of "
              "a straddling section, accounting for all %d of them"
              % (which, exact, len(rows), len(short), straddle))
        if short and which == "parish":
            worst = sorted(short, key=lambda p: -p[1])[:3]
            note("largest shares of a straddling section: " +
                 ", ".join("%s +%d" % (r["pt"], d) for r, d in worst))


# --------------------------------------------------------------------------
# 3. area — measured on an equal-area projection, not on the ellipsoid
# --------------------------------------------------------------------------
def _laea_area_km2(geom):
    """Area of a GeoJSON (Multi)Polygon through a Lambert azimuthal equal-area
    projection centred on the shape itself, in km².

    The build measures the geodesic polygon directly with geographiclib.  This
    projects to a plane on which area is preserved by construction and measures
    the plane with the shoelace formula — no shared library, no shared formula,
    and an error that is bounded by the projection's own (well under a metre
    for shapes this size) rather than by anything the build does.
    """
    from pyproj import Transformer

    rings = []
    if geom["type"] == "Polygon":
        rings = [geom["coordinates"]]
    elif geom["type"] == "MultiPolygon":
        rings = geom["coordinates"]
    else:
        return None
    xs = [p[0] for poly in rings for r in poly for p in r]
    ys = [p[1] for poly in rings for r in poly for p in r]
    lon0, lat0 = sum(xs) / len(xs), sum(ys) / len(ys)
    tr = Transformer.from_crs(
        "EPSG:4326",
        "+proj=laea +lat_0=%.6f +lon_0=%.6f +x_0=0 +y_0=0 +datum=WGS84 +units=m"
        % (lat0, lon0),
        always_xy=True)

    def shoelace(ring):
        pts = [tr.transform(p[0], p[1]) for p in ring]
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        s = 0.0
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            s += x1 * y2 - x2 * y1
        return abs(s) / 2.0

    total = 0.0
    for poly in rings:
        total += shoelace(poly[0])
        for hole in poly[1:]:
            total -= shoelace(hole)
    return total / 1e6


def _geoms(path, key):
    fc = load(path)
    out = {}
    for ft in fc["features"]:
        p = ft.get("properties") or {}
        code = str(p.get(key) or p.get(key.upper()) or "").strip()
        if code:
            out[code] = ft["geometry"]
    return out


def _caop(which):
    """CAOP 2025 outlines by DICOFRE, whatever the file calls that column."""
    path = os.path.join(RAW, "dgt", "caop_%s.geojson" % which)
    fc = load(path)
    out = {}
    for ft in fc["features"]:
        p = ft.get("properties") or {}
        code = None
        for k in ("dicofre", "DICOFRE", "di_cofre", "codigo", "CODIGO",
                  "dtmnfr", "DTMNFR", "dtmn", "DTMN", "cod", "COD"):
            if p.get(k):
                code = str(p[k]).strip()
                break
        if code:
            out[code] = ft["geometry"]
    return out


# 0.05% is the tolerance the project already states against DGT's own published
# area_ha (see requirements.txt): it is the band inside which a different
# library's rounding is indistinguishable from agreement.  Tightening it would
# turn a shapely point release into a failing audit; loosening it would let a
# real geometry error through as noise.
AREA_TOL = 0.0005


def probe_area(args, rnd):
    fre = _caop("freguesias")
    mun = _caop("municipios")
    if not fre and not mun:
        return note("no CAOP outline file carried a code column this probe "
                    "recognises — area not re-derived")
    for which, geoms, rows in (("municipality", mun, items("municipios.json")),
                               ("parish", fre, items("freguesias.json"))):
        if not geoms:
            continue
        rows = sample([r for r in rows if r.get("area_km2")], args.n, rnd)
        same, seen = 0, 0
        for r in rows:
            g = geoms.get(r["dicofre"])
            if g is None:
                continue
            seen += 1
            got = _laea_area_km2(g)
            if got is None:
                continue
            want = r["area_km2"]
            if abs(got - want) > max(AREA_TOL * want, 0.005):
                fail("%s %s: the app publishes %.2f km², an equal-area "
                     "projection measures %.2f km² (%.3f%% apart)"
                     % (which, r["pt"], want, got, 100 * abs(got - want) / want))
            else:
                same += 1
        print("  area · %s: %d of %d within %.2f%%"
              % (which, same, seen, 100 * AREA_TOL))


# --------------------------------------------------------------------------
# 4. density — the arithmetic, recomputed from the two published numbers
# --------------------------------------------------------------------------
def probe_density(args, rnd):
    """checks.py rule 5 does this too, and that is deliberate: this one runs
    on the SHIPPED file rather than on the build's in-memory dictionaries, so
    it also catches a value that was correct when written and is not now.
    """
    for which, name in (("municipality", "municipios.json"),
                        ("parish", "freguesias.json")):
        rows = sample([r for r in items(name)
                       if r.get("density") and r.get("area_km2")], args.n, rnd)
        same = 0
        for r in rows:
            want = r["pop2021"] / r["area_km2"]
            if abs(want - r["density"]) > max(0.05, 0.0005 * want):
                fail("%s %s: density %s, but %d / %.2f km² is %.1f"
                     % (which, r["pt"], r["density"], r["pop2021"],
                        r["area_km2"], want))
            else:
                same += 1
        print("  density · %s: %d of %d" % (which, same, len(rows)))


# --------------------------------------------------------------------------
# 5. the INE price and rent fields — read back out of the published CSVs
# --------------------------------------------------------------------------
INE_FIELDS = [
    ("price_eur_m2", "ine_precos_venda.csv", "Total"),
    ("price_new_eur_m2", "ine_precos_venda.csv", "Novos"),
    ("price_used_eur_m2", "ine_precos_venda.csv", "Existentes"),
    ("rent_eur_m2", "ine_rendas.csv", None),
]


def _ine_latest(fname, dwelling):
    """The last published quarter per DICOFRE, straight from the CSV.

    Independent of read_ine_series(): that function builds the whole series
    and the build then takes its last point.  This one never builds a series —
    it keeps a running maximum period per code, which cannot inherit an
    ordering bug from the other path.
    """
    path = os.path.join(RAW, "ine", fname)
    out = {}
    with io.open(path, encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            if dwelling and (row.get("dwelling_type") or "") != dwelling:
                continue
            code = (row.get("dicofre") or "").strip()
            per = (row.get("period") or "").strip()
            val = (row.get("value_eur_m2") or "").strip()
            if not code or not per or not val or val == "-":
                continue
            try:
                v = float(val)
            except ValueError:
                continue
            cur = out.get(code)
            if cur is None or per > cur[0]:
                out[code] = (per, v)
    return {k: v for k, (_p, v) in out.items()}


def probe_ine(args, rnd):
    for field, fname, dwelling in INE_FIELDS:
        if not os.path.exists(os.path.join(RAW, "ine", fname)):
            note("%s is not in data/raw/ine — %s not re-derived" % (fname, field))
            continue
        latest = _ine_latest(fname, dwelling)
        for which, name in (("municipality", "municipios.json"),
                            ("parish", "freguesias.json")):
            rows = sample([r for r in items(name) if r.get(field) is not None],
                          args.n, rnd)
            same, seen = 0, 0
            for r in rows:
                want = latest.get(r["dicofre"])
                if want is None:
                    fail("%s %s publishes %s = %s and the CSV has no row for "
                         "code %s" % (which, r["pt"], field, r[field], r["dicofre"]))
                    continue
                seen += 1
                if abs(want - r[field]) > 0.51:
                    fail("%s %s: %s is %s in the app, %s in the CSV's last "
                         "quarter" % (which, r["pt"], field, r[field], want))
                else:
                    same += 1
            if rows:
                print("  %s · %s: %d of %d" % (field, which, same, seen))


# --------------------------------------------------------------------------
# 6. TIPAU — the class taken from the level-2 code, not from the level-1 row
# --------------------------------------------------------------------------
def probe_tipau(args, rnd):
    """build.py carries the class down from the last level-1 row it passed.
    This reads it out of the level-2 code instead (`APU0101A` begins with the
    class), so a file whose level-1 rows were reordered or dropped would break
    one path and not the other.
    """
    path = os.path.join(RAW, "ine", "tipau2025_v05635.csv")
    if not os.path.exists(path):
        return note("no TIPAU export in data/raw/ine — tipau not re-derived")
    cls, cur = {}, None
    with io.open(path, encoding="utf-8", newline="") as fh:
        for r in csv.reader(fh):
            if len(r) < 2:
                continue
            code = r[1].strip()
            if r[0] == "2" and code[:3] in ("APU", "AMU", "APR"):
                cur = code[:3]
            elif r[0] == "3" and cur:
                cls[code] = cur
    rows = sample([r for r in items("freguesias.json") if r.get("tipau")],
                  args.n, rnd)
    same = 0
    for r in rows:
        want = cls.get(r["dicofre"])
        if want is None:
            fail("parish %s (%s) publishes tipau %s and the export has no "
                 "level-3 row for it" % (r["pt"], r["dicofre"], r["tipau"]))
        elif want != r["tipau"]:
            fail("parish %s: tipau %s in the app, %s from the level-2 code"
                 % (r["pt"], r["tipau"], want))
        else:
            same += 1
    print("  tipau · parish: %d of %d" % (same, len(rows)))


# --------------------------------------------------------------------------
# 7. distance from Porto — haversine, against the build's geodesic
# --------------------------------------------------------------------------
def probe_dist(args, rnd):
    """A straight-line distance of ~50km at this latitude: the haversine's
    spherical assumption and the build's ellipsoidal one differ by about
    0.3%, which is why the tolerance is 0.5% and not zero.  What it catches
    is a distance measured from the wrong point, not a rounding step.
    """
    muns = items("municipios.json")
    porto = next((m for m in muns if m["pt"] == "Porto"), None)
    if not porto or not porto.get("center"):
        return note("no Porto centre in municipios.json — distance not re-derived")
    lon0, lat0 = porto["center"]
    rows = sample([m for m in muns if m.get("dist_porto_km") and m.get("center")],
                  args.n, rnd)
    same = 0
    for m in rows:
        lon, lat = m["center"]
        p1, p2 = math.radians(lat0), math.radians(lat)
        dp, dl = p2 - p1, math.radians(lon - lon0)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        want = 2 * 6371.0088 * math.asin(math.sqrt(a))
        if abs(want - m["dist_porto_km"]) > max(0.005 * want, 0.1):
            fail("%s: dist_porto_km is %s, the haversine from Porto's centre "
                 "is %.2f" % (m["pt"], m["dist_porto_km"], want))
        else:
            same += 1
    print("  dist_porto_km · municipality: %d of %d within 0.5%%"
          % (same, len(rows)))


# --------------------------------------------------------------------------
# 8. the housing block — counts re-summed from the sections
# --------------------------------------------------------------------------
def probe_housing(args, rnd):
    """Dwellings and buildings are counts, so a figure is the sum of its parts
    and nothing is shared out — but the parts this path can see are whole
    sections, and 66 of them straddle.  The same identity as the population
    probe therefore applies, at district level exactly and per unit as a
    bounded shortfall.

    This probe is why the population one is written the way it is.  Its first
    version assumed a section never crosses a MUNICIPALITY boundary, and the
    audit's first run said otherwise: Maia published 18 dwellings more than
    its sections hold and Trofa exactly 18 fewer.  Equal and opposite, on a
    pair of neighbours — a section straddling the line between two
    municipalities, resolved by the build at subsection level and invisible
    at this one.  The assumption was wrong and the audit found it, which is
    the whole point of running one.
    """
    sec = load(os.path.join(RAW, "censos2021_seccoes_d13.json"))["seccoes"]
    to2025 = load(os.path.join(RAW, "bgri2021_to_caop2025_d13.json"))["section_to_2025"]
    KEYS = (("dwellings", "N_ALOJAMENTOS_FAMILIARES"),
            ("buildings", "N_EDIFICIOS_CLASSICOS"))
    tot, straddle = {}, {k: 0 for k, _c in KEYS}
    for code, rec in sec.items():
        fre = to2025.get(code)
        for key, col in KEYS:
            n = int(rec.get(col) or 0)
            if fre is None:
                straddle[key] += n
            else:
                tot.setdefault(fre[:4], {k: 0 for k, _c in KEYS})[key] += n
    rows = [m for m in items("municipios.json") if m.get("housing")]
    for key, _col in KEYS:
        pub = sum(m["housing"].get(key) or 0 for m in rows)
        whole = sum(d[key] for d in tot.values())
        if pub != whole + straddle[key]:
            fail("housing.%s over the district: %d published, %d in the "
                 "sections. Every dwelling is in some municipality"
                 % (key, pub, whole + straddle[key]))
        short = 0
        for m in rows:
            got = (tot.get(m["dicofre"]) or {}).get(key, 0)
            d = (m["housing"].get(key) or 0) - got
            if d < 0:
                fail("%s: housing.%s is %s and its whole sections already hold "
                     "%s" % (m["pt"], key, m["housing"].get(key), got))
            short += max(d, 0)
        if short != straddle[key]:
            fail("housing.%s: the municipalities exceed their whole sections "
                 "by %d and the straddling sections carry %d"
                 % (key, short, straddle[key]))
        print("  housing · %s: district total identical (%d), %d in straddling "
              "sections and all of them accounted for" % (key, pub, straddle[key]))


PROBES = [
    ("manifest", probe_manifest),
    ("pop", probe_pop),
    ("area", probe_area),
    ("density", probe_density),
    ("ine", probe_ine),
    ("tipau", probe_tipau),
    ("dist", probe_dist),
    ("housing", probe_housing),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=40,
                    help="units sampled per probe (0 or --all for every one)")
    ap.add_argument("--all", action="store_true", help="every unit, no sampling")
    ap.add_argument("--seed", type=int, default=None,
                    help="sample seed; the default is the clock, so repeated "
                         "runs look at different units")
    ap.add_argument("--probe", action="append", default=None,
                    help="run only this probe (may be repeated): "
                         + ", ".join(k for k, _ in PROBES))
    args = ap.parse_args()
    if args.all:
        args.n = 0
    seed = args.seed if args.seed is not None else random.randrange(1 << 30)
    rnd = random.Random(seed)

    print("audit: %s, sample %s per probe, seed %d"
          % ("every unit" if not args.n else "%d units" % args.n,
             "all" if not args.n else args.n, seed))
    for name, fn in PROBES:
        if args.probe and name not in args.probe:
            continue
        print("\n[%s]" % name)
        fn(args, rnd)

    print("")
    if FAIL:
        print("%d DISAGREEMENT%s — the shipped number and the number re-derived "
              "from data/raw are not the same. Re-run with --seed %d to look at "
              "the same units again."
              % (len(FAIL), "" if len(FAIL) == 1 else "S", seed))
        sys.exit(1)
    print("the audit agrees with the build  (%d note%s)"
          % (len(NOTE), "" if len(NOTE) == 1 else "s"))


if __name__ == "__main__":
    main()
