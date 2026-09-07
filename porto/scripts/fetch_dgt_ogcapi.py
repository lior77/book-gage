#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download DGT collections from their OGC API, paging until the server stops.

    python3 scripts/fetch_dgt_ogcapi.py --list
    python3 scripts/fetch_dgt_ogcapi.py caop_freguesias caop_municipios
    python3 scripts/fetch_dgt_ogcapi.py --all --out data/raw/dgt

DGT publishes CAOP 2025 and the whole SRUP register (REN, RAN, fire hazard,
Natura 2000, protected areas) as OGC API Features at ogcapi.dgterritorio.gov.pt.
That is the same data the SNIT/SRUP portal serves, reachable when snit. is not,
and it comes back as GeoJSON with the Diário da República reference already on
each polygon — which is exactly what docs/DATA-REQUEST.md asks for REN.

It also carries CRUS, which settles the assumption in DATA-REQUEST.md item 7
that municipal plans have no national repository: they do.  Every polygon
keeps `designacao_no_plano`, the wording of the municipality's own plan, next
to DGT's harmonised `classe_2021`/`categoria_2021`, plus the scale it was
drawn at, the plan's publication date and whether it is still in force.  The
warning in that item still stands and the field layout is what makes it
keepable — the municipal wording is the data, and the harmonised class is
DGT's reading of it, not a substitute for reading the regulation.

Every layer is written whole, as the server returns it, with no reprojection,
no simplification and no field renaming.  A `_fetch` block is added to the
FeatureCollection recording the request that produced it.
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, timezone, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

BASE = "https://ogcapi.dgterritorio.gov.pt"
UA = "porto-district-app/1.0 (https://github.com/lior77/book-gage)"

# The district, generously bounded, in CRS84.  Layers with national coverage
# and fine geometry are cut to it; the administrative layers are not, because
# they carry a distrito_ilha field that selects the district exactly.
BBOX = "-8.79,41.00,-7.87,41.48"

CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84"
PTTM06 = "http://www.opengis.net/def/crs/EPSG/0/3763"

# name -> (collection, extra query, what it is)
LAYERS = {
    "caop_freguesias": (
        "freguesias", {"distrito_ilha": "Porto"},
        "CAOP2025 — the 275 freguesias of Porto district, with DICOFRE"),
    "caop_municipios": (
        "municipios", {"distrito_ilha": "Porto"},
        "CAOP2025 — the 18 municipalities of Porto district"),
    "ren_areas": (
        "srup_ren_areal", {"bbox": BBOX},
        "REN, Reserva Ecológica Nacional — areas, with the DR publication"),
    "ren_linhas": (
        "srup_ren_linear", {"bbox": BBOX},
        "REN — linear features"),
    "ran": (
        "srup_ran", {"bbox": BBOX},
        "RAN, Reserva Agrícola Nacional, with the DR publication"),
    "perigosidade_incendio": (
        "srup_perigosidade_inc_rural", {"bbox": BBOX},
        "Carta de Perigosidade de Incêndio Rural — five classes in `tipologia`"),
    "areas_protegidas": (
        "srup_areas_protegidas", {"bbox": BBOX},
        "Protected areas"),
    "natura_zec": (
        "srup_zec", {"bbox": BBOX},
        "Rede Natura 2000 — Zonas Especiais de Conservação"),
    "natura_zpe": (
        "srup_zpe", {"bbox": BBOX},
        "Rede Natura 2000 — Zonas de Proteção Especial"),
    "albufeiras": (
        "srup_albufeiras", {"bbox": BBOX},
        "Classified public-water reservoirs"),
    "aquiferos": (
        "srup_aquiferos", {"bbox": BBOX},
        "Groundwater abstraction for public supply"),
}

PAGE = 500

# CRUS is handled separately, one municipality at a time — see fetch_crus.
# The 18 DICO codes of district 13, in the numbering CRUS uses in `dtcc`.
CRUS_MUNICIPIOS = {
    "1301": "amarante", "1302": "baiao", "1303": "felgueiras",
    "1304": "gondomar", "1305": "lousada", "1306": "maia",
    "1307": "marco_de_canaveses", "1308": "matosinhos",
    "1309": "pacos_de_ferreira", "1310": "paredes", "1311": "penafiel",
    "1312": "porto", "1313": "povoa_de_varzim", "1314": "santo_tirso",
    "1315": "valongo", "1316": "vila_do_conde", "1317": "vila_nova_de_gaia",
    "1318": "trofa",
}


def get(url, tries=8):
    """One GET, retried patiently.

    The server answers 500 in bursts under sustained paging — the same URL
    that failed a minute ago succeeds later — so the backoff climbs to
    minutes rather than treating a 500 as a verdict.
    """
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept": "application/geo+json, application/json"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as exc:      # noqa: BLE001
            last = exc
            if attempt < tries - 1:
                time.sleep(min(120, 5 * 2 ** attempt))
    raise SystemExit("giving up on %s\n  %s" % (url, last))


def fetch_layer(name, outdir, crs=CRS84):
    collection, extra, what = LAYERS[name]
    per_page = PAGE
    query = dict(extra)
    query.update({"f": "json", "limit": str(per_page), "crs": crs})

    features, offset, matched = [], 0, None
    while True:
        query["offset"] = str(offset)
        url = "%s/collections/%s/items?%s" % (
            BASE, collection, urllib.parse.urlencode(query))
        page = get(url)
        if matched is None:
            matched = page.get("numberMatched")
            print("%-24s %s" % (name, what))
            print("   collection %s, %s features" % (collection, matched))
        got = page.get("features") or []
        features.extend(got)
        sys.stdout.write("\r   %d/%s" % (len(features), matched))
        sys.stdout.flush()
        if len(got) < per_page:
            break
        offset += per_page
    print()

    if matched is not None and len(features) != matched:
        print("   ! server said %s features, got %d" % (matched, len(features)))

    doc = {
        "type": "FeatureCollection",
        "_fetch": {
            "collection": collection,
            "source": "DGT OGC API Features, %s" % BASE,
            "request": "%s/collections/%s/items?%s" % (
                BASE, collection, urllib.parse.urlencode(
                    {k: v for k, v in query.items() if k != "offset"})),
            "crs": crs,
            "filter": {k: v for k, v in extra.items()},
            "downloaded": date.today().isoformat(),
            "server_numberMatched": matched,
            "features_written": len(features),
            "licence": "CC BY 4.0 — Direção-Geral do Território",
        },
        "features": features,
    }
    path = os.path.join(outdir, "%s.geojson" % name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False)
    size = os.path.getsize(path)
    with open(path, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    print("   -> %s  (%.1f MB, sha256 %s)" % (path, size / 1e6, digest[:16]))
    return {"layer": name, "file": os.path.basename(path),
            "collection": collection, "features": len(features),
            "bytes": size, "sha256": digest, "crs": crs,
            "request": doc["_fetch"]["request"], "description": what}


def fetch_crus(outdir, crs=CRS84):
    """CRUS, one municipality at a time — `pdm_<municipio>.gpkg`, in effect.

    A bbox query against this collection answers 500 far more often than it
    answers data, while the same request filtered on `dtcc` comes back.  One
    file per municipality is also what DATA-REQUEST.md item 7 asks for, and
    for the reason it gives: the classes are not comparable between
    municipalities, so they must not end up in one merged layer.
    """
    written, failed = [], []
    for dtcc, slug in sorted(CRUS_MUNICIPIOS.items()):
        path = os.path.join(outdir, "crus_%s.geojson" % slug)
        if os.path.exists(path):
            print("   %-4s %-20s already here, skipping" % (dtcc, slug))
            continue
        features, offset, matched = [], 0, None
        try:
            while True:
                query = {"f": "json", "limit": str(PAGE), "crs": crs,
                         "dtcc": dtcc, "offset": str(offset)}
                page = get("%s/collections/crus/items?%s"
                           % (BASE, urllib.parse.urlencode(query)))
                if matched is None:
                    matched = page.get("numberMatched")
                got = page.get("features") or []
                features.extend(got)
                if len(got) < PAGE:
                    break
                offset += PAGE
        except SystemExit as exc:
            # One municipality the server will not serve today is not a reason
            # to throw away the seventeen it will.  Re-running picks it up.
            print("   %-4s %-20s FAILED: %s" % (dtcc, slug, str(exc)[:70]))
            failed.append(slug)
            continue
        doc = {
            "type": "FeatureCollection",
            "_fetch": {
                "collection": "crus",
                "source": "DGT OGC API Features, %s" % BASE,
                "request": "%s/collections/crus/items?dtcc=%s&f=json&limit=%d&crs=%s"
                           % (BASE, dtcc, PAGE, crs),
                "crs": crs,
                "filter": {"dtcc": dtcc},
                "downloaded": date.today().isoformat(),
                "server_numberMatched": matched,
                "features_written": len(features),
                "licence": "CC BY 4.0 — Direção-Geral do Território",
                "note": "Classes are not comparable between municipalities; "
                        "designacao_no_plano is each plan's own wording.",
            },
            "features": features,
        }
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False)
        size = os.path.getsize(path)
        with open(path, "rb") as fh:
            digest = hashlib.sha256(fh.read()).hexdigest()
        print("   %-4s %-20s %5d/%-5s  %6.1f MB  %s"
              % (dtcc, slug, len(features), matched, size / 1e6, digest[:12]))
        written.append({"layer": "crus_%s" % slug,
                        "file": os.path.basename(path), "collection": "crus",
                        "features": len(features), "bytes": size,
                        "sha256": digest, "crs": crs,
                        "request": doc["_fetch"]["request"],
                        "description": "CRUS, %s" % slug})
    if failed:
        print("   %d municipality/ies did not come down: %s"
              % (len(failed), ", ".join(failed)))
        print("   re-run the same command; what is already written is skipped")
    return written


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("layers", nargs="*", default=[],
                    help="layers to fetch (see --list); default is all of them")
    ap.add_argument("--list", action="store_true",
                    help="print the layer table and exit")
    ap.add_argument("--crs", default=CRS84,
                    help="CRS84 (default) or %s" % PTTM06)
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "raw", "dgt"))
    args = ap.parse_args()

    if args.list:
        for name, (coll, extra, what) in sorted(LAYERS.items()):
            print("%-24s %-32s %s" % (name, coll, what))
        print("%-24s %-32s %s" % ("crus", "crus",
              "land-use regime, one file per municipality (18 of them)"))
        return 0

    names = args.layers or sorted(LAYERS)
    unknown = [n for n in names if n not in LAYERS and n != "crus"]
    if unknown:
        raise SystemExit("unknown layer(s): %s\nrun --list to see them all"
                         % ", ".join(unknown))
    os.makedirs(args.out, exist_ok=True)
    report = []
    for n in names:
        if n == "crus":
            print("crus                     CRUS, one municipality at a time")
            report.extend(fetch_crus(args.out, args.crs))
        else:
            report.append(fetch_layer(n, args.out, args.crs))
    path = os.path.join(args.out, "fetch_report.json")
    existing = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            existing = json.load(fh)
    keep = [r for r in existing if r["layer"] not in {r2["layer"] for r2 in report}]
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(keep + report, fh, ensure_ascii=False, indent=2)
    print("\nwrote %s" % path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
