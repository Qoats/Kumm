// Construit le graphe de rues de l'Eurométropole de Strasbourg pour les itinéraires à pied et à vélo hors ligne.
//
// Données : © contributeurs OpenStreetMap (ODbL), récupérées via l'API Overpass publique.
// Usage   : node scripts/build-walk-graph.mjs [extrait-overpass.json]
//           sans argument, l'extrait est téléchargé en 9 petites requêtes (zone ci-dessous).
// Sortie  : web/public/offline/walk-graph.bin (lu par shared/walk-graph.ts, format décrit dans ce fichier)
//
// Format v1 (tous les tableaux sont à plat, coordonnées en micro-degrés ENTIERS, codées en différences) :
//   vx     : [lat, lon, lat, lon, …]   sommets (carrefours et bouts de rue)
//   e      : [a, b, flags, nom, début, longueur, …]   arêtes, 6 entiers chacune ; a et b indexent vx
//   g      : [lat, lon, …]             points intermédiaires de toutes les arêtes (début et longueur comptent des POINTS)
//   names  : noms de rues
//   flags  : bits 1 piéton · 2 vélo a→b · 4 vélo b→a · 8 rond-point · 16 aménagement cyclable · 256× classe de voie (CLASSES)
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

export const BBOX = { s: 48.44, w: 7.58, n: 48.72, e: 7.92 };
export const CLASSES = ["cycleway", "path", "footway", "pedestrian", "steps", "track", "service", "living_street", "residential", "unclassified", "tertiary", "secondary", "primary", "trunk", "other"];
const OUT = fileURLToPath(new URL("../web/public/offline/walk-graph.bin", import.meta.url));
const HOSTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const FILTER = `["highway"]["highway"!~"^(motorway|motorway_link|proposed|construction|raceway|bus_guideway|escape|corridor|elevator|platform)$"]`;
const E6 = 1e6;

/** Télécharge les rues en 3×3 tuiles (une grosse requête est refusée par Overpass) */
async function download() {
  const nodes = new Map(), ways = new Map(), sleep = ms => new Promise(r => setTimeout(r, ms));
  const rows = 3, cols = 3;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const s = BBOX.s + (BBOX.n - BBOX.s) * i / rows, n = BBOX.s + (BBOX.n - BBOX.s) * (i + 1) / rows;
    const w = BBOX.w + (BBOX.e - BBOX.w) * j / cols, e = BBOX.w + (BBOX.e - BBOX.w) * (j + 1) / cols;
    const q = `[out:json][timeout:120];way${FILTER}(${s},${w},${n},${e});out body qt;>;out skel qt;`;
    let done = false;
    for (let attempt = 0; attempt < 8 && !done; attempt++) {
      try {
        const r = await fetch(HOSTS[attempt % HOSTS.length], { method: "POST", body: new URLSearchParams({ data: q }), headers: { "User-Agent": "kumm-offline-build/1.0 (https://github.com/Qoats/Kumm)" }, signal: AbortSignal.timeout(150_000) });
        if (!r.ok) { await sleep(4000); continue; }
        for (const el of (await r.json()).elements) {
          if (el.type === "way") ways.set(el.id, { id: el.id, nodes: el.nodes, tags: el.tags ?? {} });
          else if (el.type === "node") nodes.set(el.id, [el.lat, el.lon]);
        }
        done = true;
      } catch { await sleep(4000); }
    }
    if (!done) throw Error(`Overpass indisponible (tuile ${i},${j})`);
    console.log(`tuile ${i},${j}`, ways.size, "rues");
  }
  return { ways: [...ways.values()], nodes: Object.fromEntries(nodes) };
}

const yes = v => v === "yes" || v === "designated" || v === "permissive" || v === "official";
const no = v => v === "no" || v === "private" || v === "dismount";

/** Règles d'accès d'une rue : { foot, bikeFwd, bikeBack, cls, infra } ou null si inutilisable */
export function access(tags) {
  const h = tags.highway;
  if (!h) return null;
  const cls = CLASSES.includes(h) ? CLASSES.indexOf(h) : h.endsWith("_link") && CLASSES.includes(h.slice(0, -5)) ? CLASSES.indexOf(h.slice(0, -5)) : CLASSES.indexOf("other");
  if (h === "bridleway" || h === "bus_stop" || h === "rest_area" || h === "services" || h === "motorway" || h === "motorway_link") return null;
  const blocked = (tags.access === "no" || tags.access === "private") && !yes(tags.foot) && !yes(tags.bicycle);
  if (blocked) return null;
  let foot = !no(tags.foot) && h !== "cycleway" && h !== "trunk" && h !== "trunk_link";
  if (h === "cycleway") foot = yes(tags.foot);
  if (h === "trunk" || h === "trunk_link") foot = yes(tags.foot);
  if (tags.foot === "no") foot = false;
  let bike = !no(tags.bicycle) && h !== "steps" && h !== "trunk" && h !== "trunk_link";
  if (h === "footway" || h === "pedestrian" || h === "path") bike = yes(tags.bicycle);
  if (h === "steps") bike = false;
  if (tags.bicycle === "no") bike = false;
  if (yes(tags.bicycle) && h !== "steps") bike = true;
  const roundabout = tags.junction === "roundabout" || tags.junction === "circular";
  const ow = tags.oneway;
  let fwd = true, back = true;
  if (ow === "yes" || ow === "1" || ow === "true" || roundabout) { back = false; }
  else if (ow === "-1" || ow === "reverse") { fwd = false; }
  const opposite = tags["oneway:bicycle"] === "no" || /opposite/.test([tags.cycleway, tags["cycleway:left"], tags["cycleway:right"], tags["cycleway:both"]].join(" ")) || h === "cycleway" && !ow;
  if (opposite) { fwd = true; back = true; }
  const lane = [tags.cycleway, tags["cycleway:left"], tags["cycleway:right"], tags["cycleway:both"]].some(v => v === "lane" || v === "track" || v === "shared_lane" || v === "share_busway");
  const infra = h === "cycleway" || lane || tags.bicycle === "designated";
  if (!foot && !bike) return null;
  return { foot, bikeFwd: bike && fwd, bikeBack: bike && back, cls, infra, roundabout, name: tags.name ?? tags.ref ?? "" };
}

/** Transforme un extrait Overpass { ways, nodes } en graphe compact */
export function buildGraph({ ways, nodes }) {
  const usable = [];
  const uses = new Map();
  for (const w of ways) {
    const a = access(w.tags);
    if (!a || w.nodes.length < 2) continue;
    usable.push({ w, a });
    for (const id of w.nodes) uses.set(id, (uses.get(id) ?? 0) + 1);
  }
  const vertexOf = new Map(), vx = [];
  const vertex = id => {
    let i = vertexOf.get(id);
    if (i === undefined) { const [la, lo] = nodes[id]; i = vx.length; vertexOf.set(id, i); vx.push([Math.round(la * E6), Math.round(lo * E6)]); }
    return i;
  };
  const nameIdx = new Map(), names = [""];
  nameIdx.set("", 0);
  const edges = [];
  for (const { w, a } of usable) {
    const ids = w.nodes.filter(id => nodes[id]);
    if (ids.length < 2) continue;
    let startAt = 0;
    for (let k = 1; k < ids.length; k++) {
      const isVertex = k === ids.length - 1 || uses.get(ids[k]) >= 2;
      if (!isVertex) continue;
      const mid = ids.slice(startAt + 1, k).map(id => [Math.round(nodes[id][0] * E6), Math.round(nodes[id][1] * E6)]);
      if (a.name && !nameIdx.has(a.name)) { nameIdx.set(a.name, names.length); names.push(a.name); }
      const flags = (a.foot ? 1 : 0) | (a.bikeFwd ? 2 : 0) | (a.bikeBack ? 4 : 0) | (a.roundabout ? 8 : 0) | (a.infra ? 16 : 0) | (a.cls << 8);
      const from = vertex(ids[startAt]), to = vertex(ids[k]);
      if (from !== to || mid.length > 1) edges.push({ a: from, b: to, flags, name: nameIdx.get(a.name) ?? 0, mid });
      startAt = k;
    }
  }
  // ne garde que la plus grande composante connexe : évite d'accrocher un départ sur un morceau isolé (cour, parking fermé)
  const parent = Int32Array.from({ length: vx.length }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const e of edges) parent[find(e.a)] = find(e.b);
  const size = new Map();
  for (let i = 0; i < vx.length; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
  const main = [...size.entries()].sort((x, y) => y[1] - x[1])[0][0];
  const kept = edges.filter(e => find(e.a) === main);
  const remap = new Int32Array(vx.length).fill(-1);
  const outVx = [];
  for (const e of kept) for (const v of [e.a, e.b]) if (remap[v] < 0) { remap[v] = outVx.length / 2; outVx.push(vx[v][0], vx[v][1]); }
  const e = [], g = [];
  let gPoints = 0;
  for (const ed of kept) {
    e.push(remap[ed.a], remap[ed.b], ed.flags, ed.name, gPoints, ed.mid.length);
    for (const [la, lo] of ed.mid) g.push(la, lo);
    gPoints += ed.mid.length;
  }
  const delta = arr => { const out = new Array(arr.length); let pa = 0, po = 0; for (let i = 0; i < arr.length; i += 2) { out[i] = arr[i] - pa; out[i + 1] = arr[i + 1] - po; pa = arr[i]; po = arr[i + 1]; } return out; };
  return { v: 1, vx: delta(outVx), e, g: delta(g), names };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  const raw = input ? JSON.parse(fs.readFileSync(input, "utf8")) : await download();
  const graph = buildGraph(raw);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(graph)), { level: 9 });
  fs.writeFileSync(OUT, gz);
  console.log(`graphe : ${graph.vx.length / 2} sommets, ${graph.e.length / 6} arêtes, ${graph.g.length / 2} points, ${(gz.length / 1e6).toFixed(2)} Mo (gzip)`);
}
