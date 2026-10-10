#!/usr/bin/env python3
"""Builds data/places.json (town and village names) from OpenStreetMap via Overpass.

Output: [[name, lat, lon, rank], ...] sorted by importance; rank 0 city, 1 town, 2 village.
Area: the VFR chart sheets used by the app (northern and north-central Spain).
"""
import json, sys, time, urllib.parse, urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else "data/places.json"
BBOX = (39.4, -9.6, 43.95, -1.0)  # S, W, N, E
QUERY = f"""
[out:json][timeout:300];
node["place"~"^(city|town|village)$"]["name"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
out;
"""
SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
RANK = {"city": 0, "town": 1, "village": 2}

data = None
for attempt in range(3):
    for url in SERVERS:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": QUERY}).encode(),
                                         headers={"User-Agent": "navlog-app (github.com/RealCreate/Navlog)"})
            with urllib.request.urlopen(req, timeout=400) as r:
                data = json.load(r)
            break
        except Exception as e:  # try the next mirror
            print(f"{url}: {e}", file=sys.stderr)
    if data:
        break
    time.sleep(30)
if not data:
    sys.exit("Overpass unavailable")

def pop(tags):
    try:
        return int(str(tags.get("population", "0")).replace(".", "").replace(",", "").split()[0])
    except ValueError:
        return 0

rows = []
for el in data["elements"]:
    t = el.get("tags", {})
    name = t.get("name:es") or t.get("name")
    if not name:
        continue
    rows.append((RANK[t["place"]], -pop(t), name, round(el["lat"], 5), round(el["lon"], 5)))
rows.sort()
out = [[n, lat, lon, rank] for rank, _, n, lat, lon in rows]
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(f"{len(out)} places -> {OUT}")
