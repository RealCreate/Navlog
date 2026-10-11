#!/bin/bash
mkdir -p out; cd out
curl -s -m 60 -o spec.json https://opendata.aemet.es/AEMET_OpenData_specification.json; ls -la spec.json
python3 -c "
import json;d=json.load(open('spec.json'))
for p,v in d.get('paths',{}).items():
  for m,o in v.items(): print(p, '|', (o.get('summary') or '')[:90])
" > paths.txt 2>&1
for u in https://ama.aemet.es/ https://ama.aemet.es/o/estaticos/bbdd/imagenes/ ; do echo "$u $(curl -s -m 20 -o /dev/null -w '%{http_code}' $u)"; done >> paths.txt
rm -f spec.json; wc -l paths.txt
