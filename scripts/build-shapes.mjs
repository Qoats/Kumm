// Tracés des lignes CTS (trams et bus) depuis OpenStreetMap, pour que les véhicules suivent leur vraie trajectoire sur la carte.
// Utilisation : npm run build:shapes            (télécharge via Overpass et écrit data/shapes.json)
//               node scripts/build-shapes.mjs fichier.json   (à partir d'une réponse Overpass déjà téléchargée)
// À relancer quand le réseau change (nouvelle ligne, déviation durable) ; le fichier produit est versionné.
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "shapes.json");
const QUERY = '[out:json][timeout:180];relation["type"="route"]["route"~"^(tram|bus)$"]["network"="Compagnie des Transports Strasbourgeois"](48.30,7.45,48.75,7.95);out geom;';
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const TOLERANCE_M = 3;   // simplification du tracé : écart maximal toléré, en mètres

async function download() {
  for (const url of SERVERS) {
    try {
      const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: QUERY }), headers: { "User-Agent": "Kumm (build-shapes)" } });
      if (r.ok) return await r.json();
      console.warn(`${url} : HTTP ${r.status}`);
    } catch (e) { console.warn(`${url} : ${e.message}`); }
  }
  throw new Error("aucun serveur Overpass n'a répondu");
}

const R = 6371000, rad = d => (d * Math.PI) / 180;
const dist = (a, b) => Math.hypot(rad(b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2)), rad(b[0] - a[0])) * R;
const same = (a, b) => dist(a, b) < 2;

/** Assemble les voies d'un itinéraire dans l'ordre de la relation, en retournant celles qui sont dans l'autre sens */
function stitch(ways) {
  let line = [];
  for (const w of ways) {
    if (!line.length) { line = [...w]; continue; }
    const end = line[line.length - 1], start = line[0];
    if (same(end, w[0])) line.push(...w.slice(1));
    else if (same(end, w[w.length - 1])) line.push(...[...w].reverse().slice(1));
    else if (line.length === ways[0].length && same(start, w[0])) { line.reverse(); line.push(...w.slice(1)); }        // la 1re voie était à l'envers
    else if (line.length === ways[0].length && same(start, w[w.length - 1])) { line.reverse(); line.push(...[...w].reverse().slice(1)); }
    else {
      // trou dans la relation : on continue par l'extrémité la plus proche
      line.push(...(dist(end, w[0]) <= dist(end, w[w.length - 1]) ? w : [...w].reverse()));
    }
  }
  return line;
}

/** Douglas-Peucker (en mètres) */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
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
    if (best > tol) { keep[bi] = 1; stack.push([i, bi], [bi, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

const src = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : await download();
const lines = {};
let variants = 0, points = 0;
for (const rel of src.elements ?? []) {
  const ref = rel.tags?.ref;
  if (rel.type !== "relation" || !ref) continue;
  // voies parcourues (rôle vide) ; les quais et arrêts ont leur propre rôle
  const ways = (rel.members ?? []).filter(m => m.type === "way" && !m.role && m.geometry?.length >= 2).map(m => m.geometry.map(g => [g.lat, g.lon]));
  if (!ways.length) continue;
  const shape = simplify(stitch(ways), TOLERANCE_M).map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]);
  (lines[ref] ??= []).push(shape);
  variants++; points += shape.length;
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: "© contributeurs OpenStreetMap (ODbL)", generated: new Date().toISOString().slice(0, 10), lines }));
console.log(`${Object.keys(lines).length} lignes, ${variants} itinéraires, ${points} points → ${path.relative(process.cwd(), OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} Ko)`);
