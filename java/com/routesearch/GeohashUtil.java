package com.routesearch;

import java.util.Arrays;

/**
 * Zero-dependency geohash: encode, decodeBbox, getAdjacent.
 * Ported from geohash_pure.py.
 */
public final class GeohashUtil {

    public static final String BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    private static final int[] BASE32_MAP = new int[128];

    static {
        Arrays.fill(BASE32_MAP, -1);
        for (int i = 0; i < BASE32.length(); i++)
            BASE32_MAP[BASE32.charAt(i)] = i;
    }

    // [direction][parity(0=even,1=odd)] lookup strings
    // directions: 0=right, 1=left, 2=top, 3=bottom
    private static final String[][] NEIGHBOR = {
        {"bc01fg45238967deuvhjyznpkmstqrwx", "p0r21436x8zb9dcf5h7kjnmqesgutwvy"}, // right
        {"238967debc01fg45kmstqrwxuvhjyznp", "14365h7k9dcfesgujnmqp0r2twvyx8zb"}, // left
        {"p0r21436x8zb9dcf5h7kjnmqesgutwvy", "bc01fg45238967deuvhjyznpkmstqrwx"}, // top
        {"14365h7k9dcfesgujnmqp0r2twvyx8zb", "238967debc01fg45kmstqrwxuvhjyznp"}, // bottom
    };

    private static final String[][] BORDER = {
        {"bcfguvyz", "prxz"},   // right
        {"0145hjnp", "028b"},   // left
        {"prxz",     "bcfguvyz"}, // top
        {"028b",     "0145hjnp"}, // bottom
    };

    private static int dirIdx(String dir) {
        switch (dir) {
            case "right":  return 0;
            case "left":   return 1;
            case "top":    return 2;
            case "bottom": return 3;
            default: throw new IllegalArgumentException("Unknown direction: " + dir);
        }
    }

    /** Encode (lat, lng) to geohash string of given precision. */
    public static String encode(double lat, double lng, int precision) {
        double latLo = -90.0, latHi = 90.0;
        double lngLo = -180.0, lngHi = 180.0;
        StringBuilder sb = new StringBuilder();
        int bitBuf = 0, bitCnt = 0;
        boolean even = true;

        for (int i = 0; i < precision * 5; i++) {
            if (even) {
                double mid = (lngLo + lngHi) / 2;
                if (lng >= mid) { bitBuf = (bitBuf << 1) | 1; lngLo = mid; }
                else            { bitBuf =  bitBuf << 1;       lngHi = mid; }
            } else {
                double mid = (latLo + latHi) / 2;
                if (lat >= mid) { bitBuf = (bitBuf << 1) | 1; latLo = mid; }
                else            { bitBuf =  bitBuf << 1;       latHi = mid; }
            }
            even = !even;
            if (++bitCnt == 5) {
                sb.append(BASE32.charAt(bitBuf));
                bitBuf = 0; bitCnt = 0;
            }
        }
        return sb.toString();
    }

    /**
     * Decode geohash to bounding box.
     * @return [minLat, maxLat, minLng, maxLng]
     */
    public static double[] decodeBbox(String hash) {
        double latLo = -90.0, latHi = 90.0;
        double lngLo = -180.0, lngHi = 180.0;
        boolean even = true;

        for (int ci = 0; ci < hash.length(); ci++) {
            int val = BASE32_MAP[hash.charAt(ci)];
            for (int bit = 4; bit >= 0; bit--) {
                if (even) {
                    double mid = (lngLo + lngHi) / 2;
                    if (((val >> bit) & 1) == 1) lngLo = mid; else lngHi = mid;
                } else {
                    double mid = (latLo + latHi) / 2;
                    if (((val >> bit) & 1) == 1) latLo = mid; else latHi = mid;
                }
                even = !even;
            }
        }
        return new double[]{latLo, latHi, lngLo, lngHi};
    }

    /** Get adjacent geohash in given direction ("top"/"bottom"/"left"/"right"). */
    public static String getAdjacent(String hash, String direction) {
        if (hash.isEmpty()) throw new IllegalArgumentException("empty hash");
        hash = hash.toLowerCase();
        char last = hash.charAt(hash.length() - 1);
        String base = hash.substring(0, hash.length() - 1);
        int parity = hash.length() % 2 == 0 ? 0 : 1; // 0=even, 1=odd
        int dir    = dirIdx(direction);

        String nbTable  = NEIGHBOR[dir][parity];
        String bdrTable = BORDER[dir][parity];

        if (!base.isEmpty() && bdrTable.indexOf(last) >= 0)
            base = getAdjacent(base, direction);

        return base + BASE32.charAt(nbTable.indexOf(last));
    }
}
