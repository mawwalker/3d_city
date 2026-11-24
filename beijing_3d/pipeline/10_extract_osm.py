"""Extract the layers we need from the Beijing OSM extract into GeoParquet files.

usage: 10_extract_osm.py <beijing.osm.pbf> <out_dir>
"""
import sys, os, json, time
import osmium
import osmium.geom
import shapely
from shapely import wkb as _wkb
import geopandas as gpd
import pandas as pd

PBF, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
# generous region: everything the camera can ever see near the city
W, S, E, N = 115.95, 39.55, 116.85, 40.28

wkbf = osmium.geom.WKBFactory()

GREEN_KEYS = {
    "leisure": {"park", "garden", "golf_course", "nature_reserve", "pitch", "playground", "recreation_ground", "stadium", "track", "sports_centre"},
    "landuse": {"forest", "grass", "meadow", "recreation_ground", "cemetery", "village_green", "farmland", "orchard", "allotments", "greenfield", "plant_nursery", "vineyard",
                "residential", "commercial", "industrial", "retail", "railway", "military", "construction", "education", "institutional", "religious", "brownfield"},
    "natural": {"wood", "scrub", "grassland", "heath", "wetland", "sand", "bare_rock", "scree", "beach"},
    "amenity": {"university", "school", "college", "hospital", "parking", "place_of_worship"},
    "tourism": {"attraction", "museum", "theme_park", "zoo"},
    "place": {"square"},
    "aeroway": {"aerodrome", "runway", "apron", "taxiway"},
    "historic": {"palace", "castle", "city_gate", "monument", "memorial", "ruins", "temple", "tomb", "archaeological_site"},
    "boundary": {"protected_area", "national_park"},
}
ROAD_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
                "unclassified", "residential", "living_street", "pedestrian", "service", "footway", "path", "cycleway", "track", "steps"}
KEEP_TAGS_B = ["building", "building:part", "height", "building:height", "min_height", "building:levels", "building:min_level", "roof:shape", "roof:height", "roof:levels",
               "roof:colour", "building:colour", "building:material", "name", "name:zh", "name:en", "amenity", "tourism", "historic", "shop", "office", "leisure", "layer", "location",
               "man_made", "railway", "public_transport", "religion", "tower:type", "start_date", "architect", "wikidata"]


def in_bbox(lon, lat):
    return W <= lon <= E and S <= lat <= N


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.buildings, self.areas, self.water, self.roads, self.rails, self.waterlines, self.pois, self.barriers = [], [], [], [], [], [], [], []
        self.aero = []
        self.subway_rel = []
        self.err = 0

    # ---- polygons
    def area(self, a):
        t = a.tags
        isb = ("building" in t and t["building"] not in ("no",)) or ("building:part" in t and t["building:part"] != "no")
        mm = t.get("man_made")
        is_water = t.get("natural") == "water" or t.get("waterway") in ("riverbank", "dock", "canal") or t.get("landuse") in ("reservoir", "basin") or t.get("water") is not None
        kinds = []
        for k, vs in GREEN_KEYS.items():
            v = t.get(k)
            if v in vs:
                kinds.append(f"{k}={v}")
        if t.get("highway") in ("pedestrian", "footway", "service") and t.get("area") == "yes":
            kinds.append("highway=plaza")
        is_tower = mm in ("tower", "chimney", "storage_tank", "silo", "gasometer", "water_tower", "bridge", "pier", "communications_tower", "cooling_tower")
        if not (isb or is_water or kinds or is_tower):
            return
        try:
            g = _wkb.loads(wkbf.create_multipolygon(a), hex=True)
        except Exception:
            self.err += 1
            return
        c = g.representative_point()
        if not in_bbox(c.x, c.y):
            b = g.bounds
            if b[2] < W or b[0] > E or b[3] < S or b[1] > N:
                return
        oid = ("w" if a.from_way() else "r") + str(a.orig_id())
        if isb or is_tower:
            rec = {"osm_id": oid, "geometry": g}
            for k in KEEP_TAGS_B:
                v = t.get(k)
                if v is not None:
                    rec[k] = v
            self.buildings.append(rec)
        if is_water:
            self.water.append({"osm_id": oid, "geometry": g, "name": t.get("name"), "water": t.get("water"), "natural": t.get("natural"), "waterway": t.get("waterway"),
                               "landuse": t.get("landuse"), "intermittent": t.get("intermittent"), "tunnel": t.get("tunnel"), "covered": t.get("covered")})
        if kinds:
            self.areas.append({"osm_id": oid, "geometry": g, "kind": kinds[0], "kinds": ";".join(kinds), "name": t.get("name"), "name:en": t.get("name:en"), "sport": t.get("sport"),
                               "surface": t.get("surface"), "access": t.get("access"), "wikidata": t.get("wikidata"), "leaf_type": t.get("leaf_type")})

    # ---- lines
    def way(self, w):
        t = w.tags
        hw, rw, ww = t.get("highway"), t.get("railway"), t.get("waterway")
        br = t.get("barrier")
        aw = t.get("aeroway")
        if aw in ("runway", "taxiway") and t.get("area") != "yes":
            try:
                g = _wkb.loads(wkbf.create_linestring(w), hex=True)
                self.aero.append({"osm_id": w.id, "geometry": g, "aeroway": aw, "width": t.get("width"), "ref": t.get("ref")})
            except Exception:
                self.err += 1
            return
        if not (hw in ROAD_CLASSES or rw in ("rail", "subway", "light_rail", "monorail", "tram", "narrow_gauge") or ww in ("river", "canal", "stream", "drain", "ditch") or br in ("city_wall", "wall") or t.get("historic") == "citywalls"):
            return
        try:
            g = _wkb.loads(wkbf.create_linestring(w), hex=True)
        except Exception:
            self.err += 1
            return
        b = g.bounds
        if b[2] < W or b[0] > E or b[3] < S or b[1] > N:
            return
        if hw in ROAD_CLASSES:
            self.roads.append({"osm_id": w.id, "geometry": g, "highway": hw, "name": t.get("name"), "name:en": t.get("name:en"), "ref": t.get("ref"), "bridge": t.get("bridge"), "tunnel": t.get("tunnel"),
                               "layer": t.get("layer"), "lanes": t.get("lanes"), "oneway": t.get("oneway"), "width": t.get("width"), "maxspeed": t.get("maxspeed"), "junction": t.get("junction"),
                               "area": t.get("area"), "surface": t.get("surface"), "covered": t.get("covered"), "indoor": t.get("indoor")})
        elif rw:
            self.rails.append({"osm_id": w.id, "geometry": g, "railway": rw, "name": t.get("name"), "bridge": t.get("bridge"), "tunnel": t.get("tunnel"), "layer": t.get("layer"),
                               "service": t.get("service"), "usage": t.get("usage"), "highspeed": t.get("highspeed"), "electrified": t.get("electrified"), "location": t.get("location")})
        elif ww:
            self.waterlines.append({"osm_id": w.id, "geometry": g, "waterway": ww, "name": t.get("name"), "width": t.get("width"), "tunnel": t.get("tunnel"), "intermittent": t.get("intermittent"), "layer": t.get("layer")})
        else:
            self.barriers.append({"osm_id": w.id, "geometry": g, "barrier": br, "historic": t.get("historic"), "name": t.get("name"), "height": t.get("height")})

    def relation(self, r):
        t = r.tags
        if t.get("type") == "route" and t.get("route") in ("subway", "light_rail", "monorail"):
            self.subway_rel.append({"rel_id": r.id, "name": t.get("name"), "ref": t.get("ref"), "colour": t.get("colour"), "route": t.get("route"),
                                    "from": t.get("from"), "to": t.get("to"), "ways": [m.ref for m in r.members if m.type == "w"],
                                    "stops": [m.ref for m in r.members if m.type == "n" and m.role in ("stop", "stop_entry_only", "stop_exit_only", "")]})

    # ---- points
    def node(self, n):
        t = n.tags
        if len(t) == 0:
            return
        if not n.location.valid():
            return
        lon, lat = n.location.lon, n.location.lat
        if not in_bbox(lon, lat):
            return
        keep = None
        for k in ("place", "tourism", "historic", "railway", "natural", "man_made", "aeroway", "amenity", "station"):
            v = t.get(k)
            if v is None:
                continue
            if k == "place" and v in ("city", "suburb", "quarter", "neighbourhood", "town", "village", "square", "locality", "island"):
                keep = f"{k}={v}"
            elif k == "tourism" and v in ("attraction", "museum", "viewpoint", "theme_park", "zoo", "artwork"):
                keep = f"{k}={v}"
            elif k == "historic":
                keep = f"{k}={v}"
            elif k == "railway" and v in ("station", "halt", "subway_entrance"):
                keep = f"{k}={v}"
            elif k == "natural" and v in ("peak", "tree"):
                keep = f"{k}={v}"
            elif k == "man_made" and v in ("tower", "chimney", "communications_tower", "obelisk", "flagpole"):
                keep = f"{k}={v}"
            elif k == "aeroway" and v in ("aerodrome",):
                keep = f"{k}={v}"
            if keep:
                break
        if keep is None:
            return
        if keep == "natural=tree" or keep == "railway=subway_entrance":
            self.pois.append({"osm_id": n.id, "geometry": shapely.Point(lon, lat), "kind": keep})
            return
        self.pois.append({"osm_id": n.id, "geometry": shapely.Point(lon, lat), "kind": keep, "name": t.get("name"), "name:en": t.get("name:en"), "name:zh": t.get("name:zh"),
                          "ele": t.get("ele"), "height": t.get("height"), "station": t.get("station"), "subway": t.get("subway"), "network": t.get("network"),
                          "wikidata": t.get("wikidata"), "population": t.get("population")})


t0 = time.time()
h = H()
h.apply_file(PBF, locations=True, idx="flex_mem")
print("parsed in", round(time.time() - t0, 1), "s; geometry errors", h.err)


def save(recs, name):
    if not recs:
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
save(h.pois, "osm_pois")
save(h.barriers, "osm_barriers")
save(h.aero, "osm_aero")
import json as _json
_json.dump(h.subway_rel, open(os.path.join(OUT, "osm_subway_routes.json"), "w"), ensure_ascii=False)
print("subway routes", len(h.subway_rel))
