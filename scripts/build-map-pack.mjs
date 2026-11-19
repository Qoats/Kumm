// Construit la carte hors ligne de l'Eurométropole de Strasbourg : tuiles vectorielles, styles clair et sombre, icônes et polices.
//
// Données : © contributeurs OpenStreetMap (ODbL), tuiles OpenFreeMap (https://openfreemap.org), schéma © OpenMapTiles.
// Usage   : node scripts/build-map-pack.mjs [dossier-cache]
// Sortie  : web/public/offline/map/  (tiles.kmp, style-liberty.json, style-dark.json, sprite*, fonts/, LICENCE.txt)
//
// Format du paquet de tuiles « KMP1 » (lu par web/src/offline-map.ts), nombres en gros-boutiste :
//   en-tête (16 octets) : « KMP1 », nombre de tuiles (u32), 8 octets réservés
//   index (12 octets par tuile, triées par clé) : clé = z·2²⁸ + x·2¹⁴ + y (u32), position dans les données (u32), taille (u32)
//   données : les tuiles (protobuf vectoriel) compressées en gzip, à la suite
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

export const BBOX = { s: 48.44, w: 7.58, n: 48.72, e: 7.92 };
export const MAXZOOM = 14;
const OUT = fileURLToPath(new URL("../web/public/offline/map/", import.meta.url));
const UA = { "User-Agent": "kumm-offline-build/1.0 (https://github.com/Qoats/Kumm)" };
const RANGES = ["0-255", "256-511", "8192-8447"];   // latin, latin étendu (œ…), ponctuation (’ « » –)

export const tileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
export const tileY = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
export const tileKey = (z, x, y) => z * 2 ** 28 + x * 2 ** 14 + y;

/** Liste des tuiles (z, x, y) couvrant la zone, niveaux 0 à MAXZOOM */
export function tileList() {
  const out = [];
  for (let z = 0; z <= MAXZOOM; z++) {
    for (let x = tileX(BBOX.w, z); x <= tileX(BBOX.e, z); x++) for (let y = tileY(BBOX.n, z); y <= tileY(BBOX.s, z); y++) out.push([z, x, y]);
  }
  return out;
}

/** Assemble les tuiles (déjà compressées) en un paquet KMP1 */
export function packTiles(tiles) {
  const sorted = [...tiles].sort((a, b) => tileKey(a.z, a.x, a.y) - tileKey(b.z, b.x, b.y));
  const head = Buffer.alloc(16 + sorted.length * 12);
  head.write("KMP1", 0, "latin1");
  head.writeUInt32BE(sorted.length, 4);
  let offset = 0;
  sorted.forEach((t, i) => {
    const p = 16 + i * 12;
    head.writeUInt32BE(tileKey(t.z, t.x, t.y), p); head.writeUInt32BE(offset, p + 4); head.writeUInt32BE(t.data.length, p + 8);
    offset += t.data.length;
  });
  return Buffer.concat([head, ...sorted.map(t => t.data)]);
}

async function get(url, as = "buffer", tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
      if (r.status === 404 || r.status === 204) return null;
      if (!r.ok) throw Error("HTTP " + r.status);
      return as === "json" ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === tries - 1) throw Error(`${url} : ${e.message}`); await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
}

async function pool(items, size, fn) {
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); done++; if (done % 100 === 0) console.log(`  ${done}/${items.length}`); } }));
}

const slug = name => name.replace(/\s+/g, "-");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cache = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (cache) fs.mkdirSync(cache, { recursive: true });
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const tj = await get("https://tiles.openfreemap.org/planet", "json");
  const template = tj.tiles[0];
  const list = tileList();
  console.log(`${list.length} tuiles (zone ${JSON.stringify(BBOX)}, niveaux 0 à ${MAXZOOM}), source ${template}`);
  const tiles = [];
  await pool(list, 6, async ([z, x, y]) => {
    const file = cache && path.join(cache, `${z}-${x}-${y}.pbf`);
    let raw = file && fs.existsSync(file) ? fs.readFileSync(file) : await get(template.replace("{z}", z).replace("{x}", x).replace("{y}", y));
    if (raw && file && !fs.existsSync(file)) fs.writeFileSync(file, raw);
    if (raw && raw.length) tiles.push({ z, x, y, data: zlib.gzipSync(raw, { level: 9 }) });
  });
  const pack = packTiles(tiles);
  fs.writeFileSync(path.join(OUT, "tiles.kmp"), pack);
  console.log(`paquet : ${tiles.length} tuiles non vides, ${(pack.length / 1e6).toFixed(1)} Mo`);

  // styles : tuiles locales (protocole « kumm »), sans le relief ombré en ligne ; icônes et polices locales
  const fonts = new Set();
  let spriteBase = "";
  for (const name of ["liberty", "dark"]) {
    const st = await get("https://tiles.openfreemap.org/styles/" + name, "json");
    spriteBase = st.sprite;
    st.layers = st.layers.filter(l => !(l.source === "ne2_shaded"));
    delete st.sources["ne2_shaded"];
    st.sources["openmaptiles"] = { type: "vector", tiles: ["kumm://{z}/{x}/{y}"], minzoom: 0, maxzoom: MAXZOOM, attribution: tj.attribution };
    for (const l of st.layers) if (l.layout?.["text-font"]) { l.layout["text-font"].forEach(f => fonts.add(f)); l.layout["text-font"] = l.layout["text-font"].map(slug); }
    st.sprite = "__ORIGIN__/offline/map/sprite";
    st.glyphs = "__ORIGIN__/offline/map/fonts/{fontstack}/{range}.pbf";
    fs.writeFileSync(path.join(OUT, `style-${name}.json`), JSON.stringify(st));
  }
  for (const suffix of [".json", ".png", "@2x.json", "@2x.png"]) {
    const data = await get(spriteBase + suffix);
    if (!data) throw Error("icônes manquantes : " + suffix);
    fs.writeFileSync(path.join(OUT, "sprite" + suffix), data);
  }
  for (const f of fonts) {
    fs.mkdirSync(path.join(OUT, "fonts", slug(f)), { recursive: true });
    for (const range of RANGES) {
      const data = await get(`https://tiles.openfreemap.org/fonts/${encodeURIComponent(f)}/${range}.pbf`);
      if (data) fs.writeFileSync(path.join(OUT, "fonts", slug(f), `${range}.pbf`), data);
    }
  }
  fs.writeFileSync(path.join(OUT, "LICENCE.txt"), `Carte hors ligne de l'Eurométropole de Strasbourg.
Données © contributeurs OpenStreetMap, licence ODbL 1.0 : https://www.openstreetmap.org/copyright
Tuiles vectorielles : OpenFreeMap (https://openfreemap.org), schéma © OpenMapTiles (https://www.openmaptiles.org/, CC-BY 4.0).
Styles : OpenFreeMap « liberty » et « dark ». Polices : Noto Sans (SIL Open Font License 1.1).
Ces fichiers sont construits par scripts/build-map-pack.mjs ; le paquet de tuiles dérive d'OpenStreetMap et est redistribué sous la même licence ODbL.
`);
  const size = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
  console.log(`total : ${(size(OUT) / 1e6).toFixed(1)} Mo, polices : ${[...fonts].join(", ")}`);
}
