/**
 * Voies ferrées d'Alsace, de Lorraine et de la ligne Paris-Est → Strasbourg (data/rail.json, extrait d'OpenStreetMap par scripts/build-rail.mjs) : un train suit
 * les rails entre deux gares (plus court chemin sur le réseau des voies), au lieu d'une ligne droite.
 * Sans les voies, ou si une gare est hors de la zone couverte, le train va en ligne droite.
 * Module pur (aucun accès au disque ni au réseau) : utilisé par le serveur et par le moteur local d'Android.
 */
type Pt = [number, number];

const R = 6371000, rad = (d: number): number => (d * Math.PI) / 180;
const dist = (a: Pt, b: Pt): number => Math.hypot(rad(b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2)), rad(b[0] - a[0])) * R;

export function createRail(ways: Pt[][], log: (m: string) => void = () => undefined): { railBetween(a: Pt, b: Pt): Pt[] | null; points: number } {
/** Nœuds (points des voies ; un point commun à deux voies est un aiguillage), voisins, et tronçons (pour rattacher une gare) */
const nodes: Pt[] = [];
const edges: { to: number; m: number }[][] = [];
const segs: [number, number][] = [];
{
  const index = new Map<string, number>();
  const id = (p: Pt): number => {
    const k = p[0] + "," + p[1];
    let i = index.get(k);
    if (i === undefined) { i = nodes.length; nodes.push(p); edges.push([]); index.set(k, i); }
    return i;
  };
  for (const w of ways) {
    for (let k = 1; k < w.length; k++) {
      const a = id(w[k - 1]), b = id(w[k]), m = dist(w[k - 1], w[k]);
      if (a === b) continue;
      edges[a].push({ to: b, m }); edges[b].push({ to: a, m }); segs.push([a, b]);
    }
  }
}
joinDeadEnds();
linkParallelTracks();

/**
 * Voie qui s'arrête net (bout de tracé manquant dans OpenStreetMap, ou voie coupée en deux zones) à moins de 30 m d'une autre
 * voie : rattachée au point le plus proche de celle-ci (le tronçon est coupé en deux à cet endroit). Sans ça, à Benfeld, un
 * train partant vers le sud repartait d'abord 4 km vers le nord pour changer de voie.
 */
function joinDeadEnds(): void {
  const JOIN_M = 30, CELL = 0.001;
  const grid = new Map<string, number[]>();   // case → tronçons (indices dans segs) qui la touchent
  const addSeg = (k: number): void => {
    const [a, b] = segs[k], A = nodes[a], B = nodes[b];
    for (let x = Math.floor(Math.min(A[0], B[0]) / CELL); x <= Math.floor(Math.max(A[0], B[0]) / CELL); x++)
      for (let y = Math.floor(Math.min(A[1], B[1]) / CELL); y <= Math.floor(Math.max(A[1], B[1]) / CELL); y++) {
        const key = x + "," + y; (grid.get(key) ?? grid.set(key, []).get(key)!).push(k);
      }
  };
  segs.forEach((_, k) => addSeg(k));
  const ends = nodes.map((_, i) => i).filter(i => edges[i].length === 1);
  let joined = 0;
  for (const i of ends) {
    const p = nodes[i], k0 = Math.cos(rad(p[0]));
    let best: { k: number; t: number; q: Pt; d: number } | null = null;
    const seen = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const k of grid.get((Math.floor(p[0] / CELL) + dx) + "," + (Math.floor(p[1] / CELL) + dy)) ?? []) {
      if (seen.has(k)) continue;
      seen.add(k);
      const [a, b] = segs[k];
      if (a === i || b === i || edges[i][0].to === a || edges[i][0].to === b) continue;
      const A = nodes[a], B = nodes[b], dx2 = (B[1] - A[1]) * k0, dy2 = B[0] - A[0], l2 = dx2 * dx2 + dy2 * dy2;
      const t = l2 ? Math.max(0, Math.min(1, (((p[1] - A[1]) * k0) * dx2 + (p[0] - A[0]) * dy2) / l2)) : 0;
      const q: Pt = [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])], d = dist(p, q);
      if (d < JOIN_M && (!best || d < best.d)) best = { k, t, q, d };
    }
    if (!best) continue;
    const [a, b] = segs[best.k];
    let j: number;
    if (best.t <= 0.001) j = a;
    else if (best.t >= 0.999) j = b;
    else {
      // nouveau point au milieu du tronçon a → b
      j = nodes.length; nodes.push(best.q); edges.push([]);
      const ma = dist(nodes[a], best.q), mb = dist(best.q, nodes[b]);
      edges[a] = edges[a].filter(e => e.to !== b); edges[b] = edges[b].filter(e => e.to !== a);
      edges[a].push({ to: j, m: ma }); edges[j].push({ to: a, m: ma }); edges[b].push({ to: j, m: mb }); edges[j].push({ to: b, m: mb });
      segs[best.k] = [a, j]; segs.push([j, b]); addSeg(best.k); addSeg(segs.length - 1);
    }
    edges[i].push({ to: j, m: best.d }); edges[j].push({ to: i, m: best.d }); segs.push([i, j]);
    joined++;
  }
  if (joined) log(`Voies ferrées : ${joined} bouts de voie raccordés`);
}

/**
 * Voies parallèles reliées entre elles : sur une ligne à deux voies, chaque voie est un tracé à part, et les aiguillages qui
 * les relient manquent souvent (ou sont des voies de service, non téléchargées). Sans ce lien, un train qui « accroche »
 * la mauvaise voie en gare devrait aller jusqu'au prochain raccordement et revenir (Saverne → Lutzelbourg : 31 km au lieu
 * de 10). Deux points à moins de 30 m l'un de l'autre, sur des voies presque parallèles (moins de 20°), sont reliés, avec
 * un léger surcoût pour que le train reste sur sa voie quand il le peut. Deux lignes qui se croisent (pont) ne sont pas
 * reliées : elles ne sont pas parallèles.
 */
function linkParallelTracks(): void {
  const LINK_M = 30, PENALTY_M = 60, CELL = 0.0005;   // ≈ 55 m
  const grid = new Map<string, number[]>();
  const cell = (p: Pt): [number, number] => [Math.floor(p[0] / CELL), Math.floor(p[1] / CELL)];
  nodes.forEach((p, i) => { const [x, y] = cell(p), k = x + "," + y; (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  /** direction de la voie en un point (degrés, 0 à 180 : le sens de parcours ne compte pas) */
  const bearing = (i: number): number | null => {
    const e = edges[i][0];
    if (!e) return null;
    const a = nodes[i], b = nodes[e.to];
    return ((Math.atan2((b[1] - a[1]) * Math.cos(rad(a[0])), b[0] - a[0]) * 180) / Math.PI + 360) % 180;
  };
  let added = 0;
  nodes.forEach((p, i) => {
    const [x, y] = cell(p), bi = bearing(i);
    if (bi === null) return;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(x + dx + "," + (y + dy)) ?? []) {
      if (j <= i || edges[i].some(e => e.to === j)) continue;
      const m = dist(p, nodes[j]), bj = bearing(j);
      if (m > LINK_M || bj === null) continue;
      const diff = Math.abs(bi - bj), angle = Math.min(diff, 180 - diff);
      if (angle > 20) continue;
      edges[i].push({ to: j, m: m + PENALTY_M }); edges[j].push({ to: i, m: m + PENALTY_M }); added++;
    }
  });
  if (added) log(`Voies ferrées : ${added} liens entre voies parallèles`);
}

const SNAP_M = 400;                // une gare à plus de 400 m des voies connues : hors de la zone couverte

/** Point de voie le plus proche d'une gare : sur le tronçon a → b, à da mètres de a et db mètres de b */
interface Snap { a: number; b: number; q: Pt; da: number; db: number; d: number }
/**
 * Points de voie près d'une gare, du plus proche au plus lointain : une voie par tracé (sur une ligne à deux voies, chacune
 * est un tracé à part), à au plus 40 m de plus que la plus proche. Le trajet essaie chacune : la voie la plus proche d'une
 * gare n'est pas toujours celle qui mène à la suivante sans faire un détour par un raccordement.
 */
function snaps(p: Pt): Snap[] {
  const k = Math.cos(rad(p[0]));
  const found: Snap[] = [];
  for (const [a, b] of segs) {
    const A = nodes[a], B = nodes[b];
    if (Math.min(A[0], B[0]) > p[0] + 0.005 || Math.max(A[0], B[0]) < p[0] - 0.005) continue;   // filtre rapide (≈ 550 m)
    const dx = (B[1] - A[1]) * k, dy = B[0] - A[0], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, (((p[1] - A[1]) * k) * dx + (p[0] - A[0]) * dy) / l2)) : 0;
    const q: Pt = [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])], d = dist(p, q);
    if (d < SNAP_M) found.push({ a, b, q, da: dist(A, q), db: dist(B, q), d });
  }
  found.sort((x, y) => x.d - y.d);
  const out: Snap[] = [];
  for (const s of found) {
    if (s.d > found[0].d + 40 || out.length >= 4) break;
    // tronçon voisin d'un tronçon déjà retenu (même voie) : inutile
    if (out.some(o => o.a === s.a || o.a === s.b || o.b === s.a || o.b === s.b)) continue;
    out.push(s);
  }
  return out;
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
function railBetween(a: Pt, b: Pt): Pt[] | null {
  if (!nodes.length) return null;
  const k = `${a[0]},${a[1]}>${b[0]},${b[1]}`;
  if (cache.has(k)) return cache.get(k) ?? null;
  let res: Pt[] | null = null, best = dist(a, b) * 2.5 + 1000;       // au-delà : détour invraisemblable (voie manquante)
  for (const from of snaps(a)) for (const to of snaps(b)) {
    // même tronçon : droit sur la voie ; sinon plus court chemin le long des voies
    const ids = from.a === to.a && from.b === to.b ? [] : shortest(from, to);
    if (!ids) continue;
    const pts: Pt[] = [a, from.q, ...ids.map(i => nodes[i]), to.q, b];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
    if (len < best) { best = len; res = pts; }
  }
  if (cache.size > 5000) cache.clear();
  cache.set(k, res);
  return res;
}

return { railBetween, points: nodes.length };
}
