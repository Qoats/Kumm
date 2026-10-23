/**
 * Calcul d'un itinéraire : transports, à pied et à vélo en même temps (comme un calculateur d'itinéraire classique),
 * pour afficher la durée de chaque mode dans les onglets et le tracé sur la carte.
 */
import type { Place, Stop, WalkRoute } from "../../shared/types";
import { fetchBike } from "./bike";
import type { BikeRoute } from "./bike";
import { S, USER, render } from "./store";
import { fetchTransit } from "./transit";
import type { Journey } from "./transit";
import { fetchWalk } from "./walk";
import { directLineCards } from "./views";

/** Dernier calcul : sert au guidage (voir flow.ts) */
export interface PlanCtx {
  origin: Place;
  dest: Place;
  lines: Record<string, { board: Stop; alight: Stop }>;
}
export let PLAN: PlanCtx | null = null;
/** Trajets en transports du dernier calcul (guidage « j:N ») */
export let JOURNEYS: Journey[] = [];
/** Itinéraires vélo du dernier calcul (guidage « data-bikenav ») */
export const BIKE_ROUTES: BikeRoute[] = [];

export interface Part<T> { status: "loading" | "ok" | "error"; data?: T; error?: string }
export interface TripState {
  key: string;
  at: number;
  origin: Place;
  dest: Place;
  transit: Part<Journey[]>;
  walk: Part<WalkRoute>;
  bike: Part<BikeRoute[]>;
  /** repli si le calculateur ne trouve rien : lignes directes d'après les arrêts connus (HTML prêt à afficher) */
  fallback?: string;
}
export let TRIP: TripState | null = null;

export const tripReady = (): boolean => !!S.trip.dest && (S.trip.fromIsMe || !!S.trip.from);
export const originPlace = (): Place => (!S.trip.fromIsMe && S.trip.from) ? S.trip.from : { label: "Ma position", lat: USER.lat, lon: USER.lon };

const keyOf = (o: Place, d: Place): string => `${o.lat.toFixed(5)},${o.lon.toFixed(5)}>${d.lat.toFixed(5)},${d.lon.toFixed(5)}`;
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** Les horaires des transports changent : nouveau calcul après 2 minutes (la marche et le vélo, eux, sont gardés) */
const TRANSIT_MAX_AGE = 120_000;

/** Lance le calcul si le départ ou la destination ont changé ; chaque mode s'affiche dès qu'il arrive */
export function ensurePlanned(): void {
  if (!tripReady()) return;
  const origin = originPlace(), dest = S.trip.dest as Place;
  const key = keyOf(origin, dest);
  if (TRIP && TRIP.key === key && Date.now() - TRIP.at < TRANSIT_MAX_AGE) return;
  const prev = TRIP && TRIP.key === key ? TRIP : null;
  const t: TripState = {
    key, at: Date.now(), origin, dest,
    transit: prev ? { ...prev.transit } : { status: "loading" },
    walk: prev ? prev.walk : { status: "loading" },
    bike: prev ? prev.bike : { status: "loading" },
    fallback: prev?.fallback
  };
  if (!prev) S.trip.sel = 0;
  TRIP = t;
  if (!prev) PLAN = { origin, dest, lines: {} };
  const done = (): void => { if (TRIP === t) render(); };

  const useFallback = async (): Promise<void> => {
    const fb = await directLineCards(origin, dest);
    if (TRIP !== t) return;
    PLAN = { origin, dest, lines: fb.lines };
    t.fallback = fb.cards.slice(0, 4).map(c => c.html).join("") || " ";
    render();
  };
  fetchTransit(origin, dest)
    .then(j => {
      t.transit = { status: "ok", data: j };
      if (TRIP === t) { JOURNEYS = j; if (S.trip.mode === "transit" && S.trip.sel >= j.length) S.trip.sel = 0; }
      if (!j.length && !t.fallback) void useFallback();
    })
    .catch(e => {
      t.transit = { status: "error", error: why(e), data: t.transit.data };
      if (!t.transit.data?.length && !t.fallback) void useFallback();
    })
    .finally(done);
  if (prev) return;
  fetchWalk(origin, dest)
    .then(r => { t.walk = { status: "ok", data: r }; })
    .catch(e => { t.walk = { status: "error", error: why(e) }; })
    .finally(done);
  fetchBike(origin, dest)
    .then(r => { t.bike = { status: "ok", data: r }; if (TRIP === t) { BIKE_ROUTES.length = 0; BIKE_ROUTES.push(...r); } })
    .catch(e => { t.bike = { status: "error", error: why(e) }; })
    .finally(done);
}
