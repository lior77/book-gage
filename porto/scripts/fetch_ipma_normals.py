#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""IPMA climate normals 1991-2020 for the two stations inside the district.

    pip install pdfminer.six
    python3 scripts/fetch_ipma_normals.py

Two stations, and that is the whole story
-----------------------------------------
IPMA publishes normals for 55 stations in the country.  Exactly TWO of them
stand inside the district of Porto:

    545  Porto / Pedras Rubras   41.2322N  8.6791W   67.7 m   coastal (Maia)
    657  Luzim                   41.1459N  8.2490W  287.2 m   inland (Penafiel)

18 municipalities and 275 parishes, and two measuring points.  That is why
this script writes STATIONS and not a value per unit: handing every parish a
temperature interpolated from two stations would be an unmarked interpolation,
which rule 2 of the accuracy contract forbids.  The app shows the two as what
they are — two places where somebody measured — and says so on the screen.

The two are not redundant.  220 m apart in altitude and 36 km apart, one on
the coast and one up the Douro valley, they are the coast-versus-interior
contrast a reader is actually asking about.

Where the numbers come from
---------------------------
The normals live on the website, not in IPMA's open-data API — that API
carries `forecast/` and `observation/` only.  Each station has a fact sheet at
`www.ipma.pt/bin/file.data/climate-normal/cn_91-20_<STATION>.pdf`, and the
monthly values are read out of it.

⚠️ THE PARSER IS CHECKED, NOT TRUSTED.  The normals page embeds the same
monthly values as JSON for some stations, Pedras Rubras among them.  Every run
re-parses the PDF and compares it against that JSON key by key, and refuses to
write if the two disagree.  That is not a second SOURCE — both are IPMA — it
is a second READING, and it is what stands between a column shifted by one and
a temperature chart nobody checks.

IPMA's own notes, which the source record repeats
-------------------------------------------------
- Missing values in the series were completed from the WRF model, and the
  series were homogenised with RClimDex.  IPMA says so on the normals page.
- A monthly figure rests on at least 18 of the 30 years; WMO rules (WCDP 10 /
  WMO TD 341) forbid computing a month with more than 3 consecutive or 5
  scattered daily gaps.
- Using the data obliges the user to cite the source.  That is in the source
  record and on the terms page.
"""
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PORTO = os.path.dirname(HERE)
RAW = os.path.join(PORTO, "data", "raw", "ipma")
OUT = os.path.join(PORTO, "data", "raw", "climate_normals.json")

PDF_BASE = "https://www.ipma.pt/bin/file.data/climate-normal/"
PAGE = "https://www.ipma.pt/pt/oclima/normais.clima/1991-2020/"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/120 Safari/537.36")
PERIOD = "1991-2020"

STATIONS = [
    {"num": "545", "pdf": "cn_91-20_PORTO_PEDRAS_RUBRAS.pdf",
     "name": "Porto / Pedras Rubras", "he": "פורטו / פדראש רובראש",
     "lat": 41.2322, "lon": -8.6791, "alt_m": 67.7,
     "where_he": "מאיה, במתחם שדה התעופה, כ-6 ק״מ מהחוף",
     "where_en": "Maia, at the airport, about 6 km from the coast"},
    {"num": "657", "pdf": "cn_91-20_LUZIM.pdf",
     "name": "Luzim", "he": "לוזין",
     "lat": 41.1459, "lon": -8.2490, "alt_m": 287.2,
     "where_he": "פנאפיאל, בפנים הארץ, 220 מטר מעל תחנת החוף",
     "where_en": "Penafiel, inland, 220 m above the coastal station"},
]

MONTHS_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
             "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]
# The labels as the sheet prints them, and what each one is.
ROWS = [("TT", "MTT", "טמפרטורה ממוצעת"),
        ("TX", "MTX", "ממוצע המרבית"),
        ("TN", "MTN", "ממוצע המזערית"),
        ("Prec", "MRR", "משקעים")]


def fetch_pdfs():
    os.makedirs(RAW, exist_ok=True)
    for st in STATIONS:
        p = os.path.join(RAW, st["pdf"])
        if os.path.exists(p) and os.path.getsize(p) > 10_000:
            continue
        req = urllib.request.Request(PDF_BASE + st["pdf"], headers={"User-Agent": UA})
        print("fetch   %s" % st["pdf"])
        with urllib.request.urlopen(req, timeout=180) as r, open(p, "wb") as f:
            f.write(r.read())


def parse_pdf(path):
    """Monthly values off one fact sheet, by the label that starts each block.

    The sheet is a table; pdfminer flattens it to a column of numbers, and each
    of the four rows we want is introduced by its own label ("TT [°C]").  So the
    label is the anchor and the twelve numbers that follow it are the year.  A
    row that does not yield exactly 12 (or 13, precipitation carries its annual
    total) is not guessed at — it is returned empty and the caller fails.
    """
    from pdfminer.high_level import extract_text
    lines = [x.strip() for x in extract_text(path).split("\n") if x.strip()]
    num = re.compile(r"^-?\d+(?:\.\d+)?$")
    out = {}
    for label, _key, _he in ROWS:
        head = label + " ["
        i = next((n for n, l in enumerate(lines) if l.startswith(head)), None)
        if i is None:
            continue
        vals = []
        for l in lines[i + 1:]:
            if not num.match(l):
                break
            vals.append(float(l))
            if len(vals) == 13:
                break
        if len(vals) >= 12:
            out[label] = {"months": vals[:12],
                          "year": vals[12] if len(vals) > 12 else None}
    return out


def page_values():
    """The same monthly values as the normals page embeds them, for cross-check.

    Only some stations are on that map; the ones that are not simply return
    nothing and are written on the strength of the PDF alone, which the source
    record says.
    """
    req = urllib.request.Request(PAGE, headers={"User-Agent": UA})
    try:
        html = urllib.request.urlopen(req, timeout=180).read().decode("utf-8", "replace")
    except Exception as e:                       # offline is not a build failure
        print("  (no cross-check: %s)" % e)
        return {}
    i = html.find("allstations = [", 40000)
    if i < 0:
        return {}
    j = html.index("[", i)
    depth = 0
    for k in range(j, len(html)):
        if html[k] == "[":
            depth += 1
        elif html[k] == "]":
            depth -= 1
            if depth == 0:
                break
    try:
        rows = json.loads(html[j:k + 1])
    except ValueError:
        return {}
    return {r["NUM"]: r for r in rows if "NUM" in r}


def main():
    fetch_pdfs()
    embedded = page_values()
    codes = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
             "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"]
    items, checked = [], 0
    for st in STATIONS:
        got = parse_pdf(os.path.join(RAW, st["pdf"]))
        missing = [lab for lab, _k, _he in ROWS if lab not in got]
        if missing:
            sys.exit("%s: could not read %s off the fact sheet — the layout changed, "
                     "and guessing is not an option here" % (st["name"], ", ".join(missing)))
        emb = embedded.get(st["num"])
        if emb:
            for lab, key, _he in ROWS:
                want = []
                for c in codes:
                    v = emb.get(key + c)
                    want.append(None if v in (None, "", "-") else float(v))
                if any(w is None for w in want):
                    continue
                for n, (a, b) in enumerate(zip(got[lab]["months"], want)):
                    if abs(a - b) > 0.051:
                        sys.exit("%s %s %s: the fact sheet says %s and the page says %s — "
                                 "one of the two readings is wrong, and this script will not "
                                 "pick a winner" % (st["name"], lab, codes[n], a, b))
                checked += 1
        row = dict(st)
        row.pop("pdf")
        row["period"] = PERIOD
        row["values"] = {lab: got[lab] for lab, _k, _he in ROWS}
        row["pdf_url"] = PDF_BASE + st["pdf"]
        row["cross_checked"] = bool(emb)
        items.append(row)
        print("read    %-24s %d rows%s" % (st["name"], len(got),
                                           "  (cross-checked)" if emb else ""))
    doc = {
        "meta": {
            "indicator": "climate normals %s, per STATION — never per municipality "
                         "or parish" % PERIOD,
            "source": "Instituto Português do Mar e da Atmosfera (IPMA), "
                      "Normais Climatológicas %s" % PERIOD,
            "url": PAGE,
            "retrieved": "2026-09-16",
            "stations_in_district": len(STATIONS),
            "stations_in_country": 55,
            "confidence": "reported",
            "rows_cross_checked": checked,
            "note_he": "‏IPMA מפרסמת נורמלים לתחנה, לא ליחידה מנהלית. שתי תחנות בלבד "
                       "עומדות בתוך מחוז פורטו, ולכן אין ולא יהיה כאן ערך לרובע.",
            "note_en": "IPMA publishes normals per station, not per administrative "
                       "unit. Only two stations stand inside the district of Porto, "
                       "so there is no value per parish here and there will not be.",
            "method_he": "ערכים חסרים בסדרה הושלמו ממודל WRF, והסדרות הומוגנו ב-RClimDex "
                         "— כך IPMA מתארת את עבודתה. ערך חודשי נשען על 18 שנים לפחות "
                         "מתוך 30, לפי כללי WMO.",
        },
        "months_he": MONTHS_HE,
        "items": items,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("wrote   %s  (%d stations, %d rows cross-checked against the page)"
          % (os.path.relpath(OUT, PORTO), len(items), checked))


if __name__ == "__main__":
    main()
