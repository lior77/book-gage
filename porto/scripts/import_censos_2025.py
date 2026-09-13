#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the 2021 census on the 2025 parish boundaries.

    python3 scripts/import_censos_2025.py

Two files meet here, and they carry different things.

BGRI (data/raw/bgri2021_to_caop2025_d13.json, written by fetch_bgri.py) has
every subsection assigned to the parish that contains it, so population and
the housing counts are exact for all 275 parishes: they are a sum, not a
share-out.  What BGRI does not have is the five-year age bands, education,
employment or nationality — it carries 0-14 / 15-24 / 25-64 / 65+ and nothing
finer, and a median age cannot be interpolated inside a forty-year band.

Those four live in the section-level Ficheiro Síntese, which is on the 2021
boundaries.  A section crosses to a 2025 parish only when the whole section
crosses; 1,410 of this district's 1,476 do, and 66 straddle two parishes.

THE RULE FOR THE DERIVED FIELDS, and why it is stricter than it looks.  A
parish with nine whole sections and one that straddles could still have a
percentage computed from the nine — and it would be a percentage of most of
the parish, presented as the parish's.  That is the unmarked approximation the
second rule of the accuracy contract forbids, and it is invisible on screen
because a plausible number appears.  So the four fields publish only when the
sections that landed in a parish account for ALL of it, and "all of it" is
tested against a population derived the other way, from the subsections.  A
parish that does not reconcile keeps its population and loses its percentages.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw")

sys.path.insert(0, HERE)
from import_censos_seccoes import derived, median_age          # noqa: E402

# BGRI's own column names, and what the app calls them. Everything here is a
# count, so a parish figure is a sum of subsections and nothing is shared out.
COUNTS = [
    ("dwellings", "N_ALOJAMENTOS_FAMILIARES"),
    ("buildings", "N_EDIFICIOS_CLASSICOS"),
]

# Shares BGRI CAN answer exactly for all 275, because both the part and the
# whole are subsection counts. Taking these from the sections instead would
# have cost the 57 new parishes three fields they can have.
SHARES = [
    ("pct_0_14", "N_INDIVIDUOS_0_14", "N_INDIVIDUOS"),
    ("pct_65plus", "N_INDIVIDUOS_65_OU_MAIS", "N_INDIVIDUOS"),
    ("owner_pct", "N_RHABITUAL_PROP_OCUP", "N_ALOJAMENTOS_FAM_CLASS_RHABITUAL"),
    ("rented_pct", "N_RHABITUAL_ARRENDADOS", "N_ALOJAMENTOS_FAM_CLASS_RHABITUAL"),
    ("parking_pct", "N_RHABITUAL_COM_ESTACIONAMENTO",
     "N_ALOJAMENTOS_FAM_CLASS_RHABITUAL"),
    ("pre1946_pct", "N_EDIFICIOS_CONSTR_ANTES_1945", "N_EDIFICIOS_CLASSICOS"),
    ("since2011_pct", "N_EDIFICIOS_CONSTR_2011_2021", "N_EDIFICIOS_CLASSICOS"),
    ("repair_pct", "N_EDIFICIOS_COM_NECESSIDADES_REPARACAO",
     "N_EDIFICIOS_CLASSICOS"),
]

# What only the section file can answer: a median needs five-year bands, and
# BGRI carries none of education, employment or nationality at all.
#
# vacant_pct and second_home_pct are here for a different reason, and it is the
# one worth writing down. BGRI has a column that looks like the first of them —
# N_ALOJAMENTOS_FAM_CLASS_VAGOS_OU_RESID_SECUNDARIA — and it is vacant dwellings
# OR second homes, added together. Publishing that as "empty dwellings" would
# have put 60.1% on screen for Aboadela where the figure is 10.5%, and it would
# have looked like data. It is the fourth rule exactly: the source's own wording
# says VAGOS_OU_RESID_SECUNDARIA and the app must not restate it as VAGOS. BGRI
# cannot separate the two, so neither comes from it.
SECTION_ONLY = ("median_age", "foreign_pct", "education_pct", "unemployment_pct",
                "vacant_pct", "second_home_pct")


def main():
    bgri_path = os.path.join(RAW, "bgri2021_to_caop2025_d13.json")
    if not os.path.exists(bgri_path):
        sys.exit("missing %s — run scripts/fetch_bgri.py first" % bgri_path)
    bgri = json.load(open(bgri_path, encoding="utf-8"))
    totals = bgri["parish_totals"]
    section_of = bgri["section_to_2025"]

    sec_path = os.path.join(RAW, "censos2021_seccoes_d13.json")
    seccoes = json.load(open(sec_path, encoding="utf-8"))["seccoes"]

    # sum the full 178-column section rows into the 2025 parish that holds them
    by_parish = {}
    orphan = 0
    for code, row in seccoes.items():
        dest = section_of.get(code)
        if dest is None:
            orphan += 1                     # straddles: it belongs to nobody
            continue
        acc = by_parish.setdefault(dest, {})
        for k, v in row.items():
            if isinstance(v, (int, float)):
                acc[k] = acc.get(k, 0) + v

    out, complete, partial = {}, 0, 0
    for code, t in totals.items():
        pop = int(t.get("N_INDIVIDUOS") or 0)
        rec = {"pop2021": pop}
        for name, col in COUNTS:
            if t.get(col) is not None:
                rec[name] = int(t[col])
        for name, part, whole in SHARES:
            a, b = t.get(part), t.get(whole)
            if a is not None and b:
                rec[name] = round(100.0 * a / b, 1)
        young, old = t.get("N_INDIVIDUOS_0_14"), t.get("N_INDIVIDUOS_65_OU_MAIS")
        if young:
            rec["ageing_index"] = round(100.0 * old / young, 1)

        acc = by_parish.get(code)
        covered = int((acc or {}).get("N_INDIVIDUOS") or 0)
        if acc and covered == pop and pop:
            # every section that makes up this parish landed in it whole, and
            # the two routes agree on the head count
            got = dict(derived(acc))
            # the two housing shares the section file can separate and BGRI cannot
            fam = acc.get("N_ALOJAMENTOS_FAM_CLASSICOS")
            if fam:
                if acc.get("N_ALOJAMENTOS_VAGOS_TOTAL") is not None:
                    got["vacant_pct"] = round(
                        100.0 * acc["N_ALOJAMENTOS_VAGOS_TOTAL"] / fam, 1)
                if acc.get("N_ALOJAMENTOS_FAM_CLASS_RES_SECUNDARIA") is not None:
                    got["second_home_pct"] = round(
                        100.0 * acc["N_ALOJAMENTOS_FAM_CLASS_RES_SECUNDARIA"] / fam, 1)
            for k in SECTION_ONLY:
                if got.get(k) is not None:
                    rec[k] = got[k]
            rec["section_cover"] = "full"
            complete += 1
        else:
            # the parish keeps everything the subsections can answer and loses
            # only the four that need a section, which is said rather than
            # filled in from the part of the parish that did reconcile
            rec["section_cover"] = "partial"
            rec["section_pop"] = covered
            partial += 1
        out[code] = rec

    print("parishes: %d" % len(out))
    print("  with the four section-only fields : %d" % complete)
    print("  without them (sections straddle)  : %d" % partial)
    for k in ("pop2021",) + SECTION_ONLY + tuple(n for n, _, _ in SHARES):
        have = sum(1 for r in out.values() if r.get(k) is not None)
        print("    %-16s %3d/%d" % (k, have, len(out)))
    print("sections that straddle two parishes and were dropped: %d" % orphan)

    dest = os.path.join(RAW, "censos2021_caop2025.json")
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump({
            "generated": bgri["generated"],
            "source": "INE Censos 2021 — population and housing summed from BGRI "
                      "subsections assigned to CAOP 2025; the age, education, "
                      "employment and nationality shares summed from the "
                      "section-level Ficheiro Síntese, and only where every "
                      "section of the parish landed in it whole",
            "reference_year": 2021,
            "parishes_complete": complete,
            "parishes_population_only": partial,
            "freguesias": out,
        }, fh, ensure_ascii=False, indent=1)
    print("wrote %s  (%.1f KB)" % (dest, os.path.getsize(dest) / 1024.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
