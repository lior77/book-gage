#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download INE's BGRI 2021 statistical grid for the district, and assign every
subsection to a CAOP 2025 parish.

    python3 scripts/fetch_bgri.py                 # fetch, assign, write
    python3 scripts/fetch_bgri.py --keep-gpkg     # leave the downloads in place

WHY THIS EXISTS.  The 2021 census was counted on the 2013 parish division, and
the 2025 reform split 25 of this district's units into 57.  Moving the app to
the 2025 boundaries therefore leaves 57 parishes with no census figure at all —
unless the count can be rebuilt from something finer than a parish.  BGRI is
that something: INE publishes the census by *subsection*, the smallest unit it
maps, with the geometry.  Assign each subsection to the parish that contains
it and the 2025 figures follow by addition, with nothing estimated.

WHAT IT CANNOT DO, AND WHY THAT IS NOT HIDDEN.  The BGRI file carries wide age
bands (0-14, 15-24, 25-64, 65+) and no education, employment or nationality at
all.  Median age cannot be interpolated inside a 40-year band and this script
does not try; those four fields live in the section-level Ficheiro Síntese, and
they can only cross to a 2025 parish when a whole 2021 section crosses with
them.  The output records, per section, whether it splits — and a section that
splits takes its four fields out of the 2025 file rather than guessing them.

NO REPROJECTION.  BGRI is published in EPSG:3763 (ETRS89 / Portugal TM06) and
DGT's OGC API serves CAOP in the same CRS on request, so both sides are read in
TM06 metres and compared directly.  Reprojecting either side would put a
metre-scale error on a containment test that is decided at the boundary.
"""
import argparse
import json
import math
import os
import sqlite3
import struct
import sys
import time
import urllib.request
import zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

BASE = "https://mapas.ine.pt/download/filesGPG/2021/municipios"
UA = "porto-district-app/1.0 (https://github.com/lior77/book-gage)"

# The 18 municipalities of district 13, as INE numbers them in the file name.
MUNICIPIOS = ["13%02d" % n for n in range(1, 19)]

# BGRI columns this script carries across.  Everything here is a COUNT, so a
# parish total is a sum and nothing is averaged or weighted.
COUNTS = [
    "N_INDIVIDUOS", "N_INDIVIDUOS_H", "N_INDIVIDUOS_M",
    "N_INDIVIDUOS_0_14", "N_INDIVIDUOS_15_24",
    "N_INDIVIDUOS_25_64", "N_INDIVIDUOS_65_OU_MAIS",
    "N_EDIFICIOS_CLASSICOS",
    "N_EDIFICIOS_CONSTR_ANTES_1945", "N_EDIFICIOS_CONSTR_1946_1980",
    "N_EDIFICIOS_CONSTR_1981_2000", "N_EDIFICIOS_CONSTR_2001_2010",
    "N_EDIFICIOS_CONSTR_2011_2021",
    "N_EDIFICIOS_COM_NECESSIDADES_REPARACAO",
    "N_ALOJAMENTOS_TOTAL", "N_ALOJAMENTOS_FAMILIARES",
    "N_ALOJAMENTOS_FAM_CLASS_RHABITUAL",
    "N_ALOJAMENTOS_FAM_CLASS_VAGOS_OU_RESID_SECUNDARIA",
    "N_RHABITUAL_COM_ESTACIONAMENTO",
    "N_RHABITUAL_PROP_OCUP", "N_RHABITUAL_ARRENDADOS",
    "N_AGREGADOS_DOMESTICOS_PRIVADOS",
]


def _u32(b, o, le):
    return struct.unpack_from("<I" if le else ">I", b, o)[0]


def _f64(b, o, le):
    return struct.unpack_from("<d" if le else ">d", b, o)[0]


def _arc(p1, p2, p3, per_quarter=8):
    """Points along the circular arc from p1 to p3 passing through p2.

    INE stores eight of this district's subsections as true curves, on the
    Póvoa de Varzim coast. shapely cannot read a nonlinear WKB at all, so the
    choice was to linearise them or to drop 1,128 people without saying so.
    """
    (x1, y1), (x2, y2), (x3, y3) = p1, p2, p3
    d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2))
    if abs(d) < 1e-12:                      # collinear: a straight line
        return [p2, p3]
    ux = ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1)
          + (x3 * x3 + y3 * y3) * (y1 - y2)) / d
    uy = ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3)
          + (x3 * x3 + y3 * y3) * (x2 - x1)) / d
    r = math.hypot(x1 - ux, y1 - uy)
    a1 = math.atan2(y1 - uy, x1 - ux)
    a2 = math.atan2(y2 - uy, x2 - ux)
    a3 = math.atan2(y3 - uy, x3 - ux)

    def norm(a):
        while a <= -math.pi:
            a += 2 * math.pi
        while a > math.pi:
            a -= 2 * math.pi
        return a

    ccw = norm(a2 - a1) > 0 and norm(a3 - a2) > 0
    sweep = norm(a3 - a1)
    if ccw and sweep < 0:
        sweep += 2 * math.pi
    if not ccw and sweep > 0:
        sweep -= 2 * math.pi
    n = max(2, int(abs(sweep) / (math.pi / 2) * per_quarter) + 1)
    return [(ux + r * math.cos(a1 + sweep * i / n),
             uy + r * math.sin(a1 + sweep * i / n)) for i in range(1, n + 1)]


def _points(b, o, le, n):
    return ([(_f64(b, o + 16 * i, le), _f64(b, o + 16 * i + 8, le))
             for i in range(n)], o + 16 * n)


def _curve(b, o):
    le = b[o] == 1
    t = _u32(b, o + 1, le)
    o += 5
    if t == 2:                                          # LineString
        return _points(b, o + 4, le, _u32(b, o, le))
    if t == 8:                                          # CircularString
        n = _u32(b, o, le)
        pts, o = _points(b, o + 4, le, n)
        out = [pts[0]]
        for i in range(0, n - 2, 2):
            out += _arc(pts[i], pts[i + 1], pts[i + 2])
        return out, o
    if t == 9:                                          # CompoundCurve
        n = _u32(b, o, le)
        o += 4
        out = []
        for _ in range(n):
            seg, o = _curve(b, o)
            out += seg[1:] if out else seg
        return out, o
    raise ValueError("unexpected curve type %d" % t)


def _surface(b, o):
    le = b[o] == 1
    t = _u32(b, o + 1, le)
    o += 5
    rings = []
    if t == 3:                                          # Polygon
        nr = _u32(b, o, le)
        o += 4
        for _ in range(nr):
            n = _u32(b, o, le)
            pts, o = _points(b, o + 4, le, n)
            rings.append(pts)
        return rings, o
    if t == 10:                                         # CurvePolygon
        nr = _u32(b, o, le)
        o += 4
        for _ in range(nr):
            pts, o = _curve(b, o)
            rings.append(pts)
        return rings, o
    raise ValueError("unexpected surface type %d" % t)


def gpkg_geometry(blob):
    """The geometry inside a GeoPackage blob, curves included.

    The header is 'GP', a version, a flags byte and an SRS id; bits 1-3 of the
    flags say how many bytes of envelope sit between the header and the WKB.
    Reading from a fixed offset works until a row carries a different envelope
    and then fails as garbage rather than as an error, so the size is read from
    the flags every time.
    """
    from shapely import wkb
    from shapely.geometry import MultiPolygon, Polygon
    if blob[:2] != b"GP":
        raise ValueError("not a GeoPackage blob: %r" % blob[:2])
    envelope = [0, 32, 48, 48, 64][(blob[3] >> 1) & 0x07]
    w = blob[8 + envelope:]
    le = w[0] == 1
    kind = _u32(w, 1, le)
    if kind not in (10, 11, 12):                        # plain: shapely reads it
        return wkb.loads(w)
    polys = []
    if kind == 10:
        rings, _ = _surface(w, 0)
        polys.append(rings)
    else:                                               # MultiSurface
        n = _u32(w, 5, le)
        o = 9
        for _ in range(n):
            rings, o = _surface(w, o)
            polys.append(rings)
    made = [Polygon(r[0], r[1:]) for r in polys]
    return made[0] if len(made) == 1 else MultiPolygon(made)


def fetch(mun, outdir, tries=4):
    path = os.path.join(outdir, "BGRI2021_%s.zip" % mun)
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return path
    url = "%s/BGRI2021_%s.zip" % (BASE, mun)
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read()
            if len(body) < 1000:
                raise ValueError("suspiciously small: %d bytes" % len(body))
            with open(path, "wb") as fh:
                fh.write(body)
            return path
        except Exception as exc:                      # noqa: BLE001
            if attempt == tries - 1:
                raise
            wait = 2 ** attempt
            print("   %s: %s — retrying in %ds" % (mun, exc, wait))
            time.sleep(wait)
    return path


def subsections(zip_path):
    """Every subsection in one municipality's GeoPackage."""
    with zipfile.ZipFile(zip_path) as z:
        name = [n for n in z.namelist() if n.endswith(".gpkg")][0]
        tmp = os.path.join(os.path.dirname(zip_path), os.path.basename(name))
        if not os.path.exists(tmp):
            with open(tmp, "wb") as fh:
                fh.write(z.read(name))
    con = sqlite3.connect(tmp)
    table = [r[0] for r in con.execute("select table_name from gpkg_contents")][0]
    have = {r[1] for r in con.execute('PRAGMA table_info("%s")' % table)}
    missing = [c for c in COUNTS if c not in have]
    if missing:
        raise SystemExit("%s is missing %d expected columns: %s"
                         % (os.path.basename(zip_path), len(missing), missing[:4]))
    cols = ["BGRI2021", "DTMNFR21", "DTMNFRSEC21", "geom", "SHAPE_Area"] + COUNTS
    sel = ", ".join('"%s"' % c for c in cols)
    for row in con.execute('select %s from "%s"' % (sel, table)):
        yield dict(zip(cols, row))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "raw", "bgri"))
    ap.add_argument("--caop", default=os.path.join(ROOT, "data", "raw", "dgt",
                                                   "caop_freguesias_3763.geojson"))
    ap.add_argument("--keep-gpkg", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.caop):
        raise SystemExit(
            "CAOP 2025 in EPSG:3763 is not here: %s\n"
            "Both sides have to be in the same CRS or the containment test is\n"
            "decided by the reprojection error. Fetch it with:\n"
            "  python3 scripts/fetch_dgt_ogcapi.py caop_freguesias --crs 3763 \\\n"
            "      --out data/raw/dgt" % args.caop)

    from shapely.geometry import shape
    from shapely.strtree import STRtree

    os.makedirs(args.out, exist_ok=True)
    caop = json.load(open(args.caop, encoding="utf-8"))
    polys, codes = [], []
    for f in caop["features"]:
        code = f["properties"].get("dtmnfr")
        if not code or not code.startswith("13"):
            continue
        polys.append(shape(f["geometry"]))
        codes.append(code)
    print("CAOP 2025 parishes in district 13: %d" % len(codes))
    tree = STRtree(polys)

    rows, unplaced = [], []
    for mun in MUNICIPIOS:
        print("  %s" % mun, end=" ", flush=True)
        zp = fetch(mun, args.out)
        n = 0
        for sub in subsections(zp):
            geom = gpkg_geometry(sub.pop("geom"))
            # The file states its own area. Eight subsections are stored as
            # arcs and are linearised here, which is a calculation of mine
            # inside a file of theirs — so it is checked against the column
            # they published rather than trusted. 0.1% is far looser than the
            # 0.0005% the arcs actually come out at, and far tighter than a
            # ring read at the wrong offset could ever be.
            stated = sub.pop("SHAPE_Area", None)
            if stated and abs(geom.area - stated) / stated > 0.001:
                raise SystemExit(
                    "subsection %s: my geometry is %.1f m2 and INE says %.1f — "
                    "the WKB was read wrongly, not rounded"
                    % (sub["BGRI2021"], geom.area, stated))
            point = geom.representative_point()
            hit = None
            for idx in tree.query(point):
                if polys[idx].contains(point):
                    hit = codes[idx]
                    break
            if hit is None:
                # the nearest parish, but recorded as unplaced rather than used
                unplaced.append(sub["BGRI2021"])
            sub["dtmnfr25"] = hit
            sub["area_m2"] = round(geom.area, 1)
            rows.append(sub)
            n += 1
        print("%d subsections" % n)

    print("\nsubsections: %d   unplaced: %d" % (len(rows), len(unplaced)))
    if unplaced:
        print("  first few:", unplaced[:5])

    # Does a 2021 section survive whole?  The four fields BGRI does not carry
    # can only cross with a section that lands entirely in one 2025 parish.
    by_section = defaultdict(set)
    for r in rows:
        if r["dtmnfr25"]:
            by_section[r["DTMNFRSEC21"]].add(r["dtmnfr25"])
    whole = sum(1 for v in by_section.values() if len(v) == 1)
    print("2021 sections: %d   entirely inside one 2025 parish: %d   split: %d"
          % (len(by_section), whole, len(by_section) - whole))

    # What build.py needs is the sums, not 21,337 rows of working. The
    # subsection detail is re-derivable by running this script again and has no
    # business in a repository; what is kept is small enough to read in a diff.
    totals = defaultdict(lambda: defaultdict(float))
    for r in rows:
        code = r["dtmnfr25"]
        if not code:
            continue
        for c in COUNTS:
            totals[code][c] += (r[c] or 0)

    section_of = {}
    for sec, dests in by_section.items():
        section_of[sec] = sorted(dests)[0] if len(dests) == 1 else None

    out = os.path.join(ROOT, "data", "raw", "bgri2021_to_caop2025_d13.json")
    payload = {
        "generated": time.strftime("%Y-%m-%d", time.gmtime()),
        "source": "INE, BGRI 2021 (Base Geográfica de Referenciação de "
                  "Informação), per municipality from mapas.ine.pt, assigned to "
                  "CAOP 2025 (DGT) by point-in-polygon in EPSG:3763",
        "reference_year": 2021,
        "method_he": "כל תת-מקטע של מפקד 2021 שויך לרובע 2025 שמכיל את הנקודה "
                     "המייצגת שלו, ושתי השכבות נקראו באותה מערכת קואורדינטות "
                     "(EPSG:3763) כדי שמבחן ההכלה לא יוכרע בשגיאת היטל. "
                     "הסכומים הם חיבור בלבד — שום ערך אינו מוערך או מפוצל לפי "
                     "שטח.",
        "subsections_read": len(rows),
        "subsections_unplaced": len(unplaced),
        "sections_whole": whole,
        "sections_split": len(by_section) - whole,
        "counts": COUNTS,
        # a 2021 section -> the single 2025 parish holding it, or null when it
        # straddles two. The fields BGRI does not carry can only cross on a
        # section that does not straddle.
        "section_to_2025": section_of,
        "parish_totals": {k: {c: int(round(v)) for c, v in d.items()}
                          for k, d in sorted(totals.items())},
    }
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1, sort_keys=False)
    print("wrote %s  (%.1f KB)" % (out, os.path.getsize(out) / 1024.0))

    if not args.keep_gpkg:
        for f in os.listdir(args.out):
            if f.endswith(".gpkg"):
                os.remove(os.path.join(args.out, f))


if __name__ == "__main__":
    main()
