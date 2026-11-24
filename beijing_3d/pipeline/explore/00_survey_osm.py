"""Quick survey of the OSM extract: what is inside the 5th-ring bbox and how well is it tagged."""
import sys
import collections
import osmium

PBF = sys.argv[1]
# generous bbox around the 5th Ring Road
W, S, E, N = 116.16, 39.72, 116.60, 40.07


class Survey(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.b = 0
        self.b_in = 0
        self.b_h = 0
        self.b_lv = 0
        self.b_types = collections.Counter()
        self.hw = collections.Counter()
        self.water = 0
        self.green = collections.Counter()
        self.rings = collections.Counter()
        self.rel_routes = []

    def way(self, w):
        t = w.tags
        if "building" in t or "building:part" in t:
            self.b += 1
            try:
                n = w.nodes[0]
                lon, lat = n.lon, n.lat
            except Exception:
                return
            if W <= lon <= E and S <= lat <= N:
                self.b_in += 1
                if "height" in t:
                    self.b_h += 1
                if "building:levels" in t:
                    self.b_lv += 1
                self.b_types[t.get("building", "part")] += 1
        if "highway" in t:
            try:
                n = w.nodes[0]
                lon, lat = n.lon, n.lat
            except Exception:
                return
            if W <= lon <= E and S <= lat <= N:
                self.hw[t["highway"]] += 1
                nm = t.get("name", "")
                if "环" in nm:
                    self.rings[nm] += 1
        if t.get("natural") == "water" or t.get("waterway") in ("riverbank", "river", "canal"):
            self.water += 1
        for k in ("leisure", "landuse", "natural"):
            v = t.get(k)
            if v in ("park", "forest", "grass", "wood", "garden", "meadow", "golf_course", "recreation_ground", "scrub", "cemetery", "village_green"):
                self.green[f"{k}={v}"] += 1

    def relation(self, r):
        t = r.tags
        if t.get("type") == "route" and t.get("route") == "road":
            nm = t.get("name", "")
            if "环" in nm:
                self.rel_routes.append((r.id, nm, t.get("ref", ""), len(r.members)))


s = Survey()
s.apply_file(PBF, locations=True)
print("buildings total", s.b, "in bbox", s.b_in, "with height", s.b_h, "with levels", s.b_lv)
print("building types", s.b_types.most_common(25))
print("highways", s.hw.most_common(30))
print("water ways", s.water)
print("green", s.green.most_common())
print("ring-named ways", s.rings.most_common(40))
print("ring route relations", s.rel_routes)
