import argparse
import json
import math
from pathlib import Path

import shapefile

PROJECT = Path(__file__).resolve().parent
SRC = PROJECT.parent / "实验数据（深大）" / "粤海校区"
OUT = PROJECT / "data"
LAYERS = ["building_area", "detail_area", "road_area", "green_area", "water_area",
          "ann_point", "funct_area", "fct_attach_area", "fct_attach_line", "rd_attach_line"]

# ---------------- GCJ-02 -> WGS84 ----------------
A = 6378245.0
EE = 0.00669342162296594323


def _tlat(x, y):
    r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    r += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    r += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
    r += (160.0 * math.sin(y / 12.0 * math.pi) + 320.0 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
    return r


def _tlng(x, y):
    r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    r += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    r += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
    r += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
    return r


def wgs2gcj(lng, lat):
    dlat = _tlat(lng - 105.0, lat - 35.0)
    dlng = _tlng(lng - 105.0, lat - 35.0)
    rad = lat / 180.0 * math.pi
    magic = 1 - EE * math.sin(rad) ** 2
    sq = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sq) * math.pi)
    dlng = (dlng * 180.0) / (A / sq * math.cos(rad) * math.pi)
    return lng + dlng, lat + dlat


def gcj2wgs(lng, lat):
    wlng, wlat = lng, lat
    for _ in range(5):
        glng, glat = wgs2gcj(wlng, wlat)
        if abs(glng - lng) < 1e-9 and abs(glat - lat) < 1e-9:
            break
        wlng += lng - glng
        wlat += lat - glat
    return wlng, wlat


def fix_coords(coords):
    if isinstance(coords[0], (int, float)):
        lng, lat = gcj2wgs(coords[0], coords[1])
        return [round(lng, 6), round(lat, 6)]
    return [fix_coords(c) for c in coords]


def export_layer(name):
    features = []
    supplements = {}
    if name == "building_area":
        catalog = PROJECT.parent / "ldz-backend" / "app" / "building_name_supplements.json"
        supplements = json.loads(catalog.read_text(encoding="utf-8"))
    with shapefile.Reader(str(SRC / (name + ".shp")), encoding="utf-8") as reader:
        for item in reader.iterShapeRecords():
            geometry = item.shape.__geo_interface__
            geometry["coordinates"] = fix_coords(geometry["coordinates"])
            props = item.record.as_dict()
            match = supplements.get(props.get("Only_ID"))
            if match and not props.get("Name"):
                props.update(Name=match["name"], name_source="ann_point",
                             name_source_id=match["annotation_id"])
            features.append({
                "type": "Feature",
                "properties": props,
                "geometry": geometry,
            })

    target = OUT / (name + ".geojson")
    target.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                 ensure_ascii=False), encoding="utf-8")
    print(name, len(features), "->", target.name)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="导出粤海校区图层；不指定图层名时导出全部。")
    parser.add_argument("layers", nargs="*", metavar="LAYER")
    args = parser.parse_args()
    for name in args.layers:
        if name not in LAYERS:
            parser.error("未知图层：" + name)
    OUT.mkdir(exist_ok=True)
    for name in args.layers or LAYERS:
        export_layer(name)
