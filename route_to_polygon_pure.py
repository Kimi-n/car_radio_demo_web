#!/usr/bin/env python3
"""
route_to_polygon_pure.py
~~~~~~~~~~~~~~~~~~~~~~~~
与 route_to_polygon.py 等价，零 pygeohash 依赖。

流程：
  data.json → 提取 polyline → 坐标列表 → geohash 列表
    → geohash_merge_pure.geohashes_to_polygons() → GeoJSON
"""

import json
import re
from typing import List, Tuple

import geohash_pure as gh
from geohash_merge_pure import geohashes_to_polygons, to_geojson

PRECISION = 6
DATA_FILE = "D:/Projects/websocket_test/data3.json"
OUT_FILE  = "D:/Projects/websocket_test/route_polygon3_pure.geojson"

Coord = Tuple[float, float]


def load_json(path: str) -> dict:
    with open(path, encoding="utf-8-sig") as f:
        raw = f.read()
    return json.loads(re.sub(r",\s*([}\]])", r"\1", raw))


def extract_coords(data: dict) -> List[Coord]:
    coords: List[Coord] = []
    for path in data["route"]["paths"]:
        for step in path["steps"]:
            for pair in step["polyline"].split(";"):
                pair = pair.strip()
                if not pair:
                    continue
                lng_s, lat_s = pair.split(",")
                coords.append((float(lng_s), float(lat_s)))
    return coords


def coords_to_geohashes(coords: List[Coord], precision: int) -> List[str]:
    seen: set[str] = set()
    result: List[str] = []
    for lng, lat in coords:
        code = gh.encode(lat, lng, precision)
        if code not in seen:
            seen.add(code)
            result.append(code)
    return result


def expand_with_neighbors(geohashes: List[str], rings: int = 1) -> List[str]:
    """每个格子向八个方向扩充 rings 圈，返回去重后的完整列表。"""
    expanded: set[str] = set(geohashes)
    for _ in range(rings):
        frontier = list(expanded)
        for code in frontier:
            n = gh.get_adjacent(code, "top")
            s = gh.get_adjacent(code, "bottom")
            e = gh.get_adjacent(code, "right")
            w = gh.get_adjacent(code, "left")
            expanded.update([
                n, s, e, w,
                gh.get_adjacent(n, "right"),
                gh.get_adjacent(n, "left"),
                gh.get_adjacent(s, "right"),
                gh.get_adjacent(s, "left"),
            ])
    return list(expanded)


def main() -> None:
    data = load_json(DATA_FILE)
    paths = data["route"]["paths"]
    print(f"路径数: {len(paths)}  |  总 step 数: {sum(len(p['steps']) for p in paths)}")

    coords = extract_coords(data)
    print(f"原始坐标点数: {len(coords)}")

    geohashes = coords_to_geohashes(coords, PRECISION)
    print(f"路线 geohash 数 (precision={PRECISION}): {len(geohashes)}")

    geohashes = expand_with_neighbors(geohashes, rings=2)
    print(f"扩充八邻后 geohash 数: {len(geohashes)}")

    rings = geohashes_to_polygons(geohashes)
    print(f"合并后多边形数: {len(rings)}")
    for i, ring in enumerate(rings, 1):
        print(f"  Polygon {i:2d}: {len(ring) - 1:4d} 个顶点")

    route_feature = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[lng, lat] for lng, lat in coords]},
        "properties": {"name": "原始路径"},
    }
    fc = to_geojson(rings)
    for i, f in enumerate(fc["features"]):
        f["properties"]["name"] = f"合并多边形 {i + 1}"
    fc["features"].insert(0, route_feature)

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, indent=2)
    print(f"\nGeoJSON 已写入: {OUT_FILE}")


if __name__ == "__main__":
    main()
