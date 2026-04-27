package com.routesearch;

/** Immutable along-route search result. */
public final class Poi {
    public final String id;
    public final String name;
    public final double lng;
    public final double lat;
    public final String address;
    public final String rating;
    public final String tel;
    public final String cost;
    public final String opentime;
    public final String businessArea;
    public final int    segment;   // 0-based segment index
    public final double distM;     // distance to nearest route point (m)
    public final boolean isLeft;   // true = opposite side of travel direction
    public final boolean isHighway;

    public Poi(String id, String name, double lng, double lat,
               String address, String rating, String tel,
               String cost, String opentime, String businessArea,
               int segment, double distM, boolean isLeft, boolean isHighway) {
        this.id           = id;
        this.name         = name;
        this.lng          = lng;
        this.lat          = lat;
        this.address      = address;
        this.rating       = rating;
        this.tel          = tel;
        this.cost         = cost;
        this.opentime     = opentime;
        this.businessArea = businessArea;
        this.segment      = segment;
        this.distM        = distM;
        this.isLeft       = isLeft;
        this.isHighway    = isHighway;
    }
}
