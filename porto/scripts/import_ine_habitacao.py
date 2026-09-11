#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fold INE's local housing-price and rent statistics into extra_indicators.json.

    python3 scripts/import_ine_habitacao.py

Reads the two CSVs under `data/raw/ine/`, which scripts/fetch_ine_habitacao.py
pulled from INE's JSON indicator API, and writes four indicator blocks keyed by
DICOFRE.  build.py merges them onto the municipalities and the parishes; the app
shows them and nothing else changes.

Three things about this source decide almost every line below.

1.  INE publishes the figure at parish level for only eleven of the eighteen
    municipalities.  The other seven — Amarante, Baião, Felgueiras, Lousada,
    Marco de Canaveses, Paços de Ferreira and Penafiel — exist in the file at
    município level only.  Their parishes get no value at all, and the app says
    "אין נתון".  Nothing is spread down from the municipality: a municipal
    median is not a parish median.

2.  Every quarter in the file is a **twelve-month moving window** ending in that
    quarter, not the quarter itself.  So two consecutive quarters share nine
    months of the same sales, and the difference between them is not a quarterly
    change.  The app must never present one.

3.  A cell INE does not publish carries the marker `-`, defined by INE's own
    metadata as `- = Dado nulo ou não aplicável` — a null or non-applicable
    datum.  That is the whole of what the source says: *why* a given cell is
    not published is not part of the publication, so nothing here, and nothing
    in sources.json, may name a reason for it.  The fetch script kept the
    marker verbatim in the `flag` column with the value left empty; it is a
    missing value and it stays missing.

One period is taken for all units — the latest in the file — rather than the
latest that each unit happens to have.  Mixing periods per unit would put two
different twelve-month windows side by side in the same table without saying so.
"""
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
INE = os.path.join(RAW, "ine")
EXTRA = os.path.join(RAW, "extra_indicators.json")

DISTRICT = "13"          # every Porto-district DICOFRE starts here

# The parish-level figure exists for these eleven and for no other.  Written out
# rather than derived so that a source that quietly stops publishing one of them
# shows up as a changed number in the run report instead of passing unnoticed.
FREGUESIA_MUNS = {
    "1304": "Gondomar", "1306": "Maia", "1308": "Matosinhos", "1310": "Paredes",
    "1312": "Porto", "1313": "Póvoa de Varzim", "1314": "Santo Tirso",
    "1315": "Valongo", "1316": "Vila do Conde", "1317": "Vila Nova de Gaia",
    "1318": "Trofa",
}

INE_URL = "https://www.ine.pt/xportal/xmain?xpid=INE&xpgid=ine_indicadores"

# key, source CSV, the `dwelling_type` column value that selects the series.
# The rents file has one series and leaves the column empty.
SERIES = [
    ("price_eur_m2",      "ine_precos_venda.csv", "Total"),
    ("price_new_eur_m2",  "ine_precos_venda.csv", "Novos"),
    ("price_used_eur_m2", "ine_precos_venda.csv", "Existentes"),
    ("rent_eur_m2",       "ine_rendas.csv",       ""),
]

LABELS = {
    "price_eur_m2": "ערך חציוני של מכירות דירות למ״ר",
    "price_new_eur_m2": "ערך חציוני של מכירות דירות חדשות למ״ר",
    "price_used_eur_m2": "ערך חציוני של מכירות דירות קיימות למ״ר",
    "rent_eur_m2": "ערך חציוני של שכר דירה בחוזים חדשים למ״ר",
}

# INE's own wording, kept as INE writes it.  The Hebrew label above says the same
# and no more: "מכירות", not "מחיר מבוקש"; "חוזים חדשים", not "שכר הדירה במחוז".
DEFINITION_PT = {
    "price_eur_m2": "Valor mediano das vendas de alojamentos familiares nos "
                    "últimos 12 meses (Metodologia 2022 - €/ m²) — Total",
    "price_new_eur_m2": "Valor mediano das vendas de alojamentos familiares nos "
                        "últimos 12 meses (Metodologia 2022 - €/ m²) — Novos",
    "price_used_eur_m2": "Valor mediano das vendas de alojamentos familiares nos "
                         "últimos 12 meses (Metodologia 2022 - €/ m²) — Existentes",
    "rent_eur_m2": "Valor mediano das rendas de novos contratos de arrendamento "
                   "de alojamentos familiares nos últimos 12 meses "
                   "(Metodologia 2026 - €/ m²)",
}


def read_rows(name):
    path = os.path.join(INE, name)
    if not os.path.exists(path):
        sys.exit("missing %s — run scripts/fetch_ine_habitacao.py first" % path)
    with open(path, encoding="utf-8") as fh:
        return [r for r in csv.DictReader(fh) if r["dicofre"].startswith(DISTRICT)]


def report():
    path = os.path.join(INE, "fetch_report.json")
    return {r["file"]: r for r in json.load(open(path, encoding="utf-8"))}


def block(rows, series, period, meta):
    """{dicofre: value} for one series at one period, missing cells left out."""
    out, skipped = {}, 0
    for r in rows:
        if r["period"] != period or r["dwelling_type"] != series:
            continue
        # `-` is INE's own marker: "Dado nulo ou não aplicável".  It is not a
        # zero and it is not an invitation to interpolate.
        if r["flag"] == "-" or r["value_eur_m2"] == "":
            skipped += 1
            continue
        code = r["dicofre"]
        if len(code) == 6 and code[:4] not in FREGUESIA_MUNS:
            sys.exit("INE published a parish value for %s (%s), which this "
                     "script did not expect — check FREGUESIA_MUNS"
                     % (code, r["geo_name"]))
        out[code] = float(r["value_eur_m2"])
    return out, skipped


def main():
    rep = report()
    blocks = {}
    for key, fname, series in SERIES:
        rows = read_rows(fname)
        periods = sorted({r["period"] for r in rows})
        period = periods[-1]
        values, skipped = block(rows, series, period, rep[fname])
        if not values:
            sys.exit("%s: nothing published at %s" % (key, period))
        n_m = sum(1 for c in values if len(c) == 4)
        n_f = sum(1 for c in values if len(c) == 6)
        src = rep[fname]
        blocks[key] = {
            "meta": {
                "label_he": LABELS[key],
                "unit": "€/מ״ר",
                "reference_year": int(period[:4]),
                "reference_period": period,
                "decimals": 2 if key == "rent_eur_m2" else 0,
                "high_is": "neutral",
                # A single source.  A second, independent one reaching the same
                # number would make it `verified`; there is none, so `reported`.
                "confidence": "reported",
                "source_he": "INE — אינדיקטור %s, %s" % (src["indicator_code"], period),
                "definition_pt": DEFINITION_PT[key],
                "note_he": "הערך הוא החציון של שנים עשר החודשים שמסתיימים ב-%s, "
                           "ולא של הרבעון עצמו. שני רבעונים סמוכים חולקים תשעה "
                           "חודשי עסקאות, ולכן אי אפשר לגזור מכאן שינוי רבעוני."
                           % period,
                "published": src["publication_date"],
                "retrieved": src["extracted"][:10],
            },
            "by_dicofre": values,
        }
        print("%-18s %s  municipalities %2d/18  parishes %3d/243  "
              "(INE left %d cells unpublished)"
              % (key, period, n_m, n_f, skipped))

    extra = {}
    if os.path.exists(EXTRA):
        extra = json.load(open(EXTRA, encoding="utf-8"))
    extra.update(blocks)
    with open(EXTRA, "w", encoding="utf-8") as fh:
        json.dump(extra, fh, ensure_ascii=False, indent=1)
    print("\nwrote %s  (%d indicator blocks in the file)"
          % (os.path.relpath(EXTRA, ROOT), len(extra)))
    print("parish-level publication exists for %d of the 18 municipalities; "
          "the other seven have no parish figure at all."
          % len(FREGUESIA_MUNS))


if __name__ == "__main__":
    main()
