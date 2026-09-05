#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Get a municipality indicator out of PORDATA.

PORDATA renders its tables client-side, so there are two workable routes:

  A. headless browser (automatic)   python3 scripts/fetch_pordata.py --indicator crime
     Needs Playwright:  pip install playwright && playwright install chromium
     Opens the indicator page, waits for the table, and reads the municipality
     rows straight out of the DOM.

  B. manual download (always works) python3 scripts/fetch_pordata.py --indicator crime --print-url
     Open the printed URL, press Download, then feed the file to
     scripts/import_indicator.py (see its --help for the exact command).

Route A prints exactly what it read before writing anything, so a layout change
shows up as "0 municipalities matched" rather than as silently wrong numbers.
"""
import argparse
import re
import sys

import indicator_store as store

INDICATORS = {
    "crime": {
        "key": "crimes_per_1000",
        "label": "עבירות רשומות לאלף תושבים",
        "unit": "לאלף",
        "url": "https://www.pordata.pt/municipios/crimes+registados+pelas+policias+por+mil+habitantes-995",
        "source": "PORDATA — Crimes registados pelas polícias por mil habitantes",
        "warning": ("סך העבירות הרשומות. זה לא ׳פשיעה חמורה׳: criminalidade violenta "
                    "e grave מתפרסמת ב-RASI לפי מחוז ופיקוד משטרתי בלבד ואין לה ערך "
                    "ברמת עירייה."),
    },
    "foreign": {
        "key": "foreign_pct",
        "label": "אחוז תושבים זרים",
        "unit": "%",
        "url": "https://www.pordata.pt/municipios/populacao+estrangeira+com+estatuto+legal+de+residente+total+e+por+algumas+nacionalidades-45",
        "source": "PORDATA — População estrangeira com estatuto legal de residente "
                  "(מקור ראשוני: AIMA, לשעבר SEF)",
        "warning": "אם הטבלה מחזירה מספר מוחלט, חשבו אחוז מול אוכלוסיית 2021 והציינו זאת.",
    },
    "median_age": {
        "key": "median_age",
        "label": "גיל חציוני",
        "unit": "שנים",
        "url": "https://www.pordata.pt/municipios/idade+mediana+da+populacao-6",
        "source": "PORDATA — Idade mediana da população residente (מקור ראשוני: INE)",
        "warning": "",
    },
    "income": {
        "key": "median_income",
        "label": "הכנסה חציונית",
        "unit": "€/שנה",
        "url": "https://www.pordata.pt/municipios/rendimento+bruto+declarado+por+sujeito+passivo+de+irs-124",
        "source": "PORDATA — Rendimento bruto declarado por sujeito passivo de IRS "
                  "(מקור ראשוני: Autoridade Tributária)",
        "warning": "זו הכנסה מוצהרת לנישום, לא הכנסה חציונית של משק בית. אל תערבבו בין השניים.",
    },
}


def scrape(url, year):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("Playwright is not installed.\n"
                 "  pip install playwright && playwright install chromium\n"
                 "or use route B: --print-url, then scripts/import_indicator.py")
    rows = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(locale="pt-PT")
        page.goto(url, wait_until="networkidle", timeout=120000)
        page.wait_for_timeout(4000)
        for tr in page.query_selector_all("table tr"):
            cells = [c.inner_text().strip() for c in tr.query_selector_all("th,td")]
            if len(cells) >= 2:
                rows.append(cells)
        browser.close()
    if not rows:
        sys.exit("no table rows found — the page layout changed, use route B")

    # find the column whose header contains the year
    header = next((r for r in rows if any(re.fullmatch(r"\d{4}", c) for c in r)), None)
    col = None
    if header:
        for i, c in enumerate(header):
            if c.strip() == str(year):
                col = i
                break
    if col is None:
        print("columns seen in the header row: %s" % (header or "(none)"))
        sys.exit("year %s is not a column on this page — pick another --year" % year)

    values, seen = {}, 0
    for r in rows:
        if len(r) <= col:
            continue
        name = store.resolve_municipio(r[0])
        if not name:
            continue
        raw = r[col].replace(" ", "").replace(" ", "").replace("€", "")
        raw = raw.replace(".", "").replace(",", ".") if raw.count(",") == 1 and raw.count(".") >= 1 \
            else raw.replace(",", ".")
        try:
            values[name] = float(re.sub(r"[^0-9.\-]", "", raw))
            seen += 1
        except ValueError:
            continue
    print("read %d municipality rows" % seen)
    for k in sorted(values):
        print("   %-22s %s" % (k, values[k]))
    return values


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--indicator", required=True, choices=sorted(INDICATORS))
    ap.add_argument("--year", type=int, default=2021)
    ap.add_argument("--print-url", action="store_true")
    args = ap.parse_args()
    spec = INDICATORS[args.indicator]

    if args.print_url:
        print(spec["url"])
        print("\nDownload the table, then:\n"
              "  python3 scripts/import_indicator.py <file> \\\n"
              "      --key %s --label %r --unit %r --year %d \\\n"
              "      --name-col \"Municípios\" --value-col \"%d\" \\\n"
              "      --source %r --url %r%s"
              % (spec["key"], spec["label"], spec["unit"], args.year, args.year,
                 spec["source"], spec["url"],
                 (" \\\n      --warning %r" % spec["warning"]) if spec["warning"] else ""))
        return 0

    values = scrape(spec["url"], args.year)
    if len(values) < 18:
        print("WARNING: only %d/18 municipalities matched" % len(values))
    meta = {"label_he": spec["label"], "unit": spec["unit"],
            "reference_year": args.year, "source_he": spec["source"],
            "url": spec["url"]}
    if spec["warning"]:
        meta["warning_he"] = spec["warning"]
    store.save(spec["key"], meta, municipios=values)
    return 0


if __name__ == "__main__":
    sys.exit(main())
