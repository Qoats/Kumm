/**
 * Position estimée des trams et bus, calculée à partir des horaires de la photo du réseau (aucun appel à la CTS en plus).
 * Chaque véhicule est situé entre l'arrêt qu'il vient de quitter et le suivant (ou à quai) ; l'application l'anime entre
 * les deux selon l'heure. Ce n'est pas un GPS : un véhicule bloqué entre deux arrêts n'est recalé qu'à la mise à jour suivante.
 */
import { snapshot } from "./realtime.js";

/** [latitude, longitude, heure en ms] */
type At = [number, number, number];
export interface Vehicle {
  id: string;
  line: string;
  dest: string;
  /** horaires recalés en temps réel par la CTS (sinon théoriques) */
  rt: boolean;
  /** départ et arrivée du tronçon en cours (identiques si le véhicule est à quai) */
  a: At;
  b: At;
  /** direction en degrés (0 = nord) */
  h: number;
  /** prochains arrêts : [nom, heure en ms] */
  next: [string, number][];
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
  const out: Vehicle[] = [];
  for (const c of snap.courses) {
    const calls = c.calls.map(k => ({ ...k, p: snap.stopPos.get(k.code) })).filter(k => k.p) as (typeof c.calls[number] & { p: { lat: number; lon: number } })[];
    if (calls.length < 2 || now < calls[0].dep || now > calls[calls.length - 1].arr) continue;
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
      out.push({
        id: c.id, line: c.line, dest: c.dest, rt: c.realTime, a, b, h,
        next: calls.slice(nextFrom, nextFrom + 6).map(k => [k.name, k.arr])
      });
      break;
    }
  }
  return { now, at: snap.at, vehicles: out };
}
