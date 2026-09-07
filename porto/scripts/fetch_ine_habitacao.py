#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pull INE's local housing price and rent series, every quarter, every geography.

    python3 scripts/fetch_ine_habitacao.py --out data/raw/ine

Two indicators, both quarterly, both a median over the trailing twelve months:

    0012234  Valor mediano das vendas de alojamentos familiares (€/m²)
             Metodologia 2022, from 2019Q4, by dwelling category
    0014696  Valor mediano das rendas de novos contratos de arrendamento (€/m²)
             Metodologia 2026, from 2020Q1, no dwelling breakdown

One data call returns every geography INE publishes the quarter for, so the
loop is one request per quarter and not per municipality.

Geography codes are INE's own NUTS-2024 codes and are written out unchanged.
They are structured as <NUTS3><DICOFRE>: a 7-character municipality code is a
3-character NUTS III prefix plus the 4-digit DICO, and a 9-character freguesia
code is that prefix plus the 6-digit DICOFRE.  `dicofre` is added as a separate
column by stripping the prefix — the source code stays in `geo_code` so a join
can be checked against either.

Freguesia-level values exist only where INE publishes them: the note on the
geography dimension limits that to the Porto and Lisbon metropolitan areas,
Setúbal, the Algarve, and municipalities over 100k residents.  For the Porto
district that means the AMP municipalities have parish rows and the Tâmega e
Sousa ones (Amarante, Baião, Felgueiras, Lousada, Marco de Canaveses, Paços de
Ferreira, Penafiel) stop at the municipality.  Nothing is filled in for the
rest; a geography INE omits is simply absent.

Statistical secrecy: INE withholds a value where the transaction count is too
small.  Those rows come back with an empty `valor`, and are written with an
empty `value_eur_m2` and the source's own marker in `flag`.
"""
import argparse
import csv
import hashlib
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

META = "https://www.ine.pt/ine/json_indicador/pindicaMeta.jsp?varcd=%s&lang=PT"
DATA = "https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd=%s&Dim1=%s&lang=PT"

INDICATORS = {
    "0012234": {
        "out": "ine_precos_venda.csv",
        "what": "sale prices",
        # The title the metadata must carry, so a silent renumbering is caught.
        "expect": "Valor mediano das vendas de alojamentos familiares",
    },
    "0014696": {
        "out": "ine_rendas.csv",
        "what": "new-contract rents",
        "expect": "Valor mediano das rendas de novos contratos de arrendamento",
    },
}

UA = "porto-district-app/1.0 (https://github.com/lior77/book-gage)"

# Seconds between data calls.  INE tolerates a slow trickle and starts
# refusing the TLS handshake outright after a burst of a dozen or so, so the
# loop crawls and every answer is cached; a run that gets cut off resumes at
# the quarter it stopped on instead of re-asking for the ones it already has.
PAUSE = 20
COOLDOWN = 300


def get(url, cache=None, tries=6):
    """One GET, cached on disk, with a backoff long enough to sit out a block.

    INE rejects HEAD outright, so never probe with one.  It also stops
    completing the TLS handshake after a burst of requests; the backoff here
    climbs into the minutes because the block lifts on its own and retrying
    fast only extends it.
    """
    if cache and os.path.exists(cache):
        with open(cache, encoding="utf-8") as fh:
            return json.load(fh)

    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "application/json, text/plain, */*",
            })
            with urllib.request.urlopen(req, timeout=180) as r:
                payload = json.loads(r.read().decode("utf-8"))
            if cache:
                os.makedirs(os.path.dirname(cache), exist_ok=True)
                with open(cache, "w", encoding="utf-8") as fh:
                    json.dump(payload, fh, ensure_ascii=False)
            return payload
        except Exception as exc:      # noqa: BLE001 - report and retry
            last = exc
            if attempt < tries - 1:
                wait = min(COOLDOWN, 15 * 2 ** attempt)
                sys.stdout.write("\n   %s; waiting %ds before retry %d/%d"
                                 % (str(exc)[:60], wait, attempt + 2, tries))
                sys.stdout.flush()
                time.sleep(wait)
    raise SystemExit(
        "\ngiving up on %s\n  %s\n"
        "Answers already fetched are cached, so re-running resumes there."
        % (url, last))


PERIOD_RE = re.compile(r"^(\d)\.º Trimestre de (\d{4})$")


def period_label(categ_dsg):
    """'1.º Trimestre de 2026' -> '2026Q1'.

    Read off the human label rather than the cat_id: the id is 'S5A20261',
    where the leading 'S5A' is a series prefix whose digits would otherwise
    be mistaken for part of the year.
    """
    m = PERIOD_RE.match(categ_dsg)
    if not m:
        raise SystemExit("unexpected period label from INE: %r" % categ_dsg)
    quarter, year = m.groups()
    return "%sQ%s" % (year, quarter)


def dicofre(geo_code, level):
    """Strip INE's NUTS III prefix off a level-5 or level-6 geography code.

    Municipality codes are 7 characters (3 + DICO 4), freguesia codes 9
    (3 + DICOFRE 6).  Anything else is a NUTS or country row and has no
    DICOFRE at all.
    """
    if level == "5" and len(geo_code) == 7:
        return geo_code[3:]
    if level == "6" and len(geo_code) == 9:
        return geo_code[3:]
    return ""


def collect(varcd, outdir, cachedir):
    spec = INDICATORS[varcd]
    meta = get(META % varcd, os.path.join(cachedir, "%s_meta.json" % varcd))[0]

    title = meta["IndicadorNome"]
    if spec["expect"] not in title:
        raise SystemExit(
            "indicator %s is not what this script expects.\n"
            "  metadata says: %s\n"
            "  expected to contain: %s\n"
            "Verify the code against INE's catalogue before trusting the numbers."
            % (varcd, title, spec["expect"]))
    print("%s  %s" % (varcd, title[:100]))
    print("   %s .. %s, %s, %s"
          % (meta["PrimeiroPeriodo"], meta["UltimoPeriodo"],
             meta["Periodic"], meta["UnidadeMedida"]))

    cats = meta["Dimensoes"]["Categoria_Dim"][0]
    periods, levels = [], {}
    for entries in cats.values():
        e = entries[0]
        if e["dim_num"] == "1":
            periods.append(e)
        elif e["dim_num"] == "2":
            levels[e["cat_id"]] = (e["categ_nivel"], e["categ_dsg"])
    periods.sort(key=lambda e: int(e["categ_ord"]))
    print("   %d quarters, %d geographies" % (len(periods), len(levels)))

    rows, seen_flags = [], {}
    for i, p in enumerate(periods, 1):
        cache = os.path.join(cachedir, "%s_%s.json" % (varcd, p["cat_id"]))
        if i > 1 and not os.path.exists(cache):
            time.sleep(PAUSE)
        payload = get(DATA % (varcd, p["cat_id"]), cache)[0]
        block = payload["Dados"][p["categ_dsg"]]
        label = period_label(p["categ_dsg"])
        for r in block:
            code = r["geocod"]
            level, _ = levels.get(code, ("", ""))
            value = (r.get("valor") or "").strip()
            raw = (r.get("ind_string") or "").strip()
            # A row with no numeric value carries INE's own marker in
            # ind_string.  Keep the marker, leave the value empty.
            flag = "" if value else raw
            if flag:
                seen_flags[flag] = seen_flags.get(flag, 0) + 1
            rows.append({
                "geo_code": code,
                "dicofre": dicofre(code, level),
                "geo_name": r["geodsg"],
                "geo_level": {"1": "pais", "2": "continente", "3": "nuts2",
                              "4": "nuts3", "5": "municipio",
                              "6": "freguesia"}.get(level, level),
                "period": label,
                "value_eur_m2": value,
                "dwelling_type": r.get("dim_3_t", ""),
                "flag": flag,
            })
        sys.stdout.write("\r   %2d/%d  %s  (%d rows)"
                         % (i, len(periods), label, len(rows)))
        sys.stdout.flush()
    print()
    if seen_flags:
        print("   withheld/marked values:",
              ", ".join("%r x%d" % kv for kv in sorted(seen_flags.items())))

    path = os.path.join(outdir, spec["out"])
    cols = ["geo_code", "dicofre", "geo_name", "geo_level", "period",
            "value_eur_m2", "dwelling_type", "flag"]
    with open(path, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)

    with open(path, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    print("   -> %s  (%d rows, sha256 %s)" % (path, len(rows), digest[:16]))

    return {
        "file": spec["out"],
        "indicator_code": varcd,
        "dataset": title,
        "rows": len(rows),
        "periods": [period_label(periods[0]["categ_dsg"]),
                    period_label(periods[-1]["categ_dsg"])],
        "units": meta["UnidadeMedida"],
        "publication_date": meta["DataUltimaAtualizacao"],
        "extracted": meta["DataExtracao"],
        "api_call": DATA % (varcd, "<trimestre>"),
        "meta_call": META % varcd,
        "missing_markers": seen_flags,
        "sha256": digest,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "raw", "ine"))
    ap.add_argument("--cache", default=os.path.join(ROOT, "data", "raw", "ine", ".cache"),
                    help="where raw API answers are kept so a run can resume")
    ap.add_argument("--varcd", action="append", choices=sorted(INDICATORS),
                    help="default: both")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.cache, exist_ok=True)
    report = [collect(v, args.out, args.cache)
              for v in (args.varcd or sorted(INDICATORS))]

    path = os.path.join(args.out, "fetch_report.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print("\nwrote %s" % path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
