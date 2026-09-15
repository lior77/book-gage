#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download INE's urban-area typology, TIPAU 2025, as a category export.

INE keeps the typology in its meta-information system (smi.ine.pt) as
classification version V05635, "Tipologia de áreas urbanas, 2025": three
levels — APU / AMU / APR, the named urban areas, and every parish in the
country by its six-digit code.  There is no plain file to fetch: the export is
a form posted from the version's category page, bound to the session that
opened it, so this script opens the page first and posts the form the browser
would, asking for the whole list in CSV.  The reply is UTF-16; it is stored as
UTF-8 so diffs stay readable.

    python3 scripts/fetch_tipau.py            # writes data/raw/ine/tipau2025_v05635.csv

Reference: 76.ª Deliberação da Secção Permanente de Coordenação Estatística,
Diário da República, 2.ª série, n.º 96, 20 May 2025.  Base: CAOP 2020.
"""
import hashlib
import http.cookiejar
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data", "raw", "ine", "tipau2025_v05635.csv")
REPORT = os.path.join(ROOT, "data", "raw", "ine", "fetch_report.json")

VERSION_ID = "5635"                # smi.ine.pt/Versao/Detalhes/5635 — V05635
PAGE = "https://smi.ine.pt/Categoria/Index_Exportacao?clear=True&VersaoID=" + VERSION_ID
POST = "https://smi.ine.pt/Categoria/Exportacao"
# the ids of the three levels and of the first and last category, as the form
# on that page lists them; they belong to this version and to no other
FORM = {
    "VersaoID": VERSION_ID, "IsFloating": "True", "DataFimFloating": "",
    "tipo": "2",                                   # 0 xlsx · 1 xml · 2 csv
    "TipoExportacao": "Total",
    "NivelOrigem.NID": "10454", "NivelOrigem.Descricao": "1 - Tipologia", "NivelOrigem.Required": "False",
    "CategoriaOrigem.NID": "5417686", "CategoriaOrigem.Descricao": "APU - Área predominantemente urbana",
    "CategoriaOrigem.Required": "False",
    "NivelDestino.NID": "10456", "NivelDestino.Descricao": "3 - Freguesia", "NivelDestino.Required": "False",
    "CategoriaDestino.NID": "5419394", "CategoriaDestino.Descricao": "APR - Área predominantemente rural",
    "CategoriaDestino.Required": "False",
    "IncluirNotas": "false",
}


def main():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [("User-Agent", "Mozilla/5.0 (portoland fetch_tipau)")]
    opener.open(PAGE, timeout=90).read()             # the session the form is bound to
    form = dict(FORM)
    form["DataRef_Export"] = datetime.now().strftime("%d/%m/%Y")
    body = urllib.parse.urlencode(form).encode("utf-8")
    with opener.open(urllib.request.Request(POST, data=body), timeout=600) as r:
        ctype = r.headers.get("Content-Type", "")
        raw = r.read()
    if "text/csv" not in ctype:
        sys.exit("expected text/csv, got %s (%d bytes)" % (ctype, len(raw)))
    text = raw.decode("utf-16")
    lines = text.splitlines()
    parishes = sum(1 for l in lines if l.startswith("3,"))
    porto = sum(1 for l in lines if l.startswith("3,13"))
    if parishes < 3000 or porto != 243:
        sys.exit("unexpected shape: %d parish rows, %d in the Porto district" % (parishes, porto))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    sha = hashlib.sha256(open(OUT, "rb").read()).hexdigest()
    report = json.load(open(REPORT, encoding="utf-8")) if os.path.exists(REPORT) else []
    report = [r for r in report if r.get("file") != os.path.basename(OUT)]
    report.append({
        "file": os.path.basename(OUT),
        "dataset": "Tipologia de áreas urbanas, 2025 (TIPAU 2025) — versão V05635, exportação de categorias, níveis 1–3",
        "rows": parishes, "porto_district_rows": porto,
        "extracted": datetime.now(timezone.utc).astimezone().isoformat(timespec="milliseconds"),
        "page": PAGE, "post": POST, "sha256": sha,
    })
    json.dump(report, open(REPORT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("wrote %s: %d parish rows, %d in the Porto district, sha256 %s" % (OUT, parishes, porto, sha[:12]))


if __name__ == "__main__":
    main()
