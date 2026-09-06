#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bundle the whole app into one self-contained .html file.

The result needs no server, no network and no install step: open it from the
phone's Files app, from a chat attachment, or from any host, and it works.
Everything is inlined — Leaflet, the stylesheet, the app code and all six data
files.  The only thing it cannot carry is the OpenStreetMap background layer
(millions of tiles); without it the map draws the boundaries, which are local.

    python3 scripts/bundle_standalone.py [-o porto-standalone.html]
"""
import argparse
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DATA_FILES = [
    "data/processed/indicators.json",
    "data/processed/municipios.json",
    "data/processed/freguesias.json",
    "data/processed/porto_city.json",
    "data/processed/zones.json",
    "data/sources.json",
    "data/processed/boundaries_municipios.geojson",
    "data/processed/boundaries_water.geojson",
    "data/processed/boundaries_green.geojson",
    "data/processed/boundaries_belts.geojson",
    "data/processed/boundaries_freguesias.geojson",
    "data/processed/boundaries_porto_city.geojson",
]


def read(rel):
    return open(os.path.join(ROOT, rel), encoding="utf-8").read()


def safe_json(obj):
    """JSON that can sit inside a <script> block without closing it early."""
    return (json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
            .replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


def body_of(page):
    m = re.search(r"<body[^>]*>(.*)</body>", page, re.S)
    if not m:
        raise SystemExit("could not find the body of index.html")
    return m.group(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default="porto-standalone.html")
    ap.add_argument("--fragment", action="store_true",
                    help="emit body content only, for a host that supplies its "
                         "own <html>/<head>/<body> wrapper")
    args = ap.parse_args()

    page = read("index.html")
    payload = {rel: json.loads(read(rel)) for rel in DATA_FILES}

    if args.fragment:
        out = os.path.join(ROOT, args.out)
        with open(out, "w", encoding="utf-8") as fh:
            fh.write(
                "<title>אטלס מחוז פורטו</title>\n"
                # the wrapper owns <html>, so set the direction from script
                "<script>document.documentElement.lang='he';"
                "document.documentElement.dir='rtl';</script>\n"
                '<style>\n' + read("vendor/leaflet.css") + '\n</style>\n'
                '<style>\n' + read("app.css") + '\n</style>\n'
                '<script>window.PORTO_DATA=' + safe_json(payload) + ';</script>\n'
                + body_of(page)
                .replace('<script src="vendor/leaflet.js"></script>', '')
                .replace('<script src="app.js"></script>', '')
                + '\n<script>\n' + read("vendor/leaflet.js") + '\n</script>\n'
                + '<script>\n' + read("app.js") + '\n</script>\n'
            )
        print("wrote %s  (%.1f KB, fragment)" % (args.out, os.path.getsize(out) / 1024))
        return

    inline = (
        '<script>window.PORTO_DATA=' + safe_json(payload) + ';</script>\n'
        '<style>\n' + read("vendor/leaflet.css") + '\n</style>\n'
        '<style>\n' + read("app.css") + '\n</style>\n'
    )
    scripts = (
        '<script>\n' + read("vendor/leaflet.js") + '\n</script>\n'
        '<script>\n' + read("app.js") + '\n</script>\n'
    )

    # swap the external references for the inlined copies
    page = page.replace('<link rel="stylesheet" href="vendor/leaflet.css">\n', '')
    page = page.replace('<link rel="stylesheet" href="app.css">', inline.rstrip())
    page = page.replace('<script src="vendor/leaflet.js"></script>\n'
                        '<script src="app.js"></script>', scripts.rstrip())
    # a single file has no manifest and no icon files to point at
    page = re.sub(r'\s*<link rel="(?:manifest|icon|apple-touch-icon)"[^>]*>', '', page)
    page = page.replace('טוען את נתוני המחוז…', 'טוען…')

    for leftover in ('href="app.css"', 'src="app.js"', 'src="vendor/leaflet.js"'):
        if leftover in page:
            raise SystemExit("inlining failed, %s still referenced" % leftover)

    out = os.path.join(ROOT, args.out)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(page)
    print("wrote %s  (%.1f KB)" % (args.out, os.path.getsize(out) / 1024))


if __name__ == "__main__":
    main()
