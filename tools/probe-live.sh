set -e
mkdir -p out
B=https://realcreate.github.io/Navlog
curl -fsSL $B/chart/meta.json -o out/meta.json || true
curl -fsSL $B/data/aip.json -o out/aip.json || true
python3 - <<'PY'
import math, urllib.request, os
from PIL import Image
import io
B='https://realcreate.github.io/Navlog/chart'
def grab(name, z, lat, lon, n):
    N=2**z; x=int((lon+180)/360*N); r=math.radians(lat); y=int((1-math.log(math.tan(r)+1/math.cos(r))/math.pi)/2*N)
    im=Image.new('RGB',(256*n,256*n),(220,220,220))
    for i in range(n):
        for j in range(n):
            try:
                d=urllib.request.urlopen(f'{B}/{z}/{x-n//2+i}/{y-n//2+j}.webp',timeout=30).read()
                im.paste(Image.open(io.BytesIO(d)).convert('RGB'),(i*256,j*256))
            except Exception as e: pass
    im.save(f'out/{name}.png')
grab('overview-z7', 7, 42.4, -3.0, 5)
grab('huesca-z10', 10, 42.08, -0.33, 4)
grab('burgos-z12', 12, 42.35, -3.65, 4)
grab('pyrenees-z9', 9, 42.8, -0.5, 4)
PY
ls -la out
