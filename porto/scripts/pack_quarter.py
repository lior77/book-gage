#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pack one published quarter into a file the app can fetch after it shipped.

    python3 scripts/pack_quarter.py                 # the newest quarter in the CSVs
    python3 scripts/pack_quarter.py --period 2026Q1
    python3 scripts/pack_quarter.py --all           # every quarter, for testing

Move יא.1 of docs/INFORMATION-PLAN.md.  INE publishes a new quarter roughly
every three months, and until now it reached a reader ONLY in a new APK —
half a year of waiting on a number that already exists.

WHERE IT IS HOSTED, AND WHY NOT WHERE THE PLAN SAID.  The plan chose GitHub
Releases, "already used for the APK, free, no login, a fixed address".  It
cannot be used: a release download sends no Access-Control-Allow-Origin, so a
WebView cannot fetch it — which is precisely why the constraint layers live in
the repository and are served through jsDelivr with raw.githubusercontent as a
fallback.  That is already built, already tested, and already on the list of
what needs a network, so the quarter files go the same way: into the
repository, out through the same two hosts.  No new host, nothing new to
promise.

WHAT THE HASH DOES AND DOES NOT PROVE.  index.json publishes a sha256 per
file and the app refuses a file that does not match it, which catches a
truncated download, a corrupted cache and a mangled proxy.  It does NOT prove
who wrote the file: the index and the file come from the same place, so
anyone who could replace one could replace both.  Closing that needs a
signature and a public key inside the app, and that is a decision nobody has
taken — it is written down in ARCHITECTURE.md §12 rather than improvised
here.  What the app does instead is check the CONTENT against what it already
holds, which no substitution can fake without being obviously wrong: a newer
period than everything shipped, only units this atlas draws, and no change to
any quarter already in the bundle.
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw", "ine")
PROC = os.path.join(ROOT, "data", "processed")
OUT = os.path.join(ROOT, "data", "quarter")

# The same four series the app draws, and the same names it stores them under.
SERIES = [("sale", "ine_precos_venda.csv", "Total"),
          ("sale_new", "ine_precos_venda.csv", "Novos"),
          ("sale_used", "ine_precos_venda.csv", "Existentes"),
          ("rent", "ine_rendas.csv", None)]

PERIOD = re.compile(r"^\d{4}Q[1-4]$")


def read_series():
    """Every (series, unit key, period) -> value in the two CSVs.

    The unit key is the app's: 'm' or 'f' and the DICOFRE, which is how
    series.json is keyed.  Nothing is filtered here; the district filter is
    applied against the units the app actually draws, below.
    """
    out = {}
    for name, fname, dwelling in SERIES:
        path = os.path.join(RAW, fname)
        if not os.path.exists(path):
            sys.exit("missing %s" % path)
        with io.open(path, encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                if dwelling and (row.get("dwelling_type") or "") != dwelling:
                    continue
                code = (row.get("dicofre") or "").strip()
                per = (row.get("period") or "").strip()
                val = (row.get("value_eur_m2") or "").strip()
                lvl = (row.get("geo_level") or "").strip()
                if not code or not PERIOD.match(per) or not val or val == "-":
                    continue
                try:
                    v = float(val)
                except ValueError:
                    continue
                key = ("m" if lvl == "municipio" else "f") + code
                out.setdefault(per, {}).setdefault(key, {})[name] = v
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--period", help="which quarter (default: the newest published)")
    ap.add_argument("--all", action="store_true", help="every quarter in the CSVs")
    args = ap.parse_args()

    series = json.load(io.open(os.path.join(PROC, "series.json"), encoding="utf-8"))
    drawn = set(series["units"])          # the units this atlas has a screen for
    by_period = read_series()
    if not by_period:
        sys.exit("no quarters in the CSVs")

    if args.all:
        periods = sorted(by_period)
    elif args.period:
        if args.period not in by_period:
            sys.exit("%s is not in the CSVs (newest is %s)"
                     % (args.period, max(by_period)))
        periods = [args.period]
    else:
        periods = [max(by_period)]

    os.makedirs(OUT, exist_ok=True)
    made = []
    for per in periods:
        units = {}
        for key, vals in sorted(by_period[per].items()):
            if key not in drawn:
                continue                   # a unit with no screen is not shipped
            units[key] = {k: vals[k] for k in sorted(vals)}
        body = {
            "portoland_quarter": 1,
            "period": per,
            # The app stores what arrives as `reported` with this period as its
            # reference, exactly like the quarters in the bundle — a fetched
            # number is a number like any other and carries the same record.
            "source": series["meta"]["source_he"],
            "datasets": series["meta"]["datasets"],
            "window_he": series["meta"]["window_he"],
            "confidence": "reported",
            "units": units,
        }
        # Separators fixed and keys sorted, so the same input gives the same
        # bytes and therefore the same sha256 — §7ai's rule, applied here.
        text = json.dumps(body, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"))
        raw = text.encode("utf-8")
        name = "%s.json" % per
        io.open(os.path.join(OUT, name), "w", encoding="utf-8").write(text)
        made.append({"period": per, "file": name, "bytes": len(raw),
                     "sha256": hashlib.sha256(raw).hexdigest(),
                     "units": len(units)})
        print("%s  %d units  %d bytes" % (per, len(units), len(raw)))

    # The index is the whole list, not only what this run made: a reader with
    # an older build has to be able to see every quarter published since.
    idx_path = os.path.join(OUT, "index.json")
    known = {}
    if os.path.exists(idx_path):
        try:
            for q in json.load(io.open(idx_path, encoding="utf-8"))["quarters"]:
                known[q["period"]] = q
        except Exception:
            known = {}
    for q in made:
        known[q["period"]] = q
    layers = json.load(io.open(os.path.join(ROOT, "data", "layers_manifest.json"),
                               encoding="utf-8"))
    idx = {
        "portoland_quarters": 1,
        # The same two hosts the constraint layers already use, so nothing new
        # is promised and §7ab has nothing new to check.
        "base": layers["base"].replace("/data/layers/", "/data/quarter/"),
        "fallback": layers["fallback"].replace("/data/layers/", "/data/quarter/"),
        "quarters": [known[p] for p in sorted(known)],
    }
    io.open(idx_path, "w", encoding="utf-8").write(
        json.dumps(idx, ensure_ascii=False, indent=1) + "\n")
    print("index: %d quarters" % len(idx["quarters"]))


if __name__ == "__main__":
    main()
