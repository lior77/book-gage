#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""What this release did to the data, derived rather than remembered.

    python3 scripts/build_diff.py              # writes docs/CHANGES-<version>.md
    python3 scripts/build_diff.py --print      # to the screen, writes nothing
    python3 scripts/build_diff.py --against <rev>

Move ו׳ of docs/INFORMATION-PLAN.md, the third part: a change record that is
GENERATED from the two outputs and never typed.  A hand-written changelog says
what its author remembered; this says what actually moved, field by field, with
the number of units and the values themselves.

Where the previous output comes from.  The plan left it open whether to keep
data/processed of the last release somewhere — 2MB a release adds up.  It does
not need keeping: **it is already in git**.  `git show <rev>:porto/data/…` is
the "old output in another directory" that chapter 11 prescribes for rolling
back a bad derivation, at no extra cost, so this compares the working tree with
a revision instead of with a copy nobody maintains.

Geometry is compared as a hash and a vertex count, not vertex by vertex: the
boundary files hold 1.56 million coordinates and a diff that lists them is a
diff nobody reads.  "The outline of Paredes changed, 4,012 → 4,010 vertices" is
the sentence that matters.
"""
import argparse
import collections
import hashlib
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROC = os.path.join(ROOT, "data", "processed")
VERSION = io.open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip()

# The fields an item may be identified by, in order of preference.  A diff keyed
# on list POSITION reports "everything moved" the moment one unit is inserted,
# which is the single most common way a diff becomes useless.
ID_FIELDS = ("dicofre", "code", "key", "id", "num", "pt", "name", "station")


def git(*args):
    return subprocess.run(["git"] + list(args), cwd=ROOT, capture_output=True)


def repo_prefix():
    """The path of porto/ inside the repository, as git names it."""
    top = git("rev-parse", "--show-toplevel").stdout.decode().strip()
    return os.path.relpath(ROOT, top).replace(os.sep, "/")


def old_version(rev, rel):
    r = git("show", "%s:%s/%s" % (rev, repo_prefix(), rel))
    if r.returncode != 0:
        return None
    return json.loads(r.stdout.decode("utf-8"))


def ident(item, i):
    if isinstance(item, dict):
        for f in ID_FIELDS:
            if f in item and isinstance(item[f], (str, int)):
                return str(item[f])
    return "#%d" % i


def geom_hash(geom):
    n = [0]

    def count(c):
        if c and isinstance(c[0], (int, float)):
            n[0] += 1
        else:
            for x in c or []:
                count(x)
    count((geom or {}).get("coordinates"))
    h = hashlib.sha256(json.dumps(geom, sort_keys=True,
                                  separators=(",", ":")).encode()).hexdigest()[:12]
    return h, n[0]


def flatten(obj, out, path=""):
    """{field path -> value}, with items keyed by identity and geometry hashed."""
    if isinstance(obj, dict):
        if obj.get("type") in ("Polygon", "MultiPolygon", "Point", "LineString",
                               "MultiLineString", "MultiPoint"):
            h, n = geom_hash(obj)
            out[path] = "geometry %s, %d vertices" % (h, n)
            return
        for k, v in obj.items():
            flatten(v, out, "%s.%s" % (path, k) if path else k)
    elif isinstance(obj, list):
        if obj and all(isinstance(x, dict) for x in obj):
            for i, item in enumerate(obj):
                flatten(item, out, "%s[%s]" % (path, ident(item, i)))
        else:
            out[path] = "list of %d" % len(obj)
    else:
        out[path] = obj


def unkey(path):
    """`items[Paredes].pop2021` -> (`items[*].pop2021`, `Paredes`)."""
    unit = []
    out = []
    i = 0
    while i < len(path):
        if path[i] == "[":
            j = path.find("]", i)
            unit.append(path[i + 1:j])
            out.append("[*]")
            i = j + 1
        else:
            out.append(path[i])
            i += 1
    return "".join(out), " / ".join(unit)


def diff_file(name, rev):
    """`name` is a file name inside data/processed, which is also its git path
    under the project prefix — the first cut passed the bare name to `git show`
    and every file came back missing, which reads exactly like a release that
    invented all twelve of them."""
    old = old_version(rev, "data/processed/" + name)
    new = json.load(io.open(os.path.join(PROC, name), encoding="utf-8"))
    if old is None:
        return None, "new in this release"
    a, b = {}, {}
    flatten(old, a)
    flatten(new, b)
    fields = collections.defaultdict(list)
    for k in sorted(set(a) | set(b)):
        if a.get(k, "\0absent") == b.get(k, "\0absent"):
            continue
        field, unit = unkey(k)
        fields[field].append((unit, a.get(k, None), b.get(k, None), k in a, k in b))
    return fields, None


def fmt(v, present):
    if not present:
        return "—"
    if v is None:
        return "null"
    if isinstance(v, float):
        return "%g" % v
    s = str(v)
    return s if len(s) <= 40 else s[:37] + "…"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--against", default="HEAD",
                    help="the revision to compare against (default HEAD)")
    ap.add_argument("--print", dest="show", action="store_true",
                    help="write nothing, print the diff")
    args = ap.parse_args()

    rev = git("rev-parse", "--short", args.against).stdout.decode().strip()
    if not rev:
        print("no such revision: %s" % args.against)
        return 1

    names = sorted(n for n in os.listdir(PROC)
                   if n.endswith((".json", ".geojson")) and n != "manifest.json")
    lines = []
    lines.append("# שינויי נתונים — %s" % VERSION)
    lines.append("")
    lines.append("**נוצר על ידי `scripts/build_diff.py`. אין לערוך ביד.**")
    lines.append("")
    lines.append("מה ש-`data/processed/` מחזיק עכשיו, מול מה שהוא החזיק ב-`%s`. "
                 "זהו **מסמך רשומה** — תצלום של רגע, ואינו מתעדכן." % rev)
    lines.append("")
    lines.append("‏`manifest.json` אינו בהשוואה: הוא משתנה בכל שחרור מעצם הגדרתו "
                 "(תאריך, גרסה ו-hash לכל קובץ). גאומטריה מושווית כ-hash ומספר "
                 "קודקודים, לא קודקוד-קודקוד — 1.56 מיליון קודקודים הם דיף שאיש "
                 "לא קורא.")
    lines.append("")
    total = 0
    for n in names:
        fields, note = diff_file(n, args.against)
        if note:
            lines.append("## `%s`" % n)
            lines.append("")
            lines.append("**%s.**" % note)
            lines.append("")
            total += 1
            continue
        if not fields:
            continue
        total += 1
        lines.append("## `%s`" % n)
        lines.append("")
        lines.append("| שדה | יחידות | משם | לשם |")
        lines.append("| --- | ---: | --- | --- |")
        for field in sorted(fields):
            rows = fields[field]
            # A top-level field has no unit key, and printing an em dash where
            # the unit would go reads as a missing value rather than as "this
            # field belongs to the file itself".
            ex = "; ".join(("%s: %s → %s" % (u, fmt(o, po), fmt(w, pw))) if u
                           else ("%s → %s" % (fmt(o, po), fmt(w, pw)))
                           for u, o, w, po, pw in rows[:3])
            if len(rows) > 3:
                ex += "; …"
            lines.append("| `%s` | %d | %s |" % (field, len(rows), ex.replace("|", "\\|")))
        lines.append("")
    if total == 0:
        lines.append("**שום שדה לא השתנה.** הפלט זהה בית-בית למה שהיה ב-`%s` — "
                     "שחרור שנגע בקוד או במסמכים ולא בנתונים." % rev)
        lines.append("")

    text = "\n".join(lines)
    if args.show:
        print(text)
        return 0
    dest = os.path.join(ROOT, "docs", "CHANGES-%s.md" % VERSION)
    io.open(dest, "w", encoding="utf-8").write(text)
    print("wrote docs/CHANGES-%s.md  (%d files with a change, against %s)"
          % (VERSION, total, rev))
    return 0


if __name__ == "__main__":
    sys.exit(main())
