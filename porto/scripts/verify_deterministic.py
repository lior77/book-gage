#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Runs the build twice and proves the output is byte for byte the same.

    python3 scripts/verify_deterministic.py

Why.  Move ו׳ of docs/INFORMATION-PLAN.md: without a deterministic build
there is no diff, and without a diff there is no audit — every comparison is
drowned in noise and a real change cannot be told from a reordered dictionary.
Chapter 9 of Designing Data-Intensive Applications calls this the power of
determinism, and chapter 11 names the payoff: when a bug produces wrong
output, you roll the code back and run it again, and the output is right
again.  That only works if "run it again" means the same thing twice.

The book also names where determinism usually leaks, and those are exactly
what this catches: hash-table iteration order, a timestamp taken from the
clock, a float that came out of a different summation order, a path that
depends on which files happened to be present.

Measured on 2026-09-17, before anything was changed: the build was ALREADY
deterministic for the same day, and the only thing that moved between days was
the `generated` date stamped inside five data files — which is why move ו׳
takes it out of the data and into data/processed/manifest.json.  A stamp inside
the data makes every release look like a data change.

Exit 0 = identical.  Exit 1 = a source of non-determinism, named.
"""
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROC = os.path.join(ROOT, "data", "processed")


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def snapshot():
    return {n: sha(os.path.join(PROC, n))
            for n in sorted(os.listdir(PROC))
            if os.path.isfile(os.path.join(PROC, n))}


def first_difference(a_path, b_path):
    """Where two files part company, in the most useful terms available.

    For JSON: the first differing key path, because "byte 41,208" tells you
    nothing about which field drifted.  For anything else: the byte offset.
    """
    try:
        a = json.load(io.open(a_path, encoding="utf-8"))
        b = json.load(io.open(b_path, encoding="utf-8"))
    except Exception:
        ab, bb = open(a_path, "rb").read(), open(b_path, "rb").read()
        for i in range(min(len(ab), len(bb))):
            if ab[i] != bb[i]:
                return "byte %d" % i
        return "length %d vs %d" % (len(ab), len(bb))

    def walk(x, y, path):
        if type(x) is not type(y):
            return "%s: %s vs %s" % (path, type(x).__name__, type(y).__name__)
        if isinstance(x, dict):
            if list(x.keys()) != list(y.keys()):
                only = [k for k in x if k not in y] + [k for k in y if k not in x]
                if only:
                    return "%s: keys %s on one side only" % (path, only[:4])
                return ("%s: the same keys in a different ORDER — a dict "
                        "written in iteration order is the classic leak" % path)
            for k in x:
                r = walk(x[k], y[k], "%s.%s" % (path, k))
                if r:
                    return r
            return None
        if isinstance(x, list):
            if len(x) != len(y):
                return "%s: %d items vs %d" % (path, len(x), len(y))
            for i, (xi, yi) in enumerate(zip(x, y)):
                r = walk(xi, yi, "%s[%d]" % (path, i))
                if r:
                    return r
            return None
        return None if x == y else "%s: %r vs %r" % (path, x, y)

    return walk(a, b, os.path.basename(a_path)) or "equal as JSON, different as bytes"


def main():
    before = snapshot()
    keep = tempfile.mkdtemp(prefix="porto-determinism-")
    for n in before:
        shutil.copy2(os.path.join(PROC, n), os.path.join(keep, n))

    r = subprocess.run([sys.executable, os.path.join(HERE, "build.py")],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-2000:])
        print(r.stderr[-2000:])
        print("build.py failed — nothing to compare")
        return 1

    after = snapshot()
    bad = []
    for n in sorted(set(before) | set(after)):
        if n not in before:
            bad.append("%s appeared only in the second run" % n)
        elif n not in after:
            bad.append("%s disappeared in the second run" % n)
        elif before[n] != after[n]:
            bad.append("%s differs — %s" % (n, first_difference(
                os.path.join(keep, n), os.path.join(PROC, n))))

    for line in bad:
        print("  DIFFERS  " + line)
    print("\n%d files compared, %d identical" % (len(after), len(after) - len(bad)))
    if bad:
        print("The build is NOT deterministic. The snapshot of the first run is in\n"
              "  %s\nso the two can be compared by hand before it is deleted." % keep)
        return 1
    shutil.rmtree(keep, ignore_errors=True)
    print("the build is deterministic: same input, same bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
