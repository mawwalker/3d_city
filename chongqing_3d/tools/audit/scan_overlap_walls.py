#!/usr/bin/env python3
"""Chongqing 3D — Phase 5 Offline Overlapping/Coplanar Wall & Pedestrian-Path-vs-Building Scanner.

Scans ALL 528 detail tiles + 4 far packs (141k buildings) + SEC.walks (section 12) in core extent:
  1. Overlapping building footprints (detail-vs-detail, detail-vs-far, far-vs-far) with overlapping vertical [y0, y1] ranges
     (classic OSM building + building:part or GBA/Overture Z-fighting duplicates!)
  2. Exact coplanar / near-coplanar shared wall segments (dist < 0.05m, parallel normals, overlap > 1.5m, overlapping Y)
  3. Open walking polylines in SEC.walks (dist(first, last) > 2.0m -> forced closing-chord teleport in peopleGeom.js!)
  4. Walking polyline segments directly intersecting ANY building polygon (wall clipping in data!)
"""
import argparse
import gzip
import json
import math
import struct
import sys
import time
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString, Polygon

ROOT_DEFAULT = str(Path(__file__).resolve().parents[2])


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
    args = ap.parse_args()
    t0 = time.time()
    root = Path(args.root)
    sys.path.insert(0, str(Path(__file__).parent))
    import audit_gis_dem as agd

    manifest = json.loads((root / "site" / "data" / "city.json").read_text())
    grid = manifest["grid"]
    x0, y0, tsz = float(grid["x0"]), float(grid["y0"]), float(grid["tile"])
    tilefmt = agd.load_module(root / "pipeline" / "tilefmt.py", "cq_tilefmt")

    # Core urban audit window: X in [-4500, +3500], Y_north in [-3500, +3500] (covers Yuzhong, Jiangbeizui, Nanbin, Liziba, Sujiaba, Guanyinqiao)
    CX0, CX1, CY0, CY1 = -4500.0, 3500.0, -3500.0, 3500.0

    # Load far_*.bin buffers
    far_bufs = []
    for ff in manifest.get("farFiles", []):
        raw_f = (root / "site" / "data" / ff["name"]).read_bytes()
        far_bufs.append(gzip.decompress(raw_f) if raw_f[:2] == b"\x1f\x8b" else raw_f)
    far_by_ij = {}
    for te in manifest.get("tiles", []):
        if "f" in te and te["f"] < len(far_bufs):
            far_by_ij[(te["i"], te["j"])] = far_bufs[te["f"]][te["o"]:te["o"] + te["l"]]

    tdir = root / "site" / "data" / "tiles"

    # Collect all core buildings: (poly, yBot, yTop, tile_key, src_kind, idx_in_sec, outer_ring_np)
    bldgs = []
    # Collect all core walking polylines: (coords_np, kind, tile_key, is_open, close_dist)
    walks = []
    total_walk_loops = 0
    open_walk_loops = 0
    open_walk_examples = []

    for tf in sorted(tdir.iterdir()):
        if not tf.name.endswith(".bin"):
            continue
        ti, tj = map(int, tf.stem.split("_"))
        ox, oy = x0 + ti * tsz, y0 + tj * tsz
        if ox + tsz < CX0 or ox > CX1 or oy + tsz < CY0 or oy > CY1:
            continue
        tkey = f"{ti}_{tj}"
        secs = decode_tile(tf.read_bytes())

        def add_bsec(buf, src_kind):
            bi = agd.parse_buildings_section(buf, ox, oy, tilefmt)
            if not bi or bi["nb"] == 0:
                return
            rings = bi.get("rings") or []
            holes_all = bi.get("holes") or [None] * len(rings)
            h = np.asarray(bi["height"], float)
            base = np.asarray(bi["base"], float)
            gzmin = np.asarray(bi["ground_z_min"], float) if bi.get("ground_z_min") is not None else np.zeros(bi["nb"])
            gzmax = np.asarray(bi["ground_z_max"], float) if bi.get("ground_z_max") is not None else np.zeros(bi["nb"])
            for k in range(min(bi["nb"], len(rings))):
                r = rings[k]
                if r is None or len(r) < 3:
                    continue
                hlist = holes_all[k] if k < len(holes_all) and holes_all[k] else None
                p = Polygon(r, hlist) if hlist else Polygon(r)
                if p.is_empty or p.area < 1.0:
                    continue
                if not p.is_valid:
                    p = p.buffer(0)
                if p.is_empty or p.geom_type != "Polygon":
                    continue
                yb = float(gzmax[k] + base[k]) if base[k] > 0.1 else float(gzmin[k] - 6.0)
                yt = float(gzmax[k] + base[k] + h[k])
                bldgs.append((p, yb, yt, tkey, src_kind, k, r, float(gzmin[k]), float(gzmax[k]), float(base[k])))

        if 1 in secs:
            add_bsec(secs[1], "detail")
        if (ti, tj) in far_by_ij:
            fsecs = decode_tile(far_by_ij[(ti, tj)])
            if 1 in fsecs:
                add_bsec(fsecs[1], "far")

        # Section 12: Walks
        if 12 in secs:
            wbuf = secs[12]
            nl = struct.unpack_from("<I", wbuf, 0)[0]
            o = 12
            wkinds = []
            wflags = []
            wnpts = []
            for _ in range(nl):
                wk = wbuf[o]
                wf = wbuf[o + 1]
                wn = struct.unpack_from("<H", wbuf, o + 2)[0]
                wkinds.append(wk)
                wflags.append(wf)
                wnpts.append(wn)
                o += 4
            for li in range(nl):
                m = wnpts[li]
                xy = np.frombuffer(wbuf, "<i2", m * 2, o).reshape(-1, 2).astype(np.float64)
                o += m * 4
                pts = np.cumsum(xy, axis=0) * 0.1 + (ox, oy)
                if len(pts) < 2:
                    continue
                total_walk_loops += 1
                close_d = float(np.hypot(pts[-1, 0] - pts[0, 0], pts[-1, 1] - pts[0, 1]))
                is_pingpong = (wflags[li] & 1) != 0
                is_open = (not is_pingpong) and close_d > 2.5
                if is_open:
                    open_walk_loops += 1
                    if len(open_walk_examples) < 15:
                        open_walk_examples.append({
                            "tile": tkey, "kind": int(wkinds[li]), "flags": int(wflags[li]), "npts": m,
                            "close_jump_m": round(close_d, 1),
                            "start_xz": [round(float(pts[0, 0]), 1), round(float(-pts[0, 1]), 1)],
                            "end_xz": [round(float(pts[-1, 0]), 1), round(float(-pts[-1, 1]), 1)],
                        })
                walks.append((pts, int(wkinds[li]), tkey, is_open, close_d, is_pingpong))

    # 1. Check overlapping building footprints & exact coplanar wall edges!
    polys = [b[0] for b in bldgs]
    btree = shapely.STRtree(polys)

    overlap_pairs = []  # (inter_area, y_overlap, kind_pair, tile, wx, wz, details)
    coplanar_edges = []  # (overlap_len, y_overlap, dist_m, kind_pair, tile, wx, wz)
    same_tile_dup = 0
    detail_vs_far_overlap = 0
    detail_vs_detail_overlap = 0
    far_vs_far_overlap = 0
    cross_tile_overlap = 0

    for i in range(len(bldgs)):
        pi, ybi, yti, tki, ski, ki, ri, gz0i, gz1i, basei = bldgs[i]
        # Query within 0.08m to catch both overlapping footprints AND touching coplanar walls!
        hits = btree.query(pi.buffer(0.08), predicate="intersects")
        for j in hits:
            if j <= i:
                continue
            pj, ybj, ytj, tkj, skj, kj, rj, gz0j, gz1j, basej = bldgs[j]
            y_ov = min(yti, ytj) - max(ybi, ybj)
            if y_ov < 0.5:
                continue
            inter = pi.intersection(pj)
            iarea = float(inter.area)
            if iarea > 1.5:
                kp = "+".join(sorted([ski, skj]))
                if tki != tkj:
                    cross_tile_overlap += 1
                else:
                    same_tile_dup += 1
                if kp == "detail+far":
                    detail_vs_far_overlap += 1
                elif kp == "detail+detail":
                    detail_vs_detail_overlap += 1
                else:
                    far_vs_far_overlap += 1
                c = inter.centroid
                overlap_pairs.append((round(iarea, 1), round(y_ov, 1), kp, tki, round(c.x, 1), round(-c.y, 1), round(basei, 1), round(basej, 1)))
            else:
                # Check for exact coplanar/near-coplanar wall edges (dist < 0.05m, overlap > 1.5m)!
                # Compare outer ring edges
                n1, n2 = len(ri), len(rj)
                for a in range(n1):
                    ax0, ay0 = ri[a]
                    ax1, ay1 = ri[(a + 1) % n1]
                    adx, ady = ax1 - ax0, ay1 - ay0
                    al = math.hypot(adx, ady)
                    if al < 1.5:
                        continue
                    ux, uy = adx / al, ady / al
                    # bbox filter
                    aminx, amaxx = min(ax0, ax1) - 0.08, max(ax0, ax1) + 0.08
                    aminy, amaxy = min(ay0, ay1) - 0.08, max(ay0, ay1) + 0.08
                    for b in range(n2):
                        bx0, by0 = rj[b]
                        bx1, by1 = rj[(b + 1) % n2]
                        if max(bx0, bx1) < aminx or min(bx0, bx1) > amaxx or max(by0, by1) < aminy or min(by0, by1) > amaxy:
                            continue
                        bdx, bdy = bx1 - bx0, by1 - by0
                        bl = math.hypot(bdx, bdy)
                        if bl < 1.5:
                            continue
                        dot = abs((ux * bdx + uy * bdy) / bl)
                        if dot < 0.996:  # > ~5 deg off parallel
                            continue
                        # Perpendicular distance from b0 and b1 to line a
                        d0 = abs((bx0 - ax0) * (-uy) + (by0 - ay0) * ux)
                        d1 = abs((bx1 - ax0) * (-uy) + (by1 - ay0) * ux)
                        md = 0.5 * (d0 + d1)
                        if md > 0.05:
                            continue
                        # Longitudinal overlap along edge a
                        t0_ = (bx0 - ax0) * ux + (by0 - ay0) * uy
                        t1_ = (bx1 - ax0) * ux + (by1 - ay0) * uy
                        lo = max(0.0, min(t0_, t1_))
                        hi = min(al, max(t0_, t1_))
                        ov = hi - lo
                        if ov >= 1.5:
                            mx = ax0 + ux * 0.5 * (lo + hi)
                            my = ay0 + uy * 0.5 * (lo + hi)
                            kp = "+".join(sorted([ski, skj]))
                            coplanar_edges.append((round(ov, 1), round(y_ov, 1), round(md, 4), kp, tki, round(mx, 1), round(-my, 1)))
                            break

    # 2. Check SEC.walks vs building footprints!
    walk_clips_bldg = 0
    walk_close_chord_clips = 0
    pingpong_walk_loops = sum(1 for w in walks if w[5])
    walk_clip_examples = []
    for pts, wkind, tkey, is_open, close_d, is_pp in walks:
        ls = LineString(pts)
        hits = btree.query(ls, predicate="intersects")
        bad_len = 0.0
        for hi in hits:
            p = polys[hi]
            inter = ls.intersection(p)
            if not inter.is_empty and inter.length > 0.4:
                bad_len += float(inter.length)
        if bad_len > 0.4:
            walk_clips_bldg += 1
            if len(walk_clip_examples) < 20:
                c = ls.centroid
                walk_clip_examples.append({"tile": tkey, "kind": wkind, "inside_bldg_m": round(bad_len, 1), "x": round(c.x, 1), "z": round(-c.y, 1)})
        if is_open:
            chord = LineString([pts[-1], pts[0]])
            chits = btree.query(chord, predicate="intersects")
            for hi in chits:
                inter = chord.intersection(polys[hi])
                if not inter.is_empty and inter.length > 0.5:
                    walk_close_chord_clips += 1
                    break

    overlap_pairs.sort(key=lambda x: (-x[0], -x[1]))
    coplanar_edges.sort(key=lambda x: (-x[0], -x[1]))
    open_walk_examples.sort(key=lambda x: -x["close_jump_m"])
    walk_clip_examples.sort(key=lambda x: -x["inside_bldg_m"])

    # Also check buildings with base > 0.1m (building:part whose collider base in worker.js = gzMax + base instead of gzMin - 4!)
    elev_base_bldgs = sum(1 for b in bldgs if b[9] > 0.1)
    steep_drop_bldgs = sum(1 for b in bldgs if (b[8] - b[7]) > 4.0)

    rep = {
        "elapsed_s": round(time.time() - t0, 2),
        "core_buildings_checked": len(bldgs),
        "building_overlaps": {
            "total_overlapping_pairs_gt_1_5m2": len(overlap_pairs),
            "detail_vs_detail": detail_vs_detail_overlap,
            "detail_vs_far": detail_vs_far_overlap,
            "far_vs_far": far_vs_far_overlap,
            "same_tile": same_tile_dup,
            "cross_tile": cross_tile_overlap,
            "top20": [{"area_m2": x[0], "y_ov_m": x[1], "pair": x[2], "tile": x[3], "x": x[4], "z": x[5], "baseA": x[6], "baseB": x[7]} for x in overlap_pairs[:20]],
        },
        "coplanar_shared_wall_edges": {
            "total_edges_dist_lt_5cm_len_gt_1_5m": len(coplanar_edges),
            "zero_gap_edges_lt_1cm": sum(1 for e in coplanar_edges if e[2] < 0.01),
            "top20": [{"len_m": x[0], "y_ov_m": x[1], "gap_m": x[2], "pair": x[3], "tile": x[4], "x": x[5], "z": x[6]} for x in coplanar_edges[:20]],
        },
        "walks_audit": {
            "total_core_loops": total_walk_loops,
            "pingpong_open_centerlines_flags1": pingpong_walk_loops,
            "open_loops_jump_gt_2_5m": open_walk_loops,
            "open_loops_pct": round(100.0 * open_walk_loops / max(1, total_walk_loops), 1),
            "open_loops_whose_closing_chord_pierces_buildings": walk_close_chord_clips,
            "loops_directly_intersecting_buildings": walk_clips_bldg,
            "top_open_loops": open_walk_examples[:12],
            "top_bldg_clipping_loops": walk_clip_examples[:12],
        },
        "collider_risk_buildings": {
            "elevated_base_parts": elev_base_bldgs,
            "steep_footprint_drop_gt_4m": steep_drop_bldgs,
        },
    }
    out_p = Path(__file__).parent / "phase5_overlap_walls_report.json"
    out_p.write_text(json.dumps(rep, indent=2, ensure_ascii=False))

    print(f"=== Phase 5 Offline Overlap-Walls & Walks Scanner ({rep['elapsed_s']}s, {len(bldgs)} core buildings) ===")
    bo = rep["building_overlaps"]
    ce = rep["coplanar_shared_wall_edges"]
    wa = rep["walks_audit"]
    print(f"[BUILDING OVERLAPS >1.5m2] total={bo['total_overlapping_pairs_gt_1_5m2']} (det+det={bo['detail_vs_detail']}, det+far={bo['detail_vs_far']}, far+far={bo['far_vs_far']}, same_tile={bo['same_tile']}, cross_tile={bo['cross_tile']})")
    for e in bo["top20"][:8]:
        print(f"  OVERLAP ({e['x']:7.1f}, {e['z']:7.1f}) tile={e['tile']} {e['pair']} area={e['area_m2']}m2 y_ov={e['y_ov_m']}m base=({e['baseA']},{e['baseB']})")
    print(f"[COPLANAR SHARED WALLS <5cm] total={ce['total_edges_dist_lt_5cm_len_gt_1_5m']} (gap<1cm={ce['zero_gap_edges_lt_1cm']})")
    for e in ce["top20"][:8]:
        print(f"  COPLANAR ({e['x']:7.1f}, {e['z']:7.1f}) tile={e['tile']} {e['pair']} len={e['len_m']}m y_ov={e['y_ov_m']}m gap={e['gap_m']}m")
    print(f"[SEC.WALKS] total={wa['total_core_loops']} | OPEN (>2.5m jump)={wa['open_loops_jump_gt_2_5m']} ({wa['open_loops_pct']}%) | closing-chord pierces bldg={wa['open_loops_whose_closing_chord_pierces_buildings']} | loop intersects bldg={wa['loops_directly_intersecting_buildings']}")
    for e in wa["top_open_loops"][:6]:
        print(f"  OPEN_WALK tile={e['tile']} kind={e['kind']} jump={e['close_jump_m']}m start={e['start_xz']} end={e['end_xz']}")
    for e in wa["top_bldg_clipping_loops"][:6]:
        print(f"  CLIP_WALK tile={e['tile']} kind={e['kind']} inside_bldg={e['inside_bldg_m']}m at ({e['x']}, {e['z']})")


if __name__ == "__main__":
    main()
