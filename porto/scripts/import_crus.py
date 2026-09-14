#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CRUS — Carta do Regime de Uso do Solo — brought in as numbers, not polygons.

    python3 scripts/import_crus.py            # fetch what is missing, then build
    python3 scripts/import_crus.py --refetch  # ignore the cache

WHAT IT IS.  CRUS is DGT's harmonisation of every municipal PDM into one
national map of the land-use regime: for each piece of ground, which of the two
legal classes it is in — `Solo Urbano` or `Solo Rústico` — and which category
within it.  For anyone reading this atlas to look for property it answers the
question none of the other layers answer: not "is there a constraint here" but
"what may this ground be used for at all".

WHY THE ATTRIBUTES AND NOT THE GEOMETRY.  The district is 15,194 CRUS polygons.
Downloaded as GeoJSON they were measured at 24,302 bytes each — 369 MB for the
district, 39 MB after gzip, against 22.8 MB for REN and RAN together, which are
already downloaded on demand rather than shipped.  So the polygons stay at DGT
and what comes here is the attribute table, which is the part that carries the
answer anyway.

HOW, GIVEN THAT THE SERVER ONLY SERVES FEATURES.  `f=csv` on the OGC API items
endpoint returns the attributes with no geometry column.  The two obvious ways
to ask for the same thing — `skipGeometry=true` and `properties=...` — both
answer 500 on this server, repeatably, on a request whose GeoJSON form works.
The CSV path is not a trick; it is the one that is served.

WHAT THE NUMBERS ARE.  `area_ha` is published by DGT for every polygon.  Adding
those up per class is arithmetic on published values — it is not this project
measuring anything off a geometry — so the totals are `reported`, and the share
of a municipality is computed against CRUS's own total for that municipality
rather than against a boundary from somewhere else.  The comparison with CAOP's
area is then a genuine cross-check and not a circular one; build.py keeps it.

WHAT IS KEPT THAT LOOKS LIKE NOISE.  One of the source's own categories is
`Discrepância` — the ground where the harmonisation did not reconcile.  It is
tiny and it stays, under its own name: a category invented by the source is not
ours to fold into another one.

THE REFERENCE YEAR IS PER MUNICIPALITY.  Each municipality's rows carry the
publication date of that municipality's PDM (`data_pub_origem`) and its deposit
reference at DGT (`registo_ou_deposito`).  They range across a decade, so there
is no "CRUS year" — the same shape as REN and RAN, and for the same reason.  If
a municipality's rows ever disagree with each other about that date, this script
writes no year for it rather than picking one.
"""
import argparse
import collections
import csv
import datetime
import io
import json
import os
import ssl
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(ROOT, "data", "source_files", "dgt", "crus")
OUT = os.path.join(ROOT, "data", "raw", "crus_porto.json")
MUNI = os.path.join(ROOT, "data", "processed", "municipios.json")

ENDPOINT = "https://ogcapi.dgterritorio.gov.pt/collections/crus/items"
UA = "porto-district-app/1.0 (https://github.com/lior77/book-gage)"
PAGE = 500
# The server answers 500 often enough that a single failure means nothing; it
# answered every one of these requests eventually.
TRIES = 8

CTX = ssl.create_default_context(
    cafile="/root/.ccr/ca-bundle.crt"
    if os.path.exists("/root/.ccr/ca-bundle.crt") else None)

# The columns the CSV returns, and the ones that must be the same on every row
# of a municipality for a single value to be published for it.
ONE_PER_MUN = ("data_pub_origem", "registo_ou_deposito", "situacao_pdm",
               "escala_origem", "fonte", "autor")


def get(url):
    for attempt in range(1, TRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=300, context=CTX) as r:
                return r.read()
        except Exception as exc:                              # noqa: BLE001
            if attempt == TRIES:
                print("    gave up: %s %s" % (type(exc).__name__, exc))
                return None
            time.sleep(min(3 * attempt, 20))


def matched(code):
    """How many CRUS polygons the register holds for this municipality."""
    body = get("%s?f=json&limit=1&dtcc=%s" % (ENDPOINT, code))
    if body is None:
        return None
    return json.loads(body).get("numberMatched")


def fetch_one(code, name):
    """The whole attribute table for one municipality, paged, as CSV text."""
    n = matched(code)
    if not n:
        print("  %s %-22s no count from the register" % (code, name))
        return None
    header, rows, offset = None, [], 0
    while offset < n:
        body = get("%s?f=csv&limit=%d&offset=%d&dtcc=%s"
                   % (ENDPOINT, PAGE, offset, code))
        if body is None:
            return None
        lines = body.decode("utf-8").splitlines()
        if header is None:
            header = lines[0]
        rows.extend(lines[1:])
        offset += PAGE
    if len(rows) != n:
        print("  %s %-22s %d of %d rows — not written"
              % (code, name, len(rows), n))
        return None
    print("  %s %-22s %d rows" % (code, name, len(rows)))
    return header + "\n" + "\n".join(rows) + "\n"


def summarise(code, name, text):
    """One municipality's rows folded to hectares per class and per category."""
    rows = list(csv.DictReader(io.StringIO(text)))
    rec = {"pt": name, "polygons": len(rows)}

    for col in ONE_PER_MUN:
        seen = sorted({r[col] for r in rows if r.get(col)})
        # More than one value is a finding, not something to average away: the
        # field is written out only when the source speaks with one voice.
        rec[col] = seen[0] if len(seen) == 1 else None
        if len(seen) > 1:
            rec.setdefault("disagrees", []).append(col)

    date = rec.get("data_pub_origem") or ""
    rec["pdm_date"] = date[:10] or None
    rec["pdm_year"] = int(date[:4]) if date[:4].isdigit() else None

    classes = collections.Counter()
    cats = collections.Counter()
    for r in rows:
        ha = float(r["area_ha"])
        classes[r["classe_2021"]] += ha
        cats[(r["classe_2021"], r["categoria_2021"])] += ha
    rec["total_ha"] = round(sum(classes.values()), 1)
    rec["classes"] = {k: round(v, 1) for k, v in
                      sorted(classes.items(), key=lambda kv: -kv[1])}
    rec["categorias"] = [{"classe": c, "categoria": cat, "ha": round(v, 1)}
                         for (c, cat), v in
                         sorted(cats.items(), key=lambda kv: -kv[1])]
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refetch", action="store_true",
                    help="ignore the cached CSVs and ask DGT again")
    args = ap.parse_args()

    with io.open(MUNI, encoding="utf-8") as fh:
        muns = {m["dicofre"]: m["pt"] for m in json.load(fh)["items"]}
    os.makedirs(CACHE, exist_ok=True)

    out = {}
    for code in sorted(muns):
        name = muns[code]
        path = os.path.join(CACHE, "crus_%s.csv" % code)
        text = None
        if os.path.exists(path) and not args.refetch:
            text = io.open(path, encoding="utf-8").read()
            print("  %s %-22s cached, %d rows"
                  % (code, name, text.count("\n") - 1))
        else:
            text = fetch_one(code, name)
            if text:
                io.open(path, "w", encoding="utf-8", newline="\n").write(text)
        if text:
            out[code] = summarise(code, name, text)

    missing = [c for c in muns if c not in out]
    doc = {
        "generated": datetime.date.today().isoformat(),
        "source": "Direção-Geral do Território (DGT), Carta do Regime de Uso "
                  "do Solo (CRUS), OGC API Features",
        "endpoint": ENDPOINT,
        "licence": "CC BY 4.0",
        "note": "Attributes only. The polygons are 369 MB of GeoJSON for this "
                "district and stay at DGT; area_ha is DGT's own published area "
                "for each polygon, so these totals are sums of published "
                "values and nothing here was measured off a geometry.",
        "coverage": "%d/%d" % (len(out), len(muns)),
        "missing": sorted(missing),
        "municipios": out,
    }
    with io.open(OUT, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")

    tot = sum(r["total_ha"] for r in out.values())
    poly = sum(r["polygons"] for r in out.values())
    print("\nwrote %s" % os.path.relpath(OUT, ROOT))
    print("  %d municipalities, %s polygons, %s ha"
          % (len(out), format(poly, ","), format(round(tot), ",")))
    if missing:
        print("  missing: %s" % ", ".join(missing))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
