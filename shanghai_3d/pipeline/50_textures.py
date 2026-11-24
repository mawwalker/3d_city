"""Build the PBR material texture arrays from CC0 sets (ambientCG, Poly Haven).

For every material in MATERIALS: fetch the 1K JPG set, resize to SIZE, and stack all layers vertically into two strips
(a 2D array texture is uploaded straight from each strip):
  site/assets/mat_albedo.webp   RGB   base colour (sRGB), with 60% of the set's ambient occlusion baked in
  site/assets/mat_nr.webp       RGB   normal x, normal y (OpenGL convention), roughness
  site/assets/materials.json    layer index, metres per repeat, mean colour per material

usage: 50_textures.py <raw_dir> <site_assets_dir> [size]
"""
import sys, os, io, json, zipfile, time
import numpy as np, requests
from PIL import Image

RAW, OUT = sys.argv[1:3]
SIZE = int(sys.argv[3]) if len(sys.argv) > 3 else 512
os.makedirs(RAW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "city-model-build/1.0"}

# name, source ("acg:<id>" or "ph:<id>"), metres covered by one repeat
MATERIALS = [
    ("asphalt", "acg:Asphalt023S", 3.0),
    ("asphalt_worn", "acg:Asphalt026C", 4.0),
    ("pavers", "acg:PavingStones035", 2.0),
    ("pavers_brick", "acg:PavingStones129", 2.0),
    ("slabs", "acg:PavingStones125A", 3.5),
    ("concrete", "acg:Concrete034", 3.0),
    ("grass", "acg:Grass004", 2.5),
    ("soil", "acg:Ground048", 2.5),
    ("leaves", "acg:ScatteredLeaves008", 2.5),
    ("gravel", "acg:Gravel043", 2.0),
    ("plaster", "acg:Plaster001", 3.0),
    ("plaster_stained", "acg:Plaster007", 3.0),
    ("tiles_white", "acg:Tiles133A", 1.2),
    ("brick_red", "acg:Bricks059", 2.4),
    ("brick_grey", "acg:Bricks061", 2.4),
    ("concrete_panel", "acg:Concrete010", 3.0),
    ("pebbledash", "acg:Concrete049", 2.0),
    ("granite", "acg:Granite002A", 2.5),
    ("metal_panel", "acg:MetalPlates006", 3.0),
    ("corrugated", "acg:CorrugatedSteel005", 2.0),
    ("roof_clay", "acg:RoofingTiles014A", 2.4),
    ("roof_grey", "acg:RoofingTiles015A", 2.4),
    ("bitumen", "ph:bitumen", 3.0),
    ("bark", "ph:japanese_sycamore", 1.6),
    ("bark_rough", "ph:japanese_camphor_bark", 1.6),
    ("planks", "acg:Planks029L", 2.4),
    ("marble", "acg:Marble012", 2.5),
    ("painted_metal", "acg:PaintedMetal010", 2.0),
]


def fetch_acg(aid):
    d = os.path.join(RAW, aid)
    z = os.path.join(d, aid + "_1K-JPG.zip")
    if not os.path.exists(z):
        os.makedirs(d, exist_ok=True)
        r = requests.get(f"https://ambientcg.com/get?file={aid}_1K-JPG.zip", headers=UA, timeout=180, allow_redirects=True)
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
    if not os.path.exists(meta_p):
        r = requests.get(f"https://api.polyhaven.com/files/{pid}", headers=UA, timeout=60); r.raise_for_status()
        open(meta_p, "w").write(r.text)
    meta = json.load(open(meta_p))

    def get(*keys):
        for k in keys:
            if k in meta and "1k" in meta[k] and "jpg" in meta[k]["1k"]:
                url = meta[k]["1k"]["jpg"]["url"]
                p = os.path.join(d, os.path.basename(url))
                if not os.path.exists(p):
                    r = requests.get(url, headers=UA, timeout=180); r.raise_for_status()
                    open(p, "wb").write(r.content)
                return Image.open(p)
        return None
    arm = get("arm")
    rough = get("Rough", "rough")
    ao = get("AO", "ao")
    if arm is not None:
        a = np.asarray(arm.convert("RGB"))
        if rough is None: rough = Image.fromarray(a[:, :, 1])
        if ao is None: ao = Image.fromarray(a[:, :, 0])
    return dict(color=get("Diffuse", "diffuse", "diff"), normal=get("nor_gl"), rough=rough, ao=ao)


def make_tileable_check(img):
    return img


albedo_layers, nra_layers, meta = [], [], {}
for li, (name, src, metres) in enumerate(MATERIALS):
    kind, sid = src.split(":")
    t = time.time()
    try:
        m = fetch_acg(sid) if kind == "acg" else fetch_ph(sid)
    except Exception as e:
        print("FAILED", name, src, repr(e)[:200]); m = dict(color=None, normal=None, rough=None, ao=None)
    rs = lambda im, mode: None if im is None else im.convert(mode).resize((SIZE, SIZE), Image.LANCZOS)
    col = rs(m["color"], "RGB")
    if col is None:
        col = Image.new("RGB", (SIZE, SIZE), (128, 128, 128))
    nor = rs(m["normal"], "RGB")
    rough = rs(m["rough"], "L")
    ao = rs(m["ao"], "L")
    n = np.asarray(nor) if nor is not None else np.full((SIZE, SIZE, 3), (128, 128, 255), np.uint8)
    r = np.asarray(rough) if rough is not None else np.full((SIZE, SIZE), 200, np.uint8)
    a = np.asarray(ao) if ao is not None else np.full((SIZE, SIZE), 255, np.uint8)
    nra = np.dstack([n[:, :, 0], n[:, :, 1], r]).astype(np.uint8)
    # bake part of the cavity occlusion into the base colour (in linear light)
    c = np.asarray(col).astype(np.float32) / 255
    lin_ = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4) * (0.4 + 0.6 * (a.astype(np.float32) / 255))[:, :, None]
    col = Image.fromarray(np.clip(np.where(lin_ <= 0.0031308, lin_ * 12.92, 1.055 * lin_ ** (1 / 2.4) - 0.055) * 255 + 0.5, 0, 255).astype(np.uint8))
    albedo_layers.append(np.asarray(col)); nra_layers.append(nra)
    c = np.asarray(col).astype(np.float32) / 255
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).reshape(-1, 3).mean(0)
    meta[name] = dict(layer=li, metres=metres, source=src, mean=[round(float(v), 4) for v in lin], rough=round(float(r.mean() / 255), 3))
    print(f"{li:2d} {name:<16} {src:<28} mean lin {meta[name]['mean']} rough {meta[name]['rough']} ({time.time() - t:.1f}s)", flush=True)

alb = Image.fromarray(np.vstack(albedo_layers))
nra = Image.fromarray(np.vstack(nra_layers), "RGB")
alb.save(os.path.join(OUT, "mat_albedo.webp"), quality=90, method=6)
nra.save(os.path.join(OUT, "mat_nr.webp"), quality=93, method=6)
json.dump(dict(size=SIZE, layers=len(MATERIALS), materials=meta), open(os.path.join(OUT, "materials.json"), "w"), indent=1)
print("strips:", alb.size, os.path.getsize(os.path.join(OUT, "mat_albedo.webp")) // 1024, "KB,", os.path.getsize(os.path.join(OUT, "mat_nr.webp")) // 1024, "KB")
