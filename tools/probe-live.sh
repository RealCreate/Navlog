#!/bin/bash
# AEMET key check: status + CORS header of the analysis endpoint and the data URL (key not printed)
K=$(grep -o "'eyJ[^']*'" src/js/aemet-key.js | tr -d "'")
mkdir -p out; cd out
curl -s -m 30 -D h1.txt -H "Origin: https://realcreate.github.io" "https://opendata.aemet.es/opendata/api/mapasygraficos/analisis?api_key=$K" -o b1.json
D=$(python3 -c "import json;print(json.load(open('b1.json')).get('datos',''))" 2>/dev/null)
{ grep -i -E "^HTTP|access-control" h1.txt; python3 -c "import json;d=json.load(open('b1.json'));print({k:v for k,v in d.items() if k!='datos'}, 'datos' in d)"; } > aemet.txt 2>&1
if [ -n "$D" ]; then curl -s -m 30 -D h2.txt -H "Origin: https://realcreate.github.io" "$D" -o map.bin; { grep -i -E "^HTTP|access-control|content-type" h2.txt; file map.bin; } >> aemet.txt; fi
rm -f h1.txt h2.txt b1.json map.bin; cat aemet.txt
