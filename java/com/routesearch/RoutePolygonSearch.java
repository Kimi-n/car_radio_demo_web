package com.routesearch;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import java.util.*;
import java.util.concurrent.*;
import java.util.stream.Collectors;

/**
 * Along-route POI search via geohash buffer polygons.
 *
 * Pipeline:
 *   route steps → segment by distance → per-segment:
 *     coords → geohash → expand neighbors → merge polygon → D-P simplify
 *     → concurrent polygon-search API → deduplicate → slot-based ranking
 */
public final class RoutePolygonSearch {

    // ── Constants ─────────────────────────────────────────────────────────────

    private static final double DP_EPS_M   = 800;
    private static final int    MAX_VERTS  = 80;
    private static final double MAX_SEG_KM = 25;
    private static final int    MIN_SEGS   = 4;
    private static final double LEFT_CITY_FACTOR = 1.5;

    private static final Set<String> HIGHWAY_KW = new HashSet<>(Arrays.asList(
        "高速", "快速路", "高架", "匝道", "立交", "环城高速"
    ));

    // category → {cityPrec, cityRings, longPrec, longRings}
    private static final Map<String, int[]> CAT_CFG = new LinkedHashMap<>();
    // category → {cityMaxDist(m), longMaxDist(m)}
    private static final Map<String, int[]> CAT_DIST = new LinkedHashMap<>();

    static {
        CAT_CFG.put("咖啡",     new int[]{7, 2, 6, 1});
        CAT_CFG.put("便利店",   new int[]{7, 2, 6, 1});
        CAT_CFG.put("餐厅",     new int[]{7, 3, 6, 1});
        CAT_CFG.put("加油站",   new int[]{6, 1, 6, 2});
        CAT_CFG.put("充电",     new int[]{6, 1, 6, 2});
        CAT_CFG.put("酒店",     new int[]{6, 2, 6, 2});
        CAT_CFG.put("停车",     new int[]{7, 2, 6, 1});
        CAT_CFG.put("_default", new int[]{7, 2, 6, 2});

        CAT_DIST.put("咖啡",     new int[]{ 500,  800});
        CAT_DIST.put("便利店",   new int[]{ 500,  800});
        CAT_DIST.put("餐厅",     new int[]{ 800, 1000});
        CAT_DIST.put("加油站",   new int[]{1500, 2000});
        CAT_DIST.put("充电",     new int[]{1500, 2000});
        CAT_DIST.put("酒店",     new int[]{1000, 1500});
        CAT_DIST.put("停车",     new int[]{ 500,  800});
        CAT_DIST.put("_default", new int[]{ 800, 1500});
    }

    // ── Public entry points ───────────────────────────────────────────────────

    public static List<Poi> searchFromCoords(String origin, String destination,
                                              String keywords, AMapClient client,
                                              String types, int topN, String waypoints) {
        JSONObject routeData = client.drivingRoute(origin, destination, waypoints);
        return searchAlongRoute(routeData, keywords, types, client, topN);
    }

    public static List<Poi> searchFromCoords(String origin, String destination,
                                              String keywords, AMapClient client, int topN) {
        return searchFromCoords(origin, destination, keywords, client, "", topN, null);
    }

    public static List<Poi> searchAlongRoute(JSONObject data, String keywords,
                                              String types, AMapClient client, int topN) {
        JSONObject path0  = data.getJSONObject("route").getJSONArray("paths").getJSONObject(0);
        List<JSONObject> steps = path0.getJSONArray("steps").toList(JSONObject.class);
        double totalKm    = path0.getDoubleValue("distance") / 1000.0;

        boolean isCity  = totalKm < 30;
        int[]   catCfg  = catConfig(keywords, isCity);
        int     prec    = catCfg[0], rings = catCfg[1];
        int     maxDist = maxDist(keywords, isCity);
        double  adaptKm = Math.max(1.0, Math.min(MAX_SEG_KM, totalKm / MIN_SEGS));

        List<List<TaggedCoord>> segments = splitSteps(steps, adaptKm);
        int nSegs = segments.size();
        System.out.printf("路线 %.0f km → %d 段（每段 ≤ %.1f km，精度=%d，扩 %d 圈）%n",
                           totalKm, nSegs, adaptKm, prec, rings);

        // ── Slot planning ─────────────────────────────────────────────────────
        int endSlots  = Math.min(2, topN / 4);
        int midSlots  = Math.max(1, topN - 2 * endSlots);
        int headEnd   = Math.min(endSlots, nSegs);
        int tailStart = Math.max(headEnd, nSegs - endSlots);

        // dedup-preserving order via LinkedHashSet
        Set<Integer> qIdxSet = new LinkedHashSet<>();
        qIdxSet.addAll(pickIndices(0,         headEnd,   endSlots));
        qIdxSet.addAll(pickIndices(headEnd,   tailStart, midSlots));
        qIdxSet.addAll(pickIndices(tailStart, nSegs,     endSlots));
        List<Integer> qIdx = new ArrayList<>(qIdxSet);

        System.out.printf("流水线：%d 段 → 首尾各%d槽 + 中间%d槽，共查 %d 次%n",
                           nSegs, endSlots, midSlots, qIdx.size());

        // ── Concurrent fetch ──────────────────────────────────────────────────
        final int    fPrec  = prec,  fRings = rings;
        final String fKw    = keywords, fTypes = types == null ? "" : types;

        ExecutorService pool = Executors.newFixedThreadPool(Math.min(20, qIdx.size()));
        List<Future<SegResult>> futures = new ArrayList<>();
        for (int si : qIdx) {
            final int idx = si;
            futures.add(pool.submit(() ->
                genAndFetch(idx, segments.get(idx), fKw, fTypes, fPrec, fRings, client)));
        }
        pool.shutdown();

        Map<Integer, List<RawPoi>> rawBySeg = new HashMap<>();
        for (Future<SegResult> f : futures) {
            try {
                SegResult r = f.get();
                rawBySeg.put(r.segIdx, r.pois);
            } catch (InterruptedException | ExecutionException e) {
                throw new RuntimeException("Fetch failed: " + e.getMessage(), e);
            }
        }

        // ── Dedup + distance filter → poisBySeg ───────────────────────────────
        Set<String> seenIds = new HashSet<>();
        Map<Integer, List<Poi>> poisBySeg = new HashMap<>();
        for (int i = 0; i < nSegs; i++) poisBySeg.put(i, new ArrayList<>());

        for (int si : qIdx) {
            for (RawPoi raw : rawBySeg.getOrDefault(si, Collections.emptyList())) {
                String pid = raw.node.getString("id");
                if (pid == null || pid.isEmpty() || seenIds.contains(pid)) continue;
                if (raw.distM > maxDist) continue;
                seenIds.add(pid);
                String loc = raw.node.getString("location");
                if (loc == null || loc.isEmpty()) continue;

                String[]   lp  = loc.split(",");
                double     lng = Double.parseDouble(lp[0]), lat = Double.parseDouble(lp[1]);
                JSONObject biz = raw.node.getJSONObject("business");

                poisBySeg.get(si).add(new Poi(
                    pid,
                    s(raw.node.getString("name")),
                    lng, lat,
                    s(raw.node.getString("address")),
                    biz != null ? s(biz.getString("rating"))       : "",
                    biz != null ? s(biz.getString("tel"))          : "",
                    biz != null ? s(biz.getString("cost"))         : "",
                    biz != null ? s(biz.getString("opentime_today")): "",
                    biz != null ? s(biz.getString("business_area")): "",
                    si, raw.distM, raw.isLeft, raw.isHighway
                ));
            }
        }

        int total = poisBySeg.values().stream().mapToInt(List::size).sum();
        System.out.println("唯一 POI 总数（距离过滤后）: " + total);

        // ── Slot picking ──────────────────────────────────────────────────────
        List<Integer> headList = qIdx.subList(0, Math.min(endSlots, qIdx.size()));
        List<Integer> tailList = qIdx.subList(Math.max(0, qIdx.size() - endSlots), qIdx.size());
        Set<Integer> headSet = new HashSet<>(headList);
        Set<Integer> tailSet = new HashSet<>(tailList);

        List<Poi>    result  = new ArrayList<>();
        Set<String>  usedIds = new HashSet<>();

        for (int si : qIdx) {
            int quota = (headSet.contains(si) || tailSet.contains(si)) ? 2 : 1;
            result.addAll(pickSlot(si, quota, poisBySeg, usedIds, qIdx));
        }

        result.sort(Comparator.comparingInt(p -> p.segment));
        return result;
    }

    // ── Concurrent worker ─────────────────────────────────────────────────────

    private static SegResult genAndFetch(int segIdx, List<TaggedCoord> tagged,
                                          String keywords, String types,
                                          int prec, int rings, AMapClient client) {
        List<Coord> plain = tagged.stream().map(TaggedCoord::toCoord).collect(Collectors.toList());
        String polyStr = segmentToPolygonStr(plain, rings, prec, DP_EPS_M, MAX_VERTS);
        if (polyStr == null) return new SegResult(segIdx, Collections.emptyList());

        System.out.printf("  段 %2d: %4d 坐标点 → %3d 顶点%n",
                           segIdx + 1, tagged.size(), polyStr.split(";").length);

        List<JSONObject> raw = client.searchPolygon(polyStr, keywords, types, 50);
        List<RawPoi> result = new ArrayList<>();
        for (JSONObject node : raw) {
            String loc = node.getString("location");
            if (loc == null || loc.isEmpty()) {
                result.add(new RawPoi(node, Double.MAX_VALUE, false, false));
                continue;
            }
            String[] lp  = loc.split(",");
            double[] side = poiSideInfo(Double.parseDouble(lp[0]), Double.parseDouble(lp[1]), tagged);
            result.add(new RawPoi(node, side[0], side[1] > 0, side[2] > 0));
        }
        return new SegResult(segIdx, result);
    }

    // ── Slot picking ──────────────────────────────────────────────────────────

    private static List<Poi> pickSlot(int segIdx, int quota,
                                       Map<Integer, List<Poi>> poisBySeg,
                                       Set<String> usedIds, List<Integer> qIdx) {
        List<Poi> all  = poisBySeg.getOrDefault(segIdx, Collections.emptyList())
                             .stream().filter(p -> !usedIds.contains(p.id))
                             .collect(Collectors.toList());
        List<Poi> pref = all.stream().filter(p -> !isHwOpp(p)).collect(Collectors.toList());
        List<Poi> pool = pref.isEmpty() ? all : pref;

        if (pool.isEmpty()) {
            int pos = qIdx.indexOf(segIdx);
            for (int delta : new int[]{1, -1, 2, -2}) {
                int adj = pos + delta;
                if (adj < 0 || adj >= qIdx.size()) continue;
                List<Poi> adjAll  = poisBySeg.getOrDefault(qIdx.get(adj), Collections.emptyList())
                                        .stream().filter(p -> !usedIds.contains(p.id))
                                        .collect(Collectors.toList());
                List<Poi> adjPref = adjAll.stream().filter(p -> !isHwOpp(p)).collect(Collectors.toList());
                pool = adjPref.isEmpty() ? adjAll : adjPref;
                if (!pool.isEmpty()) break;
            }
        }

        pool.sort(Comparator
            .comparingDouble((Poi p) -> p.isLeft && !p.isHighway ? p.distM * LEFT_CITY_FACTOR : p.distM)
            .thenComparingDouble(p -> { try { return -Double.parseDouble(p.rating); } catch (Exception e) { return 0.0; } })
        );

        List<Poi> chosen = new ArrayList<>(pool.subList(0, Math.min(quota, pool.size())));
        chosen.forEach(p -> usedIds.add(p.id));
        return chosen;
    }

    private static boolean isHwOpp(Poi p) { return p.isLeft && p.isHighway; }

    // ── Geometry: side detection ──────────────────────────────────────────────

    /** @return [distM, isLeft(1/0), isHighway(1/0)] */
    private static double[] poiSideInfo(double lng, double lat, List<TaggedCoord> tagged) {
        double bestD = Double.MAX_VALUE; int bestI = 0;
        for (int i = 0; i < tagged.size(); i++) {
            double d = haversine(lng, lat, tagged.get(i).lng, tagged.get(i).lat);
            if (d < bestD) { bestD = d; bestI = i; }
        }
        int n = tagged.size();
        double aLng, aLat, bLng, bLat;
        if (bestI < n - 1) {
            aLng = tagged.get(bestI).lng;   aLat = tagged.get(bestI).lat;
            bLng = tagged.get(bestI+1).lng; bLat = tagged.get(bestI+1).lat;
        } else {
            aLng = tagged.get(bestI-1).lng; aLat = tagged.get(bestI-1).lat;
            bLng = tagged.get(bestI).lng;   bLat = tagged.get(bestI).lat;
        }
        double cross = (bLng-aLng)*(lat-aLat) - (bLat-aLat)*(lng-aLng);
        return new double[]{ bestD, cross > 0 ? 1:0, tagged.get(bestI).isHighway ? 1:0 };
    }

    // ── Geometry: D-P polygon simplification ─────────────────────────────────

    private static double perpDistM(Coord p, Coord a, Coord b) {
        double cosLat = Math.cos(Math.toRadians((a.lat + b.lat) / 2));
        double sx = 111_320 * cosLat, sy = 111_320;
        double ax=a.lng*sx, ay=a.lat*sy, bx=b.lng*sx, by=b.lat*sy, px=p.lng*sx, py=p.lat*sy;
        double abx=bx-ax, aby=by-ay, ab2=abx*abx+aby*aby;
        if (ab2 == 0) return Math.hypot(px-ax, py-ay);
        double t = Math.max(0, Math.min(1, ((px-ax)*abx+(py-ay)*aby)/ab2));
        return Math.hypot(px-(ax+t*abx), py-(ay+t*aby));
    }

    private static List<Coord> dpOpen(List<Coord> pts, double eps) {
        if (pts.size() <= 2) return pts;
        double maxD = 0; int maxI = 0;
        Coord first = pts.get(0), last = pts.get(pts.size()-1);
        for (int i = 1; i < pts.size()-1; i++) {
            double d = perpDistM(pts.get(i), first, last);
            if (d > maxD) { maxD = d; maxI = i; }
        }
        if (maxD > eps) {
            List<Coord> L = dpOpen(pts.subList(0, maxI+1), eps);
            List<Coord> R = dpOpen(pts.subList(maxI, pts.size()), eps);
            List<Coord> out = new ArrayList<>(L.subList(0, L.size()-1));
            out.addAll(R);
            return out;
        }
        return Arrays.asList(first, last);
    }

    private static List<Coord> simplifyRing(List<Coord> ring, double eps) {
        if (ring.size() < 5) return ring;
        List<Coord> open = ring.subList(0, ring.size()-1);
        int n = open.size(), split = 1; double maxD = 0;
        for (int i = 1; i < n-1; i++) {
            double d = haversine(open.get(0).lng, open.get(0).lat, open.get(i).lng, open.get(i).lat);
            if (d > maxD) { maxD = d; split = i; }
        }
        List<Coord> s1 = new ArrayList<>(open.subList(0, split+1));
        List<Coord> s2 = new ArrayList<>(open.subList(split, n));
        s2.add(open.get(0));
        List<Coord> h1 = dpOpen(s1, eps), h2 = dpOpen(s2, eps);
        List<Coord> res = new ArrayList<>(h1.subList(0, h1.size()-1));
        res.addAll(h2);
        if (!res.get(0).equals(res.get(res.size()-1))) res.add(res.get(0));
        return res;
    }

    private static List<Coord> simplifyToLimit(List<Coord> ring, double eps, int maxVerts) {
        List<Coord> s = simplifyRing(ring, eps);
        while (s.size() > maxVerts + 1 && eps < 5_000) { eps *= 1.5; s = simplifyRing(ring, eps); }
        return s;
    }

    // ── Polygon generation ────────────────────────────────────────────────────

    private static List<String> expandGeohashes(List<String> codes, int rings) {
        Set<String> exp = new HashSet<>(codes);
        for (int r = 0; r < rings; r++) {
            List<String> front = new ArrayList<>(exp);
            for (String c : front) {
                String n=GeohashUtil.getAdjacent(c,"top"), s=GeohashUtil.getAdjacent(c,"bottom");
                String e=GeohashUtil.getAdjacent(c,"right"), w=GeohashUtil.getAdjacent(c,"left");
                exp.addAll(Arrays.asList(n,s,e,w,
                    GeohashUtil.getAdjacent(n,"right"), GeohashUtil.getAdjacent(n,"left"),
                    GeohashUtil.getAdjacent(s,"right"), GeohashUtil.getAdjacent(s,"left")));
            }
        }
        return new ArrayList<>(exp);
    }

    private static String segmentToPolygonStr(List<Coord> coords, int expRings,
                                               int precision, double eps, int maxVerts) {
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        for (Coord c : coords) seen.add(GeohashUtil.encode(c.lat, c.lng, precision));
        if (seen.isEmpty()) return null;

        List<List<double[]>> rings = GeohashMerge.geohashesToPolygons(
            expandGeohashes(new ArrayList<>(seen), expRings));
        if (rings.isEmpty()) return null;

        List<double[]> ring = rings.stream().max(Comparator.comparingInt(List::size)).orElse(null);
        if (ring == null) return null;

        List<Coord> coordRing = ring.stream().map(p -> new Coord(p[0], p[1])).collect(Collectors.toList());
        List<Coord> simplified = simplifyToLimit(coordRing, eps, maxVerts);
        List<Coord> verts = simplified.subList(0, simplified.size()-1);
        return verts.stream().map(c -> c.lng + "," + c.lat).collect(Collectors.joining(";"));
    }

    // ── Route segmentation ────────────────────────────────────────────────────

    private static List<Coord> parsePolyline(String s) {
        List<Coord> out = new ArrayList<>();
        for (String pair : s.split(";")) {
            String[] p = pair.trim().split(",");
            if (p.length == 2) out.add(new Coord(Double.parseDouble(p[0]), Double.parseDouble(p[1])));
        }
        return out;
    }

    private static boolean stepIsHighway(JSONObject step) {
        String road = step.getString("road_name");
        if (road == null) road = step.getString("road");
        if (road == null) road = "";
        String inst = s(step.getString("instruction"));
        for (String kw : HIGHWAY_KW) {
            if (road.contains(kw) || inst.contains(kw)) return true;
        }
        return false;
    }

    private static List<List<TaggedCoord>> splitSteps(List<JSONObject> steps, double maxKm) {
        List<List<TaggedCoord>> segments = new ArrayList<>();
        List<TaggedCoord> cur = new ArrayList<>();
        double curKm = 0;

        for (JSONObject step : steps) {
            boolean isHw = stepIsHighway(step);
            String polyline = step.getString("polyline");
            if (polyline == null || polyline.isEmpty()) continue;
            List<Coord> coords = parsePolyline(polyline);
            int i = 0;
            while (i < coords.size()) {
                if (cur.isEmpty()) { Coord c = coords.get(i++); cur.add(new TaggedCoord(c.lng, c.lat, isHw)); continue; }
                Coord ci = coords.get(i);
                TaggedCoord last = cur.get(cur.size()-1);
                double segKm = haversine(last.lng, last.lat, ci.lng, ci.lat) / 1000.0;
                if (curKm + segKm >= maxKm) {
                    segments.add(cur);
                    cur = new ArrayList<>();
                    cur.add(new TaggedCoord(last.lng, last.lat, last.isHighway));
                    curKm = 0;
                } else {
                    cur.add(new TaggedCoord(ci.lng, ci.lat, isHw));
                    curKm += segKm;
                    i++;
                }
            }
        }
        if (cur.size() > 1) segments.add(cur);
        return segments;
    }

    // ── Category config ───────────────────────────────────────────────────────

    private static int[] catConfig(String kw, boolean isCity) {
        for (Map.Entry<String, int[]> e : CAT_CFG.entrySet()) {
            if (!"_default".equals(e.getKey()) && kw.contains(e.getKey())) {
                int[] v = e.getValue(); return isCity ? new int[]{v[0],v[1]} : new int[]{v[2],v[3]};
            }
        }
        int[] v = CAT_CFG.get("_default"); return isCity ? new int[]{v[0],v[1]} : new int[]{v[2],v[3]};
    }

    private static int maxDist(String kw, boolean isCity) {
        for (Map.Entry<String, int[]> e : CAT_DIST.entrySet()) {
            if (!"_default".equals(e.getKey()) && kw.contains(e.getKey()))
                return isCity ? e.getValue()[0] : e.getValue()[1];
        }
        int[] v = CAT_DIST.get("_default"); return isCity ? v[0] : v[1];
    }

    private static List<Integer> pickIndices(int lo, int hi, int n) {
        int count = Math.min(n, hi - lo);
        if (count <= 0) return Collections.emptyList();
        double step = (double)(hi - lo) / count;
        List<Integer> res = new ArrayList<>();
        for (int i = 0; i < count; i++) res.add(Math.min(lo + (int)((i+0.5)*step), hi-1));
        return res;
    }

    // ── Haversine ─────────────────────────────────────────────────────────────

    static double haversine(double lng1, double lat1, double lng2, double lat2) {
        final double R = 6_371_000;
        double dLat = Math.toRadians(lat2-lat1), dLng = Math.toRadians(lng2-lng1);
        double a = Math.sin(dLat/2)*Math.sin(dLat/2)
                 + Math.cos(Math.toRadians(lat1))*Math.cos(Math.toRadians(lat2))
                   *Math.sin(dLng/2)*Math.sin(dLng/2);
        return 2*R*Math.asin(Math.sqrt(a));
    }

    // ── Inner types ───────────────────────────────────────────────────────────

    private static final class RawPoi {
        final JSONObject node;
        final double distM; final boolean isLeft, isHighway;
        RawPoi(JSONObject n, double d, boolean l, boolean h) { node=n; distM=d; isLeft=l; isHighway=h; }
    }

    private static final class SegResult {
        final int segIdx; final List<RawPoi> pois;
        SegResult(int i, List<RawPoi> p) { segIdx=i; pois=p; }
    }

    /** Null-safe string helper. */
    private static String s(String v) { return v != null ? v : ""; }

    // ── Quick smoke test ──────────────────────────────────────────────────────

    public static void main(String[] args) {
        String API_KEY = "041bfa0eccad14099f72d3258d3b0a27";
        AMapClient client = new AMapClient(API_KEY, 20);

        String[][] cases = {
            {"118.770156,31.979099", "118.797845,32.071332", "咖啡",   "8"},
            {"118.770156,31.979099", "115.407380,36.468700", "加油站", "16"},
        };
        String[] labels = {"城市场景：软件大道→玄武湖", "长途场景：南京→邯郸"};

        for (int t = 0; t < cases.length; t++) {
            String[] c = cases[t];
            long ts = System.currentTimeMillis();
            List<Poi> pois = searchFromCoords(c[0], c[1], c[2], client, Integer.parseInt(c[3]));
            double elapsed = (System.currentTimeMillis() - ts) / 1000.0;

            System.out.printf("%n=== %s  搜%s  耗时%.2fs ===%n", labels[t], c[2], elapsed);
            for (int i = 0; i < pois.size(); i++) {
                Poi p = pois.get(i);
                System.out.printf("%2d. [段%d] %s%n", i+1, p.segment+1, p.name);
                System.out.printf("    地址：%s%n", p.address);
                System.out.printf("    评分：%s  离路线：%.0fm  [%s/%s]%n",
                    p.rating.isEmpty()?"暂无":p.rating, p.distM,
                    p.isHighway?"高速":"普通路", p.isLeft?"逆向":"同向");
            }
        }
    }
}
