/**
 * Position estimée des trams et bus, calculée à partir des horaires de la photo du réseau (aucun appel à la CTS en plus).
 * Chaque véhicule est situé entre l'arrêt qu'il vient de quitter et le suivant (ou à quai) ; l'application l'anime entre
 * les deux selon l'heure. Ce n'est pas un GPS : un véhicule bloqué entre deux arrêts n'est recalé qu'à la mise à jour suivante.
 */
import { lastUpdateOf, snapshot } from "./realtime.js";
import type { Course } from "./realtime.js";
import type { StopPos } from "./ride.js";
import { pathBetween } from "./shapes.js";
import { locateOnCourse, sharedPosition } from "./ride.js";
import { railBetween } from "./rail.js";
import { roadBetween } from "./roads.js";
import { stallOf } from "./stalls.js";
import { cruiseOf, dwellOf } from "./observations.js";
import { terCourses, trainCode } from "./ter.js";

/** [latitude, longitude, heure en ms] */
type At = [number, number, number];
type Pt = [number, number];
export interface Vehicle {
  id: string;
  line: string;
  dest: string;
  /** horaires recalés en temps réel par la CTS (sinon théoriques) */
  rt: boolean;
  /** « tram » ou « bus » selon la CTS, « ter » pour un train (vide si inconnu) */
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
  /** code du trajet (« hoeb2610240612 » : terminus, ligne, date, heure de départ prévue ; « terelsass830860 » pour un train) */
  n?: string;
  /** à quai au terminus, en attente du départ de sa prochaine course (a = b = quai et heure de départ) */
  w?: boolean;
  /** vitesse estimée en km/h : croisière sur le tronçon pour un tram ou un bus, moyenne pour un train (0 à quai) ;
      absente si elle ne peut pas être calculée. L'application (0.31.1 et plus) calcule elle-même celle d'un tram ou d'un bus */
  s?: number;
  /** tram ou bus : vitesse de croisière réelle sur ce tronçon (km/h), apprise des trajets partagés (observations.ts) */
  c?: number;
  /** tram ou bus : temps à quai observé à l'arrêt de départ du tronçon (s), appris des trajets partagés */
  q?: number;
  /** horaires de la course non actualisés par la CTS depuis ce nombre de minutes (3 et plus) : position approximative */
  u?: number;
  /** position partagée par un voyageur à bord (moins de 45 s) : a = b = cette position */
  g?: boolean;
  /** retard sur l'horaire annoncé par la CTS, en secondes (négatif : en avance), d'après la position partagée */
  d?: number;
  /** véhicule immobilisé (panne, accident, bouchon) depuis cette heure (ms) : la CTS repousse sans cesse son arrivée */
  x?: number;
}

/**
 * Trajet entre deux arrêts : les rails pour un train ; le tracé de la ligne pour un tram ou un bus ; pour un bus hors de son
 * tracé (déviation, itinéraire absent d'OpenStreetMap), la route (calculée une fois, voir roads.ts). null : ligne droite.
 */
function segmentPath(mode: string, line: string, key: string, a: Pt, b: Pt): Pt[] | null {
  if (mode === "ter") return railBetween(a, b);
  return pathBetween(line, key, a, b) ?? (mode === "tram" ? null : roadBetween(a, b));
}

/** Point à la fraction f (0 à 1) de la longueur d'un tracé */
function pointAlong(path: Pt[], f: number): Pt {
  const total = lengthM(path);
  let left = Math.max(0, Math.min(1, f)) * total;
  for (let k = 1; k < path.length; k++) {
    const seg = lengthM([path[k - 1], path[k]]);
    if (left <= seg && seg > 0) { const t = left / seg; return [path[k - 1][0] + (path[k][0] - path[k - 1][0]) * t, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * t]; }
    left -= seg;
  }
  return path[path.length - 1];
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
  const pathOf = (l: string, k: string, a: Pt, b: Pt): Pt[] | null => segmentPath(mode, l, k, a, b);
  let meters = 0;
  const last = Math.min(calls.length - 1, i + 3);
  for (let k = i; k < last; k++) {
    const a: Pt = [calls[k].p.lat, calls[k].p.lon], b: Pt = [calls[k + 1].p.lat, calls[k + 1].p.lon];
    const path = pathOf(line, `${calls[k].code}>${calls[k + 1].code}`, a, b);
    meters += path ? lengthM(path) : lengthM([a, b]) * 1.2;
  }
  const secs = (calls[last].arr - calls[i].dep) / 1000;
  if (last <= i || secs < 30) return null;
  return Math.round(Math.min(mode === "ter" ? 160 : mode === "tram" ? 70 : 60, (meters / secs) * 3.6));
}

/* Vitesse d'un tram ou d'un bus. La moyenne entre arrêts (speedAhead) compte l'arrêt à quai, le démarrage et le freinage :
   autour de 20 km/h pour un tram CTS, alors qu'il roule à 40 ou 50 entre deux stations. Ici : vitesse de roulage moyenne
   (sans les ~20 s à quai que la CTS compte souvent dans l'horaire), d'où la vitesse de croisière sur le tronçon en cours,
   avec accélération et freinage (profil en trapèze). Les versions récentes de l'application calculent elles-mêmes la vitesse
   du moment (web/src/vehicles.ts). La CTS ne publie pas la vitesse réelle : c'est une estimation. */
const ACCEL = { tram: 1.0, bus: 0.9 } as Record<string, number>;
const DWELL_S = 20;
function speedNow(line: string, mode: string, calls: { code: string; dep: number; arr: number; p: { lat: number; lon: number } }[], i: number): { s: number } | null {
  const acc = ACCEL[mode];
  if (!acc) { const s = speedAhead(line, mode, calls, i); return s === null ? null : { s }; }
  // vitesse de roulage moyenne sur les 3 prochains tronçons (les horaires arrondis à la minute faussent un tronçon seul)
  const last = Math.min(calls.length - 1, i + 3);
  let meters = 0, run = 0, cur = 0;
  for (let k = i; k < last; k++) {
    const a: Pt = [calls[k].p.lat, calls[k].p.lon], b: Pt = [calls[k + 1].p.lat, calls[k + 1].p.lon];
    const path = segmentPath(mode, line, `${calls[k].code}>${calls[k + 1].code}`, a, b);
    const m = path ? lengthM(path) : lengthM([a, b]) * 1.2, t = (calls[k + 1].arr - calls[k].dep) / 1000;
    const dwell = calls[k].arr === calls[k].dep ? Math.min(DWELL_S, t * 0.3) : 0;   // arrêt à quai compté dans l'horaire
    meters += m; run += t - dwell;
    if (k === i) cur = m;
  }
  if (last <= i || run < 20 || cur < 30) return null;
  const vAvg = Math.min(meters / run, mode === "tram" ? 15 : 13);   // m/s, plafonné (54 / 47 km/h de moyenne)
  const T = cur / vAvg;                                                // durée de roulage sur ce tronçon, à cette moyenne
  // vitesse de croisière vc : distance = vc·T − vc²/acc (accélération et freinage à acc) ; tronçon trop court : profil en triangle
  const disc = acc * acc * T * T - 4 * acc * cur;
  const vc = disc > 0 ? (acc * T - Math.sqrt(disc)) / 2 : (acc * T) / 2;
  return { s: Math.round(Math.min(mode === "tram" ? 70 : 60, vc * 3.6)) };
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
  if (c.num) return trainCode(c.num);
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

/**
 * Trams et bus de la CTS, et trains TER : courses en cours et position de leurs arrêts (les gares SNCF ont des codes « SNCF:… »).
 * Sert aussi au partage d'un trajet (ride.ts).
 */
export function allCourses(now = Date.now()): { courses: Course[]; stopPos: StopPos; at: number | null } {
  const snap = snapshot(now), ter = terCourses(now);
  const stopPos: StopPos = { get: code => snap?.stopPos.get(code) ?? ter.stopPos.get(code) };
  return { courses: [...(snap?.courses ?? []), ...ter.courses], stopPos, at: snap?.at ?? null };
}

export function vehiclesAt(now = Date.now()): { now: number; at: number | null; vehicles: Vehicle[] } {
  const snap = snapshot(now);
  if (snap && chainsAt !== snap.at) { buildChains(snap.courses); chainsAt = snap.at; }
  const { courses, stopPos, at } = allCourses(now);
  const out: Vehicle[] = [];
  for (const c of courses) {
    const calls = c.calls.map(k => ({ ...k, p: stopPos.get(k.code) })).filter(k => k.p) as (typeof c.calls[number] & { p: { lat: number; lon: number } })[];
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
    // un voyageur à bord partage sa position : vraie position, retard sur l'horaire prévu, prochains passages recalés
    const shared = sharedPosition(c.id, now);
    const where = shared ? locateOnCourse(shared, calls) : null;
    if (shared && where) {
      const k = where.k, s0 = calls[k], s1 = calls[k + 1];
      const expected = s0.dep + where.f * (s1.arr - s0.dep);                    // heure estimée par la CTS à cet endroit
      const shift = shared.t - expected;                                         // en retard sur l'estimation de la CTS si > 0
      const aimed = s0.aim !== undefined && s1.aim !== undefined ? s0.aim + where.f * (s1.aim - s0.aim) : null;
      out.push({
        id: c.id, line: c.line, dest: c.dest, rt: true, m: c.mode, a: [shared.lat, shared.lon, shared.t], b: [shared.lat, shared.lon, shared.t],
        h: heading(s0.p, s1.p), g: true,
        ...(shared.speed !== null ? { s: Math.round(shared.speed * 3.6) } : {}),
        // écart avec l'horaire prévu s'il est publié, sinon avec l'horaire annoncé par la CTS (celui des écrans en station)
        d: Math.round((aimed !== null ? shared.t - aimed : shift) / 1000),
        next: calls.slice(k + 1, k + 7).map(x => [x.name, Math.round(x.arr + shift)]),
        ...(vno ? { n: vno } : {})
      });
      continue;
    }
    // immobilisé (stalls.ts) : affiché à l'arrêt, là où il se trouvait au début du blocage
    const st = c.mode === "ter" ? null : stallOf(c.id);
    const si = st ? calls.findIndex(k => k.code === c.calls[st.k]?.code) : -1;
    if (st && si >= 0) {
      const s = calls[si], n = calls[si + 1];
      const pt: Pt = !st.quay && n
        ? pointAlong(segmentPath(c.mode, c.line, `${s.code}>${n.code}`, [s.p.lat, s.p.lon], [n.p.lat, n.p.lon]) ?? [[s.p.lat, s.p.lon], [n.p.lat, n.p.lon]], st.f)
        : [s.p.lat, s.p.lon];
      out.push({
        id: c.id, line: c.line, dest: c.dest, rt: true, m: c.mode, a: [pt[0], pt[1], now], b: [pt[0], pt[1], now],
        h: n ? heading(s.p, n.p) : 0, s: 0, x: st.since, next: calls.slice(si + 1, si + 7).map(k => [k.name, k.arr]), ...(vno ? { n: vno } : {})
      });
      continue;
    }
    const upd = c.mode === "ter" ? undefined : lastUpdateOf(c.id), stale = upd ? Math.floor((now - upd) / 60_000) : 0;
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
      const p = a !== b && n ? segmentPath(c.mode, c.line, `${s.code}>${n.code}`, [s.p.lat, s.p.lon], [n.p.lat, n.p.lon]) : null;
      const sp = a !== b ? speedNow(c.line, c.mode, calls, i) : { s: 0 };
      const learned = a !== b && n && c.mode !== "ter" ? cruiseOf(s.code, n.code, now) : null;
      const dwell = a !== b && n && c.mode !== "ter" ? dwellOf(s.code, now) : null;
      out.push({
        id: c.id, line: c.line, dest: c.dest, rt: c.realTime, m: c.mode, a, b, h, ...(sp ?? {}), ...(learned ? { c: learned } : {}), ...(dwell !== null ? { q: dwell } : {}),
        next: calls.slice(nextFrom, nextFrom + 6).map(k => [k.name, k.arr]),
        ...(p ? { p } : {}), ...(vno ? { n: vno } : {}), ...(stale >= 3 ? { u: stale } : {})
      });
      break;
    }
  }
  return { now, at, vehicles: out };
}
