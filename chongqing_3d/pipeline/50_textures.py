"""Build high-contrast photographic 1024x1024 PBR material texture arrays (38 layers, 4x10 grid) for Chongqing 3D.

Phase 3 Photorealism Overhaul:
  Combines genuine 1K CC0 photographic ambientCG/PolyHaven scans with precision architectural normal/roughness/AO
  detail overlays so EVERY surface has crisp physical grit, mortar joints, formwork seams, grout jitter, curved
  tile ridges, weathered streaks, and micro-roughness variation — zero smooth clay/plastic CG look!

Outputs:
  site/assets/mat_albedo.webp   4096x10240 RGB (sRGB, 65% AO + crevice darkening baked)
  site/assets/mat_nr.webp       4096x10240 RGB (OpenGL normal.x, normal.y, roughness)
  site/assets/materials.json
  data/debug/materials_contact.jpg

usage: 50_textures.py <raw_dir> <site_assets_dir> [size]
"""
import sys, os, io, json, zipfile, time
import numpy as np, requests
from PIL import Image, ImageFilter

RAW, OUT = sys.argv[1:3]
SIZE = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
os.makedirs(RAW, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(OUT, "..", "..", "data", "debug"), exist_ok=True)
UA = {"User-Agent": "chongqing-3d-build/1.0"}

# (name, source, metres_per_repeat, detail_profile)
MATERIALS = [
    # 0..27: base set (identical order & names to shanghai_3d)
    ("asphalt", "acg:Asphalt023S", 3.0, "asphalt_real"),
    ("asphalt_worn", "acg:Asphalt026C", 4.0, "asphalt_worn"),
    ("pavers", "acg:PavingStones035", 2.0, "pavers_crisp"),
    ("pavers_brick", "acg:PavingStones129", 2.0, "pavers_crisp"),
    ("slabs", "acg:PavingStones125A", 3.5, "granite_slabs"),
    ("concrete", "acg:Concrete034", 3.0, "concrete_formwork"),
    ("grass", "acg:Grass004", 2.5, "foliage_rich"),
    ("soil", "acg:Ground048", 2.5, "soil_grit"),
    ("leaves", "acg:ScatteredLeaves008", 2.5, "foliage_rich"),
    ("gravel", "acg:Gravel043", 2.0, "soil_grit"),
    ("plaster", "acg:Plaster001", 3.0, "plaster_micro"),
    ("plaster_stained", "acg:Plaster007", 3.0, "plaster_streaks"),
    ("tiles_white", "acg:Tiles133A", 1.2, "tiles_crisp"),
    ("brick_red", "acg:Bricks059", 2.4, "brick_deep"),
    ("brick_grey", "acg:Bricks061", 2.4, "brick_deep"),
    ("concrete_panel", "acg:Concrete010", 3.0, "concrete_formwork"),
    ("pebbledash", "acg:Concrete049", 2.0, "pebbledash_grit"),
    ("granite", "acg:Granite002A", 2.5, "granite_slabs"),
    ("metal_panel", "acg:MetalPlates006", 3.0, "metal_seams"),
    ("corrugated", "acg:CorrugatedSteel005", 2.0, "corrugated_crisp"),
    ("roof_clay", "acg:RoofingTiles014A", 2.4, "roof_curved"),
    ("roof_grey", "acg:RoofingTiles015A", 2.4, "roof_curved"),
    ("bitumen", "ph:bitumen", 3.0, "asphalt_worn"),
    ("bark", "ph:japanese_sycamore", 1.6, "bark_deep"),
    ("bark_rough", "ph:japanese_camphor_bark", 1.6, "bark_deep"),
    ("planks", "acg:Planks029L", 2.4, "wood_crisp"),
    ("marble", "acg:Marble012", 2.5, "marble_ashlar"),
    ("painted_metal", "acg:PaintedMetal010", 2.0, "painted_clean"),
    # 28..37: Chongqing-specific high-detail PBR materials
    ("sandstone", "acg:Rock030", 2.5, "cq_sandstone"),
    ("cliff_rock", "acg:Rock030", 4.0, "cq_cliff"),
    ("mosaic_tile", "acg:Tiles133A", 1.0, "cq_mosaic"),
    ("bayu_tile", "acg:RoofingTiles015A", 1.8, "cq_bayu_tile"),
    ("bayu_timber", "acg:Planks029L", 2.0, "cq_bayu_timber"),
    ("limestone", "acg:PavingStones125A", 2.5, "cq_limestone"),
    ("stone_steps", "acg:Granite002A", 2.0, "cq_stone_steps"),
    ("curtain_glass", "acg:PaintedMetal010", 3.0, "cq_curtain"),
    ("asphalt_wet", "acg:Asphalt023S", 3.0, "cq_asphalt_wet"),
    ("red_lacquer", "acg:Planks029L", 2.0, "cq_red_lacquer"),
]


def fetch_acg(aid):
    d = os.path.join(RAW, aid)
    z = os.path.join(d, aid + "_1K-JPG.zip")
    if not os.path.exists(z):
        os.makedirs(d, exist_ok=True)
        r = requests.get(f"https://ambientcg.com/get?file={aid}_1K-JPG.zip", headers=UA, timeout=60, allow_redirects=True)
        r.raise_for_status()
        open(z, "wb").write(r.content)
    zf = zipfile.ZipFile(z)
    names = zf.namelist()

    def get(suffix):
        for n in names:
            if n.endswith(suffix) and "/" not in n:
                return Image.open(io.BytesIO(zf.read(n)))
        return None
    return dict(color=get("_Color.jpg"), normal=get("_NormalGL.jpg"), rough=get("_Roughness.jpg"), ao=get("_AmbientOcclusion.jpg"))


def fetch_ph(pid):
    d = os.path.join(RAW, "ph_" + pid)
    os.makedirs(d, exist_ok=True)
    meta_p = os.path.join(d, "files.json")
    meta = json.load(open(meta_p))

    def get(*keys):
        for k in keys:
            if k in meta and "1k" in meta[k] and "jpg" in meta[k]["1k"]:
                url = meta[k]["1k"]["jpg"]["url"]
                p = os.path.join(d, os.path.basename(url))
                return Image.open(p) if os.path.exists(p) else None
        return None
    arm = get("arm")
    rough = get("Rough", "rough")
    ao = get("AO", "ao")
    if arm is not None:
        a = np.asarray(arm.convert("RGB"))
        if rough is None:
            rough = Image.fromarray(a[:, :, 1])
        if ao is None:
            ao = Image.fromarray(a[:, :, 0])
    return dict(color=get("Diffuse", "diffuse", "diff"), normal=get("nor_gl"), rough=rough, ao=ao)


# ================================================================ Periodic micro-detail & normal/roughness helpers
def periodic_noise(sz, freq, seed):
    """Smooth tileable 2D noise in [0, 1] at characteristic frequency `freq` cycles per tile."""
    rng = np.random.RandomState(seed)
    g = max(4, int(freq))
    arr = rng.rand(g, g).astype(np.float32)
    # Periodic upscale via 3x3 wrap padding + bicubic
    pad = np.tile(arr, (3, 3))
    im = Image.fromarray(np.clip(pad * 255, 0, 255).astype(np.uint8), "L").resize((sz * 3, sz * 3), Image.BICUBIC)
    return np.asarray(im, np.float32)[sz:sz * 2, sz:sz * 2] / 255.0


def add_height_normals(n_arr, h, strength=1.0):
    """Blend heightfield gradient into OpenGL tangent-space normal map (x right, y up)."""
    gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * strength
    gy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * strength
    nx = (n_arr[:, :, 0] - 128.0) / 127.0 - gx
    ny = (n_arr[:, :, 1] - 128.0) / 127.0 + gy  # OpenGL +Y is up (opposite image row)
    mag = np.sqrt(nx * nx + ny * ny + 1.0)
    out = n_arr.copy()
    out[:, :, 0] = np.clip((nx / mag * 0.5 + 0.5) * 255.0, 0, 255)
    out[:, :, 1] = np.clip((ny / mag * 0.5 + 0.5) * 255.0, 0, 255)
    return out


def boost_normals(n_arr, gain):
    out = n_arr.copy()
    out[:, :, :2] = np.clip(128.0 + (out[:, :, :2] - 128.0) * gain, 0, 255)
    return out


def stretch_roughness(r_arr, center_shift=0.0, contrast=1.35, lo=25, hi=248):
    m = r_arr.mean()
    return np.clip(m + center_shift + (r_arr - m) * contrast, lo, hi)


def rain_streaks(sz, seed):
    """Vertical Chongqing humid rain-drip streaks in [0, 1] (periodic)."""
    n_x = periodic_noise(sz, 36, seed)
    n_y = periodic_noise(sz, 4, seed + 17)
    n_fine = periodic_noise(sz, 96, seed + 33)
    # Stretch vertically by taking column-averaged mix
    col_bias = n_x.mean(axis=0, keepdims=True)
    return np.clip(0.55 * col_bias + 0.30 * n_y + 0.15 * n_fine, 0.0, 1.0)


def apply_detail(profile, col_arr, n_arr, r_arr, li):
    c = col_arr.astype(np.float32)
    n = n_arr.astype(np.float32)
    r = r_arr.astype(np.float32)
    sz = c.shape[0]
    yy, xx = np.mgrid[0:sz, 0:sz].astype(np.float32)
    u = xx / sz
    v = yy / sz

    if profile == "cq_sandstone":
        # Heavy weathered Chongqing dressed sandstone retaining wall (条石堡坎):
        # Natural Rock030 base, correlated warm ochre/grey per-block variation (NO rainbow!), deep dark mortar & moss!
        rows, cols = 8, 4
        ry = v * rows
        ri = np.floor(ry).astype(int)
        rx = u * cols + (ri % 2) * 0.5
        ci = np.floor(rx).astype(int) % cols
        fy = ry - np.floor(ry)
        fx = rx - np.floor(rx)
        # Chiseled beveled mortar joints with subtle organic wobble
        wob = (periodic_noise(sz, 16, 2805) - 0.5) * 0.045
        joint = np.minimum(np.minimum(fy, 1.0 - fy) * 1.35 + wob, np.minimum(fx, 1.0 - fx) * 1.15 + wob)
        mortar = np.clip((0.088 - joint) / 0.088, 0.0, 1.0)
        h_blk = np.clip(joint / 0.14, 0.0, 1.0)
        # Correlated scalar brightness + subtle warm/cool sandstone shift (authentic warm grey/ochre/buff)
        rng = np.random.RandomState(2801)
        blk_val = rng.uniform(0.80, 1.16, (rows, cols, 1)).astype(np.float32)
        blk_warm = rng.uniform(-0.055, 0.055, (rows, cols, 1)).astype(np.float32)
        blk_tint = blk_val * np.concatenate([1.0 + blk_warm, 1.0 + 0.25 * blk_warm, 1.0 - blk_warm], axis=2)
        bt = blk_tint[ri % rows, ci]
        grime = periodic_noise(sz, 10, 2802)
        fine = periodic_noise(sz, 64, 2804)
        streaks = rain_streaks(sz, 2803)
        moss = np.clip((mortar * 0.85 + (0.42 - grime)) * 1.3, 0.0, 1.0) * np.clip(streaks - 0.44, 0.0, 1.0) * 1.5
        # Lift Rock030 grey grain into warm Chongqing sandstone tone
        c = (c * 1.28 + 26.0) * np.array([1.06, 0.99, 0.85], np.float32) * bt
        c = c * (0.82 + 0.26 * grime[:, :, None]) * (0.90 + 0.16 * fine[:, :, None]) * (0.84 + 0.20 * (1.0 - streaks[:, :, None]))
        # Darken recessed mortar + damp moss in crevices
        c = c * (1.0 - 0.62 * mortar[:, :, None]) + np.array([32, 30, 26], np.float32) * (0.38 * mortar[:, :, None])
        c = c * (1.0 - 0.44 * moss[:, :, None]) + np.array([46, 64, 34], np.float32) * (0.44 * moss[:, :, None])
        n = boost_normals(n, 1.55)
        n = add_height_normals(n, h_blk * 2.5 + grime * 0.5 + fine * 0.25, strength=3.6)
        r = stretch_roughness(r, +18, 1.4, 120, 248)
        r = np.clip(r + mortar * 45 - moss * 30, 100, 250)

    elif profile == "cq_cliff":
        # Deeply craggy wet layered Chongqing sedimentary cliff rock with mossy ledges & strata cracks!
        grime = periodic_noise(sz, 8, 2901)
        strata = np.sin(v * np.pi * 16.0 + periodic_noise(sz, 6, 2902) * 3.8)
        crack = np.clip((np.abs(strata) < 0.14).astype(np.float32) * (0.5 + 0.5 * grime), 0.0, 1.0)
        moss_m = np.clip((periodic_noise(sz, 12, 2903) - 0.44) * 2.4, 0.0, 1.0)
        c = c * np.array([0.88, 0.88, 0.80]) * (0.76 + 0.38 * grime[:, :, None])
        c = c * (1.0 - 0.50 * crack[:, :, None])
        c = c * (1.0 - 0.52 * moss_m[:, :, None]) + np.array([46, 68, 34], np.float32) * (0.52 * moss_m[:, :, None])
        n = boost_normals(n, 1.75)
        n = add_height_normals(n, strata * 0.55 - crack * 1.4, strength=3.0)
        r = stretch_roughness(r, +10, 1.5, 95, 250)
        r = np.clip(r - moss_m * 30, 80, 250)

    elif profile == "cq_mosaic":
        # Iconic 1990s Chongqing rectangular ceramic facade tiles (马赛克/外墙砖):
        # Crisp recessed dark grout grid, subtle correlated per-tile value/warmth & gloss jitter + rain streaks!
        nx_t, ny_t = 16, 32
        tx = u * nx_t
        ty = v * ny_t
        ti = np.floor(tx).astype(int) % nx_t
        tj = np.floor(ty).astype(int) % ny_t
        fx = tx - np.floor(tx)
        fy = ty - np.floor(ty)
        edge = np.minimum(np.minimum(fx, 1.0 - fx), np.minimum(fy, 1.0 - fy) * 0.65)
        grout = np.clip((0.085 - edge) / 0.085, 0.0, 1.0)
        bevel = np.clip(edge / 0.14, 0.0, 1.0)
        rng = np.random.RandomState(3001)
        tile_v = rng.uniform(0.88, 1.10, (ny_t, nx_t, 1)).astype(np.float32)
        tile_w = rng.uniform(-0.025, 0.025, (ny_t, nx_t, 1)).astype(np.float32)
        tile_tint = tile_v * np.concatenate([1.0 + tile_w, 1.0 + 0.2 * tile_w, 1.0 - tile_w], axis=2)
        tile_r = rng.uniform(-20, 24, (ny_t, nx_t)).astype(np.float32)
        streaks = rain_streaks(sz, 3002)
        half = sz // 2
        t_c = np.tile(np.asarray(Image.fromarray(col_arr).resize((half, half), Image.LANCZOS), np.float32), (2, 2, 1))
        c = t_c * tile_tint[tj, ti] * np.array([0.96, 0.94, 0.90])
        c *= (0.85 + 0.17 * (1.0 - streaks[:, :, None]))
        c = c * (1.0 - 0.62 * grout[:, :, None]) + np.array([58, 56, 52], np.float32) * (0.62 * grout[:, :, None])
        n = add_height_normals(boost_normals(n, 1.25), bevel * 1.4, strength=3.4)
        r = np.clip(64.0 + tile_r[tj, ti] + (r - r.mean()) * 0.5 + grout * 155.0 + streaks * 28.0, 35, 240)

    elif profile == "tiles_crisp":
        # Crisp white/cream modern facade tile grid with distinct dark grout & gloss variation
        nx_t, ny_t = 8, 16
        tx, ty = u * nx_t, v * ny_t
        ti, tj = np.floor(tx).astype(int) % nx_t, np.floor(ty).astype(int) % ny_t
        fx, fy = tx - np.floor(tx), ty - np.floor(ty)
        edge = np.minimum(np.minimum(fx, 1.0 - fx), np.minimum(fy, 1.0 - fy) * 0.65)
        grout = np.clip((0.06 - edge) / 0.06, 0.0, 1.0)
        bevel = np.clip(edge / 0.11, 0.0, 1.0)
        rng = np.random.RandomState(1201)
        tv = rng.uniform(0.92, 1.07, (ny_t, nx_t, 1)).astype(np.float32)
        streaks = rain_streaks(sz, 1202)
        c = c * tv[tj, ti] * (0.90 + 0.12 * (1.0 - streaks[:, :, None]))
        c = c * (1.0 - 0.50 * grout[:, :, None]) + np.array([68, 66, 62], np.float32) * (0.50 * grout[:, :, None])
        n = add_height_normals(boost_normals(n, 1.35), bevel * 1.2, strength=3.2)
        r = np.clip(stretch_roughness(r, -12, 1.35, 38, 180) + grout * 135.0, 38, 240)

    elif profile in ("concrete_formwork", "plaster_streaks", "plaster_micro"):
        # Architectural concrete / plaster with crisp formwork panel seams, tie-rod dimples, aggregate & rain streaks!
        streaks = rain_streaks(sz, 500 + li)
        grit = periodic_noise(sz, 28, 600 + li)
        fine = periodic_noise(sz, 90, 700 + li)
        c = c * (0.86 + 0.22 * grit[:, :, None]) * (0.92 + 0.14 * fine[:, :, None])
        if profile == "concrete_formwork":
            px, py = u * 2.0, v * 4.0
            fx, fy = px - np.floor(px), py - np.floor(py)
            seam = np.clip((0.022 - np.minimum(np.minimum(fx, 1.0 - fx) * 1.4, np.minimum(fy, 1.0 - fy))) / 0.022, 0.0, 1.0)
            rng = np.random.RandomState(510 + li)
            pv = rng.uniform(0.91, 1.08, (4, 2, 1)).astype(np.float32)[np.floor(py).astype(int) % 4, np.floor(px).astype(int) % 2]
            d1 = np.hypot((fx - 0.22) * 1.0, (fy - 0.5) * 0.5)
            d2 = np.hypot((fx - 0.78) * 1.0, (fy - 0.5) * 0.5)
            dimple = np.clip((0.028 - np.minimum(d1, d2)) / 0.028, 0.0, 1.0)
            c = c * pv * (1.0 - 0.36 * seam[:, :, None]) * (1.0 - 0.45 * dimple[:, :, None])
            c *= (0.86 + 0.18 * (1.0 - streaks[:, :, None]))
            n = add_height_normals(boost_normals(n, 1.55), -seam * 1.1 - dimple * 1.4 + fine * 0.35, strength=3.0)
            r = stretch_roughness(r, +8, 1.45, 90, 245)
        elif profile == "plaster_streaks":
            c *= (0.80 + 0.26 * (1.0 - streaks[:, :, None]))
            n = add_height_normals(boost_normals(n, 1.50), fine * 0.4 + grit * 0.3, strength=2.2)
            r = stretch_roughness(r, +12, 1.5, 100, 248)
        else:
            c *= (0.90 + 0.12 * (1.0 - streaks[:, :, None]))
            n = add_height_normals(boost_normals(n, 1.45), fine * 0.32, strength=2.0)
            r = stretch_roughness(r, +6, 1.4, 110, 245)

    elif profile == "brick_deep":
        grime = periodic_noise(sz, 14, 1300 + li)
        streaks = rain_streaks(sz, 1310 + li)
        c = c * (0.84 + 0.28 * grime[:, :, None]) * (0.86 + 0.18 * (1.0 - streaks[:, :, None]))
        lum = c.mean(axis=2, keepdims=True) / 255.0
        c *= np.where(lum < 0.34, 0.78, 1.02)
        n = boost_normals(n, 1.65)
        r = stretch_roughness(r, +12, 1.5, 110, 248)

    elif profile in ("cq_bayu_tile", "roof_curved"):
        # Authentic curved cylindrical overlapping clay roof tiles (巴渝小青瓦 / 筒瓦):
        n_cols = 20 if profile == "cq_bayu_tile" else 16
        n_rows = 12 if profile == "cq_bayu_tile" else 10
        ridge = 0.5 + 0.5 * np.cos(u * 2.0 * np.pi * n_cols)
        fy = (v * n_rows) % 1.0
        step_ledge = np.clip(fy / 0.14, 0.0, 1.0)
        shadow_band = np.clip((0.18 - fy) / 0.18, 0.0, 1.0)
        h_tile = ridge * 0.85 + step_ledge * 0.55
        grime = periodic_noise(sz, 12, 3100 + li)
        if profile == "cq_bayu_tile":
            c = c * np.array([0.46, 0.50, 0.56]) * (0.78 + 0.36 * grime[:, :, None])
        else:
            c = c * (0.82 + 0.30 * grime[:, :, None])
        c *= (0.64 + 0.42 * ridge[:, :, None]) * (1.0 - 0.36 * shadow_band[:, :, None])
        n = add_height_normals(boost_normals(n, 1.35), h_tile, strength=5.2)
        r = stretch_roughness(r, -8, 1.45, 72, 232)
        r = np.clip(r + (1.0 - ridge) * 45.0, 65, 240)

    elif profile in ("asphalt_real", "asphalt_worn", "cq_asphalt_wet"):
        # Rich weathered asphalt stone aggregate grit, longitudinal paving joint & realistic tire-track polish!
        agg = periodic_noise(sz, 128, 100 + li)
        agg2 = periodic_noise(sz, 48, 150 + li)
        patch = periodic_noise(sz, 8, 200 + li)
        tire = 0.5 + 0.5 * np.sin(u * 2.0 * np.pi * 2.0 + 0.4)
        # Subtle straight weathered longitudinal tar paving seam (NO curly worm loops!)
        seam_d = np.abs(((u + (patch - 0.5) * 0.015) % 0.5) - 0.25)
        seam = np.clip((0.0045 - seam_d) / 0.0045, 0.0, 1.0) * (0.4 + 0.6 * patch)
        grit_m = 0.84 + 0.24 * agg[:, :, None] + 0.10 * (agg2[:, :, None] - 0.5)
        if profile == "cq_asphalt_wet":
            c = c * 0.56 * grit_m * (0.90 + 0.18 * patch[:, :, None]) * (1.0 - 0.22 * seam[:, :, None])
            r = np.clip(stretch_roughness(r, -65, 1.5, 18, 145) - tire * 24.0 + agg * 28.0, 16, 155)
        elif profile == "asphalt_worn":
            c = c * grit_m * (0.86 + 0.24 * patch[:, :, None]) * (1.0 - 0.28 * seam[:, :, None])
            r = np.clip(stretch_roughness(r, +5, 1.45, 75, 240) - tire * 28.0 + agg * 30.0, 65, 245)
        else:
            c = c * 0.84 * grit_m * (0.88 + 0.20 * patch[:, :, None]) * (1.0 - 0.24 * seam[:, :, None])
            r = np.clip(stretch_roughness(r, -5, 1.45, 78, 242) - tire * 30.0 + agg * 32.0, 70, 245)
        n = add_height_normals(boost_normals(n, 1.60), agg * 0.85 + agg2 * 0.35 - seam * 0.8, strength=3.2)

    elif profile == "pavers_crisp":
        # Preserve genuine photographic stone paver geometry (no conflicting synthetic grid!) — enhance relief & grit
        grime = periodic_noise(sz, 14, 3310 + li)
        fine = periodic_noise(sz, 72, 3320 + li)
        lum = c.mean(axis=2, keepdims=True) / 255.0
        c = c * (0.88 + 0.22 * grime[:, :, None]) * (0.93 + 0.14 * fine[:, :, None])
        c *= np.where(lum < 0.36, 0.78, 1.03)
        n = add_height_normals(boost_normals(n, 1.65), fine * 0.35, strength=2.4)
        r = stretch_roughness(r, +6, 1.5, 65, 245)

    elif profile == "cq_stone_steps":
        # Authentic Chongqing bluestone mountain stairs (青石梯坎):
        # 8 wide horizontal tread courses x 3 slabs, non-slip chisel grooves, smooth center footstep wear & mossy risers!
        gy_n, gx_n = 8, 3
        ry = v * gy_n
        ri = np.floor(ry).astype(int)
        rx = u * gx_n + (ri % 2) * 0.5
        ci = np.floor(rx).astype(int) % gx_n
        fx, fy = rx - np.floor(rx), ry - np.floor(ry)
        edge = np.minimum(np.minimum(fx, 1.0 - fx) * 1.4, np.minimum(fy, 1.0 - fy))
        joint = np.clip((0.065 - edge) / 0.065, 0.0, 1.0)
        riser_shadow = np.clip((0.18 - fy) / 0.18, 0.0, 1.0)
        bevel = np.clip(edge / 0.11, 0.0, 1.0)
        # Non-slip chiseled horizontal grooves near each step nose
        chisel = (0.5 + 0.5 * np.sin(fy * np.pi * 16.0)) * np.clip((0.45 - fy) / 0.25, 0.0, 1.0) * (1.0 - joint)
        rng = np.random.RandomState(3401)
        sv = rng.uniform(0.86, 1.12, (gy_n, gx_n, 1)).astype(np.float32)[ri % gy_n, ci]
        grime = periodic_noise(sz, 12, 3402)
        moss = np.clip(joint * (0.6 + 0.6 * grime), 0.0, 1.0) * 0.65
        c = c * np.array([0.74, 0.80, 0.86], np.float32) * sv * (0.84 + 0.28 * grime[:, :, None])
        c = c * (1.0 - 0.30 * riser_shadow[:, :, None]) * (1.0 - 0.08 * chisel[:, :, None])
        c = c * (1.0 - 0.55 * joint[:, :, None]) + np.array([34, 38, 34], np.float32) * (0.45 * joint[:, :, None])
        c = c * (1.0 - 0.38 * moss[:, :, None]) + np.array([46, 66, 36], np.float32) * (0.38 * moss[:, :, None])
        n = add_height_normals(boost_normals(n, 1.45), bevel * 1.6 + chisel * 0.25 - riser_shadow * 0.6, strength=3.8)
        # Foot-worn bluestone treads have slight satin sheen in the middle vs rough mossy edges
        wear = 0.5 + 0.5 * np.cos((u - 0.5) * 2.0 * np.pi)
        r = np.clip(stretch_roughness(r, +8, 1.4, 72, 238) - wear * 28.0 + joint * 60.0, 62, 245)

    elif profile in ("granite_slabs", "cq_limestone", "marble_ashlar"):
        # Beveled architectural ashlar granite / warm Chongqing limestone / marble facade panels!
        gx_n, gy_n = 4, 8
        ry = v * gy_n
        ri = np.floor(ry).astype(int)
        rx = u * gx_n + (ri % 2) * 0.5
        ci = np.floor(rx).astype(int) % gx_n
        fx, fy = rx - np.floor(rx), ry - np.floor(ry)
        edge = np.minimum(np.minimum(fx, 1.0 - fx), np.minimum(fy, 1.0 - fy))
        joint = np.clip((0.048 - edge) / 0.048, 0.0, 1.0)
        bevel = np.clip(edge / 0.09, 0.0, 1.0)
        rng = np.random.RandomState(3300 + li)
        sv = rng.uniform(0.90, 1.09, (gy_n, gx_n, 1)).astype(np.float32)[ri % gy_n, ci]
        grime = periodic_noise(sz, 14, 3310 + li)
        if profile == "cq_limestone":
            c = c * np.array([1.10, 1.02, 0.88]) * 0.94
        c = c * sv * (0.88 + 0.20 * grime[:, :, None])
        c = c * (1.0 - 0.50 * joint[:, :, None]) + np.array([40, 38, 36], np.float32) * (0.50 * joint[:, :, None])
        n = add_height_normals(boost_normals(n, 1.45), bevel * 1.4 + grime * 0.25, strength=3.4)
        r = stretch_roughness(r, +4, 1.45, 50, 238)
        r = np.clip(r + joint * 55.0, 45, 245)

    elif profile in ("cq_bayu_timber", "wood_crisp", "cq_red_lacquer"):
        # Crisp architectural timber planks with elongated fibrous wood grain & recessed plank seams (NO blobby clouds!)
        n_planks = 8
        py = v * n_planks
        pi = np.floor(py).astype(int) % n_planks
        fy = py - np.floor(py)
        seam = np.clip((0.032 - np.minimum(fy, 1.0 - fy)) / 0.032, 0.0, 1.0)
        bevel = np.clip(np.minimum(fy, 1.0 - fy) / 0.065, 0.0, 1.0)
        # Elongated horizontal wood fibers (high vertical freq, low horizontal freq)
        rng = np.random.RandomState(3200 + li)
        fiber_g = rng.rand(128, 12).astype(np.float32)
        fiber_pad = np.tile(fiber_g, (3, 3))
        fiber = np.asarray(Image.fromarray((fiber_pad * 255).astype(np.uint8), "L").resize((sz * 3, sz * 3), Image.BICUBIC), np.float32)[sz:sz * 2, sz:sz * 2] / 255.0
        pv = rng.uniform(0.86, 1.12, (n_planks,)).astype(np.float32)[pi]
        grain_mod = (0.84 + 0.30 * fiber[:, :, None]) * pv[:, :, None]
        if profile == "cq_bayu_timber":
            c = c * np.array([0.46, 0.28, 0.17], np.float32) * grain_mod * (1.0 - 0.52 * seam[:, :, None])
            r = np.clip(stretch_roughness(r, -16, 1.4, 58, 195) + seam * 65.0 - fiber * 18.0, 48, 225)
        elif profile == "cq_red_lacquer":
            # Traditional Chongqing cinnabar/vermilion lacquered timber with crisp grain & satin sheen!
            lum = np.clip(c.mean(axis=2) / 255.0, 0.0, 1.0)
            base_r = np.clip(148.0 + 78.0 * lum, 0, 255)
            base_g = np.clip(22.0 + 26.0 * lum, 0, 255)
            base_b = np.clip(18.0 + 20.0 * lum, 0, 255)
            c = np.dstack([base_r, base_g, base_b]) * grain_mod * (1.0 - 0.48 * seam[:, :, None])
            r = np.clip(72.0 + (r - r.mean()) * 0.35 + seam * 75.0 - fiber * 16.0, 42, 165)
        else:
            c = c * grain_mod * (1.0 - 0.45 * seam[:, :, None])
            r = np.clip(stretch_roughness(r, 0, 1.4, 70, 225) + seam * 55.0, 62, 238)
        n = add_height_normals(boost_normals(n, 1.50), bevel * 1.1 + fiber * 0.35, strength=3.4)

    elif profile == "cq_curtain":
        # Clean brushed anodized architectural aluminum & glass-spandrel curtain-wall panels (2x4 mullion grid!)
        px, py = u * 2.0, v * 4.0
        pi, pj = np.floor(px).astype(int) % 2, np.floor(py).astype(int) % 4
        fx, fy = px - np.floor(px), py - np.floor(py)
        # Anodized mullion bar + dark EPDM rubber gasket channel
        d_edge = np.minimum(np.minimum(fx, 1.0 - fx) * 1.35, np.minimum(fy, 1.0 - fy))
        gasket = np.clip((0.018 - d_edge) / 0.018, 0.0, 1.0)
        mullion = np.clip((0.055 - d_edge) / 0.055, 0.0, 1.0) * (1.0 - gasket)
        # Subtle vertical brushed aluminum micro-grain
        rng = np.random.RandomState(3501)
        brush_g = rng.rand(12, 128).astype(np.float32)
        brush = np.asarray(Image.fromarray((np.tile(brush_g, (3, 3)) * 255).astype(np.uint8), "L").resize((sz * 3, sz * 3), Image.BICUBIC), np.float32)[sz:sz * 2, sz:sz * 2] / 255.0
        pv = rng.uniform(0.93, 1.07, (4, 2, 1)).astype(np.float32)[pj, pi]
        # Deep architectural steel-blue spandrel + silver-grey brushed aluminum mullion frame (zero rust blotches!)
        spandrel = np.array([62.0, 78.0, 96.0], np.float32)[None, None, :] * pv * (0.92 + 0.16 * brush[:, :, None])
        frame = np.array([136.0, 144.0, 152.0], np.float32)[None, None, :] * (0.93 + 0.12 * brush[:, :, None])
        c = spandrel * (1.0 - mullion[:, :, None]) + frame * mullion[:, :, None]
        c = c * (1.0 - 0.72 * gasket[:, :, None]) + np.array([22, 24, 28], np.float32) * (0.72 * gasket[:, :, None])
        n = add_height_normals(np.full_like(n, (128, 128, 255)), mullion * 0.9 - gasket * 1.4 + brush * 0.08, strength=3.4)
        # Mirror-low roughness on spandrel glass (~0.12), brushed satin on mullions (~0.32), matte gasket (~0.82)
        r = np.clip(32.0 + mullion * 56.0 + gasket * 175.0 + brush * 12.0, 22, 220)

    elif profile == "painted_clean":
        # Clean architectural painted steel cladding / bridge steelwork panels (NO heavy rust spots!)
        px, py = u * 4.0, v * 4.0
        pi, pj = np.floor(px).astype(int) % 4, np.floor(py).astype(int) % 4
        fx, fy = px - np.floor(px), py - np.floor(py)
        seam = np.clip((0.022 - np.minimum(np.minimum(fx, 1.0 - fx), np.minimum(fy, 1.0 - fy))) / 0.022, 0.0, 1.0)
        rng = np.random.RandomState(2701)
        pv = rng.uniform(0.95, 1.04, (4, 4, 1)).astype(np.float32)[pj, pi]
        micro = periodic_noise(sz, 96, 2702)
        streaks = rain_streaks(sz, 2703)
        # Neutral bright painted steel enamel base so per-material/vertex tint multiplies cleanly without rust blotches
        c = np.full_like(c, (216.0, 218.0, 214.0)) * pv * (0.94 + 0.10 * micro[:, :, None]) * (0.92 + 0.10 * (1.0 - streaks[:, :, None]))
        c = c * (1.0 - 0.42 * seam[:, :, None])
        n = add_height_normals(np.full_like(n, (128, 128, 255)), -seam * 1.2 + micro * 0.18, strength=3.0)
        r = np.clip(74.0 + micro * 26.0 + streaks * 24.0 + seam * 95.0, 48, 210)

    elif profile in ("metal_seams", "corrugated_crisp"):
        px, py = u * 4.0, v * 4.0
        fx, fy = px - np.floor(px), py - np.floor(py)
        seam = np.clip((0.024 - np.minimum(np.minimum(fx, 1.0 - fx), np.minimum(fy, 1.0 - fy))) / 0.024, 0.0, 1.0)
        c = c * (1.0 - 0.35 * seam[:, :, None])
        r = stretch_roughness(r, -10, 1.4, 32, 175)
        n = add_height_normals(boost_normals(n, 1.45), -seam * 1.3, strength=3.2)

    else:
        n = boost_normals(n, 1.55)
        r = stretch_roughness(r, +4, 1.35, 55, 248)

    return np.clip(c, 0, 255).astype(np.uint8), np.clip(n, 0, 255).astype(np.uint8), np.clip(r, 0, 255).astype(np.uint8)


albedo_layers, nra_layers, meta = [], [], {}
for li, (name, src, metres, profile) in enumerate(MATERIALS):
    kind, sid = src.split(":")
    t = time.time()
    m = fetch_acg(sid) if kind == "acg" else fetch_ph(sid)
    rs = lambda im, mode: None if im is None else im.convert(mode).resize((SIZE, SIZE), Image.LANCZOS)
    col = rs(m["color"], "RGB") or Image.new("RGB", (SIZE, SIZE), (128, 128, 128))
    nor = rs(m["normal"], "RGB")
    rough = rs(m["rough"], "L")
    ao = rs(m["ao"], "L")
    n = np.asarray(nor) if nor is not None else np.full((SIZE, SIZE, 3), (128, 128, 255), np.uint8)
    r = np.asarray(rough) if rough is not None else np.full((SIZE, SIZE), 200, np.uint8)
    a = np.asarray(ao) if ao is not None else np.full((SIZE, SIZE), 255, np.uint8)
    col_arr = np.asarray(col)
    if profile:
        col_arr, n, r = apply_detail(profile, col_arr, n, r, li)
    nra = np.dstack([n[:, :, 0], n[:, :, 1], r]).astype(np.uint8)
    # Bake 65% cavity AO in linear light for tactile physical depth!
    c = col_arr.astype(np.float32) / 255.0
    lin_ = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4) * (0.35 + 0.65 * (a.astype(np.float32) / 255.0))[:, :, None]
    col_final = np.clip(np.where(lin_ <= 0.0031308, lin_ * 12.92, 1.055 * lin_ ** (1 / 2.4) - 0.055) * 255.0 + 0.5, 0, 255).astype(np.uint8)
    albedo_layers.append(col_final)
    nra_layers.append(nra)
    c2 = col_final.astype(np.float32) / 255.0
    lin = np.where(c2 <= 0.04045, c2 / 12.92, ((c2 + 0.055) / 1.055) ** 2.4).reshape(-1, 3).mean(0)
    meta[name] = dict(layer=li, metres=metres, source=src, mean=[round(float(v), 4) for v in lin], rough=round(float(r.mean() / 255.0), 3))
    print(f"{li:2d} {name:<16} {profile:<18} mean lin {meta[name]['mean']} rough {meta[name]['rough']} ({time.time() - t:.1f}s)", flush=True)

COLS = 4
ROWS = (len(MATERIALS) + COLS - 1) // COLS
grid_alb = np.zeros((ROWS * SIZE, COLS * SIZE, 3), np.uint8)
grid_nra = np.zeros((ROWS * SIZE, COLS * SIZE, 3), np.uint8)
for li in range(len(MATERIALS)):
    r_, c_ = divmod(li, COLS)
    grid_alb[r_ * SIZE:(r_ + 1) * SIZE, c_ * SIZE:(c_ + 1) * SIZE] = albedo_layers[li]
    grid_nra[r_ * SIZE:(r_ + 1) * SIZE, c_ * SIZE:(c_ + 1) * SIZE] = nra_layers[li]
alb = Image.fromarray(grid_alb, "RGB")
nra = Image.fromarray(grid_nra, "RGB")
alb.save(os.path.join(OUT, "mat_albedo.webp"), quality=86, method=4)
nra.save(os.path.join(OUT, "mat_nr.webp"), quality=92, method=4)
json.dump(dict(size=SIZE, layers=len(MATERIALS), cols=COLS, rows=ROWS, materials=meta), open(os.path.join(OUT, "materials.json"), "w"), indent=1)
# Contact preview of the 10 Chongqing key layers + asphalt + concrete + brick + full 38-layer sheet
prev_idx = [0, 2, 5, 11, 13, 15, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37]
prev = np.zeros((4 * 256, 4 * 256, 3), np.uint8)
for pi, li in enumerate(prev_idx):
    rr, cc = divmod(pi, 4)
    prev[rr * 256:(rr + 1) * 256, cc * 256:(cc + 1) * 256] = np.asarray(Image.fromarray(albedo_layers[li]).resize((256, 256), Image.LANCZOS))
Image.fromarray(prev, "RGB").save(os.path.join(OUT, "..", "..", "data", "debug", "materials_contact.jpg"), quality=88)
all38 = np.zeros((5 * 192, 8 * 192, 3), np.uint8)
for li in range(len(MATERIALS)):
    rr, cc = divmod(li, 8)
    all38[rr * 192:(rr + 1) * 192, cc * 192:(cc + 1) * 192] = np.asarray(Image.fromarray(albedo_layers[li]).resize((192, 192), Image.LANCZOS))
Image.fromarray(all38, "RGB").save(os.path.join(OUT, "..", "..", "data", "debug", "materials_all38.jpg"), quality=86)
print("grid:", alb.size, f"({COLS}x{ROWS})", os.path.getsize(os.path.join(OUT, "mat_albedo.webp")) // 1024, "KB,", os.path.getsize(os.path.join(OUT, "mat_nr.webp")) // 1024, "KB")
