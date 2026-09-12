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
import time
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


def get(url, tries=5):
    """INE answers, then rate-limits, then answers again.

    The same URL returns 200 and 500 minutes apart, and a 500 here is not "the
    indicator is gone" — it is "ask again in a moment". Without the retry this
    script fails on a working source and the failure reads like a missing
    dataset, which is exactly the mistake this project already made once about
    INE being blocked at all.
    """
    req = urllib.request.Request(url, headers={
        "User-Agent": "porto-district-app/1.0 (data completion script)",
        "Accept": "application/json, text/plain, */*",
    })
    last = None
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=120) as fh:
                raw = fh.read()
            break
        except Exception as exc:            # HTTPError, URLError, timeouts alike
            last = exc
            if attempt == tries - 1:
                raise
            wait = 4 * (attempt + 1)
            print("  %s — retrying in %ds (%d/%d)"
                  % (exc, wait, attempt + 2, tries), file=sys.stderr)
            time.sleep(wait)
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
        # the metadata endpoint says IndicadorNome; the data endpoint says
        # IndicadorDsg. Reading only one of them made --expect refuse every
        # write, which is the safe direction to fail but still a bug.
        for k in ("IndicadorNome", "IndicadorDsg", "title", "Indicador"):
            if meta.get(k):
                return str(meta[k])
    return ""


def rows_of(doc, period, want=None):
    """Yield (geocod, geodsg, value) from a pindica.jsp response.

    `want` is a {dimension: category} filter.  Most INE indicators carry more
    than the number you came for — the crime rate arrives split into six
    categories plus a total, all under the same municipality code — and without
    a filter the last row silently wins.  A wrong category looks exactly like a
    right one, so the filter is required rather than optional whenever the
    response has extra dimensions.
    """
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
        if want and any(str(row.get(k)) != v for k, v in want.items()):
            continue
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
    ap.add_argument("--dim", action="append", default=[], metavar="dim_3=T",
                    help="keep only rows whose dimension has this category; "
                         "repeatable. Use --dims to see what a response carries")
    ap.add_argument("--dims", action="store_true",
                    help="list the dimensions and categories in the response "
                         "and exit, without writing anything")
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

    # --dims only looks; it must not pass through the confirmation prompt, or it
    # blocks on stdin in a script that was meant to print and exit.
    if args.dims:
        doc = get(DATA % (args.varcd, args.period))
        block = (doc[0] if isinstance(doc, list) else doc).get("Dados", {})
        rows = list(block.values())[0] if block else []
        seen = {}
        for r in rows:
            for k in r:
                if re.fullmatch(r"dim_\d+", k):
                    seen.setdefault(k, {}).setdefault(str(r[k]), r.get(k + "_t", ""))
        for k in sorted(seen):
            print("%s:" % k)
            for cat, label in seen[k].items():
                print("   %-4s %s" % (cat, label))
        if not seen:
            print("no extra dimensions — the response is one value per place")
        return 0

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

    want = {}
    for spec in args.dim:
        if "=" not in spec:
            sys.exit("--dim wants dim_3=T, got %r" % spec)
        k, v = spec.split("=", 1)
        want[k] = v

    values, unresolved = {}, []
    for geocod, geodsg, val in rows_of(doc, args.period, want or None):
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
        "dimension_he": ", ".join("%s=%s" % kv for kv in sorted(want.items())) or None,
    }, municipios=values)
    return 0


if __name__ == "__main__":
    sys.exit(main())
