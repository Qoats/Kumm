/**
 * Positions partagées par des voyageurs à bord (« Je suis dans ce bus ») : quand un voyageur accepte, son téléphone envoie
 * sa position pendant le trajet (POST /api/ride, application ouverte, sans aucun identifiant). Le serveur vérifie qu'elle
 * colle au trajet de la course, garde seulement la dernière position de chaque course pendant 2 minutes, et s'en sert pour
 * afficher la vraie position du véhicule et son écart avec l'horaire (vehicles.ts). Rien n'est écrit sur disque.
 */
import type { Course } from "./realtime.js";

const KEEP_MS = 2 * 60_000;
const MAX_OFF_ROUTE_M = 300;

export interface RideReport { lat: number; lon: number; t: number; speed: number | null }

/** course → dernières positions partagées (une par voyageur anonyme, au plus 5) */
const reports = new Map<string, RideReport[]>();
const counts = { recues: 0, refusees: 0 };

setInterval(() => {
  const now = Date.now();
  for (const [id, list] of reports) {
    const fresh = list.filter(r => now - r.t < KEEP_MS);
    if (fresh.length) reports.set(id, fresh); else reports.delete(id);
  }
}, 30_000).unref();

const rad = (d: number): number => (d * Math.PI) / 180;
/** Distance en mètres d'un point au segment [a, b] (projection plane locale, suffisante à cette échelle) */
function toSegment(p: { lat: number; lon: number }, a: { lat: number; lon: number }, b: { lat: number; lon: number }): { d: number; f: number } {
  const kx = 111_320 * Math.cos(rad(p.lat)), ky = 110_540;
  const ax = (a.lon - p.lon) * kx, ay = (a.lat - p.lat) * ky, bx = (b.lon - p.lon) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const f = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return { d: Math.hypot(ax + f * dx, ay + f * dy), f };
}

/** Où se trouve un point sur le trajet de la course : tronçon (k → k+1), avancée f, distance au trajet */
export function locateOnCourse(p: { lat: number; lon: number }, calls: { p: { lat: number; lon: number } }[]): { k: number; f: number; d: number } | null {
  let best: { k: number; f: number; d: number } | null = null;
  for (let k = 0; k < calls.length - 1; k++) {
    const r = toSegment(p, calls[k].p, calls[k + 1].p);
    if (!best || r.d < best.d) best = { k, f: r.f, d: r.d };
  }
  return best;
}

/**
 * Position envoyée par un voyageur : { trip, lat, lon, speed? }. Refusée si la course est inconnue ou terminée, ou si la
 * position est trop loin de son trajet (erreur de détection, ou fausse position).
 */
export function receiveRide(body: unknown, courses: Course[], stopPos: Map<string, { lat: number; lon: number }>): { status: number; msg: string } {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const trip = typeof b["trip"] === "string" ? b["trip"].slice(0, 120) : "";
  const lat = Number(b["lat"]), lon = Number(b["lon"]);
  const speed = typeof b["speed"] === "number" && Number.isFinite(b["speed"]) && b["speed"] >= 0 && b["speed"] < 40 ? b["speed"] : null;
  if (!trip || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat - 48.58) > 0.6 || Math.abs(lon - 7.75) > 0.8) { counts.refusees++; return { status: 400, msg: "Position invalide" }; }
  const c = courses.find(x => x.id === trip);
  const now = Date.now();
  if (!c || now > c.calls[c.calls.length - 1].arr + 5 * 60_000) { counts.refusees++; return { status: 404, msg: "Trajet terminé" }; }
  const calls = c.calls.map(k => ({ p: stopPos.get(k.code) })).filter(k => k.p) as { p: { lat: number; lon: number } }[];
  const where = calls.length >= 2 ? locateOnCourse({ lat, lon }, calls) : null;
  if (!where || where.d > MAX_OFF_ROUTE_M) { counts.refusees++; return { status: 409, msg: "Position éloignée du trajet" }; }
  const list = (reports.get(trip) ?? []).filter(r => now - r.t < KEEP_MS);
  list.push({ lat, lon, t: now, speed });
  reports.set(trip, list.slice(-5));
  counts.recues++;
  return { status: 200, msg: "Merci" };
}

/** Dernière position partagée d'une course (moyenne des voyageurs à bord, si plusieurs), si elle a moins de 45 s */
export function sharedPosition(trip: string, now = Date.now()): RideReport | null {
  const fresh = (reports.get(trip) ?? []).filter(r => now - r.t < 45_000);
  if (!fresh.length) return null;
  const n = fresh.length, sp = fresh.map(r => r.speed).filter((s): s is number => s !== null);
  return {
    lat: fresh.reduce((a, r) => a + r.lat, 0) / n, lon: fresh.reduce((a, r) => a + r.lon, 0) / n,
    t: Math.max(...fresh.map(r => r.t)), speed: sp.length ? sp.reduce((a, s) => a + s, 0) / sp.length : null
  };
}

/** Pour /health */
export const rideStatus = (): Record<string, unknown> => ({ trajets_partages: reports.size, ...counts });
