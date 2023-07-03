#!/usr/bin/env python3

# Point to enclosing polygon
# https://gis.stackexchange.com/a/49749

import yaml
import glob
from osgeo import ogr


def ul_constrt(loader, node):
    return node.value


yaml.add_constructor("!ul", ul_constrt)
yaml.add_constructor("!u", ul_constrt)

KIND = "Sky"

outDriver = ogr.GetDriverByName("GeoJSON")
outDataSource = outDriver.CreateDataSource("sky_polys.json")
outLayer = outDataSource.CreateLayer("sky_polys", geom_type=ogr.wkbGeometryCollection)
groupDef = ogr.FieldDefn("group", ogr.OFTString)
xminDef = ogr.FieldDefn("xmin", ogr.OFTReal)
xmaxDef = ogr.FieldDefn("xmax", ogr.OFTReal)
zminDef = ogr.FieldDefn("zmin", ogr.OFTReal)
zmaxDef = ogr.FieldDefn("zmax", ogr.OFTReal)
outLayer.CreateField(groupDef)
outLayer.CreateField(xminDef)
outLayer.CreateField(xmaxDef)
outLayer.CreateField(zminDef)
outLayer.CreateField(zmaxDef)
featureDefn = outLayer.GetLayerDefn()

groups = {}
for file in glob.glob(f"Banc/MainField/{KIND}/*.yml"):
    name = file.replace(f"Banc/MainField/{KIND}/", "")
    name = name.replace(".bcett.yml", "")
    name = name.replace("_Dynamic", "")
    name = name.replace("_Static", "")
    if not name in groups:
        groups[name] = []
    groups[name].append(file)
for group, files in groups.items():
    thisGeometry = ogr.Geometry(ogr.wkbGeometryCollection)
    for file in files:
        with open(file, "r") as f:
            data = yaml.load(f, Loader=yaml.FullLoader)
        if "Actors" not in data:
            print(file)
            continue
        print(file)
        for item in data["Actors"]:
            point = ogr.Geometry(ogr.wkbPoint)
            point.AddPoint(item["Translate"][0], item["Translate"][2])
            thisGeometry.AddGeometry(point)
    # Convex hull: points to enclosing polygon
    convexHull = thisGeometry.ConvexHull()
    # Buffer the polygon
    convexHull = convexHull.Buffer(25)
    # Creates a new feature
    outFeature = ogr.Feature(featureDefn)
    # Sets the new feature geometry
    outFeature.SetGeometry(convexHull)
    outFeature.SetField("group", group)
    extent = convexHull.GetEnvelope()
    outFeature.SetField("xmin", extent[0])
    outFeature.SetField("xmax", extent[1])
    outFeature.SetField("zmin", extent[2])
    outFeature.SetField("zmax", extent[3])

    # Adds new feature to layer
    outLayer.CreateFeature(outFeature)
