#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Turn idealista's official connector output into the file Portoland imports.

    python3 scripts/connector_listings.py --in raw/*.json --out listings.json
    python3 scripts/connector_listings.py --in raw/*.json --out listings.json --with-contact

Route 2 of the 2026-09-18 decision: the search happens at idealista, through
THEIR OWN channel, and a file carries the result into the app.

WHY THIS CHANNEL AND NOT A SCRAPER.  idealista's terms forbid systematic
extraction — by a robot "or manual process" — and there is no personal-use
exception in them.  The connector is not an end run around that: it is
idealista's own product for AI assistants, and every URL it returns carries
`utm_source=idGpt&utm_project=leadGeneration`.  They hand over the data and
get the traffic back, which is the exchange the terms exist to protect.  A
paid scraper would return more and would breach that; this does not.

THE PROBLEM THIS SCRIPT ACTUALLY SOLVES, which is not conversion.

The connector returns at most 50 properties per call and has no page
parameter.  Lousada alone has 255 for sale.  So a real search is several
calls over disjoint slices — and the moment a search is made of slices, the
question "did I see everything?" stops being obvious and starts being
something that has to be PROVED.  The connector makes that possible because
it returns `total` alongside the properties: a slice is complete when
`returned >= total`, and it is not complete otherwise, whatever it looks
like on screen.

That is the whole design here.  Every input file is one slice; each is
audited; the output carries the audit; and a harvest with an incomplete
slice in it SAYS SO, in the file and on the screen that draws it.  A list of
forty properties that is silently missing two hundred is the same failure as
a filter that counts a missing value as a pass — it looks like an answer.

HOW TO SLICE, AND THE ONE AXIS THAT LIES.  Municipality x operation x
property type x price band all work: the free-text query is honoured and
comes back reflected in `searchUrl` (`com-preco-max_100000,moradias`).
PARISH DOES NOT.  Asked for "freguesia de Cristelos, Lousada", the geocoder
resolved it to a STREET — `rua-lucia-lousada-cristelos-boim-ordem-lousada` —
and returned `total: 0`.  A zero that means "I looked somewhere else" is
indistinguishable on screen from a zero that means "there is nothing here",
so slices below municipality are not safe and §7at refuses a file whose
slice resolved somewhere other than where it was aimed.

CONTACT DETAILS ARE DROPPED BY DEFAULT.  A listing carries an agent's name
and telephone, which is personal data.  Keeping it for your own search is
ordinary personal use and outside GDPR's scope (Art. 2(2)(c)); putting it in
a file that lands in a public repository is publication, which is not.  The
default is therefore to drop it, and `--with-contact` is a decision somebody
has to take on purpose.
"""
import argparse
import glob
import io
import json
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

OP = {"SALE": "sale", "RENT": "rent"}


def load(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def slice_label(d):
    """What this slice asked for, in the words the connector echoed back.

    `summary` is idealista's own rendering of the filters it applied — which
    is the honest label, because it is what was SEARCHED and not what was
    typed.  A query for a parish that the geocoder turned into a street says
    the street here, and that is exactly the disagreement worth seeing.
    """
    parts = [p for p in (d.get("summary") or []) if p]
    return " · ".join(parts) or (d.get("query") or "")[:80]


def fold(s):
    """Lower case, accents off — "Lousada" has to match "lousada" and
    "Vila Nova de Gaia" has to match "Gaia" written without them."""
    import unicodedata
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


# https://www.idealista.pt/arrendar-casas/<place>/com-preco-max_1500,...
SLUG = re.compile(r"idealista\.[a-z]+/(?:geo/)?[a-z-]*(?:casas|imoveis)/([^/?]+)/")


def aimed_where(d):
    """Did this slice land where it was aimed, or somewhere else entirely?

    This is the one failure mode of slicing that does not look like a failure.
    Asked for "freguesia de Cristelos, Lousada", the connector's geocoder
    resolved it to a STREET — rua-lucia-lousada-cristelos-boim-ordem-lousada —
    and returned `total: 0`.  Asked for "no concelho do Porto" it answered
    about VILA DO CONDE.  A zero that means "I looked somewhere else" is
    indistinguishable on screen from a zero that means "there is nothing
    here", and the second is a fact about the market while the first is a bug.

    THE FIRST VERSION OF THIS FUNCTION READ `locationName`, AND IT WAS WRONG.
    The connector omits that field from EVERY empty answer, including a
    correct one — a real search for flats under 1,000 € in Porto came back
    with the right `searchUrl` and no `locationName` at all.  Read that way,
    the guard rejected honest zeros, which is the same fault it exists to
    prevent, pointed the other way.

    `searchUrl` is the field that is always there and always carries the place
    idealista actually resolved: the slug between the operation and the
    filters.  `locationName` is used when present because it is the tidier
    name; the URL is the fallback, and only when neither can be read does the
    slice fail for want of evidence.
    """
    asked = fold(d.get("query") or "")
    where = d.get("locationName")
    if where:
        head = fold(where).split(",")[0].strip()
        if head and head in asked:
            return None
        return "resolved to %r, which is not in the query" % where
    m = SLUG.search(d.get("searchUrl") or "")
    if not m:
        return ("no locationName and no readable place in the searchUrl — "
                "there is no evidence of where this slice looked")
    slug = m.group(1)
    # "vila-do-conde" -> "vila do conde"; the query has to contain it
    if fold(slug.replace("-", " ")) in asked:
        return None
    return ("the searchUrl says it looked at %r, which is not in the query" % slug)


def item_of(p, op, keep_contact):
    """One connector property in the shape app.js's importListings() reads.

    Mapped from scripts/fixtures/listings_lousada.json, which is the file the
    browser suite imports — so the fixture is the specification and this
    follows it rather than the other way round.
    """
    det = p.get("detailedType") or {}
    typ = "/".join([x for x in (det.get("typology"), det.get("subTypology")) if x])
    imgs = [i.get("url") for i in (p.get("images") or []) if i.get("url")]
    lat, lon = p.get("latitude"), p.get("longitude")
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return None                       # no coordinate, no place on the map
    sug = p.get("suggestedTexts") or {}
    price_info = ((p.get("priceInfo") or {}).get("price") or {})
    it = {
        "code": str(p.get("propertyCode")),
        "url": p.get("url") or "",
        "price": p.get("price"),
        "currency": price_info.get("currencySuffix") or "€",
        "size": p.get("size"),
        "rooms": p.get("rooms"),
        "bathrooms": p.get("bathrooms"),
        "floor": p.get("floor"),
        "type": typ,
        "operation": op,
        "status": p.get("status"),
        "newDevelopment": bool(p.get("isNewDevelopment")),
        "ll": [lat, lon],
        "title": sug.get("title") or "",
        "subtitle": sug.get("subtitle") or "",
        "description": p.get("description") or "",
        "features": p.get("features") or {},
        "thumbnail": p.get("thumbnail") or (imgs[0] if imgs else ""),
        "photos": imgs,
        "numPhotos": len(imgs),
        "priceByArea": p.get("priceByArea"),
        "contact": (p.get("contactInfo") or None) if keep_contact else None,
    }
    return it


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="inputs", nargs="+", required=True,
                    help="connector result files, one per slice (globs allowed)")
    ap.add_argument("--out", required=True, help="the file Portoland imports")
    ap.add_argument("--with-contact", action="store_true",
                    help="keep the agent's name and telephone (see the docstring)")
    ap.add_argument("--allow-partial", action="store_true",
                    help="write the file even though a slice is incomplete; it "
                         "is marked partial and the app says so")
    args = ap.parse_args()

    paths = []
    for pattern in args.inputs:
        hits = sorted(glob.glob(pattern))
        paths.extend(hits or [pattern])
    if not paths:
        sys.exit("no input files")

    slices, items, seen = [], [], {}
    ops = set()
    for path in paths:
        d = load(path)
        if "properties" not in d or "total" not in d:
            sys.exit("%s is not a connector search result (no properties/total)" % path)
        op = OP.get(d.get("operation", "SALE"), "sale")
        ops.add(op)
        props = d.get("properties") or []
        total = int(d.get("total") or 0)
        astray = aimed_where(d)
        if astray:
            sys.exit("%s: %s.\n\nThis is the slicing failure that does not look "
                     "like one: the answer is about a different place, and a "
                     "`total` of 0 from the wrong place reads exactly like a "
                     "market with nothing in it. Name the municipality, never "
                     "the parish — the geocoder resolves parish names to "
                     "streets." % (os.path.basename(path), astray))
        rec = {
            "label": slice_label(d),
            "asked": d.get("query") or "",
            "where": d.get("locationName") or "",
            "url": d.get("searchUrl") or "",
            "operation": op,
            "total": total,
            "returned": len(props),
            "complete": len(props) >= total,
        }
        slices.append(rec)
        for p in props:
            it = item_of(p, op, args.with_contact)
            if not it or not it["code"]:
                continue
            if it["code"] in seen:
                continue
            seen[it["code"]] = True
            items.append(it)

    reported = sum(s["total"] for s in slices)
    unique = len(items)
    bad = [s for s in slices if not s["complete"]]
    # Slices are meant to be disjoint.  When they are, the reported totals add
    # up to the unique count; when they overlap, the difference is the overlap
    # and it is reported rather than hidden — an unexplained gap and a harmless
    # overlap look identical in a single number.
    overlap = max(0, reported - unique) if not bad else None

    print("slices: %d, %d complete" % (len(slices), len(slices) - len(bad)))
    for s in slices:
        print("  %-5s %4d/%-4d %s %s" % (s["operation"], s["returned"], s["total"],
                                         "ok " if s["complete"] else "SHORT",
                                         s["label"][:72]))
    print("reported by idealista: %d · unique properties written: %d" % (reported, unique))
    if bad:
        print("\n%d slice(s) returned fewer properties than idealista says exist. "
              "The connector caps at 50 per call and has no page parameter, so "
              "these have to be split further — by price band, by property type, "
              "or by operation — until each one comes back whole."
              % len(bad))
        if not args.allow_partial:
            sys.exit("refusing to write a file that looks complete and is not. "
                     "Split the short slices, or pass --allow-partial to write it "
                     "marked as partial.")
    elif overlap:
        print("overlap between slices: %d (the same property answered two "
              "slices; it is written once)" % overlap)

    out = {
        "kind": "listings",
        "provider": "idealista",
        "source": "connector",
        "note": ("Read through idealista's official connector. Every URL keeps "
                 "its utm parameters: that is the attribution idealista asks "
                 "for in return, and it is what makes this channel the "
                 "sanctioned one."),
        "read_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "query": {
            "op": sorted(ops)[0] if len(ops) == 1 else "sale",
            "type": "house",
            "where": "district",
            "cap": max([s["returned"] for s in slices] + [0]),
        },
        "coverage": {
            "slices": slices,
            "reported": reported,
            "unique": unique,
            "complete": not bad,
            "short": len(bad),
        },
        "items": items,
    }
    with io.open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print("\nwrote %s — %d properties, coverage %s"
          % (args.out, unique, "complete" if not bad else "PARTIAL"))


if __name__ == "__main__":
    main()
