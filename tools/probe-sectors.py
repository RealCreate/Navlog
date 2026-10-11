import json, urllib.request, urllib.parse, sys, os
BASE = "https://servais.enaire.es/insignia/rest/services/INSIGNIA_SRV/Aero_SRV_VIGOR_Sectores_V1/FeatureServer"
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
def get(u):
    return json.loads(urllib.request.urlopen(u, timeout=120).read())
info = get(BASE + "?f=json")
json.dump(info, open(f"{out}/layers.json", "w"), indent=1)
names = [(l['id'], l['name']) for l in info.get('layers', [])]
print(names)
# features around Burgos / Vitoria for every polygon layer, attributes only (+ simplified geometry)
env = json.dumps({"xmin": -4.4, "ymin": 41.8, "xmax": -2.0, "ymax": 43.2, "spatialReference": {"wkid": 4326}})
for lid, name in names:
    try:
        q = urllib.parse.urlencode({"where": "1=1", "geometry": env, "geometryType": "esriGeometryEnvelope", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "returnGeometry": "true", "outSR": 4326, "maxAllowableOffset": 0.002, "geometryPrecision": 4, "f": "json"})
        d = get(f"{BASE}/{lid}/query?{q}")
        feats = d.get("features", [])
        json.dump(d, open(f"{out}/layer-{lid}.json", "w"))
        print(lid, name, len(feats), d.get("geometryType"))
    except Exception as e:
        print(lid, name, "ERR", e)
