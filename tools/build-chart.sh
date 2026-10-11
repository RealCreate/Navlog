#!/usr/bin/env bash
# Builds the app's own chart tiles into ./chart (see tools/build-chart.py). Runs in GitHub Actions.
# Area: 200 NM around LEBG and LERJ (tools/clip-area.py). OSM from Geofabrik, terrain from AWS.
set -euo pipefail
W="$(mktemp -d)"
HERE="$(cd "$(dirname "$0")" && pwd)"
python3 "$HERE/clip-area.py" make "$W/area.geojson" "42.3575,-3.6136;42.4606,-2.3206" 200
GF=https://download.geofabrik.de/europe
parts=()
for f in spain france/aquitaine france/midi-pyrenees andorra; do
  n=$(basename "$f")
  echo "::group::OSM $n"
  curl -fsSL --retry 3 -o "$W/$n.pbf" "$GF/$f-latest.osm.pbf"
  osmium extract --overwrite -s smart -p "$W/area.geojson" "$W/$n.pbf" -o "$W/$n-area.pbf"
  rm -f "$W/$n.pbf"
  osmium tags-filter --overwrite "$W/$n-area.pbf" \
    w/highway=motorway,trunk,primary,secondary,tertiary,motorway_link,trunk_link w/railway=rail \
    w/waterway=river wr/natural=water wr/landuse=residential -o "$W/$n-feat.pbf"
  rm -f "$W/$n-area.pbf"
  parts+=("$W/$n-feat.pbf")
  echo "::endgroup::"
done
osmium merge --overwrite "${parts[@]}" -o "$W/feat.pbf"
osmium export --overwrite -f geojsonseq "$W/feat.pbf" -o "$W/feat.geojsonseq"
ls -la "$W"
python3 "$HERE/build-chart.py" --area "$W/area.geojson" --osm "$W/feat.geojsonseq" --out "$W/chart" --work "$W/work" --zmin 6 --zmax 12
rm -rf chart && mv "$W/chart" chart
du -sh chart; find chart -name '*.webp' | wc -l
