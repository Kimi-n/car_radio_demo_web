package com.routesearch;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Gaode (Amap) Web API wrapper — v5.
 * Thread-safe QPS rate limiting via synchronized block.
 * Requires: fastjson2, java.net.http (Java 11+).
 */
public final class AMapClient {

    private static final String BASE = "https://restapi.amap.com/v5";

    private final String     key;
    private final long       minIntervalMs;
    private       long       lastMs = 0;
    private final Object     lock   = new Object();
    private final HttpClient http;

    public AMapClient(String apiKey, double qps) {
        this.key           = apiKey;
        this.minIntervalMs = (long)(1000.0 / qps);
        this.http          = HttpClient.newBuilder()
                                .connectTimeout(Duration.ofSeconds(10))
                                .build();
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private JSONObject get(String path, Map<String, String> params) {
        synchronized (lock) {
            long now  = System.currentTimeMillis();
            long wait = minIntervalMs - (now - lastMs);
            if (wait > 0) {
                try { Thread.sleep(wait); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            }
            lastMs = System.currentTimeMillis();
        }

        String query = params.entrySet().stream()
            .map(e -> enc(e.getKey()) + "=" + enc(e.getValue()))
            .collect(Collectors.joining("&"))
            + "&key=" + enc(key);

        URI uri = URI.create(BASE + path + "?" + query);
        HttpRequest req = HttpRequest.newBuilder()
            .uri(uri)
            .timeout(Duration.ofSeconds(10))
            .GET()
            .build();

        try {
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            JSONObject data = JSON.parseObject(resp.body());
            if (!"1".equals(data.getString("status"))) {
                throw new AMapException(data.getString("info")
                    + " (infocode=" + data.getString("infocode") + ")");
            }
            return data;
        } catch (IOException | InterruptedException e) {
            throw new AMapException("HTTP error: " + e.getMessage(), e);
        }
    }

    private List<JSONObject> paginate(String path, Map<String, String> baseParams, int maxRecords) {
        List<JSONObject> pois = new ArrayList<>();
        int page = 1;
        while (pois.size() < maxRecords) {
            Map<String, String> params = new LinkedHashMap<>(baseParams);
            params.put("page_num",  String.valueOf(page));
            params.put("page_size", "25");
            JSONArray batch = get(path, params).getJSONArray("pois");
            if (batch == null || batch.isEmpty()) break;
            pois.addAll(batch.toList(JSONObject.class));
            if (batch.size() < 25) break;
            page++;
        }
        return pois.subList(0, Math.min(pois.size(), maxRecords));
    }

    // ── Public API ────────────────────────────────────────────────────────────

    public JSONObject drivingRoute(String origin, String destination, String waypoints) {
        Map<String, String> p = new LinkedHashMap<>();
        p.put("origin",      origin);
        p.put("destination", destination);
        p.put("strategy",    "32");
        p.put("show_fields", "cost,polyline");
        if (waypoints != null && !waypoints.isEmpty()) p.put("waypoints", waypoints);
        return get("/direction/driving", p);
    }

    public List<JSONObject> searchPolygon(String polygon, String keywords,
                                           String types, int maxRecords) {
        Map<String, String> p = new LinkedHashMap<>();
        p.put("polygon",     polygon);
        p.put("keywords",    keywords);
        p.put("types",       types == null ? "" : types);
        p.put("show_fields", "business");
        return paginate("/place/polygon", p, maxRecords);
    }

    private static String enc(String v) {
        return URLEncoder.encode(v == null ? "" : v, StandardCharsets.UTF_8);
    }

    public static final class AMapException extends RuntimeException {
        public AMapException(String msg)                  { super(msg); }
        public AMapException(String msg, Throwable cause) { super(msg, cause); }
    }
}
