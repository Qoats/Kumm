import type { MotisItinerary, MotisLeg, MotisPlan } from "../../shared/geo-api";
import { KINDS } from "./kinds";
import type { Layer } from "./kinds";
import type { LL } from "./geo";
import { appHeaders, url } from "./config";

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

const place = (p: MotisLeg["from"]) => ({ name: p.name && p.name !== "START" && p.name !== "END" ? p.name : "", lat: p.lat, lon: p.lon });

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
    realTime: l.realTime
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

export async function fetchTransit(from: LL, to: LL): Promise<Journey[]> {
  const r = await fetch(url(`/geo/transit?from=${from.lat},${from.lon}&to=${to.lat},${to.lon}`), { headers: appHeaders() });
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
