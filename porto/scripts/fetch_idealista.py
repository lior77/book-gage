#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fill in the €/m² column.

The PDF describes prices only in relative terms ("the most expensive in the
district", "cheaper than Matosinhos") because no price data was reachable.  This
script turns that into real numbers once you are on an open network.

Where the numbers come from
---------------------------
1. idealista/data — "Informe de Preços" / "Relatórios de preço de habitação".
   Monthly €/m² asking prices per municipality and per parish, published as
   XLSX/PDF per region.
       https://www.idealista.pt/media/relatorios-preco-habitacao/
   Asking prices, not transactions. Say so in the UI — this script sets that
   caveat automatically.

2. INE — "Preço mediano das vendas de alojamentos familiares (€/m²)" by
   municipality, from the actual deeds. Slower to publish, but it is the
   transaction price, and it is the figure to prefer.
       python3 scripts/fetch_ine.py --search "preco mediano vendas alojamentos"

Do not mix the two in one column: an asking price and a transaction price are
different indicators, and the brief's rule 4 forbids presenting one as the other.

Usage
-----
    python3 scripts/fetch_idealista.py --print-instructions
    # download the report, save the municipality sheet as CSV, then
    python3 scripts/fetch_idealista.py --from-csv porto_precos.csv \
        --name-col "Concelho" --value-col "dez-25" --year 2025 --month "dez-25"
"""
import argparse
import subprocess
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))

URL = "https://www.idealista.pt/media/relatorios-preco-habitacao/"
SOURCE = ("idealista/data — Informe de Preços, מחירי היצע (asking prices) "
          "לפי עירייה, €/מ״ר")
CAVEAT = ("מחירי היצע של מודעות, לא מחירי עסקאות. מדד העסקאות של INE "
          "(preço mediano das vendas) הוא מדד אחר — אל תערבבו ביניהם באותה עמודה.")


def instructions(args):
    print("open: %s" % URL)
    print("""
1. pick the latest report for Norte / distrito do Porto
2. export the municipality table to CSV (or copy it into a spreadsheet and save
   as CSV). One column of names, one column of EUR/m2.
3. import it:

   python3 scripts/import_indicator.py <file.csv> \\
       --key price_eur_m2 --label "מחיר למ״ר" --unit "€/מ״ר" \\
       --year %d --name-col "<name column>" --value-col "<value column>" \\
       --source %r \\
       --url %r \\
       --warning %r

4. for parish-level prices repeat with --level freguesia; names are matched
   against the 243 CAOP parish names, and anything unmatched is reported.
5. python3 scripts/build.py && python3 scripts/checks.py
""" % (args.year, SOURCE, URL, CAVEAT))
    print("terms of use: the reports are published for reuse with attribution; "
          "do not scrape idealista's listing pages for this.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--print-instructions", action="store_true")
    ap.add_argument("--from-csv")
    ap.add_argument("--name-col", default="Concelho")
    ap.add_argument("--value-col")
    ap.add_argument("--year", type=int, default=2025)
    ap.add_argument("--month", default="")
    ap.add_argument("--level", choices=("municipio", "freguesia"), default="municipio")
    args = ap.parse_args()

    if args.from_csv:
        if not args.value_col:
            sys.exit("--value-col is required with --from-csv")
        label = "מחיר למ״ר" + (" (%s)" % args.month if args.month else "")
        cmd = [sys.executable, os.path.join(HERE, "import_indicator.py"), args.from_csv,
               "--key", "price_eur_m2", "--label", label, "--unit", "€/מ״ר",
               "--year", str(args.year), "--name-col", args.name_col,
               "--value-col", args.value_col, "--source", SOURCE, "--url", URL,
               "--warning", CAVEAT, "--level", args.level]
        return subprocess.call(cmd)

    instructions(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
