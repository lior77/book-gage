#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Give every parish its official DICOFRE code, and say which ones 2025 undid.

    python3 scripts/ingest_freguesia_codes.py

Reads:
    data/raw/censos2021_ine.json            written by import_censos_seccoes.py:
        the 243 parishes of district 13 as INE counted them in 2021, each with
        its DICOFRE. This is the authority on the code.
    data/raw/freguesia_codes.geojson        Overpass query 09 — every
        admin_level=8 relation in the district bbox carrying ref:ine, as a
        centre point. This is the authority on what exists *now*.
    data/raw/caop2020_porto_freguesias.geojson   the 243 parishes the app draws

Writes:
    data/raw/freguesia_official_codes.json

WHAT DICOFRE IS
===============
Six digits: district (13 = Porto), municipality inside the district, parish
inside the municipality. 131430 is district 13, municipality 14 (Santo Tirso),
parish 30. Every official form, every INE table and every CAOP layer uses it.

TWO SOURCES, TWO DIFFERENT QUESTIONS
====================================
INE says what each parish's code was when the census counted it, and it covers
all 243 with no matching to do — the app's boundaries are CAOP 2020, the same
2013 map the 2021 census was taken on, so the two sets are the same set.

OSM says which of those codes still names a parish. In 2025 Portugal undid part
of the 2013 mergers: 25 `União das freguesias` in this district were split back
into 57 separate parishes with new codes, and the union's own code was retired.
A code that INE has and OSM does not is exactly such a unit, and the relations
OSM created in 2025 inside its outline are its successors.

The two agree on every one of the 218 codes they both carry. Where they differ
is in a name: OSM labels relation 131430 `Negrelos (São Mamede)`, while INE and
CAOP both call 131430 `Negrelos (São Tomé)` — São Mamede is part of union
131434. The code is what this file takes, so the wrong label costs nothing.
"""
import collections
import json
import os
import sys

from shapely.geometry import shape, Point
from shapely.prepared import prep

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw")

DISTRICT = "13"

# Three parishes CAOP and INE name differently. Same unit, same outline, and
# in each case the disagreement is a known one rather than a near-miss worth
# resolving by string distance: CAOP prints the name of the town, INE the name
# of the union, or one of them spells Penhalonga as two words.
ALIAS = {
    ("Amarante", "Vila Meã"):
        "União das freguesias de Real, Ataíde e Oliveira",
    ("Marco de Canaveses", "Penha Longa e Paços de Gaiolo"):
        "Penhalonga e Paços de Gaiolo",
    ("Santo Tirso", "Vila Nova do Campo"):
        "União das freguesias de Campo (São Martinho), São Salvador do Campo "
        "e Negrelos (São Mamede)",
}


def load(name):
    with open(os.path.join(RAW, name), encoding="utf-8") as fh:
        return json.load(fh)


def main():
    ine = load("censos2021_ine.json")["freguesias"]
    caop = load("caop2020_porto_freguesias.geojson")
    src = load("freguesia_codes.geojson")

    code_of = {(f["mun_name"], f["name"]): code for code, f in ine.items()}

    # what OSM says exists now, and what it created in 2025
    current, new2025 = set(), []
    for ft in src["features"]:
        p = ft["properties"]
        code = str(p.get("ref:ine") or "")
        if len(code) != 6 or not code.startswith(DISTRICT):
            continue
        current.add(code)
        if str(p.get("start_date", "")).startswith("2025"):
            new2025.append({"code": code[4:], "dicofre": code, "pt": p["name"],
                            "geom": Point(ft["geometry"]["coordinates"])})

    out, unnamed, split = {}, [], []
    used = set()
    for ft in caop["features"]:
        pr = ft["properties"]
        mun, name = pr["mun"], pr["name"]
        code = code_of.get((mun, ALIAS.get((mun, name), name)))
        if not code:
            unnamed.append(mun + " · " + name)
            continue
        rec = {"mun": mun, "pt": name, "code": code[4:], "dicofre": code}
        if code not in current:
            geom = prep(shape(ft["geometry"]))
            kids = sorted((k for k in new2025 if geom.contains(k["geom"])),
                          key=lambda k: k["code"])
            for k in kids:
                used.add(k["dicofre"])
            rec["split2025"] = [{"code": k["code"], "dicofre": k["dicofre"],
                                 "pt": k["pt"]} for k in kids]
            split.append(rec)
        out[mun + "|" + name] = rec

    # ---- audit ----------------------------------------------------------
    dup = [c for c, n in collections.Counter(
        r["dicofre"] for r in out.values()).items() if n > 1]
    orphan = [k["dicofre"] for k in new2025 if k["dicofre"] not in used]
    childless = [r["pt"] for r in split if not r["split2025"]]

    print("רובעים עם קוד רשמי: %d מתוך %d" % (len(out), len(caop["features"])))
    print("מתוכם בוטלו ברפורמת 2025: %d (הפכו ל-%d רובעים חדשים)"
          % (len(split), sum(len(r["split2025"]) for r in split)))
    fail = False
    for label, rows in (("ללא שורה ב-INE", unnamed), ("קוד כפול", dup),
                        ("יחידה שפורקה בלי יורשים", childless),
                        ("רובע 2025 שלא שויך", orphan)):
        if rows:
            fail = True
            print("  שגיאה — %s: %s" % (label, rows))

    with open(os.path.join(RAW, "freguesia_official_codes.json"), "w",
              encoding="utf-8") as fh:
        json.dump({
            "code_source": "INE, Censos 2021 — Ficheiro Síntese por Secção "
                           "(data/source_files/ine/FS2021_SeccaoTot.zip)",
            "status_source": "OpenStreetMap ref:ine + start_date "
                             "(relations tagged source=DGT - CAOP), ODbL",
            "district": DISTRICT,
            "freguesias": out,
        }, fh, ensure_ascii=False, indent=1)
    print("נכתב data/raw/freguesia_official_codes.json")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
