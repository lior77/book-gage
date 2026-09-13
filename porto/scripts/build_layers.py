#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Package REN and RAN as a per-municipality download, with a manifest.

    python3 scripts/fetch_dgt_ogcapi.py ren_areas ran --out /tmp/srup
    python3 scripts/build_layers.py --src /tmp/srup --out build/layers

WHY THESE ARE NOT IN THE APP.  REN for this district is 36.6 MB of GeoJSON and
RAN is 24.2 MB — 1.56 million vertices between them, against an APK of 840 KB.
A single REN polygon for Amarante carries 125,153 of those vertices, because it
is a legal line that follows a contour, a stream bank and a parcel edge.

WHY IT IS NOT SIMPLIFIED.  Simplifying a line that says "you may not build
here" moves it, and the only question anyone opens this layer to ask is which
side of that line a plot is on. Nothing here touches a coordinate: the polygons
are written exactly as DGT served them, and gzip alone takes the two layers to
22.8 MB. Whatever the display does at a given zoom is the display's business —
a screen cannot draw finer than a pixel — but what is stored is the source.

WHY PER MUNICIPALITY.  DGT publishes REN and RAN municipality by municipality,
each delimited by its own Resolução do Conselho de Ministros with its own date,
and a reader is looking at one municipality at a time. So the download unit is
one municipality: 0.26 MB for Póvoa de Varzim, 3.05 MB for Felgueiras, instead
of 22.8 MB before anything can be drawn. It also keeps the reference year
honest — these range from 1995 to 2026 and there is no single year for "REN".

WHAT IS NOT HERE.  Fire hazard (perigosidade de incêndio rural) is excluded,
and not for size: its serv_data is the date of the law that ordered the map
rather than the year the map was drawn, so it has no reference year and the
first rule of the accuracy contract refuses it. Porto has no REN and no RAN in
this collection, and Vila do Conde no REN. The reason is not published, so
none is given here.
"""
import argparse
import gzip
import hashlib
import json
import os
import sys
import unicodedata
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# The layer key, the file fetch_dgt_ogcapi writes, and how a feature says which
# municipality it belongs to. REN carries the four-digit code; RAN carries only
# the name, so the two are selected differently and neither is assumed.
LAYERS = {
    "ren": ("ren_areas.geojson", "dtcc",
            "REN — Reserva Ecológica Nacional",
            "רשת העתודה האקולוגית הלאומית"),
    "ran": ("ran.geojson", "municipio",
            "RAN — Reserva Agrícola Nacional",
            "עתודת הקרקע החקלאית הלאומית"),
}


def fold(s):
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).upper().strip()


def vertices(geom):
    n = 0
    depth = {"Polygon": 2, "MultiPolygon": 3,
             "LineString": 1, "MultiLineString": 2}.get(geom["type"])
    if depth is None:
        return 0

    def walk(c, d):
        nonlocal n
        if d == 0:
            n += 1
            return
        for x in c:
            walk(x, d - 1)
    walk(geom["coordinates"], depth)
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/tmp/srup")
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "layers"))
    ap.add_argument("--version", default="1")
    args = ap.parse_args()

    mun = json.load(open(os.path.join(ROOT, "data", "processed", "municipios.json"),
                         encoding="utf-8"))["items"]
    by_fold = {fold(m["pt"]): m for m in mun}
    by_code = {m["dicofre"]: m for m in mun}

    manifest = {
        "version": args.version,
        # Where the app fetches from, and the reason it is not a GitHub
        # release asset. A release download sends no Access-Control-Allow-Origin
        # header at all — checked, not assumed — so a fetch() from the app is
        # blocked by CORS everywhere it runs: the APK's WebView loads from
        # file://, the standalone build from wherever it was saved, and neither
        # is github.com. raw.githubusercontent.com and jsDelivr both send
        # "access-control-allow-origin: *", so the files live in the repository
        # and are served from a CDN that will let a page read them.
        "base": ("https://cdn.jsdelivr.net/gh/lior77/book-gage@"
                 "claude/mobile-app-pdf-knowledge-aoomsp/porto/data/layers/"),
        "fallback": ("https://raw.githubusercontent.com/lior77/book-gage/"
                     "claude/mobile-app-pdf-knowledge-aoomsp/porto/data/layers/"),
        "layers": {},
    }
    for key, (fname, how, title_en, title_he) in LAYERS.items():
        path = os.path.join(args.src, fname)
        if not os.path.exists(path):
            sys.exit("missing %s — run fetch_dgt_ogcapi.py ren_areas ran first" % path)
        doc = json.load(open(path, encoding="utf-8"))

        per = defaultdict(list)
        for f in doc["features"]:
            p = f["properties"]
            if how == "dtcc":
                code = str(p.get("dtcc") or "")
                m = by_code.get(code) if code.startswith("13") else None
            else:
                m = by_fold.get(fold(p.get("municipio")))
            if m:
                per[m["dicofre"]].append(f)

        # Flat names: a GitHub release asset has no directories, and the
        # file the app asks for must be the file the release holds.
        outdir = args.out
        os.makedirs(outdir, exist_ok=True)
        entries = {}
        for code, feats in sorted(per.items()):
            body = json.dumps({"type": "FeatureCollection", "features": feats},
                              ensure_ascii=False, separators=(",", ":")).encode()
            blob = gzip.compress(body, 9)
            asset = "%s-%s.geojson.gz" % (key, code)
            dest = os.path.join(outdir, asset)
            with open(dest, "wb") as fh:
                fh.write(blob)
            years = sorted({str(f["properties"].get("serv_data"))[:4]
                            for f in feats if f["properties"].get("serv_data")})
            laws = sorted({f["properties"].get("serv_lei") for f in feats
                           if f["properties"].get("serv_lei")})
            urls = sorted({f["properties"].get("serv_hiperligacao") for f in feats
                           if f["properties"].get("serv_hiperligacao")})
            entries[code] = {
                "asset": asset,
                "municipio": by_code[code]["pt"],
                "bytes": len(blob),
                "raw_bytes": len(body),
                "sha256": hashlib.sha256(blob).hexdigest(),
                "features": len(feats),
                "vertices": sum(vertices(f["geometry"]) for f in feats),
                # One year per municipality, because that is how it is
                # delimited. A layer-wide "reference year" would be a number
                # nobody published.
                "reference_year": years[-1] if years else None,
                "years": years,
                "law": laws,
                "url": urls[0] if urls else None,
            }
            if not years:
                sys.exit("%s %s has no serv_data — without a reference year it "
                         "does not publish" % (key, code))

        missing = [m["pt"] for m in mun if m["dicofre"] not in entries]
        manifest["layers"][key] = {
            "title_en": title_en,
            "title_he": title_he,
            "source": "Direção-Geral do Território (DGT), OGC API Features — CC BY 4.0",
            "licence": "CC BY 4.0",
            "municipalities": entries,
            # said, not explained: DGT does not publish why
            "not_published_for": sorted(missing),
            "total_bytes": sum(e["bytes"] for e in entries.values()),
        }
        print("%-4s %2d municipalities  %6.1f MB gzipped  %9d vertices   "
              "not published for: %s"
              % (key, len(entries),
                 manifest["layers"][key]["total_bytes"] / 1e6,
                 sum(e["vertices"] for e in entries.values()),
                 ", ".join(missing) or "—"))

    dest = os.path.join(args.out, "manifest.json")
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print("wrote %s  (%.1f KB)" % (dest, os.path.getsize(dest) / 1024.0))
    total = sum(l["total_bytes"] for l in manifest["layers"].values())
    print("package total: %.1f MB" % (total / 1e6))
    return 0


if __name__ == "__main__":
    sys.exit(main())
