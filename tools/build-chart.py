#!/usr/bin/env python3
"""Builds the app's own VFR chart base (Rogers-Data-like look) as XYZ WebP tiles:

  terrain   SRTM-based elevation (Terrarium tiles, AWS Open Data) → hypsometric tints + relief
  ground    OpenStreetMap (Geofabrik extract, filtered with osmium): built-up areas, lakes and
            reservoirs, rivers, railways, motorways (orange), main roads (yellow), minor roads

Airspaces, aerodromes, reporting points, grid minimum altitudes and town names are NOT in the
tiles: the app draws them on top as vectors (js/aviation.js), so they stay sharp and current.

  build-chart.py --area area.geojson --osm features.geojsonseq --out chart [--dem dem.tif]
                 [--zmin 6] [--zmax 12] [--dem-zoom 11] [--work DIR] [--procs N]

Runs in GitHub Actions (python3 with python3-gdal, python3-numpy, python3-pil).
"""
import argparse, io, json, math, os, subprocess, sys, tempfile, urllib.request
from concurrent.futures import ThreadPoolExecutor
from multiprocessing import Pool

import numpy as np
from osgeo import gdal, ogr, osr
from PIL import Image, ImageDraw

gdal.UseExceptions()
R = 6378137.0
ORIGIN = math.pi * R
TILE = 256


def lonlat_to_px(lon, lat, z):
    n = TILE * 2 ** z
    x = (lon + 180.0) / 360.0 * n
    r = math.radians(lat)
    y = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n
    return x, y


# ----------------------------------------------------------------------------- terrain

TINT = """0 150 196 128
450 172 208 138
700 206 224 156
850 232 233 172
950 244 236 180
1100 242 220 162
1300 228 192 136
1550 206 160 112
1850 182 136 98
2300 160 122 92
3000 150 115 95
nv 0 0 0 0
"""
SEA = (160, 200, 228)


def fetch_dem(bbox, z, out):
    """Terrarium tiles covering bbox (lon/lat) at zoom z → Float32 GeoTIFF in EPSG:3857."""
    w, s, e, n = bbox
    x0, y0 = lonlat_to_px(w, n, z); x1, y1 = lonlat_to_px(e, s, z)
    tx0, ty0, tx1, ty1 = int(x0 // TILE), int(y0 // TILE), int(x1 // TILE), int(y1 // TILE)
    cols, rows = tx1 - tx0 + 1, ty1 - ty0 + 1
    print(f'DEM z{z}: {cols}×{rows} tiles', flush=True)
    arr = np.zeros((rows * TILE, cols * TILE), dtype=np.float32)

    def get(t):
        tx, ty = t
        url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png'
        for attempt in range(4):
            try:
                a = np.asarray(Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=60).read())).convert('RGB')).astype(np.float32)
                return tx, ty, a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
            except Exception as ex:  # noqa: BLE001
                err = ex
        print('DEM tile failed', url, err, flush=True)
        return tx, ty, None

    with ThreadPoolExecutor(16) as ex:
        for tx, ty, a in ex.map(get, [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]):
            if a is not None:
                arr[(ty - ty0) * TILE:(ty - ty0 + 1) * TILE, (tx - tx0) * TILE:(tx - tx0 + 1) * TILE] = a
    size = 2 * ORIGIN / (2 ** z) / TILE
    ds = gdal.GetDriverByName('GTiff').Create(out, arr.shape[1], arr.shape[0], 1, gdal.GDT_Float32, ['COMPRESS=DEFLATE', 'TILED=YES', 'BIGTIFF=IF_SAFER'])
    ds.SetGeoTransform([tx0 * TILE * size - ORIGIN, size, 0, ORIGIN - ty0 * TILE * size, 0, -size])
    sr = osr.SpatialReference(); sr.ImportFromEPSG(3857); ds.SetProjection(sr.ExportToWkt())
    ds.GetRasterBand(1).WriteArray(arr)
    ds = None


def build_terrain(dem, area, work):
    """DEM → RGBA GeoTIFF (tints × relief, sea in blue, outside the area transparent)."""
    run = lambda *a: subprocess.run(a, check=True)
    tint_txt = os.path.join(work, 'tint.txt'); open(tint_txt, 'w').write(TINT)
    run('gdaldem', 'hillshade', '-q', '-z', '3', '-az', '315', '-alt', '35', '-compute_edges', '-co', 'TILED=YES', '-co', 'BIGTIFF=IF_SAFER', dem, f'{work}/hs.tif')
    run('gdaldem', 'color-relief', '-q', '-co', 'TILED=YES', '-co', 'BIGTIFF=IF_SAFER', dem, tint_txt, f'{work}/tint.tif')
    src_t, src_h, src_d = gdal.Open(f'{work}/tint.tif'), gdal.Open(f'{work}/hs.tif'), gdal.Open(dem)
    W, H = src_t.RasterXSize, src_t.RasterYSize
    out = gdal.GetDriverByName('GTiff').Create(f'{work}/terrain-rgb.tif', W, H, 3, gdal.GDT_Byte, ['COMPRESS=DEFLATE', 'TILED=YES', 'BIGTIFF=IF_SAFER'])
    out.SetGeoTransform(src_t.GetGeoTransform()); out.SetProjection(src_t.GetProjection())
    B = 2048
    for y in range(0, H, B):
        h = min(B, H - y)
        t = np.stack([src_t.GetRasterBand(i + 1).ReadAsArray(0, y, W, h) for i in range(3)], -1).astype(np.float32)
        hs = src_h.GetRasterBand(1).ReadAsArray(0, y, W, h).astype(np.float32) / 255.0
        el = src_d.GetRasterBand(1).ReadAsArray(0, y, W, h)
        m = t.mean(axis=2, keepdims=True)
        t = m + (t - m) * 1.25                      # a little more colour
        shade = 0.46 + 0.66 * hs                     # strong relief (OpenTopoMap-like)
        rgb = t * shade[..., None]
        rgb = np.where(hs[..., None] > 0.8, rgb * 0.92 + 255 * 0.08, rgb)
        sea = el <= 0.5
        rgb[sea] = SEA
        rgb = rgb.clip(0, 255).astype(np.uint8)
        for i in range(3): out.GetRasterBand(i + 1).WriteArray(rgb[..., i], 0, y)
    out = None
    run('gdalwarp', '-q', '-overwrite', '-cutline', area, '-dstalpha', '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'BIGTIFF=IF_SAFER',
        f'{work}/terrain-rgb.tif', f'{work}/terrain.tif')
    return f'{work}/terrain.tif'


# ----------------------------------------------------------------------------- ground features

ZREF = 12          # feature coordinates are stored as pixels at this zoom
CELL = 2048        # spatial index cell (z12 pixels)


def load_features(path):
    """GeoJSON sequence (osmium export) → lists of features in z12 pixel coordinates."""
    feats = {k: [] for k in ('water', 'builtup', 'river', 'rail', 'motorway', 'primary', 'secondary', 'tertiary')}
    def proj(coords):
        return [lonlat_to_px(c[0], c[1], ZREF) for c in coords]
    for line in open(path, encoding='utf-8'):
        line = line.strip().lstrip('\x1e')
        if not line: continue
        f = json.loads(line); g = f.get('geometry') or {}; t = f.get('properties') or {}
        typ = g.get('type')
        if typ in ('Polygon', 'MultiPolygon'):
            polys = [g['coordinates']] if typ == 'Polygon' else g['coordinates']
            kind = 'water' if t.get('natural') == 'water' else 'builtup' if t.get('landuse') == 'residential' else None
            if not kind: continue
            for poly in polys:
                rings = [proj(r) for r in poly if len(r) > 2]
                if rings: feats[kind].append(rings)
        elif typ == 'LineString':
            hw, rw = t.get('highway'), t.get('railway')
            kind = ('river' if t.get('waterway') == 'river' else 'rail' if rw == 'rail' else
                    'motorway' if hw in ('motorway', 'trunk') else
                    'primary' if hw in ('primary', 'motorway_link', 'trunk_link') else
                    'secondary' if hw == 'secondary' else 'tertiary' if hw == 'tertiary' else None)
            if kind: feats[kind].append(proj(g['coordinates']))
    for k, v in feats.items(): print(f'  {k}: {len(v)}', flush=True)
    return feats


def bbox_of(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def index(feats):
    idx = {}
    for kind, items in feats.items():
        for i, it in enumerate(items):
            pts = it[0] if kind in ('water', 'builtup') else it
            b = bbox_of(pts)
            area = (b[2] - b[0]) * (b[3] - b[1])
            for cx in range(int(b[0] // CELL), int(b[2] // CELL) + 1):
                for cy in range(int(b[1] // CELL), int(b[3] // CELL) + 1):
                    idx.setdefault((cx, cy), []).append((kind, i, b, area))
    return idx


# style per zoom: (min zoom, width at z8, width at z12) for lines, casing colours
LINES = [  # drawn in this order
    ('river', 8, (40, 110, 200), None, 0.7, 1.5),
    ('tertiary', 11, (255, 252, 228), (150, 140, 110), 0.8, 1.3),
    ('secondary', 9, (255, 240, 150), (150, 130, 80), 0.8, 1.9),
    ('primary', 7, (255, 226, 70), (150, 115, 35), 1.0, 2.5),
    ('motorway', 6, (245, 125, 30), (120, 45, 10), 1.3, 3.4),
]
SS = 2  # supersampling for smooth lines


def width_at(z, w8, w12):
    return max(0.5, w8 + (w12 - w8) * (z - 8) / 4.0)


G = {}  # globals for worker processes (set before fork)


def render_tile(job):
    z, x, y, src, dst = job
    feats, idx = G['feats'], G['idx']
    k = 2 ** (ZREF - z)                           # z12 px per tile px
    ox, oy = x * TILE * k, y * TILE * k
    x1, y1 = ox + TILE * k, oy + TILE * k
    pad = 8 * k
    cand = {}
    for cx in range(int((ox - pad) // CELL), int((x1 + pad) // CELL) + 1):
        for cy in range(int((oy - pad) // CELL), int((y1 + pad) // CELL) + 1):
            for kind, i, b, area in idx.get((cx, cy), ()):
                if b[2] < ox - pad or b[0] > x1 + pad or b[3] < oy - pad or b[1] > y1 + pad: continue
                cand[(kind, i)] = area
    base = Image.open(src).convert('RGBA')
    if not cand:
        base.save(dst, 'WEBP', quality=82, method=4); return
    S = TILE * SS
    ov = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    tp = lambda pts: [((px - ox) / k * SS, (py - oy) / k * SS) for px, py in pts]
    minarea = lambda zmin_px: (zmin_px * k) ** 2      # area threshold in z12 px²
    # built-up areas (yellow, ICAO style)
    if z >= 9:
        for (kind, i), area in cand.items():
            if kind != 'builtup' or area < minarea(3 if z >= 11 else 6): continue
            rings = feats[kind][i]
            d.polygon(tp(rings[0]), fill=(250, 214, 70, 215), outline=(170, 125, 25, 255))
    # lakes / reservoirs
    for (kind, i), area in cand.items():
        if kind != 'water' or area < minarea(4 if z >= 10 else 8): continue
        rings = feats[kind][i]
        d.polygon(tp(rings[0]), fill=(140, 190, 230, 255), outline=(40, 110, 190, 255))
    # railways under the roads
    if z >= 8:
        w = width_at(z, 1.0, 1.8) * SS
        for (kind, i), _ in cand.items():
            if kind != 'rail': continue
            pts = tp(feats[kind][i])
            if len(pts) < 2: continue
            d.line(pts, fill=(45, 45, 45, 255), width=max(1, int(round(w))))
            if z >= 11:  # cross-ties
                step = 9 * SS
                for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                    L = math.hypot(bx - ax, by - ay)
                    if L < 1: continue
                    nx, ny = -(by - ay) / L * 2.6 * SS, (bx - ax) / L * 2.6 * SS
                    for s_ in range(1, int(L // step) + 1):
                        f = s_ * step / L; cx_, cy_ = ax + (bx - ax) * f, ay + (by - ay) * f
                        d.line([(cx_ - nx, cy_ - ny), (cx_ + nx, cy_ + ny)], fill=(45, 45, 45, 255), width=max(1, SS))
    # rivers and roads: casing first, then fill
    for kind, zmin, fill, casing, w8, w12 in LINES:
        if z < zmin: continue
        w = width_at(z, w8, w12) * SS
        ways = [tp(feats[kind][i]) for (kk, i), _ in cand.items() if kk == kind]
        if casing is not None and z >= 9:
            for pts in ways:
                if len(pts) > 1: d.line(pts, fill=casing + (255,), width=int(round(w + 1.6 * SS)), joint='curve')
        for pts in ways:
            if len(pts) > 1: d.line(pts, fill=fill + (255,), width=max(1, int(round(w))), joint='curve')
    ov = ov.resize((TILE, TILE), Image.LANCZOS)
    alpha = base.getchannel('A')
    out = Image.alpha_composite(base, ov)
    out.putalpha(alpha)                               # nothing outside the chart area
    out.save(dst, 'WEBP', quality=82, method=4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--area', required=True)
    ap.add_argument('--osm', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--dem')
    ap.add_argument('--dem-zoom', type=int, default=11)
    ap.add_argument('--zmin', type=int, default=6)
    ap.add_argument('--zmax', type=int, default=12)
    ap.add_argument('--work')
    ap.add_argument('--procs', type=int, default=os.cpu_count())
    a = ap.parse_args()
    work = a.work or tempfile.mkdtemp()
    os.makedirs(work, exist_ok=True)
    area = ogr.CreateGeometryFromJson(json.dumps(json.load(open(a.area))['features'][0]['geometry']))
    w, e, s, n = area.GetEnvelope()
    dem = a.dem
    if not dem:
        dem = f'{work}/dem.tif'
        fetch_dem((w, s, e, n), a.dem_zoom, dem)
    terrain = build_terrain(dem, a.area, work)
    tdir = f'{work}/terrain-tiles'
    subprocess.run([sys.executable, __import__('shutil').which('gdal2tiles.py'), '--xyz', '-q', '-z', f'{a.zmin}-{a.zmax}', '-w', 'none', '-r', 'lanczos', '--exclude',
                    f'--processes={a.procs}', terrain, tdir], check=True)
    print('loading OSM features', flush=True)
    G['feats'] = load_features(a.osm)
    G['idx'] = index(G['feats'])
    jobs = []
    for zs in os.listdir(tdir):
        if not zs.isdigit(): continue
        for xs in os.listdir(f'{tdir}/{zs}'):
            for f in os.listdir(f'{tdir}/{zs}/{xs}'):
                if not f.endswith('.png'): continue
                ys = f[:-4]
                os.makedirs(f'{a.out}/{zs}/{xs}', exist_ok=True)
                jobs.append((int(zs), int(xs), int(ys), f'{tdir}/{zs}/{xs}/{f}', f'{a.out}/{zs}/{xs}/{ys}.webp'))
    print(f'rendering {len(jobs)} tiles', flush=True)
    with Pool(a.procs) as p:
        for k, _ in enumerate(p.imap_unordered(render_tile, jobs, chunksize=16)):
            if k % 2000 == 0: print(f'  {k}/{len(jobs)}', flush=True)
    json.dump({'built': __import__('datetime').date.today().isoformat(), 'bounds': [[s, w], [n, e]], 'zmin': a.zmin, 'zmax': a.zmax,
               'source': 'Terrain: SRTM via Terrarium (AWS Open Data) · Map data © OpenStreetMap contributors'}, open(f'{a.out}/meta.json', 'w'))
    print('done', flush=True)


if __name__ == '__main__':
    main()
