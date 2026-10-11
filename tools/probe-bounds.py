import sys
from osgeo import gdal
tif, name = sys.argv[1], sys.argv[2]
ds = gdal.Warp('/tmp/w.vrt', tif, format='VRT', dstSRS='EPSG:4326')
gt = ds.GetGeoTransform()
print(name, round(gt[0], 3), round(gt[3], 3), round(gt[0] + gt[1] * ds.RasterXSize, 3), round(gt[3] + gt[5] * ds.RasterYSize, 3))
