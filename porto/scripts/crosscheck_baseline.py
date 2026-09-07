#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check the app's own census figures against an independently derived file.

    python3 scripts/crosscheck_baseline.py

Reads:
    data/source_files/ine/Portugal_Property_Baseline_v2.csv
        3 049 parishes on the CAOP 2025 map, with age, ageing, foreign
        nationality, education, unemployment and building figures derived from
        the 2021 census sub-sections by spatial assignment — a different route
        to the same quantities.
    data/source_files/ine/BGRI2021_to_CAOP2025_reassignment.csv
        which 2021 parish each 2025 parish took its sub-sections from
    data/processed/freguesias.json     what the app computed for itself

WHY BOTHER
==========
The project's rule is that a value counts as verified only when a second,
independent source says the same thing. Everything the app derives from the
census — median age, ageing index, the age shares, foreign nationality — comes
out of one file by one method. This baseline comes out of the sub-section data
by another, so agreeing with it is real evidence, and disagreeing with it is
the only cheap way to find a mistake in the derivation.

The comparison is limited to the 218 parishes the 2025 reform left alone,
because those keep the same code and the same outline on both maps. The 25 it
dissolved cannot be compared: on the baseline's map they no longer exist.
"""
import csv
import json
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = os.path.join(ROOT, "data", "source_files", "ine",
                    "Portugal_Property_Baseline_v2.csv")
MOVED = os.path.join(ROOT, "data", "source_files", "ine",
                     "BGRI2021_to_CAOP2025_reassignment.csv")

# app field -> baseline column. Both are rounded to one decimal by the app, so
# anything up to half a step apart is the same number.
PAIRS = [
    ("median_age", "median_age_2021_est", 0.06),
    ("pct_0_14", "pct_age_0_14", 0.06),
    ("pct_65plus", "pct_age_65_plus", 0.06),
    ("ageing_index", "ageing_index", 0.2),
    ("foreign_pct", "foreign_nationality_pct_2021", 0.06),
    ("education_pct", "higher_education_pct_2021", 0.06),
    ("unemployment_pct", "unemployment_rate_2021", 0.06),
]


def main():
    if not os.path.exists(BASE):
        sys.exit("missing %s" % BASE)
    base = {}
    with open(BASE, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            base[row["dtmnfr"]] = row
    # a sub-section that changed parish in 2025 takes its people with it, so a
    # population difference is expected exactly there
    moved = {}
    with open(MOVED, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row["DTMNFR21"] != row["dtmnfr25_point"]:
                moved.setdefault(row["DTMNFR21"], 0)
                moved[row["DTMNFR21"]] += float(row["population_2021"])
                moved.setdefault(row["dtmnfr25_point"], 0)
                moved[row["dtmnfr25_point"]] -= float(row["population_2021"])

    fre = json.load(open(os.path.join(ROOT, "data", "processed",
                                      "freguesias.json"), encoding="utf-8"))["items"]
    rows = [f for f in fre if f.get("dicofre") and "split2025" not in f]
    fail = 0
    print("השוואה מול קובץ עצמאי, %d רובעים שהרפורמה לא נגעה בהם" % len(rows))
    for field, col, tol in PAIRS:
        diffs, worst = [], None
        for f in rows:
            b = base.get(f["dicofre"])
            if not b or f.get(field) is None or not b.get(col):
                continue
            d = abs(f[field] - float(b[col]))
            diffs.append(d)
            if worst is None or d > worst[0]:
                worst = (d, f["pt"])
        if not diffs:
            print("  %-17s לא נבדק" % field)
            continue
        bad = max(diffs) > tol
        fail += bad
        print("  %-17s n=%3d  חציון %.4f  מרבי %.3f (%s)%s"
              % (field, len(diffs), statistics.median(diffs), worst[0], worst[1],
                 "   ← מעל הסף!" if bad else ""))

    same = diff = []
    same, diff = 0, []
    for f in rows:
        b = base.get(f["dicofre"])
        if not b:
            continue
        d = f["pop2021"] - float(b["population_2021"])
        if d == 0:
            same += 1
        else:
            expected = moved.get(f["dicofre"], 0)
            diff.append((f["pt"], f["pop2021"], float(b["population_2021"]),
                         d, expected))
    print("  אוכלוסייה         זהה ב-%d רובעים; שונה ב-%d" % (same, len(diff)))
    for pt, mine, theirs, d, expected in diff:
        ok = abs(d - expected) < 0.5
        fail += not ok
        print("    %-28s %6d מול %6d (הפרש %+d, צפוי %+d)%s"
              % (pt, mine, theirs, d, expected, "" if ok else "   ← לא מוסבר!"))
    print("\n%s" % ("הכל תואם" if not fail else "%d בדיקות נכשלו" % fail))
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
