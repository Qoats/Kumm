/**
 * Passages en direct de tout le réseau, chargés d'un coup (SIRI « estimated-timetable ») puis redistribués.
 * Le serveur appelle la CTS toutes les ET_POLL_S secondes, quel que soit le nombre de visiteurs, et répond aux demandes
 * « stop-monitoring » depuis la mémoire. Si la photo est trop ancienne ou ne connaît pas l'arrêt, l'appel arrêt par arrêt reprend.
 */
import { AUTH, BASE, ET_POLL_S, REQUESTOR, STALE_REALTIME_S } from "./config.js";
import { describeError, fetchCts } from "./cts.js";

interface Visit {
  line: string;
  lineRef: string;
  direction: unknown;
  dest: string;
  stopCode: string;
  stopName: string;
  departure: string;
  arrival?: string;
  time: number;
  realTime: boolean;
}

/** Une course complète (tous ses arrêts, dans l'ordre) : sert à situer les véhicules (vehicles.ts) */
export interface Course {
  id: string;
  line: string;
  dest: string;
  realTime: boolean;
  calls: { code: string; name: string; arr: number; dep: number }[];
}

/** Passages à venir, par code de quai CTS (« 412D ») */
let byCode = new Map<string, Visit[]>();
let courses: Course[] = [];
/** Position de chaque quai (StopCode) */
let stopPos = new Map<string, { lat: number; lon: number }>();
let loadedAt = 0;
let validUntil = "";
let lastError = "";
const counts = { courses: 0, passages: 0, quais: 0, chargements: 0, echecs: 0 };

/** Codes demandés par l'application → codes de quai : code de quai SIRI (MSCHO_04), code sans suffixe (MSCHO), code logique (412), StopCode (412D) */
let aliases = new Map<string, string[]>();

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Construit la correspondance des codes à partir de la liste des arrêts (stoppoints-discovery) */
export function setStopIndex(body: string): void {
  try {
    const list = (JSON.parse(body) as { StopPointsDelivery?: { AnnotatedStopPointRef?: unknown[] } }).StopPointsDelivery?.AnnotatedStopPointRef ?? [];
    const out = new Map<string, Set<string>>();
    const pos = new Map<string, { lat: number; lon: number }>();
    const add = (k: string, code: string): void => { if (k) (out.get(k) ?? out.set(k, new Set()).get(k)!).add(code); };
    for (const s of list) {
      if (!isObj(s)) continue;
      const ext = isObj(s["Extension"]) ? s["Extension"] : {};
      const code = str(ext["StopCode"]);
      if (!code) continue;
      const ref = str(s["StopPointRef"]);
      add(code, code);
      add(ref, code);
      add(ref.replace(/_\d+$/, ""), code);
      add(str(ext["LogicalStopCode"]), code);
      const loc = isObj(s["Location"]) ? s["Location"] : {};
      const lat = Number(loc["Latitude"]), lon = Number(loc["Longitude"]);
      if (Number.isFinite(lat) && Number.isFinite(lon) && lat && lon) pos.set(code, { lat, lon });
    }
    if (out.size) aliases = new Map([...out].map(([k, v]) => [k, [...v]]));
    if (pos.size) stopPos = pos;
  } catch { /* forme inattendue : on garde l'ancienne correspondance */ }
}

/** Lit la réponse estimated-timetable : un passage par arrêt desservi, sauf l'arrivée au terminus (on ne peut pas y monter) */
export function parseEstimatedTimetable(body: string): { byCode: Map<string, Visit[]>; validUntil: string; courses: number; passages: number; list: Course[] } {
  const j = JSON.parse(body) as { ServiceDelivery?: { EstimatedTimetableDelivery?: unknown[] } };
  const map = new Map<string, Visit[]>();
  const list: Course[] = [];
  let courses = 0, passages = 0, until = "";
  for (const del of j.ServiceDelivery?.EstimatedTimetableDelivery ?? []) {
    if (!isObj(del)) continue;
    until ||= str(del["ValidUntil"]);
    for (const frame of Array.isArray(del["EstimatedJourneyVersionFrame"]) ? del["EstimatedJourneyVersionFrame"] : []) {
      if (!isObj(frame)) continue;
      for (const jr of Array.isArray(frame["EstimatedVehicleJourney"]) ? frame["EstimatedVehicleJourney"] : []) {
        if (!isObj(jr) || !Array.isArray(jr["EstimatedCalls"])) continue;
        courses++;
        const calls = jr["EstimatedCalls"];
        const course: Course = {
          id: str(isObj(jr["FramedVehicleJourneyRef"]) ? jr["FramedVehicleJourneyRef"]["DatedVehicleJourneySAERef"] : "") || `${str(jr["LineRef"])}-${courses}`,
          line: str(jr["PublishedLineName"]) || str(jr["LineRef"]), dest: "", realTime: false, calls: []
        };
        for (const c of calls) {
          if (!isObj(c)) continue;
          const dep = Date.parse(str(c["ExpectedDepartureTime"]) || str(c["AimedDepartureTime"]));
          const arr = Date.parse(str(c["ExpectedArrivalTime"]) || str(c["AimedArrivalTime"]));
          const a = Number.isNaN(arr) ? dep : arr, d = Number.isNaN(dep) ? arr : dep;
          if (Number.isNaN(a) || !str(c["StopPointRef"])) continue;
          course.calls.push({ code: str(c["StopPointRef"]), name: str(c["StopPointName"]), arr: a, dep: d });
          course.dest ||= str(c["DestinationName"]);
          if (isObj(c["Extension"]) && c["Extension"]["IsRealTime"] === true) course.realTime = true;
        }
        if (course.calls.length >= 2) list.push(course);
        calls.forEach((c, i) => {
          if (!isObj(c)) return;
          const departure = str(c["ExpectedDepartureTime"]) || str(c["AimedDepartureTime"]);
          if (!departure || (i === calls.length - 1 && jr["IsCompleteStopSequence"] !== false)) return;
          const time = Date.parse(departure), code = str(c["StopPointRef"]);
          if (Number.isNaN(time) || !code) return;
          const ext = isObj(c["Extension"]) ? c["Extension"] : {};
          const v: Visit = {
            line: str(jr["PublishedLineName"]) || str(jr["LineRef"]), lineRef: str(jr["LineRef"]), direction: jr["DirectionRef"],
            dest: str(c["DestinationName"]), stopCode: code, stopName: str(c["StopPointName"]),
            departure, arrival: str(c["ExpectedArrivalTime"]) || undefined, time, realTime: ext["IsRealTime"] === true
          };
          (map.get(code) ?? map.set(code, []).get(code)!).push(v);
          passages++;
        });
      }
    }
  }
  for (const l of map.values()) l.sort((a, b) => a.time - b.time);
  return { byCode: map, validUntil: until, courses, passages, list };
}

async function refresh(): Promise<void> {
  try {
    const r = await fetchCts(BASE, AUTH, "estimated-timetable", "?RequestorRef=" + encodeURIComponent(REQUESTOR));
    if (r.status !== 200) throw new Error("HTTP " + r.status);
    const p = parseEstimatedTimetable(r.body);
    byCode = p.byCode; courses = p.list; validUntil = p.validUntil; loadedAt = Date.now(); lastError = "";
    Object.assign(counts, { courses: p.courses, passages: p.passages, quais: p.byCode.size });
    if (counts.chargements++ === 0) console.log(`Passages du réseau chargés : ${p.courses} courses, ${p.byCode.size} quais`);
  } catch (e) {
    counts.echecs++;
    lastError = describeError(e);
    console.warn("Chargement des passages du réseau impossible :", lastError);
  }
}

export function startRealtime(): void {
  if (ET_POLL_S <= 0) return;
  void refresh();
  setInterval(() => { void refresh(); }, ET_POLL_S * 1000).unref();
}

const MAX_VISITS = 30;

/**
 * Réponse « stop-monitoring » construite depuis la photo du réseau, au format SIRI attendu par l'application.
 * null : photo trop ancienne, code inconnu ou aucun passage connu pour cet arrêt (l'appelant interroge alors la CTS directement).
 */
export function stopMonitoringFromSnapshot(ref: string, now = Date.now()): string | null {
  if (!loadedAt || now - loadedAt > (ET_POLL_S + STALE_REALTIME_S) * 1000) return null;
  const codes = aliases.get(ref);
  if (!codes) return null;
  const visits = codes.flatMap(c => byCode.get(c) ?? []).filter(v => v.time > now - 30_000).sort((a, b) => a.time - b.time).slice(0, MAX_VISITS);
  if (!visits.length) return null;
  const ts = new Date(loadedAt).toISOString();
  return JSON.stringify({
    ServiceDelivery: {
      ResponseTimestamp: ts,
      StopMonitoringDelivery: [{
        version: "2.0", ResponseTimestamp: ts, ValidUntil: validUntil || undefined,
        MonitoredStopVisit: visits.map(v => ({
          MonitoringRef: ref,
          MonitoredVehicleJourney: {
            LineRef: v.lineRef, PublishedLineName: v.line, DirectionRef: v.direction, DestinationName: v.dest,
            MonitoredCall: { StopPointRef: v.stopCode, StopPointName: v.stopName, ExpectedDepartureTime: v.departure, ExpectedArrivalTime: v.arrival },
            Extension: { IsRealTime: v.realTime }
          }
        }))
      }]
    }
  });
}

/** Courses et positions des quais, si la photo est assez récente (null sinon) */
export function snapshot(now = Date.now()): { courses: Course[]; stopPos: Map<string, { lat: number; lon: number }>; at: number } | null {
  if (!loadedAt || now - loadedAt > (ET_POLL_S + STALE_REALTIME_S) * 1000 || !stopPos.size) return null;
  return { courses, stopPos, at: loadedAt };
}

/** Pour /health */
export function realtimeStatus(now = Date.now()): Record<string, unknown> {
  return { actif: ET_POLL_S > 0, age_s: loadedAt ? Math.round((now - loadedAt) / 1000) : null, ...counts, codes_connus: aliases.size, derniere_erreur: lastError || null };
}
