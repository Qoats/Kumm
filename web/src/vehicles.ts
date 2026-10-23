/**
 * Trams et bus en circulation : position estimée par le serveur d'après les horaires temps réel (/api/vehicles),
 * puis animée ici seconde par seconde entre l'arrêt quitté et le suivant.
 */
import { CONFIG } from "./config";
import { isTram } from "./data";
import { appHeaders, url } from "./config";

export interface Vehicle {
  id: string;
  line: string;
  dest: string;
  rt: boolean;
  /** « tram » ou « bus » selon la CTS */
  m?: string;
  /** [latitude, longitude, heure en ms] au début et à la fin du tronçon en cours */
  a: [number, number, number];
  b: [number, number, number];
  h: number;
  next: [string, number][];
  /** tracé de la ligne entre a et b ; absent : ligne droite */
  p?: [number, number][];
  /** code du trajet (« hoeb2610240612 » : terminus de départ, ligne, date, heure de départ prévue) */
  n?: string;
  /** à quai au terminus, en attente du départ de sa prochaine course */
  w?: boolean;
}

export const VEHICLES = new Map<string, Vehicle>();
/** écart entre l'horloge du serveur et celle du téléphone (ms) */
let skew = 0;
let lastFetch = 0, loading = false;
const REFRESH_MS = 20_000;

/** Heure « serveur » : les positions restent justes même si l'horloge du téléphone est décalée */
export const serverNow = (): number => Date.now() + skew;

/** Recharge les positions si les dernières ont plus de 20 s ; rappelle onUpdate quand elles arrivent */
export function refreshVehicles(onUpdate: () => void): void {
  if (CONFIG.USE_MOCK || loading || Date.now() - lastFetch < REFRESH_MS) return;
  loading = true;
  fetch(url("/api/vehicles"), { headers: appHeaders() })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((j: { now: number; vehicles?: Vehicle[] }) => {
      skew = j.now - Date.now();
      VEHICLES.clear();
      for (const v of j.vehicles ?? []) VEHICLES.set(v.id, v);
      onUpdate();
    })
    .catch(e => console.warn("Véhicules indisponibles :", e))
    .finally(() => { loading = false; lastFetch = Date.now(); });
}

const rad = (d: number): number => (d * Math.PI) / 180;
const len = (a: [number, number], b: [number, number]): number => Math.hypot((b[1] - a[1]) * Math.cos(rad(a[0])), b[0] - a[0]);
/** Distances cumulées le long du tracé (calculées une fois par véhicule) */
const cums = new WeakMap<Vehicle, number[]>();
function cumOf(v: Vehicle, p: [number, number][]): number[] {
  let c = cums.get(v);
  if (!c) { c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + len(p[i - 1], p[i])); cums.set(v, c); }
  return c;
}

/** Avancée sur le tronçon (0 = arrêt quitté, 1 = arrêt suivant) */
function progress(v: Vehicle, t: number): number {
  const t1 = v.a[2], t2 = v.b[2];
  return t2 > t1 ? Math.max(0, Math.min(1, (t - t1) / (t2 - t1))) : 1;
}

/** Point du tracé à la fraction f, et indice du segment où il se trouve */
function along(v: Vehicle, f: number): { pos: [number, number]; i: number } | null {
  const p = v.p;
  if (!p || p.length < 2) return null;
  const c = cumOf(v, p), target = f * c[c.length - 1];
  let i = 1;
  while (i < c.length - 1 && c[i] < target) i++;
  const k = c[i] > c[i - 1] ? (target - c[i - 1]) / (c[i] - c[i - 1]) : 0;
  return { pos: [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * k, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k], i };
}

/** Position à l'instant t : le long du tracé de la ligne s'il est connu, sinon en ligne droite entre les deux arrêts */
export function vehiclePos(v: Vehicle, t = serverNow()): [number, number] {
  const f = progress(v, t), a = along(v, f);
  if (a) return a.pos;
  const [la1, lo1] = v.a, [la2, lo2] = v.b;
  return [la1 + (la2 - la1) * f, lo1 + (lo2 - lo1) * f];
}

/**
 * Position décalée de « meters » le long du tracé (négatif : en arrière), sans sortir du tronçon : sert à faire attendre un
 * véhicule juste avant l'icône d'une station en restant sur sa voie, virages compris. null si le tracé est inconnu.
 */
export function vehiclePosAlong(v: Vehicle, meters: number, t = serverNow()): [number, number] | null {
  if (!v.p || v.p.length < 2) return null;
  const c = cumOf(v, v.p), total = c[c.length - 1] * 111_320;   // longueur du tronçon en mètres
  if (total < 1) return null;
  return along(v, Math.max(0, Math.min(1, progress(v, t) + meters / total)))?.pos ?? null;
}

/** Direction à l'instant t (degrés) : celle du tracé à cet endroit, pour que la flèche suive les virages */
export function vehicleHeading(v: Vehicle, t = serverNow()): number {
  const a = along(v, progress(v, t));
  if (!a || !v.p) return v.h;
  const p0 = v.p[a.i - 1], p1 = v.p[a.i];
  return (Math.atan2((p1[1] - p0[1]) * Math.cos(rad(p0[0])), p1[0] - p0[0]) * 180 / Math.PI + 360) % 360;
}

export const vehicleKind = (v: Vehicle): "tram" | "bus" => (v.m === "tram" ? "tram" : v.m === "bus" ? "bus" : isTram(v.line) ? "tram" : "bus");
