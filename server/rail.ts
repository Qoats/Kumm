/**
 * Voies ferrées autour de Strasbourg (data/rail.json, extrait d'OpenStreetMap par scripts/build-shapes.mjs) : un train suit
 * les rails entre deux gares (plus court chemin sur le réseau des voies), au lieu d'une ligne droite.
 * Sans le fichier, ou si une gare est hors de la zone couverte, le train va en ligne droite.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Pt = [number, number];

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = [path.join(here, "..", "..", "data", "rail.json"), path.join(here, "..", "data", "rail.json")].find(f => fs.existsSync(f));

const R = 6371000, rad = (d: number): number => (d * Math.PI) / 180;
const dist = (a: Pt, b: Pt): number => Math.hypot(rad(b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2)), rad(b[0] - a[0])) * R;

/** Nœuds (points des voies ; un point commun à deux voies est un aiguillage) et voisins */
const nodes: Pt[] = [];
const edges: { to: number; m: number }[][] = [];
try {
  if (FILE) {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8")) as { ways?: Pt[][] };
    const index = new Map<string, number>();
    const id = (p: Pt): number => {
      const k = p[0] + "," + p[1];
      let i = index.get(k);
      if (i === undefined) { i = nodes.length; nodes.push(p); edges.push([]); index.set(k, i); }
      return i;
    };
    for (const w of j.ways ?? []) {
      for (let k = 1; k < w.length; k++) {
        const a = id(w[k - 1]), b = id(w[k]), m = dist(w[k - 1], w[k]);
        edges[a].push({ to: b, m }); edges[b].push({ to: a, m });
      }
    }
  }
} catch (e) { console.warn("Voies ferrées illisibles :", e instanceof Error ? e.message : e); }
console.log(`Voies ferrées : ${nodes.length ? nodes.length + " points" : "aucune (trains en ligne droite entre deux gares)"}`);

const SNAP_M = 400;                // une gare à plus de 400 m des voies connues : hors de la zone couverte

function nearest(p: Pt): number {
  let best = -1, bd = SNAP_M;
  for (let i = 0; i < nodes.length; i++) {
    if (Math.abs(nodes[i][0] - p[0]) > 0.005) continue;               // filtre rapide (≈ 550 m)
    const d = dist(p, nodes[i]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Plus court chemin (Dijkstra, tas binaire) */
function shortest(from: number, to: number): number[] | null {
  const d = new Map<number, number>([[from, 0]]), prev = new Map<number, number>(), heap: [number, number][] = [[0, from]];
  const push = (x: [number, number]): void => {
    heap.push(x);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = (): [number, number] => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [cost, u] = pop();
    if (u === to) break;
    if (cost > (d.get(u) ?? Infinity)) continue;
    for (const e of edges[u]) {
      const c = cost + e.m;
      if (c < (d.get(e.to) ?? Infinity)) { d.set(e.to, c); prev.set(e.to, u); push([c, e.to]); }
    }
  }
  if (!d.has(to)) return null;
  const out = [to];
  for (let u = to; u !== from;) { u = prev.get(u)!; out.push(u); }
  return out.reverse();
}

const cache = new Map<string, Pt[] | null>();

/** Trajet d'un train entre deux gares, le long des voies ; null si inconnu (ligne droite) */
export function railBetween(a: Pt, b: Pt): Pt[] | null {
  if (!nodes.length) return null;
  const k = `${a[0]},${a[1]}>${b[0]},${b[1]}`;
  if (cache.has(k)) return cache.get(k) ?? null;
  let res: Pt[] | null = null;
  const from = nearest(a), to = nearest(b);
  if (from >= 0 && to >= 0 && from !== to) {
    const ids = shortest(from, to);
    if (ids) {
      const pts = ids.map(i => nodes[i]);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
      if (len < dist(a, b) * 2.5 + 1000) res = [a, ...pts, b];             // sinon : détour invraisemblable (voie manquante)
    }
  }
  if (cache.size > 5000) cache.clear();
  cache.set(k, res);
  return res;
}
