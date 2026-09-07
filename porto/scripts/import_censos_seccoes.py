#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Read INE's Censos 2021 section synthesis file and keep the Porto district.

    python3 scripts/import_censos_seccoes.py

Reads:
    data/source_files/ine/FS2021_SeccaoTot.zip
        `Ficheiro Síntese por Secção`, published by INE. One workbook with
        four kinds of row, told apart by which of the code columns are filled:
        NUTS totals, 308 municipalities, 3 092 freguesias and 10 401
        statistical sections, each with the same 177 counts.

Writes:
    data/raw/censos2021_ine.json          the 18 municipalities and 243
                                          parishes of district 13, every
                                          variable, keyed by DICOFRE
    data/raw/censos2021_seccoes_d13.json  the sections of district 13, kept
                                          for later (the app does not read it)
    data/raw/extra_indicators.json        the derived indicators build.py
                                          merges: median age, ageing index,
                                          % 65+, % 0-14, % foreign nationals

WHY THIS FILE AND NOT THE OTHERS
================================
The Censos downloads that came before it — Censos2021.xls, the CSV pack, the
infographics — publish NUTS II totals. This one publishes every parish
separately and keys them by DICOFRE, which is exactly the code the app now
prints, so the join is on an identifier rather than on a name.

It is also the authority on two things the app had to infer:

  * the parish population. Until now 140 came from the source document and
    103 from a hand-collected file; both are replaced by the census figure,
    and the municipality total comes from the same file as its parishes, so
    the sum matches instead of differing by a rounding of another edition.
  * the official code of the 25 parishes the 2025 reform dissolved. They are
    in this file because it counts the 2021 map, which is the 2013 map — the
    same one the app draws.

MEDIAN AGE
==========
INE does not publish a median age in this file; it publishes five-year bands.
The median is interpolated inside the band it falls in, which is legitimate
for bands this narrow, and the value is marked `approx` so the UI can say so.
The top band is open (75 and over): if a unit's median fell inside it the
interpolation would have no width to work with, so the script refuses that
unit rather than inventing a number. No unit in this district does.
"""
import io
import json
import os
import sys
import zipfile
from datetime import date

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw")
SRC = os.path.join(ROOT, "data", "source_files", "ine", "FS2021_SeccaoTot.zip")

DISTRICT = "13"
KEYS = ("ORD", "NUTS1", "NUTS1 DSG", "ORD NUTS2", "NUTS2", "NUTS2 DSG", "NUTS3",
        "NUTS3 DSG", "MUNICIPIO", "MUNICIPIO DSG", "FREGUESIA", "FREGUESIA DSG",
        "SECCAO")

# The five-year bands, lowest first, and the width of each. The last one is
# open-ended, which is why it carries no width.
BANDS = [("N_INDIVIDUOS_0A4", 0, 5), ("N_INDIVIDUOS_5A9", 5, 5),
         ("N_INDIVIDUOS_10A14", 10, 5), ("N_INDIVIDUOS_15A19", 15, 5),
         ("N_INDIVIDUOS_20A24", 20, 5), ("N_INDIVIDUOS_25A29", 25, 5),
         ("N_INDIVIDUOS_30A34", 30, 5), ("N_INDIVIDUOS_35A39", 35, 5),
         ("N_INDIVIDUOS_40A44", 40, 5), ("N_INDIVIDUOS_45A49", 45, 5),
         ("N_INDIVIDUOS_50A54", 50, 5), ("N_INDIVIDUOS_55A59", 55, 5),
         ("N_INDIVIDUOS_60A64", 60, 5), ("N_INDIVIDUOS_65A69", 65, 5),
         ("N_INDIVIDUOS_70A74", 70, 5), ("N_INDIVIDUOS_75_OU_MAIS", 75, None)]


def read_rows():
    """Every row of the workbook, as a dict, straight out of the zip."""
    with zipfile.ZipFile(SRC) as z:
        name = [n for n in z.namelist() if n.endswith(".xlsx")][0]
        blob = z.read(name)
    ws = openpyxl.load_workbook(io.BytesIO(blob), read_only=True)["Sheet1"]
    it = ws.iter_rows(values_only=True)
    next(it)                                   # the title line above the header
    header = next(it)
    for row in it:
        yield dict(zip(header, row))


def numeric(row, header):
    """The 177 counts, without the code and name columns."""
    out = {}
    for k in header:
        if k in KEYS or k is None:
            continue
        v = row.get(k)
        if isinstance(v, (int, float)):
            out[k] = int(v)
    return out


def median_age(v):
    """Interpolated inside the five-year band the median falls in.

    Returns None when the bands do not add up to the published total, or when
    the median lands in the open 75-and-over band — both cases where a number
    would be a guess rather than a measurement.
    """
    total = v.get("N_INDIVIDUOS") or 0
    counts = [v.get(k, 0) for k, _, _ in BANDS]
    if not total or sum(counts) != total:
        return None
    half, cum = total / 2.0, 0
    for (key, low, width), n in zip(BANDS, counts):
        if cum + n >= half:
            if width is None:
                return None
            return round(low + width * (half - cum) / n, 1) if n else None
        cum += n
    return None


def pct(part, whole):
    if not whole or part is None:
        return None
    return round(100.0 * part / whole, 1)


def derived(v):
    """The five indicators the app already has a place for."""
    n = v.get("N_INDIVIDUOS") or 0
    young = v.get("N_INDIVIDUOS_0A14")
    old = v.get("N_INDIVIDUOS_65_OU_MAIS")
    out = {
        "median_age": median_age(v),
        "pct_65plus": pct(old, n),
        "pct_0_14": pct(young, n),
        "foreign_pct": pct(v.get("N_INDIVIDUOS_NAC_ESTRANGEIRA"), n),
        # INE's own definition: people 65 and over per hundred under 15
        "ageing_index": round(100.0 * old / young, 1) if young else None,
        # A share of everybody, children included — that is how INE presents it
        "education_pct": pct(v.get("N_INDIVIDUO_ENSINCOMP_SUP"), n),
        # Unemployed out of the economically active, the standard rate
        "unemployment_pct": pct(
            (v.get("N_INDIVIDUOS_DESEMPREGADOS_1EMP", 0)
             + v.get("N_INDIVIDUOS_DESEMPREGADOS_NOVOEMP", 0)),
            v.get("N_INDIVIDUOS_COM_ATIVIDADE_ECONOMICA")),
    }
    return {k: val for k, val in out.items() if val is not None}


def main():
    if not os.path.exists(SRC):
        sys.exit("missing %s" % SRC)

    header, municipios, freguesias, seccoes = None, {}, {}, {}
    for row in read_rows():
        if header is None:
            header = list(row)
        mun = str(row.get("MUNICIPIO") or "")
        if not mun.startswith(DISTRICT):
            continue
        fre, sec = row.get("FREGUESIA"), row.get("SECCAO")
        vals = numeric(row, header)
        if sec:
            seccoes[str(sec)] = dict(vals, dicofre=str(fre))
        elif fre:
            freguesias[str(fre)] = dict(vals, name=row.get("FREGUESIA DSG"),
                                        mun=mun, mun_name=row.get("MUNICIPIO DSG"))
        else:
            municipios[mun] = dict(vals, name=row.get("MUNICIPIO DSG"),
                                   nuts3=row.get("NUTS3 DSG"))

    stamp = {"generated": date.today().isoformat(),
             "source": "INE, Censos 2021 — Ficheiro Síntese por Secção",
             "source_file": "data/source_files/ine/FS2021_SeccaoTot.zip",
             "reference_year": 2021}

    with open(os.path.join(RAW, "censos2021_ine.json"), "w", encoding="utf-8") as fh:
        json.dump(dict(stamp, municipios=municipios, freguesias=freguesias),
                  fh, ensure_ascii=False)
    with open(os.path.join(RAW, "censos2021_seccoes_d13.json"), "w", encoding="utf-8") as fh:
        json.dump(dict(stamp, seccoes=seccoes), fh, ensure_ascii=False)

    # ---- the derived indicators, in the shape build.py already merges ------
    by_mun_name = {m["name"]: m for m in municipios.values()}
    extra = {}
    path = os.path.join(RAW, "extra_indicators.json")
    if os.path.exists(path):
        extra = json.load(open(path, encoding="utf-8"))
    keys = ("median_age", "pct_65plus", "pct_0_14", "foreign_pct", "ageing_index",
            "education_pct", "unemployment_pct")
    meta = {
        "median_age": {"reference_year": 2021, "decimals": 1, "high_is": "neutral",
                       "confidence": "approx",
                       "source_he": "מחושב מפסי גיל של חמש שנים, מפקד INE 2021",
                       "note_he": "INE לא מפרסם גיל חציוני בקובץ הזה אלא פסי גיל של "
                                  "חמש שנים; הערך מתקבל באינטרפולציה בתוך הפס שבו "
                                  "נופל החציון."},
        "pct_65plus": {"reference_year": 2021, "decimals": 1, "high_is": "neutral",
                       "source_he": "מפקד INE 2021"},
        "pct_0_14": {"reference_year": 2021, "decimals": 1, "high_is": "neutral",
                     "source_he": "מפקד INE 2021"},
        "foreign_pct": {"reference_year": 2021, "decimals": 1, "high_is": "neutral",
                        "source_he": "מפקד INE 2021 — אזרחות זרה ביום המפקד",
                        "note_he": "אזרחות, לא מקום לידה: מי שהתאזרח פורטוגלי אינו "
                                   "נספר כאן."},
        "ageing_index": {"reference_year": 2021, "decimals": 1, "high_is": "neutral",
                         "source_he": "נגזר: בני 65+ לכל מאה בני 0–14, מפקד INE 2021"},
        "education_pct": {"reference_year": 2021, "decimals": 1, "high_is": "neutral",
                          "source_he": "מפקד INE 2021 — בעלי השכלה על-תיכונית מלאה",
                          "note_he": "אחוז מכלל התושבים, ילדים כלולים במכנה — כך "
                                     "INE מציג את זה. אחוז מהבוגרים יהיה גבוה יותר."},
        "unemployment_pct": {"reference_year": 2021, "decimals": 1, "high_is": "low",
                             "source_he": "מפקד INE 2021 — מובטלים מתוך כוח העבודה",
                             "note_he": "מחפשי עבודה ראשונה ומחפשי עבודה חדשה, "
                                        "חלקי האוכלוסייה הפעילה כלכלית."},
    }
    for key in keys:
        block = {"meta": dict(meta[key]),
                 "municipios": {}, "freguesias": {}, "by_dicofre": {}}
        for code, m in municipios.items():
            v = derived(m).get(key)
            if v is not None:
                block["municipios"][m["name"]] = v
                block["by_dicofre"][code] = v
        for code, f in freguesias.items():
            v = derived(f).get(key)
            if v is not None:
                block["freguesias"]["%s|%s" % (f["mun_name"], f["name"])] = v
                block["by_dicofre"][code] = v
        extra[key] = block

    with open(path, "w", encoding="utf-8") as fh:
        json.dump(extra, fh, ensure_ascii=False, indent=1)

    # ---- what came out ----------------------------------------------------
    print("עיריות: %d   רובעים: %d   מקטעים סטטיסטיים: %d"
          % (len(municipios), len(freguesias), len(seccoes)))
    bad = [f["name"] for f in freguesias.values() if median_age(f) is None]
    print("גיל חציוני חושב ל-%d מתוך %d רובעים%s"
          % (len(freguesias) - len(bad), len(freguesias),
             ("; ללא: " + ", ".join(bad[:5])) if bad else ""))
    for code, m in sorted(municipios.items()):
        kids = [f for f in freguesias.values() if f["mun"] == code]
        s = sum(f.get("N_INDIVIDUOS", 0) for f in kids)
        flag = "" if s == m.get("N_INDIVIDUOS") else "  ← לא מסתדר!"
        print("  %s %-22s %7d = סכום %d רובעים%s"
              % (code, m["name"], m.get("N_INDIVIDUOS", 0), len(kids), flag))
    return 0


if __name__ == "__main__":
    sys.exit(main())
