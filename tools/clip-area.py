"""Writes the chart area as GeoJSON (EPSG:4326): the union of circles of CLIP_NM nautical miles
around each centre ("lat,lon;lat,lon"). Also checks whether a GeoTIFF intersects it.

  clip-area.py make <out.geojson> "<lat,lon;lat,lon>" <nm>
  clip-area.py hits <area.geojson> <file.tif>      (exit 0 if the sheet overlaps the area)
"""
import json, math, sys
from osgeo import gdal, ogr

def circle(lat, lon, nm, n=180):
    pts = []
    for i in range(n):
        b = 2 * math.pi * i / n
        d = nm / 60.0  # degrees of latitude
        la = lat + d * math.cos(b)
        lo = lon + d * math.sin(b) / math.cos(math.radians(la))
        pts.append((lo, la))
    pts.append(pts[0])  # closed ring
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for lo, la in pts: ring.AddPoint_2D(lo, la)
    poly = ogr.Geometry(ogr.wkbPolygon); poly.AddGeometry(ring)
    return poly

if sys.argv[1] == 'make':
    out, centres, nm = sys.argv[2], sys.argv[3], float(sys.argv[4])
    area = None
    for c in centres.split(';'):
        lat, lon = map(float, c.split(','))
        g = circle(lat, lon, nm)
        area = g if area is None else area.Union(g)
    json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {}, 'geometry': json.loads(area.ExportToJson())}]}, open(out, 'w'))
    print('area bbox (lon/lat):', area.GetEnvelope())
else:
    area = ogr.CreateGeometryFromJson(json.dumps(json.load(open(sys.argv[2]))['features'][0]['geometry']))
    ds = gdal.Warp('/tmp/hits.vrt', sys.argv[3], format='VRT', dstSRS='EPSG:4326')
    gt = ds.GetGeoTransform()
    x0, y0, x1, y1 = gt[0], gt[3], gt[0] + gt[1] * ds.RasterXSize, gt[3] + gt[5] * ds.RasterYSize
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]: ring.AddPoint_2D(x, y)
    box = ogr.Geometry(ogr.wkbPolygon); box.AddGeometry(ring)
    sys.exit(0 if box.Intersects(area) else 1)
