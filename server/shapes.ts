/**
 * Tracés des lignes (data/shapes.json, extrait d'OpenStreetMap par scripts/build-shapes.mjs) : un véhicule suit les rails
 * ou la route entre deux arrêts, au lieu d'une ligne droite qui couperait à travers les immeubles.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Pt = [number, number];
interface Shape { pts: Pt[]; cum: number[] }

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = [path.join(here, "..", "..", "data", "shapes.json"), path.join(here, "..", "data", "shapes.json")].find(f => fs.existsSync(f));

const R = 6371000, rad = (d: number): number => (d * Math.PI) / 180;
const dist = (a: Pt, b: Pt): number => Math.hypot(rad(b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2)), rad(b[0] - a[0])) * R;

/*
 * Morceaux de tracé retirés (data/shape-cuts.json, écrit par scripts/check-shapes-plan.py) : là où OpenStreetMap fait passer
 * une ligne alors que le plan officiel de la CTS ne la montre pas (prolongement vers un dépôt, ancien itinéraire, voie
 * oubliée reliée en ligne droite). Le tracé y est coupé ; le bus suit alors la route entre ses arrêts (roads.ts).
 * Un segment de plus de 1,5 km sans aucun point est aussi coupé : c'est un trou de la relation OpenStreetMap.
 */
const CUTS_FILE = FILE ? path.join(path.dirname(FILE), "shape-cuts.json") : null;
const MAX_STRAIGHT_M = 1500;
let cuts: Record<string, Pt[]> = {}, cutRadius = 70;
try {
  if (CUTS_FILE && fs.existsSync(CUTS_FILE)) {
    const c = JSON.parse(fs.readFileSync(CUTS_FILE, "utf8")) as { rayon_m?: number; lines?: Record<string, Pt[]> };
    cuts = c.lines ?? {}; cutRadius = c.rayon_m ?? cutRadius;
  }
} catch (e) { console.warn("Morceaux de tracé à retirer illisibles :", e instanceof Error ? e.message : e); }

/** Découpe un tracé en morceaux sans les segments retirés */
function cutPieces(pts: Pt[], bad: Pt[]): Pt[][] {
  const near = (p: Pt): boolean => bad.some(b => Math.abs(b[0] - p[0]) < 0.002 && dist(b, p) < cutRadius);
  const out: Pt[][] = [];
  let cur: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = dist(a, b);
    let removed = len > MAX_STRAIGHT_M;
    for (let k = 0, n = Math.max(1, Math.ceil(len / 30)); !removed && k <= n; k++) {
      removed = near([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    if (removed) { if (cur.length >= 2) out.push(cur); cur = [b]; }
    else cur.push(b);
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

const shapes = new Map<string, Shape[]>();
let removedKm = 0;
try {
  if (FILE) {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8")) as { lines?: Record<string, Pt[][]> };
    for (const [ref, list] of Object.entries(j.lines ?? {})) {
      const pieces = list.filter(p => p.length >= 2).flatMap(pts => {
        const kept = cutPieces(pts, cuts[ref] ?? []);
        const len = (q: Pt[]): number => q.slice(1).reduce((m, p, i) => m + dist(q[i], p), 0);
        removedKm += (len(pts) - kept.reduce((m, q) => m + len(q), 0)) / 1000;
        return kept;
      });
      shapes.set(ref, pieces.map(pts => {
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
        return { pts, cum };
      }));
    }
  }
} catch (e) { console.warn("Tracés des lignes illisibles :", e instanceof Error ? e.message : e); }
if (removedKm > 0) console.log(`Tracés des lignes : ${removedKm.toFixed(1)} km retirés (absents du plan de la CTS, ou trous)`);
console.log(`Tracés des lignes : ${shapes.size ? shapes.size + " lignes" : "aucun (véhicules en ligne droite entre deux arrêts)"}`);

/** Projection d'un point sur un tracé : distance depuis le début, écart au tracé (m), point projeté */
function project(s: Shape, p: Pt): { at: number; off: number; q: Pt } {
  const k = Math.cos(rad(p[0]));
  let best = Infinity, at = 0, q: Pt = s.pts[0];
  for (let i = 0; i < s.pts.length - 1; i++) {
    const a = s.pts[i], b = s.pts[i + 1];
    const dx = (b[1] - a[1]) * k, dy = b[0] - a[0], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, (((p[1] - a[1]) * k) * dx + (p[0] - a[0]) * dy) / l2)) : 0;
    const c: Pt = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const d = dist(p, c);
    if (d < best) { best = d; at = s.cum[i] + t * (s.cum[i + 1] - s.cum[i]); q = c; }
  }
  return { at, off: best, q };
}

/** Morceau de tracé entre deux distances */
function slice(s: Shape, from: number, to: number, qa: Pt, qb: Pt): Pt[] {
  const out: Pt[] = [qa];
  for (let i = 0; i < s.pts.length; i++) if (s.cum[i] > from && s.cum[i] < to) out.push(s.pts[i]);
  out.push(qb);
  return out.map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5] as Pt);
}

const MAX_OFF = 80;          // un arrêt à plus de 80 m du tracé : ce n'est pas le bon itinéraire
const cache = new Map<string, Pt[] | null>();

/** Trajet d'un véhicule de la ligne `line` entre deux arrêts, le long de la ligne ; null si aucun tracé ne convient (ligne droite) */
export function pathBetween(line: string, key: string, a: Pt, b: Pt): Pt[] | null {
  const k = `${line}|${key}`;
  if (cache.has(k)) return cache.get(k) ?? null;
  let best: { pts: Pt[]; score: number } | null = null;
  const straight = dist(a, b);
  for (const s of shapes.get(line) ?? []) {
    const pa = project(s, a), pb = project(s, b);
    if (pa.off > MAX_OFF || pb.off > MAX_OFF || pb.at <= pa.at) continue;       // mauvais sens ou autre itinéraire
    const len = pb.at - pa.at;
    if (len > straight * 3 + 300) continue;                                      // détour invraisemblable (relation incomplète)
    const score = pa.off + pb.off;
    if (!best || score < best.score) best = { pts: slice(s, pa.at, pb.at, pa.q, pb.q), score };
  }
  const res = best?.pts ?? null;
  if (cache.size > 20_000) cache.clear();
  cache.set(k, res);
  return res;
}
