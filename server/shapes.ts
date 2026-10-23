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

const shapes = new Map<string, Shape[]>();
try {
  if (FILE) {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8")) as { lines?: Record<string, Pt[][]> };
    for (const [ref, list] of Object.entries(j.lines ?? {})) {
      shapes.set(ref, list.filter(p => p.length >= 2).map(pts => {
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
        return { pts, cum };
      }));
    }
  }
} catch (e) { console.warn("Tracés des lignes illisibles :", e instanceof Error ? e.message : e); }
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
