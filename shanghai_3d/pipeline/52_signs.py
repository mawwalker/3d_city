"""Shop-sign lettering: a strip of N text masks (one sign per layer, white on black), for the facade shader's sign boards.

Names are made-up but typical of a Shanghai street: a neighbourly prefix plus a trade, or a regional dish; no real
brands. Rendered with open-licence system fonts (Source Han Sans, IBM Plex Sans SC, AR PL UKai / UMing).

usage: 52_signs.py <site_assets_dir>
"""
import sys, os, random, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
W, H, N = 384, 96, 96
FONTS = [p for p in [
    "/usr/share/fonts/adobe-source-han-sans/SourceHanSansCN-Heavy.otf",
    "/usr/share/fonts/adobe-source-han-sans/SourceHanSansCN-Bold.otf",
    "/usr/share/fonts/adobe-source-han-sans/SourceHanSansCN-Medium.otf",
    "/usr/share/fonts/TTF/IBMPlexSansSC-Bold.ttf",
    "/usr/share/fonts/TTF/ukai.ttc",
    "/usr/share/fonts/TTF/uming.ttc",
] if os.path.exists(p)]
PREFIX = ["老上海", "弄堂", "阿婆", "阿姨", "沪上", "申城", "江南", "福兴", "永兴", "顺发", "鑫源", "佳佳", "康乐", "安心", "和平", "丰收", "吉祥", "如意", "万家", "百姓", "邻里",
          "街坊", "小巷", "幸福", "阳光", "天天", "好运", "大众", "新新", "红星", "东方", "兴旺", "同福", "德兴", "泰和", "恒泰", "瑞祥", "聚丰", "鼎盛", "春风", "四季", "老弄堂", "外滩"]
TRADE = ["面馆", "馄饨", "生煎", "小笼包", "汤包", "饺子馆", "麻辣烫", "烧烤", "火锅", "小吃", "快餐", "本帮菜", "川菜馆", "粥铺", "烧腊", "卤味", "熟食", "包子铺", "咖啡", "奶茶",
         "茶餐厅", "面包房", "蛋糕", "甜品", "水果", "酒家", "饭店", "便利店", "超市", "烟酒", "五金", "文具", "花店", "书店", "眼镜", "药房", "服装", "鞋店", "童装", "箱包", "手机",
         "数码", "钟表", "茶叶", "粮油", "生鲜", "杂货", "礼品", "母婴", "宠物", "家纺", "灯具", "建材", "电动车", "理发", "美发", "美容", "足浴", "推拿", "干洗", "裁缝", "修车",
         "洗车", "打印复印", "照相馆", "牙科", "诊所", "棋牌室", "健身", "琴行", "画室", "宾馆", "旅馆"]
REGIONAL = ["兰州拉面", "沙县小吃", "重庆小面", "桂林米粉", "黄焖鸡米饭", "东北饺子馆", "杭州小笼包", "上海馄饨", "新疆烧烤", "四川麻辣烫", "广式烧腊", "云南过桥米线", "山西刀削面",
            "陕西凉皮肉夹馍", "扬州炒饭", "苏式面馆", "潮汕砂锅粥", "福建千里香馄饨", "安徽板面", "湖南米粉"]
rnd = random.Random(20261113)
names = list(REGIONAL)
seen = set(names)
while len(names) < N:
    nm = rnd.choice(PREFIX) + rnd.choice(TRADE)
    if nm not in seen:
        seen.add(nm); names.append(nm)
rnd.shuffle(names)
strip = np.zeros((H * N, W), np.uint8)
for k, nm in enumerate(names):
    fp = FONTS[rnd.randrange(len(FONTS))]
    size = 78
    while size > 20:
        font = ImageFont.truetype(fp, size)
        box = font.getbbox(nm)
        tw, th = box[2] - box[0], box[3] - box[1]
        spacing = int(size * rnd.choice([0.0, 0.06, 0.14]))
        total = tw + spacing * (len(nm) - 1)
        if total <= W - 26 and th <= H - 14:
            break
        size -= 2
    im = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(im)
    x = (W - total) / 2 - box[0]
    y = (H - th) / 2 - box[1]
    if spacing:
        for ch in nm:
            d.text((x, y), ch, font=font, fill=255)
            x += font.getlength(ch) + spacing
    else:
        d.text((x, y), nm, font=font, fill=255)
    strip[k * H:(k + 1) * H] = np.asarray(im)
Image.fromarray(strip, "L").save(os.path.join(OUT, "signs.png"), optimize=True)
json.dump(dict(w=W, h=H, layers=N, names=names), open(os.path.join(OUT, "signs.json"), "w"), ensure_ascii=False)
print("signs.png", os.path.getsize(os.path.join(OUT, "signs.png")) // 1024, "KB;", len(FONTS), "fonts;", names[:8])
Image.fromarray(strip[:H * 12], "L").save(os.path.join(OUT, "..", "..", "data", "debug", "signs_preview.png"))
