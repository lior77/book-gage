#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Say which of the data sources this session can actually reach.

    python3 scripts/check_network.py

The environment this runs in allows only the hosts its cloud environment lists.
Run it after changing the setting: it names what opened and what did not, which
is faster than discovering it halfway through a download script.

Read a ✗ as "did not answer three GETs", not as "the environment blocks it".
The two are different and the difference matters: a host outside the allowlist
is refused at CONNECT by the gateway, while several of these hosts are inside
it and still drop connections under load.  When a host you expect matters
comes back ✗, probe it once by hand before concluding anything.
"""
import concurrent.futures
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# (host, what it gives us). Order = priority.
HOSTS = [
    ("www.ine.pt", "INE — מחירי מכירה ושכירות למ״ר, וכל סדרות המפקד"),
    ("www.dgterritorio.gov.pt", "DGT — CAOP במהדורות הבאות, נתונים פתוחים"),
    ("ogcapi.dgterritorio.gov.pt", "DGT/OGC API — CAOP2025 וכל מרשם ה-SRUP כ-GeoJSON"),
    ("snit.dgterritorio.gov.pt", "DGT/SNIT — SRUP, ובו REN"),
    ("pcgt.dgterritorio.gov.pt", "DGT/PCGT — הפלטפורמה הארצית לתוכניות מתאר (PDM)"),
    ("www.dgadr.gov.pt", "DGADR — RAN, עתודת הקרקע החקלאית"),
    ("sniamb.apambiente.pt", "APA/SNIAmb — פורטל, לא הנתונים עצמם"),
    ("sniambgeoext.apambiente.pt", "APA — שרת ה-ArcGIS שמאחורי SNIAmb"),
    ("geo2.apambiente.pt", "APA — שירותי הגאוגרפיה"),
    ("www.icnf.pt", "ICNF — סכנת שריפות"),
    ("services.arcgis.com", "ArcGIS Online — חלק מהשירותים לעיל מוגשים דרכו"),
    ("www.arcgis.com", "ArcGIS Online — קטלוג הפריטים והגדרות המפות"),
    ("overpass-api.de", "OpenStreetMap — הרצת שאילתות Overpass מכאן"),
    ("www.pordata.pt", "PORDATA — סדרות זמן ברמת עירייה"),
    ("mapas.ine.pt", "INE — BGRI והורדות גאוגרפיות"),
    ("pdm.cm-gondomar.pt", "PDM גונדומאר"),
    ("websig.cm-amarante.pt", "PDM אמרנטה"),
    ("cm-baiao.pt", "PDM באיאו"),
    ("www.cm-marco-canaveses.pt", "PDM מרקו דה קנבזש"),
    ("github.com", "בקרה — אמור לעבוד תמיד"),
]


def probe(host, tries=3):
    """A GET whose body is thrown away, retried, because one refusal proves nothing.

    Not a HEAD: www.ine.pt and mapas.ine.pt answer a HEAD by closing the
    connection, so `curl -I` reported them blocked when a plain GET fetches
    from them perfectly well.  The retries are here for the same reason —
    several of these hosts drop the first handshake and answer the second.
    """
    err = "blocked"
    for attempt in range(tries):
        try:
            out = subprocess.run(
                ["curl", "-sS", "-L", "-o", "/dev/null", "-w", "%{http_code}",
                 "--max-time", "30", "https://%s/" % host],
                capture_output=True, text=True, timeout=60)
        except subprocess.TimeoutExpired:
            err = "timeout"
            continue
        code = out.stdout.strip()
        if code and code != "000":
            return host, code
        lines = (out.stderr or "").strip().splitlines()
        if lines:
            err = lines[-1][:60]
        if attempt < tries - 1:
            time.sleep(2)
    return host, err


def main():
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
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
