package com.routesearch;

import java.util.*;

/**
 * Merge a set of geohash cells into closed polygon rings.
 * Pure Java boundary-edge tracing — no external dependencies.
 * Ported from geohash_merge_pure.py (fallback path).
 *
 * Each returned ring is a List of [lng, lat] pairs, closed (first == last).
 */
public final class GeohashMerge {

    private static final int COORD_PREC = 8; // decimal places for edge-point keys

    public static List<List<double[]>> geohashesToPolygons(List<String> hashes) {
        Set<String> ghSet = new HashSet<>(hashes);

        // bbox cache: hash -> [minLat, maxLat, minLng, maxLng]
        Map<String, double[]> cells = new HashMap<>();
        for (String h : ghSet) cells.put(h, GeohashUtil.decodeBbox(h));

        List<List<double[]>> rings = new ArrayList<>();
        for (Set<String> comp : connectedComponents(ghSet)) {
            List<double[][]> edges = boundaryEdges(comp, cells);
            rings.addAll(chainRings(edges));
        }
        return rings;
    }

    // ── Connected Components (4-directional DFS) ──────────────────────────────

    private static List<Set<String>> connectedComponents(Set<String> ghSet) {
        Set<String> visited = new HashSet<>();
        List<Set<String>> result = new ArrayList<>();
        String[] dirs = {"top", "bottom", "left", "right"};

        for (String seed : ghSet) {
            if (visited.contains(seed)) continue;
            Set<String> comp = new HashSet<>();
            Deque<String> stack = new ArrayDeque<>();
            stack.push(seed);
            while (!stack.isEmpty()) {
                String curr = stack.pop();
                if (!visited.add(curr)) continue;
                if (!ghSet.contains(curr))  continue;
                comp.add(curr);
                for (String d : dirs) {
                    String nb = GeohashUtil.getAdjacent(curr, d);
                    if (ghSet.contains(nb) && !visited.contains(nb)) stack.push(nb);
                }
            }
            if (!comp.isEmpty()) result.add(comp);
        }
        return result;
    }

    // ── Boundary Edges ────────────────────────────────────────────────────────

    /**
     * Each edge is double[2][2]: {{startLng, startLat}, {endLng, endLat}}.
     * Edges travel counter-clockwise around the outer boundary
     * (south→east, east→north, north→west, west→south winding).
     */
    private static List<double[][]> boundaryEdges(Set<String> comp, Map<String, double[]> cells) {
        List<double[][]> edges = new ArrayList<>();
        for (String code : comp) {
            double[] b  = cells.get(code); // [minLat, maxLat, minLng, maxLng]
            double w = r(b[2]), e = r(b[3]);
            double s = r(b[0]), n = r(b[1]);

            if (!comp.contains(GeohashUtil.getAdjacent(code, "bottom")))
                edges.add(new double[][]{{w,s},{e,s}});
            if (!comp.contains(GeohashUtil.getAdjacent(code, "right")))
                edges.add(new double[][]{{e,s},{e,n}});
            if (!comp.contains(GeohashUtil.getAdjacent(code, "top")))
                edges.add(new double[][]{{e,n},{w,n}});
            if (!comp.contains(GeohashUtil.getAdjacent(code, "left")))
                edges.add(new double[][]{{w,n},{w,s}});
        }
        return edges;
    }

    // ── Chain Rings ───────────────────────────────────────────────────────────

    private static List<List<double[]>> chainRings(List<double[][]> edges) {
        // Point registry: key -> actual double[] point
        Map<String, double[]> ptReg = new HashMap<>();
        for (double[][] e : edges) {
            ptReg.putIfAbsent(key(e[0]), e[0]);
            ptReg.putIfAbsent(key(e[1]), e[1]);
        }

        // Adjacency: start-key -> [edge indices starting here]
        Map<String, List<Integer>> adj = new HashMap<>();
        for (int i = 0; i < edges.size(); i++)
            adj.computeIfAbsent(key(edges.get(i)[0]), k -> new ArrayList<>()).add(i);

        boolean[] used = new boolean[edges.size()];
        List<List<double[]>> rings = new ArrayList<>();

        for (int startEdge = 0; startEdge < edges.size(); startEdge++) {
            if (used[startEdge]) continue;

            String startKey  = key(edges.get(startEdge)[0]);
            String currentKey = key(edges.get(startEdge)[1]);
            used[startEdge] = true;

            List<double[]> ring = new ArrayList<>();
            ring.add(ptReg.get(startKey));

            while (!currentKey.equals(startKey)) {
                boolean moved = false;
                for (int edgeIdx : adj.getOrDefault(currentKey, Collections.emptyList())) {
                    if (!used[edgeIdx]) {
                        used[edgeIdx] = true;
                        ring.add(ptReg.get(currentKey));
                        currentKey = key(edges.get(edgeIdx)[1]);
                        moved = true;
                        break;
                    }
                }
                if (!moved) break;
            }
            ring.add(ptReg.get(startKey)); // close the ring
            if (ring.size() >= 4) rings.add(ring);
        }
        return rings;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Consistent string key for a [lng, lat] point. */
    private static String key(double[] pt) {
        return String.format("%.8f,%.8f", pt[0], pt[1]);
    }

    /** Round to COORD_PREC decimal places for stable edge matching. */
    private static double r(double v) {
        double factor = Math.pow(10, COORD_PREC);
        return Math.round(v * factor) / factor;
    }
}
