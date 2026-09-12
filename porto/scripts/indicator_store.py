#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared helper: write indicator values into data/raw/extra_indicators.json.

build.py reads that file and merges whatever it finds into the app data, so any
of the fetch_*/import_* scripts can fill in one indicator at a time and the app
picks it up on the next build.

File shape:

    {
      "median_age": {
        "meta": {"label_he": "...", "unit": "שנים", "reference_year": 2021,
                 "source_he": "...", "url": "...", "retrieved": "2026-09-05"},
        "municipios": {"Porto": 46.8, ...},
        "freguesias": {"Porto|Ramalde": 45.1, ...}
      }
    }

Keys are the official Portuguese names used by CAOP 2020 (the same strings the
app shows), so a value can never be attached to the wrong place silently: a name
that does not resolve is reported and skipped.
"""
import json
import os
import re
import sys
import unicodedata
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw")
STORE = os.path.join(RAW, "extra_indicators.json")

MUNICIPALITIES = [
    "Porto", "Vila Nova de Gaia", "Matosinhos", "Maia", "Gondomar", "Valongo",
    "Vila do Conde", "Póvoa de Varzim", "Santo Tirso", "Trofa", "Paredes",
    "Penafiel", "Paços de Ferreira", "Lousada", "Felgueiras", "Amarante",
    "Marco de Canaveses", "Baião",
]
# INE municipality codes, from the ref:ine tags on the OSM boundary relations.
INE_CODE = {
    "1301": "Amarante", "1302": "Baião", "1303": "Felgueiras", "1304": "Gondomar",
    "1305": "Lousada", "1306": "Maia", "1307": "Marco de Canaveses",
    "1308": "Matosinhos", "1309": "Paços de Ferreira", "1310": "Paredes",
    "1311": "Penafiel", "1312": "Porto", "1313": "Póvoa de Varzim",
    "1314": "Santo Tirso", "1315": "Trofa", "1316": "Vila do Conde",
    "1317": "Vila Nova de Gaia", "1318": "Valongo",
}
_STOP = {"de", "do", "da", "dos", "das", "e"}


def norm(s):
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(w for w in s.split() if w not in _STOP)


_BY_NORM = {norm(m): m for m in MUNICIPALITIES}


def resolve_municipio(label):
    """Map a name or an INE code from an outside table to the canonical name."""
    label = str(label).strip()
    if label in INE_CODE:
        return INE_CODE[label]
    digits = re.sub(r"\D", "", label)
    if digits in INE_CODE:
        return INE_CODE[digits]
    return _BY_NORM.get(norm(label))


def freguesia_index():
    """{normalised parish name: "Municipio|Parish"} over all 243 parishes."""
    path = os.path.join(ROOT, "data", "processed", "freguesias.json")
    if not os.path.exists(path):
        return {}
    out = {}
    for f in json.load(open(path, encoding="utf-8"))["items"]:
        out.setdefault(norm(f["pt"]), []).append("%s|%s" % (f["mun"], f["pt"]))
        out.setdefault("%s %s" % (norm(f["mun"]), norm(f["pt"])),
                       []).append("%s|%s" % (f["mun"], f["pt"]))
    return {k: v for k, v in out.items() if len(v) == 1}


def load():
    if os.path.exists(STORE):
        return json.load(open(STORE, encoding="utf-8"))
    return {}


def save(key, meta, municipios=None, freguesias=None):
    """Merge one indicator into the store and report coverage."""
    if not municipios and not freguesias:
        sys.exit("refusing to write %s: no values" % key)
    store = load()
    entry = store.setdefault(key, {})
    entry["meta"] = dict(meta)
    entry["meta"].setdefault("retrieved", date.today().isoformat())
    for name, values in (("municipios", municipios), ("freguesias", freguesias)):
        if values:
            merged = entry.get(name, {})
            merged.update({k: v for k, v in values.items() if v is not None})
            entry[name] = merged
    os.makedirs(RAW, exist_ok=True)
    with open(STORE, "w", encoding="utf-8") as fh:
        # indent only, never sort_keys. The file is 4,000 lines; sorting it
        # turns "one indicator added" into a whole-file reorder, and a diff
        # nobody can read is a diff nobody checks. Section 11.
        json.dump(store, fh, ensure_ascii=False, indent=1)
    n_m = len(entry.get("municipios", {}))
    n_f = len(entry.get("freguesias", {}))
    print("wrote %s -> %s   municipalities %d/18, freguesias %d/243"
          % (key, os.path.relpath(STORE, ROOT), n_m, n_f))
    if n_m and n_m < 18:
        print("  missing: %s" % ", ".join(m for m in MUNICIPALITIES
                                          if m not in entry.get("municipios", {})))
    print("  now run:  python3 scripts/build.py && python3 scripts/checks.py")
