#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""One property, asked for by its link, in the shape "My places" reads.

    python3 scripts/connector_property.py --in detail-34741096.json \
        --out property.json --he he-34741096.json --he-by "תרגום בצ׳אט"

The other half of route 2.  `connector_listings.py` turns a SEARCH into a
file; this turns a single `property_detail` into one, and the file says
`"mine": true` so the app puts it straight into "המקומות שלי" instead of the
listings screen.  That is the whole difference, and it exists because the
user's question was not "search for me" but "I found one — keep it".

HOW THE CODE GETS HERE.  From the link, in the app: a property URL is
`idealista.pt/imovel/<code>/` (or `/en/imovel/<code>/`, or with any utm tail),
and `idealistaCode()` in app.js reads the code out of it.  The app cannot then
FETCH that page — idealista serves DataDome to this container and no
`Access-Control-Allow-Origin` to the WebView — so the link waits in the app
until a file with that code arrives.  That waiting is visible on the screen and
is not pretended away.

TRANSLATION, AND WHY THE SCRIPT WILL NOT DO IT.  The user asked for the text in
Hebrew.  A script cannot translate prose, and a machine translation printed
where a reader takes it for the advertisement's own words is exactly what rule
4 of the accuracy contract forbids — `perigosidade` is not `risco`, and
"moradia para recuperar" is not "בית משופץ".  So:

  * the Portuguese is carried VERBATIM, always, in `pt`;
  * a translation, when there is one, travels BESIDE it in `he`, never
    instead of it, and the file records who made it in `he_by`;
  * a `he` field with no `pt` counterpart is REFUSED — a translation with no
    original is not a translation, it is a claim;
  * `phrases` must match one for one, per key.  A list that came back shorter
    lost something, and a list that came back longer gained something, and
    neither can be seen once they are on screen.

PLACE NAMES ARE NOT TRANSLATED HERE AT ALL.  "Fânzeres e São Pedro da Cova,
Gondomar" is not rendered into Hebrew by this script or by the app's
dictionary: the app already knows those two units, in Hebrew, from the atlas,
and it finds them FROM THE COORDINATE.  That is rule 6 — transliterations are
never generated — and it is also simply better, because the atlas's name is
the one the rest of the app uses.

SALE OR RENT IS READ, NOT GUESSED.  `property_detail` has no `operation`
field.  idealista's own price block says which it is ("Preço do imóvel" for a
sale, "arrendamento"/"renda" for a rent), and that phrase is what is read.
When it cannot be read the script REFUSES and asks for `--operation`, because
the alternative — inferring it from the size of the number — is the unmarked
interpolation rule 2 is written against.
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
sys.path.insert(0, HERE)
# The same mapping the search converter uses.  Two shapes for one record is how
# the fixture and the app drift apart; there is one, and it lives there.
from connector_listings import item_of, fold           # noqa: E402

SALE = re.compile(r"pre[cç]o do im[oó]vel|pre[cç]o de venda")
RENT = re.compile(r"arrendamento|renda mensal|pre[cç]o da renda")


def load(path):
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh)


def phrases_of(p):
    """idealista's own bullet list, by key, verbatim."""
    out = {}
    for blk in (p.get("characteristicsDescriptions") or []):
        key = blk.get("key")
        ph = [x for x in (blk.get("phrases") or []) if x]
        if key and ph:
            out[key] = ph
    return out


def operation_of(p, forced):
    if forced:
        return forced, "flag"
    hay = fold(" ".join(sum(phrases_of(p).values(), [])))
    sale, rent = bool(SALE.search(hay)), bool(RENT.search(hay))
    if sale and not rent:
        return "sale", "phrase"
    if rent and not sale:
        return "rent", "phrase"
    return None, None


def check_he(code, pt, he):
    """A translation may only exist where an original does, and match it."""
    for k in ("title", "subtitle", "description"):
        if he.get(k) and not (pt.get(k) or "").strip():
            sys.exit("%s: he.%s was given but there is no Portuguese %s to "
                     "translate. A translation with no original is not a "
                     "translation, it is a claim." % (code, k, k))
    hp, pp = he.get("phrases") or {}, pt.get("phrases") or {}
    for key, lst in hp.items():
        if key not in pp:
            sys.exit("%s: he.phrases[%r] has no Portuguese counterpart" % (code, key))
        if len(lst) != len(pp[key]):
            sys.exit("%s: he.phrases[%r] has %d lines and the Portuguese has "
                     "%d. One for one, or a line was dropped or invented and "
                     "nobody can see which." % (code, key, len(lst), len(pp[key])))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="inputs", nargs="+", required=True,
                    help="property_detail result files (globs allowed)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--he", help="translations, keyed by property code")
    ap.add_argument("--he-by", default="",
                    help="who made the translation — it is printed on the card")
    ap.add_argument("--operation", choices=("sale", "rent"),
                    help="only when idealista's price block does not say")
    ap.add_argument("--with-contact", action="store_true",
                    help="keep the agent's name and telephone")
    args = ap.parse_args()

    paths = []
    for pattern in args.inputs:
        paths.extend(sorted(glob.glob(pattern)) or [pattern])

    he_all = load(args.he) if args.he else {}
    if he_all and not args.he_by:
        sys.exit("--he without --he-by: a translation that does not say who "
                 "made it cannot be weighed by the person reading it")

    items, seen = [], set()
    for path in paths:
        d = load(path)
        p = d.get("property")
        if not isinstance(p, dict):
            sys.exit("%s is not a property_detail result (no `property`)"
                     % os.path.basename(path))
        code = str(p.get("propertyCode") or "")
        if not code:
            sys.exit("%s: the property has no propertyCode" % os.path.basename(path))
        op, how = operation_of(p, args.operation)
        if not op:
            sys.exit("%s: idealista's price block does not say whether this is "
                     "a sale or a rent, and the price alone does not either — "
                     "299.900 € is a sale and 2.999 € could be both. Pass "
                     "--operation sale|rent." % code)
        it = item_of(p, op, args.with_contact)
        if not it:
            sys.exit("%s: no coordinate. Portoland draws places on a map; a "
                     "property it cannot place is not one it can keep." % code)
        pt = {"title": (p.get("suggestedTexts") or {}).get("title") or "",
              "subtitle": (p.get("suggestedTexts") or {}).get("subtitle") or "",
              "description": p.get("description") or "",
              "phrases": phrases_of(p)}
        it["pt"] = pt
        he = he_all.get(code)
        if he:
            check_he(code, pt, he)
            it["he"] = he
            it["he_by"] = args.he_by
        it["operation_from"] = how
        it["outcome"] = d.get("outcome") or ""
        it["areas"] = p.get("areas") or {}
        it["energy"] = (p.get("energyCertification") or {}).get("consumption") or {}
        it["updated_text"] = p.get("modificationDateText") or ""
        if code in seen:
            continue
        seen.add(code)
        items.append(it)

    extra = [c for c in he_all if c not in seen]
    if extra:
        sys.exit("the translation file carries %s, which no input property "
                 "matches. A translation of something that is not here cannot "
                 "be checked against anything." % ", ".join(sorted(extra)))

    out = {
        "kind": "listings",
        "mine": True,                       # straight into "המקומות שלי"
        "provider": "idealista",
        "source": "connector-detail",
        "note": ("Read one by one, by link, through idealista's official "
                 "connector. The Portuguese travels verbatim; a Hebrew "
                 "translation, where there is one, travels beside it and "
                 "never in its place."),
        "read_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "items": items,
    }
    with io.open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    for it in items:
        print("  %-10s %-4s %s%s %s" % (it["code"], it["operation"],
              it.get("price"), (it.get("currency") or ""),
              "· תרגום" if it.get("he") else "· בפורטוגזית בלבד"))
    print("wrote %s — %d propert%s, straight into my places"
          % (args.out, len(items), "y" if len(items) == 1 else "ies"))


if __name__ == "__main__":
    main()
