"""Extract every OSM layer Chongqing 3D uses into GeoParquet files (lon/lat, tags as JSON).

usage: 10_extract_osm.py <chongqing-latest.osm.pbf> <out_dir>
"""
import sys, os, json, time
import osmium
import osmium.geom
import shapely
from shapely import wkb as _wkb
import geopandas as gpd
import pandas as pd

PBF, OUT = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import BBOX_LL
os.makedirs(OUT, exist_ok=True)
W, S, E, N = BBOX_LL[0] - 0.04, BBOX_LL[1] - 0.04, BBOX_LL[2] + 0.04, BBOX_LL[3] + 0.04

wkbf = osmium.geom.WKBFactory()

AREA_KEYS = {
    "leisure": None,
    "landuse": None,
    "natural": {"wood", "scrub", "grassland", "heath", "wetland", "sand", "bare_rock", "scree", "beach", "mud", "shingle", "tree_row", "cliff"},
    "amenity": {
        "university", "school", "college", "hospital", "parking", "place_of_worship", "kindergarten", "marketplace",
        "bus_station", "ferry_terminal", "fuel", "bicycle_parking", "fountain", "townhall", "theatre", "library",
        "community_centre", "exhibition_centre", "conference_centre", "police", "fire_station", "courthouse", "arts_centre",
    },
    "tourism": {"attraction", "museum", "theme_park", "zoo", "aquarium", "gallery", "hotel", "viewpoint", "artwork"},
    "place": {"square", "island", "islet"},
    "aeroway": {"aerodrome", "runway", "apron", "taxiway", "terminal", "helipad"},
    "historic": None,
    "boundary": {"protected_area", "national_park"},
    "man_made": {"bridge", "pier", "breakwater", "groyne", "embankment", "wastewater_plant", "works", "quay", "courtyard"},
    "railway": {"platform", "station", "turntable"},
    "public_transport": {"platform", "station"},
    "power": {"substation", "plant"},
    "shop": {"mall"},
    "area:highway": None,
    "golf": None,
    "sport": None,
}
ROAD_OK = {
    "motorway", "trunk", "primary", "secondary", "tertiary",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
    "unclassified", "residential", "living_street", "pedestrian", "service",
    "footway", "path", "cycleway", "track", "steps", "busway", "corridor", "elevator", "construction", "raceway", "bus_guideway",
}
RAIL_OK = {"rail", "subway", "light_rail", "monorail", "tram", "narrow_gauge", "maglev", "funicular", "platform", "construction", "disused", "miniature"}
POINT_KEYS = (
    "natural", "highway", "amenity", "shop", "barrier", "man_made", "railway", "tourism", "public_transport",
    "emergency", "power", "leisure", "historic", "advertising", "place", "office", "craft", "aeroway",
    "station", "traffic_sign", "entrance", "waterway", "healthcare", "club", "aerialway",
)
POINT_SKIP = {
    ("highway", "motorway_junction"), ("railway", "switch"), ("railway", "level_crossing"), ("railway", "buffer_stop"),
    ("railway", "signal"), ("public_transport", "stop_position"), ("power", "portal"), ("railway", "railway_crossing"),
    ("railway", "milestone"), ("highway", "turning_circle"), ("highway", "milestone"), ("highway", "speed_camera"),
    ("highway", "give_way"), ("highway", "stop"), ("highway", "passing_place"), ("highway", "mini_roundabout"),
    ("highway", "turning_loop"), ("railway", "derail"),
}


def tags_json(t):
    return json.dumps({k: v for k, v in t}, ensure_ascii=False, separators=(",", ":"))


def bbox_hit(b):
    return not (b[2] < W or b[0] > E or b[3] < S or b[1] > N)


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.buildings, self.areas, self.water, self.roads, self.rails, self.waterlines, self.points, self.barriers = [], [], [], [], [], [], [], []
        self.routes = []
        self.err = 0

    def area(self, a):
        t = a.tags
        isb = ("building" in t and t["building"] != "no") or ("building:part" in t and t["building:part"] != "no")
        mm = t.get("man_made")
        is_tower = mm in ("tower", "chimney", "storage_tank", "silo", "gasometer", "water_tower", "communications_tower", "cooling_tower", "lighthouse", "crane", "mast")
        is_water = (
            t.get("natural") in ("water", "bay", "strait")
            or t.get("waterway") in ("riverbank", "dock", "canal", "boatyard")
            or t.get("landuse") in ("reservoir", "basin")
            or t.get("water") is not None
            or t.get("leisure") == "swimming_pool"
            or t.get("natural") == "coastline"
        )
        kinds = []
        for k, vs in AREA_KEYS.items():
            v = t.get(k)
            if v is not None and (vs is None or v in vs):
                kinds.append(f"{k}={v}")
        if t.get("highway") in ("pedestrian", "footway", "service", "living_street", "residential", "path", "steps", "platform", "rest_area", "services") and (t.get("area") == "yes" or (a.orig_id() and not a.from_way())):
            kinds.append("highway=" + t.get("highway") + "_area")
        if not (isb or is_water or kinds or is_tower):
            return
        try:
            g = _wkb.loads(wkbf.create_multipolygon(a), hex=True)
        except Exception:
            self.err += 1
            return
        if not bbox_hit(g.bounds):
            return
        oid = ("w" if a.from_way() else "r") + str(a.orig_id())
        tj = tags_json(t)
        if isb or is_tower:
            self.buildings.append({"osm_id": oid, "geometry": g, "tags": tj})
        if is_water:
            self.water.append({"osm_id": oid, "geometry": g, "tags": tj})
        if kinds:
            self.areas.append({"osm_id": oid, "geometry": g, "kind": kinds[0], "kinds": ";".join(kinds), "name": t.get("name"), "tags": tj})

    def way(self, w):
        t = w.tags
        hw, rw, ww = t.get("highway"), t.get("railway"), t.get("waterway")
        br = t.get("barrier")
        nat = t.get("natural")
        other = None
        if br is not None:
            other = "barrier=" + br
        elif nat in ("tree_row", "cliff", "coastline"):
            other = "natural=" + nat
        elif t.get("power") in ("line", "minor_line"):
            other = "power=" + t.get("power")
        elif t.get("man_made") in ("embankment", "pier", "breakwater", "groyne", "pipeline", "quay"):
            other = "man_made=" + t.get("man_made")
        elif t.get("route") == "ferry":
            other = "route=ferry"
        elif t.get("aeroway") in ("runway", "taxiway", "parking_position"):
            other = "aeroway=" + t.get("aeroway")
        elif t.get("historic") == "citywalls":
            other = "barrier=city_wall"
        elif t.get("aerialway") is not None:
            other = "aerialway=" + t.get("aerialway")
        elif t.get("leisure") in ("track", "slipway") and t.get("area") != "yes":
            other = "leisure=" + t.get("leisure")
        elif t.get("attraction") is not None or t.get("roller_coaster") is not None:
            other = "attraction=" + (t.get("attraction") or "roller_coaster")
        is_road = hw in ROAD_OK
        is_rail = rw in RAIL_OK
        is_wl = ww in ("river", "canal", "stream", "drain", "ditch", "dam", "weir", "lock_gate")
        if not (is_road or is_rail or is_wl or other):
            return
        try:
            g = _wkb.loads(wkbf.create_linestring(w), hex=True)
        except Exception:
            self.err += 1
            return
        if not bbox_hit(g.bounds):
            return
        tj = tags_json(t)
        rec = {"osm_id": w.id, "geometry": g, "tags": tj}
        if is_road:
            rec["highway"] = hw
            rec["n0"] = w.nodes[0].ref
            rec["n1"] = w.nodes[-1].ref
            self.roads.append(rec)
        elif is_rail:
            rec["railway"] = rw
            self.rails.append(rec)
        elif is_wl:
            rec["waterway"] = ww
            self.waterlines.append(rec)
        else:
            rec["kind"] = other
            self.barriers.append(rec)

    def relation(self, r):
        t = r.tags
        if t.get("type") == "route" and t.get("route") in ("subway", "light_rail", "monorail", "ferry", "tram", "train"):
            self.routes.append({
                "rel_id": r.id,
                "tags": {k: v for k, v in t},
                "ways": [m.ref for m in r.members if m.type == "w"],
                "stops": [m.ref for m in r.members if m.type == "n"],
            })

    def node(self, n):
        t = n.tags
        if len(t) == 0 or not n.location.valid():
            return
        lon, lat = n.location.lon, n.location.lat
        if not (W <= lon <= E and S <= lat <= N):
            return
        keep = None
        for k in POINT_KEYS:
            v = t.get(k)
            if v is None or (k, v) in POINT_SKIP:
                continue
            keep = f"{k}={v}"
            break
        if keep is None:
            return
        self.points.append({"osm_id": n.id, "geometry": shapely.Point(lon, lat), "kind": keep, "name": t.get("name"), "tags": tags_json(t)})


t0 = time.time()
h = H()
h.apply_file(PBF, locations=True, idx="flex_mem")
print("parsed in", round(time.time() - t0, 1), "s; geometry errors", h.err)


def save(recs, name):
    if not recs:
        gdf = gpd.GeoDataFrame(columns=["osm_id", "geometry", "tags"], geometry="geometry", crs=4326)
        gdf.to_parquet(os.path.join(OUT, name + ".parquet"))
        print(name, 0)
        return
    gdf = gpd.GeoDataFrame(pd.DataFrame(recs), geometry="geometry", crs=4326)
    gdf.to_parquet(os.path.join(OUT, name + ".parquet"))
    print(name, len(gdf))


save(h.buildings, "osm_buildings")
save(h.areas, "osm_areas")
save(h.water, "osm_water")
save(h.roads, "osm_roads")
save(h.rails, "osm_rails")
save(h.waterlines, "osm_waterlines")
save(h.barriers, "osm_barriers")
save(h.points, "osm_points")
json.dump(h.routes, open(os.path.join(OUT, "osm_routes.json"), "w"), ensure_ascii=False)
print("routes", len(h.routes))
