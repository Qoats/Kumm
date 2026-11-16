# Icônes Android de Kumm (android-res/), dessinées d'après web/public/favicon.svg : dégradé vert, « K » en ligne de plan de transport.
# Utilisation : python3 scripts/android/build-android-icons.py   (Pillow requis) ; le workflow « APK Android » copie android-res/ dans le projet.
import os
from PIL import Image, ImageDraw

OUT = "android-res"
G1, G2 = (0x1B, 0x7F, 0x55), (0x0A, 0x46, 0x30)    # dégradé du logo (haut gauche → bas droite)
HOLE = (0x13, 0x6A, 0x45)
SS = 4                                               # sur-échantillonnage, pour des bords lisses

def gradient(n):
    img = Image.new("RGB", (n, n))
    px = img.load()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * (n - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(G1, G2))
    return img

def draw_k(img, extent):
    """« K » centré ; extent = part de la largeur occupée par le logo (traits et ronds compris)"""
    n = img.size[0]
    k = extent * n / 314                       # le K occupe 314 unités sur 512 dans favicon.svg
    cx, cy = n / 2, n / 2
    P = lambda x, y: (cx + (x - 260) * k, cy + (y - 256) * k)   # centre du K dans le SVG : (260, 256)
    d = ImageDraw.Draw(img)
    w = round(44 * k)
    def line(a, b, col):
        d.line([P(*a), P(*b)], fill=col, width=w)
        for q in (a, b):
            x, y = P(*q); d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=col)
    line((168, 256), (352, 132), (0xFF, 0xC9, 0x3C))
    line((168, 256), (352, 380), (0x4C, 0xC3, 0xFF))
    line((168, 132), (168, 380), (255, 255, 255))
    for q in ((168, 132), (168, 380), (352, 132), (352, 380)):
        x, y = P(*q)
        r1, r2 = 33 * k, 13 * k
        d.ellipse((x - r1, y - r1, x + r1, y + r1), fill=(255, 255, 255))
        d.ellipse((x - r2, y - r2, x + r2, y + r2), fill=HOLE)

def icon(size, extent, shape):
    n = size * SS
    if shape == "transparent":
        img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    else:
        img = gradient(n).convert("RGBA")
        if shape in ("rounded", "circle"):
            m = Image.new("L", (n, n), 0)
            dm = ImageDraw.Draw(m)
            if shape == "circle": dm.ellipse((0, 0, n - 1, n - 1), fill=255)
            else: dm.rounded_rectangle((0, 0, n - 1, n - 1), radius=round(n * 116 / 512), fill=255)
            img.putalpha(m)
    if extent: draw_k(img, extent)
    return img.resize((size, size), Image.LANCZOS)

def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)

D = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for d, s in D.items():
    save(icon(round(48 * s), 0.61, "rounded"), f"{OUT}/mipmap-{d}/ic_launcher.png")            # Android 7 et avant
    save(icon(round(48 * s), 0.52, "circle"), f"{OUT}/mipmap-{d}/ic_launcher_round.png")
    # icône adaptative (Android 8+) : 108 dp, dont seul le centre (≈ 66 dp) est visible après découpe par le téléphone
    save(icon(round(108 * s), 0.40, "transparent"), f"{OUT}/mipmap-{d}/ic_launcher_foreground.png")
    save(icon(round(108 * s), 0, "full"), f"{OUT}/mipmap-{d}/ic_launcher_background.png")

ADAPTIVE = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@mipmap/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n'
for name in ("ic_launcher", "ic_launcher_round"):
    os.makedirs(f"{OUT}/mipmap-anydpi-v26", exist_ok=True)
    open(f"{OUT}/mipmap-anydpi-v26/{name}.xml", "w").write(ADAPTIVE)
os.makedirs(f"{OUT}/values", exist_ok=True)
open(f"{OUT}/values/ic_launcher_background.xml", "w").write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#136342</color>\n</resources>\n')

# icône de notification (barre d'état) : silhouette blanche du K, Android la colore lui-même
def stat_icon(size):
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    k = 0.86 * n / 314
    P = lambda x, y: (n / 2 + (x - 260) * k, n / 2 + (y - 256) * k)
    d = ImageDraw.Draw(img)
    w = round(44 * k)
    W = (255, 255, 255, 255)
    for a, b in (((168, 256), (352, 132)), ((168, 256), (352, 380)), ((168, 132), (168, 380))):
        d.line([P(*a), P(*b)], fill=W, width=w)
    for q in ((168, 132), (168, 380), (352, 132), (352, 380)):
        x, y = P(*q); r1, r2 = 33 * k, 13 * k
        d.ellipse((x - r1, y - r1, x + r1, y + r1), fill=W)
        d.ellipse((x - r2, y - r2, x + r2, y + r2), fill=(0, 0, 0, 0))
    return img.resize((size, size), Image.LANCZOS)

for d, s in D.items():
    save(stat_icon(round(24 * s)), f"{OUT}/drawable-{d}/ic_stat_kumm.png")

# écran de démarrage (Android 11 et avant) : fond vert, logo au centre
BG = (0x13, 0x63, 0x42)
sizes = {"drawable/splash.png": (480, 320)}
for o in ("land", "port"):
    for d, (w, h) in {"mdpi": (480, 320), "hdpi": (800, 480), "xhdpi": (1280, 720), "xxhdpi": (1600, 960), "xxxhdpi": (1920, 1280)}.items():
        sizes[f"drawable-{o}-{d}/splash.png"] = (w, h) if o == "land" else (h, w)
for path, (w, h) in sizes.items():
    img = Image.new("RGB", (w, h), BG)
    s = round(min(w, h) * 0.34)
    logo = icon(s, 0.61, "rounded")
    img.paste(logo, ((w - s) // 2, (h - s) // 2), logo)
    save(img, f"{OUT}/{path}")
print("icônes Android écrites dans", OUT)
