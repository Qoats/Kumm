/**
 * Détail d'une course pour un trajet suivi pendant une navigation : tous ses arrêts, avec position et heure annoncée. Le téléphone s'en sert pour compter les arrêts restants, prévenir avant la descente et, avant de monter, savoir
 * quand le véhicule arrive (rappel de validation). Mis à jour toutes les 30 s par le téléphone pendant le trajet.
 */
import { allCourses, tripCode } from "./vehicles.js";
import type { Course } from "./realtime.js";

export interface TripDetail {
  id: string; line: string; dest: string; mode: string; n: string;
  calls: { code: string; name: string; lat: number; lon: number; arr: number; dep: number }[];
  /** trajet cherché depuis un arrêt : indice de cet arrêt dans calls, et de l'arrêt de descente s'il est donné */
  board?: number;
  alight?: number;
}

type Pt = { lat: number; lon: number };
const near = (a: Pt, b: Pt): number => Math.hypot((a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110_540);
const key = (n: string): string => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function detail(c: Course): TripDetail {
  const { stopPos } = allCourses();
  const calls = c.calls.flatMap(k => { const p = stopPos.get(k.code); return p ? [{ code: k.code, name: k.name, lat: p.lat, lon: p.lon, arr: k.arr, dep: k.dep }] : []; });
  return { id: c.id, line: c.line, dest: c.dest, mode: c.mode, n: tripCode(c), calls };
}

/** Une course d'après son identifiant (celui des véhicules sur la carte) */
export function tripById(id: string): TripDetail | null {
  const c = allCourses().courses.find(x => x.id === id);
  return c ? detail(c) : null;
}

/**
 * Prochaine course d'une ligne qui passe à un arrêt (nom de l'arrêt) : celle que l'on va prendre. La direction se donne par
 * la destination affichée (dest) ou, plus sûr, par l'arrêt de descente (to : la course doit y passer ensuite) ; after :
 * départ au plus tôt (heure prévue par l'itinéraire, ms). Les arrêts se reconnaissent à leur nom ou, s'il est écrit autrement
 * (calculateur d'itinéraire), à leur position (at, toAt : à moins de 200 m).
 */
export function tripAt(stop: string, line: string, dest: string, to = "", after = 0, at?: Pt, toAt?: Pt, now = Date.now()): TripDetail | null {
  const dk = key(dest), from = Math.max(now - 30_000, after);
  const { courses, stopPos } = allCourses(now);
  const is = (k: { code: string; name: string }, name: string, p?: Pt): boolean => {
    const a = key(k.name), b = key(name);
    if (b && (a === b || (b.length > 4 && (a.includes(b) || b.includes(a))))) return true;
    const q = p ? stopPos.get(k.code) : undefined;
    return !!(p && q && near(p, q) < 200);
  };
  let best: { c: Course; i: number; j: number; t: number } | null = null;
  for (const c of courses) {
    if (key(c.line) !== key(line) || (dk && !to && !toAt && key(c.dest) !== dk)) continue;
    const i = c.calls.findIndex(k => k.dep > from && is(k, stop, at));
    if (i < 0 || i === c.calls.length - 1) continue;
    const j = to || toAt ? c.calls.findIndex((k, n) => n > i && is(k, to, toAt)) : -1;
    if ((to || toAt) && j < 0) continue;
    if (!best || c.calls[i].dep < best.t) best = { c, i, j, t: c.calls[i].dep };
  }
  if (!best) return null;
  const d = detail(best.c), b = best.c.calls[best.i].code, e = best.j >= 0 ? best.c.calls[best.j].code : "";
  const board = d.calls.findIndex(k => k.code === b), alight = e ? d.calls.findIndex((k, n) => n > board && k.code === e) : -1;
  return board >= 0 ? { ...d, board, ...(alight > board ? { alight } : {}) } : null;
}
