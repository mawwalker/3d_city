#!/usr/bin/env python3
"""Phase 5 Visual Flicker Heatmap & Pedestrian Motion-Trail Analyzer.

Usage:
  python3 p5_analyze.py shots/p5_hunt
"""
import json, math, os, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops

def analyze_flicker_pair(path_a, path_b, out_heatmap, label=""):
    im_a = Image.open(path_a).convert("RGB")
    im_b = Image.open(path_b).convert("RGB")
    W, H = im_a.size

    # Per-pixel max channel abs diff
    diff_rgb = ImageChops.difference(im_a, im_b)
    r, g, b = diff_rgb.split()
    # max(r, g, b)
    max_d = ImageChops.lighter(ImageChops.lighter(r, g), b)

    # Strong pixel flip mask (> 28 / 255)
    raw_mask = max_d.point(lambda v: 255 if v >= 28 else 0)
    # Eroded mask (3x3 min filter) eliminates 1px edge parallax lines, keeps solid Z-fighting patches!
    patch_mask = raw_mask.filter(ImageFilter.MinFilter(3))
    # Dilate back slightly so remaining solid Z-fighting patches are visually bold
    patch_vis = patch_mask.filter(ImageFilter.MaxFilter(5))

    # Compute metrics on 16x16 grid cells to locate exact Z-fighting wall patches
    raw_bytes = raw_mask.tobytes()
    patch_bytes = patch_mask.tobytes()
    max_bytes = max_d.tobytes()

    raw_px = sum(1 for v in raw_bytes if v)
    patch_px = sum(1 for v in patch_bytes if v)

    # Find top grid cells (32x32 px tiles) with high solid patch flip density
    CELL = 32
    gw, gh = (W + CELL - 1) // CELL, (H + CELL - 1) // CELL
    hot_cells = []
    for cy in range(gh):
        y0, y1 = cy * CELL, min(H, (cy + 1) * CELL)
        for cx in range(gw):
            x0, x1 = cx * CELL, min(W, (cx + 1) * CELL)
            cnt = 0
            sum_d = 0
            for y in range(y0, y1):
                off = y * W + x0
                row_p = patch_bytes[off:off + (x1 - x0)]
                row_d = max_bytes[off:off + (x1 - x0)]
                for i, v in enumerate(row_p):
                    if v:
                        cnt += 1
                        sum_d += row_d[i]
            if cnt >= 18:
                hot_cells.append({
                    "cx": cx, "cy": cy,
                    "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                    "patchPx": cnt,
                    "meanDiff": round(sum_d / cnt, 1),
                })

    hot_cells.sort(key=lambda c: -c["patchPx"])

    # Merge contiguous hot cells into connected patch bounding boxes (BFS)
    cell_map = {(c["cx"], c["cy"]): c for c in hot_cells}
    visited = set()
    clusters = []
    for key, c in cell_map.items():
        if key in visited:
            continue
        q = [key]
        visited.add(key)
        xs0, ys0, xs1, ys1, total_px, max_md = [], [], [], [], 0, 0.0
        while q:
            ux, uy = q.pop()
            uc = cell_map[(ux, uy)]
            xs0.append(uc["x0"]); ys0.append(uc["y0"])
            xs1.append(uc["x1"]); ys1.append(uc["y1"])
            total_px += uc["patchPx"]
            max_md = max(max_md, uc["meanDiff"])
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nk = (ux + dx, uy + dy)
                    if nk in cell_map and nk not in visited:
                        visited.add(nk)
                        q.append(nk)
        clusters.append({
            "bbox": [min(xs0), min(ys0), max(xs1), max(ys1)],
            "patchPx": total_px,
            "maxMeanDiff": max_md,
        })
    clusters.sort(key=lambda cl: -cl["patchPx"])

    # Render heatmap overlay: dimmed base + magenta/yellow highlight on raw/patch diffs + green boxes on clusters
    base = im_a.point(lambda v: int(v * 0.45))
    overlay = Image.new("RGB", (W, H), (255, 40, 90))
    # Faint orange for raw 1px diffs, bright neon red-magenta for solid Z-fighting patches
    orange = Image.new("RGB", (W, H), (255, 165, 0))
    out = Image.composite(orange, base, raw_mask.point(lambda v: 130 if v else 0))
    out = Image.composite(overlay, out, patch_vis.point(lambda v: 235 if v else 0))

    draw = ImageDraw.Draw(out)
    for idx, cl in enumerate(clusters[:8]):
        x0, y0, x1, y1 = cl["bbox"]
        draw.rectangle([x0 - 2, y0 - 2, x1 + 2, y1 + 2], outline=(60, 255, 110), width=3)
        draw.text((x0 + 3, max(4, y0 - 16)), f"#{idx+1} {cl['patchPx']}px d={cl['maxMeanDiff']}", fill=(120, 255, 150))

    # Top banner
    draw.rectangle([0, 0, W, 30], fill=(10, 14, 22))
    draw.text((10, 8), f"{label} | patchPx={patch_px} | clusters={len(clusters)} | rawPx={raw_px}", fill=(255, 240, 180))
    out.save(out_heatmap)

    return {
        "rawPx": raw_px,
        "patchPx": patch_px,
        "hotCells": len(hot_cells),
        "clusters": clusters[:10],
        "heatmap": str(out_heatmap),
    }


def analyze_ped_burst(frames, out_trail, out_strip, label=""):
    ims = [Image.open(p).convert("RGB") for p in frames]
    W, H = ims[0].size

    # Build 5-color motion trail composite (shows every moving pedestrian/vehicle across f0->f4 in R/O/Y/C/M)
    colors = [
        (255, 50, 50),    # f0 -> f1
        (255, 165, 20),   # f1 -> f2
        (255, 245, 40),   # f2 -> f3
        (40, 240, 255),   # f3 -> f4
    ]
    # Also compute pixel deviation from median-ish baseline (mean of all 5 frames) so each frame's moving subjects light up!
    # Simple fast approach: for each step k=0..3, mask pixels where |im[k+1] - im[k]| > 26
    trail = ims[0].point(lambda v: int(v * 0.62))
    step_counts = []
    for k in range(4):
        d = ImageChops.difference(ims[k], ims[k + 1])
        r, g, b = d.split()
        md = ImageChops.lighter(ImageChops.lighter(r, g), b)
        mask = md.point(lambda v: 215 if v >= 28 else 0)
        step_counts.append(sum(1 for v in mask.tobytes() if v))
        tint = Image.new("RGB", (W, H), colors[k])
        trail = Image.composite(tint, trail, mask)

    draw = ImageDraw.Draw(trail)
    draw.rectangle([0, 0, W, 32], fill=(10, 14, 22))
    draw.text((10, 9), f"{label} | 5-frame motion trail (dt=0.6s): RED(0-1) ORG(1-2) YEL(2-3) CYN(3-4) | dPx={step_counts}", fill=(255, 245, 200))
    trail.save(out_trail)

    # Build 5-frame horizontal contact strip (5 x 640x360 = 3200x360)
    tw, th = 640, 360
    strip = Image.new("RGB", (tw * 5, th + 28), (12, 16, 24))
    sd = ImageDraw.Draw(strip)
    sd.text((10, 6), f"{label} — 5-frame burst (t=0.0s, 0.6s, 1.2s, 1.8s, 2.4s)", fill=(255, 245, 200))
    for i, im in enumerate(ims):
        thumb = im.resize((tw, th), Image.Resampling.LANCZOS)
        strip.paste(thumb, (i * tw, 28))
        sd.rectangle([i * tw + 6, 34, i * tw + 86, 56], fill=(10, 14, 22))
        sd.text((i * tw + 12, 38), f"t = {i * 0.6:.1f}s", fill=(120, 255, 180))
    strip.save(out_strip, quality=92)
    return {"stepMovedPx": step_counts, "trail": str(out_trail), "strip": str(out_strip)}


def make_sheet(img_paths, out_path, cols=3, width=1920):
    if not img_paths:
        return
    ims = [Image.open(p).convert("RGB") for p in img_paths]
    rows = math.ceil(len(ims) / cols)
    cw = width // cols
    ch = int(cw * ims[0].height / ims[0].width)
    canvas = Image.new("RGB", (cw * cols, ch * rows), (12, 16, 24))
    for i, im in enumerate(ims):
        r, c = divmod(i, cols)
        canvas.paste(im.resize((cw, ch), Image.Resampling.LANCZOS), (c * cw, r * ch))
    canvas.save(out_path, quality=90)


def main():
    d = Path(sys.argv[1])
    meta = json.loads((d / "meta.json").read_text())
    report = {"flicker": [], "flicker_taa": [], "ped": []}

    hm_paths = []
    for item in meta.get("flicker", []):
        name = item["name"]
        res = analyze_flicker_pair(item["a"], item["b"], d / f"hm_{name}.png", label=f"{name} (taa=0, +0.05m fwd)")
        res["name"] = name
        res["pose"] = item["pose"]
        report["flicker"].append(res)
        hm_paths.append(res["heatmap"])
        if item.get("taaPair"):
            tres = analyze_flicker_pair(
                item["taaPair"]["a"], item["taaPair"]["b"],
                d / f"hm_{name}_taa.png",
                label=f"{name} (taa=1, +0.06m +0.35deg)"
            )
            tres["name"] = name + "_taa"
            tres["pose"] = item["pose"]
            report["flicker_taa"].append(tres)

    report["flicker"].sort(key=lambda r: -r["patchPx"])
    report["flicker_taa"].sort(key=lambda r: -r["patchPx"])

    trail_paths = []
    for item in meta.get("ped", []):
        name = item["name"]
        pres = analyze_ped_burst(item["frames"], d / f"trail_{name}.png", d / f"strip_{name}.jpg", label=name)
        pres["name"] = name
        pres["pose"] = item["pose"]
        report["ped"].append(pres)
        trail_paths.append(pres["trail"])

    # Sort heatmap sheet worst-first so worst flicker jumps out immediately
    make_sheet([r["heatmap"] for r in report["flicker"]], d.parent / f"{d.name}_flicker_sheet.jpg", cols=3, width=2100)
    make_sheet(trail_paths, d.parent / f"{d.name}_ped_trails_sheet.jpg", cols=2, width=2000)

    (d / "analysis.json").write_text(json.dumps(report, indent=2))
    print("=== FLICKER RANKING (taa=0 pure +0.05m fwd) ===")
    for r in report["flicker"]:
        p = r["pose"]
        top_cl = r["clusters"][0] if r["clusters"] else None
        print(f"  {r['name']:28s} patchPx={r['patchPx']:6d} clusters={len(r['clusters']):2d} rawPx={r['rawPx']:6d} pos=({p['x']},{p['y']},{p['z']}) top={top_cl}")
    if report["flicker_taa"]:
        print("=== FLICKER TAA=1 (+0.06m, +0.35deg) ===")
        for r in report["flicker_taa"]:
            print(f"  {r['name']:28s} patchPx={r['patchPx']:6d} clusters={len(r['clusters']):2d} rawPx={r['rawPx']:6d}")
    print("=== PEDESTRIAN BURSTS ===")
    for r in report["ped"]:
        p = r["pose"]
        print(f"  {r['name']:28s} shown={p['peopleShown']:4d} dPx={r['stepMovedPx']} pos=({p['x']},{p['y']},{p['z']})")

if __name__ == "__main__":
    main()
