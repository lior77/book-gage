#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Draw the app icons from the real district geometry.

The icon is the silhouette of the Porto district — the union of its 18
municipalities — filled in the two colours of the two NUTS III regions the app
draws, on the app's own dark ground.  No inner borders: 18 municipality edges
do not survive 48 px, and the shape alone does.  The colours come from
municipios.json → belts, the same record the map reads, so the icon cannot
drift from the product again (it did: until 2026-09-15 this file still named
the three belts the app dropped in 1.8, and a re-run would have painted every
municipality the grey fallback).

Every launcher file keeps the map inside the 66 dp circle of the 108 dp
adaptive canvas — the only area Android guarantees never to clip.  Measured
before this rewrite: the map spread over 87% of the width and lost the coast
and the eastern tip under the standard 72 dp mask.

    python3 scripts/make_icons.py

Writes:
    icons/                       the PWA set (unchanged names)
    android/…/res/mipmap-<dpi>/  ic_launcher, ic_launcher_round (legacy, padded),
                                 ic_launcher_foreground, ic_launcher_monochrome
                                 (adaptive layers on the 108 dp canvas)
"""
import json
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ICONS = os.path.join(ROOT, "icons")
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")

BG = (15, 23, 42)             # #0f172a — manifest.webmanifest background_color
SAFE = 66.0 / 108.0           # the guaranteed circle of an adaptive icon
SS = 4                        # supersample, then downscale for smooth edges

# legacy launcher: 48 dp at each density; adaptive layers: 108 dp
DENSITY = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
WEB = [("icon-192.png", 192), ("icon-512.png", 512), ("icon-180.png", 180),
       ("favicon-32.png", 32)]


def rings(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    return [poly[0] for poly in geom["coordinates"]]


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class District:
    """The 18 outlines, projected once into a unit square, drawn many times."""

    def __init__(self):
        bounds = json.load(open(os.path.join(ROOT, "data", "processed",
                                             "boundaries_municipios.geojson"),
                                encoding="utf-8"))
        muns = json.load(open(os.path.join(ROOT, "data", "processed", "municipios.json"),
                              encoding="utf-8"))
        colour_of_belt = {b["he"]: hex_rgb(b["colour"]) for b in muns["belts"]}
        belt_of = {m["num"]: m["belt"] for m in muns["items"]}
        self.polys = []   # (colour, [(u, v), …]) with u, v in 0..1
        xs = [c[0] for ft in bounds["features"] for r in rings(ft["geometry"]) for c in r]
        ys = [c[1] for ft in bounds["features"] for r in rings(ft["geometry"]) for c in r]
        lo0, lo1, la0, la1 = min(xs), max(xs), min(ys), max(ys)
        k = 0.75  # cos(41°): keeps the shape from stretching sideways
        w, h = (lo1 - lo0) * k, (la1 - la0)
        for ft in bounds["features"]:
            colour = colour_of_belt[belt_of[ft["properties"]["num"]]]
            for ring in rings(ft["geometry"]):
                self.polys.append((colour, [((c[0] - lo0) * k, (la1 - c[1]))
                                            for c in ring]))
        # centre of the bounding box, and the farthest vertex from it
        self.cx, self.cy = w / 2, h / 2
        self.reach = max(((u - self.cx) ** 2 + (v - self.cy) ** 2) ** 0.5
                         for _, pts in self.polys for u, v in pts)

    def draw(self, size, span, ground, colour=None):
        """A size×size image with the district's widest side spanning `span`
        of it, centred.  `ground` None means transparent; `colour` overrides
        every region colour (the monochrome layer)."""
        W = size * SS
        img = Image.new("RGBA", (W, W), (ground + (255,)) if ground else (0, 0, 0, 0))
        dr = ImageDraw.Draw(img)
        # Fit to the circle, not to a square: the guarantee is a 66 dp disc, and
        # a wide low shape sized by width alone pokes its corners out of it.
        # 0.96 leaves the anti-aliased edge inside too.
        R = W * span / 2 * 0.96
        s = R / self.reach
        for c, pts in self.polys:
            dr.polygon([(W / 2 + (u - self.cx) * s, W / 2 + (v - self.cy) * s)
                        for u, v in pts], fill=(colour or c) + (255,))
        return img.resize((size, size), Image.LANCZOS)


def rounded(img, radius_div=6):
    size = img.size[0]
    mask = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * SS - 1, size * SS - 1],
                                           radius=size * SS // radius_div, fill=255)
    img.putalpha(mask.resize((size, size), Image.LANCZOS))
    return img


def circled(img):
    size = img.size[0]
    mask = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size * SS - 1, size * SS - 1], fill=255)
    img.putalpha(mask.resize((size, size), Image.LANCZOS))
    return img


def main():
    d = District()
    os.makedirs(ICONS, exist_ok=True)

    # the web set: the same padded map everywhere, so the PWA and the phone agree
    for name, size in WEB:
        img = d.draw(size, SAFE, BG)
        if size != 32:
            img = rounded(img)
        img.save(os.path.join(ICONS, name))
        print("  icons/%-22s %dx%d" % (name, size, size))
    d.draw(512, SAFE, BG).save(os.path.join(ICONS, "icon-maskable-512.png"))
    print("  icons/icon-maskable-512.png    512x512")

    for dpi, k in DENSITY.items():
        folder = os.path.join(RES, "mipmap-" + dpi)
        os.makedirs(folder, exist_ok=True)
        legacy, canvas = int(48 * k), int(108 * k)
        # legacy (< API 26): a full-bleed ground with the map inside the safe zone
        d.draw(legacy, SAFE, BG).save(os.path.join(folder, "ic_launcher.png"))
        circled(d.draw(legacy, SAFE, BG)).save(os.path.join(folder, "ic_launcher_round.png"))
        # adaptive layers (API 26+): transparent foreground on the 108 dp canvas;
        # the background is a colour resource, not an image
        d.draw(canvas, SAFE, None).save(os.path.join(folder, "ic_launcher_foreground.png"))
        d.draw(canvas, SAFE, None, colour=(255, 255, 255)).save(
            os.path.join(folder, "ic_launcher_monochrome.png"))
        print("  res/mipmap-%-8s launcher %dpx · layers %dpx" % (dpi, legacy, canvas))


if __name__ == "__main__":
    main()
