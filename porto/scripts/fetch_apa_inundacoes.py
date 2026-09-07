#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download APA's flood-zone mapping — the Floods Directive layers.

    python3 scripts/fetch_apa_inundacoes.py

Where these come from, and why not from the obvious place
---------------------------------------------------------
`sniamb.apambiente.pt` is a portal and holds no data.  The ArcGIS server
behind it, `sniambgeoext.apambiente.pt`, lists its folders but answers 403 to
every individual service, and `geo2`/`sig.apambiente.pt` are refused at
CONNECT by the environment's network policy.

dados.gov.pt, the national open-data portal, carries APA's own datasets with
direct file links on `sniambgeoviewer.apambiente.pt`, and those download.  So
the route is: ask dados.gov.pt for the dataset, take the URL it publishes,
fetch the file.  The `--resolve` flag re-runs that lookup and prints what the
portal currently advertises, in case APA moves the files.

What arrives
------------
`Limite da área de inundação` — the flood extent, one shapefile per return
period (20, 100, 1000 years), the 2nd cycle of Directive 2007/60/CE.  23
areas of potentially significant flood risk nationally, of which Porto is
one.  EPSG:3763, which is the CRS this project works in.

Depth and velocity are published as GeoPackages covering every return period
in one file, and they are enormous — 1.27 GB and 1.09 GB zipped.  They are
not fetched by default; pass --with-depth-velocity when you actually want
them, and do not expect to keep them in the repository.

⚠️ The `id` attribute is not a reliable return period.  In the T100 file the
Porto polygon carries id=20 while its geometry is the T100 one — its area
sits between the T20 and T1000 polygons, as it must.  Read the return period
off the file, never off the field.
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

UA = "porto-district-app/1.0 (https://github.com/lior77/book-gage)"
PORTAL = "https://dados.gov.pt/api/1/datasets/"
GEODOCS = "https://sniambgeoviewer.apambiente.pt/Geodocs"

# name -> (path under Geodocs, what it is)
FILES = {
    "apa_zonas_inundaveis_T020_limite.zip": (
        "shpzips/D312_APA_AI_T020_Limite_PC.zip",
        "flood extent, 20-year return period"),
    "apa_zonas_inundaveis_T100_limite.zip": (
        "shpzips/D312_APA_AI_T100_Limite_PC.zip",
        "flood extent, 100-year return period"),
    "apa_zonas_inundaveis_T1000_limite.zip": (
        "shpzips/D312_APA_AI_T1000_Limite_PC.zip",
        "flood extent, 1000-year return period"),
}

# Same source, all return periods in one GeoPackage, and over a gigabyte each.
BIG = {
    "apa_zonas_inundaveis_profundidade.gpkg.zip": (
        "gpkgzips/d312_apa_ai_2c_profundidade_pc_gpkg.zip",
        "inundation depth, all return periods (1.27 GB)"),
    "apa_zonas_inundaveis_velocidade.gpkg.zip": (
        "gpkgzips/d312_apa_ai_2c_velocidade_pc_gpkg.zip",
        "flow velocity, all return periods (1.09 GB)"),
}


def fetch(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as fh:
        fh.write(r.read())


def resolve():
    """Print what dados.gov.pt currently advertises for these datasets."""
    q = urllib.parse.urlencode(
        {"q": "Carta de zonas inundáveis Portugal continental", "page_size": 40})
    req = urllib.request.Request(PORTAL + "?" + q, headers={
        "User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        payload = json.loads(r.read().decode("utf-8"))
    for ds in payload.get("data", []):
        title = ds.get("title", "")
        if "inundáveis" not in title.lower():
            continue
        print("\n%s" % title)
        print("  %s" % ds.get("page"))
        for res in ds.get("resources") or []:
            print("  [%-4s] %s" % (res.get("format"), res.get("url")))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "raw", "apa"))
    ap.add_argument("--resolve", action="store_true",
                    help="print what dados.gov.pt advertises and exit")
    ap.add_argument("--with-depth-velocity", action="store_true",
                    help="also fetch the depth and velocity GeoPackages, "
                         "which are over a gigabyte each")
    args = ap.parse_args()

    if args.resolve:
        return resolve()

    os.makedirs(args.out, exist_ok=True)
    wanted = dict(FILES)
    if args.with_depth_velocity:
        wanted.update(BIG)

    report = []
    for name, (path, what) in sorted(wanted.items()):
        url = "%s/%s" % (GEODOCS, path)
        dest = os.path.join(args.out, name)
        print("%-44s %s" % (name, what))
        try:
            fetch(url, dest)
        except Exception as exc:      # noqa: BLE001 - report and carry on
            print("   ! %s" % str(exc)[:90])
            report.append({"file": name, "url": url, "error": str(exc)[:200]})
            continue
        with open(dest, "rb") as fh:
            digest = hashlib.sha256(fh.read()).hexdigest()
        size = os.path.getsize(dest)
        print("   -> %.1f MB, sha256 %s" % (size / 1e6, digest[:16]))
        report.append({
            "file": name, "description": what, "url": url,
            "source_org": "Agência Portuguesa do Ambiente",
            "found_via": "https://dados.gov.pt",
            "crs": "EPSG:3763 (ETRS_1989_Portugal_TM06)",
            "downloaded": date.today().isoformat(),
            "bytes": size, "sha256": digest,
        })

    path = os.path.join(args.out, "fetch_report.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print("\nwrote %s" % path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
