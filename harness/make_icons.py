#!/usr/bin/env python3
"""サイトのアイコン(PNG)を作る。画像ライブラリが無くても動くよう、距離関数で図形を描いて PNG に書き出す。
icon.svg は、これと同じ図形を手で SVG にしたもの（図形を変えたら両方を直す）。
使い方: python3 harness/make_icons.py   → favicon-32.png / apple-touch-icon.png / icon-192.png / icon-512.png / icon-maskable-512.png / og-image.png
"""
import math, struct, zlib, sys, os

# ---- 図形（512 x 512 の座標） ----
CX = CY = 256.0
ORBIT = dict(rx=200.0, ry=100.0, rot=math.radians(-30), width=11.0)
STAR_R = 62.0
PLANET = dict(t=0.9, r=40.0)          # 軌道上の大きな惑星
MOON = dict(t=0.9 + math.pi, r=20.0)  # 反対側の小さな惑星
STARS = [(90, 120, 4.5), (420, 92, 3.5), (446, 404, 4), (118, 430, 3.5), (170, 62, 2.5), (60, 300, 3)]

def clamp(x, a=0.0, b=1.0): return a if x < a else b if x > b else x
def mix(c1, c2, t): return tuple(c1[i] + (c2[i] - c1[i]) * t for i in range(3))
def cover(d): return clamp(0.5 - d)  # 符号つき距離 d [px] → 被覆率（1 px で滑らかに）

def on_orbit(t):
    x, y = ORBIT['rx'] * math.cos(t), ORBIT['ry'] * math.sin(t)
    c, s = math.cos(ORBIT['rot']), math.sin(ORBIT['rot'])
    return CX + x * c - y * s, CY + x * s + y * c

def ellipse_dist(px, py):
    """回転した楕円の縁までの距離（勾配で正規化した近似）"""
    dx, dy = px - CX, py - CY
    c, s = math.cos(-ORBIT['rot']), math.sin(-ORBIT['rot'])
    x, y = dx * c - dy * s, dx * s + dy * c
    rx, ry = ORBIT['rx'], ORBIT['ry']
    f = math.hypot(x / rx, y / ry)
    if f < 1e-9: return -min(rx, ry)
    gx, gy = x / (rx * rx * f), y / (ry * ry * f)
    return (f - 1.0) / math.hypot(gx, gy)

def blend(dst, rgb, a):
    """dst = (r, g, b, alpha)（非乗算済み）に、色 rgb を不透明度 a で重ねる"""
    r, g, b, da = dst
    oa = a + da * (1 - a)
    if oa <= 0: return (0.0, 0.0, 0.0, 0.0)
    return tuple((rgb[i] * a + dst[i] * da * (1 - a)) / oa for i in range(3)) + (oa,)

def render_pixel(x, y, rounded, scale, bg=True):
    # 中身を中心に scale 倍する（maskable では余白を取る）
    px = CX + (x - CX) / scale
    py = CY + (y - CY) / scale
    # 背景（角丸の四角、斜めのグラデーション）
    inside = 1.0
    if rounded:
        qx, qy = abs(x - 256) - (256 - 112), abs(y - 256) - (256 - 112)
        d = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - 112
        inside = cover(d)
    t = clamp((x + y) / 1024.0)
    px_rgba = (*mix((30, 44, 112), (6, 10, 28), t), inside) if bg else (0.0, 0.0, 0.0, 0.0)  # bg=False: 図形だけ（背景は呼び出し側が用意する）
    if bg and inside <= 0: return px_rgba
    # 小さな星
    for sx, sy, sr in STARS:
        a = cover(math.hypot(px - sx, py - sy) - sr) * 0.75
        if a > 0: px_rgba = blend(px_rgba, (220, 230, 255), a)
    # 軌道（細い楕円の線）
    a = cover(abs(ellipse_dist(px, py)) - ORBIT['width'] / 2) * 0.92
    if a > 0: px_rgba = blend(px_rgba, (140, 188, 255), a)
    # 恒星の光（広がる光 → 本体）
    r = math.hypot(px - CX, py - CY)
    if r < 135:
        glow = (1 - r / 135.0) ** 2 * 0.65
        px_rgba = blend(px_rgba, (255, 200, 90), glow)
    if r < STAR_R + 1:
        core = mix((255, 244, 190), (255, 186, 72), clamp(r / STAR_R) ** 1.6)
        px_rgba = blend(px_rgba, core, cover(r - STAR_R))
    # 惑星（左上に光、右下に影）
    for spec, base, shade in ((PLANET, (118, 196, 255), (46, 92, 178)), (MOON, (255, 168, 112), (176, 82, 52))):
        ox, oy = on_orbit(spec['t'])
        d = math.hypot(px - ox, py - oy)
        if d < spec['r'] + 1:
            lx, ly = (px - ox) / spec['r'], (py - oy) / spec['r']
            light = clamp(0.5 - 0.5 * (lx * -0.55 + ly * -0.55) / 0.78)  # 0 = 明るい側
            col = mix(base, shade, light ** 1.4)
            if spec is PLANET and abs(ly + 0.1) < 0.14: col = mix(col, shade, 0.45)  # 縞模様（1 本）
            px_rgba = blend(px_rgba, col, cover(d - spec['r']))
    return px_rgba

def write_png(path, size, rounded=True, scale=1.0):
    ss = 2 if size <= 64 else 1   # 小さい画像は、2x2 で平均して、なめらかにする
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sj in range(ss):
                for si in range(ss):
                    x = (i + (si + 0.5) / ss) * 512.0 / size
                    y = (j + (sj + 0.5) / ss) * 512.0 / size
                    r, g, b, a = render_pixel(x, y, rounded, scale)
                    acc[0] += r * a; acc[1] += g * a; acc[2] += b * a; acc[3] += a
            n = ss * ss
            a = acc[3] / n
            if acc[3] > 0: rgb = [acc[k] / acc[3] for k in range(3)]
            else: rgb = [0, 0, 0]
            row += bytes([int(clamp(rgb[0] / 255.0) * 255 + 0.5), int(clamp(rgb[1] / 255.0) * 255 + 0.5), int(clamp(rgb[2] / 255.0) * 255 + 0.5), int(clamp(a) * 255 + 0.5)])
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f: f.write(png)
    print(f'{path} ({size}x{size}, {len(png)} bytes)')

def write_png_rect(path, w, h, k=1.12):
    """共有用の横長の画像（X などの紹介カード用）。アイコンの図形を中央に置き、まわりに星を散らす。文字は入れない（題名は meta で渡す）。"""
    # 星を散らす（決まった乱数で、毎回同じ絵になる）
    seed = 12345
    def rnd():
        nonlocal seed
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed / 0x7fffffff
    star_px = {}
    for _ in range(90):
        sx, sy, sr = rnd() * w, rnd() * h, 1.2 + rnd() * 2.4
        if abs(sx - w / 2) < 330 and abs(sy - h / 2) < 260: continue  # 中央の図形の上には置かない
        bright = 0.35 + 0.5 * rnd()  # 星ごとに 1 度だけ決める（ピクセルごとに変えると、ざらつく）
        for yy in range(int(sy - sr - 2), int(sy + sr + 3)):
            for xx in range(int(sx - sr - 2), int(sx + sr + 3)):
                if 0 <= xx < w and 0 <= yy < h:
                    a = cover(math.hypot(xx + 0.5 - sx, yy + 0.5 - sy) - sr) * bright
                    if a > star_px.get((xx, yy), 0): star_px[(xx, yy)] = a
    rows = []
    for j in range(h):
        row = bytearray([0])
        for i in range(w):
            # 出力の座標 → アイコンの座標（中央に k 倍）
            x = CX + (i + 0.5 - w / 2) / k
            y = CY + (j + 0.5 - h / 2) / k
            t = clamp((i / w + j / h) / 2)
            base = (*mix((22, 34, 92), (5, 8, 22), t), 1.0)
            # アイコンの図形（星・軌道・恒星・惑星）だけを重ねる
            r, g, b, a = render_pixel(x, y, False, 1.0, bg=False)
            if a > 0: base = blend(base, (r, g, b), a)
            if (i, j) in star_px: base = blend(base, (220, 230, 255), star_px[(i, j)])
            row += bytes([int(base[0] + 0.5), int(base[1] + 0.5), int(base[2] + 0.5), 255])
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f: f.write(png)
    print(f'{path} ({w}x{h}, {len(png)} bytes)')

if __name__ == '__main__':
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    write_png(os.path.join(out, 'favicon-32.png'), 32)
    write_png(os.path.join(out, 'apple-touch-icon.png'), 180, rounded=False)   # iOS が角を丸める。透明は使わない
    write_png(os.path.join(out, 'icon-192.png'), 192)
    write_png(os.path.join(out, 'icon-512.png'), 512)
    write_png(os.path.join(out, 'icon-maskable-512.png'), 512, rounded=False, scale=0.78)
    write_png_rect(os.path.join(out, 'og-image.png'), 1200, 630)  # 端が切り取られても欠けないよう、中身を小さく
