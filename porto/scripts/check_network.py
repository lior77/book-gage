#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Say which of the data sources this session can actually reach.

    python3 scripts/check_network.py

The environment this runs in allows only the hosts its cloud environment lists.
Everything the project still needs — INE, DGT, DGADR, APA, ICNF, the municipal
geoportals — sits outside the default list, so until the environment is set to
Custom with docs/NETWORK-ALLOWLIST.md pasted in, every one of them fails.

Run it after changing the setting: it names what opened and what did not, which
is faster than discovering it halfway through a download script.
"""
import concurrent.futures
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# (host, what it gives us). Order = priority.
HOSTS = [
    ("www.ine.pt", "INE — מחירי מכירה ושכירות למ״ר, וכל סדרות המפקד"),
    ("www.dgterritorio.gov.pt", "DGT — CAOP במהדורות הבאות, נתונים פתוחים"),
    ("snit.dgterritorio.gov.pt", "DGT/SNIT — SRUP, ובו REN"),
    ("pcgt.dgterritorio.gov.pt", "DGT/PCGT — הפלטפורמה הארצית לתוכניות מתאר (PDM)"),
    ("www.dgadr.gov.pt", "DGADR — RAN, עתודת הקרקע החקלאית"),
    ("sniamb.apambiente.pt", "APA/SNIAmb — אזורי הצפה"),
    ("geo2.apambiente.pt", "APA — שירותי הגאוגרפיה"),
    ("www.icnf.pt", "ICNF — סכנת שריפות"),
    ("services.arcgis.com", "ArcGIS Online — חלק מהשירותים לעיל מוגשים דרכו"),
    ("overpass-api.de", "OpenStreetMap — הרצת שאילתות Overpass מכאן"),
    ("www.pordata.pt", "PORDATA — סדרות זמן ברמת עירייה"),
    ("mapas.ine.pt", "INE — BGRI והורדות גאוגרפיות"),
    ("pdm.cm-gondomar.pt", "PDM גונדומאר"),
    ("websig.cm-amarante.pt", "PDM אמרנטה"),
    ("cm-baiao.pt", "PDM באיאו"),
    ("www.cm-marco-canaveses.pt", "PDM מרקו דה קנבזש"),
    ("github.com", "בקרה — אמור לעבוד תמיד"),
]


def probe(host):
    """A HEAD request, and nothing clever: a refused CONNECT is what we look for."""
    try:
        out = subprocess.run(
            ["curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}",
             "--max-time", "20", "-I", "https://%s/" % host],
            capture_output=True, text=True, timeout=40)
    except subprocess.TimeoutExpired:
        return host, "timeout"
    code = out.stdout.strip()
    if code and code != "000":
        return host, code
    err = (out.stderr or "").strip().splitlines()
    return host, (err[-1][:60] if err else "blocked")


def main():
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(pool.map(probe, [h for h, _ in HOSTS]))
    ok = 0
    for host, what in HOSTS:
        r = results[host]
        reachable = r.isdigit()
        ok += reachable
        print("%-4s %-28s %-9s %s"
              % ("✓" if reachable else "✗", host, r if reachable else "", what))
    print("\n%d מתוך %d נגישים." % (ok, len(HOSTS)))
    if ok <= 1:
        print("רק GitHub פתוח — הסביבה עדיין ברמת Trusted. ראה "
              "docs/NETWORK-ALLOWLIST.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
