import { Capacitor } from "@capacitor/core";
import type { Departure, Poi, PoiKind, Stop } from "../../shared/types";
import type { AnnotatedStopPoint, SiriStopMonitoring, SiriStopPoints } from "../../shared/cts-api";
import { appHeaders, CONFIG, url } from "./config";
import { DIRS, isTram, kindOfStop } from "./data";
import { isHubName, stopKey } from "./network";
import { STRASBOURG_VILLE, TER_STATIONS_EMS } from "../../shared/ter";
import type { TrainDeparture } from "../../shared/ter";
import { parseLineInfo } from "./lines";
import type { LineInfo } from "./lines";
import type { TrafficMsg } from "./data";

/** Dernières réponses brutes, affichées dans « Détails techniques » quand un arrêt reste vide */
export const debug: { last: unknown[]; info: unknown } = { last: [], info: null };

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Serveur qui a répondu « trop de requêtes » (429) : plus aucun appel avant cette heure, pour ne pas aggraver la situation */
let pausedUntil = 0;

/* ---------- hors connexion : dernière réponse de chaque demande gardée sur le téléphone ----------
   Arrêts, lignes, infos trafic, et passages des 40 derniers arrêts consultés : sans réseau (tunnel, sous-sol), l'application
   affiche ces données, avec un bandeau qui dit de quand elles datent. */
export const OFFLINE: { on: boolean; at: number } = { on: false, at: 0 };
let offlineChanged: () => void = () => {};
export const onOfflineChange = (fn: () => void): void => { offlineChanged = fn; };
const PER_STOP = /^\/(stop-monitoring|trains)\?/;
function remember(path: string, data: unknown): void {
  try {
    localStorage.setItem("off:" + path, JSON.stringify({ t: Date.now(), d: data }));
    if (PER_STOP.test(path)) {
      // au plus 40 arrêts gardés : les plus anciens sont oubliés
      const idx = (JSON.parse(localStorage.getItem("off:idx") ?? "[]") as string[]).filter(p => p !== path);
      idx.push(path);
      for (const old of idx.splice(0, Math.max(0, idx.length - 40))) localStorage.removeItem("off:" + old);
      localStorage.setItem("off:idx", JSON.stringify(idx));
    }
  } catch { /* stockage plein ou indisponible : pas de copie hors connexion */ }
}
function recall<T>(path: string): { t: number; d: T } | null {
  try { const v = localStorage.getItem("off:" + path); return v ? JSON.parse(v) as { t: number; d: T } : null; } catch { return null; }
}
function setOffline(on: boolean, at = 0): void {
  if (OFFLINE.on === on && (!on || OFFLINE.at === at)) return;
  OFFLINE.on = on; OFFLINE.at = on ? Math.min(at, OFFLINE.at || at) : 0;
  offlineChanged();
}

async function get<T>(path: string): Promise<T> {
  try {
    const d = await getOnline<T>(path);
    remember(path, d); setOffline(false);
    return d;
  } catch (e) {
    // réseau absent ou serveur injoignable (pas une demande refusée) : dernière réponse connue, s'il y en a une
    if (e instanceof HttpError && e.status < 500) throw e;
    const c = recall<T>(path);
    if (!c) throw e;
    setOffline(true, c.t);
    return c.d;
  }
}

async function getOnline<T>(path: string): Promise<T> {
  if (Date.now() < pausedUntil) throw new HttpError(429, "Trop de requêtes : nouvel essai dans quelques secondes");
  let err: unknown;
  for (let i = 0; i < 2; i++) {            // 2 essais, 9 s maximum chacun
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(CONFIG.CTS_BASE + path, { signal: ctl.signal, headers: appHeaders() });
      // version web privée : session expirée → page de connexion
      if (r.status === 401 && !Capacitor.isNativePlatform()) { location.href = "/connexion"; }
      if (r.status === 429) pausedUntil = Date.now() + Math.min(60, Number(r.headers.get("Retry-After")) || 30) * 1000;
      if (!r.ok) {
        const body = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
        throw new HttpError(r.status, `CTS ${r.status}${body ? " : " + body : ""}`);
      }
      return (await r.json()) as T;
    } catch (e) {
      if (e instanceof HttpError && e.status < 500) throw e;   // inutile de réessayer une erreur 4xx
      err = e;
      await new Promise(res => setTimeout(res, 400));
    } finally {
      clearTimeout(to);
    }
  }
  throw err;
}

/**
 * Passages déjà chargés, réutilisés pendant 20 s : l'écran se redessine à chaque geste, et chaque redessin relançait
 * l'interrogation des 12 arrêts proches (et de tous leurs quais) ; quelques gestes suffisaient à dépasser la limite du serveur.
 * Deux demandes simultanées pour le même arrêt partagent aussi la même réponse.
 */
const DEPS_TTL = 20_000;
const depsCache = new Map<string, { t: number; p: Promise<Departure[]>; dbg?: { last: unknown[]; info: unknown } }>();

export function nextDepartures(stop: Stop): Promise<Departure[]> {
  const c = depsCache.get(stop.id);
  if (c && Date.now() - c.t < DEPS_TTL) {
    if (c.dbg) { debug.last = c.dbg.last; debug.info = c.dbg.info; }
    return c.p;
  }
  const entry: { t: number; p: Promise<Departure[]>; dbg?: { last: unknown[]; info: unknown } } = { t: Date.now(), p: Promise.resolve([]) };
  entry.p = fetchDepartures(stop).then(
    r => { entry.dbg = { last: debug.last, info: debug.info }; return r; },
    e => { depsCache.delete(stop.id); throw e; }   // erreur : pas gardée, nouvel essai au prochain affichage
  );
  depsCache.set(stop.id, entry);
  if (depsCache.size > 300) for (const [k, v] of depsCache) if (Date.now() - v.t > DEPS_TTL) depsCache.delete(k);
  return entry.p;
}

/** Prochains passages à un arrêt : on essaie le code de l'arrêt, puis ceux de ses quais, jusqu'à obtenir des passages */
async function fetchDepartures(stop: Stop): Promise<Departure[]> {
  if (CONFIG.USE_MOCK) return mockDepartures(stop);
  const candidates = [...new Set(stop.refs ?? [stop.id])];
  const map: Record<string, Departure> = {};
  debug.last = [];
  debug.info = { id: stop.id, name: stop.name, lines: stop.lines, kind: kindOfStop(stop), essais: candidates };
  let answered = false, lastError: unknown = null;
  if (stop.sncf) {
    // trains : une ligne « TER » par destination (le tableau détaillé de la fiche utilise TRAINS)
    try {
      for (const t of await nextTrains(stop.sncf)) if (!t.cancelled) (map["TER|" + t.dest] ??= { line: "TER", dest: t.dest, times: [] }).times.push(t.t);
      answered = true;
    } catch (e) { lastError = e; debug.last.push({ gare: stop.sncf, error: e instanceof Error ? e.message : String(e) }); }
  }
  for (const ref of candidates) {
    try {
      const j = await get<SiriStopMonitoring>("/stop-monitoring?MonitoringRef=" + encodeURIComponent(ref));
      answered = true;
      let n = 0;
      for (const dl of j.ServiceDelivery?.StopMonitoringDelivery ?? []) {
        for (const v of dl.MonitoredStopVisit ?? []) {
          const m = v.MonitoredVehicleJourney ?? {};
          const c = m.MonitoredCall ?? {};
          const line = m.PublishedLineName ?? m.LineRef ?? "?";
          const dest = m.DestinationName ?? "";
          const t = Date.parse(c.ExpectedDepartureTime ?? c.AimedDepartureTime ?? c.ExpectedArrivalTime ?? c.AimedArrivalTime ?? "");
          if (isNaN(t)) continue;
          const d = (map[line + "|" + dest] ??= { line, dest, times: [] });
          if (/cancel/i.test(c.DepartureStatus ?? "") || /cancel/i.test(c.ArrivalStatus ?? "")) (d.cancelled ??= []).push(t);   // supprimé
          else d.times.push(t);
          n++;
        }
      }
      debug.last.push({ ref, passages: n, reponse: n ? undefined : j });
      if (n > 0) break;
    } catch (e) {
      debug.last.push({ ref, error: e instanceof Error ? e.message : String(e) });
      lastError = e;
      // le serveur n'arrive pas à joindre la CTS : inutile d'essayer les autres codes
      if (e instanceof HttpError && (e.status === 502 || e.status === 503)) break;
    }
  }
  // aucune réponse du serveur (redémarrage, réseau coupé) : erreur, pour garder à l'écran les derniers horaires connus
  // plutôt que d'afficher « Aucun passage »
  if (!answered && lastError) throw lastError;
  const out = Object.values(map);
  out.forEach(d => d.times.sort((a, b) => a - b));
  return out;
}

/** Code « logique » d'un arrêt : champ dédié s'il existe, sinon le code du quai sans son suffixe (LAMEY_01 → LAMEY) */
function logicalCode(s: AnnotatedStopPoint): string {
  const find = (o: unknown, d: number): string | undefined => {
    if (d > 2 || typeof o !== "object" || o === null) return undefined;
    for (const [k, v] of Object.entries(o)) {
      if (/logical.?stop.?code|logicalcode/i.test(k) && typeof v === "string" && v) return v;
      const r = find(v, d + 1);
      if (r) return r;
    }
    return undefined;
  };
  return find(s, 0) ?? s.StopPointRef.replace(/_\d+$/, "");
}

/** Liste des arrêts du réseau, quais regroupés par nom */
const caps = (t: string): number => (t.match(/\p{Lu}/gu) ?? []).length;

export async function loadStops(): Promise<Stop[]> {
  const j = await get<SiriStopPoints>("/stoppoints-discovery");
  interface Group { id: string; name: string; codes: Set<string>; quays: string[]; pos: { code: string; lat: number; lon: number }[]; lat: number; lon: number; n: number; lines: Set<string> }
  const by: Record<string, Group> = {};
  for (const s of j.StopPointsDelivery.AnnotatedStopPointRef ?? []) {
    if (!s.Location) continue;
    // « Gare Centrale » et « Gare centrale » : un seul arrêt (la CTS écrit parfois le même nom de deux façons)
    const g = (by[stopKey(s.StopName)] ??= { id: s.StopPointRef, name: s.StopName, codes: new Set(), quays: [], pos: [], lat: 0, lon: 0, n: 0, lines: new Set() });
    if (caps(s.StopName) > caps(g.name)) g.name = s.StopName;
    g.codes.add(logicalCode(s));
    g.quays.push(s.StopPointRef);
    if (s.Extension?.StopCode) g.pos.push({ code: s.Extension.StopCode, lat: Number(s.Location.Latitude), lon: Number(s.Location.Longitude) });
    g.lat += Number(s.Location.Latitude);
    g.lon += Number(s.Location.Longitude);
    g.n++;
    for (const l of s.Lines ?? []) {
      const id = typeof l === "string" ? l : (l.LineRef ?? l.PublishedLineName ?? "");
      if (id) g.lines.add(id);
    }
  }
  const stops: Stop[] = Object.values(by).map(g => ({
    id: g.id, name: g.name, refs: [...g.codes, ...g.quays], lat: g.lat / g.n, lon: g.lon / g.n, x: 0, y: 0, lines: [...g.lines], quays: g.pos
  }));
  // gares TER de l'Eurométropole ; Strasbourg-Ville est rattachée à Gare Centrale (une seule fiche : trams, bus et trains)
  for (const t of TER_STATIONS_EMS) {
    const hub = t.uic === STRASBOURG_VILLE ? stops.find(s => isHubName(s.name)) : undefined;
    if (hub) { hub.sncf = t.uic; hub.lines.push("TER"); continue; }
    stops.push({ id: "SNCF:" + t.uic, name: t.name, refs: [], lat: t.lat, lon: t.lon, x: 0, y: 0, lines: ["TER"], sncf: t.uic });
  }
  return stops;
}

/** Passage prévu (horaires théoriques de la CTS) */
export interface PlannedDeparture { line: string; dest: string; t: number }

/** Quai d'un arrêt CTS au format des horaires ouverts (« HOFER_13 ») : Transitous renvoie alors tous les quais de l'arrêt */
export const quayOf = (stop: Stop): string | undefined => [stop.id, ...(stop.refs ?? [])].find(r => /^[A-Z0-9]{2,12}_[0-9A-Z]{1,4}$/i.test(r));

/** Horaires prévus à un arrêt à partir d'une date et d'une heure (jusqu'à 80 passages) */
export async function plannedDepartures(stop: Stop, at: number): Promise<PlannedDeparture[]> {
  const q = quayOf(stop);
  if (!q) throw new Error("Horaires prévus indisponibles pour cet arrêt");
  const r = await fetch(url(`/geo/stoptimes?stop=${encodeURIComponent(q)}&time=${encodeURIComponent(new Date(at).toISOString())}`), { headers: appHeaders() });
  if (!r.ok) throw new Error("Horaires prévus indisponibles pour le moment");
  const j = (await r.json()) as { stopTimes?: { routeShortName?: string; headsign?: string; place?: { departure?: string; scheduledDeparture?: string }; cancelled?: boolean }[] };
  return (j.stopTimes ?? []).filter(x => !x.cancelled && x.routeShortName && x.place)
    .map(x => ({ line: x.routeShortName!, dest: x.headsign ?? "", t: Date.parse(x.place!.scheduledDeparture ?? x.place!.departure ?? "") }))
    .filter(x => Number.isFinite(x.t));
}

/** Derniers départs de trains connus de chaque gare (code UIC), pour le tableau des départs de sa fiche */
export const TRAINS: Record<string, TrainDeparture[]> = {};

/** Départs des trains d'une gare (horaires SNCF recalés en temps réel par le serveur) */
export async function nextTrains(uic: string): Promise<TrainDeparture[]> {
  const j = await get<{ trains: TrainDeparture[] }>("/trains?gare=" + encodeURIComponent(uic));
  TRAINS[uic] = j.trains;
  return j.trains;
}

/** Parcours d'une ligne (arrêts dans l'ordre) : le principal de chaque sens, puis les variantes fréquentes */
export interface LineRoute { dest: string; from: string; codes: string[]; names: string[]; share: number; extra?: LineRoute[] }
export const LINE_ROUTES: Record<string, { main: LineRoute[]; other: LineRoute[]; at: number; failed?: boolean }> = {};
const lineRouteLoading = new Set<string>();

/** Charge le parcours d'une ligne s'il n'est pas déjà là (ou s'il date de plus de 10 min) ; appelle done une fois reçu */
export function ensureLineRoute(line: string, done: () => void): void {
  const r = LINE_ROUTES[line];
  if ((r && Date.now() - r.at < (r.failed ? 30_000 : 600_000)) || lineRouteLoading.has(line)) return;
  lineRouteLoading.add(line);
  get<{ main: LineRoute[]; other: LineRoute[] }>("/line-route?line=" + encodeURIComponent(line))
    .then(j => { LINE_ROUTES[line] = { ...j, at: Date.now() }; }, () => { LINE_ROUTES[line] = { main: [], other: [], at: Date.now(), failed: true }; })
    .finally(() => { lineRouteLoading.delete(line); done(); });
}

/** Ponctualité observée (temps réel comparé aux horaires prévus), sur 30 jours */
export interface Punct { n: number; avg: number; late: number; early: number; onTime: number }
export interface NetStats { since: string | null; days: number; lines: (Punct & { line: string })[] }
export interface LineStats { since: string | null; days: number; line: string; all: Punct; byDay: Record<string, Punct>; byBand: Record<string, Punct> }
/** clé "" : tout le réseau ; sinon le nom de la ligne */
export const STATS: Record<string, { at: number; v?: NetStats | LineStats; failed?: boolean }> = {};
const statsLoading = new Set<string>();
export function ensureStats(line: string, done: () => void): void {
  const r = STATS[line];
  if ((r && Date.now() - r.at < (r.failed ? 30_000 : 300_000)) || statsLoading.has(line)) return;
  statsLoading.add(line);
  get<NetStats | LineStats>("/stats" + (line ? "?line=" + encodeURIComponent(line) : ""))
    .then(v => { STATS[line] = { at: Date.now(), v }; }, () => { STATS[line] = { at: Date.now(), failed: true }; })
    .finally(() => { statsLoading.delete(line); done(); });
}

/** Mode de chaque quai (« 319A » → « tram », « bus » ou « bus+tram »), d'après les passages en temps réel */
/** Lignes de chaque quai (« 527C » → ["B", "C", "F"]), apprises par le serveur au fil des passages */
export async function loadQuayLines(): Promise<Record<string, string[]>> {
  return get<Record<string, string[]>>("/quay-lines");
}

export async function loadQuayModes(): Promise<Record<string, string>> {
  return get<Record<string, string>>("/quay-modes");
}

/**
 * Station de tram dont certains quais ne servent qu'aux bus (Krimmeri, Lycée Couffignal…) : le repère est placé au centre
 * de ses quais de tram, et non entre le tram et les arrêts de bus.
 * Renvoie true si au moins une position a changé.
 */
export function placeOnTramQuays(stops: Stop[], modes: Record<string, string>): boolean {
  let changed = false;
  for (const s of stops) {
    if (kindOfStop(s) !== "tram" || !s.quays?.length) continue;
    const tram = s.quays.filter(q => modes[q.code]?.includes("tram"));
    // 1 ou 2 quais de tram (une ligne, un quai par sens) avec des arrêts de bus à côté ; les grands croisements
    // (République, Homme de Fer…) ont plusieurs quais de tram autour d'une place : on y garde le centre de tous les quais
    if (!tram.length || tram.length > 2 || tram.length === s.quays.length) continue;
    const lat = tram.reduce((a, q) => a + q.lat, 0) / tram.length, lon = tram.reduce((a, q) => a + q.lon, 0) / tram.length;
    if (Math.abs(lat - s.lat) > 1e-6 || Math.abs(lon - s.lon) > 1e-6) { s.lat = lat; s.lon = lon; changed = true; }
  }
  return changed;
}

/** Mode (tram, bus, TER) et nom public de chaque ligne, d'après lines-discovery */
export async function loadLineInfo(): Promise<LineInfo> {
  return parseLineInfo(await get<unknown>("/lines-discovery"));
}

/** Infos trafic en cours (incidents et travaux), déjà en texte brut */
export async function loadMessages(): Promise<TrafficMsg[]> {
  return (await get<{ items?: TrafficMsg[] }>("/messages")).items ?? [];
}

/** Stations Vélhop et parkings relais : sources ouvertes, relayées par notre serveur */
export async function loadPois(): Promise<Poi[]> {
  const out: Poi[] = [];
  const sources: { path: string; kind: PoiKind }[] = [{ path: "/poi/pr", kind: "pr" }, { path: "/poi/velhop", kind: "velhop" }];
  await Promise.all(sources.map(async s => {
    try {
      const r = await fetch(url(s.path), { headers: appHeaders() });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = (await r.json()) as { items?: { id: string; name: string; lat: number; lon: number; info?: string }[] };
      for (const p of j.items ?? []) out.push({ id: p.id, kind: s.kind, name: p.name, lat: p.lat, lon: p.lon, x: 0, y: 0, info: p.info });
    } catch (e) {
      console.warn("Catégorie indisponible :", s.path, e);
    }
  }));
  return out;
}

/* ---------- données de démonstration ---------- */
function seed(str: string): number {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function mockDepartures(stop: Stop): Departure[] {
  const now = Date.now(), out: Departure[] = [];
  for (const l of stop.lines) {
    const dirs = (DIRS[l] ?? ["", ""]).filter((d, i, a) => a.indexOf(d) === i);
    dirs.forEach((dest, i) => {
      const s = seed(stop.id + l + i), freq = isTram(l) ? 6 + (s % 5) : 9 + (s % 7);
      const phase = now % (freq * 60000);
      const t0 = now + (((s % freq) * 60000 - phase + freq * 60000) % (freq * 60000));
      out.push({ line: l, dest, times: [t0, t0 + freq * 60000, t0 + 2 * freq * 60000] });
    });
  }
  return out;
}
