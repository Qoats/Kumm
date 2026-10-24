#!/usr/bin/env python3
"""
Vérifie les tracés des lignes (data/shapes.json, extraits d'OpenStreetMap) avec le plan détaillé officiel de la CTS,
et écrit data/shape-cuts.json : les endroits où un tracé passe là où le plan ne montre pas la ligne (voie oubliée,
prolongement vers un dépôt, ancien itinéraire…). Le serveur retire ces morceaux de tracé (server/shapes.ts) ; le bus y
suit alors la route entre ses arrêts (server/roads.ts).

Utilisation (serveur Kumm lancé, pour la position des arrêts) :
    python3 scripts/check-shapes-plan.py Plan-Detaille-reseau-CTS.pdf [http://localhost:3000] [--images dossier]
Le plan se télécharge sur cts-strasbourg.eu (« Plans du réseau » → plan détaillé). Il n'est pas mis dans le dépôt.
Il faut pdftoppm et pdftotext (poppler), numpy et Pillow.

Méthode :
  1. recalage du plan sur la carte : les noms d'arrêts écrits sur le plan (texte du PDF) sont associés aux arrêts de la CTS
     (positions réelles), puis une transformation affine est ajustée (RANSAC), corrigée localement autour de chaque point ;
  2. pour chaque ligne, un point tous les 60 m du tracé : le plan doit montrer un trait de la couleur de la ligne à moins de
     ~190 m. 8 points de suite (480 m) sans trait = morceau de tracé absent du plan.
Le centre-ville (encadré « VOIR ZOOM », agrandi et déformé sur le plan), la légende et les lignes absentes du plan
(lignes de nuit, qui ont leur propre plan) ne sont pas vérifiés.
"""
import html, json, math, os, random, re, subprocess, sys, tempfile, unicodedata, urllib.request
import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
IMAGES = sys.argv[sys.argv.index("--images") + 1] if "--images" in sys.argv else None
if IMAGES and IMAGES in args: args.remove(IMAGES)
PDF, SERVER = args[0], (args[1] if len(args) > 1 else "http://localhost:3000")
TMP = tempfile.mkdtemp()

# zones du plan à ignorer, en points PDF (plan détaillé, édition 11/2025, page 2863 × 2268 pt) :
# légende et publicité à gauche, encadré du centre-ville en haut à gauche, encadré « VOIR ZOOM » du plan principal
def in_map(x, y):
    return x > 720 and y < 2240 and not (x < 1400 and y < 710) and not (1935 < x < 2245 and 840 < y < 1130)

def fold(t):
    t = unicodedata.normalize("NFD", t.lower().replace("œ", "oe").replace("’", "'"))
    return re.sub(r"[^a-z0-9]+", " ", "".join(c for c in t if unicodedata.category(c) != "Mn")).strip()

# ---------- 1. recalage ----------
stops = {}
with urllib.request.urlopen(SERVER + "/api/stoppoints-discovery") as r:
    for s in json.load(r)["StopPointsDelivery"]["AnnotatedStopPointRef"]:
        loc = s.get("Location")
        if loc: stops.setdefault(fold(s["StopName"]), []).append((loc["Longitude"], loc["Latitude"]))
def spread(ps):
    a = np.array(ps); return np.max(np.hypot((a[:, 0] - a[:, 0].mean()) * 73800, (a[:, 1] - a[:, 1].mean()) * 111000))
stops = {k: tuple(np.mean(v, axis=0)) for k, v in stops.items() if spread(v) < 400}   # même nom à deux endroits : ambigu

subprocess.run(["pdftotext", "-bbox-layout", PDF, f"{TMP}/layout.html"], check=True)
src = open(f"{TMP}/layout.html", encoding="utf-8").read()
cands, words = [], set()
for blk in re.findall(r"<block[^>]*>(.*?)</block>", src, re.S):
    lines = []
    for m in re.finditer(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', blk, re.S):
        ws = [html.unescape(w) for w in re.findall(r"<word[^>]*>([^<]*)</word>", m.group(5))]
        words.update(ws)
        lines.append((fold(" ".join(ws)), *map(float, m.groups()[:4])))
    for i, l in enumerate(lines):
        cands.append(l)
        if i + 1 < len(lines):   # nom écrit sur deux lignes
            n = lines[i + 1]; cands.append((l[0] + " " + n[0], min(l[1], n[1]), l[2], max(l[3], n[3]), n[4]))
found = {}
for t, x0, y0, x1, y1 in cands:
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if t in stops and in_map(cx, cy): found.setdefault(t, []).append((cx, cy))
pairs = [(stops[k], v[0]) for k, v in found.items() if len(v) == 1 and len(k) > 4]
G = np.array([[lo * 73.8, la * 111.0, 1] for (lo, la), _ in pairs]); P = np.array([p for _, p in pairs])
random.seed(1); best = None
for _ in range(3000):
    idx = random.sample(range(len(pairs)), 3)
    A, *_ = np.linalg.lstsq(G[idx], P[idx], rcond=None)
    inl = np.hypot(*(G @ A - P).T) < 45
    if best is None or inl.sum() > best.sum(): best = inl
A, *_ = np.linalg.lstsq(G[best], P[best], rcond=None)
G, P = G[best], P[best]; RES = P - G @ A
print(f"Recalage : {len(pairs)} arrêts reconnus sur le plan, {best.sum()} retenus, écart médian {np.median(np.hypot(*RES.T)):.0f} pt")

def to_pt(lat, lon):
    g = np.array([lon * 73.8, lat * 111.0, 1]); p = g @ A
    d = np.hypot(*(G[:, :2] - g[:2]).T); k = np.argsort(d)[:8]; w = 1 / (d[k] + 0.3) ** 2
    return p + (RES[k] * w[:, None]).sum(0) / w.sum()

# ---------- 2. comparaison des couleurs ----------
S = 2.0   # 144 dpi
subprocess.run(["pdftoppm", "-r", "144", "-png", "-singlefile", PDF, f"{TMP}/plan"], check=True)
plan = Image.open(f"{TMP}/plan.png").convert("RGB")
img = np.asarray(plan).astype(np.int16)
data_ts = open(os.path.join(ROOT, "web/src/data.ts"), encoding="utf-8").read()
COLORS = {k.strip('"'): v for k, v in re.findall(r'("?[A-Z0-9]+"?):"(#[0-9A-F]{6})"', data_ts.split("export const COLORS")[1].split(";")[0])}
shapes = json.load(open(os.path.join(ROOT, "data/shapes.json")))["lines"]
R = 22   # pt (≈ 190 m) : imprécision du recalage et décalage des traits parallèles sur le plan

def has_color(x, y, rgb):
    x0, y0, x1, y1 = int((x - R) * S), int((y - R) * S), int((x + R) * S), int((y + R) * S)
    if x0 < 0 or y0 < 0 or x1 >= img.shape[1] or y1 >= img.shape[0]: return None
    return bool((np.abs(img[y0:y1:2, x0:x1:2] - rgb).sum(-1) < 70).any())

def dist(a, b): return math.hypot(math.radians(b[1] - a[1]) * math.cos(math.radians(a[0])), math.radians(b[0] - a[0])) * 6371000

cuts, summary = {}, []
for line, variants in sorted(shapes.items()):
    if line not in COLORS or line not in words: continue      # ligne absente du plan (nuit…) : non vérifiée
    rgb = np.array([int(COLORS[line][i:i + 2], 16) for i in (1, 3, 5)])
    tot = ok = 0; bad = []
    for pts in variants:
        samples = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            n = int(dist(a, b) // 60)
            samples += [[a[0] + (b[0] - a[0]) * t / (n + 1), a[1] + (b[1] - a[1]) * t / (n + 1)] for t in range(1, n + 1)] + [b]
        run = []
        for s in samples + [None]:
            h = None
            if s is not None:
                x, y = to_pt(*s)[:2]
                h = has_color(x, y, rgb) if in_map(x, y) else None
                if h is not None: tot += 1; ok += h
            if h is False: run.append(s); continue
            if len(run) >= 8: bad += run
            run = []
    if bad:
        cuts[line] = sorted({(round(p[0], 5), round(p[1], 5)) for p in bad})
    summary.append((line, ok / tot if tot else 1, len(bad) * 60))

for line, score, m in sorted(summary, key=lambda x: x[1]):
    if m: print(f"  {line:4} {score:5.0%} conforme · {m / 1000:.1f} km de tracé absent du plan, retirés")
out = os.path.join(ROOT, "data/shape-cuts.json")
json.dump({"source": "comparaison avec le plan détaillé du réseau CTS (scripts/check-shapes-plan.py)", "rayon_m": 70,
           "lines": {k: [list(p) for p in v] for k, v in cuts.items()}}, open(out, "w"), separators=(",", ":"))
print(f"{sum(len(v) for v in cuts.values())} points à retirer sur {len(cuts)} lignes → data/shape-cuts.json")

# ---------- images de contrôle (optionnel) : tracé Kumm en magenta, morceaux retirés en noir, sur le plan ----------
if IMAGES:
    os.makedirs(IMAGES, exist_ok=True)
    for line, pts in cuts.items():
        xy = np.array([to_pt(*p)[:2] for p in pts])
        x0, y0 = xy.min(0) - 150; x1, y1 = xy.max(0) + 150
        box = [int(x0 * S), int(y0 * S), int(x1 * S), int(y1 * S)]
        im = plan.crop(box); d = ImageDraw.Draw(im)
        for v in shapes[line]:
            d.line([tuple(to_pt(*p)[:2] * S - box[:2]) for p in v], fill=(255, 0, 255), width=3)
        for p in pts:
            x, y = to_pt(*p)[:2] * S - box[:2]; d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(0, 0, 0))
        im.thumbnail((1000, 1000)); im.save(os.path.join(IMAGES, f"{line}.png"))
    print("Images de contrôle :", IMAGES)
