"""Upgraded photographic Chongqing shop-sign lettering & frame atlases (Phase 3 Photorealism):
  site/assets/signs.png + signs.json           128 horizontal Chongqing shop signs (512 x 128 px)
  site/assets/signs_vert.png + signs_vert.json  64 vertical Chongqing neon blade signs (128 x 512 px)

Includes authentic Chongqing commercial signboard variety: traditional framed corner ornaments,
seals/emblems, double-line subtitles/slogans (老字号 · 24H · CHONGQING), modern bold stripes,
and razor-sharp high-contrast typography masks.

usage: 52_signs.py <site_assets_dir>
"""
import sys, os, random, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(OUT, "..", "..", "data", "debug"), exist_ok=True)

FONTS_BOLD = [p for p in [
    "/usr/share/fonts/adobe-source-han-sans/SourceHanSansCN-Heavy.otf",
    "/usr/share/fonts/adobe-source-han-sans/SourceHanSansCN-Bold.otf",
    "/usr/share/fonts/TTF/IBMPlexSansSC-Bold.ttf",
] if os.path.exists(p)]
FONTS_TRAD = [p for p in [
    "/usr/share/fonts/TTF/ukai.ttc",
    "/usr/share/fonts/TTF/uming.ttc",
    "/usr/share/fonts/adobe-source-han-sans/SourceHanSansCN-Medium.otf",
] if os.path.exists(p)]
FONTS = FONTS_BOLD + FONTS_TRAD
if not FONTS:
    raise RuntimeError("No CJK fonts found on system!")

CHONGQING_CLASSICS = [
    ("重庆老火锅", "地道牛油 · 九宫格"), ("九宫格老火锅", "正宗山城老味"), ("防空洞老火锅", "巴渝老字号"),
    ("解放碑老火锅", "渝中直营总店"), ("山城老火锅", "麻辣鲜香 · 24H"), ("牛油老火锅", "传统手工炒料"),
    ("渝味老火锅", "鲜毛肚 · 鹅肠"), ("巷子老火锅", "社区老居民楼"), ("梯坎老火锅", "山城地道老味"),
    ("江畔老火锅", "两江夜景美食"), ("巴渝老火锅", "百年传承秘制"), ("朝天门火锅", "CHONGQING HOTPOT"),
    ("洪崖洞老火锅", "民俗风味总店"), ("珮姐老火锅", "正宗渝派火锅"), ("老码头火锅", "鲜切牛肉 · 鸭血"),
    ("十八梯火锅", "山城老街风味"), ("山城重庆小面", "豌杂 · 牛肉 · 肥肠"), ("板凳小面", "地道重庆早餐"),
    ("豌杂小面", "手工碱水面"), ("牛肉小面", "大块红烧牛肉"), ("肥肠小面", "老字号面庄"),
    ("老太婆摊摊面", "麻辣鲜香小面"), ("梯坎小面", "二十年老面馆"), ("花市豌杂面", "渝中名小吃"),
    ("重庆酸辣粉", "手工红薯粉"), ("手工酸辣粉", "现打现煮 · 杂酱"), ("山城冰汤圆", "手作红糖冰粉"),
    ("玫瑰冰粉", "解辣神器 · 凉虾"), ("手工凉虾", "传统山城甜品"), ("红糖糍粑", "现炸手作小吃"),
    ("巴渝江湖菜", "尖椒鸡 · 毛血旺"), ("山城江湖菜", "地道川渝大排档"), ("重庆烤鱼", "炭火现烤 · 麻辣"),
    ("万州烤鱼", "蒜香 · 泡椒 · 豆豉"), ("巫山烤鱼", "鲜活江鱼现烤"), ("歌乐山辣子鸡", "巴渝名菜馆"),
    ("毛血旺", "磁器口传统风味"), ("水煮肉片", "川渝经典热菜"), ("南山泉水鸡", "一鸡三吃 · 农家"),
    ("磁器口陈麻花", "手工酥脆特产"), ("重庆串串香", "冷锅 · 热锅 · 签签"), ("冷锅串串香", "地道巷子串串"),
    ("砂锅串串", "特色麻辣牛肉"), ("钵钵鸡", "藤椒 · 红油双味"), ("山城烧烤", "炭火烤脑花 · 夜宵"),
    ("夜啤酒烧烤", "江湖夜宵 18:00-04:00"), ("江湖夜宵", "烤鱼 · 小龙虾 · 串"), ("交通茶馆", "老山城盖碗茶"),
    ("老茶馆", "坝坝茶 · 棋牌茶座"), ("坝坝茶", "清茶 · 瓜子 · 闲坐"), ("盖碗茶社", "巴渝传统茶文化"),
    ("山城豆花饭", "现磨石磨豆花"), ("老街豆花馆", "油辣子蘸水豆花"), ("老麻抄手", "清汤 · 红油 · 老麻"),
    ("蹄花汤", "老妈芸豆炖蹄花"), ("红油抄手", "皮薄馅大 · 手工包"), ("山城汤圆", "黑芝麻手工汤圆"),
    ("鬼包子", "鲜肉 · 酱肉 · 芽菜"), ("解放碑百货", "JIEFANGBEI PLAZA"), ("渝中商厦", "精品百货 · 购物"),
    ("山城书局", "BOOKSTORE · 咖啡"), ("渝州大药房", "24小时便民药店"), ("巴渝茗茶", "永川秀芽 · 坨茶"),
    ("长江酒楼", "渝菜宴席 · 江景厅"), ("嘉陵茶楼", "江畔茗茶 · 观景"), ("两江夜游", "朝天门游船售票"),
    ("山城茶室", "步道歇脚茶饮"), ("渝味卤菜", "现捞鸭脖 · 卤鹅"), ("现捞鸭脖", "热卤现拌 · 麻辣"),
    ("涪陵特产", "重庆特产 · 伴手礼"), ("渝城咖啡", "SPECIALTY COFFEE"), ("山城手作烘焙", "现烤面包 · 甜品"),
]

PREFIX = [
    "山城", "渝州", "巴渝", "老渝中", "两江", "嘉陵", "长江", "雾都", "渝味", "梯坎",
    "吊脚楼", "十八梯", "解放碑", "较场口", "临江门", "观音桥", "南滨", "老街", "坝坝", "川渝",
    "红岩", "渝北", "沙坪坝", "朝天门", "洪崖", "磁器口", "白象", "大坪", "黄桷", "蜀渝",
    "顺发", "永兴", "福临", "老字号", "街坊", "巷口", "江城", "锦渝", "聚味", "巴蜀",
]
TRADE = [
    ("老火锅", "正宗牛油锅底"), ("小面馆", "麻辣豌杂牛肉"), ("江湖菜", "地道川渝小炒"),
    ("串串香", "冷锅热锅串串"), ("烤鱼馆", "炭火秘制烤鱼"), ("酸辣粉", "手工红薯酸辣粉"),
    ("豆花饭", "传统石磨豆花"), ("抄手店", "地道老麻红油"), ("老茶馆", "盖碗清茶棋牌"),
    ("烧烤夜宵", "烤脑花 · 夜啤酒"), ("卤味铺", "现捞热卤鸭货"), ("蹄花汤", "文火慢炖滋补"),
    ("便利店", "24H CONVENIENCE"), ("生鲜超市", "新鲜果蔬日百"), ("大药房", "医保定点药店"),
    ("咖啡茶饮", "COFFEE & TEA"), ("烘焙坊", "手作面包甜点"), ("眼镜店", "专业验光配镜"),
    ("数码馆", "手机维修配件"), ("理发店", "HAIRSTYLE SALON"), ("足浴推拿", "中医养生舒缓"),
    ("鲜花店", "FLOWER BOUTIQUE"), ("文具书店", "图书文创办公"), ("特产店", "重庆地道伴手礼"),
    ("烟酒行", "名烟名酒茶礼"), ("民宿客栈", "山城江景住宿"), ("精品酒店", "BOUTIQUE HOTEL"),
]

rnd = random.Random(20261123)
items = list(CHONGQING_CLASSICS)
seen = {nm for nm, _ in items}
W, H, N = 512, 128, 128
while len(items) < N:
    pre = rnd.choice(PREFIX)
    tr, sub = rnd.choice(TRADE)
    nm = pre + tr
    if nm not in seen and len(nm) <= 7:
        seen.add(nm)
        items.append((nm, sub))
items = items[:N]
rnd.shuffle(items)
names = [nm for nm, _ in items]

# ---------------- Horizontal signs (512 x 128 x 128) with rich commercial design variety!
strip = np.zeros((H * N, W), np.uint8)
for k, (nm, sub) in enumerate(items):
    style_kind = k % 5  # 0: traditional double border + seal, 1: modern bold + subtitle, 2: bold clean + accent bars, 3: framed plaque + corner brackets, 4: icon badge + bold title + subtitle
    is_trad = style_kind in (0, 3) and bool(FONTS_TRAD)
    fp = (FONTS_TRAD if is_trad else FONTS_BOLD)[rnd.randrange(len(FONTS_TRAD if is_trad else FONTS_BOLD))]
    fp_sub = FONTS_BOLD[0] if FONTS_BOLD else FONTS[0]

    im = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(im)

    # Decorative architectural signboard borders / seals / dividers (give realistic commercial graphic punch!)
    x_pad_l, x_pad_r = 22, 22
    has_sub = style_kind in (1, 4)
    if style_kind == 0:
        # Traditional double-line Chinese plaque frame + left vertical stamp seal
        d.rectangle([6, 6, W - 7, H - 7], outline=210, width=3)
        d.rectangle([13, 13, W - 14, H - 14], outline=140, width=1)
        # Left traditional seal box (渝 / 老)
        d.rectangle([22, 26, 68, 102], outline=235, width=3)
        sf = ImageFont.truetype(fp, 30)
        ch_s = "渝" if k % 2 == 0 else "老"
        sb = sf.getbbox(ch_s)
        d.text((45 - (sb[2] - sb[0]) / 2 - sb[0], 64 - (sb[3] - sb[1]) / 2 - sb[1]), ch_s, font=sf, fill=245)
        x_pad_l = 80
    elif style_kind == 1:
        # Modern top & bottom accent rule + clean subtitle line
        d.rectangle([16, 8, W - 17, 11], fill=185)
        d.rectangle([16, H - 12, W - 17, H - 9], fill=185)
    elif style_kind == 2:
        # Bold commercial pill-bar accent on left & right
        d.rectangle([14, 22, 22, H - 23], fill=230)
        d.rectangle([W - 23, 22, W - 15, H - 23], fill=230)
        x_pad_l, x_pad_r = 34, 34
    elif style_kind == 3:
        # Corner-bracket heritage signboard frame
        L_ = 22
        for (cx, cy, sx, sy) in ((8, 8, 1, 1), (W - 9, 8, -1, 1), (8, H - 9, 1, -1), (W - 9, H - 9, -1, -1)):
            d.line([(cx, cy), (cx + sx * L_, cy)], fill=230, width=3)
            d.line([(cx, cy), (cx, cy + sy * L_)], fill=230, width=3)
        d.rectangle([16, 16, W - 17, H - 17], outline=110, width=1)
        x_pad_l, x_pad_r = 30, 30
    else:
        # Round emblem icon on left + stacked title & subtitle
        d.ellipse([20, 24, 96, 100], outline=235, width=4)
        d.ellipse([28, 32, 88, 92], outline=150, width=1)
        sf = ImageFont.truetype(fp, 38)
        ch_s = nm[0] if nm[0] not in "一二三四五六七八九十" else ("渝" if k % 2 == 0 else "味")
        sb = sf.getbbox(ch_s)
        d.text((58 - (sb[2] - sb[0]) / 2 - sb[0], 62 - (sb[3] - sb[1]) / 2 - sb[1]), ch_s, font=sf, fill=255)
        x_pad_l = 108

    avail_w = W - x_pad_l - x_pad_r
    max_h = 66 if has_sub else 88
    size = max_h + 12
    while size > 24:
        font = ImageFont.truetype(fp, size)
        box = font.getbbox(nm)
        tw, th = box[2] - box[0], box[3] - box[1]
        spacing = int(size * (0.04 if has_sub else 0.08))
        total = tw + spacing * (len(nm) - 1)
        if total <= avail_w and th <= max_h:
            break
        size -= 2

    x = x_pad_l + (avail_w - total) / 2 - box[0]
    y = (18 if has_sub else (H - th) / 2) - box[1]
    if spacing:
        for ch in nm:
            d.text((x, y), ch, font=font, fill=255)
            x += font.getlength(ch) + spacing
    else:
        d.text((x, y), nm, font=font, fill=255)

    if has_sub and sub:
        sub_sz = 20
        while sub_sz > 12:
            sfont = ImageFont.truetype(fp_sub, sub_sz)
            sbox = sfont.getbbox(sub)
            stw, sth = sbox[2] - sbox[0], sbox[3] - sbox[1]
            if stw <= avail_w - 8:
                break
            sub_sz -= 1
        sx = x_pad_l + (avail_w - stw) / 2 - sbox[0]
        sy = H - 36 - sbox[1]
        d.text((sx, sy), sub, font=sfont, fill=205)

    strip[k * H:(k + 1) * H] = np.asarray(im)

Image.fromarray(strip, "L").save(os.path.join(OUT, "signs.png"), optimize=True)
json.dump(dict(w=W, h=H, layers=N, names=names), open(os.path.join(OUT, "signs.json"), "w"), ensure_ascii=False)
Image.fromarray(strip[:H * 16], "L").save(os.path.join(OUT, "..", "..", "data", "debug", "signs_preview.png"))
print("signs.png", os.path.getsize(os.path.join(OUT, "signs.png")) // 1024, "KB;", len(FONTS), "fonts;", names[:6])

# ---------------- Vertical Chongqing neon blade signs (128 x 512 x 64) with crisp framed borders & badges!
VW, VH, VN = 128, 512, 64
VERT_NAMES = [nm for nm in names if 3 <= len(nm) <= 5][:VN]
while len(VERT_NAMES) < VN:
    VERT_NAMES.append(rnd.choice(["老火锅", "重庆小面", "江湖菜", "串串香", "酸辣粉", "老茶馆", "冰汤圆", "烧烤", "烤鱼", "毛血旺", "豆花饭", "大药房"]))

vstrip = np.zeros((VH * VN, VW), np.uint8)
for k, nm in enumerate(VERT_NAMES):
    fp = FONTS[rnd.randrange(len(FONTS))]
    nch = len(nm)
    im = Image.new("L", (VW, VH), 0)
    d = ImageDraw.Draw(im)
    # Neon blade frame + top/bottom decorative bars!
    if k % 3 == 0:
        d.rectangle([7, 7, VW - 8, VH - 8], outline=215, width=3)
        d.rectangle([13, 13, VW - 14, VH - 14], outline=125, width=1)
    elif k % 3 == 1:
        d.rectangle([12, 10, VW - 13, 16], fill=235)
        d.rectangle([12, VH - 17, VW - 13, VH - 11], fill=235)
        d.line([(12, 24), (12, VH - 25)], fill=150, width=2)
        d.line([(VW - 13, 24), (VW - 13, VH - 25)], fill=150, width=2)
    else:
        d.rounded_rectangle([8, 8, VW - 9, VH - 9], radius=16, outline=225, width=3)

    size = min(84, int((VH - 64) / max(nch, 1) * 0.84))
    font = ImageFont.truetype(fp, size)
    step = (VH - 56) / max(nch, 1)
    for ci, ch in enumerate(nm):
        b = font.getbbox(ch)
        cw, chh = b[2] - b[0], b[3] - b[1]
        cx = (VW - cw) / 2 - b[0]
        cy = 28 + ci * step + (step - chh) / 2 - b[1]
        d.text((cx, cy), ch, font=font, fill=255)
    vstrip[k * VH:(k + 1) * VH] = np.asarray(im)

Image.fromarray(vstrip, "L").save(os.path.join(OUT, "signs_vert.png"), optimize=True)
json.dump(dict(w=VW, h=VH, layers=VN, names=VERT_NAMES), open(os.path.join(OUT, "signs_vert.json"), "w"), ensure_ascii=False)
Image.fromarray(vstrip[:VH * 4], "L").save(os.path.join(OUT, "..", "..", "data", "debug", "signs_vert_preview.png"))
print("signs_vert.png", os.path.getsize(os.path.join(OUT, "signs_vert.png")) // 1024, "KB;", VERT_NAMES[:6])
