import json, urllib.request, urllib.parse, sys, os
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
def get(u): return json.loads(urllib.request.urlopen(u, timeout=120).read())
root = "https://servais.enaire.es/insignia/rest/services"
res = {}
for folder in ['', 'INSIGNIA_SRV', 'NSF_SRV', 'INSIGNIA']:
    try:
        d = get(f"{root}/{folder}?f=json" if folder else f"{root}?f=json"); res[folder] = d; print(folder, [s['name'] for s in d.get('services', [])], d.get('folders'))
    except Exception as e: print(folder, 'ERR', e)
json.dump(res, open(f"{out}/services.json", "w"), indent=1)
# list layers of every service with sector-like names
for folder, d in res.items():
    for s in d.get('services', []):
        u = f"{root}/{s['name']}/{s['type']}?f=json"
        try:
            info = get(u)
            names = [(l['id'], l['name']) for l in info.get('layers', [])]
            hit = [n for n in names if any(k in n[1].lower() for k in ('sector', 'cta', 'espacio', 'airspace', 'vfr'))]
            print(s['name'], s['type'], len(names), hit[:20])
        except Exception as e: print(s['name'], 'ERR', e)
