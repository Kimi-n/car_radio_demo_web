package com.routesearch;

/** Coordinate annotated with road-type flag for directional penalty. */
public final class TaggedCoord {
    public final double lng;
    public final double lat;
    public final boolean isHighway;

    public TaggedCoord(double lng, double lat, boolean isHighway) {
        this.lng = lng;
        this.lat = lat;
        this.isHighway = isHighway;
    }

    public Coord toCoord() { return new Coord(lng, lat); }
}
