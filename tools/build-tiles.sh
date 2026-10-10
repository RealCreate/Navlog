#!/usr/bin/env bash
# Builds web map tiles (XYZ, WebP) from the official ENAIRE VFR 1:500 000 GeoTIFFs
# published in the AIP España ("Cartas de Insignia" page). Runs in GitHub Actions.
#
#   tools/build-tiles.sh <out-dir> <zip-url> [<zip-url> ...]
#
# Later sheets are drawn on top of earlier ones where they overlap.
set -euo pipefail

OUT="$1"; shift
WORK="$(mktemp -d)"
ZMIN="${ZMIN:-6}"
ZMAX="${ZMAX:-12}"
mkdir -p "$OUT" "$OUT/../chart-previews"

warped=()
names=()
for url in "$@"; do
  name="$(basename "$url" .zip)"
  names+=("$name")
  echo "::group::Download $name"
  curl -fSL --retry 3 -o "$WORK/$name.zip" "$url"
  mkdir -p "$WORK/$name"
  unzip -q -o "$WORK/$name.zip" -d "$WORK/$name"
  find "$WORK/$name" -type f | head -50
  echo "::endgroup::"

  tif="$(find "$WORK/$name" -type f \( -iname '*.tif' -o -iname '*.tiff' \) | head -1)"
  if [[ -z "$tif" ]]; then echo "No GeoTIFF in $name" >&2; exit 1; fi

  echo "::group::gdalinfo $name"
  gdalinfo "$tif" | grep -vE '^\s+[0-9]+: ' | head -80
  echo "::endgroup::"

  src="$tif"
  if gdalinfo "$tif" | grep -q 'Color Table'; then
    gdal_translate -q -expand rgb "$tif" "$WORK/$name-rgb.tif" -co TILED=YES -co COMPRESS=DEFLATE
    src="$WORK/$name-rgb.tif"
  fi

  # Reproject to Web Mercator with an alpha band so the area outside the sheet is transparent.
  gdalwarp -q -overwrite -t_srs EPSG:3857 -r cubic -dstalpha -multi -wo NUM_THREADS=ALL_CPUS \
    -co TILED=YES -co COMPRESS=DEFLATE -co BIGTIFF=IF_SAFER "$src" "$WORK/$name-3857.tif"
  warped+=("$WORK/$name-3857.tif")

  # Small preview to check margins/legends.
  gdal_translate -q -of PNG -outsize 1600 0 -b 1 -b 2 -b 3 "$WORK/$name-3857.tif" "$OUT/../chart-previews/$name.png" || true
done

gdalbuildvrt -q "$WORK/mosaic.vrt" "${warped[@]}"
gdalinfo "$WORK/mosaic.vrt" | head -30

echo "::group::gdal2tiles z$ZMIN-$ZMAX"
gdal2tiles.py --xyz -z "$ZMIN-$ZMAX" -w none -r lanczos \
  --tiledriver=WEBP --webp-quality=92 \
  --processes="$(nproc)" "$WORK/mosaic.vrt" "$OUT"
echo "::endgroup::"

# Bounds (lat/lon) for the map
python3 - "$WORK/mosaic.vrt" "$OUT/meta.json" "${names[@]}" <<'PY'
import json, sys, datetime
from osgeo import gdal, osr
vrt, out, *names = sys.argv[1:]
ds = gdal.Open(vrt)
gt = ds.GetGeoTransform()
x0, y0 = gt[0], gt[3]
x1, y1 = x0 + gt[1] * ds.RasterXSize, y0 + gt[5] * ds.RasterYSize
src = osr.SpatialReference(); src.ImportFromWkt(ds.GetProjection())
dst = osr.SpatialReference(); dst.ImportFromEPSG(4326)
dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
tr = osr.CoordinateTransformation(src, dst)
(w, s, _), (e, n, _) = tr.TransformPoint(x0, y1), tr.TransformPoint(x1, y0)
json.dump({
  "charts": names,
  "source": "https://aip.enaire.es/AIP/CartasInsigniaImpresas-es.html",
  "bounds": [[s, w], [n, e]],
  "built": datetime.datetime.utcnow().strftime("%Y-%m-%d"),
}, open(out, "w"), indent=1)
print(open(out).read())
PY

du -sh "$OUT"
find "$OUT" -name '*.webp' | wc -l
rm -rf "$WORK"
