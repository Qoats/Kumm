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
type Pt = [number, number];
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
  /** code du trajet (« hoeb2610240612 » : terminus, ligne, date, heure de départ prévue) */
  n?: string;
  /** à quai au terminus, en attente du départ de sa prochaine course (a = b = quai et heure de départ) */
  w?: boolean;
  /** vitesse moyenne estimée en km/h (0 à quai) ; absente si elle ne peut pas être calculée */
  s?: number;
}

/** Longueur en mètres d'une suite de points */
function lengthM(pts: Pt[]): number {
  let m = 0;
  for (let k = 1; k < pts.length; k++) m += Math.hypot((pts[k][1] - pts[k - 1][1]) * 111_320 * Math.cos(rad(pts[k][0])), (pts[k][0] - pts[k - 1][0]) * 110_540);
  return m;
}

/**
 * Vitesse moyenne sur les 3 prochains tronçons (tracé réel, sinon distance à vol d'oiseau majorée de 20 %) : un seul tronçon
 * donne des valeurs absurdes, car les horaires sont souvent arrondis à la minute. Plafonnée à une vitesse plausible.
 */
function speedAhead(line: string, mode: string, calls: { code: string; dep: number; arr: number; p: { lat: number; lon: number } }[], i: number): number | null {
  let meters = 0;
  const last = Math.min(calls.length - 1, i + 3);
  for (let k = i; k < last; k++) {
    const a: Pt = [calls[k].p.lat, calls[k].p.lon], b: Pt = [calls[k + 1].p.lat, calls[k + 1].p.lon];
    const path = pathBetween(line, `${calls[k].code}>${calls[k + 1].code}`, a, b);
    meters += path ? lengthM(path) : lengthM([a, b]) * 1.2;
  }
  const secs = (calls[last].arr - calls[i].dep) / 1000;
  if (last <= i || secs < 30) return null;
  return Math.round(Math.min(mode === "tram" ? 70 : 60, (meters / secs) * 3.6));
}

/* ---------- code de chaque trajet et attente au terminus ----------
   Code d'un trajet (« hoeb2610240612 ») : 3 lettres du terminus de départ, la ligne, la date (AAMMJJ) et l'heure de départ
   prévue (HHMM, heure de Strasbourg). L'heure prévue ne change pas avec les retards : le code reste le même du départ à
   l'arrivée. La CTS ne publie pas d'identifiant lisible ni les numéros des rames.
   Attente au terminus : une course qui arrive à un terminus et la prochaine course de la même ligne qui en part (au plus
   40 min plus tard, premier arrivé premier reparti) sont faites par le même véhicule ; il est affiché à quai entre les deux. */
const MAX_LAYOVER = 40 * 60_000;
let chainsAt = -1;
let prevOf = new Map<string, Course>();            // course → course précédente du même véhicule

const plain = (n: string): string => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const stopKey = (n: string): string => plain(n).replace(/[^a-z0-9]/g, "");
const parisParts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Code lisible du trajet : terminus + ligne + date + heure de départ prévue */
export function tripCode(c: Course): string {
  const t = c.aimed ?? c.calls[0]?.dep;
  if (!t) return "";
  const parts = Object.fromEntries(parisParts.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const term = (plain(c.calls[0].name).match(/[a-z0-9]+/g) ?? ["x"]).find(w => w.length > 2) ?? "x";
  return `${term.slice(0, 3)}${plain(c.line).replace(/[^a-z0-9]/g, "")}${parts["year"]}${parts["month"]}${parts["day"]}${parts["hour"]}${parts["minute"]}`;
}

function buildChains(list: Course[]): void {
  const prev = new Map<string, Course>(), byLine = new Map<string, Course[]>();
  for (const c of list) if (c.calls.length >= 2) (byLine.get(c.line) ?? byLine.set(c.line, []).get(c.line)!).push(c);
  for (const cs of byLine.values()) {
    cs.sort((a, b) => a.calls[0].dep - b.calls[0].dep);
    const waiting = new Map<string, Course[]>();   // terminus → véhicules arrivés, dans l'ordre d'arrivée
    for (const c of cs) {
      const first = c.calls[0], here = waiting.get(stopKey(first.name)) ?? [];
      const i = here.findIndex(p => { const arr = p.calls[p.calls.length - 1].arr; return arr <= first.dep + 60_000 && first.dep - arr <= MAX_LAYOVER; });
      if (i >= 0) prev.set(c.id, here.splice(i, 1)[0]);
      const last = c.calls[c.calls.length - 1], key = stopKey(last.name);
      (waiting.get(key) ?? waiting.set(key, []).get(key)!).push(c);
      waiting.get(key)!.sort((a, b) => a.calls[a.calls.length - 1].arr - b.calls[b.calls.length - 1].arr);
    }
  }
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
    const vno = tripCode(c);
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
      const sp = a !== b ? speedAhead(c.line, c.mode, calls, i) : 0;
      out.push({
        id: c.id, line: c.line, dest: c.dest, rt: c.realTime, m: c.mode, a, b, h, ...(sp !== null ? { s: sp } : {}),
        next: calls.slice(nextFrom, nextFrom + 6).map(k => [k.name, k.arr]),
        ...(p ? { p } : {}), ...(vno ? { n: vno } : {})
      });
      break;
    }
  }
  return { now, at: snap.at, vehicles: out };
}
