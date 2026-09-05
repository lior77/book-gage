#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Draw the app icons from the real district geometry.

The launcher icon is the outline of the 18 municipalities of the Porto district,
each filled with its belt colour, on a dark ground — so the icon on the phone's
home screen is the same map the app opens on.

    python3 scripts/make_icons.py
"""
import json
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ICONS = os.path.join(ROOT, "icons")

BG = (15, 23, 42)
BELT = {"החגורה העירונית": (43, 108, 176), "החגורה הצפונית": (56, 142, 60),
        "החגורה המזרחית": (126, 58, 175)}
SIZES = [(192, 12, True), (512, 32, True), (180, 10, True), (32, 2, False)]


def rings(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    return [poly[0] for poly in geom["coordinates"]]


def main():
    bounds = json.load(open(os.path.join(ROOT, "data", "processed",
                                         "boundaries_municipios.geojson"), encoding="utf-8"))
    muns = json.load(open(os.path.join(ROOT, "data", "processed", "municipios.json"),
                          encoding="utf-8"))["items"]
    belt_of = {m["num"]: m.get("belt") for m in muns}

    xs = [c[0] for ft in bounds["features"] for r in rings(ft["geometry"]) for c in r]
    ys = [c[1] for ft in bounds["features"] for r in rings(ft["geometry"]) for c in r]
    lo0, lo1, la0, la1 = min(xs), max(xs), min(ys), max(ys)
    k = 0.75  # cos(41 deg), keeps the shape from stretching sideways

    os.makedirs(ICONS, exist_ok=True)
    for size, pad, rounded in SIZES:
        ss = 4  # supersample, then downscale for smooth edges
        W = size * ss
        img = Image.new("RGBA", (W, W), BG + (255,))
        dr = ImageDraw.Draw(img)
        inner = W - 2 * pad * ss
        sx = inner / ((lo1 - lo0) * k)
        sy = inner / (la1 - la0)
        s = min(sx, sy)
        ox = (W - (lo1 - lo0) * k * s) / 2
        oy = (W - (la1 - la0) * s) / 2

        def proj(c):
            return (ox + (c[0] - lo0) * k * s, W - (oy + (c[1] - la0) * s))

        for ft in bounds["features"]:
            colour = BELT.get(belt_of.get(ft["properties"]["num"]), (120, 130, 150))
            for ring in rings(ft["geometry"]):
                dr.polygon([proj(c) for c in ring], fill=colour + (255,),
                           outline=BG + (255,), width=max(1, ss))

        img = img.resize((size, size), Image.LANCZOS)
        if rounded:
            mask = Image.new("L", (size * ss, size * ss), 0)
            ImageDraw.Draw(mask).rounded_rectangle(
                [0, 0, size * ss - 1, size * ss - 1], radius=size * ss // 6, fill=255)
            img.putalpha(mask.resize((size, size), Image.LANCZOS))
        name = "icon-%d.png" % size if size != 32 else "favicon-32.png"
        img.save(os.path.join(ICONS, name))
        print("  icons/%-16s %dx%d" % (name, size, size))

    # maskable variant: same map, but inset so Android can crop it to any shape
    base = Image.open(os.path.join(ICONS, "icon-512.png")).convert("RGBA")
    m = Image.new("RGBA", (512, 512), BG + (255,))
    small = base.resize((512 - 2 * 96, 512 - 2 * 96), Image.LANCZOS)
    m.paste(small, (96, 96), small)
    m.save(os.path.join(ICONS, "icon-maskable-512.png"))
    print("  icons/icon-maskable-512.png 512x512")


if __name__ == "__main__":
    main()
