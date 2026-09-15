#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Run a Portoland listings query against idealista's official API and write
the results file the app imports (ייבוא נתונים → a "listings" file).

The app can call the API itself ("חפש" in the listings mode), but a browser
may refuse the cross-origin call and a phone may have no network; this is the
same query, run from a computer, with the same key.  Nothing here touches
data/processed/ and this script is never shipped in the APK (checks.py 7ad).

    python3 scripts/fetch_listings.py --query query.json --out listings.json
    python3 scripts/fetch_listings.py --center 41.28,-8.28 --distance 6000 --op sale --type house \\
        --min-size 100 --renew --garden --out listings.json

The key is read from IDEALISTA_APIKEY and IDEALISTA_SECRET, or --apikey /
--secret.  It is never written anywhere.  Quota: idealista's free key is of the
order of 100 requests a month; this script spends one for the token and one per
page of 50, and says so before it runs.

query.json is what the app shows under "השאילתה לסקריפט": {kind, query, geo}.
The geo block (center, distance in metres) is what the API takes; the where
filter of the app — inside a municipality or a parish by the CAOP boundary —
is applied here too, with a point-in-polygon on data/processed.
"""
import argparse
import base64
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROC = os.path.join(ROOT, "data", "processed")
API = "https://api.idealista.com"
PAGE = 50


def load(name):
    return json.load(open(os.path.join(PROC, name), encoding="utf-8"))


def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        if (y1 > y) != (y2 > y):
            xin = (x2 - x1) * (y - y1) / (y2 - y1 + 1e-300) + x1
            if x < xin:
                inside = not inside
    return inside


def poly_has(pt, geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        if point_in_ring(pt[0], pt[1], poly[0]) and not any(point_in_ring(pt[0], pt[1], h) for h in poly[1:]):
            return True
    return False


def parish_at(bf, lat, lon):
    for ft in bf["features"]:
        if poly_has((lon, lat), ft["geometry"]):
            p = ft["properties"]
            return p["mun_num"], "%s|%s" % (p["mun_num"], p["name"])
    return None, None


def api_params(q, geo, page):
    p = {"country": "pt", "locale": "pt", "operation": "rent" if q.get("op") == "rent" else "sale",
         "propertyType": "homes", "center": "%.6f,%.6f" % tuple(geo["center"]),
         "distance": str(int(geo["distance"])), "maxItems": str(PAGE), "numPage": str(page),
         "order": "price", "sort": "asc"}
    if q.get("type") == "home":
        p["flat"] = "true"
    if q.get("type") == "house":
        p["chalet"] = "true"
        p["countryHouse"] = "true"
    for k, ak in (("minPrice", "minPrice"), ("maxPrice", "maxPrice"), ("minSize", "minSize")):
        if q.get(k):
            p[ak] = str(int(float(q[k])))
    if q.get("rooms"):
        r = int(q["rooms"])
        p["bedrooms"] = ",".join(str(n) for n in range(r, 5)) if r <= 4 else "4"
    if q.get("renew"):
        p["status"] = "renew"
    if q.get("garden"):
        p["garden"] = "true"
    if q.get("terrace"):
        p["terrace"] = "true"
    return p


def from_api(el):
    st = el.get("suggestedTexts") or {}
    dt = el.get("detailedType") or {}
    return {"code": str(el.get("propertyCode")), "url": el.get("url", ""), "price": el.get("price"),
            "currency": "€", "size": el.get("size"), "rooms": el.get("rooms"), "bathrooms": el.get("bathrooms"),
            "floor": el.get("floor"), "type": (dt.get("typology", "") + ("/" + dt["subTypology"] if dt.get("subTypology") else "")) or el.get("propertyType", ""),
            "operation": el.get("operation", ""), "status": el.get("status", ""), "newDevelopment": bool(el.get("newDevelopment")),
            "ll": [el.get("latitude"), el.get("longitude")], "title": st.get("title") or el.get("address", ""),
            "subtitle": st.get("subtitle", ""), "description": el.get("description", ""), "thumbnail": el.get("thumbnail", ""),
            "photos": [i.get("url") for i in (el.get("images") or []) if i and i.get("url")], "numPhotos": el.get("numPhotos"),
            "priceByArea": el.get("priceByArea"), "features": el.get("features") or {}, "contact": el.get("contactInfo")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--query", help="query.json from the app")
    ap.add_argument("--center", help="lat,lon")
    ap.add_argument("--distance", type=int, help="metres")
    ap.add_argument("--op", choices=["sale", "rent"], default="sale")
    ap.add_argument("--type", choices=["home", "house", "any"], default="house")
    ap.add_argument("--min-price"); ap.add_argument("--max-price"); ap.add_argument("--min-size"); ap.add_argument("--rooms")
    ap.add_argument("--renew", action="store_true"); ap.add_argument("--garden", action="store_true"); ap.add_argument("--terrace", action="store_true")
    ap.add_argument("--cap", type=int, default=50, help="results at most (50 per request)")
    ap.add_argument("--apikey", default=os.environ.get("IDEALISTA_APIKEY"))
    ap.add_argument("--secret", default=os.environ.get("IDEALISTA_SECRET"))
    ap.add_argument("--out", default="listings.json")
    a = ap.parse_args()
    if a.query:
        qdoc = json.load(open(a.query, encoding="utf-8"))
        q, geo = qdoc.get("query", {}), qdoc.get("geo")
    else:
        if not a.center or not a.distance:
            sys.exit("give --query query.json, or --center lat,lon and --distance metres")
        q = {"op": a.op, "type": a.type, "where": "radius", "minPrice": a.min_price, "maxPrice": a.max_price,
             "minSize": a.min_size, "rooms": a.rooms, "renew": a.renew, "garden": a.garden, "terrace": a.terrace, "cap": a.cap}
        geo = {"center": [float(x) for x in a.center.split(",")], "distance": a.distance}
    if not geo:
        sys.exit("the query carries no geo block (center, distance)")
    if not a.apikey or not a.secret:
        sys.exit("no key: set IDEALISTA_APIKEY and IDEALISTA_SECRET, or --apikey/--secret")
    pages = max(1, -(-int(q.get("cap") or a.cap) // PAGE))
    print("this run spends %d requests (1 token + %d page%s)" % (1 + pages, pages, "" if pages == 1 else "s"))

    req = urllib.request.Request(API + "/oauth/token", data=b"grant_type=client_credentials&scope=read",
                                 headers={"Authorization": "Basic " + base64.b64encode(("%s:%s" % (a.apikey, a.secret)).encode()).decode(),
                                          "Content-Type": "application/x-www-form-urlencoded"})
    token = json.load(urllib.request.urlopen(req, timeout=60))["access_token"]
    items, total = [], 0
    for page in range(1, pages + 1):
        body = urllib.parse.urlencode(api_params(q, geo, page)).encode()
        r = urllib.request.Request(API + "/3.5/pt/search", data=body,
                                   headers={"Authorization": "Bearer " + token, "Content-Type": "application/x-www-form-urlencoded"})
        j = json.load(urllib.request.urlopen(r, timeout=120))
        total = j.get("total", 0)
        got = j.get("elementList") or []
        items += [from_api(el) for el in got]
        if len(got) < PAGE or page >= j.get("totalPages", 1):
            break

    # the app's where filter, by the CAOP boundary and never by the text
    bf = load("boundaries_freguesias.geojson")
    where = q.get("where")
    kept = []
    for it in items:
        if not all(isinstance(v, (int, float)) for v in it["ll"]):
            continue
        mun, zone = parish_at(bf, it["ll"][0], it["ll"][1])
        if where == "mun" and mun != q.get("mun"):
            continue
        if where == "zone" and zone != q.get("zone"):
            continue
        if where == "district" and mun is None:
            continue
        kept.append(it)
    out = {"kind": "listings", "provider": "idealista", "source": "script",
           "read_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
           "query": q, "total_at_provider": total, "items": kept}
    json.dump(out, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("wrote %s: %d listings kept of %d read (%d at the provider)" % (a.out, len(kept), len(items), total))


if __name__ == "__main__":
    main()
