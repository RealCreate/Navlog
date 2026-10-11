#!/bin/bash
mkdir -p out; cd out
curl -s -o places.json https://realcreate.github.io/Navlog/data/places.json; ls -la places.json
