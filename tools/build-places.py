#!/usr/bin/env python3
"""Builds data/places.json (city, town and village names) from the GeoNames dump for Spain.

Output: [[name, lat, lon, rank], ...] sorted by importance; rank 0 city, 1 town, 2 village.
Area: the VFR chart sheets used by the app (northern and north-central Spain).
Data: GeoNames (CC BY 4.0), https://download.geonames.org/export/dump/ES.zip
"""
import csv, io, sys, urllib.request, zipfile

OUT = sys.argv[1] if len(sys.argv) > 1 else "data/places.json"
S, W, N, E = 39.4, -9.6, 43.95, -1.0
URL = "https://download.geonames.org/export/dump/ES.zip"

req = urllib.request.Request(URL, headers={"User-Agent": "navlog-app (github.com/RealCreate/Navlog)"})
raw = urllib.request.urlopen(req, timeout=300).read()
z = zipfile.ZipFile(io.BytesIO(raw))
text = z.read("ES.txt").decode("utf-8")
csv.field_size_limit(10**7)

rows = []
for r in csv.reader(io.StringIO(text), delimiter="\t", quoting=csv.QUOTE_NONE):
    # geonameid, name, asciiname, alternatenames, lat, lon, fclass, fcode, cc, cc2, a1, a2, a3, a4, population, ...
    if len(r) < 15 or r[6] != "P" or r[7] in ("PPLH", "PPLQ", "PPLW", "PPLX", "PPLCH"):
        continue
    lat, lon = float(r[4]), float(r[5])
    if not (S <= lat <= N and W <= lon <= E):
        continue
    pop = int(r[14] or 0)
    code = r[7]
    if pop >= 50000 or code in ("PPLC", "PPLA", "PPLA2"):
        rank = 0
    elif pop >= 3000 or code == "PPLA3":
        rank = 1
    else:
        rank = 2
    rows.append((rank, -pop, r[1], round(lat, 5), round(lon, 5)))

rows.sort()
seen, out = set(), []
for rank, _, name, lat, lon in rows:
    key = (name, round(lat, 2), round(lon, 2))
    if key in seen:
        continue
    seen.add(key)
    out.append([name, lat, lon, rank])

import json
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(f"{len(out)} places -> {OUT}; cities {sum(1 for o in out if o[3]==0)}, towns {sum(1 for o in out if o[3]==1)}")
if len(out) < 500:
    sys.exit("Too few places — something went wrong")
