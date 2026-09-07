#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Give every parish its official DICOFRE code.

    python3 scripts/ingest_freguesia_codes.py

Reads:
    data/raw/freguesia_codes.geojson        Overpass query 09 — every
        admin_level=8 relation in the district bbox that carries ref:ine,
        as a centre point.  The relations are tagged source=DGT - CAOP,
        so ref:ine is the code DGT and INE publish, not an OSM invention.
    data/raw/caop2020_porto_freguesias.geojson   the 243 parishes the app draws

Writes:
    data/raw/freguesia_official_codes.json

WHAT DICOFRE IS
===============
Six digits: district (13 = Porto), municipality inside the district, parish
inside the municipality.  131430 is district 13, municipality 14 (Santo Tirso),
parish 30.  Every official form, every INE table and every CAOP layer uses it.

WHY 25 OF THE 243 PARISHES GET NO SINGLE CODE
=============================================
The app's boundaries are CAOP 2020, which is the 2013 parish map.  In 2025
Portugal undid part of the 2013 mergers: 25 of the district's `União das
freguesias` were split back into 57 separate parishes, each with a new code,
and the code of the union itself was retired.  Those 25 units therefore have
successors rather than a code.  The successors are listed, so the app can say
so instead of printing a number that no longer exists.

HOW A UNIT IS MATCHED TO A CODE
===============================
Name first, geometry second, and never both wrong quietly:

  1. A parish whose name matches a relation that existed before 2025 keeps
     that relation's code.  Names are compared with the union prefix stripped,
     accents folded.
  2. A parish still unmatched, with exactly one unmatched pre-2025 relation
     inside its polygon, takes that code.  This catches CAOP and OSM spelling
     the same parish differently (Negrelos).
  3. Whatever is left was touched by the 2025 reform.  Its successors are the
     relations created in 2025 whose centre falls inside it.

Overpass `out center` returns the centre of the bounding box, not a point
guaranteed to be inside the polygon, so step 2 is a fallback and never the
primary test — two parishes in Maia and Baião have a bbox centre that lands
in the neighbour.
"""
import collections
import json
import os
import re
import sys
import unicodedata

from shapely.geometry import shape, Point
from shapely.prepared import prep

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw")

DISTRICT = "13"          # Porto
# The municipality half of the code, confirmed against the CAOP polygons: every
# one of the 275 relation centres falls inside the municipality its code names.
# Worth stating because the order is *almost* alphabetical and not quite:
# Paços de Ferreira (09) sorts before Paredes (10) only if ç is read as c, and
# Trofa is 18 because it was created in 1998, after the list was fixed.
MUNICIPALITY = {
    "01": "Amarante", "02": "Baião", "03": "Felgueiras", "04": "Gondomar",
    "05": "Lousada", "06": "Maia", "07": "Marco de Canaveses",
    "08": "Matosinhos", "09": "Paços de Ferreira", "10": "Paredes",
    "11": "Penafiel", "12": "Porto", "13": "Póvoa de Varzim",
    "14": "Santo Tirso", "15": "Valongo", "16": "Vila do Conde",
    "17": "Vila Nova de Gaia", "18": "Trofa",
}


def norm(s):
    """Fold a parish name to something two sources can be compared on."""
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"^uniao (das |de )?freguesias (de |da |do )?", "", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def load(name):
    with open(os.path.join(RAW, name), encoding="utf-8") as fh:
        return json.load(fh)


def main():
    src = load("freguesia_codes.geojson")
    caop = load("caop2020_porto_freguesias.geojson")

    rel = []
    for ft in src["features"]:
        p = ft["properties"]
        code = str(p.get("ref:ine") or "")
        if len(code) != 6 or not code.startswith(DISTRICT):
            continue
        rel.append({
            "dicofre": code,
            "mun": MUNICIPALITY[code[2:4]],
            "code": code[4:],
            "pt": p["name"],
            # start_date is on the relation because the 2025 parishes are new
            # units, not renamed old ones
            "new2025": str(p.get("start_date", "")).startswith("2025"),
            "geom": Point(ft["geometry"]["coordinates"]),
            "taken": False,
        })
    by_mun = collections.defaultdict(list)
    for r in rel:
        by_mun[r["mun"]].append(r)

    out, report = {}, []
    units = []
    for ft in caop["features"]:
        pr = ft["properties"]
        units.append({"mun": pr["mun"], "pt": pr["name"],
                      "key": pr["mun"] + "|" + pr["name"],
                      "geom": prep(shape(ft["geometry"]))})

    # 1 — name match against a relation that is not a 2025 creation
    for u in units:
        for r in by_mun[u["mun"]]:
            if r["taken"] or r["new2025"]:
                continue
            if norm(r["pt"]) == norm(u["pt"]):
                r["taken"] = True
                u["hit"] = r
                break

    # 2 — the one unmatched pre-2025 relation inside the polygon
    for u in units:
        if u.get("hit"):
            continue
        cand = [r for r in by_mun[u["mun"]]
                if not r["taken"] and not r["new2025"] and u["geom"].contains(r["geom"])]
        if len(cand) == 1:
            cand[0]["taken"] = True
            u["hit"] = cand[0]
            report.append("שם שונה בין CAOP ל-OSM, זוהה לפי גאומטריה: "
                          f"{u['key']} ← {cand[0]['dicofre']} {cand[0]['pt']}")

    # 3 — everything left was split in 2025
    for u in units:
        rec = {"mun": u["mun"], "pt": u["pt"]}
        if u.get("hit"):
            rec["code"] = u["hit"]["code"]
            rec["dicofre"] = u["hit"]["dicofre"]
        else:
            kids = sorted((r for r in by_mun[u["mun"]]
                           if r["new2025"] and u["geom"].contains(r["geom"])),
                          key=lambda r: r["code"])
            for k in kids:
                k["taken"] = True
            rec["split2025"] = [{"code": k["code"], "dicofre": k["dicofre"],
                                 "pt": k["pt"]} for k in kids]
        out[u["key"]] = rec

    # ---- audit ----------------------------------------------------------
    coded = [r for r in out.values() if "code" in r]
    split = [r for r in out.values() if "split2025" in r]
    empty = [r for r in split if not r["split2025"]]
    unused = [r for r in rel if not r["taken"]]
    dup = collections.Counter(r["dicofre"] for r in coded)
    dup = [d for d, n in dup.items() if n > 1]

    print(f"רובעים עם קוד רשמי תקף: {len(coded)} מתוך {len(out)}")
    print(f"רובעים שפורקו ב-2025: {len(split)}"
          f" (הפכו ל-{sum(len(r['split2025']) for r in split)} רובעים חדשים)")
    for line in report:
        print("  " + line)
    if dup:
        print("  שגיאה: קוד שמופיע פעמיים:", dup)
    if empty:
        print("  שגיאה: יחידה בלי קוד ובלי יורשים:", [r["pt"] for r in empty])
    if unused:
        print(f"  רלציות OSM שלא שויכו: {len(unused)}")
        for r in unused:
            print(f"      {r['dicofre']} {r['mun']} · {r['pt']}"
                  + (" (2025)" if r["new2025"] else ""))

    with open(os.path.join(RAW, "freguesia_official_codes.json"), "w",
              encoding="utf-8") as fh:
        json.dump({
            "source": "OpenStreetMap ref:ine (relations tagged source=DGT - CAOP)",
            "licence": "ODbL — © OpenStreetMap contributors",
            "district": DISTRICT,
            "municipality_names": MUNICIPALITY,
            "freguesias": out,
        }, fh, ensure_ascii=False, indent=1)
    print("נכתב data/raw/freguesia_official_codes.json")
    return 1 if (dup or empty) else 0


if __name__ == "__main__":
    sys.exit(main())
