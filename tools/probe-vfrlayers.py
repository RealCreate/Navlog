import json, urllib.request, urllib.parse, sys, os
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
def get(u): return json.loads(urllib.request.urlopen(u, timeout=120).read())
for svc in ['Aero_SRV_AIRAC_V1', 'Aero_SRV_VIGOR_V2']:
    base = f"https://servais.enaire.es/insignia/rest/services/INSIGNIA_SRV/{svc}/MapServer"
    info = get(base + "?f=json")
    for l in info.get('layers', []):
        print(svc, l['id'], l['name'], 'parent', l.get('parentLayerId'), 'sub', l.get('subLayerIds'))
    env = json.dumps({"xmin": -4.2, "ymin": 42.0, "xmax": -3.0, "ymax": 42.8, "spatialReference": {"wkid": 4326}})
    for l in info.get('layers', []):
        if l.get('subLayerIds'): continue
        q = urllib.parse.urlencode({"where": "1=1", "geometry": env, "geometryType": "esriGeometryEnvelope", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "returnGeometry": "false", "f": "json"})
        try:
            d = get(f"{base}/{l['id']}/query?{q}")
            txt = json.dumps(d)
            if 'CVIT' in txt or 'sector' in txt.lower():
                json.dump(d, open(f"{out}/{svc}-{l['id']}.json", "w"))
                print('HIT', svc, l['id'], l['name'], len(d.get('features', [])))
        except Exception as e: print('ERR', l['id'], e)
