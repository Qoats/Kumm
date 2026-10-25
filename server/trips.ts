/**
 * Détail d'une course pour un trajet suivi (« Me prévenir pour descendre ») : tous ses arrêts, avec position et heure
 * annoncée. Le téléphone s'en sert pour compter les arrêts restants, prévenir avant la descente et, avant de monter, savoir
 * quand le véhicule arrive (rappel de validation). Mis à jour toutes les 30 s par le téléphone pendant le trajet.
 */
import { allCourses, tripCode } from "./vehicles.js";
import type { Course } from "./realtime.js";

export interface TripDetail {
  id: string; line: string; dest: string; mode: string; n: string;
  calls: { code: string; name: string; lat: number; lon: number; arr: number; dep: number }[];
  /** trajet cherché depuis un arrêt : indice de cet arrêt dans calls */
  board?: number;
}

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

/** Prochaine course d'une ligne et d'une direction qui passe à un arrêt (nom de l'arrêt) : celle que l'on va prendre */
export function tripAt(stop: string, line: string, dest: string, now = Date.now()): TripDetail | null {
  const sk = key(stop), dk = key(dest);
  let best: { c: Course; i: number; t: number } | null = null;
  for (const c of allCourses(now).courses) {
    if (c.line !== line || (key(c.dest) !== dk && dk)) continue;
    const i = c.calls.findIndex(k => key(k.name) === sk && k.dep > now - 30_000);
    if (i < 0 || i === c.calls.length - 1) continue;
    if (!best || c.calls[i].dep < best.t) best = { c, i, t: c.calls[i].dep };
  }
  if (!best) return null;
  const d = detail(best.c), code = best.c.calls[best.i].code;
  const board = d.calls.findIndex(k => k.code === code);
  return board >= 0 ? { ...d, board } : null;
}
