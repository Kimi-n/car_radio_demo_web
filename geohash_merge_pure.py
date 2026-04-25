#!/usr/bin/env python3
"""
geohash_merge_pure.py
~~~~~~~~~~~~~~~~~~~~~
与 geohash_merge.py 接口完全相同，但用 geohash_pure 替换 pygeohash。

依赖：geohash_pure（本地）、shapely（可选）
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from typing import Dict, List, Set, Tuple

import geohash_pure as pgh

# ── 类型 ─────────────────────────────────────────────────────────────────────

Coord = Tuple[float, float]
Ring  = List[Coord]
BBox  = Tuple[float, float, float, float]  # (min_lat, max_lat, min_lng, max_lng)


# ── Geohash 辅助 ──────────────────────────────────────────────────────────────

def _decode_bbox(code: str) -> BBox:
    return pgh.decode_bbox(code)


def _get_neighbors(code: str, diagonal: bool) -> List[str]:
    n = pgh.get_adjacent(code, "top")
    s = pgh.get_adjacent(code, "bottom")
    e = pgh.get_adjacent(code, "right")
    w = pgh.get_adjacent(code, "left")
    result = [n, s, e, w]
    if diagonal:
        result += [
            pgh.get_adjacent(n, "right"),
            pgh.get_adjacent(n, "left"),
            pgh.get_adjacent(s, "right"),
            pgh.get_adjacent(s, "left"),
        ]
    return result


# ── 连通分量 ──────────────────────────────────────────────────────────────────

def _connected_components(ghset: Set[str], diagonal: bool) -> List[Set[str]]:
    visited: Set[str] = set()
    components: List[Set[str]] = []

    for code in ghset:
        if code in visited:
            continue
        component: Set[str] = set()
        stack = [code]
        while stack:
            curr = stack.pop()
            if curr in visited:
                continue
            visited.add(curr)
            if curr in ghset:
                component.add(curr)
                for nb in _get_neighbors(curr, diagonal):
                    if nb in ghset and nb not in visited:
                        stack.append(nb)
        if component:
            components.append(component)

    return components


# ── Shapely（主路径）─────────────────────────────────────────────────────────

def _to_polygons_shapely(geohash_list: List[str], diagonal: bool) -> List[Ring]:
    from shapely.geometry import box
    from shapely.ops import unary_union

    ghset = set(geohash_list)
    cells: Dict[str, BBox] = {c: _decode_bbox(c) for c in ghset}
    components = _connected_components(ghset, diagonal)

    rings: List[Ring] = []
    for component in components:
        boxes = [
            box(cells[c][2], cells[c][0], cells[c][3], cells[c][1])
            for c in component
        ]
        merged = unary_union(boxes)
        if merged.geom_type == "Polygon":
            rings.append(list(merged.exterior.coords))
        elif merged.geom_type == "MultiPolygon":
            for poly in merged.geoms:
                rings.append(list(poly.exterior.coords))

    return rings


# ── 纯 Python 边界追踪（fallback）────────────────────────────────────────────

_PREC = 8


def _boundary_edges(
    component: Set[str], cells: Dict[str, BBox]
) -> List[Tuple[Coord, Coord]]:
    edges: List[Tuple[Coord, Coord]] = []
    nb_cache: Dict[str, Dict[str, str]] = {}

    def nb(code: str) -> Dict[str, str]:
        if code not in nb_cache:
            nb_cache[code] = {
                "n": pgh.get_adjacent(code, "top"),
                "s": pgh.get_adjacent(code, "bottom"),
                "e": pgh.get_adjacent(code, "right"),
                "w": pgh.get_adjacent(code, "left"),
            }
        return nb_cache[code]

    r = lambda x: round(x, _PREC)

    for code in component:
        min_lat, max_lat, min_lng, max_lng = cells[code]
        w, e, s, n = r(min_lng), r(max_lng), r(min_lat), r(max_lat)
        nbs = nb(code)

        if nbs["s"] not in component:
            edges.append(((w, s), (e, s)))
        if nbs["e"] not in component:
            edges.append(((e, s), (e, n)))
        if nbs["n"] not in component:
            edges.append(((e, n), (w, n)))
        if nbs["w"] not in component:
            edges.append(((w, n), (w, s)))

    return edges


def _chain_rings(edges: List[Tuple[Coord, Coord]]) -> List[Ring]:
    adj: Dict[Coord, List[Tuple[Coord, int]]] = defaultdict(list)
    for i, (a, b) in enumerate(edges):
        adj[a].append((b, i))

    used = [False] * len(edges)
    rings: List[Ring] = []

    for start_i, (start, first_end) in enumerate(edges):
        if used[start_i]:
            continue
        ring: Ring = [start]
        used[start_i] = True
        current = first_end

        while current != start:
            moved = False
            for nxt, idx in adj[current]:
                if not used[idx]:
                    used[idx] = True
                    ring.append(current)
                    current = nxt
                    moved = True
                    break
            if not moved:
                break

        ring.append(start)
        if len(ring) >= 4:
            rings.append(ring)

    return rings


def _to_polygons_manual(geohash_list: List[str], diagonal: bool) -> List[Ring]:
    ghset = set(geohash_list)
    cells: Dict[str, BBox] = {c: _decode_bbox(c) for c in ghset}
    components = _connected_components(ghset, diagonal)

    rings: List[Ring] = []
    for component in components:
        edges = _boundary_edges(component, cells)
        rings.extend(_chain_rings(edges))

    return rings


# ── 公开 API ──────────────────────────────────────────────────────────────────

def geohashes_to_polygons(
    geohash_list: List[str],
    diagonal_adjacency: bool = False,
) -> List[Ring]:
    if not geohash_list:
        return []
    try:
        from shapely.geometry import box  # noqa: F401
        return _to_polygons_shapely(list(geohash_list), diagonal_adjacency)
    except ImportError:
        return _to_polygons_manual(list(geohash_list), diagonal_adjacency)


def to_geojson(rings: List[Ring]) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[lng, lat] for lng, lat in ring]],
                },
                "properties": {},
            }
            for ring in rings
        ],
    }


# ── CLI ───────────────────────────────────────────────────────────────────────

def _build_demo() -> List[str]:
    c  = pgh.encode(31.2304, 121.4737, 5)
    n  = pgh.get_adjacent(c, "top")
    s  = pgh.get_adjacent(c, "bottom")
    e  = pgh.get_adjacent(c, "right")
    w  = pgh.get_adjacent(c, "left")
    ne = pgh.get_adjacent(n, "right")
    nw = pgh.get_adjacent(n, "left")
    se = pgh.get_adjacent(s, "right")
    cluster_a = [c, n, s, e, w, ne, nw, se]
    cluster_b = [pgh.encode(39.9042, 116.4074, 5)]
    return cluster_a + cluster_b


def main() -> None:
    args = sys.argv[1:]
    geojson_out = "--geojson" in args
    diagonal    = "--diagonal" in args
    geohashes   = [a for a in args if not a.startswith("--")]

    if not geohashes:
        geohashes = _build_demo()
        print(f"[demo] {len(geohashes)} geohashes across 2 clusters\n")

    rings = geohashes_to_polygons(geohashes, diagonal_adjacency=diagonal)

    if geojson_out:
        print(json.dumps(to_geojson(rings), indent=2))
        return

    print(f"{len(rings)} polygon(s):\n")
    for i, ring in enumerate(rings, 1):
        print(f"  Polygon {i}  ({len(ring) - 1} vertices)")
        for lng, lat in ring:
            print(f"    lat={lat:.6f}  lng={lng:.6f}")
        print()


if __name__ == "__main__":
    main()
