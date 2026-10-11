#!/bin/bash
mkdir -p out; cd out
B=https://realcreate.github.io/Navlog
{ for f in data/places.json data/aip.json data/obstacles.json js/places.js sw.js; do echo "$f $(curl -s -o /tmp/x -w '%{http_code} %{size_download}' $B/$f) $(head -c 120 /tmp/x | tr '\n' ' ')"; done; } > live.txt
cat live.txt
