set -e
mkdir -p out
B=https://realcreate.github.io/Navlog
curl -fsSL $B/data/obstacles.json -o out/obstacles.json || echo "no obstacles" > out/missing.txt
curl -fsSL $B/data/aip.json -o out/aip.json || true
ls -la out
