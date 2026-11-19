/**
 * Itinéraires à pied et à vélo calculés sur le téléphone, à partir d'un graphe de rues OpenStreetMap
 * (construit par scripts/build-walk-graph.mjs ; format décrit dans ce fichier). Aucune requête réseau : les coordonnées d'un
 * trajet ne quittent jamais l'appareil.
 *
 * Résultat au format OSRM (le même que celui du service public utilisé jusqu'ici) : le reste de l'appli n'a pas à changer.
 */
import type { OsrmResponse, OsrmRoute, OsrmStep } from "./geo-api.js";

export type WalkMode = "foot" | "bike";
export interface RawWalkGraph { v: number; vx: number[]; e: number[]; g: number[]; names: string[] }
type Pt = [number, number];   // [latitude, longitude]

const CLASSES = ["cycleway", "path", "footway", "pedestrian", "steps", "track", "service", "living_street", "residential", "unclassified", "tertiary", "secondary", "primary", "trunk", "other"];
const C = Object.fromEntries(CLASSES.map((n, i) => [n, i])) as Record<string, number>;
const E6 = 1e6;
const FOOT_MS = 1.35, BIKE_MS = 4.2, STAIRS_MS = 0.8;

/** Coefficient de pénibilité par type de voie (1 = voie ordinaire) */
const FOOT_FACTOR: Record<number, number> = {
  [C["steps"]]: 1.8, [C["footway"]]: 1, [C["pedestrian"]]: 0.95, [C["path"]]: 1.1, [C["track"]]: 1.2, [C["living_street"]]: 0.95,
  [C["residential"]]: 1, [C["service"]]: 1.1, [C["unclassified"]]: 1.05, [C["tertiary"]]: 1.05, [C["secondary"]]: 1.15, [C["primary"]]: 1.3, [C["cycleway"]]: 1.05, [C["other"]]: 1.2
};
const BIKE_FACTOR: Record<number, number> = {
  [C["cycleway"]]: 0.85, [C["track"]]: 1.1, [C["living_street"]]: 1, [C["residential"]]: 1, [C["service"]]: 1.25, [C["unclassified"]]: 1.05, [C["path"]]: 1.6,
  [C["footway"]]: 2.6, [C["pedestrian"]]: 2.2, [C["tertiary"]]: 1.2, [C["secondary"]]: 1.6, [C["primary"]]: 2.4, [C["trunk"]]: 3, [C["other"]]: 1.4, [C["steps"]]: 99
};

export interface WalkGraph {
  nV: number; nE: number;
  vLat: Int32Array; vLon: Int32Array;
  ea: Int32Array; eb: Int32Array; ef: Int32Array; en: Int32Array; egs: Int32Array; egl: Int32Array; len: Float32Array;
  gLat: Int32Array; gLon: Int32Array;
  names: string[];
  adjStart: Int32Array; adj: Int32Array;      // adj : arête * 2 + sens (0 : a vers b, 1 : b vers a)
  grid: Map<number, number[]>;
}

const CELL = 0.002;   // degrés : environ 220 m
const cellKey = (la: number, lo: number): number => Math.floor(la / CELL) * 100000 + Math.floor(lo / CELL);
const rad = (d: number): number => (d * Math.PI) / 180;
const dist = (a: Pt, b: Pt): number => Math.hypot((b[1] - a[1]) * 111_320 * Math.cos(rad((a[0] + b[0]) / 2)), (b[0] - a[0]) * 110_540);

function undelta(a: number[]): Int32Array {
  const out = new Int32Array(a.length);
  let la = 0, lo = 0;
  for (let i = 0; i < a.length; i += 2) { la += a[i]; lo += a[i + 1]; out[i] = la; out[i + 1] = lo; }
  return out;
}

export function loadWalkGraph(raw: RawWalkGraph): WalkGraph {
  if (raw.v !== 1) throw Error("Graphe de rues : version inconnue");
  const vxs = undelta(raw.vx), gs = undelta(raw.g);
  const nV = vxs.length / 2, nE = raw.e.length / 6;
  const g: WalkGraph = {
    nV, nE, vLat: new Int32Array(nV), vLon: new Int32Array(nV),
    ea: new Int32Array(nE), eb: new Int32Array(nE), ef: new Int32Array(nE), en: new Int32Array(nE), egs: new Int32Array(nE), egl: new Int32Array(nE),
    len: new Float32Array(nE), gLat: new Int32Array(gs.length / 2), gLon: new Int32Array(gs.length / 2), names: raw.names,
    adjStart: new Int32Array(nV + 1), adj: new Int32Array(nE * 2), grid: new Map()
  };
  for (let i = 0; i < nV; i++) { g.vLat[i] = vxs[i * 2]; g.vLon[i] = vxs[i * 2 + 1]; }
  for (let i = 0; i < g.gLat.length; i++) { g.gLat[i] = gs[i * 2]; g.gLon[i] = gs[i * 2 + 1]; }
  const deg = new Int32Array(nV + 1);
  for (let i = 0; i < nE; i++) {
    g.ea[i] = raw.e[i * 6]; g.eb[i] = raw.e[i * 6 + 1]; g.ef[i] = raw.e[i * 6 + 2]; g.en[i] = raw.e[i * 6 + 3]; g.egs[i] = raw.e[i * 6 + 4]; g.egl[i] = raw.e[i * 6 + 5];
    deg[g.ea[i]]++; deg[g.eb[i]]++;
  }
  for (let i = 0; i < nV; i++) g.adjStart[i + 1] = g.adjStart[i] + deg[i];
  const fill = g.adjStart.slice(0, nV);
  for (let i = 0; i < nE; i++) {
    g.adj[fill[g.ea[i]]++] = i * 2;
    g.adj[fill[g.eb[i]]++] = i * 2 + 1;
    const pts = edgePoints(g, i);
    let m = 0;
    for (let k = 1; k < pts.length; k++) {
      m += dist(pts[k - 1], pts[k]);
      const steps = Math.max(1, Math.ceil(dist(pts[k - 1], pts[k]) / 60));
      for (let s = 0; s <= steps; s++) {
        const la = pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * s / steps, lo = pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * s / steps;
        const key = cellKey(la, lo), cell = g.grid.get(key);
        if (!cell) g.grid.set(key, [i]); else if (cell[cell.length - 1] !== i) cell.push(i);
      }
    }
    g.len[i] = m;
  }
  return g;
}

/** Points d'une arête dans le sens a → b, extrémités comprises, en degrés */
function edgePoints(g: WalkGraph, e: number): Pt[] {
  const pts: Pt[] = [[g.vLat[g.ea[e]] / E6, g.vLon[g.ea[e]] / E6]];
  for (let k = 0; k < g.egl[e]; k++) pts.push([g.gLat[g.egs[e] + k] / E6, g.gLon[g.egs[e] + k] / E6]);
  pts.push([g.vLat[g.eb[e]] / E6, g.vLon[g.eb[e]] / E6]);
  return pts;
}

/** Sens de parcours autorisé pour ce mode ? (dir 0 : a → b, 1 : b → a) */
function allowed(g: WalkGraph, e: number, dir: number, mode: WalkMode): boolean {
  const f = g.ef[e];
  return mode === "foot" ? (f & 1) !== 0 : (f & (dir === 0 ? 2 : 4)) !== 0;
}

type Profile = "normal" | "direct";
/** Coût en secondes pondérées pour parcourir `m` mètres de cette arête */
function weight(g: WalkGraph, e: number, m: number, mode: WalkMode, profile: Profile): number {
  const cls = (g.ef[e] >> 8) & 255;
  if (mode === "foot") return (m / FOOT_MS) * (profile === "direct" ? 1 : (FOOT_FACTOR[cls] ?? 1.2));
  const infra = (g.ef[e] & 16) !== 0;
  const base = profile === "direct" ? 1 : (BIKE_FACTOR[cls] ?? 1.4) * (infra && cls > C["cycleway"] ? 0.85 : 1);
  return (m / BIKE_MS) * base;
}
const minWeightPerMeter = (mode: WalkMode, profile: Profile): number =>
  profile === "direct" ? (mode === "foot" ? 1 / FOOT_MS : 1 / BIKE_MS) : (mode === "foot" ? 0.95 / FOOT_MS : 0.72 / BIKE_MS);
const speedOf = (g: WalkGraph, e: number, mode: WalkMode): number => {
  const cls = (g.ef[e] >> 8) & 255;
  if (mode === "foot") return cls === C["steps"] ? STAIRS_MS : FOOT_MS;
  return cls === C["footway"] || cls === C["pedestrian"] || cls === C["path"] ? 3.2 : BIKE_MS;
};

interface Snap { e: number; along: number; lat: number; lon: number; off: number }

/** Point de la rue la plus proche, utilisable avec ce mode (recherche élargie par anneaux de cellules) */
export function snapToGraph(g: WalkGraph, lat: number, lon: number, mode: WalkMode): Snap | null {
  const kx = 111_320 * Math.cos(rad(lat)), ky = 110_540;
  let best = null as Snap | null;
  const cx = Math.floor(lo2(lon)), cy = Math.floor(la2(lat));
  for (let ring = 0; ring <= 8; ring++) {
    for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const cell = g.grid.get((cy + dy) * 100000 + (cx + dx));
      if (!cell) continue;
      for (const e of cell) {
        if (!allowed(g, e, 0, mode) && !allowed(g, e, 1, mode)) continue;
        const pts = edgePoints(g, e);
        let along = 0;
        for (let k = 1; k < pts.length; k++) {
          const ax = (pts[k - 1][1] - lon) * kx, ay = (pts[k - 1][0] - lat) * ky, bx = (pts[k][1] - lon) * kx, by = (pts[k][0] - lat) * ky;
          const sx = bx - ax, sy = by - ay, l2 = sx * sx + sy * sy;
          const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * sx + ay * sy) / l2));
          const px = ax + sx * t, py = ay + sy * t, d = Math.hypot(px, py), seg = Math.sqrt(l2);
          if (!best || d < best.off) best = { e, along: along + seg * t, lat: lat + py / ky, lon: lon + px / kx, off: d };
          along += seg;
        }
      }
    }
    if (best && best.off <= (ring + 0.5) * CELL * 110_000) break;
  }
  return best;
}
const la2 = (la: number): number => la / CELL, lo2 = (lo: number): number => lo / CELL;

/** Tas binaire minimal (clé = priorité) */
class Heap {
  private k: number[] = []; private v: number[] = [];
  get size(): number { return this.k.length; }
  peek(): number { return this.k[0]; }
  push(key: number, val: number): void {
    let i = this.k.length; this.k.push(key); this.v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= this.k[i]) break; this.swap(i, p); i = p; }
  }
  pop(): number {
    const top = this.v[0], lk = this.k.pop()!, lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < this.k.length && this.k[l] < this.k[m]) m = l;
        if (r < this.k.length && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void { [this.k[a], this.k[b]] = [this.k[b], this.k[a]]; [this.v[a], this.v[b]] = [this.v[b], this.v[a]]; }
}

interface Hop { e: number; dir: number }   // arête parcourue dans ce sens

function cumulative(pts: Pt[]): number[] {
  const c = [0];
  for (let k = 1; k < pts.length; k++) c.push(c[k - 1] + dist(pts[k - 1], pts[k]));
  return c;
}
/** Portion d'une polyligne entre deux distances (peut être parcourue à l'envers) */
function slice(pts: Pt[], cum: number[], from: number, to: number): Pt[] {
  const at = (d: number): Pt => {
    d = Math.max(0, Math.min(cum[cum.length - 1], d));
    let k = 1; while (k < cum.length - 1 && cum[k] < d) k++;
    const span = cum[k] - cum[k - 1], t = span === 0 ? 0 : (d - cum[k - 1]) / span;
    return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t];
  };
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const out: Pt[] = [at(lo)];
  for (let k = 0; k < pts.length; k++) if (cum[k] > lo + 0.01 && cum[k] < hi - 0.01) out.push(pts[k]);
  out.push(at(hi));
  return from <= to ? out : out.reverse();
}

function search(g: WalkGraph, mode: WalkMode, profile: Profile, s: Snap, t: Snap): { path: Hop[]; startVia: number; endVia: number } | null {
  const hW = minWeightPerMeter(mode, profile);
  const gScore = new Float64Array(g.nV).fill(Infinity);
  const via = new Int32Array(g.nV).fill(-1);      // code adj de l'arête qui a mené au sommet
  const closed = new Uint8Array(g.nV);
  const heap = new Heap();
  const goalLat = t.lat, goalLon = t.lon;
  const h = (v: number): number => dist([g.vLat[v] / E6, g.vLon[v] / E6], [goalLat, goalLon]) * hW;
  const push = (v: number, cost: number, code: number): void => { if (cost < gScore[v]) { gScore[v] = cost; via[v] = code; heap.push(cost + h(v), v); } };
  // départ : on peut rejoindre a (en descendant l'arête, sens 1) ou b (sens 0)
  const L = g.len[s.e];
  if (allowed(g, s.e, 1, mode)) push(g.ea[s.e], weight(g, s.e, s.along, mode, profile), -2);
  if (allowed(g, s.e, 0, mode)) push(g.eb[s.e], weight(g, s.e, L - s.along, mode, profile), -3);
  // arrivée : on y entre depuis a (sens 0) ou depuis b (sens 1)
  const LT = g.len[t.e];
  const goals = new Map<number, number>();
  if (allowed(g, t.e, 0, mode)) goals.set(g.ea[t.e], weight(g, t.e, t.along, mode, profile));
  if (allowed(g, t.e, 1, mode)) { const w = weight(g, t.e, LT - t.along, mode, profile); const o = goals.get(g.eb[t.e]); if (o === undefined || w < o) goals.set(g.eb[t.e], w); }
  let best = Infinity, bestV = -1;
  while (heap.size) {
    if (heap.peek() >= best) break;
    const v = heap.pop();
    if (closed[v]) continue;
    closed[v] = 1;
    const extra = goals.get(v);
    if (extra !== undefined && gScore[v] + extra < best) { best = gScore[v] + extra; bestV = v; }
    for (let k = g.adjStart[v]; k < g.adjStart[v + 1]; k++) {
      const code = g.adj[k], e = code >> 1, dir = code & 1;
      if (!allowed(g, e, dir, mode)) continue;
      const to = dir === 0 ? g.eb[e] : g.ea[e];
      if (closed[to]) continue;
      push(to, gScore[v] + weight(g, e, g.len[e], mode, profile), code);
    }
  }
  if (bestV < 0) return null;
  const path: Hop[] = [];
  let v = bestV, startVia = 0;
  for (;;) {
    const code = via[v];
    if (code === -2 || code === -3) { startVia = code; break; }
    const e = code >> 1, dir = code & 1;
    path.push({ e, dir });
    v = dir === 0 ? g.ea[e] : g.eb[e];
  }
  path.reverse();
  return { path, startVia, endVia: bestV };
}

const bearing = (a: Pt, b: Pt): number => {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};
const turnOf = (inB: number, outB: number): number => { let d = outB - inB; while (d > 180) d -= 360; while (d <= -180) d += 360; return d; };
const modifierOf = (d: number): string | undefined => {
  const a = Math.abs(d);
  if (a < 20) return "straight";
  if (a > 170) return "uturn";
  const side = d < 0 ? "left" : "right";
  return a < 60 ? `slight ${side}` : a < 135 ? side : `sharp ${side}`;
};

interface Seg { pts: Pt[]; e: number; name: string; round: boolean; meters: number; seconds: number }

function describe(g: WalkGraph, mode: WalkMode, s: Snap, t: Snap, found: { path: Hop[]; startVia: number; endVia: number } | null, sameEdge: Pt[] | null): OsrmRoute | null {
  let segs: Seg[] = [];
  const mk = (e: number, pts: Pt[]): Seg => {
    const m = cumulative(pts).at(-1) ?? 0;
    return { pts, e, name: g.names[g.en[e]] ?? "", round: (g.ef[e] & 8) !== 0, meters: m, seconds: m / speedOf(g, e, mode) };
  };
  if (sameEdge) segs.push(mk(s.e, sameEdge));
  else if (found) {
    const sp = edgePoints(g, s.e), sc = cumulative(sp);
    segs.push(mk(s.e, found.startVia === -2 ? slice(sp, sc, s.along, 0) : slice(sp, sc, s.along, sc.at(-1)!)));
    for (const h of found.path) {
      const pts = edgePoints(g, h.e);
      segs.push(mk(h.e, h.dir === 0 ? pts : [...pts].reverse()));
    }
    const tp = edgePoints(g, t.e), tc = cumulative(tp);
    const enteredFromA = found.endVia === g.ea[t.e];
    segs.push(mk(t.e, enteredFromA ? slice(tp, tc, 0, t.along) : slice(tp, tc, tc.at(-1)!, t.along)));
  } else return null;

  // un point de départ ou d'arrivée posé exactement sur un carrefour laisse un tronçon de longueur nulle : il fausserait les virages
  const real = segs.filter(sg => sg.meters > 0.5);
  if (real.length) segs = real;

  // tracé continu
  const coords: [number, number][] = [];
  let distance = 0, duration = 0;
  for (const sg of segs) {
    distance += sg.meters; duration += sg.seconds;
    for (const p of sg.pts) { const c: [number, number] = [p[1], p[0]]; const last = coords.at(-1); if (!last || last[0] !== c[0] || last[1] !== c[1]) coords.push(c); }
  }
  if (coords.length < 2) coords.push([...coords[0]] as [number, number]);

  // consignes
  const steps: OsrmStep[] = [];
  const nameOf = (sg: Seg): string | undefined => sg.name || undefined;
  const lastDir = (pts: Pt[]): number => { for (let k = pts.length - 1; k > 0; k--) if (dist(pts[k - 1], pts[k]) > 3) return bearing(pts[k - 1], pts[k]); return bearing(pts[0], pts.at(-1)!); };
  const firstDir = (pts: Pt[]): number => { for (let k = 1; k < pts.length; k++) if (dist(pts[0], pts[k]) > 3) return bearing(pts[0], pts[k]); return bearing(pts[0], pts.at(-1)!); };
  const degreeAt = (v: [number, number]): number => {
    // nombre de rues praticables au carrefour : repéré par les coordonnées du premier point du segment suivant
    const idx = nearestVertex(g, v[0], v[1]);
    return idx < 0 ? 0 : g.adjStart[idx + 1] - g.adjStart[idx];
  };
  steps.push({ distance: segs[0].meters, name: nameOf(segs[0]), maneuver: { type: "depart", location: [segs[0].pts[0][1], segs[0].pts[0][0]] } });
  let roundExit = 0, inRound = segs[0].round, roundStep: OsrmStep | null = null;
  for (let i = 1; i < segs.length; i++) {
    const prev = segs[i - 1], cur = segs[i];
    const at = cur.pts[0], loc: [number, number] = [at[1], at[0]];
    const deg = degreeAt(loc);
    if (cur.round && !prev.round) {
      roundExit = 0; inRound = true;
      roundStep = { distance: cur.meters, name: nameOf(cur), maneuver: { type: "roundabout", modifier: modifierOf(turnOf(lastDir(prev.pts), firstDir(cur.pts))), location: loc, exit: 0 } };
      steps.push(roundStep);
      continue;
    }
    if (cur.round && prev.round) { if (deg >= 3) roundExit++; steps.at(-1)!.distance += cur.meters; continue; }
    if (!cur.round && prev.round && inRound) {
      roundExit++; inRound = false;
      if (roundStep) roundStep.maneuver.exit = roundExit;
      steps.push({ distance: cur.meters, name: nameOf(cur), maneuver: { type: "exit roundabout", modifier: modifierOf(turnOf(lastDir(prev.pts), firstDir(cur.pts))), location: loc } });
      continue;
    }
    const d = turnOf(lastDir(prev.pts), firstDir(cur.pts));
    const sameName = prev.name === cur.name;
    const bend = Math.abs(d) >= 30;   // un carrefour à deux rues seulement (changement de voie) est annoncé si on y tourne
    if (bend || (!sameName && (prev.name || cur.name) && deg >= 3)) {
      steps.push({ distance: cur.meters, name: nameOf(cur), maneuver: { type: "turn", modifier: modifierOf(d), location: loc } });
    } else steps.at(-1)!.distance += cur.meters;
  }
  const end = segs.at(-1)!.pts.at(-1)!;
  steps.push({ distance: 0, maneuver: { type: "arrive", location: [end[1], end[0]] } });
  for (const st of steps) st.distance = Math.round(st.distance);
  return { distance: Math.round(distance), duration: Math.round(duration), geometry: { coordinates: coords }, legs: [{ steps }] };
}

/** Sommet le plus proche d'un point (recherche dans la grille) : sert à connaître le nombre de rues d'un carrefour */
function nearestVertex(g: WalkGraph, lon: number, lat: number): number {
  const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
  let best = -1, bd = 1.5;   // 1,5 m : le point est exactement un sommet
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    for (const e of g.grid.get((cy + dy) * 100000 + (cx + dx)) ?? []) {
      for (const v of [g.ea[e], g.eb[e]]) {
        const d = dist([g.vLat[v] / E6, g.vLon[v] / E6], [lat, lon]);
        if (d < bd) { bd = d; best = v; }
      }
    }
  }
  return best;
}

function route(g: WalkGraph, mode: WalkMode, s: Snap, t: Snap, profile: Profile): { route: OsrmRoute; signature: string } | null {
  if (s.e === t.e) {
    const pts = edgePoints(g, s.e), cum = cumulative(pts);
    const dir = t.along >= s.along ? 0 : 1;
    if (allowed(g, s.e, dir, mode)) {
      const r = describe(g, mode, s, t, null, slice(pts, cum, s.along, t.along));
      if (r) return { route: r, signature: String(s.e) };
    }
  }
  const found = search(g, mode, profile, s, t);
  if (!found) return null;
  const r = describe(g, mode, s, t, found, null);
  return r ? { route: r, signature: [s.e, ...found.path.map(h => h.e), t.e].join(",") } : null;
}

/**
 * Itinéraire entre deux points. À vélo, une deuxième proposition « plus directe » est ajoutée si elle diffère nettement.
 * Retourne la réponse au format OSRM ; code « NoRoute » si aucune rue praticable ne relie les deux points.
 */
export function routeOnGraph(g: WalkGraph, mode: WalkMode, from: { lat: number; lon: number }, to: { lat: number; lon: number }): OsrmResponse {
  const s = snapToGraph(g, from.lat, from.lon, mode), t = snapToGraph(g, to.lat, to.lon, mode);
  if (!s || !t || s.off > 600 || t.off > 600) return { code: "NoSegment" };
  const main = route(g, mode, s, t, "normal");
  if (!main) return { code: "NoRoute" };
  const routes: OsrmRoute[] = [main.route];
  if (mode === "bike") {
    const alt = route(g, mode, s, t, "direct");
    if (alt && alt.signature !== main.signature) {
      const shorter = Math.abs(alt.route.distance - main.route.distance) / main.route.distance >= 0.03;
      const a = new Set(alt.signature.split(",")), b = new Set(main.signature.split(","));
      let common = 0; for (const x of a) if (b.has(x)) common++;
      if (shorter || common / Math.max(a.size, b.size) < 0.85) routes.push(alt.route);
    }
  }
  return { code: "Ok", routes };
}
