#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the flood layer from APA's Carta de Zonas Inundáveis.

    python3 scripts/build_floods.py

WHAT THIS DATA IS, AND THE ONE THING THAT MATTERS ABOUT IT.

APA maps flood extent for three return periods — 20, 100 and 1000 years — but
NOT across the country.  It maps them inside 23 named study areas, the ARPSI
(Áreas de Risco Potencial Significativo de Inundação) designated under the
2nd cycle of Directive 2007/60/EC.  The other 22 are Monchique, Coimbra,
Aveiro, Tejo, Chaves and so on; exactly one of them is called "Porto".

So for this district the mapped area is that single ARPSI, and it touches
three municipalities out of eighteen:

    Porto              6.369% of its area
    Vila Nova de Gaia  1.810%
    Gondomar           0.002%

The remaining fifteen have NO mapped flood zone, and that is the trap this
whole file exists to avoid.  A reader looking at Amarante or Baião — both on
the Tâmega, both with a real river — would see an empty map and read it as
"no flood risk here".  It means "APA did not designate this as a study area".
Those are different statements, and the second one is the only one the source
supports.  Hence `coverage` below, and hence the app says out loud, on every
municipality that has no polygon, that nothing was mapped rather than showing
a blank.

WHAT IS NOT DONE HERE.  No simplification: the same reason as REN and RAN —
a line that says "this floods" is not a line to move for a few kilobytes.  No
clipping to the district boundary either; the ARPSI is kept as APA drew it,
even where it runs a little past the district edge, because clipping is an
edit.  No areas, percentages or risk classes are derived beyond the coverage
figures above, which are the share of each municipality the widest return
period overlaps and are marked as computed here, not published by APA.

A SOURCE ANOMALY, PRESERVED.  In D312_APA_AI_T100_Limite_PC the Porto record
carries id=20 where every other record in that file carries id=100.  The
return period here comes from the file, not from that field, so the anomaly
changes nothing — but it is recorded rather than tidied away.
"""
import datetime
import io
import json
import os
import sys
import zipfile

import shapefile
from shapely.geometry import shape, mapping
from shapely.ops import transform
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw", "apa")
OUT = os.path.join(ROOT, "data", "processed", "boundaries_floods.geojson")
CAOP = os.path.join(ROOT, "data", "raw", "dgt", "caop_municipios.geojson")

ARPSI = "Porto"                      # the one study area in this district
PERIODS = (("T020", 20), ("T100", 100), ("T1000", 1000))
TO4326 = Transformer.from_crs("EPSG:3763", "EPSG:4326", always_xy=True).transform


def read_arpsi(tag):
    """The named ARPSI polygon out of one return-period shapefile, in WGS84."""
    path = os.path.join(RAW, f"apa_zonas_inundaveis_{tag}_limite.zip")
    z = zipfile.ZipFile(path)
    base = [n for n in z.namelist() if n.lower().endswith(".shp")][0][:-4]
    r = shapefile.Reader(shp=io.BytesIO(z.read(base + ".shp")),
                         dbf=io.BytesIO(z.read(base + ".dbf")),
                         shx=io.BytesIO(z.read(base + ".shx")))
    names = [f[0] for f in r.fields[1:]]
    for sr in r.shapeRecords():
        rec = dict(zip(names, sr.record))
        # the source stores the name latin-1 encoded inside a UTF-8 dbf
        if str(rec["geoapaouro"]).strip() == ARPSI:
            return transform(TO4326, shape(sr.shape.__geo_interface__)), rec
    sys.exit(f"{tag}: no ARPSI named {ARPSI!r} in {os.path.basename(path)}")


def main():
    feats, widest = [], None
    for tag, years in PERIODS:
        geom, rec = read_arpsi(tag)
        if years == 1000:
            widest = geom
        feats.append({
            "type": "Feature",
            "properties": {
                "return_years": years,
                "arpsi": ARPSI,
                # kept exactly as the source wrote them
                "src_id": str(rec["id"]).strip(),
                "src_area_m2": float(rec["st_area_sh"]),
                "src_file": f"D312_APA_AI_{tag}_Limite_PC.shp",
            },
            "geometry": mapping(geom),
        })
        print(f"  {tag:6s} {years:>4}-year  {float(rec['st_area_sh'])/1e6:6.3f} km² "
              f"(source attribute)   src_id={str(rec['id']).strip()}")

    # Which municipalities the widest return period touches, and by how much.
    # Computed here, not published by APA — the app labels it as such.
    mun = json.load(io.open(CAOP, encoding="utf-8"))
    coverage = {}
    for f in mun["features"]:
        g = shape(f["geometry"])
        if not g.intersects(widest):
            continue
        p = f["properties"]
        # dtmn is CAOP's four-digit municipality code, the same value the app
        # carries as `dicofre` — key on it so a rename never breaks the lookup
        code = str(p.get("dtmn") or "").strip()
        if not code:
            sys.exit(f"CAOP municipality has no dtmn: {sorted(p)[:8]}")
        pct = g.intersection(widest).area / g.area * 100
        coverage[code] = {"municipio": p.get("municipio", ""),
                          "pct_of_municipality": round(pct, 3)}

    out = {
        "type": "FeatureCollection",
        "generated": datetime.date.today().isoformat(),
        "source": "APA — Agência Portuguesa do Ambiente, Carta de zonas inundáveis, "
                  "2.º Ciclo da Diretiva 2007/60/CE",
        "source_url": "https://sniambgeoviewer.apambiente.pt/Geodocs/shpzips/",
        "reference_year": 2023,
        "crs_source": "EPSG:3763",
        "arpsi": ARPSI,
        "arpsi_total_national": 23,
        "coverage_note": ("APA maps flood extent only inside the 23 designated ARPSI "
                          "study areas. One of them is Porto. Municipalities absent "
                          "from `coverage` were not mapped — which is not a finding "
                          "that they do not flood."),
        "coverage": coverage,
        "features": feats,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False) + "\n")

    print(f"\n  mapped municipalities: {len(coverage)} of 18")
    for code, c in sorted(coverage.items(), key=lambda x: -x[1]["pct_of_municipality"]):
        print(f"    {code:>6}  {c['municipio']:<20} {c['pct_of_municipality']:>7.3f}%")
    print(f"  {18 - len(coverage)} municipalities have no mapped flood zone at all")
    print(f"\n  wrote {os.path.relpath(OUT, ROOT)}  ({os.path.getsize(OUT):,} bytes)")


if __name__ == "__main__":
    main()
