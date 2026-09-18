# book-gage

The working project in this repository is **`porto/`** — Portoland, a Hebrew,
offline-first atlas of Portugal's Porto district, built for property search.

## Read this first

**`porto/docs/ARCHITECTURE.md`** is the source of truth on structure, every data
source, the data model, and the verification machinery. Read it before changing
anything under `porto/`, and update it in the same commit that changes what it
describes.

**That rule applies to every document, not only that one.** It said
"ARCHITECTURE.md" alone until 2026-09-16, and the cost was visible: `README.md`
— the first page anyone opens — spent several releases saying the district had
243 parishes on CAOP 2020 and that the 2025 boundaries were "not in the app
yet", all three false, while nobody was wrong to trust it. A change lands with
the documents it makes untrue:

| document | says what | update it when |
|---|---|---|
| `porto/docs/ARCHITECTURE.md` | structure, sources, data model, checks | any of those change |
| `porto/README.md` | what the app is and does, and its licences | a feature, a count or a source changes |
| `porto/docs/HANDOFF.md` | current state, open work, environment traps | a release, an open item, a trap |
| `porto/docs/NETWORK-ALLOWLIST.md` | which hosts the project needs | a source is added or dropped |
| `porto/docs/DATA-ACQUIRED.md` | what was actually obtained | data arrives or is proven unobtainable |
| `porto/docs/HARVEST.md` | how a listings harvest is run, and what it refuses | the connector, the slice axes or the refusals change |

The dated documents — `UX-2.0.0.md`, `UI-2.0.0.md`, `REVISION-2.0.0.md`,
`WORKPLAN.md`, `DATA-REQUEST.md`, `DELIVERY.md` — are **records of a moment**
and are not updated. They are amended only to record what later proved wrong,
never rewritten to look right.

`checks.py` §7x enforces the part a machine can see: every `.md` is declared
live or record, and a live one may not carry a superseded count or edition. It
cannot tell you that a feature is undocumented. That part is yours.

**`porto/docs/HANDOFF.md`** is where to start in a fresh session: current
version and state, what is open, how the loop is actually run, and the
environment traps that have already cost real time. It tracks state; the
architecture document tracks structure.

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
