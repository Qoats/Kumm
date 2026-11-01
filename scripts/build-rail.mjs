// Voies ferrées du Grand Est (et de la ligne Paris-Est → Strasbourg) depuis OpenStreetMap, pour que les trains TER suivent les rails sur la carte.
// Utilisation : node scripts/build-rail.mjs                (télécharge via Overpass et écrit data/rail.json)
//               node scripts/build-rail.mjs fichier.json   (à partir d'une réponse Overpass déjà téléchargée)
// Relancé chaque nuit avec les tracés des lignes (.github/workflows/shapes.yml) ; un téléchargement incomplet est refusé.
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "rail.json");
// Voies ferrées, en plusieurs requêtes (une seule, trop grosse, est refusée par les serveurs) :
// - autour de Strasbourg (de Molsheim à Kehl, d'Erstein à Brumath, jusqu'à Lauterbourg) : voies principales, voies de gare et
//   aiguillages, mais pas les voies de garage, de triage ni les embranchements industriels, militaires ou touristiques ;
// - Alsace, Lorraine, Bâle, Palatinat et Sarre, puis la ligne Paris-Est → Strasbourg (trains TER jusqu'à Paris) : voies de
//   ligne seulement (ni voies de gare ni de service), y compris les petites lignes sans catégorie (vallée de la Bruche).
//   Les lignes à grande vitesse (LGV, 250 km/h et plus) sont exclues : les TER n'y roulent pas, et le plus court chemin les
//   prendrait entre Strasbourg et Saverne. Pas le marqueur « highspeed » : il est aussi posé sur des lignes classiques
//   rapides (Strasbourg-Bâle, Saverne-Lutzelbourg) où roulent les TER.
const LOCAL = '["service"!~"^(yard|siding|spur)$"]["usage"!~"^(industrial|military|tourism|test)$"]';
const MAIN = '["service"!~"."]["usage"!~"^(industrial|military|tourism|test)$"]["name"!~"LGV|grande vitesse|Schnellfahrstrecke"]["maxspeed"!~"^(2[5-9]|3[0-9])[0-9]"]';
const way = (filter, [s, w, n, e]) => `way["railway"="rail"]${filter}(${s},${w},${n},${e});`;
const QUERIES = [
  [way(LOCAL, [48.38, 7.45, 48.78, 7.95]), way(LOCAL, [48.66, 7.80, 48.99, 8.21])],
  // Alsace, Lorraine et alentours : 6 zones
  ...[[47.50, 48.40], [48.40, 49.30]].flatMap(([s, n]) => [[5.80, 6.70], [6.70, 7.55], [7.55, 8.35]].map(([w, e]) => [way(MAIN, [s, w, n, e])])),
  // ligne Paris-Est → Toul (Château-Thierry, Épernay, Châlons-en-Champagne, Vitry-le-François, Bar-le-Duc, Commercy)
  [way(MAIN, [48.60, 2.30, 49.15, 3.70])], [way(MAIN, [48.60, 3.70, 49.15, 4.80])], [way(MAIN, [48.55, 4.80, 49.00, 5.80])],
  // reste du Grand Est et trains qui en sortent : Reims, Verdun, Longwy, Thionville, Luxembourg (nord) ;
  // Troyes, Chaumont, Neufchâteau, Dijon (sud)
  ...[[3.70, 4.80], [4.80, 5.80], [5.80, 6.80]].map(([w, e]) => [way(MAIN, [49.00, w, 49.75, e])]),
  ...[[2.30, 3.50], [3.50, 4.70], [4.70, 5.80]].map(([w, e]) => [way(MAIN, [47.20, w, 48.60, e])]),
  // Ardennes (Charleville-Mézières, Sedan, Givet) : toutes les gares TER du Grand Est sont suivies
  [way(MAIN, [49.75, 3.90, 50.20, 5.60])]
].map(parts => `[out:json][timeout:180];(${parts.join("")});out geom;`);
// Serveurs publics d'OpenStreetMap, essayés à tour de rôle. Ils tombent parfois en panne (502, 504) :
// on refait plusieurs tours espacés, et si aucun ne répond, on garde les tracés de la veille sans faire échouer le travail.
const SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const PAUSES_S = [0, 60, 180];
const TOLERANCE_M = 4;

async function fetchOne(query) {
  for (const [round, pause] of PAUSES_S.entries()) {
    if (pause) { console.warn(`nouvel essai dans ${pause} s (tour ${round + 1}/${PAUSES_S.length})`); await new Promise((r) => setTimeout(r, pause * 1000)); }
    for (const url of SERVERS) {
      try {
        const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: query }), headers: { "User-Agent": "Kumm (build-rail)" }, signal: AbortSignal.timeout(240_000) });
        if (r.ok) return await r.json();
        console.warn(`${url} : HTTP ${r.status}`);
      } catch (e) { console.warn(`${url} : ${e.message}`); }
    }
  }
  return null;
}

/** Toutes les zones, réunies (une voie présente dans deux zones n'est gardée qu'une fois) ; une zone manquante : rien n'est changé */
async function download() {
  const byId = new Map();
  for (const [i, q] of QUERIES.entries()) {
    const j = await fetchOne(q);
    if (!j) {
      console.log(`::warning::Aucun serveur OpenStreetMap (Overpass) n'a répondu pour la zone ${i + 1}/${QUERIES.length} : les tracés actuels sont gardés, nouvel essai la nuit prochaine.`);
      process.exit(0);
    }
    for (const e of j.elements ?? []) if (e.type === "way") byId.set(e.id, e);
    console.log(`zone ${i + 1}/${QUERIES.length} : ${byId.size} voies au total`);
  }
  return { elements: [...byId.values()] };
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
