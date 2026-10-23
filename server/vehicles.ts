/**
 * Position estimée des trams et bus, calculée à partir des horaires de la photo du réseau (aucun appel à la CTS en plus).
 * Chaque véhicule est situé entre l'arrêt qu'il vient de quitter et le suivant (ou à quai) ; l'application l'anime entre
 * les deux selon l'heure. Ce n'est pas un GPS : un véhicule bloqué entre deux arrêts n'est recalé qu'à la mise à jour suivante.
 */
import { snapshot } from "./realtime.js";
import type { Course } from "./realtime.js";
import { pathBetween } from "./shapes.js";

/** [latitude, longitude, heure en ms] */
type At = [number, number, number];
export interface Vehicle {
  id: string;
  line: string;
  dest: string;
  /** horaires recalés en temps réel par la CTS (sinon théoriques) */
  rt: boolean;
  /** « tram » ou « bus » selon la CTS (vide si inconnu) */
  m: string;
  /** départ et arrivée du tronçon en cours (identiques si le véhicule est à quai) */
  a: At;
  b: At;
  /** direction en degrés (0 = nord) */
  h: number;
  /** prochains arrêts : [nom, heure en ms] */
  next: [string, number][];
  /** tracé de la ligne entre a et b ([latitude, longitude][]), absent si inconnu (ligne droite) */
  p?: [number, number][];
  /** numéro du véhicule estimé par Kumm (« B-4 ») : la CTS ne publie pas les numéros réels */
  n?: string;
  /** à quai au terminus, en attente du départ de sa prochaine course (a = b = quai et heure de départ) */
  w?: boolean;
}

/* ---------- véhicules reconstitués : quelle course fait le même véhicule que la précédente ----------
   La CTS décrit des courses, pas des véhicules. Une course qui arrive à un terminus et la prochaine course de la même ligne
   qui part de ce terminus (même nom d'arrêt, au plus 40 min plus tard) sont attribuées au même véhicule ; s'il y en a
   plusieurs, le premier arrivé repart le premier. Les numéros sont attribués par Kumm et gardés d'une mise à jour à l'autre. */
const MAX_LAYOVER = 40 * 60_000;
const numbers = new Map<string, string>();        // course → numéro
let chainsAt = -1;
let prevOf = new Map<string, Course>();            // course → course précédente du même véhicule

const stopKey = (n: string): string => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function buildChains(list: Course[]): void {
  const prev = new Map<string, Course>(), byLine = new Map<string, Course[]>();
  for (const c of list) if (c.calls.length >= 2) (byLine.get(c.line) ?? byLine.set(c.line, []).get(c.line)!).push(c);
  const seen = new Set<string>();
  for (const [line, cs] of byLine) {
    cs.sort((a, b) => a.calls[0].dep - b.calls[0].dep);
    const waiting = new Map<string, Course[]>();   // terminus → véhicules arrivés, dans l'ordre d'arrivée
    const used = new Set<string>();
    for (const c of cs) { const n = numbers.get(c.id); if (n) used.add(n); }
    for (const c of cs) {
      seen.add(c.id);
      const first = c.calls[0], here = waiting.get(stopKey(first.name)) ?? [];
      const i = here.findIndex(p => { const arr = p.calls[p.calls.length - 1].arr; return arr <= first.dep + 60_000 && first.dep - arr <= MAX_LAYOVER; });
      if (i >= 0) {
        const p = here.splice(i, 1)[0];
        prev.set(c.id, p);
        if (!numbers.has(c.id) && numbers.has(p.id)) numbers.set(c.id, numbers.get(p.id)!);
      }
      if (!numbers.has(c.id)) {
        let k = 1;
        while (used.has(`${line}-${k}`)) k++;
        numbers.set(c.id, `${line}-${k}`);
      }
      used.add(numbers.get(c.id)!);
      const last = c.calls[c.calls.length - 1], key = stopKey(last.name);
      (waiting.get(key) ?? waiting.set(key, []).get(key)!).push(c);
      waiting.get(key)!.sort((a, b) => a.calls[a.calls.length - 1].arr - b.calls[b.calls.length - 1].arr);
    }
  }
  for (const id of numbers.keys()) if (!seen.has(id)) numbers.delete(id);
  prevOf = prev;
}

const rad = (d: number): number => (d * Math.PI) / 180;
function heading(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
}

export function vehiclesAt(now = Date.now()): { now: number; at: number | null; vehicles: Vehicle[] } {
  const snap = snapshot(now);
  if (!snap) return { now, at: null, vehicles: [] };
  if (chainsAt !== snap.at) { buildChains(snap.courses); chainsAt = snap.at; }
  const out: Vehicle[] = [];
  for (const c of snap.courses) {
    const calls = c.calls.map(k => ({ ...k, p: snap.stopPos.get(k.code) })).filter(k => k.p) as (typeof c.calls[number] & { p: { lat: number; lon: number } })[];
    if (calls.length < 2 || now > calls[calls.length - 1].arr) continue;
    const vno = numbers.get(c.id);
    if (now < calls[0].dep) {
      // pas encore parti : affiché à quai au terminus seulement si le véhicule qui fera cette course y est déjà arrivé
      const p = prevOf.get(c.id);
      if (!p || p.calls[p.calls.length - 1].arr > now) continue;
      const s = calls[0];
      out.push({
        id: c.id, line: c.line, dest: c.dest, rt: c.realTime, m: c.mode, a: [s.p.lat, s.p.lon, s.dep], b: [s.p.lat, s.p.lon, s.dep],
        h: heading(s.p, calls[1].p), next: calls.slice(1, 7).map(k => [k.name, k.arr]), w: true, ...(vno ? { n: vno } : {})
      });
      continue;
    }
    for (let i = 0; i < calls.length; i++) {
      const s = calls[i], n = calls[i + 1];
      let a: At | null = null, b: At | null = null, nextFrom = i + 1, h = 0;
      if (now >= s.arr && now <= s.dep) {
        // à quai
        a = b = [s.p.lat, s.p.lon, s.dep];
        h = n ? heading(s.p, n.p) : (i > 0 ? heading(calls[i - 1].p, s.p) : 0);
      } else if (n && now > s.dep && now < n.arr) {
        a = [s.p.lat, s.p.lon, s.dep];
        b = [n.p.lat, n.p.lon, n.arr];
        h = heading(s.p, n.p);
      }
      if (!a || !b) continue;
      const p = a !== b && n ? pathBetween(c.line, `${s.code}>${n.code}`, [s.p.lat, s.p.lon], [n.p.lat, n.p.lon]) : null;
      out.push({
        id: c.id, line: c.line, dest: c.dest, rt: c.realTime, m: c.mode, a, b, h,
        next: calls.slice(nextFrom, nextFrom + 6).map(k => [k.name, k.arr]),
        ...(p ? { p } : {}), ...(vno ? { n: vno } : {})
      });
      break;
    }
  }
  return { now, at: snap.at, vehicles: out };
}
