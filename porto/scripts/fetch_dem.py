#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Copernicus DEM GLO-30 → elevation and slope per municipality and parish.

    pip install rasterio
    python3 scripts/fetch_dem.py            # downloads what is missing, then measures
    python3 scripts/fetch_dem.py --measure  # measure only, from tiles already on disk

Why this script exists
----------------------
`data/raw/elevation_osm.json` has carried this note since 1.43.0:

    "חסם תחתון בלבד. הנקודה הגבוהה באמת עשויה לא להיות מתויגת.
     המקור הנכון הוא מודל גבהים (Copernicus GLO-30 או SRTM)."

It was never shown in the app, because the highest *tagged* OSM point is not
the highest point — it is a lower bound that depends on who happened to tag a
summit.  This is the source that note names.

Where the data comes from
-------------------------
The Copernicus DEM GLO-30 tiles sit on AWS Open Data with no credentials and
no registration: `copernicus-dem-30m.s3.amazonaws.com`.  The district needs
exactly two of them — N41/W009 and N41/W008 — 81 MB together, because the
whole district fits in lon -8.79..-7.88, lat 41.00..41.47.

⚠️ THIS IS A SURFACE MODEL, NOT BARE EARTH.  The product is a DSM derived
from TanDEM-X radar: buildings and tree canopy are part of the surface it
measures.  In the dense centre of Porto a "ground elevation" read off it
includes the roofs.  That is why every field this writes is `approx` and why
the note says so in both languages.  A bare-earth model for Portugal exists
only as DGT's own LiDAR coverage, which is not published for the whole
district.

⚠️ VERTICAL DATUM IS EGM2008, not the ellipsoid and not the Portuguese
levelling datum (Cascais).  Read off the tile's own metadata, not assumed.

What it writes
--------------
`data/raw/elevation_dem.json` — min/mean/max elevation and mean slope for the
18 municipalities and the 275 parishes.  build.py reads that file, so a build
needs neither rasterio nor the 81 MB of tiles.
"""
import argparse
import json
import math
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PORTO = os.path.dirname(HERE)
RAW = os.path.join(PORTO, "data", "raw")
TILES = os.path.join(RAW, "copernicus")
OUT = os.path.join(RAW, "elevation_dem.json")

BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
# Two tiles cover the district.  Named, not computed from a bounding box, so
# that a boundary edit cannot silently start measuring against a tile that was
# never downloaded — build.py would then read a file with holes in it.
TILE_IDS = ["N41_00_W009", "N41_00_W008"]

# Read from the tile's own ISO 19115 metadata (Copernicus_DSM_10_*.xml), not
# from documentation about it.
PRODUCT = "Copernicus DEM GLO-30 (COP-DEM_GLO-30-F)"
CREATED = "2019-10-18"
ACQUIRED = "TanDEM-X, 2011–2015"
VERTICAL = "WGS 84 / EGM2008 geoid"
# Licence article 6(b) — the notice required of a user who ADAPTS the data,
# which is what computing a statistic per unit is.  Quoted from eula_F.pdf as
# published beside the tiles, not paraphrased.
NOTICE = ("produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and "
          "© Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS "
          "by the European Union and ESA; all rights reserved")


def tile_url(tid):
    d = "Copernicus_DSM_COG_10_%s_00_DEM" % tid
    return "%s/%s/%s.tif" % (BUCKET, d, d)


def tile_path(tid):
    return os.path.join(TILES, "Copernicus_DSM_COG_10_%s_00_DEM.tif" % tid)


def download():
    os.makedirs(TILES, exist_ok=True)
    for tid in TILE_IDS:
        p = tile_path(tid)
        if os.path.exists(p) and os.path.getsize(p) > 1_000_000:
            print("have    %s  (%.1f MB)" % (os.path.basename(p), os.path.getsize(p) / 1e6))
            continue
        url = tile_url(tid)
        print("fetch   %s" % url)
        with urllib.request.urlopen(url, timeout=900) as r, open(p, "wb") as f:
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                f.write(b)
        print("        %.1f MB" % (os.path.getsize(p) / 1e6))


def measure():
    try:
        import numpy as np
        import rasterio
        from rasterio.mask import mask
        from rasterio.merge import merge
    except ImportError:
        sys.exit("needs rasterio: pip install rasterio")

    missing = [t for t in TILE_IDS if not os.path.exists(tile_path(t))]
    if missing:
        sys.exit("tiles missing: %s — run without --measure" % ", ".join(missing))

    srcs = [rasterio.open(tile_path(t)) for t in TILE_IDS]
    grid, tf = merge(srcs)
    nodata = srcs[0].nodata
    for s in srcs:
        s.close()
    grid = grid[0]
    print("mosaic  %d x %d, pixel %.6f°" % (grid.shape[0], grid.shape[1], abs(tf.a)))

    # The mosaic is a plain in-memory array; rasterio.mask wants a dataset, so
    # it is written once to a MemoryFile and every unit is cut from that.
    from rasterio.io import MemoryFile
    prof = dict(driver="GTiff", height=grid.shape[0], width=grid.shape[1], count=1,
                dtype=grid.dtype, crs="EPSG:4326", transform=tf, nodata=nodata)

    def unit_stats(ds, geom):
        try:
            cut, ctf = mask(ds, [geom], crop=True, filled=True, nodata=-32768.0)
        except ValueError:
            return None                      # no overlap at all
        a = cut[0].astype("float64")
        a[a <= -32000] = np.nan
        if nodata is not None:
            a[a == nodata] = np.nan
        ok = ~np.isnan(a)
        if ok.sum() < 4:
            return None
        # Slope needs metric spacing, and a degree of longitude is shorter than
        # a degree of latitude everywhere but the equator.  At 41°N the pixel is
        # about 30.9 m tall and 23.3 m wide, so a single spacing would tilt every
        # east-west slope by a third.
        lat = ctf.f + ctf.e * a.shape[0] / 2.0
        dy = abs(ctf.e) * 111_132.0
        dx = abs(ctf.a) * 111_320.0 * math.cos(math.radians(lat))
        gy, gx = np.gradient(np.where(ok, a, np.nan), dy, dx)
        slope = np.degrees(np.arctan(np.hypot(gx, gy)))
        vals = a[ok]
        sv = slope[np.isfinite(slope)]
        return {
            "min_m": round(float(vals.min()), 1),
            "mean_m": round(float(vals.mean()), 1),
            "max_m": round(float(vals.max()), 1),
            "slope_deg": round(float(sv.mean()), 1) if sv.size else None,
            "px": int(ok.sum()),
        }

    def run(path, key_fn, name_fn):
        gj = json.load(open(path, encoding="utf-8"))
        rows = []
        with MemoryFile() as mf:
            with mf.open(**prof) as ds:
                ds.write(grid, 1)
                for ft in gj["features"]:
                    st = unit_stats(ds, ft["geometry"])
                    if st is None:
                        print("  no pixels: %s" % name_fn(ft["properties"]))
                        continue
                    st["code"] = key_fn(ft["properties"])
                    st["name"] = name_fn(ft["properties"])
                    rows.append(st)
        return rows

    muns = run(os.path.join(RAW, "dgt", "caop_municipios.geojson"),
               lambda p: str(p["dtmn"]), lambda p: p["municipio"])
    fres = run(os.path.join(RAW, "dgt", "caop_freguesias.geojson"),
               lambda p: str(p["dtmnfr"]), lambda p: p["freguesia"])
    print("measured %d municipalities, %d parishes" % (len(muns), len(fres)))

    doc = {
        "meta": {
            "indicator": "elevation (min/mean/max) and mean slope, per unit",
            "source": PRODUCT,
            "product_created": CREATED,
            "acquired": ACQUIRED,
            "resolution_m": 30,
            "vertical_datum": VERTICAL,
            "model": "DSM — surface, includes buildings and canopy; NOT bare earth",
            "licence_notice": NOTICE,
            "url": BUCKET,
            "tiles": TILE_IDS,
            "confidence": "approx",
            "note_he": "מודל פני שטח ברשת של 30 מטר: הוא מודד את מה שנמצא על הקרקע — "
                       "בניינים וצמרות עצים בכלל זה — ולא את הקרקע עצמה.",
            "note_en": "A 30 m surface model: it measures what stands on the ground, "
                       "buildings and tree canopy included, and not the ground itself.",
        },
        "municipios": muns,
        "freguesias": fres,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("wrote   %s  (%.1f KB)" % (os.path.relpath(OUT, PORTO), os.path.getsize(OUT) / 1e3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--measure", action="store_true",
                    help="skip the download, measure from the tiles on disk")
    a = ap.parse_args()
    if not a.measure:
        download()
    measure()


if __name__ == "__main__":
    main()
