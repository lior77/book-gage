#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pull a municipality-level indicator from the INE (Statistics Portugal) API.

Run this on a machine with open network access — the environment this repo was
built in blocks ine.pt, which is exactly why the numbers are missing.

The API
-------
    metadata:  https://www.ine.pt/ine/json_indicador/pindicaMeta.jsp?varcd=<code>&lang=PT
    data:      https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd=<code>&Dim1=<period>&lang=PT

One data call returns every geography the indicator is published for, all 308
municipalities included, so a single request fills a whole column.

Typical session
---------------
    # 1. find the indicator you want in INE's catalogue and note its varcd
    python3 scripts/fetch_ine.py --search "idade mediana"

    # 2. read its metadata: which dimensions and which periods exist
    python3 scripts/fetch_ine.py --meta 0008273

    # 3. pull it and store it under one of the app's indicator keys
    python3 scripts/fetch_ine.py --varcd 0008273 --period 2021 \
        --key median_age --label "גיל חציוני" --unit "שנים" --year 2021

    # 4. rebuild
    python3 scripts/build.py && python3 scripts/checks.py

`--indicator median_age|income|foreign` is a shortcut that pre-fills key/label/
unit and a *candidate* varcd.  Those candidates could not be verified from the
build environment, so the script always prints the indicator's own title from
the metadata and refuses to write unless you confirm with --yes, or the title
matches --expect.
"""
import argparse
import json
import re
import sys
import urllib.parse
import urllib.request

import indicator_store as store

META = "https://www.ine.pt/ine/json_indicador/pindicaMeta.jsp?varcd=%s&lang=PT"
DATA = "https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd=%s&Dim1=%s&lang=PT"
SEARCH = ("https://www.ine.pt/xportal/xmain?xpid=INE&xpgid=ine_pesquisa"
          "&frm_accao=PESQUISAR&frm_modo_pesquisa=PESQUISA_SIMPLES"
          "&frm_texto=%s&frm_area=o_ine_area_BaseDados&xlang=pt")

# key -> (candidate varcd, label_he, unit, note).  UNVERIFIED, see docstring.
PRESETS = {
    "median_age": (None, "גיל חציוני", "שנים",
                   "INE publishes 'Idade mediana da população residente' by "
                   "municipality; PORDATA mirrors it as indicator 6."),
    "income": (None, "הכנסה חציונית", "€/שנה",
               "Look for 'Rendimento bruto declarado por sujeito passivo de IRS' "
               "or 'Ganho medio mensal'. Note which one you picked — they are "
               "different things and must not be mixed in one column."),
    "foreign": (None, "אחוז תושבים זרים", "%",
                "'População estrangeira com estatuto legal de residente' divided "
                "by resident population. AIMA (ex-SEF) is the primary source."),
}


def get(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "porto-district-app/1.0 (data completion script)",
        "Accept": "application/json, text/plain, */*",
    })
    with urllib.request.urlopen(req, timeout=90) as fh:
        raw = fh.read()
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return raw.decode("utf-8", "replace")


def show_meta(varcd):
    doc = get(META % varcd)
    print(json.dumps(doc, ensure_ascii=False, indent=1)[:6000])
    return doc


def indicator_title(meta):
    if isinstance(meta, list) and meta:
        meta = meta[0]
    if isinstance(meta, dict):
        for k in ("IndicadorDsg", "title", "Indicador"):
            if meta.get(k):
                return str(meta[k])
    return ""


def rows_of(doc, period):
    """Yield (geocod, geodsg, value) from a pindica.jsp response."""
    if isinstance(doc, list):
        doc = doc[0] if doc else {}
    dados = doc.get("Dados") or {}
    block = dados.get(period)
    if block is None and len(dados) == 1:
        block = list(dados.values())[0]
    if not block:
        sys.exit("no data for period %r; periods available: %s"
                 % (period, sorted(dados)))
    for row in block:
        val = row.get("valor", row.get("Valor"))
        if val in (None, "", "x", "//", "-"):
            continue
        try:
            val = float(str(val).replace(",", "."))
        except ValueError:
            continue
        yield str(row.get("geocod", "")), str(row.get("geodsg", "")), val


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--search", metavar="TEXT", help="print INE's search URL for TEXT")
    ap.add_argument("--meta", metavar="VARCD", help="dump indicator metadata")
    ap.add_argument("--varcd")
    ap.add_argument("--period", default="2021")
    ap.add_argument("--indicator", choices=sorted(PRESETS))
    ap.add_argument("--key")
    ap.add_argument("--label")
    ap.add_argument("--unit", default="")
    ap.add_argument("--year", type=int)
    ap.add_argument("--scale", type=float, default=1.0,
                    help="multiply every value (e.g. 0.001 for thousands)")
    ap.add_argument("--expect", help="substring the indicator title must contain")
    ap.add_argument("--yes", action="store_true", help="write without confirming")
    args = ap.parse_args()

    if args.search:
        print(SEARCH % urllib.parse.quote(args.search))
        print("open that in a browser, pick the indicator, and read its varcd "
              "from the 'varcd' parameter in the page URL")
        return 0
    if args.meta:
        show_meta(args.meta)
        return 0

    key, label, unit = args.key, args.label, args.unit
    if args.indicator:
        cand, lab, un, note = PRESETS[args.indicator]
        key = key or args.indicator
        label = label or lab
        unit = unit or un
        args.varcd = args.varcd or cand
        print("note: " + note)
    if not args.varcd:
        sys.exit("no varcd. Find it with --search, then pass --varcd.")
    if not key or not label:
        sys.exit("--key and --label are required")

    meta = show_meta(args.varcd)
    title = indicator_title(meta)
    print("\nindicator title: %s" % (title or "(not reported)"))
    if args.expect and args.expect.lower() not in title.lower():
        sys.exit("title does not contain %r — refusing to write" % args.expect)
    if not args.yes and not args.expect:
        ans = input("store this as %r? [y/N] " % key).strip().lower()
        if ans != "y":
            return 1

    doc = get(DATA % (args.varcd, args.period))
    values, unresolved = {}, []
    for geocod, geodsg, val in rows_of(doc, args.period):
        name = store.resolve_municipio(geocod) or store.resolve_municipio(geodsg)
        if name:
            values[name] = round(val * args.scale, 4)
        elif re.fullmatch(r"13\d\d", geocod):
            unresolved.append((geocod, geodsg))
    if unresolved:
        print("unresolved Porto-district rows: %s" % unresolved)
    if len(values) < 18:
        print("WARNING: only %d/18 municipalities matched" % len(values))

    store.save(key, {
        "label_he": label, "unit": unit,
        "reference_year": args.year or int(re.sub(r"\D", "", args.period)[:4] or 0),
        "source_he": "INE — %s (varcd %s, תקופה %s)" % (title or "indicador",
                                                        args.varcd, args.period),
        "url": DATA % (args.varcd, args.period),
    }, municipios=values)
    return 0


if __name__ == "__main__":
    sys.exit(main())
