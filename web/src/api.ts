import { Capacitor } from "@capacitor/core";
import type { Departure, Poi, PoiKind, Stop } from "../../shared/types";
import type { AnnotatedStopPoint, SiriStopMonitoring, SiriStopPoints } from "../../shared/cts-api";
import { appHeaders, CONFIG, url } from "./config";
import { DIRS, isTram, kindOfStop } from "./data";
import { stopKey } from "./network";
import { parseLineInfo } from "./lines";
import type { LineInfo } from "./lines";
import type { TrafficMsg } from "./data";

/** Dernières réponses brutes, affichées dans « Détails techniques » quand un arrêt reste vide */
export const debug: { last: unknown[]; info: unknown } = { last: [], info: null };

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function get<T>(path: string): Promise<T> {
  let err: unknown;
  for (let i = 0; i < 2; i++) {            // 2 essais, 9 s maximum chacun
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(CONFIG.CTS_BASE + path, { signal: ctl.signal, headers: appHeaders() });
      // version web privée : session expirée → page de connexion
      if (r.status === 401 && !Capacitor.isNativePlatform()) { location.href = "/connexion"; }
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

/** Prochains passages à un arrêt : on essaie le code de l'arrêt, puis ceux de ses quais, jusqu'à obtenir des passages */
export async function nextDepartures(stop: Stop): Promise<Departure[]> {
  if (CONFIG.USE_MOCK) return mockDepartures(stop);
  const candidates = [...new Set(stop.refs ?? [stop.id])];
  const map: Record<string, Departure> = {};
  debug.last = [];
  debug.info = { id: stop.id, name: stop.name, lines: stop.lines, kind: kindOfStop(stop), essais: candidates };
  for (const ref of candidates) {
    try {
      const j = await get<SiriStopMonitoring>("/stop-monitoring?MonitoringRef=" + encodeURIComponent(ref));
      let n = 0;
      for (const dl of j.ServiceDelivery?.StopMonitoringDelivery ?? []) {
        for (const v of dl.MonitoredStopVisit ?? []) {
          const m = v.MonitoredVehicleJourney ?? {};
          const c = m.MonitoredCall ?? {};
          const line = m.PublishedLineName ?? m.LineRef ?? "?";
          const dest = m.DestinationName ?? "";
          const t = Date.parse(c.ExpectedDepartureTime ?? c.AimedDepartureTime ?? c.ExpectedArrivalTime ?? c.AimedArrivalTime ?? "");
          if (isNaN(t)) continue;
          (map[line + "|" + dest] ??= { line, dest, times: [] }).times.push(t);
          n++;
        }
      }
      debug.last.push({ ref, passages: n, reponse: n ? undefined : j });
      if (n > 0) break;
    } catch (e) {
      debug.last.push({ ref, error: e instanceof Error ? e.message : String(e) });
      // le serveur n'arrive pas à joindre la CTS : inutile d'essayer les autres codes
      if (e instanceof HttpError && (e.status === 502 || e.status === 503)) break;
    }
  }
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
  interface Group { id: string; name: string; codes: Set<string>; quays: string[]; lat: number; lon: number; n: number; lines: Set<string> }
  const by: Record<string, Group> = {};
  for (const s of j.StopPointsDelivery.AnnotatedStopPointRef ?? []) {
    if (!s.Location) continue;
    // « Gare Centrale » et « Gare centrale » : un seul arrêt (la CTS écrit parfois le même nom de deux façons)
    const g = (by[stopKey(s.StopName)] ??= { id: s.StopPointRef, name: s.StopName, codes: new Set(), quays: [], lat: 0, lon: 0, n: 0, lines: new Set() });
    if (caps(s.StopName) > caps(g.name)) g.name = s.StopName;
    g.codes.add(logicalCode(s));
    g.quays.push(s.StopPointRef);
    g.lat += Number(s.Location.Latitude);
    g.lon += Number(s.Location.Longitude);
    g.n++;
    for (const l of s.Lines ?? []) {
      const id = typeof l === "string" ? l : (l.LineRef ?? l.PublishedLineName ?? "");
      if (id) g.lines.add(id);
    }
  }
  return Object.values(by).map(g => ({
    id: g.id, name: g.name, refs: [...g.codes, ...g.quays], lat: g.lat / g.n, lon: g.lon / g.n, x: 0, y: 0, lines: [...g.lines]
  }));
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
