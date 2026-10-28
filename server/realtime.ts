/**
 * Passages en direct de tout le réseau, chargés d'un coup (SIRI « estimated-timetable ») puis redistribués.
 * Le serveur appelle la CTS toutes les ET_POLL_S secondes, quel que soit le nombre de visiteurs, et répond aux demandes
 * « stop-monitoring » depuis la mémoire. Si la photo est trop ancienne ou ne connaît pas l'arrêt, l'appel arrêt par arrêt reprend.
 */
import { AUTH, BASE, ET_POLL_S, REQUESTOR, STALE_REALTIME_S } from "./config.js";
import { describeError, fetchCts } from "./cts.js";
import { updateStalls } from "./stalls.js";
import { initRoutes, learnRoutes } from "./routes.js";
import { initObservations } from "./observations.js";
import { aimedTimes } from "./schedule.js";
import { recordPunctuality } from "./punctuality.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  /** passage supprimé (course annulée, ou arrêt non desservi) */
  cancelled?: boolean;
}

/**
 * Suppressions au format SIRI : course entière (Cancellation) ou arrêt non desservi (statut « cancelled »). La CTS n'en
 * publie pas à ce jour (ses courses supprimées disparaissent simplement) ; lues au cas où elle le ferait.
 */
const isCancelledJourney = (jr: Record<string, unknown>): boolean => jr["Cancellation"] === true || jr["Cancellation"] === "true";
const isCancelledCall = (c: Record<string, unknown>): boolean =>
  c["Cancellation"] === true || /cancel/i.test(str(c["DepartureStatus"])) || /cancel/i.test(str(c["ArrivalStatus"]));

/** Une course complète (tous ses arrêts, dans l'ordre) : sert à situer les véhicules (vehicles.ts) */
export interface Course {
  id: string;
  line: string;
  dest: string;
  realTime: boolean;
  /** « tram » ou « bus », d'après la CTS (Extension.VehicleMode) ; « ter » pour les trains */
  mode: string;
  /** arr, dep : horaires estimés (temps réel) ; aim : horaire prévu (théorique), pour calculer un retard */
  calls: { code: string; name: string; arr: number; dep: number; aim?: number; /** heure estimée par Kumm (arrêt passé sans heure) */ est?: true }[];
  /** départ prévu (horaire théorique, qui ne bouge pas avec les retards) : sert au code du trajet */
  aimed?: number;
  /** numéro du train (trains TER seulement) */
  num?: string;
  /** sens de la ligne (DirectionRef de la CTS) */
  dir?: string;
}

/** Passages à venir, par code de quai CTS (« 412D ») */
let byCode = new Map<string, Visit[]>();
let courses: Course[] = [];
/** Position de chaque quai (StopCode) */
let stopPos = new Map<string, { lat: number; lon: number }>();
/** Modes des véhicules qui desservent chaque quai (« 319A » → tram), d'après les courses vues ; cumulé d'un chargement à l'autre */
const quayModes = new Map<string, Set<string>>();
/** Lignes qui desservent chaque quai (« 527C » → A, B…) : la liste des arrêts de la CTS ne le dit pas */
const quayLines = new Map<string, Set<string>>();

/* Modes et lignes des quais, gardés dans le dossier d'état : un redémarrage (ou une journée sans tram) ne les fait pas oublier */
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const QUAYS_FILE = path.join(process.env.STATE_DIR ?? path.join(ROOT, "state"), "quays.json");
let quaysDirty = false;
initRoutes(path.dirname(QUAYS_FILE));
initObservations(path.dirname(QUAYS_FILE));
try {
  const saved = JSON.parse(fs.readFileSync(QUAYS_FILE, "utf8")) as Record<string, { m?: string[]; l?: string[] }>;
  for (const [code, q] of Object.entries(saved)) {
    if (q.m?.length) quayModes.set(code, new Set(q.m));
    if (q.l?.length) quayLines.set(code, new Set(q.l));
  }
} catch { /* premier démarrage */ }
setInterval(() => {
  if (!quaysDirty) return;
  quaysDirty = false;
  const codes = new Set([...quayModes.keys(), ...quayLines.keys()]);
  const out = Object.fromEntries([...codes].map(c => [c, { m: [...(quayModes.get(c) ?? [])], l: [...(quayLines.get(c) ?? [])] }]));
  try { fs.mkdirSync(path.dirname(QUAYS_FILE), { recursive: true }); fs.writeFileSync(QUAYS_FILE + ".tmp", JSON.stringify(out)); fs.renameSync(QUAYS_FILE + ".tmp", QUAYS_FILE); }
  catch (e) { console.warn("Quais : état non enregistré :", e instanceof Error ? e.message : e); }
}, 5 * 60_000).unref();

const learn = (map: Map<string, Set<string>>, code: string, value: string): void => {
  const set = map.get(code) ?? map.set(code, new Set()).get(code)!;
  if (!set.has(value)) { set.add(value); quaysDirty = true; }
};
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

/* Arrêts déjà passés : la CTS remplace parfois leur heure par une date bidon (« 0001-01-01T00:00:00 »). Prise telle quelle,
   le véhicule semblait parti en l'an 1 : vitesse absurde, arrêts sautés, puis saut brutal, et un code de trajet faux. */
const MIN_TIME = Date.UTC(2020, 0, 1);
const real = (t: number): boolean => Number.isFinite(t) && t > MIN_TIME;
/** heure de départ prévue au terminus de chaque course, retenue tant qu'elle est connue (le code du trajet en dépend) */
const startOf = new Map<string, number>();

/** Lit la réponse estimated-timetable : un passage par arrêt desservi, sauf l'arrivée au terminus (on ne peut pas y monter) */
export function parseEstimatedTimetable(body: string): { byCode: Map<string, Visit[]>; validUntil: string; courses: number; passages: number; list: Course[] } {
  const j = JSON.parse(body) as { ServiceDelivery?: { EstimatedTimetableDelivery?: unknown[] } };
  const map = new Map<string, Visit[]>();
  const list: Course[] = [];
  let courses = 0, passages = 0, until = "";
  const seen = new Set<string>();
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
          line: str(jr["PublishedLineName"]) || str(jr["LineRef"]), dest: "", realTime: false,
          mode: str(isObj(jr["Extension"]) ? jr["Extension"]["VehicleMode"] : "").toLowerCase(), calls: [],
          ...(jr["DirectionRef"] != null && jr["DirectionRef"] !== "" ? { dir: String(jr["DirectionRef"]) } : {})
        };
        const journeyCancelled = isCancelledJourney(jr);
        let passed = 0;   // arrêts déjà passés en tête de course, sans heure valable
        for (const c of calls) {
          if (!isObj(c) || isCancelledCall(c)) continue;      // arrêt non desservi : ni passage, ni position sur la carte
          const p = (k: string): number => { const t = Date.parse(str(c[k])); return real(t) ? t : NaN; };
          const dep = Number.isNaN(p("ExpectedDepartureTime")) ? p("AimedDepartureTime") : p("ExpectedDepartureTime");
          const arr = Number.isNaN(p("ExpectedArrivalTime")) ? p("AimedArrivalTime") : p("ExpectedArrivalTime");
          const a = Number.isNaN(arr) ? dep : arr, d = Number.isNaN(dep) ? arr : dep;
          if (!str(c["StopPointRef"])) continue;
          if (Number.isNaN(a)) {
            // sans heure : arrêt déjà passé s'il précède tous les arrêts horodatés (heure estimée plus bas), sinon ignoré
            if (course.calls.length === passed) { course.calls.push({ code: str(c["StopPointRef"]), name: str(c["StopPointName"]), arr: NaN, dep: NaN }); passed++; }
            continue;
          }
          const aim = Number.isNaN(p("AimedArrivalTime")) ? p("AimedDepartureTime") : p("AimedArrivalTime");
          if (course.aimed === undefined) { const t = Number.isNaN(p("AimedDepartureTime")) ? p("AimedArrivalTime") : p("AimedDepartureTime"); if (!Number.isNaN(t) && course.calls.length === 0) course.aimed = t; }
          course.calls.push({ code: str(c["StopPointRef"]), name: str(c["StopPointName"]), arr: a, dep: d, ...(Number.isNaN(aim) ? {} : { aim }) });
          course.dest ||= str(c["DestinationName"]);
          if (isObj(c["Extension"]) && c["Extension"]["IsRealTime"] === true) course.realTime = true;
        }
        // arrêts passés sans heure : une minute d'écart chacun avant le premier arrêt horodaté (le véhicule les a déjà quittés)
        if (passed) {
          if (course.calls.length === passed) course.calls = [];
          else { const t0 = course.calls[passed].arr; for (let i = 0; i < passed; i++) { course.calls[i].arr = course.calls[i].dep = t0 - (passed - i) * 60_000; course.calls[i].est = true; } }
        }
        // horaires théoriques de la CTS (schedule.ts) : heure prévue à chaque arrêt (retard) et vrai départ prévu de la course
        const sch = course.calls.length ? aimedTimes(course.id, course.calls.map(x => x.code), course.calls[course.calls.length - 1].arr) : null;
        if (sch) {
          course.calls.forEach((x, i) => { if (x.aim === undefined && sch.aim[i] !== undefined) x.aim = sch.aim[i]; });
          course.aimed = sch.start;
        }
        // départ prévu au terminus : retenu d'une mise à jour à l'autre (il disparaît quand le premier arrêt est passé)
        seen.add(course.id);
        const known = startOf.get(course.id);
        if (sch) startOf.set(course.id, sch.start);
        else if (known !== undefined) course.aimed = known;
        else if (!passed && course.calls.length) startOf.set(course.id, course.aimed ??= course.calls[0].dep);
        if (course.calls.length >= 2 && !journeyCancelled) list.push(course);   // course supprimée : pas de véhicule
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
            departure, arrival: str(c["ExpectedArrivalTime"]) || undefined, time, realTime: ext["IsRealTime"] === true,
            ...(journeyCancelled || isCancelledCall(c) ? { cancelled: true } : {})
          };
          (map.get(code) ?? map.set(code, []).get(code)!).push(v);
          passages++;
        });
      }
    }
  }
  for (const l of map.values()) l.sort((a, b) => a.time - b.time);
  for (const id of startOf.keys()) if (!seen.has(id)) startOf.delete(id);   // course terminée
  return { byCode: map, validUntil: until, courses, passages, list };
}

async function refresh(): Promise<void> {
  try {
    const r = await fetchCts(BASE, AUTH, "estimated-timetable", "?RequestorRef=" + encodeURIComponent(REQUESTOR));
    if (r.status !== 200) throw new Error("HTTP " + r.status);
    const p = parseEstimatedTimetable(r.body);
    // la CTS retire une course dès son arrivée au terminus : on la garde 45 min, pour savoir quel véhicule y attend
    // la course suivante (vehicles.ts, numéros de véhicules estimés)
    const now = Date.now(), ids = new Set(p.list.map(c => c.id));
    const recent = courses.filter(c => !ids.has(c.id) && c.calls[c.calls.length - 1].arr > now - 45 * 60_000);
    byCode = p.byCode; courses = [...p.list, ...recent]; validUntil = p.validUntil; loadedAt = now; lastError = "";
    updateStalls(p.list, now);
    learnRoutes(p.list, now);
    recordPunctuality(p.list, now);
    for (const c of p.list) for (const call of c.calls) { if (c.mode) learn(quayModes, call.code, c.mode); if (c.line) learn(quayLines, call.code, c.line); }
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
            MonitoredCall: { StopPointRef: v.stopCode, StopPointName: v.stopName, ExpectedDepartureTime: v.departure, ExpectedArrivalTime: v.arrival, ...(v.cancelled ? { DepartureStatus: "cancelled" } : {}) },
            Extension: { IsRealTime: v.realTime }
          }
        }))
      }]
    }
  });
}

/* ---------- widgets Android (server/widgets.ts) : passages tirés de la photo du réseau, sans appel à la CTS ---------- */
export interface WidgetVisit { line: string; dest: string; time: number; rt: boolean; cancelled?: boolean; stopName: string }
const fresh = (now: number): boolean => !!loadedAt && now - loadedAt <= (ET_POLL_S + STALE_REALTIME_S) * 1000;

/** Passages à venir pour des codes d'arrêt (codes de l'arrêt et de ses quais, comme dans l'application) */
export function upcomingFor(refs: string[], now = Date.now()): WidgetVisit[] | null {
  if (!fresh(now)) return null;
  const codes = new Set(refs.flatMap(r => aliases.get(r) ?? (byCode.has(r) ? [r] : [])));
  return [...codes].flatMap(c => byCode.get(c) ?? []).filter(v => v.time > now - 30_000)
    .map(v => ({ line: v.line, dest: v.dest, time: v.time, rt: v.realTime, stopName: v.stopName, ...(v.cancelled ? { cancelled: true } : {}) }));
}

/** Arrêt le plus proche (≤ 800 m) qui a encore des passages dans l'heure et demie ; ses quais du même nom sont réunis */
export function nearestWithDepartures(lat: number, lon: number, now = Date.now()): { name: string; dist: number; codes: string[] } | null {
  if (!fresh(now)) return null;
  const m = (p: { lat: number; lon: number }): number => Math.hypot((p.lon - lon) * 111_320 * Math.cos((lat * Math.PI) / 180), (p.lat - lat) * 110_540);
  const near = [...stopPos].map(([code, p]) => ({ code, p, d: m(p) })).filter(x => x.d < 800).sort((a, b) => a.d - b.d);
  const soon = (code: string): Visit[] => (byCode.get(code) ?? []).filter(v => v.time > now && v.time < now + 90 * 60_000);
  const first = near.find(x => soon(x.code).length);
  if (!first) return null;
  const name = soon(first.code)[0].stopName, key = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const fromFirst = (p: { lat: number; lon: number }): number => Math.hypot((p.lon - first.p.lon) * 111_320 * Math.cos((lat * Math.PI) / 180), (p.lat - first.p.lat) * 110_540);
  const codes = near.filter(x => fromFirst(x.p) < 400 && (byCode.get(x.code) ?? []).some(v => v.stopName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === key)).map(x => x.code);
  return { name, dist: Math.round(first.d), codes };
}

/** Courses et positions des quais, si la photo est assez récente (null sinon) */
export function snapshot(now = Date.now()): { courses: Course[]; stopPos: Map<string, { lat: number; lon: number }>; at: number } | null {
  if (!loadedAt || now - loadedAt > (ET_POLL_S + STALE_REALTIME_S) * 1000 || !stopPos.size) return null;
  return { courses, stopPos, at: loadedAt };
}

/** Mode de chaque quai : « tram », « bus », ou « tram+bus » si les deux s'y arrêtent */
/** Lignes de chaque quai, triées (« 527C » → ["B", "C", "F"]) */
export function quayLinesJson(): Record<string, string[]> {
  return Object.fromEntries([...quayLines].map(([k, v]) => [k, [...v].sort()]));
}

export function quayModesJson(): Record<string, string> {
  return Object.fromEntries([...quayModes].map(([k, v]) => [k, [...v].sort().join("+")]));
}

/** Pour /health */
export function realtimeStatus(now = Date.now()): Record<string, unknown> {
  return { actif: ET_POLL_S > 0, age_s: loadedAt ? Math.round((now - loadedAt) / 1000) : null, ...counts, codes_connus: aliases.size, derniere_erreur: lastError || null };
}
