// Voies ferrées autour de Strasbourg depuis OpenStreetMap, pour que les trains TER suivent les rails sur la carte.
// Utilisation : node scripts/build-rail.mjs                (télécharge via Overpass et écrit data/rail.json)
//               node scripts/build-rail.mjs fichier.json   (à partir d'une réponse Overpass déjà téléchargée)
// Relancé chaque nuit avec les tracés des lignes (.github/workflows/shapes.yml) ; un téléchargement incomplet est refusé.
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "rail.json");
// voies ferrées de Molsheim à Kehl, d'Erstein à Brumath : voies principales, voies de gare et aiguillages (sans « usage » dans OSM),
// mais pas les voies de garage, de triage ni les embranchements industriels, militaires ou touristiques
const QUERY = '[out:json][timeout:180];way["railway"="rail"]["service"!~"^(yard|siding|spur)$"]["usage"!~"^(industrial|military|tourism|test)$"](48.38,7.45,48.78,7.95);out geom;';
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const TOLERANCE_M = 4;

async function download() {
  for (const url of SERVERS) {
    try {
      const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: QUERY }), headers: { "User-Agent": "Kumm (build-rail)" } });
      if (r.ok) return await r.json();
      console.warn(`${url} : HTTP ${r.status}`);
    } catch (e) { console.warn(`${url} : ${e.message}`); }
  }
  throw new Error("aucun serveur Overpass n'a répondu");
}

const R = 6371000, rad = d => (d * Math.PI) / 180;
const dist = (a, b) => Math.hypot(rad(b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2)), rad(b[0] - a[0])) * R;
const round = ([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5];

/** Douglas-Peucker (en mètres), sans jamais retirer un point imposé (aiguillage, extrémité) */
function simplify(pts, fixed) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  pts.forEach((p, k) => { if (fixed(p)) keep[k] = 1; });
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bi = -1;
    const a = pts[i], b = pts[j], ab = dist(a, b);
    for (let k = i + 1; k < j; k++) {
      const ak = dist(a, pts[k]), bk = dist(b, pts[k]);
      const s = (ab + ak + bk) / 2, area = Math.sqrt(Math.max(0, s * (s - ab) * (s - ak) * (s - bk)));
      const d = ab > 0 ? (2 * area) / ab : ak;
      if (d > best) { best = d; bi = k; }
    }
    if (best > TOLERANCE_M) { keep[bi] = 1; stack.push([i, bi], [bi, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

const src = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : await download();
const ways = (src.elements ?? []).filter(w => w.type === "way" && w.geometry?.length >= 2).map(w => w.geometry.map(g => round([g.lat, g.lon])));
// un point présent dans plusieurs voies (ou deux fois dans la même) relie les voies entre elles : il est toujours gardé
const seen = new Map();
for (const w of ways) for (const p of w) { const k = p.join(","); seen.set(k, (seen.get(k) ?? 0) + 1); }
const out = ways.map(w => simplify(w, p => seen.get(p.join(",")) > 1));
const points = out.reduce((n, w) => n + w.length, 0);
if (out.length < 200) {
  console.error(`Résultat incomplet (${out.length} voies) : fichier inchangé.`);
  process.exit(1);
}
const json = JSON.stringify({ source: "© contributeurs OpenStreetMap (ODbL)", ways: out });
let previous = "";
try { previous = JSON.stringify({ ...JSON.parse(fs.readFileSync(OUT, "utf8")), generated: undefined }); } catch { /* premier fichier */ }
if (previous === json) console.log(`${out.length} voies, ${points} points : aucun changement.`);
else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, json);
  console.log(`${out.length} voies, ${points} points → ${path.relative(process.cwd(), OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} Ko)`);
}
