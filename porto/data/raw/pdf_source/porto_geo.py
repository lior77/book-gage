import json, unicodedata

import os
SRC = os.path.join(os.path.dirname(__file__), "data", "porto_freguesias.geojson")

def _ring(g):
    if g["type"] == "Polygon":
        return g["coordinates"][0]
    return max(g["coordinates"], key=lambda c: len(c[0]))[0]

_d = json.load(open(SRC))

FREG_RING = {}
for _f in _d["features"]:
    _p = _f["properties"]
    if _p.get("admin_level") == "8":
        FREG_RING[_p["name"]] = _ring(_f["geometry"])

PLACES = []
for _f in _d["features"]:
    _p = _f["properties"]
    _g = _f["geometry"]
    if _p.get("place") in ("neighbourhood", "quarter", "suburb"):
        if _g["type"] == "Point":
            _pt = _g["coordinates"]
        else:
            _r = _ring(_g)
            _pt = [sum(a[0] for a in _r) / len(_r), sum(a[1] for a in _r) / len(_r)]
        PLACES.append((_p.get("name", ""), _pt))

# freguesia number -> OSM name
FNUM = {
 1: "Cedofeita, Santo Ildefonso, Sé, Miragaia, São Nicolau e Vitória",
 2: "Bonfim",
 3: "Campanhã",
 4: "Paranhos",
 5: "Ramalde",
 6: "Aldoar, Foz do Douro e Nevogilde",
 7: "Lordelo do Ouro e Massarelos",
}


def inside(pt, poly):
    x, y = pt
    n = len(poly)
    c = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i][0], poly[i][1]
        xj, yj = poly[j][0], poly[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            c = not c
        j = i
    return c


def _norm(s):
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn")


def places_in(num):
    poly = FREG_RING[FNUM[num]]
    return [(n, p) for n, p in PLACES if inside(p, poly)]


def find_place(num, english_label):
    """Locate a curated zone inside a freguesia by matching OSM place names."""
    cands = [c.strip() for c in english_label.replace("(", "/").replace(")", "").split("/")]
    pool = places_in(num)
    for c in cands:
        cn = _norm(c)
        for n, p in pool:
            if _norm(n) == cn:
                return p, True
    for c in cands:
        cn = _norm(c)
        for n, p in pool:
            if cn and cn in _norm(n):
                return p, True
    for c in cands:
        w = _norm(c).split()
        if not w:
            continue
        for n, p in pool:
            if w[0] and w[0] in _norm(n).split():
                return p, True
    return None, False


def bbox(rings):
    xs = [q[0] for r in rings for q in r]
    ys = [q[1] for r in rings for q in r]
    return min(xs), min(ys), max(xs), max(ys)


def make_proj(rings, x0, y0, w, h, pad=8):
    """Equirectangular projection fitted into a PDF box."""
    lo0, la0, lo1, la1 = bbox(rings)
    import math
    k = math.cos(math.radians((la0 + la1) / 2.0))
    W = (lo1 - lo0) * k
    H = (la1 - la0)
    s = min((w - 2 * pad) / W, (h - 2 * pad) / H)
    ox = x0 + (w - W * s) / 2.0
    oy = y0 + (h - H * s) / 2.0

    def proj(pt):
        return (ox + (pt[0] - lo0) * k * s, oy + (pt[1] - la0) * s)
    return proj
