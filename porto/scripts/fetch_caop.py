#!/usr/bin/env python3
"""Extract the Porto district (18 municipalities, 243 freguesias) out of the
national CAOP 2020 GeoJSON, and write the raw subset to data/raw/.

Source
------
CAOP = Carta Administrativa Oficial de Portugal, Direcao-Geral do Territorio
(DGT), 2020 edition, open data.  The npm package `@cartography/pt` republishes
the DGT WFS download re-projected to WGS84 GeoJSON, which is what we consume
here because it is reachable from a network-restricted environment.

    https://www.npmjs.com/package/@cartography/pt   (version 0.0.6)
    original: http://mapas.dgterritorio.pt/ATOM-download/CAOP-Cont/Cont_AAD_CAOP2020.zip

The national parish layer carries names but no DICOFRE code for mainland
parishes, so parishes are assigned to a municipality by point-in-polygon of
their representative point against the municipality polygon.  The result is
verified against the expected count of 243 parishes for the district.

Usage
-----
    python3 scripts/fetch_caop.py                 # downloads the tarball
    python3 scripts/fetch_caop.py path/to/pt.tgz  # uses a local copy
"""
import io
import json
import os
import sys
import tarfile
import urllib.request
from datetime import date

from shapely.geometry import shape, mapping

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw")

TARBALL = "https://registry.npmjs.org/@cartography/pt/-/pt-0.0.6.tgz"

# Municipality numbering used throughout the PDF and this app (1-18).
MUNICIPALITIES = [
    "Porto", "Vila Nova de Gaia", "Matosinhos", "Maia", "Gondomar", "Valongo",
    "Vila do Conde", "Póvoa de Varzim", "Santo Tirso", "Trofa", "Paredes",
    "Penafiel", "Paços de Ferreira", "Lousada", "Felgueiras", "Amarante",
    "Marco de Canaveses", "Baião",
]

# Expected parish counts, from the PDF project's own tally (243 in total).
EXPECTED = {
    "Porto": 7, "Vila Nova de Gaia": 15, "Matosinhos": 4, "Maia": 10,
    "Gondomar": 7, "Valongo": 4, "Vila do Conde": 21, "Póvoa de Varzim": 7,
    "Santo Tirso": 14, "Trofa": 5, "Paredes": 18, "Penafiel": 28,
    "Paços de Ferreira": 12, "Lousada": 15, "Felgueiras": 20, "Amarante": 26,
    "Marco de Canaveses": 16, "Baião": 14,
}


def load_tarball(src):
    if src and os.path.exists(src):
        data = open(src, "rb").read()
    else:
        print("downloading", TARBALL)
        data = urllib.request.urlopen(TARBALL, timeout=300).read()
    tf = tarfile.open(fileobj=io.BytesIO(data), mode="r:gz")
    out = {}
    for name in ("package/dist/municipalities.json", "package/dist/parishes.json"):
        out[name.rsplit("/", 1)[1][:-5]] = json.load(tf.extractfile(name))
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    blobs = load_tarball(src)

    mgeom, mfeat = {}, {}
    for ft in blobs["municipalities"]["features"]:
        name = ft["properties"]["name"]
        if name in MUNICIPALITIES:
            mgeom[name] = shape(ft["geometry"]).buffer(0)
            mfeat[name] = ft
    missing = set(MUNICIPALITIES) - set(mgeom)
    if missing:
        sys.exit("municipalities not found in CAOP: %s" % sorted(missing))

    # A parish can appear as several features (islands, exclaves); merge by name.
    parts = {}
    for ft in blobs["parishes"]["features"]:
        g = shape(ft["geometry"])
        pt = g.representative_point()
        for name, mg in mgeom.items():
            if mg.contains(pt):
                parts.setdefault((name, ft["properties"]["name"]), []).append(ft["geometry"])
                break

    counts = {}
    for (mun, _fre) in parts:
        counts[mun] = counts.get(mun, 0) + 1
    bad = {m: (counts.get(m, 0), EXPECTED[m]) for m in MUNICIPALITIES
           if counts.get(m, 0) != EXPECTED[m]}
    if bad:
        sys.exit("parish count mismatch (got, expected): %s" % bad)

    mun_fc = {"type": "FeatureCollection",
              "meta": {"source": "DGT CAOP 2020 via npm @cartography/pt@0.0.6",
                       "crs": "EPSG:4326", "retrieved": date.today().isoformat()},
              "features": []}
    for i, name in enumerate(MUNICIPALITIES, 1):
        ft = dict(mfeat[name])
        ft["properties"] = {"num": i, "name": name, "level": "municipio"}
        mun_fc["features"].append(ft)

    fre_fc = {"type": "FeatureCollection",
              "meta": dict(mun_fc["meta"]),
              "features": []}
    for i, name in enumerate(MUNICIPALITIES, 1):
        for (mun, fre), geoms in sorted(parts.items()):
            if mun != name:
                continue
            merged = shape(geoms[0]) if len(geoms) == 1 else \
                shape({"type": "GeometryCollection", "geometries": geoms}).buffer(0)
            fre_fc["features"].append({
                "type": "Feature",
                "properties": {"mun_num": i, "mun": mun, "name": fre,
                               "level": "freguesia"},
                "geometry": mapping(merged),
            })

    os.makedirs(RAW, exist_ok=True)
    for fname, fc in (("caop2020_porto_municipios.geojson", mun_fc),
                      ("caop2020_porto_freguesias.geojson", fre_fc)):
        path = os.path.join(RAW, fname)
        with open(path, "w") as fh:
            json.dump(fc, fh, ensure_ascii=False)
        print("wrote %-42s %d features  %.1f MB"
              % (fname, len(fc["features"]), os.path.getsize(path) / 1e6))


if __name__ == "__main__":
    main()
