#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""How much of each municipality and each parish lies inside REN and RAN.

    python3 scripts/build_constraints.py          # -> data/raw/constraints_caop2025.json

WHAT THIS IS.  REN (Reserva Ecológica Nacional) and RAN (Reserva Agrícola
Nacional) are restrições de utilidade pública: ground where building is
restricted and needs a route through an exception regime, not ground where it
is forbidden outright.  The words matter and the app's fourth rule forbids
trading one for the other, so nothing here is ever called a ban.

WHAT IS COMPUTED.  For every unit: the area inside REN, the area inside RAN,
the area inside BOTH, and the union — which is emphatically NOT the sum.  The
two reserves overlap by up to 16.2% of a municipality (Paços de Ferreira), so
REN% + RAN% overstates the constrained share by exactly that much.  Four
numbers, and the one a reader wants is the union.

THE PROJECTION.  EPSG:3763 (ETRS89 / Portugal TM06), the national projected
CRS DGT itself publishes areas in.  The check below is not a formality: every
one of the 275 parish areas computed here is compared against the area_ha DGT
publishes on the same polygon, and the whole run fails if any of them is out
by more than 0.05%.

WHY EACH MUNICIPALITY IS CLIPPED TO ITSELF.  Each REN and RAN is delimited by
its own municipality's own law with its own year, so a municipality's figure
comes from its own delimitation and nothing else.  Two findings made this the
rule rather than a preference:

  * Matosinhos.  DGT publishes 5,072.9 ha of REN for it, but only 1,062.7 ha
    of that is on land — the rest is the maritime protection strip offshore.
    Divided naively that reads 81% of the municipality instead of 17%.
  * Vila Nova de Gaia.  Its delimitation covers 645.6 ha inside Gondomar and
    158.5 ha inside Porto.  Of the Gondomar part, 99% is already inside
    Gondomar's OWN REN — the same ground, declared twice — and 100% of the
    Porto part is the surface of the Douro.  Neither is a statement about a
    neighbour, so neither crosses the line.

WHAT THE REGISTER DID NOT RETURN.  DGT's register returned no REN and no RAN
polygons for Porto, and no REN for Vila do Conde, in the fetch these layers
were built from.  Say that, and not "Porto has no REN": a collection that
answers with zero features is not a collection that says none exists, and the
difference is the whole of rule 4.  Those units get no key at all, so the app
renders אין נתון and never a zero.  The reason DGT does not publish them is
not published either, and none is invented here.
"""
import datetime
import gzip
import json
import os
import sys

import shapely
from shapely import make_valid
from shapely.geometry import shape
from shapely.geometry.base import BaseMultipartGeometry
from shapely.ops import transform, unary_union
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LAYERS = os.path.join(ROOT, "data", "layers")
CAOP = os.path.join(ROOT, "data", "raw", "dgt", "caop_freguesias_3763.geojson")
MANIFEST = os.path.join(ROOT, "data", "layers_manifest.json")
OUT = os.path.join(ROOT, "data", "raw", "constraints_caop2025.json")

KINDS = ("ren", "ran")
TO3763 = Transformer.from_crs("EPSG:4326", "EPSG:3763", always_xy=True).transform


# The area check against DGT's own published figure. Measured worst case over
# all 275 parishes is 0.004%; 0.05% leaves room for a shapely release that
# rounds differently and still catches a wrong CRS, which is out by percent.
AREA_TOL = 0.05

# GEOS refuses to overlay some of these polygons as served: intersecting a
# municipality's REN with its RAN throws "Unable to determine overlay result
# geometry dimension", which is the robustness failure a legal boundary carried
# to fifteen decimal places produces in floating-point overlay. Pre-snapping the
# inputs does not fix it — the derived pieces fail the same way one step later.
#
# The documented fix is GEOS's fixed-precision overlay: every intersection and
# union here passes grid_size, so the overlay itself runs on a decidable grid.
#
# The grid is ONE MILLIMETRE on the ground. A REN line follows a contour, a
# stream bank and a parcel edge surveyed in metres; a millimetre is four orders
# below anything the source resolves. It applies only to the arithmetic here —
# the polygons the app downloads and draws are the bytes DGT served, untouched.
GRID = 0.001


def polygonal(g):
    """Only the 2-D parts. A fixed-precision overlay can collapse a sliver to a
    line, and a line has no area but does poison the next overlay."""
    if g is None or g.is_empty:
        return g
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    if isinstance(g, BaseMultipartGeometry):
        keep = [p for p in g.geoms if p.geom_type in ("Polygon", "MultiPolygon")]
        return unary_union(keep) if keep else shapely.Polygon()
    return shapely.Polygon()


def valid(g):
    return g if g is None or g.is_valid else polygonal(make_valid(g))


def inter(a, b):
    """Intersection on the grid, with the cheap bbox clip first: a parish is a
    hundredth of the municipality, and clip_by_rect drops the rest before the
    overlay has to look at it."""
    if a is None or b is None or a.is_empty or b.is_empty:
        return shapely.Polygon()
    x0, y0, x1, y1 = b.bounds
    try:
        a = polygonal(shapely.clip_by_rect(a, x0, y0, x1, y1))
    except Exception:
        pass                      # the clip is an optimisation, never the answer
    if a.is_empty:
        return shapely.Polygon()
    return polygonal(shapely.intersection(valid(a), valid(b), grid_size=GRID))


def union2(a, b):
    return polygonal(shapely.union(valid(a), valid(b), grid_size=GRID))


def die(msg):
    sys.stderr.write("build_constraints: %s\n" % msg)
    sys.exit(1)


def load_layer(kind, dtcc):
    """One municipality's whole delimitation, dissolved, in EPSG:3763."""
    path = os.path.join(LAYERS, "%s-%s.geojson.gz" % (kind, dtcc))
    if not os.path.exists(path):
        return None
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        gj = json.load(fh)
    # unary_union first: two features of one delimitation may touch or overlap,
    # and adding their areas would count the shared ground twice
    raw = transform(TO3763, unary_union([shape(f["geometry"]) for f in gj["features"]]))
    return valid(raw)


def ha(g):
    return g.area / 10000.0 if g is not None else None


def pct(part, whole):
    return None if part is None else round(100.0 * part / whole, 1)


def main():
    caop = json.load(open(CAOP, encoding="utf-8"))
    manifest = json.load(open(MANIFEST, encoding="utf-8"))

    parishes = {}
    for f in caop["features"]:
        p = f["properties"]
        parishes[p["dtmnfr"]] = (p["freguesia"], shape(f["geometry"]), float(p["area_ha"]))
    if len(parishes) != 275:
        die("expected 275 parishes in CAOP 2025, found %d" % len(parishes))

    by_mun = {}
    for code, row in parishes.items():
        by_mun.setdefault(code[:4], []).append(code)

    out = {"municipios": {}, "freguesias": {}}
    worst_area = 0.0
    covered = {k: 0 for k in KINDS}

    for dtcc in sorted(by_mun):
        codes = sorted(by_mun[dtcc])
        mun_geom = valid(unary_union([parishes[c][1] for c in codes]))
        mun_ha = ha(mun_geom)

        lay = {}
        for kind in KINDS:
            g = load_layer(kind, dtcc)
            lay[kind] = inter(g, mun_geom) if g is not None else None
            if g is not None:
                covered[kind] += 1

        def rec(geom, unit_ha):
            """The four numbers for one unit, or an empty record."""
            r = {"area_ha": round(unit_ha, 1)}
            got = {}
            for kind in KINDS:
                if lay[kind] is None:
                    continue
                piece = inter(lay[kind], geom)
                got[kind] = piece
                r[kind + "_ha"] = round(ha(piece), 1)
                r[kind + "_pct"] = pct(ha(piece), unit_ha)
            if len(got) == 2:
                both = inter(got["ren"], got["ran"])
                either = union2(got["ren"], got["ran"])
                r["both_ha"] = round(ha(both), 1)
                r["both_pct"] = pct(ha(both), unit_ha)
                r["either_ha"] = round(ha(either), 1)
                r["either_pct"] = pct(ha(either), unit_ha)
                # the identity the whole point of this file rests on
                gap = abs((ha(got["ren"]) + ha(got["ran"]) - ha(both)) - ha(either))
                if gap > max(0.05, 1e-4 * unit_ha):
                    die("%s: REN+RAN-both != union by %.3f ha" % (dtcc, gap))
                if ha(both) > min(ha(got["ren"]), ha(got["ran"])) + 0.05:
                    die("%s: the overlap is larger than one of the two" % dtcc)
            elif len(got) == 1:
                only = list(got)[0]
                r["either_ha"] = r[only + "_ha"]
                r["either_pct"] = r[only + "_pct"]
            return r

        m = rec(mun_geom, mun_ha)
        for kind in KINDS:
            e = manifest["layers"][kind]["municipalities"].get(dtcc)
            if e:
                m[kind + "_year"] = e["reference_year"]
                m[kind + "_law"] = e["law"]
        out["municipios"][dtcc] = m

        # every piece has to add back up to the whole it came from
        sums = {k: 0.0 for k in KINDS}
        for code in codes:
            name, geom, dgt_ha = parishes[code]
            calc = ha(geom)
            gap = abs(calc / dgt_ha - 1) * 100
            worst_area = max(worst_area, gap)
            if gap > AREA_TOL:
                die("%s (%s): computed %.1f ha against DGT's %.1f ha, %.3f%% apart"
                    % (code, name, calc, dgt_ha, gap))
            r = rec(valid(geom), calc)
            out["freguesias"][code] = r
            for kind in KINDS:
                if kind + "_ha" in r:
                    sums[kind] += r[kind + "_ha"]
        for kind in KINDS:
            if lay[kind] is None:
                continue
            whole = ha(lay[kind])
            if abs(sums[kind] - whole) > max(0.5, 0.001 * whole):
                die("%s %s: the parishes add to %.1f ha, the municipality is %.1f ha"
                    % (dtcc, kind, sums[kind], whole))

    out["generated"] = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    out["crs"] = "EPSG:3763 (ETRS89 / Portugal TM06)"
    out["method"] = ("each municipality's own REN/RAN delimitation, dissolved and clipped "
                     "to its own CAOP 2025 boundary; shares are of the unit's land area")
    out["coverage"] = {k: "%d/18" % covered[k] for k in KINDS}
    out["worst_area_gap_pct"] = round(worst_area, 4)
    out["grid_m"] = GRID
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)

    print("constraints: %d municipalities, %d parishes" %
          (len(out["municipios"]), len(out["freguesias"])))
    print("  REN published for %s, RAN for %s" % (out["coverage"]["ren"], out["coverage"]["ran"]))
    print("  worst parish area gap against DGT's own area_ha: %.4f%%" % worst_area)
    print("  wrote %s (%.0f KB)" % (os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
