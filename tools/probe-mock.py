# Fetches raw data for a chart mock-up of the Burgos area: Terrarium elevation tiles (z10 mosaic
# as a GeoTIFF) and OpenStreetMap features from Overpass.
import json, math, os, sys, urllib.request, urllib.parse, io
from osgeo import gdal
import numpy as np
from PIL import Image
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
W, S, E, N = -4.35, 41.85, -2.15, 42.95
Z = 10
def tile(lon, lat, z):
    n = 2 ** z; r = math.radians(lat)
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n
x0, y0 = tile(W, N, Z); x1, y1 = tile(E, S, Z)
tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
cols, rows = tx1 - tx0 + 1, ty1 - ty0 + 1
elev = np.zeros((rows * 256, cols * 256), dtype=np.float32)
for ty in ([] if os.environ.get('NODEM') else range(ty0, ty1 + 1)):
    for tx in range(tx0, tx1 + 1):
        u = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png'
        a = np.asarray(Image.open(io.BytesIO(urllib.request.urlopen(u, timeout=60).read())).convert('RGB')).astype(np.float32)
        elev[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
# georeference in EPSG:3857
R = 6378137.0; size = 2 * math.pi * R / (2 ** Z) / 256
ox = tx0 * 256 * size - math.pi * R; oy = math.pi * R - ty0 * 256 * size
ds = gdal.GetDriverByName('GTiff').Create(f'{out}/dem.tif', elev.shape[1], elev.shape[0], 1, gdal.GDT_Float32, ['COMPRESS=DEFLATE'])
ds.SetGeoTransform([ox, size, 0, oy, 0, -size]); ds.SetProjection('EPSG:3857' if False else gdal.osr.SpatialReference().ExportToWkt() or '')
from osgeo import osr
sr = osr.SpatialReference(); sr.ImportFromEPSG(3857); ds.SetProjection(sr.ExportToWkt())
ds.GetRasterBand(1).WriteArray(elev); ds = None
print('dem', elev.shape, elev.min(), elev.max())
q = f"""[out:json][timeout:120];(
way["highway"~"^(motorway|trunk|primary)$"]({S},{W},{N},{E});
way["railway"="rail"]({S},{W},{N},{E});
way["waterway"="river"]({S},{W},{N},{E});
way["natural"="water"]["water"~"reservoir|lake"]({S},{W},{N},{E});
node["place"~"^(city|town)$"]({S},{W},{N},{E});
node["place"="village"]["population"]({S},{W},{N},{E});
way["landuse"="residential"]["name"]({S},{W},{N},{E});
);out geom;"""
for host in ['https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']:
    try:
        req = urllib.request.Request(host, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'navlog-chart-mock/1.0 (github.com/RealCreate/Navlog)'})
        r = urllib.request.urlopen(req, timeout=180).read()
        open(f'{out}/osm.json', 'wb').write(r); print('osm', len(r)); break
    except Exception as e: print('overpass fail', host, e)
