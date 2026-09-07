# book-gage

The working project in this repository is **`porto/`** — Portoland, a Hebrew,
offline-first atlas of Portugal's Porto district, built for property search.

## Read this first

**`porto/docs/ARCHITECTURE.md`** is the source of truth on structure, every data
source, the data model, and the verification machinery. Read it before changing
anything under `porto/`, and update it in the same commit that changes what it
describes.

## The accuracy contract

This project is about being right, not about being complete. These rules are not
negotiable, and `porto/scripts/checks.py` enforces much of them:

1. Every numeric field carries a source and a reference year in
   `porto/data/sources.json`, and the UI shows both. Every number on screen is
   clickable and opens its source record.
2. A missing field renders "אין נתון". Never 0, never an estimate, never an
   unmarked interpolation.
3. A value is marked `verified` only after a second, independent source reaches
   the same number. Otherwise `reported`, or `approx` for anything derived.
4. Never restate a source's own wording into something stronger:
   `crimes registados por 1000 habitantes` is not "violent crime";
   `perigosidade` is not `risco`.
5. OpenStreetMap data is ODbL and requires "© OpenStreetMap contributors".
6. Hebrew transliterations follow Portuguese pronunciation, and existing ones
   are never regenerated automatically.

When a source is ambiguous, publish nothing and record why under
`sources.json → missing.items`. That list is part of the product.

## The loop

```bash
cd porto
python3 scripts/build.py            # data/raw → data/processed
python3 scripts/checks.py           # exit 1 stops everything
python3 scripts/crosscheck_baseline.py
node --check app.js
python3 scripts/bundle_standalone.py
```

`data/processed/` is generated. Never hand-edit it.
Bumping `porto/VERSION` and pushing builds the Android APK.

## Before adding a check

Break the data on purpose and confirm the check catches it. Every rule in
`checks.py` was added after something actually went wrong; section 11 of the
architecture document records what.
