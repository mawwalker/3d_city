#!/usr/bin/env python3
"""Chongqing 3D — Offline GIS, DEM Terrain, Tile Format v2, Exclusions & PBR Asset Verifier.

Read-only audit of chongqing_3d/{pipeline,data,site/data,site/assets}.
Usage:
  python audit_gis_dem.py [--root <chongqing_3d_dir>] [--phase 1|2] [--max-tiles 0]
"""
import argparse
import gzip
import importlib.util
import json
import math
import os
import struct
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

try:
    from scipy import ndimage
except ImportError:
    ndimage = None

try:
    import shapely
    from shapely.geometry import Point, Polygon, shape
except ImportError:
    shapely = None

try:
    import geopandas as gpd
except ImportError:
    gpd = None


def wgs84_to_gcj02(lon, lat):
    """Standard WGS-84 -> GCJ-02 transform to detect accidental GCJ-02 contamination."""
    a = 6378245.0
    ee = 0.00669342162296594323
    x, y = lon - 105.0, lat - 35.0
    dlat = (-100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
            + (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
            + (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
            + (160.0 * math.sin(y / 12.0 * math.pi) + 320.0 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0)
    dlon = (300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
            + (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
            + (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
            + (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0)
    radlat = lat / 180.0 * math.pi
    magic = math.sin(radlat)
    magic = 1 - ee * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((a * (1 - ee)) / (magic * sqrtmagic) * math.pi)
    dlon = (dlon * 180.0) / (a / sqrtmagic * math.cos(radlat) * math.pi)
    return lon + dlon, lat + dlat


def gcj02_to_wgs84(lon, lat):
    """Exact inverse GCJ-02 -> WGS-84 via fixed-point iteration."""
    wlon, wlat = lon, lat
    for _ in range(6):
        glon, glat = wgs84_to_gcj02(wlon, wlat)
        wlon += lon - glon
        wlat += lat - glat
    return wlon, wlat


# ---- Reference TRUE WGS-84 coordinates for Chongqing (NEVER GCJ-02)
# Verified against OSM: Jiefangbei Monument (way 589752618) = (106.573357, 29.560101).
# (Its GCJ-02 shifted value would be (106.577047, 29.557218) — ~500m SE!)
def _from_gcj(glon, glat, tol):
    wlon, wlat = gcj02_to_wgs84(glon, glat)
    return (round(wlon, 6), round(wlat, 6), tol)


WGS84_REF = {
    "jiefangbei":      (106.573357, 29.560101, 150),         # OSM way 589752618
    "hongyadong":      _from_gcj(106.5791, 29.5621, 350),    # 洪崖洞
    "raffles":         _from_gcj(106.5868, 29.5656, 400),    # 来福士广场
    "chaotianmen":     _from_gcj(106.5892, 29.5672, 450),    # 朝天门两江交汇
    "guotai":          _from_gcj(106.5798, 29.5594, 350),    # 国泰艺术中心
    "wfc":             _from_gcj(106.5764, 29.5586, 350),    # 环球金融中心 WFC
    "chongqing100":    _from_gcj(106.5175, 29.5535, 500),    # 陆海国际中心 (化龙桥)
    "grand_theatre":   _from_gcj(106.5836, 29.5698, 400),    # 重庆大剧院
    "great_hall":      _from_gcj(106.5512, 29.5623, 400),    # 重庆人民大礼堂
    "science_museum":  _from_gcj(106.5880, 29.5720, 450),    # 重庆科技馆
    "liziba":          _from_gcj(106.5356, 29.5535, 400),    # 李子坝轻轨站
    "cableway_north":  _from_gcj(106.5864, 29.5576, 400),    # 长江索道北站(新华路)
    "cableway_south":  _from_gcj(106.5936, 29.5504, 450),    # 长江索道南站(上新街)
    "qiansimen":       _from_gcj(106.5800, 29.5654, 450),    # 千厮门大桥中跨
    "dongshuimen":     _from_gcj(106.5877, 29.5575, 450),    # 东水门大桥中跨
    "chaotianmen_br":  _from_gcj(106.5955, 29.5855, 650),    # 朝天门长江大桥
    "caiyuanba":       _from_gcj(106.5480, 29.5415, 650),    # 菜园坝大桥
    "nanshan_onetree": (106.598864, 29.547947, 500),         # 南山一棵树观景台 (verified OSM WGS-84, ASL 446m)
    "kuixinglou":      _from_gcj(106.5792, 29.5608, 350),    # 魁星楼
    "baixiangju":      _from_gcj(106.5844, 29.5554, 400),    # 白象居
    "shibati":         _from_gcj(106.5724, 29.5522, 450),    # 十八梯
}


def _probe_gcj(name, glon, glat, lo, hi, cat):
    wlon, wlat = gcj02_to_wgs84(glon, glat)
    return (name, round(wlon, 6), round(wlat, 6), lo, hi, cat)


# Known TRUE WGS-84 ridge & urban elevation probes for DEM realism checks (rivers checked directly via OSM water polygons!)
DEM_PROBES = [
    ("Yuzhong_Jiefangbei",              106.573357, 29.560101, 225.0, 290.0, "yuzhong"),
    ("Yuzhong_Raffles",                 106.583473, 29.567752, 185.0, 240.0, "yuzhong"),
    _probe_gcj("Yuzhong_Pipashan",      106.5575, 29.5550, 250.0, 360.0, "yuzhong"),
    ("Hongyadong_Top_Cangbai",          106.574450, 29.563700, 220.0, 290.0, "cliff_top"),
    ("Hongyadong_Bot_River",            106.574450, 29.565300, 160.0, 200.0, "cliff_bot"),
    ("Jiangbeizui_GrandTheatre",        106.577520, 29.572730, 195.0, 260.0, "urban"),
    ("GreatHall_People",                106.550174, 29.564360, 200.0, 265.0, "urban"),
    ("Nanshan_OneTree",                 106.598864, 29.547947, 400.0, 520.0, "nanshan"),
    _probe_gcj("Nanshan_Ridge_Peak",    106.6090, 29.5480, 440.0, 690.0, "nanshan"),
]


def haversine_m(lon1, lat1, lon2, lat2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


class Report:
    def __init__(self):
        self.checks = []

    def add(self, section, name, status, detail, metrics=None):
        # status: PASS | WARN | FAIL | SKIP
        entry = {"section": section, "name": name, "status": status, "detail": detail}
        if metrics is not None:
            entry["metrics"] = metrics
        self.checks.append(entry)
        tag = {"PASS": "[PASS]", "WARN": "[WARN]", "FAIL": "[FAIL]", "SKIP": "[SKIP]"}[status]
        print(f"{tag} {section}.{name}: {detail}")

    def summary(self):
        counts = {k: sum(1 for c in self.checks if c["status"] == k) for k in ("PASS", "WARN", "FAIL", "SKIP")}
        return counts


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, str(path))
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(path.parent))
    spec.loader.exec_module(mod)
    return mod


class TerrainSampler:
    """Flexible loader for site/data/terrain.json + binary height grids."""
    def __init__(self, site_data_dir: Path):
        self.dir = site_data_dir
        self.meta = None
        self.grids = {}
        self.base_asl = 0.0
        self.water_y = None
        self.water_asl = None
        self._load()

    def _decode_grid(self, cfg):
        fn = cfg.get("file") or cfg.get("bin") or "terrain.bin"
        p = self.dir / fn
        if not p.exists():
            raise FileNotFoundError(f"Missing terrain binary {p}")
        raw = p.read_bytes()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        nx, ny = int(cfg["nx"]), int(cfg["ny"])
        n = nx * ny
        dtype = str(cfg.get("dtype", cfg.get("format", "uint16"))).lower()
        scale = float(cfg.get("scale", 0.1 if "u16" in dtype or "uint16" in dtype else 1.0))
        offset = float(cfg.get("offset", cfg.get("z0", cfg.get("min_z", cfg.get("min", 0.0)))))
        # Auto-detect by byte size if needed
        if len(raw) == n * 2:
            if "f16" in dtype or "float16" in dtype:
                arr = np.frombuffer(raw, "<f2").astype(np.float32).reshape(ny, nx)
            elif "i16" in dtype or "int16" in dtype:
                arr = np.frombuffer(raw, "<i2").astype(np.float32).reshape(ny, nx) * scale + offset
            else:
                # uint16: check if encoding is q = (z - offset) / scale OR q = z / scale with min/max metadata
                raw_u16 = np.frombuffer(raw, "<u2").astype(np.float32).reshape(ny, nx)
                if "z_min" in cfg and "z_max" in cfg and "scale" not in cfg:
                    zmin, zmax = float(cfg["z_min"]), float(cfg["z_max"])
                    arr = zmin + raw_u16 / 65535.0 * (zmax - zmin)
                elif "min_h" in cfg and "max_h" in cfg and "scale" not in cfg:
                    zmin, zmax = float(cfg["min_h"]), float(cfg["max_h"])
                    arr = zmin + raw_u16 / 65535.0 * (zmax - zmin)
                elif "min" in cfg and "max" in cfg and "scale" not in cfg and "offset" not in cfg and raw_u16.max() > 20000:
                    zmin, zmax = float(cfg["min"]), float(cfg["max"])
                    arr = zmin + raw_u16 / 65535.0 * (zmax - zmin)
                else:
                    # Standard decimetre encoding (beijing_3d style: u16 * scale + offset)
                    arr = raw_u16 * scale + (offset if ("offset" in cfg or "z0" in cfg or "min_z" in cfg) else 0.0)
        elif len(raw) == n * 4:
            arr = np.frombuffer(raw, "<f4").reshape(ny, nx).copy()
        else:
            raise ValueError(f"Unexpected terrain binary byte size {len(raw)} for {nx}x{ny} (dtype={dtype})")
        # Orientation: determine whether row 0 = south (y0) or row 0 = north (z0 in webgl)
        row0_north = bool(cfg.get("row0_north", cfg.get("y_down", False)))
        x0 = float(cfg.get("x0", cfg.get("xmin", cfg.get("x_min", 0.0))))
        y0 = float(cfg.get("y0", cfg.get("ymin", cfg.get("y_min", 0.0))))
        cell = float(cfg.get("cell", cfg.get("step", cfg.get("res", 10.0))))
        return dict(arr=arr, x0=x0, y0=y0, nx=nx, ny=ny, cell=cell, row0_north=row0_north, cfg=cfg)

    def _load(self):
        tp = self.dir / "terrain.json"
        if not tp.exists():
            return
        self.meta = json.loads(tp.read_text())
        # Detect datum / ASL offset
        self.base_asl = float(
            self.meta.get("datum_asl",
            self.meta.get("base_asl",
            self.meta.get("sea_level_offset",
            self.meta.get("y_offset_asl",
            self.meta.get("water_asl", 0.0) - self.meta.get("water_y", 0.0) if ("water_asl" in self.meta and "water_y" in self.meta) else 0.0))))
        )
        if "water_y" in self.meta:
            self.water_y = float(self.meta["water_y"])
        elif "waterY" in self.meta:
            self.water_y = float(self.meta["waterY"])
        if "water_asl" in self.meta:
            self.water_asl = float(self.meta["water_asl"])
        elif "waterASL" in self.meta:
            self.water_asl = float(self.meta["waterASL"])

        # Handle either multi-grid {"core": ..., "fine": ..., "coarse": ...} or single-grid top-level {"nx": ..., "ny": ...}
        if "nx" in self.meta and "ny" in self.meta:
            self.grids["fine"] = self._decode_grid(self.meta)
        else:
            for k in ("core", "fine", "high", "main", "coarse", "far"):
                if isinstance(self.meta.get(k), dict) and "nx" in self.meta[k]:
                    self.grids[k] = self._decode_grid(self.meta[k])

    def sample_world_y(self, x, y_north, grid_name=None):
        """Bilinear sample in pipeline coordinates (x east, y_north north). Returns world Y."""
        order = [grid_name] if grid_name else [k for k in ("core", "fine", "high", "main", "coarse", "far") if k in self.grids]
        for k in order:
            g = self.grids[k]
            fx = (x - g["x0"]) / g["cell"] - 0.5
            fy = (y_north - g["y0"]) / g["cell"] - 0.5
            if g["row0_north"]:
                fy = (g["ny"] - 1) - fy
            if 0 <= fx <= g["nx"] - 1 and 0 <= fy <= g["ny"] - 1:
                ix = min(int(math.floor(fx)), g["nx"] - 2)
                iy = min(int(math.floor(fy)), g["ny"] - 2)
                tx, ty = fx - ix, fy - iy
                a = g["arr"]
                v = ((1 - tx) * (1 - ty) * a[iy, ix]
                     + tx * (1 - ty) * a[iy, ix + 1]
                     + (1 - tx) * ty * a[iy + 1, ix]
                     + tx * ty * a[iy + 1, ix + 1])
                return float(v)
        return float("nan")

    def to_asl(self, world_y):
        if self.base_asl != 0.0:
            return world_y + self.base_asl
        # If raw values look already like ASL (~150..700m), keep them directly
        g = next(iter(self.grids.values()))
        med = float(np.nanmedian(g["arr"]))
        if med < 110.0 and self.water_asl is not None and self.water_y is not None:
            return world_y + (self.water_asl - self.water_y)
        return world_y


def audit_gis_and_origin(root: Path, rep: Report):
    common_p = root / "pipeline" / "common.py"
    if not common_p.exists():
        rep.add("gis", "common_py", "FAIL", f"Missing {common_p}")
        return None
    common = load_module(common_p, "cq_common")
    if not hasattr(common, "LON0") or not hasattr(common, "LAT0"):
        rep.add("gis", "origin_defined", "FAIL", "common.py missing LON0/LAT0")
        return common
    lon0, lat0 = float(common.LON0), float(common.LAT0)
    ref_lon, ref_lat, _ = WGS84_REF["jiefangbei"]
    gcj_lon, gcj_lat = wgs84_to_gcj02(ref_lon, ref_lat)
    d_wgs = haversine_m(lon0, lat0, ref_lon, ref_lat)
    d_gcj = haversine_m(lon0, lat0, gcj_lon, gcj_lat)

    if d_wgs < 200 and d_wgs < d_gcj:
        rep.add("gis", "origin_wgs84", "PASS",
                f"Origin ({lon0:.6f}, {lat0:.6f}) is genuine WGS-84 Jiefangbei (dist to WGS84 ref={d_wgs:.1f}m, vs GCJ-02={d_gcj:.1f}m)",
                {"lon0": lon0, "lat0": lat0, "dist_wgs84_m": round(d_wgs, 1), "dist_gcj02_m": round(d_gcj, 1)})
    elif d_gcj < d_wgs:
        rep.add("gis", "origin_wgs84", "FAIL",
                f"GCJ-02 CONTAMINATION DETECTED! Origin ({lon0:.6f}, {lat0:.6f}) is closer to GCJ-02 ({d_gcj:.1f}m) than WGS-84 ({d_wgs:.1f}m)!",
                {"lon0": lon0, "lat0": lat0, "dist_wgs84_m": round(d_wgs, 1), "dist_gcj02_m": round(d_gcj, 1)})
    else:
        rep.add("gis", "origin_wgs84", "WARN",
                f"Origin ({lon0:.6f}, {lat0:.6f}) is {d_wgs:.1f}m from Jiefangbei WGS-84 ref (GCJ-02 dist={d_gcj:.1f}m)",
                {"lon0": lon0, "lat0": lat0, "dist_wgs84_m": round(d_wgs, 1), "dist_gcj02_m": round(d_gcj, 1)})

    # Verify extent sanity
    extent_x = float(getattr(common, "X_MAX", 0) - getattr(common, "X_MIN", 0))
    extent_y = float(getattr(common, "Y_MAX", 0) - getattr(common, "Y_MIN", 0))
    if extent_x >= 18000 and extent_y >= 18000:
        rep.add("gis", "model_extent", "PASS", f"Extent {extent_x/1e3:.1f} x {extent_y/1e3:.1f} km, TILE={getattr(common, 'TILE', '?')}m")
    else:
        rep.add("gis", "model_extent", "WARN", f"Small model extent {extent_x/1e3:.1f} x {extent_y/1e3:.1f} km")
    return common


def extract_landmark_entries(lm_data):
    """Normalize landmarks.json (dict of objects, nested lists like bridges, or list of dicts) into (key, x, z, obj)."""
    out = []
    if isinstance(lm_data, list):
        for i, item in enumerate(lm_data):
            if isinstance(item, dict) and "x" in item and ("z" in item or "y" in item):
                out.append((item.get("id") or item.get("name") or f"lm_{i}", float(item["x"]), float(item.get("z", -item.get("y", 0))), item))
    elif isinstance(lm_data, dict):
        for k, v in lm_data.items():
            if isinstance(v, dict):
                if "x" in v and "z" in v:
                    out.append((k, float(v["x"]), float(v["z"]), v))
                elif "anchor" in v and isinstance(v["anchor"], dict) and "x" in v["anchor"]:
                    out.append((k, float(v["anchor"]["x"]), float(v["anchor"]["z"]), v))
                elif "north" in v and "south" in v:
                    for sub in ("north", "south"):
                        sv = v[sub]
                        if isinstance(sv, dict) and "x" in sv and "z" in sv:
                            out.append((f"{k}_{sub}", float(sv["x"]), float(sv["z"]), sv))
                else:
                    # nested dict of landmarks (e.g. bridges: {qiansimen: {...}})
                    for sk, sv in v.items():
                        if isinstance(sv, dict) and "x" in sv and "z" in sv:
                            out.append((f"{k}.{sk}", float(sv["x"]), float(sv["z"]), sv))
            elif isinstance(v, list):
                for idx, sv in enumerate(v):
                    if isinstance(sv, dict) and "x" in sv and "z" in sv:
                        nm = sv.get("id") or sv.get("key") or sv.get("name") or f"{k}_{idx}"
                        out.append((str(nm), float(sv["x"]), float(sv["z"]), sv))
    return out


def match_ref_key(name):
    s = name.lower()
    mapping = [
        ("jiefangbei", "jiefangbei"), ("解放碑", "jiefangbei"),
        ("hongya", "hongyadong"), ("洪崖洞", "hongyadong"),
        ("raffle", "raffles"), ("来福士", "raffles"),
        ("chaotianmen_br", "chaotianmen_br"), ("朝天门大桥", "chaotianmen_br"), ("朝天门长江", "chaotianmen_br"),
        ("chaotianmen", "chaotianmen"), ("朝天门", "chaotianmen"),
        ("guotai", "guotai"), ("国泰", "guotai"),
        ("wfc", "wfc"), ("环球金融", "wfc"),
        ("grand_theat", "grand_theatre"), ("theatre", "grand_theatre"), ("theater", "grand_theatre"), ("大剧院", "grand_theatre"),
        ("great_hall", "great_hall"), ("大礼堂", "great_hall"),
        ("science", "science_museum"), ("科技馆", "science_museum"),
        ("liziba", "liziba"), ("李子坝", "liziba"),
        ("cableway_north", "cableway_north"), ("north_station", "cableway_north"), ("新华路", "cableway_north"),
        ("cableway_south", "cableway_south"), ("south_station", "cableway_south"), ("上新街", "cableway_south"),
        ("qiansimen", "qiansimen"), ("千厮门", "qiansimen"),
        ("dongshuimen", "dongshuimen"), ("东水门", "dongshuimen"),
        ("caiyuanba", "caiyuanba"), ("菜园坝", "caiyuanba"),
        ("nanshan", "nanshan_onetree"), ("一棵树", "nanshan_onetree"),
        ("kuixing", "kuixinglou"), ("魁星楼", "kuixinglou"),
        ("baixiang", "baixiangju"), ("白象居", "baixiangju"),
        ("shibati", "shibati"), ("十八梯", "shibati"),
    ]
    for tok, rk in mapping:
        if tok in s:
            return rk
    return None


def audit_landmarks_wgs84(root: Path, common, terrain: TerrainSampler, rep: Report):
    lm_p = root / "site" / "data" / "landmarks.json"
    if not lm_p.exists():
        rep.add("landmarks", "exists", "FAIL", f"Missing {lm_p}")
        return []
    lm_data = json.loads(lm_p.read_text())
    entries = extract_landmark_entries(lm_data)
    if not entries:
        rep.add("landmarks", "entries", "FAIL", "landmarks.json has 0 coordinate entries")
        return []

    gcj_suspects = []
    far_errors = []
    checked = {}
    terrain_mismatches = []

    for key, x, z, obj in entries:
        # WebGL z = -y_north
        y_north = -z
        lon, lat = common.to_lonlat(x, y_north)
        lon, lat = float(lon), float(lat)
        rk = match_ref_key(key)
        if rk and rk in WGS84_REF:
            rlon, rlat, tol = WGS84_REF[rk]
            glon, glat = wgs84_to_gcj02(rlon, rlat)
            dw = haversine_m(lon, lat, rlon, rlat)
            dg = haversine_m(lon, lat, glon, glat)
            checked[key] = {"lon": round(lon, 6), "lat": round(lat, 6), "dist_wgs84_m": round(dw, 1), "dist_gcj02_m": round(dg, 1)}
            if dg + 80 < dw and dw > 250:
                gcj_suspects.append((key, round(dw, 1), round(dg, 1)))
            elif dw > tol:
                far_errors.append((key, rk, round(dw, 1), tol))
        # Check landmark terrain_y / baseY vs DEM if provided
        lm_ty = obj.get("terrain_y", obj.get("terrainY", obj.get("baseY", obj.get("base_y"))))
        if lm_ty is not None and terrain.grids:
            dem_y = terrain.sample_world_y(x, y_north)
            if math.isfinite(dem_y):
                diff = float(lm_ty) - dem_y
                if abs(diff) > 12.0 and "bridge" not in key.lower() and "qiansimen" not in key.lower() and "dongshuimen" not in key.lower():
                    terrain_mismatches.append((key, round(float(lm_ty), 2), round(dem_y, 2), round(diff, 2)))

    if gcj_suspects:
        rep.add("landmarks", "wgs84_alignment", "FAIL",
                f"GCJ-02 suspected on {len(gcj_suspects)} landmarks: {gcj_suspects[:6]}", {"suspects": gcj_suspects})
    elif far_errors:
        rep.add("landmarks", "wgs84_alignment", "WARN",
                f"{len(far_errors)} landmarks exceed ref tolerance: {far_errors[:6]}", {"far": far_errors, "checked_count": len(checked)})
    else:
        rep.add("landmarks", "wgs84_alignment", "PASS",
                f"All {len(checked)} matched landmarks align with true WGS-84 (total entries={len(entries)})", {"checked": checked})

    if terrain_mismatches:
        rep.add("landmarks", "terrain_y_match", "WARN",
                f"{len(terrain_mismatches)} landmarks have baseY/terrain_y >12m from DEM: {terrain_mismatches[:6]}",
                {"mismatches": terrain_mismatches})
    elif terrain.grids:
        rep.add("landmarks", "terrain_y_match", "PASS", "All landmark baseY/terrain_y values match DEM within 12m")

    # Cross-check bridges against OSM water polygons if work/osm_water.parquet exists
    water_p = root / "data" / "work" / "osm_water.parquet"
    if water_p.exists() and gpd is not None and shapely is not None:
        try:
            wg = gpd.read_parquet(water_p, columns=["geometry"])
            wproj = common.project_geoms(wg.geometry.values)
            wtree = shapely.STRtree(wproj)
            bridge_checks = {}
            bad_br = []
            for key, x, z, obj in entries:
                if any(b in key.lower() for b in ("qiansimen", "dongshuimen", "chaotianmen_br", "caiyuanba", "shibanpo", "jialing", "yuao")):
                    pt = Point(x, -z)
                    hits = wtree.query(pt.buffer(80.0), predicate="intersects")
                    on_water = len(hits) > 0
                    bridge_checks[key] = on_water
                    if not on_water:
                        bad_br.append(key)
            if bridge_checks:
                if bad_br:
                    rep.add("landmarks", "bridges_over_osm_water", "FAIL",
                            f"Bridges not intersecting OSM water (within 80m): {bad_br}", bridge_checks)
                else:
                    rep.add("landmarks", "bridges_over_osm_water", "PASS",
                            f"All {len(bridge_checks)} river bridges align over OSM water polygons", bridge_checks)
        except Exception as e:
            rep.add("landmarks", "bridges_over_osm_water", "WARN", f"Could not cross-check OSM water: {e}")

    return entries


def audit_dem_terrain(root: Path, common, terrain: TerrainSampler, rep: Report):
    if not terrain.grids:
        rep.add("dem", "load", "FAIL", f"No terrain.json / terrain binary found in {root / 'site' / 'data'}")
        return

    for gname, g in terrain.grids.items():
        arr = g["arr"]
        n_nan = int(np.isnan(arr).sum() + np.isinf(arr).sum())
        if n_nan > 0:
            rep.add("dem", f"{gname}_finite", "FAIL", f"{gname} grid has {n_nan} NaN/Inf cells!")
        else:
            zmin, zmax, zmed = float(arr.min()), float(arr.max()), float(np.median(arr))
            rep.add("dem", f"{gname}_finite", "PASS",
                    f"{gname} {g['nx']}x{g['ny']} (cell={g['cell']}m) finite: range [{zmin:.1f}, {zmax:.1f}]m (median {zmed:.1f}m)",
                    {"nx": g["nx"], "ny": g["ny"], "cell": g["cell"], "min": round(zmin, 2), "max": round(zmax, 2), "median": round(zmed, 2)})

        # Spike & cliff detection
        if ndimage is not None and arr.size > 16:
            med3 = ndimage.median_filter(arr, size=3)
            resid = np.abs(arr - med3)
            max_spike = float(resid.max())
            n_spikes = int((resid > 25.0).sum())
            dy = np.abs(np.diff(arr, axis=0))
            dx = np.abs(np.diff(arr, axis=1))
            max_step = float(max(dx.max(), dy.max()))
            p999_step = float(max(np.percentile(dx, 99.9), np.percentile(dy, 99.9)))

            # Check for tile-seam discontinuities (steps along 1000m boundaries vs neighbors)
            step_cells = int(round(1000.0 / g["cell"])) if g["cell"] > 0 else 0
            seam_ratio = 1.0
            if step_cells >= 4 and g["nx"] > step_cells * 2 and g["ny"] > step_cells * 2:
                # offset to 1000m grid lines
                ox_mod = int(round((-g["x0"] % 1000.0) / g["cell"])) % step_cells
                oy_mod = int(round((-g["y0"] % 1000.0) / g["cell"])) % step_cells
                seam_cols = dx[:, ox_mod::step_cells]
                seam_rows = dy[oy_mod::step_cells, :]
                seam_mean = float(max(seam_cols.mean() if seam_cols.size else 0, seam_rows.mean() if seam_rows.size else 0))
                all_mean = float(0.5 * (dx.mean() + dy.mean()) + 1e-6)
                seam_ratio = seam_mean / all_mean

            # Scale spike threshold sensibly with grid cell size (100m mountain ridges naturally vary >25m across 100m!)
            spike_thr = 35.0 if g["cell"] <= 20 else 90.0
            n_spikes = int((resid > spike_thr).sum())
            status = "PASS"
            if n_spikes > 25 or max_spike > spike_thr * 2.5 or seam_ratio > 2.2:
                status = "FAIL"
            elif n_spikes > 0 or seam_ratio > 1.6:
                status = "WARN"
            rep.add("dem", f"{gname}_spikes_seams", status,
                    f"max 3x3 spike={max_spike:.1f}m (cells>{spike_thr:.0f}m: {n_spikes}), max step={max_step:.1f}m (p99.9={p999_step:.1f}m), 1km-seam ratio={seam_ratio:.2f}",
                    {"max_spike": round(max_spike, 2), "n_spikes": n_spikes, "max_step": round(max_step, 2), "seam_ratio": round(seam_ratio, 3)})

    # Direct OSM Yangtze & Jialing river-channel flatness check (fine + core if present)
    tr_p = root / "data" / "work" / "two_rivers.json"
    if tr_p.exists() and shapely is not None:
        try:
            tr = shapely.from_wkt(json.loads(tr_p.read_text()))
            tr_inner = tr.buffer(-25.0)
            for gname in ("fine", "core"):
                if gname not in terrain.grids:
                    continue
                fg = terrain.grids[gname]
                b = tr.bounds
                step = 50.0 if gname == "core" else 100.0
                xs = np.arange(max(b[0], fg["x0"] + 50), min(b[2], fg["x0"] + fg["nx"] * fg["cell"] - 50), step)
                ys = np.arange(max(b[1], fg["y0"] + 50), min(b[3], fg["y0"] + fg["ny"] * fg["cell"] - 50), step)
                if not len(xs) or not len(ys):
                    continue
                X, Y = np.meshgrid(xs, ys)
                P = shapely.points(X.ravel(), Y.ravel())
                m = shapely.contains(tr_inner, P)
                vals = np.array([terrain.sample_world_y(float(x), float(y), gname) for x, y in zip(X.ravel()[m], Y.ravel()[m])])
                if len(vals):
                    asls = np.array([terrain.to_asl(v) for v in vals])
                    above = int((vals > 0.5).sum())
                    st = "PASS" if above == 0 and float(vals.std()) < 1.0 else ("WARN" if above < 10 else "FAIL")
                    rep.add("dem", f"two_rivers_carving_{gname}", st,
                            f"OSM Yangtze+Jialing interior ({gname}, {len(vals)} pts): worldY [{vals.min():.2f}, {vals.max():.2f}]m (ASL {asls.mean():.1f}m, >0.5m: {above})")
        except Exception as e:
            rep.add("dem", "two_rivers_carving", "WARN", f"Could not check two_rivers.json: {e}")

    # Elevation realism probes
    if common is not None:
        probe_res = {}
        bad_probes = []
        river_vals = []
        cliff_top = cliff_bot = None
        for pname, lon, lat, lo, hi, cat in DEM_PROBES:
            x, y = common.to_local(lon, lat)
            wy = terrain.sample_world_y(float(x), float(y))
            if not math.isfinite(wy):
                probe_res[pname] = "OUT_OF_BOUNDS"
                continue
            asl = terrain.to_asl(wy)
            probe_res[pname] = {"world_y": round(wy, 2), "asl": round(asl, 2), "expected": [lo, hi]}
            if cat == "river":
                river_vals.append((pname, asl, wy))
            if cat == "cliff_top":
                cliff_top = asl
            if cat == "cliff_bot":
                cliff_bot = asl
            if not (lo <= asl <= hi):
                bad_probes.append((pname, round(asl, 1), f"[{lo},{hi}]"))

        if bad_probes:
            rep.add("dem", "elevation_probes", "FAIL" if len(bad_probes) >= 3 else "WARN",
                    f"{len(bad_probes)} probes outside realistic Chongqing ASL bounds: {bad_probes}", probe_res)
        else:
            rep.add("dem", "elevation_probes", "PASS",
                    f"All {len(probe_res)} Chongqing elevation probes realistic (rivers, Yuzhong ridge, Nanshan)", probe_res)

        if river_vals:
            asls = [v[1] for v in river_vals]
            rng = max(asls) - min(asls)
            std = float(np.std(asls))
            st = "PASS" if rng <= 14.0 and std <= 5.0 else ("WARN" if rng <= 22.0 else "FAIL")
            rep.add("dem", "river_consistency", st,
                    f"River probes ASL min={min(asls):.1f}m max={max(asls):.1f}m spread={rng:.1f}m std={std:.2f}m",
                    {"samples": {n: round(a, 2) for n, a, _ in river_vals}})

        if cliff_top is not None and cliff_bot is not None:
            drop = cliff_top - cliff_bot
            st = "PASS" if drop >= 22.0 else ("WARN" if drop >= 12.0 else "FAIL")
            rep.add("dem", "hongyadong_cliff_drop", st,
                    f"Hongyadong cliff drop Cangbai({cliff_top:.1f}m) -> Binjiang({cliff_bot:.1f}m) = {drop:.1f}m")

    # Core vs Fine consistency & outer-border seam check (Phase 4 2.5m road-benched core DEM)
    if "core" in terrain.grids and "fine" in terrain.grids:
        cg = terrain.grids["core"]
        x0, x1 = cg["x0"], cg["x0"] + cg["nx"] * cg["cell"]
        y0, y1 = cg["y0"], cg["y0"] + cg["ny"] * cg["cell"]
        xs = np.linspace(x0 + 50, x1 - 50, 45)
        ys = np.linspace(y0 + 50, y1 - 50, 45)
        diffs = []
        for x in xs:
            for y in ys:
                vc = terrain.sample_world_y(float(x), float(y), "core")
                vf = terrain.sample_world_y(float(x), float(y), "fine")
                if math.isfinite(vc) and math.isfinite(vf):
                    diffs.append(abs(vc - vf))
        # Also sample right along the 4 edges of core (5m inside boundary) to ensure zero seam cliff!
        b_diffs = []
        for bx in np.linspace(x0 + 10, x1 - 10, 60):
            for by in (y0 + 5.0, y1 - 5.0):
                vc = terrain.sample_world_y(float(bx), float(by), "core")
                vf = terrain.sample_world_y(float(bx), float(by), "fine")
                if math.isfinite(vc) and math.isfinite(vf):
                    b_diffs.append(abs(vc - vf))
        for by in np.linspace(y0 + 10, y1 - 10, 60):
            for bx in (x0 + 5.0, x1 - 5.0):
                vc = terrain.sample_world_y(float(bx), float(by), "core")
                vf = terrain.sample_world_y(float(bx), float(by), "fine")
                if math.isfinite(vc) and math.isfinite(vf):
                    b_diffs.append(abs(vc - vf))
        if diffs:
            p95 = float(np.percentile(diffs, 95))
            bp95 = float(np.percentile(b_diffs, 95)) if b_diffs else 0.0
            bmax = float(max(b_diffs)) if b_diffs else 0.0
            st = "PASS" if (p95 < 12.0 and bp95 < 2.5) else ("WARN" if bp95 < 6.0 else "FAIL")
            rep.add("dem", "core_fine_seam", st,
                    f"Core(2.5m) vs Fine(10m): interior med={float(np.median(diffs)):.2f}m p95={p95:.2f}m | border seam p95={bp95:.2f}m max={bmax:.2f}m")

    # Fine vs Coarse seam consistency check
    if "fine" in terrain.grids and "coarse" in terrain.grids:
        fg, cg = terrain.grids["fine"], terrain.grids["coarse"]
        xs = np.linspace(fg["x0"] + 200, fg["x0"] + fg["nx"] * fg["cell"] - 200, 40)
        ys = np.linspace(fg["y0"] + 200, fg["y0"] + fg["ny"] * fg["cell"] - 200, 40)
        diffs = []
        for x in xs:
            for y in ys:
                vf = terrain.sample_world_y(float(x), float(y), "fine")
                vc = terrain.sample_world_y(float(x), float(y), "coarse")
                if math.isfinite(vf) and math.isfinite(vc):
                    diffs.append(abs(vf - vc))
        if diffs:
            p95 = float(np.percentile(diffs, 95))
            dmax = float(max(diffs))
            st = "PASS" if p95 < 25.0 else ("WARN" if p95 < 45.0 else "FAIL")
            rep.add("dem", "fine_coarse_consistency", st,
                    f"Fine vs Coarse DEM diff: median={float(np.median(diffs)):.1f}m, p95={p95:.1f}m, max={dmax:.1f}m")


def decode_tile_buildings(raw_bytes, ox, oy):
    """Decode tile binary container (CQT1/CQT2/SHT1) and extract section 1 (buildings) flexibly."""
    if raw_bytes[:2] == b"\x1f\x8b":
        raw_bytes = gzip.decompress(raw_bytes)
    magic = raw_bytes[:4]
    if magic not in (b"SHT1", b"CQT1", b"CQT2"):
        raise ValueError(f"Unknown tile magic {magic!r}")
    nsec = struct.unpack_from("<I", raw_bytes, 4)[0]
    sections = {}
    for k in range(nsec):
        sid, off, ln = struct.unpack_from("<III", raw_bytes, 8 + 12 * k)
        if off + ln > len(raw_bytes):
            raise ValueError(f"Section {sid} out of bounds: {off}+{ln} > {len(raw_bytes)}")
        sections[sid] = raw_bytes[off:off + ln]
    return magic.decode("ascii"), sections


def parse_buildings_section(buf, ox, oy, tilefmt_mod=None):
    """Parse building section v2 (CQT2) or v1 (SHT1). Prefers tilefmt.decode_buildings if present."""
    if tilefmt_mod is not None and hasattr(tilefmt_mod, "decode_buildings"):
        return tilefmt_mod.decode_buildings(buf, ox, oy)
    if len(buf) < 12:
        return None
    nb, nr, nv = struct.unpack_from("<III", buf, 0)
    if nb == 0:
        return dict(nb=0, nr=0, nv=0, version=2, rings=[], height=np.zeros(0), ground_z_min=np.zeros(0), ground_z_max=np.zeros(0))

    def pad4(n):
        return (n + 3) & ~3

    # Exact CQT2 Building Section v2 layout (locked in tilefmt.py):
    # 12 + u16 height[nb] + u16 base[nb] + i16 ground_z_min[nb] + i16 ground_z_max[nb]
    # + pad4(10 * nb) + pad4(2 * nr) + 4 * nv + pad4(nv)
    v2_sz = 12 + 8 * nb + pad4(10 * nb) + pad4(2 * nr) + 4 * nv + pad4(nv)
    if abs(len(buf) - v2_sz) <= 4:
        o = 12
        h = np.frombuffer(buf, "<u2", nb, o).astype(np.float32) * 0.1; o += 2 * nb
        base = np.frombuffer(buf, "<u2", nb, o).astype(np.float32) * 0.1; o += 2 * nb
        gzmin = np.frombuffer(buf, "<i2", nb, o).astype(np.float32) * 0.1; o += 2 * nb
        gzmax = np.frombuffer(buf, "<i2", nb, o).astype(np.float32) * 0.1; o += 2 * nb
        u8_off = o
        levels = np.frombuffer(buf, np.uint8, nb, u8_off + 0 * nb)
        style = np.frombuffer(buf, np.uint8, nb, u8_off + 1 * nb)
        roof = np.frombuffer(buf, np.uint8, nb, u8_off + 2 * nb)
        nrings = np.frombuffer(buf, np.uint8, nb, u8_off + 6 * nb)
        podium_h = np.frombuffer(buf, np.uint8, nb, u8_off + 7 * nb).astype(np.float32) * 0.25
        balcony_mask = np.frombuffer(buf, np.uint8, nb, u8_off + 8 * nb)
        subtype = np.frombuffer(buf, np.uint8, nb, u8_off + 9 * nb)
        o += pad4(10 * nb)
        rs = np.frombuffer(buf, "<u2", nr, o); o += pad4(2 * nr)
        xy = np.frombuffer(buf, "<i2", nv * 2, o).reshape(-1, 2).astype(np.float64)
        rings, holes = _reconstruct_rings_and_holes(nrings, rs, xy, ox, oy)
        return dict(
            nb=nb, nr=nr, nv=nv, version=2,
            height=h, base=base, ground_z_min=gzmin, ground_z_max=gzmax,
            levels=levels, style=style, roof=roof, podium_h=podium_h,
            balcony_mask=balcony_mask, subtype=subtype, rings=rings, holes=holes,
        )

    # V1 fallback (shanghai_3d):
    v1_sz = 12 + 4 * nb + pad4(7 * nb) + pad4(2 * nr) + 4 * nv + pad4(nv)
    if abs(len(buf) - v1_sz) <= 4:
        o = 12
        h = np.frombuffer(buf, "<u2", nb, o).astype(np.float32) * 0.1; o += 2 * nb
        base = np.frombuffer(buf, "<u2", nb, o).astype(np.float32) * 0.1; o += 2 * nb
        nrings = np.frombuffer(buf, np.uint8, nb, 12 + 4 * nb + 6 * nb)
        o += pad4(7 * nb)
        rs = np.frombuffer(buf, "<u2", nr, o); o += pad4(2 * nr)
        xy = np.frombuffer(buf, "<i2", nv * 2, o).reshape(-1, 2).astype(np.float64)
        rings = _reconstruct_rings(nrings, rs, xy, ox, oy)
        return dict(nb=nb, nr=nr, nv=nv, version=1, height=h, base=base, ground_z_min=None, ground_z_max=None, rings=rings)

    return dict(nb=nb, nr=nr, nv=nv, version="unknown", byte_len=len(buf), v2_expected=v2_sz, v1_expected=v1_sz, rings=[])


def _reconstruct_rings_and_holes(nrings, ringsizes, xy_deltas, ox, oy):
    """Reconstruct outer ring + interior courtyard holes per building in pipeline (x, y_north) metres."""
    out = []
    holes = []
    ri = 0
    vi = 0
    for k in range(len(nrings)):
        m = int(nrings[k])
        prev = np.zeros(2, np.float64)
        outer = None
        hlist = []
        for r in range(m):
            cnt = int(ringsizes[ri]); ri += 1
            pts = np.cumsum(xy_deltas[vi:vi + cnt], axis=0) + prev
            prev = pts[-1] if cnt else prev
            vi += cnt
            if r == 0:
                outer = pts * 0.1 + (ox, oy)
            elif cnt >= 3:
                hlist.append(pts * 0.1 + (ox, oy))
        out.append(outer)
        holes.append(hlist)
    return out, holes


def _reconstruct_rings(nrings, ringsizes, xy_deltas, ox, oy):
    return _reconstruct_rings_and_holes(nrings, ringsizes, xy_deltas, ox, oy)[0]


def audit_tiles_and_exclusions(root: Path, common, terrain: TerrainSampler, lm_entries, rep: Report, max_tiles: int):
    grid_p = root / "site" / "data" / "city.json"
    if not grid_p.exists():
        grid_p = root / "site" / "data" / "grid.json"
    if not grid_p.exists():
        rep.add("tiles", "city_json", "FAIL", f"Missing city.json / grid.json under {root / 'site' / 'data'}")
        return
    manifest = json.loads(grid_p.read_text())
    grid = manifest.get("grid", manifest)
    x0 = float(grid.get("x0", getattr(common, "GRID_X0", -14000)))
    y0 = float(grid.get("y0", getattr(common, "GRID_Y0", -10000)))
    tile_sz = float(grid.get("tile", getattr(common, "TILE", 1000)))

    # Locate tile directory
    tdir = None
    for cand in ("tiles", "t", "tile"):
        p = root / "site" / "data" / cand
        if p.is_dir():
            tdir = p; break
    if tdir is None:
        rep.add("tiles", "tile_dir", "FAIL", "No tile directory under site/data/")
        return

    tile_files = sorted([p for p in tdir.iterdir() if p.is_file() and (p.suffix in (".bin", ".gz") or "_" in p.stem)])
    if not tile_files:
        rep.add("tiles", "tile_files", "FAIL", f"0 tile files found in {tdir}")
        return

    tilefmt = load_module(root / "pipeline" / "tilefmt.py", "cq_tilefmt") if (root / "pipeline" / "tilefmt.py").exists() else None
    if max_tiles > 0:
        tile_files = tile_files[:max_tiles]

    corrupt = []
    total_buildings = 0
    missing_gz = 0
    invalid_gz = 0
    bad_style_roof = 0
    floating_gz = []
    magics = set()
    sec_counts = {}
    all_b_polys = []
    elev_decks = []  # (LineString_buf, deck_y_mid, wx, wz, src)

    # Load exclusion polygons (exact format: {osm_ids, circles:[{x,y,r,name}], polygons:[[[x,y],...]]})
    excl_polys = []
    excl_p = root / "pipeline" / "landmark_exclusions.json"
    if excl_p.exists() and shapely is not None:
        ex_raw = json.loads(excl_p.read_text())
        if isinstance(ex_raw, dict):
            for c in ex_raw.get("circles", []):
                if isinstance(c, dict) and "x" in c and "y" in c:
                    excl_polys.append((str(c.get("name", "circle")), Point(float(c["x"]), float(c["y"])).buffer(float(c.get("r", 30)))))
            for idx, ring in enumerate(ex_raw.get("polygons", [])):
                arr = np.asarray(ring, float)
                if arr.ndim == 2 and len(arr) >= 3:
                    p = Polygon(arr[:, :2])
                    if not p.is_empty:
                        excl_polys.append((f"polygon_{idx}", p))

    for tf in tile_files:
        stem = tf.name.split(".")[0]
        parts = stem.split("_")
        if len(parts) < 2:
            continue
        try:
            ti, tj = int(parts[0]), int(parts[1])
        except ValueError:
            continue
        ox, oy = x0 + ti * tile_sz, y0 + tj * tile_sz
        try:
            magic, secs = decode_tile_buildings(tf.read_bytes(), ox, oy)
            magics.add(magic)
            for sid in secs:
                sec_counts[sid] = sec_counts.get(sid, 0) + 1
            if 1 in secs:
                binfo = parse_buildings_section(secs[1], ox, oy, tilefmt)
                if binfo:
                    nb = int(binfo["nb"])
                    total_buildings += nb
                    gzmin = binfo.get("ground_z_min")
                    gzmax = binfo.get("ground_z_max")
                    rings = binfo.get("rings") or []
                    if nb > 0 and (gzmin is None or gzmax is None):
                        missing_gz += nb
                    elif nb > 0:
                        gzmin = np.asarray(gzmin, float)
                        gzmax = np.asarray(gzmax, float)
                        bad_order = (~np.isfinite(gzmin)) | (~np.isfinite(gzmax)) | (gzmin > gzmax + 0.25)
                        invalid_gz += int(bad_order.sum())
                        if terrain.grids and rings:
                            # Sample DEM at centroid of a subset / all buildings to detect floating ground_z_min
                            step_k = max(1, nb // 80)
                            for k in range(0, min(nb, len(rings)), step_k):
                                ring = rings[k]
                                if ring is None or len(ring) < 3:
                                    continue
                                cx, cy = float(ring[:, 0].mean()), float(ring[:, 1].mean())
                                dem_y = terrain.sample_world_y(cx, cy)
                                if math.isfinite(dem_y):
                                    # Also check min corner terrain
                                    c_ys = [terrain.sample_world_y(float(p[0]), float(p[1])) for p in ring[::max(1, len(ring)//8)]]
                                    c_ys = [v for v in c_ys if math.isfinite(v)]
                                    dem_min = min(c_ys) if c_ys else dem_y
                                    if gzmin[k] - dem_min > 4.0:
                                        floating_gz.append((tf.name, int(k), round(cx, 1), round(-cy, 1), round(float(gzmin[k]), 1), round(dem_min, 1)))
                    if shapely is not None and rings and excl_polys:
                        for k_r, ring in enumerate(rings):
                            if ring is not None and len(ring) >= 3:
                                all_b_polys.append((Polygon(ring), float(binfo["height"][k_r]), float(binfo["ground_z_max"][k_r]) if gzmax is not None else 0.0, float(binfo["ground_z_min"][k_r]) if gzmin is not None else 0.0, f"tile:{tf.name}"))
            # Collect elevated viaduct decks (section 9, cl >= 2.5m) for building-vs-viaduct clip audit!
            if 9 in secs and shapely is not None and terrain.grids:
                dbuf = secs[9]
                dnl, dnv, dna = struct.unpack_from("<III", dbuf, 0)
                if dnl > 0 and dnv >= 2:
                    do = 12
                    dwid = np.frombuffer(dbuf, np.uint8, dnl, do + dnl)
                    do += ((dna * dnl) + 3) & ~3
                    dnpts = np.frombuffer(dbuf, "<u2", dnl, do)
                    do += ((dnl * 2) + 3) & ~3
                    dxy = np.frombuffer(dbuf, "<i2", dnv * 2, do).reshape(-1, 2).astype(np.float64)
                    do += dnv * 4
                    dzz = np.frombuffer(dbuf, np.uint8, dnv, do).astype(np.float64) * 0.25
                    dvi = 0
                    for dl in range(dnl):
                        dm = int(dnpts[dl])
                        dw = float(dwid[dl]) / 4.0
                        dp = np.cumsum(dxy[dvi:dvi + dm], axis=0) * 0.1 + (ox, oy)
                        dcl = dzz[dvi:dvi + dm]
                        dvi += dm
                        if dm < 2 or dw < 4.0 or float(dcl.max()) < 3.0:
                            continue
                        # Split into segments with cl >= 3.0m
                        for ds in range(dm - 1):
                            mcl = 0.5 * (dcl[ds] + dcl[ds + 1])
                            if mcl < 3.0:
                                continue
                            mx = 0.5 * (dp[ds, 0] + dp[ds + 1, 0])
                            my = 0.5 * (dp[ds, 1] + dp[ds + 1, 1])
                            if not (-6500 <= mx <= 5000 and -4000 <= my <= 4500):
                                continue  # audit core extent decks
                            ty = terrain.sample_world_y(mx, my)
                            if not math.isfinite(ty):
                                continue
                            seg = shapely.LineString([(dp[ds, 0], dp[ds, 1]), (dp[ds + 1, 0], dp[ds + 1, 1])])
                            if seg.length < 1.0:
                                continue
                            elev_decks.append((seg.buffer(max(2.0, dw * 0.42), cap_style=2, quad_segs=2), max(ty, 0.0) + mcl, round(mx, 1), round(-my, 1), tf.name))
        except Exception as e:
            corrupt.append((tf.name, str(e)))

    # Also decode ALL far_*.bin packs (base & mass buildings!) so tall skyscrapers are audited for ground_z & exclusions!
    far_files = manifest.get("farFiles", [])
    far_bufs = []
    for ff in far_files:
        fp = root / "site" / "data" / ff["name"]
        if fp.exists():
            raw_f = fp.read_bytes()
            far_bufs.append(gzip.decompress(raw_f) if raw_f[:2] == b"\x1f\x8b" else raw_f)
        else:
            corrupt.append((ff["name"], "missing farFile"))
            far_bufs.append(b"")
    far_buildings = 0
    for te in manifest.get("tiles", []):
        if "f" not in te or te["f"] >= len(far_bufs):
            continue
        ox, oy = x0 + te["i"] * tile_sz, y0 + te["j"] * tile_sz
        raw_t = far_bufs[te["f"]][te["o"]:te["o"] + te["l"]]
        try:
            magic, secs = decode_tile_buildings(raw_t, ox, oy)
            magics.add(magic)
            for sid in (1, 10):
                if sid not in secs:
                    continue
                binfo = parse_buildings_section(secs[sid], ox, oy, tilefmt)
                if binfo:
                    nb = int(binfo["nb"])
                    if sid == 1:
                        far_buildings += nb
                        total_buildings += nb
                    gzmin = binfo.get("ground_z_min")
                    gzmax = binfo.get("ground_z_max")
                    rings = binfo.get("rings") or []
                    if nb > 0 and (gzmin is None or gzmax is None):
                        missing_gz += nb
                    elif nb > 0:
                        gzmin = np.asarray(gzmin, float)
                        gzmax = np.asarray(gzmax, float)
                        invalid_gz += int(((~np.isfinite(gzmin)) | (~np.isfinite(gzmax)) | (gzmin > gzmax + 0.25)).sum())
                    if shapely is not None and rings:
                        for k_r, ring in enumerate(rings):
                            if ring is not None and len(ring) >= 3:
                                all_b_polys.append((Polygon(ring), float(binfo["height"][k_r]), float(binfo["ground_z_max"][k_r]) if gzmax is not None else 0.0, float(binfo["ground_z_min"][k_r]) if gzmin is not None else 0.0, f"far:{te['i']}_{te['j']}:s{sid}"))
        except Exception as e:
            corrupt.append((f"far_{te['i']}_{te['j']}", str(e)))

    if corrupt:
        rep.add("tiles", "integrity", "FAIL", f"{len(corrupt)} tiles/far packs failed decode: {corrupt[:5]}")
    else:
        rep.add("tiles", "integrity", "PASS",
                f"Decoded {len(tile_files)} detail tiles + {len(far_files)} far packs cleanly (magics={sorted(magics)}, total_buildings={total_buildings} [far_base={far_buildings}], sections={sec_counts})",
                {"tiles": len(tile_files), "far_files": len(far_files), "buildings": total_buildings, "far_base": far_buildings, "sections": sec_counts})

    if total_buildings > 0:
        if missing_gz > 0:
            rep.add("tiles", "building_ground_z", "WARN" if missing_gz < total_buildings else "FAIL",
                    f"{missing_gz}/{total_buildings} buildings missing decoded ground_z_min/ground_z_max")
        elif invalid_gz > 0 or len(floating_gz) > max(5, total_buildings * 0.002):
            rep.add("tiles", "building_ground_z", "FAIL",
                    f"invalid_gz={invalid_gz}, buildings with ground_z_min > DEM_min+4m: {len(floating_gz)} (examples: {floating_gz[:5]})",
                    {"invalid_gz": invalid_gz, "floating_samples": floating_gz[:10]})
        else:
            rep.add("tiles", "building_ground_z", "PASS",
                    f"All {total_buildings} buildings carry valid ground_z_min/max (floating anomalies={len(floating_gz)})")

    # Exclusion overlap audit (checks BOTH detail tiles AND far_*.bin skyscrapers!)
    if not excl_p.exists():
        rep.add("tiles", "landmark_exclusions_file", "FAIL", f"Missing {excl_p}")
    else:
        rep.add("tiles", "landmark_exclusions_file", "PASS", f"Loaded {len(excl_polys)} exclusion zones from landmark_exclusions.json")
        if excl_polys and all_b_polys and shapely is not None:
            geom_arr = [bp[0] for bp in all_b_polys]
            btree = shapely.STRtree(geom_arr)
            leaks = {}
            leak_examples = []
            for nm, ep in excl_polys:
                hits = btree.query(ep, predicate="intersects")
                bad_cnt = 0
                for hi in hits:
                    p, bh, gz, gz0, src = all_b_polys[hi]
                    inter = p.intersection(ep)
                    if inter.area > 12.0:
                        bad_cnt += 1
                        if len(leak_examples) < 15:
                            c = p.centroid
                            leak_examples.append({"zone": nm, "src": src, "h": round(bh, 1), "inter_m2": round(inter.area), "centroid": [round(c.x, 1), round(c.y, 1)]})
                if bad_cnt > 0:
                    leaks[nm] = bad_cnt
            if leaks:
                rep.add("tiles", "landmark_exclusion_clean", "FAIL",
                        f"Procedural buildings (detail+far) intersect {len(leaks)} landmark exclusion zones: {leaks}",
                        {"counts": leaks, "examples": leak_examples})
            else:
                rep.add("tiles", "landmark_exclusion_clean", "PASS",
                        f"0 procedural buildings (detail+far) intrude (>12m2) into {len(excl_polys)} landmark exclusion zones")

            # Also check hero bridge deck corridors for tall building collisions
            lm_p = root / "site" / "data" / "landmarks.json"
            if lm_p.exists():
                lm_raw = json.loads(lm_p.read_text())
                br_leaks = {}
                for b in lm_raw.get("bridges", []):
                    cl = b.get("centerline")
                    if not cl or len(cl) < 2:
                        continue
                    bg = shapely.LineString([(p[0], -p[1]) for p in cl]).buffer(max(6.0, float(b.get("width", 20.0)) * 0.45))
                    dy = float(b.get("deckY", 50.0))
                    hits = btree.query(bg, predicate="intersects")
                    cnt = 0
                    for hi in hits:
                        p, bh, gz, gz0, src = all_b_polys[hi]
                        if gz + bh > dy - 4.0 and p.intersection(bg).area > 20.0:
                            cnt += 1
                    if cnt > 0:
                        br_leaks[b["id"]] = cnt
                if br_leaks:
                    rep.add("tiles", "bridge_corridor_clean", "FAIL",
                            f"Tall buildings clip into hero bridge corridors: {br_leaks}", br_leaks)
                else:
                    rep.add("tiles", "bridge_corridor_clean", "PASS",
                            "0 tall procedural buildings clip into hero bridge deck corridors")

            # Also check core elevated viaduct decks (SEC.bridges cl >= 3m) for building intrusions (e.g. q06!)
            if elev_decks:
                v_hit_b = set()
                v_ex = []
                for dg, dy, wx, wz, dsrc in elev_decks:
                    hits = btree.query(dg, predicate="intersects")
                    for hi in hits:
                        if hi in v_hit_b:
                            continue
                        p, bh, gz, gz0, bsrc = all_b_polys[hi]
                        if gz + bh > dy - 1.0 and gz0 < dy + 4.0 and p.intersection(dg).area > 12.0:
                            v_hit_b.add(hi)
                            if len(v_ex) < 12:
                                v_ex.append({"x": wx, "z": wz, "deckY": round(dy, 1), "bTop": round(gz + bh, 1), "bSrc": bsrc})
                st = "PASS" if len(v_hit_b) == 0 else ("WARN" if len(v_hit_b) <= 5 else "FAIL")
                rep.add("tiles", "elevated_viaduct_building_clean", st,
                        f"{len(v_hit_b)} procedural buildings intersect core elevated viaduct decks (cl>=3m, >12m2)",
                        {"count": len(v_hit_b), "examples": v_ex})


def audit_tunnels_json(root: Path, terrain: TerrainSampler, rep: Report):
    tp = root / "site" / "data" / "tunnels.json"
    if not tp.exists():
        st = "FAIL" if "core" in terrain.grids else "SKIP"
        rep.add("tunnels", "tunnels_json", st, f"Missing {tp}")
        return
    try:
        data = json.loads(tp.read_text())
    except Exception as e:
        rep.add("tunnels", "tunnels_json", "FAIL", f"Invalid JSON in {tp}: {e}")
        return
    if not isinstance(data, list) or len(data) == 0:
        rep.add("tunnels", "tunnels_json", "FAIL", f"tunnels.json is empty or not a list (type={type(data).__name__})")
        return
    bad_fields = 0
    bad_dir = 0
    bad_y = []
    for idx, p in enumerate(data):
        if not isinstance(p, dict):
            bad_fields += 1; continue
        vals = [p.get(k) for k in ("x", "z", "y", "dx", "dz", "width")]
        if any(v is None or not math.isfinite(float(v)) for v in vals):
            bad_fields += 1; continue
        x, z, y, dx, dz, w = [float(v) for v in vals]
        dlen = math.hypot(dx, dz)
        if not (0.8 <= dlen <= 1.2) or not (2.0 <= w <= 50.0):
            bad_dir += 1
        if terrain.grids:
            dy = terrain.sample_world_y(x, -z)
            if math.isfinite(dy) and abs(y - dy) > 18.0:
                bad_y.append((idx, round(x, 1), round(z, 1), round(y, 1), round(dy, 1)))
    if bad_fields > 0 or bad_dir > 0:
        rep.add("tunnels", "tunnels_json", "FAIL",
                f"tunnels.json ({len(data)} portals): bad_fields={bad_fields}, bad_dir/width={bad_dir}, far_from_dem={len(bad_y)}")
    elif len(bad_y) > max(5, len(data) * 0.05):
        rep.add("tunnels", "tunnels_json", "WARN",
                f"tunnels.json ({len(data)} portals): {len(bad_y)} portals >18m from DEM (examples: {bad_y[:5]})")
    else:
        rep.add("tunnels", "tunnels_json", "PASS",
                f"tunnels.json valid: {len(data)} portals (finite, unit dirs, width ok, far_from_dem={len(bad_y)})",
                {"count": len(data), "far_from_dem": len(bad_y)})


def audit_pipeline_38(root: Path, rep: Report):
    ap = root / "data" / "work" / "audit.json"
    if not ap.exists():
        rep.add("pipeline_audit", "audit_json", "SKIP", f"{ap} not generated yet (38_audit.py)")
        return
    d = json.loads(ap.read_text())
    b_cw = int(d.get("buildings_on_carriageway", 0))
    walk_cw = d.get("walk_m_on_carriageway", {})
    walk_cw_sum = sum(walk_cw.values()) if isinstance(walk_cw, dict) else float(walk_cw or 0)
    opp_km = float(d.get("lanes_over_each_other_opposing", {}).get("km", 0))
    nosurf = float(d.get("traffic_km_without_surface", 0))
    fails = []
    if b_cw > 0:
        fails.append(f"buildings_on_carriageway={b_cw}")
    if walk_cw_sum > 80:
        fails.append(f"walk_m_on_carriageway={walk_cw_sum:.1f}m")
    if opp_km > 5.0:
        fails.append(f"opposing_lanes_overlap={opp_km:.1f}km")
    if fails:
        rep.add("pipeline_audit", "38_audit", "FAIL", ", ".join(fails), d)
    else:
        rep.add("pipeline_audit", "38_audit", "PASS",
                f"38_audit clean: bldg_on_cw={b_cw}, walk_on_cw={walk_cw_sum:.1f}m, opp_lanes={opp_km:.1f}km, nosurf={nosurf:.1f}km", d)


def audit_pbr_assets(root: Path, rep: Report):
    adir = root / "site" / "assets"
    mp = adir / "materials.json"
    if not mp.exists():
        rep.add("assets", "materials_json", "FAIL", f"Missing {mp}")
        return
    meta = json.loads(mp.read_text())
    size = int(meta.get("size", 512))
    layers = int(meta.get("layers", len(meta.get("materials", {}))))
    mats = meta.get("materials", {})
    rep.add("assets", "materials_meta", "PASS" if layers >= 20 else "WARN",
            f"materials.json: size={size}px, layers={layers}")

    for fn, kind in (("mat_albedo.webp", "albedo"), ("mat_nr.webp", "nr")):
        p = adir / fn
        if not p.exists():
            p_png = adir / fn.replace(".webp", ".png")
            if p_png.exists():
                p = p_png
            else:
                rep.add("assets", kind, "FAIL", f"Missing {p}")
                continue
        im = Image.open(p)
        w, h = im.size
        cols = int(meta.get("cols", 1))
        rows = int(meta.get("rows", math.ceil(layers / max(1, cols))))
        exp_w = size * cols
        exp_h = size * rows
        if w != exp_w or h != exp_h:
            rep.add("assets", f"{kind}_dims", "FAIL", f"{p.name} is {w}x{h}, expected {exp_w}x{exp_h} (cols={cols}, rows={rows}, size={size})")
            continue
        arr = np.asarray(im.convert("RGB"))
        blank_layers = []
        bad_normals = []
        inv_names = {v.get("layer", i): k for i, (k, v) in enumerate(mats.items()) if isinstance(v, dict)}
        for li in range(layers):
            col = li % cols
            row = li // cols
            sl = arr[row * size:(row + 1) * size, col * size:(col + 1) * size]
            std = float(sl.std())
            if std < 1.5:
                blank_layers.append((li, inv_names.get(li, f"layer_{li}"), round(std, 2)))
            if kind == "nr":
                rmean, gmean = float(sl[:, :, 0].mean()), float(sl[:, :, 1].mean())
                if not (85 <= rmean <= 170 and 85 <= gmean <= 170):
                    bad_normals.append((li, inv_names.get(li, f"layer_{li}"), round(rmean, 1), round(gmean, 1)))
        if blank_layers:
            rep.add("assets", f"{kind}_content", "FAIL",
                    f"{p.name} ({w}x{h}, {cols}x{rows} grid) has {len(blank_layers)} flat/blank layers: {blank_layers[:6]}")
        elif bad_normals:
            rep.add("assets", f"{kind}_content", "WARN",
                    f"{p.name} has {len(bad_normals)} biased normal layers: {bad_normals[:6]}")
        else:
            rep.add("assets", f"{kind}_content", "PASS",
                    f"{p.name} valid {w}x{h} RGB ({cols}x{rows} grid, {layers} non-blank layers, {p.stat().st_size//1024} KB)")

    # Check Chongqing material layers (28..37) & signs_vert
    cq_expected = ["sandstone", "cliff_rock", "mosaic_tile", "bayu_tile", "bayu_timber", "limestone", "stone_steps", "curtain_glass", "asphalt_wet", "red_lacquer"]
    missing_cq = [m for m in cq_expected if m not in mats]
    if missing_cq:
        rep.add("assets", "chongqing_materials", "WARN", f"Missing Chongqing PBR materials in materials.json: {missing_cq}")
    else:
        rep.add("assets", "chongqing_materials", "PASS", f"All 10 Chongqing PBR materials present ({size}px, total {layers} layers)")

    # Check Phase 3 Interior Parallax Atlas (interiors.json + interiors.webp) if present
    ip_json = adir / "interiors.json"
    ip_img = adir / "interiors.webp"
    if not ip_img.exists():
        ip_img = adir / "interiors.png"
    if ip_json.exists() or ip_img.exists():
        if not (ip_json.exists() and ip_img.exists()):
            rep.add("assets", "interiors_atlas", "FAIL", f"Incomplete interiors atlas (json={ip_json.exists()}, img={ip_img.exists()})")
        else:
            try:
                imeta = json.loads(ip_json.read_text())
                im = Image.open(ip_img)
                iw, ih = im.size
                cols = int(imeta.get("cols", 4))
                rows = int(imeta.get("rows", 4))
                n_cells = int(imeta.get("count", imeta.get("layers", cols * rows)))
                cw, ch = iw // max(1, cols), ih // max(1, rows)
                arr = np.asarray(im.convert("RGB"))
                flat_cells = []
                for idx in range(n_cells):
                    c, r = idx % cols, idx // cols
                    sl = arr[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
                    if float(sl.std()) < 8.0:
                        flat_cells.append((idx, round(float(sl.std()), 2)))
                if flat_cells:
                    rep.add("assets", "interiors_atlas", "FAIL",
                            f"{ip_img.name} ({iw}x{ih}, {cols}x{rows}) has {len(flat_cells)} low-contrast/blank room cells: {flat_cells}")
                else:
                    rep.add("assets", "interiors_atlas", "PASS",
                            f"{ip_img.name} valid {iw}x{ih} ({cols}x{rows}, {n_cells} rich room cells, {ip_img.stat().st_size//1024} KB)")
            except Exception as e:
                rep.add("assets", "interiors_atlas", "FAIL", f"Failed auditing interiors atlas: {e}")

    # Check sign & foliage atlases if present
    for pat in ("signs", "sign", "foliage", "leaf", "leaves"):
        found = [f for f in adir.iterdir() if pat in f.name.lower() and f.suffix.lower() in (".webp", ".png", ".jpg")]
        for f in found:
            try:
                im = Image.open(f)
                arr = np.asarray(im)
                st = "PASS" if arr.std() > 2.0 else "FAIL"
                rep.add("assets", f"atlas_{f.stem}", st, f"{f.name}: {im.size[0]}x{im.size[1]} {im.mode} ({f.stat().st_size//1024} KB)")
            except Exception as e:
                rep.add("assets", f"atlas_{f.stem}", "FAIL", f"{f.name} unreadable: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    ap.add_argument("--phase", type=int, default=1)
    ap.add_argument("--max-tiles", type=int, default=0, help="0 = audit all tiles")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    t0 = time.time()
    root = Path(args.root)
    rep = Report()
    print(f"=== Chongqing 3D GIS & DEM Data Audit (phase={args.phase}, root={root}) ===")

    common = audit_gis_and_origin(root, rep)
    terrain = TerrainSampler(root / "site" / "data")
    audit_dem_terrain(root, common, terrain, rep)
    lm_entries = audit_landmarks_wgs84(root, common, terrain, rep)
    audit_tiles_and_exclusions(root, common, terrain, lm_entries, rep, args.max_tiles)
    audit_tunnels_json(root, terrain, rep)
    audit_pipeline_38(root, rep)
    audit_pbr_assets(root, rep)

    s = rep.summary()
    elapsed = round(time.time() - t0, 2)
    print(f"=== Summary ({elapsed}s): PASS={s['PASS']} WARN={s['WARN']} FAIL={s['FAIL']} SKIP={s['SKIP']} ===")

    out_p = Path(args.out) if args.out else Path(__file__).parent / "last_gis_dem_report.json"
    out_p.write_text(json.dumps({"elapsed_s": elapsed, "summary": s, "checks": rep.checks}, indent=2, ensure_ascii=False))
    sys.exit(1 if s["FAIL"] > 0 else 0)


if __name__ == "__main__":
    main()
