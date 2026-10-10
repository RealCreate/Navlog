#!/usr/bin/env python3
"""Builds data/aip.json from ENAIRE's official AIP data service (Insignia):
aerodromes, VFR reporting points and published VFR routes (with their altitudes)
within 200 NM of LEBG or LERJ.

Source: https://servais.enaire.es/insignia/rest/services/INSIGNIA_SRV/Aero_SRV_VIGOR_V2/FeatureServer
"""
import json, math, sys, time, urllib.parse, urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else "data/aip.json"
BASE = "https://servais.enaire.es/insignia/rest/services/INSIGNIA_SRV/Aero_SRV_VIGOR_V2/FeatureServer"
CENTRES = {"LEBG": (42.3575, -3.6136), "LERJ": (42.4606, -2.3206)}
RANGE_NM = 200
BBOX = (-8.6, 38.9, 2.2, 45.8)  # lon/lat envelope comfortably containing both 200 NM circles


def nm(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 3440.065 * math.asin(min(1, math.sqrt(h)))


def in_range(lat, lon):
    return any(nm((lat, lon), c) <= RANGE_NM for c in CENTRES.values())


def query(layer, where="1=1", fields="*"):
    out, offset = [], 0
    while True:
        params = {
            "where": where, "outFields": fields, "outSR": 4326, "f": "json",
            "geometry": ",".join(map(str, BBOX)), "geometryType": "esriGeometryEnvelope", "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects", "resultOffset": offset, "resultRecordCount": 1000,
        }
        url = f"{BASE}/{layer}/query?" + urllib.parse.urlencode(params)
        for attempt in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "navlog-app"}), timeout=120) as r:
                    data = json.load(r)
                break
            except Exception as e:
                print(f"layer {layer}: {e}", file=sys.stderr)
                time.sleep(10)
        else:
            sys.exit(f"layer {layer} unavailable")
        if "error" in data:
            sys.exit(f"layer {layer}: {data['error']}")
        feats = data.get("features", [])
        out += feats
        if not data.get("exceededTransferLimit") or not feats:
            return out
        offset += len(feats)


def ft(val, uom):
    if val is None:
        return None
    try:
        v = float(val)
    except (TypeError, ValueError):
        return None
    return round(v * 3.28084) if (uom or "").upper() == "M" else round(v)


# Aerodromes
ads = []
for f in query(3):
    a, g = f["attributes"], f.get("geometry") or {}
    icao = (a.get("ICAO_TXT") or a.get("IDENT_TXT") or "").strip()
    if not icao or a.get("ABANDONED") in (1, "1") or "x" not in g:
        continue
    lat, lon = g["y"], g["x"]
    if not in_range(lat, lon):
        continue
    ads.append({
        "icao": icao, "name": (a.get("NAME_TXT") or "").strip(), "lat": round(lat, 6), "lon": round(lon, 6),
        "elev": ft(a.get("ELEV_VAL"), a.get("ELEV_UOM")), "var": a.get("MAGNETICVARIATION_VAL"),
        "type": a.get("TYPE_CODE"), "class": a.get("CLASS"), "mil": a.get("MILITARYUSE_CODE"),
        "ta": ft(a.get("TRANSITIONALT_VAL"), a.get("TRANSITIONALT_UOM")),
    })
print(f"{len(ads)} aerodromes", file=sys.stderr)

# VFR reporting points (DesignatedPoint TYPE_CODE = VFR), linked to the nearest aerodrome
vrps = []
for f in query(50, "TYPE_CODE='VFR'"):
    a, g = f["attributes"], f.get("geometry") or {}
    if "x" not in g:
        continue
    lat, lon = g["y"], g["x"]
    if not in_range(lat, lon):
        continue
    # Reporting points belong to aerodromes with a VAC: prefer the nearest public aerodrome,
    # otherwise the nearest aerodrome (not heliport) close by.
    def nearest(cands):
        return min(cands, key=lambda d: nm((lat, lon), (d["lat"], d["lon"]))) if cands else None
    pub = nearest([d for d in ads if d["type"] == "AD" and d["class"] == "PÚBLICO"])
    near, dist = None, 999
    if pub and nm((lat, lon), (pub["lat"], pub["lon"])) <= 25:
        near, dist = pub, nm((lat, lon), (pub["lat"], pub["lon"]))
    else:
        anyad = nearest([d for d in ads if d["type"] == "AD"])
        if anyad and nm((lat, lon), (anyad["lat"], anyad["lon"])) <= 15:
            near, dist = anyad, nm((lat, lon), (anyad["lat"], anyad["lon"]))
    vrps.append({
        "id": (a.get("IDENT_TXT") or "").strip(), "name": (a.get("NAME_TXT") or "").strip(),
        "lat": round(lat, 6), "lon": round(lon, 6), "ad": near["icao"] if near else None,
        "rmk": (a.get("REMARKS_EN_TXT") or a.get("REMARKS_ES_TXT") or None),
    })
print(f"{len(vrps)} VFR points", file=sys.stderr)

# Published VFR routes with their maximum altitude
routes = []
for f in query(29):
    a, g = f["attributes"], f.get("geometry") or {}
    paths = g.get("paths") or []
    if not paths:
        continue
    pts = [[round(p[1], 5), round(p[0], 5)] for path in paths for p in path]
    if not any(in_range(p[0], p[1]) for p in pts):
        continue
    upper = a.get("DISTVERTUPPER_VAL")
    code = a.get("DISTVERTUPPER_CODE")  # ALT (AMSL) / HEI(S) (AGL)
    if upper is None and a.get("UPPER_VAL") not in (None, "", "19499"):
        upper, code = a.get("UPPER_VAL"), "ALT"
    routes.append({
        "name": (a.get("NAME_TXT") or "").strip(), "rmk": a.get("REMARKS_TXT"),
        "upper": ft(upper, a.get("DISTVERTUPPER_UOM")), "ref": code,
        "lower": ft(a.get("DISTVERTLOWER_VAL"), a.get("DISTVERTLOWER_UOM")),
        "dir": a.get("DIRECTION_CODE"), "pts": pts,
    })
print(f"{len(routes)} VFR routes", file=sys.stderr)

json.dump({"source": BASE, "built": time.strftime("%Y-%m-%d"), "aerodromes": ads, "vrps": vrps, "routes": routes},
          open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"wrote {OUT}")
if len(ads) < 5:
    sys.exit("too few aerodromes")
