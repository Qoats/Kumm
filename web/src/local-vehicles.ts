/**
 * Moteur de positions théoriques des trams, bus et trains, calculé sur le téléphone à partir des horaires GTFS officiels
 * (aucun serveur, aucun temps réel). Même résultat que /api/vehicles du serveur en l'absence de temps réel :
 * chaque véhicule est situé entre l'arrêt qu'il vient de quitter et le suivant (ou à quai) ; l'interface l'anime ensuite
 * seconde par seconde avec les profils d'accélération et de freinage de vehicles.ts.
 * Aucun horaire n'est inventé : tout vient des courses du GTFS. Les positions partagées par les voyageurs, les arrêts
 * immobilisés et les décalages appris du temps réel n'existent pas ici.
 */
import { createRail } from "../../shared/rail-core";
import { createShapes } from "../../shared/shapes-core";
import type { ShapeCuts, ShapesData } from "../../shared/shapes-core";
import { TER_TRIP_PREFIX } from "../../shared/ter";
import railData from "../../data/rail.json";
import shapeCuts from "../../data/shape-cuts.json";
import shapesData from "../../data/shapes.json";

type Pt = [number, number];
type At = [number, number, number];
export interface LocalCall { code: string; name: string; arr: number; dep: number }
export interface LocalCourse { id: string; line: string; dest: string; mode: string; aimed: number; num?: string; calls: LocalCall[] }
export interface LocalVehicle {
  id: string; line: string; dest: string; rt: boolean; m: string; a: At; b: At; h: number; next: [string, number][];
  p?: Pt[]; n?: string; w?: boolean; s?: number;
}

const shapes = createShapes(shapesData as unknown as ShapesData, shapeCuts as unknown as ShapeCuts);
let rail: ReturnType<typeof createRail> | undefined;
const railBetween = (a: Pt, b: Pt): Pt[] | null => (rail ??= createRail((railData as unknown as { ways: Pt[][] }).ways)).railBetween(a, b);

const rad = (d: number): number => (d * Math.PI) / 180;
const lengthM = (pts: Pt[]): number => {
  let m = 0;
  for (let k = 1; k < pts.length; k++) m += Math.hypot((pts[k][1] - pts[k - 1][1]) * 111_320 * Math.cos(rad(pts[k][0])), (pts[k][0] - pts[k - 1][0]) * 110_540);
  return m;
};
/** Trajet entre deux arrêts : les rails pour un train, le tracé de la ligne sinon ; null : ligne droite */
const segmentPath = (mode: string, line: string, key: string, a: Pt, b: Pt): Pt[] | null =>
  mode === "ter" ? railBetween(a, b) : shapes.pathBetween(line, key, a, b);

type P = { lat: number; lon: number };
type Stop = LocalCall & { p: P };

/** Vitesse moyenne sur les 3 prochains tronçons (tracé réel, sinon distance à vol d'oiseau majorée de 20 %), plafonnée */
function speedAhead(line: string, mode: string, calls: Stop[], i: number): number | null {
  let meters = 0;
  const last = Math.min(calls.length - 1, i + 3);
  for (let k = i; k < last; k++) {
    const a: Pt = [calls[k].p.lat, calls[k].p.lon], b: Pt = [calls[k + 1].p.lat, calls[k + 1].p.lon];
    const path = segmentPath(mode, line, `${calls[k].code}>${calls[k + 1].code}`, a, b);
    meters += path ? lengthM(path) : lengthM([a, b]) * 1.2;
  }
  const secs = (calls[last].arr - calls[i].dep) / 1000;
  if (last <= i || secs < 30) return null;
  return Math.round(Math.min(mode === "ter" ? 160 : mode === "tram" ? 70 : 60, (meters / secs) * 3.6));
}

/** Vitesse de croisière d'un tram ou d'un bus sur le tronçon (accélération, roulage, freinage : profil en trapèze) */
const ACCEL: Record<string, number> = { tram: 1.0, bus: 0.9 };
const DWELL_S = 20;
function speedNow(line: string, mode: string, calls: Stop[], i: number): { s: number } | null {
  const acc = ACCEL[mode];
  if (!acc) { const s = speedAhead(line, mode, calls, i); return s === null ? null : { s }; }
  const last = Math.min(calls.length - 1, i + 3);
  let meters = 0, run = 0, cur = 0;
  for (let k = i; k < last; k++) {
    const a: Pt = [calls[k].p.lat, calls[k].p.lon], b: Pt = [calls[k + 1].p.lat, calls[k + 1].p.lon];
    const path = segmentPath(mode, line, `${calls[k].code}>${calls[k + 1].code}`, a, b);
    const m = path ? lengthM(path) : lengthM([a, b]) * 1.2, t = (calls[k + 1].arr - calls[k].dep) / 1000;
    const dwell = calls[k].arr === calls[k].dep ? Math.min(DWELL_S, t * 0.3) : 0;
    meters += m; run += t - dwell;
    if (k === i) cur = m;
  }
  if (last <= i || run < 20 || cur < 30) return null;
  const vAvg = Math.min(meters / run, mode === "tram" ? 15 : 13);
  const T = cur / vAvg;
  const disc = acc * acc * T * T - 4 * acc * cur;
  const vc = disc > 0 ? (acc * T - Math.sqrt(disc)) / 2 : (acc * T) / 2;
  return { s: Math.round(Math.min(mode === "tram" ? 70 : 60, vc * 3.6)) };
}

/* ---------- code de chaque trajet et attente au terminus ---------- */
const MAX_LAYOVER = 40 * 60_000;
const plain = (n: string): string => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const stopKey = (n: string): string => plain(n).replace(/[^a-z0-9]/g, "");
const parisParts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Code lisible du trajet : terminus + ligne + date + heure de départ prévue (« terelsass830860 » pour un train) */
export function tripCode(c: LocalCourse): string {
  if (c.num) return TER_TRIP_PREFIX + c.num;
  const t = c.aimed ?? c.calls[0]?.dep;
  if (!t) return "";
  const parts = Object.fromEntries(parisParts.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const term = (plain(c.calls[0].name).match(/[a-z0-9]+/g) ?? ["x"]).find(w => w.length > 2) ?? "x";
  return `${term.slice(0, 3)}${plain(c.line).replace(/[^a-z0-9]/g, "")}${parts["year"]}${parts["month"]}${parts["day"]}${parts["hour"]}${parts["minute"]}`;
}

/** Une course qui arrive à un terminus et la suivante de la même ligne qui en part (au plus 40 min plus tard) : même véhicule */
export function buildChains(list: LocalCourse[]): Map<string, LocalCourse> {
  const prev = new Map<string, LocalCourse>(), byLine = new Map<string, LocalCourse[]>();
  for (const c of list) if (c.calls.length >= 2) (byLine.get(c.line) ?? byLine.set(c.line, []).get(c.line)!).push(c);
  for (const cs of byLine.values()) {
    cs.sort((a, b) => a.calls[0].dep - b.calls[0].dep);
    const waiting = new Map<string, LocalCourse[]>();
    for (const c of cs) {
      const first = c.calls[0], here = waiting.get(stopKey(first.name)) ?? [];
      const i = here.findIndex(p => { const arr = p.calls[p.calls.length - 1].arr; return arr <= first.dep + 60_000 && first.dep - arr <= MAX_LAYOVER; });
      if (i >= 0) prev.set(c.id, here.splice(i, 1)[0]);
      const last = c.calls[c.calls.length - 1], key = stopKey(last.name);
      (waiting.get(key) ?? waiting.set(key, []).get(key)!).push(c);
      waiting.get(key)!.sort((a, b) => a.calls[a.calls.length - 1].arr - b.calls[b.calls.length - 1].arr);
    }
  }
  return prev;
}

function heading(a: P, b: P): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
}

/** Alsace et Lorraine : au-delà, le GTFS TER national n'a ni voies ni intérêt pour la carte de Strasbourg */
const inRegion = (p: P): boolean => p.lat > 47.4 && p.lat < 49.6 && p.lon > 5.5 && p.lon < 8.3;

/** Véhicules en circulation à l'instant `now` : courses déjà terminées ou pas encore parties exclues */
export function vehiclesAt(now: number, courses: LocalCourse[], stopPos: Map<string, P>, prevOf: Map<string, LocalCourse>): LocalVehicle[] {
  const out: LocalVehicle[] = [];
  for (const c of courses) {
    const calls = c.calls.map(k => ({ ...k, p: stopPos.get(k.code) }))
      .filter(k => k.p && (c.mode !== "ter" || inRegion(k.p))) as Stop[];
    if (calls.length < 2 || now > calls[calls.length - 1].arr) continue;
    const vno = tripCode(c);
    if (now < calls[0].dep) {
      // pas encore parti : affiché à quai au terminus seulement si le véhicule qui fera cette course y est déjà arrivé
      const p = prevOf.get(c.id);
      if (!p || p.calls[p.calls.length - 1].arr > now) continue;
      const s = calls[0];
      out.push({
        id: c.id, line: c.line, dest: c.dest, rt: false, m: c.mode, a: [s.p.lat, s.p.lon, s.dep], b: [s.p.lat, s.p.lon, s.dep],
        h: heading(s.p, calls[1].p), next: calls.slice(1, 7).map(k => [k.name, k.arr]), w: true, ...(vno ? { n: vno } : {})
      });
      continue;
    }
    for (let i = 0; i < calls.length; i++) {
      const s = calls[i], n = calls[i + 1];
      let a: At | null = null, b: At | null = null, h = 0;
      if (now >= s.arr && now <= s.dep) {
        a = b = [s.p.lat, s.p.lon, s.dep];   // à quai
        h = n ? heading(s.p, n.p) : (i > 0 ? heading(calls[i - 1].p, s.p) : 0);
      } else if (n && now > s.dep && now < n.arr) {
        a = [s.p.lat, s.p.lon, s.dep];
        b = [n.p.lat, n.p.lon, n.arr];
        h = heading(s.p, n.p);
      }
      if (!a || !b) continue;
      const p = a !== b && n ? segmentPath(c.mode, c.line, `${s.code}>${n.code}`, [s.p.lat, s.p.lon], [n.p.lat, n.p.lon]) : null;
      const sp = a !== b ? speedNow(c.line, c.mode, calls, i) : { s: 0 };
      out.push({
        id: c.id, line: c.line, dest: c.dest, rt: false, m: c.mode, a, b, h, ...(sp ?? {}),
        next: calls.slice(i + 1, i + 7).map(k => [k.name, k.arr]),
        ...(p ? { p } : {}), ...(vno ? { n: vno } : {})
      });
      break;
    }
  }
  return out;
}
