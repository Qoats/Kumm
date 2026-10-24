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

/** Nœuds (points des voies ; un point commun à deux voies est un aiguillage), voisins, et tronçons (pour rattacher une gare) */
const nodes: Pt[] = [];
const edges: { to: number; m: number }[][] = [];
const segs: [number, number][] = [];
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
        if (a === b) continue;
        edges[a].push({ to: b, m }); edges[b].push({ to: a, m }); segs.push([a, b]);
      }
    }
  }
} catch (e) { console.warn("Voies ferrées illisibles :", e instanceof Error ? e.message : e); }
console.log(`Voies ferrées : ${nodes.length ? nodes.length + " points" : "aucune (trains en ligne droite entre deux gares)"}`);

const SNAP_M = 400;                // une gare à plus de 400 m des voies connues : hors de la zone couverte

/** Point de voie le plus proche d'une gare : sur le tronçon a → b, à da mètres de a et db mètres de b */
interface Snap { a: number; b: number; q: Pt; da: number; db: number }
function snap(p: Pt): Snap | null {
  const k = Math.cos(rad(p[0]));
  let best: Snap | null = null, bd = SNAP_M;
  for (const [a, b] of segs) {
    const A = nodes[a], B = nodes[b];
    if (Math.min(A[0], B[0]) > p[0] + 0.005 || Math.max(A[0], B[0]) < p[0] - 0.005) continue;   // filtre rapide (≈ 550 m)
    const dx = (B[1] - A[1]) * k, dy = B[0] - A[0], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, (((p[1] - A[1]) * k) * dx + (p[0] - A[0]) * dy) / l2)) : 0;
    const q: Pt = [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])], d = dist(p, q);
    if (d < bd) { bd = d; best = { a, b, q, da: dist(A, q), db: dist(B, q) }; }
  }
  return best;
}

/** Plus court chemin entre deux points de voie (Dijkstra, tas binaire) : liste des nœuds traversés */
function shortest(from: Snap, to: Snap): number[] | null {
  const d = new Map<number, number>(), prev = new Map<number, number>(), heap: [number, number][] = [];
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
  for (const [n, c] of [[from.a, from.da], [from.b, from.db]] as const) if (c < (d.get(n) ?? Infinity)) { d.set(n, c); push([c, n]); }
  const done = new Set<number>();
  while (heap.length && !(done.has(to.a) && done.has(to.b))) {
    const [cost, u] = pop();
    if (done.has(u)) continue;
    done.add(u);
    for (const e of edges[u]) {
      const c = cost + e.m;
      if (c < (d.get(e.to) ?? Infinity)) { d.set(e.to, c); prev.set(e.to, u); push([c, e.to]); }
    }
  }
  const viaA = (d.get(to.a) ?? Infinity) + to.da, viaB = (d.get(to.b) ?? Infinity) + to.db;
  if (!Number.isFinite(Math.min(viaA, viaB))) return null;
  const out = [viaA <= viaB ? to.a : to.b];
  for (let u = out[0]; prev.has(u);) { u = prev.get(u)!; out.push(u); }
  return out.reverse();
}

const cache = new Map<string, Pt[] | null>();

/** Trajet d'un train entre deux gares, le long des voies ; null si inconnu (ligne droite) */
export function railBetween(a: Pt, b: Pt): Pt[] | null {
  if (!nodes.length) return null;
  const k = `${a[0]},${a[1]}>${b[0]},${b[1]}`;
  if (cache.has(k)) return cache.get(k) ?? null;
  let res: Pt[] | null = null;
  const from = snap(a), to = snap(b);
  if (from && to) {
    // même tronçon : droit sur la voie ; sinon plus court chemin le long des voies
    const ids = from.a === to.a && from.b === to.b ? [] : shortest(from, to);
    if (ids) {
      const pts: Pt[] = [a, from.q, ...ids.map(i => nodes[i]), to.q, b];
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
      if (len < dist(a, b) * 2.5 + 1000) res = pts;                        // sinon : détour invraisemblable (voie manquante)
    }
  }
  if (cache.size > 5000) cache.clear();
  cache.set(k, res);
  return res;
}
