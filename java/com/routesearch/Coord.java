package com.routesearch;

/** Immutable geographic coordinate (lng, lat). */
public final class Coord {
    public final double lng;
    public final double lat;

    public Coord(double lng, double lat) {
        this.lng = lng;
        this.lat = lat;
    }

    @Override public String toString() { return lng + "," + lat; }
}
