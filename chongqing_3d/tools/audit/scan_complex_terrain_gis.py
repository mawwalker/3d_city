#!/usr/bin/env python3
"""Chongqing 3D — Phase 4 City-Wide Complex-Terrain Quantitative Defect Scanner (Offline GIS/DEM/Tiles).

Ruthlessly scans ALL 24x22 km (528 tiles, osm_roads, traffic edges, bridges/decks, buildings) to measure:
  1. Tilted roads (transverse cross-slope > 5, 10, 15, 20 deg & |hL-hR| m) + Top 25 worst spots + per-district stats
  2. Hero bridge traffic elevation mismatches (traffic SEC 11 vs landmarks.json deckY + bridges.js camber)
  3. Overpass / procedural deck clearance anomalies (decks clipping terrain or roads)
  4. Tunnel entrances / exits (cl crossing -2.6m) & total unportaled tunnel portals
  5. Steep-slope buildings (zMax-zMin > 8m/15m) & buildings close to steep roads (balcony/plinth intrusion risk)

Usage:
  python scan_complex_terrain_gis.py [--root <chongqing_3d_dir>]
"""
import argparse
import gzip
import json
import math
import os
import pickle
import struct
import sys
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import LineString, Point

ROOT_DEFAULT = str(Path(__file__).resolve().parents[2])

# Key complex Chongqing steep-terrain districts (WebGL x, z, radius)
DISTRICTS = [
    ("Shibati_Kaixuan_Chuqimen",    -380,    688,  900),
    ("Hongyadong_Cangbai_Kuixing",    40,   -460,  700),
    ("Caiyuanba_Sujiaba_Eling",    -2450,   2000, 1400),
    ("Liziba_Fotuguan",            -3825,    490,  900),
    ("Baixiangju_Dongshuimen_CW",   1050,    120,  950),
    ("Nanbin_Longmenhao_Nanshan",   1950,    900, 1200),
    ("Huangjuewan_Interchange",     4267,  -1630,  900),
    ("Chaotianmen_Bridge_Appr",      480,  -3135, 1100),
    ("Guanyinqiao_Jiangbeizui",    -1500,  -1600, 1500),
    ("Jiefangbei_Core",                0,      0,  650),
]


def district_of(wx, wz):
    best, bd = "Other", 1e9
    for nm, dx, dz, r in DISTRICTS:
        d = math.hypot(wx - dx, wz - dz)
        if d <= r and d < bd:
            best, bd = nm, d
    return best


def decode_tile(raw):
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    nsec = struct.unpack_from("<I", raw, 4)[0]
    secs = {}
    for k in range(nsec):
        sid, off, ln = struct.unpack_from("<III", raw, 8 + 12 * k)
        secs[sid] = raw[off:off + ln]
    return secs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=ROOT_DEFAULT)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    t0 = time.time()
    root = Path(args.root)
    sys.path.insert(0, str(root / "pipeline"))
    sys.path.insert(0, str(Path(__file__).parent))
    import common
    import audit_gis_dem as agd

    ts = agd.TerrainSampler(root / "site" / "data")
    fg = ts.grids["fine"]
    cg = ts.grids.get("core")

    def _sample_grid(g, xs, ys_north):
        arr = g["arr"]
        fx = (xs - g["x0"]) / g["cell"] - 0.5
        fy = (ys_north - g["y0"]) / g["cell"] - 0.5
        nx, ny = g["nx"], g["ny"]
        ix = np.clip(np.floor(fx).astype(np.int64), 0, nx - 2)
        iy = np.clip(np.floor(fy).astype(np.int64), 0, ny - 2)
        tx = np.clip(fx - ix, 0.0, 1.0)
        ty = np.clip(fy - iy, 0.0, 1.0)
        v = ((1 - tx) * (1 - ty) * arr[iy, ix]
             + tx * (1 - ty) * arr[iy, ix + 1]
             + (1 - tx) * ty * arr[iy + 1, ix]
             + tx * ty * arr[iy + 1, ix + 1])
        ok = (fx >= 0) & (fx <= nx - 1) & (fy >= 0) & (fy <= ny - 1)
        return v, ok

    def sample_vec(xs, ys_north):
        xs = np.asarray(xs, dtype=np.float64)
        ys_north = np.asarray(ys_north, dtype=np.float64)
        vf, okf = _sample_grid(fg, xs, ys_north)
        out = np.where(okf, vf, np.nan)
        if cg is not None:
            vc, okc = _sample_grid(cg, xs, ys_north)
            out = np.where(okc, vc, out)
        return out

    core_box = (
        (cg["x0"], cg["x0"] + cg["nx"] * cg["cell"], cg["y0"], cg["y0"] + cg["ny"] * cg["cell"])
        if cg is not None else (-6000.0, 5000.0, -4000.0, 4500.0)
    )
    report = {"has_core_dem": cg is not None, "core_cell_m": cg["cell"] if cg is not None else None}

    # =========================================================================
    # 1. TILTED ROADS (cross-slope across EVERY ground carriageway & sidewalk)
    # =========================================================================
    roads = gpd.read_parquet(root / "data" / "work" / "osm_roads.parquet")
    A = pickle.load(open(root / "data" / "work" / "roads_attr.pkl", "rb"))
    cls, W, bridge, tunnel, lowbr, area_, deck = (A[k] for k in ("cls", "W", "bridge", "tunnel", "lowbr", "area", "deck"))
    R = common.project_geoms(roads.geometry.values)
    names = roads["name"].values if "name" in roads.columns else np.full(len(roads), None)

    ground = (~area_) & (~tunnel) & (~bridge | lowbr) & (~deck)
    drivable = np.isin(cls, [0, 1, 2, 3, 4, 5, 11]) & ground
    footway = np.isin(cls, [6, 7, 10]) & ground

    def scan_cross_slope(mask, label):
        idxs = np.flatnonzero(mask)
        tot_km = 0.0
        km_gt = {5: 0.0, 10: 0.0, 15: 0.0, 20: 0.0}
        core_tot_km = 0.0
        core_km_gt = {5: 0.0, 10: 0.0, 15: 0.0, 20: 0.0}
        cx0, cx1, cy0, cy1 = core_box
        by_dist = {}
        spots = []  # (deg, dh, wx, wz, W, cls, name, dist)
        for ri in idxs:
            g = R[ri]
            if g is None or g.is_empty or g.geom_type != "LineString":
                continue
            coords = np.asarray(g.coords)[:, :2]
            if len(coords) < 2:
                continue
            w = max(float(W[ri]), 3.5)
            # Sample every ~12m along polyline
            diffs = np.diff(coords, axis=0)
            segL = np.hypot(diffs[:, 0], diffs[:, 1])
            tot_L = float(segL.sum())
            if tot_L < 4.0:
                continue
            tot_km += tot_L / 1000.0
            n_samp = max(1, int(round(tot_L / 12.0)))
            cum = np.concatenate([[0.0], np.cumsum(segL)])
            ss = np.linspace(0.5 * tot_L / n_samp, tot_L - 0.5 * tot_L / n_samp, n_samp)
            si = np.clip(np.searchsorted(cum, ss) - 1, 0, len(segL) - 1)
            sl = np.maximum(segL[si], 1e-6)
            t = (ss - cum[si]) / sl
            cx = coords[si, 0] + diffs[si, 0] * t
            cy = coords[si, 1] + diffs[si, 1] * t
            # Left normal (-dy, dx)
            nx = -diffs[si, 1] / sl
            ny = diffs[si, 0] / sl
            hw = w * 0.5
            hL = sample_vec(cx + nx * hw, cy + ny * hw)
            hR = sample_vec(cx - nx * hw, cy - ny * hw)
            dh = np.abs(hL - hR)
            deg = np.degrees(np.arctan2(dh, w))
            valid = np.isfinite(deg)
            if not valid.any():
                continue
            step_km = (tot_L / n_samp) / 1000.0
            in_core = valid & (cx >= cx0 + 10) & (cx <= cx1 - 10) & (cy >= cy0 + 10) & (cy <= cy1 - 10)
            core_tot_km += float(in_core.sum()) * step_km
            for thr in (5, 10, 15, 20):
                km_gt[thr] += float((deg[valid] > thr).sum()) * step_km
                core_km_gt[thr] += float((deg[in_core] > thr).sum()) * step_km
            # Track worst sample per road segment (for Top 25 leaderboard)
            bi = int(np.nanargmax(deg))
            dmax = float(deg[bi])
            dhmax = float(dh[bi])
            wx, wz = float(cx[bi]), float(-cy[bi])
            dn = district_of(wx, wz)
            if dn not in by_dist:
                by_dist[dn] = {"km_tot": 0.0, "km_gt10": 0.0, "km_gt15": 0.0, "max_deg": 0.0}
            by_dist[dn]["km_tot"] += tot_L / 1000.0
            by_dist[dn]["km_gt10"] += float((deg[valid] > 10).sum()) * step_km
            by_dist[dn]["km_gt15"] += float((deg[valid] > 15).sum()) * step_km
            by_dist[dn]["max_deg"] = max(by_dist[dn]["max_deg"], dmax)
            # Filter to urban/core extent (inside core_box or named districts)
            if dmax > 12.0 and ((cx0 <= wx <= cx1 and cy0 <= -wz <= cy1) or dn != "Other"):
                nm = str(names[ri]) if names[ri] is not None and str(names[ri]) != "nan" else ""
                spots.append((dmax, dhmax, round(wx, 1), round(wz, 1), round(w, 1), int(cls[ri]), nm, dn))
        # Deduplicate Top 30 worst spots spatially (> 120m apart)
        spots.sort(key=lambda s: (-s[1], -s[0]))  # sort by largest absolute cross-height drop dh (metres!) first
        top_dh = []
        for sp in spots:
            if all(math.hypot(sp[2] - q[2], sp[3] - q[3]) > 120 for q in top_dh):
                top_dh.append(sp)
            if len(top_dh) >= 25:
                break
        spots.sort(key=lambda s: -s[0])
        top_deg = []
        for sp in spots:
            if all(math.hypot(sp[2] - q[2], sp[3] - q[3]) > 120 for q in top_deg):
                top_deg.append(sp)
            if len(top_deg) >= 25:
                break
        return {
            "total_km": round(tot_km, 1),
            "km_gt_5deg": round(km_gt[5], 1),
            "km_gt_10deg": round(km_gt[10], 1),
            "km_gt_15deg": round(km_gt[15], 1),
            "km_gt_20deg": round(km_gt[20], 1),
            "core_total_km": round(core_tot_km, 1),
            "core_km_gt_5deg": round(core_km_gt[5], 1),
            "core_km_gt_10deg": round(core_km_gt[10], 1),
            "core_km_gt_15deg": round(core_km_gt[15], 1),
            "core_km_gt_20deg": round(core_km_gt[20], 1),
            "by_district": {k: {kk: round(vv, 1) for kk, vv in v.items()} for k, v in sorted(by_dist.items(), key=lambda kv: -kv[1]["km_gt10"])},
            "top25_by_cross_drop_m": [{"deg": round(s[0], 1), "dh_m": round(s[1], 2), "x": s[2], "z": s[3], "W": s[4], "cls": s[5], "name": s[6], "district": s[7]} for s in top_dh],
            "top25_by_angle_deg": [{"deg": round(s[0], 1), "dh_m": round(s[1], 2), "x": s[2], "z": s[3], "W": s[4], "cls": s[5], "name": s[6], "district": s[7]} for s in top_deg],
        }

    report["tilted_carriageways"] = scan_cross_slope(drivable, "carriageways")
    report["tilted_footways"] = scan_cross_slope(footway, "footways")

    # =========================================================================
    # 2. TRAFFIC GRAPH (528 tiles): Hero bridge Y mismatch + Tunnel portals + Deck clearances
    # =========================================================================
    city = json.loads((root / "site" / "data" / "city.json").read_text())
    gx0, gy0, tsz = city["grid"]["x0"], city["grid"]["y0"], city["grid"]["tile"]
    lm = json.loads((root / "site" / "data" / "landmarks.json").read_text())

    # Build hero bridge buffers in WebGL (x, z)
    hero_br = []
    for b in lm.get("bridges", []):
        cl = b.get("centerline")
        if cl and len(cl) >= 2:
            ls = LineString([(p[0], p[1]) for p in cl])
            hw = max(14.0, float(b.get("width", 22)) * 0.75)
            hero_br.append((b["id"], b["name"], ls.buffer(hw), float(b["deckY"]), b))

    tdir = root / "site" / "data" / "tiles"
    tunnel_portals = []
    hero_bridge_traffic_mismatch = {b[0]: {"count": 0, "min_err": 1e9, "max_err": -1e9, "samples": []} for b in hero_br}
    deck_clips_terrain = []
    steep_traffic_edges = 0
    total_traffic_edges = 0

    for tf in sorted(tdir.iterdir()):
        if not tf.name.endswith(".bin"):
            continue
        ti, tj = map(int, tf.stem.split("_"))
        ox, oy = gx0 + ti * tsz, gy0 + tj * tsz
        secs = decode_tile(tf.read_bytes())

        # ---- Section 11: Traffic edges
        if 11 in secs:
            buf = secs[11]
            ne, nv, na = struct.unpack_from("<III", buf, 0)
            total_traffic_edges += ne
            recs = [struct.unpack_from("<IIBBBBBbBBBBBBBBHHH", buf, 12 + 40 * e) for e in range(ne)]
            o = 12 + 40 * ne
            xy = np.frombuffer(buf, "<i2", nv * 2, o).reshape(-1, 2).astype(np.float64)
            zz = np.frombuffer(buf, "<i2", nv, o + nv * 4).astype(np.float64) * 0.05
            k = 0
            for rec in recs:
                a_, b_, c_, flags, nf, nb, lw, shift, W_, kmh, tA, tB, sA, sB, cA, cB, npts, phA, phB = rec
                p = np.cumsum(xy[k:k + npts], axis=0) * 0.1 + (ox, oy)
                cl = zz[k:k + npts]
                k += npts
                if npts < 2:
                    continue
                is_deck = (flags & 2) != 0
                wx = p[:, 0]
                wz = -p[:, 1]
                ty = sample_vec(wx, p[:, 1])
                if not np.isfinite(ty).all():
                    continue
                wy = np.where(is_deck, np.maximum(ty, 0.0) + np.maximum(cl, 0.16),
                              np.where(cl < -2.6, ty + cl, ty + np.maximum(cl, 0.05)))

                # Detect tunnel portals (transition across -2.6m)
                in_tun = cl < -2.6
                if in_tun.any() and (~in_tun).any():
                    for idx_p in range(npts - 1):
                        if in_tun[idx_p] != in_tun[idx_p + 1]:
                            tunnel_portals.append((round(float(wx[idx_p]), 1), round(float(wz[idx_p]), 1), round(float(ty[idx_p]), 1), district_of(float(wx[idx_p]), float(wz[idx_p]))))
                elif in_tun.all() and abs(cl[0] - (-2.6)) < 2.0:
                    tunnel_portals.append((round(float(wx[0]), 1), round(float(wz[0]), 1), round(float(ty[0]), 1), district_of(float(wx[0]), float(wz[0]))))

                # Check longitudinal grade
                ds = np.hypot(np.diff(wx), np.diff(wz))
                dz = np.abs(np.diff(wy))
                if (ds > 2.0).any() and (dz[ds > 2.0] / ds[ds > 2.0] > 0.22).any():
                    steep_traffic_edges += 1

                # Check hero bridge traffic height alignment!
                mid_x, mid_z = float(wx[npts // 2]), float(wz[npts // 2])
                mid_y = float(wy[npts // 2])
                mid_cl = float(cl[npts // 2])
                mid_ty = float(ty[npts // 2])
                if mid_cl >= -2.6:
                    pt = Point(mid_x, mid_z)
                    for bid, bname, bbuf, bdeckY, brob in hero_br:
                        if bbuf.contains(pt) and (mid_ty < 2.0 or is_deck):
                            # Vehicle is crossing over the river/viaduct along this hero bridge!
                            err = mid_y - bdeckY
                            st = hero_bridge_traffic_mismatch[bid]
                            st["count"] += 1
                            st["min_err"] = min(st["min_err"], err)
                            st["max_err"] = max(st["max_err"], err)
                            if len(st["samples"]) < 4 and abs(err) > 2.5:
                                st["samples"].append({"x": round(mid_x, 1), "z": round(mid_z, 1), "trafficY": round(mid_y, 1), "heroDeckY": round(bdeckY, 1), "err": round(err, 1), "is_deck": is_deck, "cl": round(mid_cl, 1)})

        # ---- Section 9: Procedural Bridge/Overpass Decks clipping steep terrain laterally!
        if 9 in secs:
            buf = secs[9]
            nl, nv, na = struct.unpack_from("<III", buf, 0)
            o = 12
            wid_arr = np.frombuffer(buf, np.uint8, nl, o + nl)
            o += ((na * nl) + 3) & ~3
            npts_arr = np.frombuffer(buf, "<u2", nl, o)
            o += ((nl * 2) + 3) & ~3
            xy = np.frombuffer(buf, "<i2", nv * 2, o).reshape(-1, 2).astype(np.float64)
            o += nv * 4
            zz = np.frombuffer(buf, np.uint8, nv, o).astype(np.float64) * 0.25
            vi = 0
            for l in range(nl):
                m = int(npts_arr[l])
                w = float(wid_arr[l]) / 4.0
                p = np.cumsum(xy[vi:vi + m], axis=0) * 0.1 + (ox, oy)
                cl = zz[vi:vi + m]
                vi += m
                if m < 2 or w < 3.0:
                    continue
                diffs = np.diff(p, axis=0)
                segL = np.hypot(diffs[:, 0], diffs[:, 1])
                for idx_s in range(m - 1):
                    if segL[idx_s] < 1.0:
                        continue
                    mx = 0.5 * (p[idx_s, 0] + p[idx_s + 1, 0])
                    my = 0.5 * (p[idx_s, 1] + p[idx_s + 1, 1])
                    mcl = 0.5 * (cl[idx_s] + cl[idx_s + 1])
                    if mcl < 1.5:
                        continue
                    nx = -diffs[idx_s, 1] / segL[idx_s]
                    ny = diffs[idx_s, 0] / segL[idx_s]
                    tc = float(sample_vec(np.array([mx]), np.array([my]))[0])
                    tL = float(sample_vec(np.array([mx + nx * w * 0.5]), np.array([my + ny * w * 0.5]))[0])
                    tR = float(sample_vec(np.array([mx - nx * w * 0.5]), np.array([my - ny * w * 0.5]))[0])
                    if not (math.isfinite(tc) and math.isfinite(tL) and math.isfinite(tR)):
                        continue
                    deck_y = max(tc, 0.0) + mcl
                    uphill_t = max(tL, tR)
                    if uphill_t > deck_y + 0.3:
                        # Uphill terrain bulges RIGHT THROUGH the flat horizontal overpass deck!
                        deck_clips_terrain.append((round(uphill_t - deck_y, 2), round(mx, 1), round(-my, 1), round(mcl, 1), round(w, 1), district_of(mx, -my)))

    # Deduplicate tunnel portals spatially (> 40m)
    uniq_portals = []
    for tp in tunnel_portals:
        if all(math.hypot(tp[0] - u[0], tp[1] - u[1]) > 40 for u in uniq_portals):
            uniq_portals.append(tp)

    # Match tunnel transitions against site/data/tunnels.json portals (within 35m)
    tjson_p = root / "site" / "data" / "tunnels.json"
    tportals_json = json.loads(tjson_p.read_text()) if tjson_p.exists() else []
    unportaled = []
    for tp in uniq_portals:
        matched = any(math.hypot(tp[0] - float(pj["x"]), tp[1] - float(pj["z"])) <= 35.0 for pj in tportals_json)
        if not matched:
            unportaled.append(tp)

    # Deduplicate deck terrain clips (> 80m)
    deck_clips_terrain.sort(key=lambda x: -x[0])
    top_deck_clips = []
    for dc in deck_clips_terrain:
        if all(math.hypot(dc[1] - u[1], dc[2] - u[2]) > 80 for u in top_deck_clips):
            top_deck_clips.append(dc)
        if len(top_deck_clips) >= 20:
            break

    report["traffic_and_decks"] = {
        "total_traffic_edges": total_traffic_edges,
        "steep_grade_edges_gt22pct": steep_traffic_edges,
        "tunnels_json_portals_count": len(tportals_json),
        "total_tunnel_transitions_count": len(uniq_portals),
        "unportaled_tunnel_portals_count": len(unportaled),
        "tunnel_portal_samples": [{"x": p[0], "z": p[1], "terrainY": p[2], "district": p[3]} for p in unportaled[:20]],
        "deck_clipped_by_uphill_terrain_count": len(deck_clips_terrain),
        "top20_deck_terrain_clips": [{"penetration_m": d[0], "x": d[1], "z": d[2], "center_cl": d[3], "W": d[4], "district": d[5]} for d in top_deck_clips],
        "hero_bridge_traffic_alignment": {
            k: {
                "edges_over_bridge": v["count"],
                "min_err_m": round(v["min_err"], 1) if v["count"] else None,
                "max_err_m": round(v["max_err"], 1) if v["count"] else None,
                "bad_samples": v["samples"],
            }
            for k, v in hero_bridge_traffic_mismatch.items()
        },
    }

    # =========================================================================
    # 3. STEEP-SLOPE BUILDINGS (extreme foundation relief & tight road clearance)
    # =========================================================================
    b_df = gpd.read_parquet(root / "data" / "work" / "buildings.parquet", columns=["geometry", "height", "cx", "cy"])
    # Sample ground_z_min/max across buildings from DEM
    b_geoms = b_df.geometry.values
    b_bounds = shapely.bounds(b_geoms)
    c0 = sample_vec(b_bounds[:, 0], b_bounds[:, 1])
    c1 = sample_vec(b_bounds[:, 2], b_bounds[:, 1])
    c2 = sample_vec(b_bounds[:, 2], b_bounds[:, 3])
    c3 = sample_vec(b_bounds[:, 0], b_bounds[:, 3])
    cc = sample_vec(b_df["cx"].values, b_df["cy"].values)
    stk = np.vstack([c0, c1, c2, c3, cc])
    with np.errstate(all="ignore"):
        b_drop = np.nanmax(stk, axis=0) - np.nanmin(stk, axis=0)
    # Check buildings within 1.8m of steep carriageways (where 3D balconies/awnings/pilasters may poke into roadway!)
    cw_buf = shapely.buffer(R[drivable], W[drivable] / 2.0 + 1.5, quad_segs=2)
    cw_tree = shapely.STRtree(cw_buf)
    bi, ri = cw_tree.query(b_geoms, predicate="intersects")
    close_steep = np.unique(bi[b_drop[bi] > 5.0]) if len(bi) else np.zeros(0, dtype=int)

    report["steep_buildings"] = {
        "total_buildings": len(b_df),
        "drop_gt_5m": int((b_drop > 5.0).sum()),
        "drop_gt_10m": int((b_drop > 10.0).sum()),
        "drop_gt_15m": int((b_drop > 15.0).sum()),
        "drop_gt_25m": int((b_drop > 25.0).sum()),
        "max_footprint_drop_m": round(float(np.nanmax(b_drop)), 1),
        "steep_buildings_within_1_5m_of_carriageway": int(len(close_steep)),
    }

    elapsed = round(time.time() - t0, 2)
    report["elapsed_s"] = elapsed
    out_p = Path(args.out) if args.out else Path(__file__).parent / "complex_terrain_gis_report.json"
    out_p.write_text(json.dumps(report, indent=2, ensure_ascii=False))

    # Crisp stdout summary
    tc = report["tilted_carriageways"]
    tfw = report["tilted_footways"]
    td = report["traffic_and_decks"]
    sb = report["steep_buildings"]
    print(f"=== Complex-Terrain GIS Scanner ({elapsed}s, core_dem={report['has_core_dem']} cell={report['core_cell_m']}m) ===")
    print(f"[TILTED CARRIAGEWAYS ALL ] total={tc['total_km']}km | >5deg={tc['km_gt_5deg']}km | >10deg={tc['km_gt_10deg']}km | >15deg={tc['km_gt_15deg']}km | >20deg={tc['km_gt_20deg']}km")
    print(f"[TILTED CARRIAGEWAYS CORE] total={tc['core_total_km']}km | >5deg={tc['core_km_gt_5deg']}km | >10deg={tc['core_km_gt_10deg']}km | >15deg={tc['core_km_gt_15deg']}km | >20deg={tc['core_km_gt_20deg']}km")
    print(f"[TILTED FOOTWAYS ALL     ] total={tfw['total_km']}km | >5deg={tfw['km_gt_5deg']}km | >10deg={tfw['km_gt_10deg']}km | >15deg={tfw['km_gt_15deg']}km | >20deg={tfw['km_gt_20deg']}km")
    print(f"[TILTED FOOTWAYS CORE    ] total={tfw['core_total_km']}km | >5deg={tfw['core_km_gt_5deg']}km | >10deg={tfw['core_km_gt_10deg']}km | >15deg={tfw['core_km_gt_15deg']}km | >20deg={tfw['core_km_gt_20deg']}km")
    print("[BY DISTRICT (carriageways km >10deg / >15deg / max deg)]:")
    for dn, dv in tc["by_district"].items():
        print(f"  {dn:<28} tot={dv['km_tot']:6.1f}km  >10deg={dv['km_gt10']:5.1f}km  >15deg={dv['km_gt15']:5.1f}km  max={dv['max_deg']:4.1f}deg")
    print("[TOP 12 WORST TILTED CARRIAGEWAYS (by cross-height drop dh_m)]:")
    for s in tc["top25_by_cross_drop_m"][:12]:
        print(f"  ({s['x']:7.1f}, {s['z']:7.1f}) [{s['district']}] W={s['W']}m dh={s['dh_m']}m ({s['deg']}deg) cls={s['cls']} {s['name']}")
    print(f"[TUNNEL PORTALS] tunnels.json={td['tunnels_json_portals_count']} | transitions={td['total_tunnel_transitions_count']} | unportaled(>35m)={td['unportaled_tunnel_portals_count']} | steep edges(>22%)={td['steep_grade_edges_gt22pct']}")
    print(f"[DECK-VS-TERRAIN CLIPS] {td['deck_clipped_by_uphill_terrain_count']} segments where uphill DEM bulges THROUGH horizontal deck!")
    for d in td["top20_deck_terrain_clips"][:8]:
        print(f"  ({d['x']:7.1f}, {d['z']:7.1f}) [{d['district']}] terrain pokes +{d['penetration_m']}m above deck (center_cl={d['center_cl']}m, W={d['W']}m)")
    print("[HERO BRIDGE TRAFFIC ALIGNMENT (trafficY - heroDeckY)]:")
    for bid, bv in td["hero_bridge_traffic_alignment"].items():
        if bv["edges_over_bridge"] > 0:
            print(f"  {bid:<14} edges={bv['edges_over_bridge']:3d} err=[{bv['min_err_m']}, {bv['max_err_m']}]m bad={len(bv['bad_samples'])}")
    print(f"[STEEP BUILDINGS] drop>5m={sb['drop_gt_5m']}, >10m={sb['drop_gt_10m']}, >15m={sb['drop_gt_15m']}, >25m={sb['drop_gt_25m']} (max={sb['max_footprint_drop_m']}m), within 1.5m of carriageway={sb['steep_buildings_within_1_5m_of_carriageway']}")


if __name__ == "__main__":
    main()
