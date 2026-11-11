/**
 * Calcul d'un itinéraire : transports, à pied et à vélo en même temps (comme un calculateur d'itinéraire classique),
 * pour afficher la durée de chaque mode dans les onglets et le tracé sur la carte.
 */
import type { Place, Stop, WalkRoute } from "../../shared/types";
import { fetchBike } from "./bike";
import type { BikeRoute } from "./bike";
import { S, USER, render } from "./store";
import { fetchTransit } from "./transit";
import type { Journey, TripTime } from "./transit";
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
  /** heure demandée pour les transports (« now » ou « depart:… » / « arrive:… ») */
  whenKey: string;
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

const tripTime = (): TripTime | undefined => (S.trip.when.kind === "now" ? undefined : { at: S.trip.when.at, arrive: S.trip.when.kind === "arrive" });
const whenKeyOf = (w?: TripTime): string => (w ? `${w.arrive ? "arrive" : "depart"}:${w.at}` : "now");

/** Une heure choisie est aussi recalculée de temps en temps (temps réel, travaux annoncés entre-temps) */
const CHOSEN_MAX_AGE = 600_000;
/** Heure choisie déjà passée (recherche faite la veille pour le lendemain matin, par exemple) : on repasse à « maintenant » */
const PAST_GRACE = 10 * 60_000;
let forced = false;
/** Moment où une heure choisie, déjà passée, a été remplacée par « maintenant » (message affiché quelques instants) */
export let whenResetAt = 0;
/** Nouveau calcul demandé (bouton Actualiser, destination choisie de nouveau) : même trajet, horaires rechargés */
export const replan = (): void => { forced = true; };

/** Lance le calcul si le départ, la destination ou l'heure ont changé, ou si les horaires datent ; chaque mode s'affiche
    dès qu'il arrive */
export function ensurePlanned(): void {
  if (!tripReady()) return;
  if (S.trip.when.kind !== "now" && S.trip.when.at < Date.now() - PAST_GRACE) { S.trip.when = { kind: "now", at: 0 }; whenResetAt = Date.now(); }
  const origin = originPlace(), dest = S.trip.dest as Place;
  const stepFree = S.prefs.stepFree;
  const key = keyOf(origin, dest), when = tripTime(), whenKey = `${whenKeyOf(when)}|stepFree:${stepFree}`;
  // « maintenant » : horaires recalculés après 2 minutes ; une heure choisie, après 10 minutes
  if (!forced && TRIP && TRIP.key === key && TRIP.whenKey === whenKey && Date.now() - TRIP.at < (when ? CHOSEN_MAX_AGE : TRANSIT_MAX_AGE)) return;
  forced = false;
  const prev = TRIP && TRIP.key === key ? TRIP : null;
  const sameWhen = prev?.whenKey === whenKey;
  const loadWalk = !prev || prev.walk.status === "error";
  const loadBike = !prev || prev.bike.status === "error";
  const t: TripState = {
    key, whenKey, at: Date.now(), origin, dest,
    transit: prev && sameWhen ? { ...prev.transit, status: "loading" } : { status: "loading" },
    walk: loadWalk ? { status: "loading" } : prev.walk,
    bike: loadBike ? { status: "loading" } : prev.bike,
    fallback: sameWhen ? prev?.fallback : undefined
  };
  if (!prev || (!sameWhen && S.trip.mode === "transit")) S.trip.sel = 0;
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
  fetchTransit(origin, dest, when)
    .then(j => {
      t.transit = { status: "ok", data: j };
      if (TRIP === t) { JOURNEYS = j; if (S.trip.mode === "transit" && S.trip.sel >= j.length) S.trip.sel = 0; }
      if (!stepFree && !j.length && !t.fallback) void useFallback();
    })
    .catch(e => {
      t.transit = { status: "error", error: why(e), data: t.transit.data };
      if (!stepFree && !t.transit.data?.length && !t.fallback) void useFallback();
    })
    .finally(done);
  // Les requêtes de marche et de vélo en cours survivent à un recalcul des horaires.
  if (loadWalk) {
    const walk = t.walk;
    void fetchWalk(origin, dest)
      .then(data => { walk.status = "ok"; walk.data = data; })
      .catch(e => { walk.status = "error"; walk.error = why(e); })
      .finally(() => { if (TRIP?.walk === walk) render(); });
  }
  if (loadBike) {
    const bike = t.bike;
    void fetchBike(origin, dest)
      .then(data => {
        bike.status = "ok"; bike.data = data;
        if (TRIP?.bike === bike) { BIKE_ROUTES.length = 0; BIKE_ROUTES.push(...data); }
      })
      .catch(e => { bike.status = "error"; bike.error = why(e); })
      .finally(() => { if (TRIP?.bike === bike) render(); });
  }
}
