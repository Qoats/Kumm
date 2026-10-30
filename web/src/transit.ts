import type { MotisItinerary, MotisLeg, MotisPlan } from "../../shared/geo-api";
import { KINDS } from "./kinds";
import type { Layer } from "./kinds";
import type { LL } from "./geo";
import { appHeaders, url } from "./config";
import { S } from "./store";

/** Une étape d'un trajet : à pied, ou à bord d'un tram / bus / train */
export interface JLeg {
  kind: Layer | "walk";
  from: { name: string; lat: number; lon: number };
  to: { name: string; lat: number; lon: number };
  /** millisecondes depuis 1970 */
  start: number;
  end: number;
  /** secondes */
  duration: number;
  distance?: number;
  line?: string;
  color?: string;
  headsign?: string;
  stops?: number;
  realTime?: boolean;
  /** tracé [latitude, longitude] pour la carte */
  path: [number, number][];
}

export interface Journey {
  start: number;
  end: number;
  duration: number;
  transfers: number;
  legs: JLeg[];
}

/** WALK → à pied ; TRAM, BUS, RAIL… → tram, bus, TER */
export function kindOfMode(mode: string): Layer | "walk" {
  const m = mode.toUpperCase();
  if (m === "WALK" || m === "BIKE" || m === "CAR" || m === "FLEX" || m === "ODM") return "walk";
  if (m === "TRAM" || m === "SUBWAY" || m === "FUNICULAR" || m === "CABLE_CAR") return "tram";
  if (m.includes("RAIL") || m === "SUBURBAN" || m === "LONG_DISTANCE" || m === "METRO") return "ter";
  return "bus";
}

/** Décode un tracé « polyline » (Google) ; MOTIS l'envoie avec 6 décimales */
export function decodePolyline(str: string, precision = 6): [number, number][] {
  const out: [number, number][] = [], f = 10 ** precision;
  let i = 0, lat = 0, lon = 0;
  const next = (): number | null => {
    let shift = 0, result = 0, b: number;
    do {
      if (i >= str.length) return null;
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    const dLat = next(), dLon = next();
    if (dLat === null || dLon === null) break;
    lat += dLat; lon += dLon;
    out.push([lat / f, lon / f]);
  }
  return out;
}

const place = (p: MotisLeg["from"]) => ({ name: p.name && p.name !== "START" && p.name !== "END" ? p.name : "", lat: p.lat, lon: p.lon });

/** Tracé d'une étape : celui de MOTIS, sinon la suite des arrêts */
function legPath(l: MotisLeg): [number, number][] {
  if (l.legGeometry?.points) {
    try {
      const p = decodePolyline(l.legGeometry.points, l.legGeometry.precision ?? 6);
      if (p.length >= 2 && p.every(([a, b]) => Math.abs(a) <= 90 && Math.abs(b) <= 180)) return p;
    } catch { /* tracé illisible : repli sur les arrêts */ }
  }
  return [l.from, ...(l.intermediateStops ?? []), l.to].map(p => [p.lat, p.lon] as [number, number]);
}

function toLeg(l: MotisLeg): JLeg {
  const kind = kindOfMode(l.mode);
  // couleur venant d'un service externe, insérée dans un attribut style : seulement « #RRGGBB » ou « #RGB »
  const hex = (l.routeColor ?? "").replace(/^#/, "");
  const color = /^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? "#" + hex : undefined;
  return {
    kind, from: place(l.from), to: place(l.to),
    start: Date.parse(l.startTime), end: Date.parse(l.endTime), duration: l.duration,
    distance: l.distance,
    line: kind === "walk" ? undefined : (l.routeShortName ?? l.displayName ?? undefined),
    color: kind === "walk" ? undefined : color,
    headsign: l.headsign,
    stops: l.intermediateStops?.length,
    realTime: l.realTime,
    path: legPath(l)
  };
}

/** Garde les trajets qui utilisent au moins un transport, du plus tôt au plus tard */
export function parseJourneys(plan: MotisPlan): Journey[] {
  const out: Journey[] = [];
  for (const it of (plan.itineraries ?? []) as MotisItinerary[]) {
    const legs = (it.legs ?? []).map(toLeg).filter(l => !Number.isNaN(l.start) && !Number.isNaN(l.end));
    if (!legs.some(l => l.kind !== "walk")) continue;
    out.push({ start: Date.parse(it.startTime), end: Date.parse(it.endTime), duration: it.duration, transfers: it.transfers, legs });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Heure demandée : départ (« Partir à ») ou arrivée (« Arriver avant ») ; sans heure = maintenant */
export interface TripTime { at: number; arrive: boolean }

export async function fetchTransit(from: LL, to: LL, when?: TripTime): Promise<Journey[]> {
  const t = when ? `&time=${encodeURIComponent(new Date(when.at).toISOString())}${when.arrive ? "&arrive=1" : ""}` : "";
  const sf = S.prefs.stepFree ? "&stepfree=1" : "";
  const r = await fetch(url(`/geo/transit?from=${from.lat},${from.lon}&to=${to.lat},${to.lon}${t}${sf}`), { headers: appHeaders() });
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 140);
    throw new Error(`erreur ${r.status}${detail ? " : " + detail : ""}`);
  }
  return parseJourneys((await r.json()) as MotisPlan);
}

export const hm = (ms: number): string => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
export const minutes = (sec: number): number => Math.max(1, Math.round(sec / 60));
export const legColor = (l: JLeg, nameColor?: string): string =>
  l.kind === "walk" ? "#B9BEC4" : (l.color ?? nameColor ?? KINDS[l.kind].color);
