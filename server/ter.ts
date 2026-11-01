/**
 * Trains TER autour de Strasbourg, d'après les données ouvertes de la SNCF :
 *  - horaires théoriques (GTFS, téléchargé une fois par jour et gardé dans le dossier d'état) : seuls les trains qui
 *    desservent une gare de l'Eurométropole sont gardés en mémoire ;
 *  - temps réel (GTFS-RT « trip updates », rechargé toutes les TER_POLL_S secondes) : retards, trains supprimés,
 *    gares non desservies. Un train absent du temps réel roule à l'heure.
 * Comme pour les trams et bus, la position d'un train est estimée d'après ses horaires (vehicles.ts) : ce n'est pas un GPS.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TER_POLL_S } from "./config.js";
import { DAY, dayBase, daysAround, eachRow, ymd, zipEntries } from "./gtfs.js";
import { TER_STATIONS, TER_TRIP_PREFIX } from "../shared/ter.js";
import type { TrainDeparture } from "../shared/ter.js";
import type { Course } from "./realtime.js";

const GTFS_URL = process.env.TER_GTFS_URL ?? "https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip";
const RT_URL = process.env.TER_RT_URL ?? "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates";
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const GTFS_FILE = path.join(process.env.STATE_DIR ?? path.join(ROOT, "state"), "ter-gtfs.zip");
const MAX_AGE = 20 * 3600_000;              // horaires retéléchargés au plus une fois toutes les 20 h
/** Préfixe des codes d'arrêt des gares dans les courses (« SNCF:87212027 ») */
export const TER_CODE = "SNCF:";

/** Arrêt d'un train : heures en secondes depuis le début de la journée de service (peuvent dépasser 24 h) */
interface TripStop { uic: string; seq: number; arr: number; dep: number; board: boolean }
interface Trip { id: string; num: string; route: string; dates: string[]; stops: TripStop[] }

let trips: Trip[] = [];
/** Gares desservies par ces trains (y compris hors de l'Eurométropole, pour situer un train entre deux gares) */
let stations = new Map<string, { name: string; lat: number; lon: number }>();
let loadedFor = "";                          // journée pour laquelle les horaires ont été préparés
let gtfsDate = 0;
/** Gares suivies : celles de shared/ter.ts (Eurométropole, ligne de Lauterbourg, ligne Paris-Est – Strasbourg) et toutes
    les gares TER du Grand Est (Alsace, Lorraine, Champagne-Ardenne), ajoutées à la lecture des horaires */
const EMS = new Set(TER_STATIONS.map(s => s.uic));
/** Gares suivies, avec leur nom et leur position (servies à l'application : fiches et départs) */
let followed: { uic: string; name: string; lat: number; lon: number }[] = TER_STATIONS.map(s => ({ ...s }));
export const followedStations = (): { uic: string; name: string; lat: number; lon: number }[] => followed;
export const isFollowedStation = (uic: string): boolean => EMS.has(uic);

/** Contour simplifié de la région Grand Est (longitude, latitude), au kilomètre près : suffit à trier les gares */
const GRAND_EST: [number, number][] = [
  [4.05, 49.97], [4.85, 50.17], [4.97, 49.80], [5.40, 49.62], [5.82, 49.55], [6.37, 49.47], [6.74, 49.17], [7.05, 49.12],
  [7.38, 49.17], [7.63, 49.07], [8.23, 48.97], [7.80, 48.55], [7.58, 48.10], [7.52, 47.66], [7.55, 47.55], [7.35, 47.43],
  [7.13, 47.49], [6.85, 47.82], [6.40, 47.95], [5.90, 47.80], [5.25, 47.58], [4.85, 47.70], [4.30, 47.85], [3.75, 48.10],
  [3.40, 48.37], [3.48, 48.80], [3.65, 49.05], [3.85, 49.40]
];
function inGrandEst(lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = GRAND_EST.length - 1; i < GRAND_EST.length; j = i++) {
    const [xi, yi] = GRAND_EST[i], [xj, yj] = GRAND_EST[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** « STRASBOURG-MULHOUSE » → « Strasbourg-Mulhouse » (certains noms de lignes SNCF sont en capitales) */
const softCaps = (t: string): string =>
  (t.match(/\p{Lu}/gu) ?? []).length < (t.match(/\p{L}/gu) ?? []).length * 0.7 ? t : t.toLowerCase().replace(/(^|[\s\-'(])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\b(Via|Sur|Les|La|Le|De|Des|Du)\b/g, w => w.toLowerCase());
const secs = (t: string): number => { const [h, m, s] = t.split(":").map(Number); return h * 3600 + m * 60 + (s || 0); };
const uicOf = (stopId: string): string => /(\d{8})$/.exec(stopId)?.[1] ?? "";

/** Garde les trains TER qui desservent une gare suivie (Eurométropole, lignes de Lauterbourg et de Paris) entre hier et dans une semaine */
async function parseGtfs(buf: Buffer, now: number): Promise<void> {
  const entries = zipEntries(buf);
  const window = new Set(Array.from({ length: 9 }, (_, i) => ymd(now + (i - 1) * DAY)));
  const allStations = new Map<string, { name: string; lat: number; lon: number }>();
  await eachRow(buf, entries, "stops.txt", (r, c) => {
    const id = r[c["stop_id"]];
    if (!id.startsWith("StopPoint:OCETrain TER-")) return;
    allStations.set(uicOf(id), { name: r[c["stop_name"]], lat: Number(r[c["stop_lat"]]), lon: Number(r[c["stop_lon"]]) });
  });
  // toutes les gares TER du Grand Est sont suivies (noms de shared/ter.ts gardés pour les autres)
  for (const [uic, p] of allStations) if (!EMS.has(uic) && inGrandEst(p.lon, p.lat)) { EMS.add(uic); followed.push({ uic, ...p }); }
  const dates = new Map<string, string[]>();
  await eachRow(buf, entries, "calendar_dates.txt", (r, c) => {
    const d = r[c["date"]];
    if (r[c["exception_type"]] !== "1" || !window.has(d)) return;
    const s = r[c["service_id"]];
    (dates.get(s) ?? dates.set(s, []).get(s)!).push(d);
  });
  const routes = new Map<string, string>();
  await eachRow(buf, entries, "routes.txt", (r, c) => { routes.set(r[c["route_id"]], softCaps(r[c["route_long_name"]] || r[c["route_short_name"]])); });
  const tripInfo = new Map<string, { route: string; num: string; dates: string[] }>();
  await eachRow(buf, entries, "trips.txt", (r, c) => {
    const d = dates.get(r[c["service_id"]]);
    if (!d) return;
    const id = r[c["trip_id"]];
    tripInfo.set(id, { route: routes.get(r[c["route_id"]]) ?? "", num: r[c["trip_headsign"]] || (/^OCESN(\d+)/.exec(id)?.[1] ?? ""), dates: d });
  });
  // stop_times est rangé par course : on garde une course dès qu'elle passe par une gare de l'Eurométropole
  const kept: Trip[] = [];
  let curId = "", cur: TripStop[] = [], ok = false, train = true;
  const flush = (): void => {
    const info = tripInfo.get(curId);
    if (info && ok && train && cur.length >= 2) kept.push({ id: curId, num: info.num, route: info.route, dates: info.dates, stops: cur.sort((a, b) => a.seq - b.seq) });
  };
  await eachRow(buf, entries, "stop_times.txt", (r, c) => {
    const id = r[c["trip_id"]];
    if (id !== curId) { flush(); curId = id; cur = []; ok = false; train = true; }
    if (!tripInfo.has(id)) return;
    const stopId = r[c["stop_id"]];
    if (!stopId.startsWith("StopPoint:OCETrain TER-")) { train = false; return; }      // car TER, TGV… : pas un train TER
    const uic = uicOf(stopId);
    if (EMS.has(uic)) ok = true;
    cur.push({ uic, seq: Number(r[c["stop_sequence"]]), arr: secs(r[c["arrival_time"]]), dep: secs(r[c["departure_time"]]), board: r[c["pickup_type"]] !== "1" });
  });
  flush();
  const used = new Map<string, { name: string; lat: number; lon: number }>();
  for (const t of kept) for (const s of t.stops) { const p = allStations.get(s.uic); if (p) used.set(s.uic, p); }
  for (const s of TER_STATIONS) used.set(s.uic, { name: s.name, lat: s.lat, lon: s.lon });   // noms affichés dans Kumm
  trips = kept; stations = used; loadedFor = ymd(now);
  console.log(`TER : ${kept.length} trains desservent les gares suivies, ${used.size} gares`);
}

let lastError = "";
async function loadGtfs(): Promise<void> {
  try {
    let st: fs.Stats | null = null;
    try { st = fs.statSync(GTFS_FILE); } catch { /* jamais téléchargé */ }
    if (!st || Date.now() - st.mtimeMs > MAX_AGE) {
      const r = await fetch(GTFS_URL, { headers: { "User-Agent": "Kumm (horaires TER)" }, signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error("horaires SNCF : HTTP " + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      zipEntries(buf);                               // fichier tronqué : refusé, l'ancien est gardé
      fs.mkdirSync(path.dirname(GTFS_FILE), { recursive: true });
      fs.writeFileSync(GTFS_FILE + ".part", buf);
      fs.renameSync(GTFS_FILE + ".part", GTFS_FILE);
      st = fs.statSync(GTFS_FILE);
    }
    if (st.mtimeMs !== gtfsDate || loadedFor !== ymd(Date.now())) {
      await parseGtfs(fs.readFileSync(GTFS_FILE), Date.now());
      gtfsDate = st.mtimeMs;
    }
    lastError = "";
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    console.warn("TER : horaires non chargés :", lastError);
  }
}

/* ---------- temps réel (protobuf GTFS-RT, décodé à la main : seuls les champs utiles) ---------- */
class Pb {
  i = 0;
  constructor(public b: Uint8Array, public end = b.length) {}
  varint(): number {
    let r = 0, m = 1, c: number;
    do { c = this.b[this.i++]; r += (c & 0x7f) * m; m *= 128; } while (c & 0x80);
    return r;
  }
  /** int32/int64 signé (un négatif est codé sur 10 octets en complément à deux) */
  signed(): number { const v = this.varint(); return v >= 2 ** 63 ? v - 2 ** 64 : v; }
  skip(wire: number): void {
    if (wire === 0) this.varint(); else if (wire === 1) this.i += 8; else if (wire === 5) this.i += 4;
    else if (wire === 2) { const n = this.varint(); this.i += n; } else throw new Error("protobuf : type " + wire);
  }
  sub(): Pb { const n = this.varint(), p = new Pb(this.b, this.i + n); p.i = this.i; this.i += n; return p; }
  str(): string { const n = this.varint(); const s = Buffer.from(this.b.buffer, this.b.byteOffset + this.i, n).toString("utf8"); this.i += n; return s; }
  *fields(): Generator<[number, number]> { while (this.i < this.end) { const k = this.varint(); yield [k >>> 3, k & 7]; } }
}

interface StopUpdate { seq?: number; uic: string; arr?: { delay?: number; time?: number }; dep?: { delay?: number; time?: number }; skipped: boolean }
interface TripUpdate { cancelled: boolean; stops: StopUpdate[] }

function event(p: Pb): { delay?: number; time?: number } {
  const e: { delay?: number; time?: number } = {};
  for (const [f, w] of p.fields()) { if (f === 1 && w === 0) e.delay = p.signed(); else if (f === 2 && w === 0) e.time = p.signed(); else p.skip(w); }
  return e;
}

/** trip_id|date → mise à jour (seulement les trains gardés) */
export function decodeTripUpdates(buf: Uint8Array, wanted: Set<string>): Map<string, TripUpdate> {
  const out = new Map<string, TripUpdate>();
  const feed = new Pb(buf);
  for (const [f, w] of feed.fields()) {
    if (f !== 2 || w !== 2) { feed.skip(w); continue; }
    const ent = feed.sub();
    for (const [ef, ew] of ent.fields()) {
      if (ef !== 3 || ew !== 2) { ent.skip(ew); continue; }
      const tu = ent.sub();
      let id = "", date = "", cancelled = false;
      const stops: StopUpdate[] = [];
      for (const [tf, tw] of tu.fields()) {
        if (tf === 1 && tw === 2) {
          const td = tu.sub();
          for (const [df, dw] of td.fields()) {
            if (df === 1 && dw === 2) id = td.str(); else if (df === 3 && dw === 2) date = td.str();
            else if (df === 4 && dw === 0) cancelled = [3, 7].includes(td.varint()); else td.skip(dw);
          }
          if (!wanted.has(id)) break;                  // train sans arrêt dans l'Eurométropole : ignoré
        } else if (tf === 2 && tw === 2) {
          const su = tu.sub(), s: StopUpdate = { uic: "", skipped: false };
          for (const [sf, sw] of su.fields()) {
            if (sf === 1 && sw === 0) s.seq = su.varint(); else if (sf === 2 && sw === 2) s.arr = event(su.sub());
            else if (sf === 3 && sw === 2) s.dep = event(su.sub()); else if (sf === 4 && sw === 2) s.uic = uicOf(su.str());
            else if (sf === 5 && sw === 0) s.skipped = su.varint() === 1; else su.skip(sw);
          }
          stops.push(s);
        } else tu.skip(tw);
      }
      if (id && wanted.has(id)) out.set(`${id}|${date}`, { cancelled, stops });
    }
  }
  return out;
}

let updates = new Map<string, TripUpdate>();
let rtAt = 0, rtError = "";
async function refreshRt(): Promise<void> {
  if (!trips.length) return;
  try {
    const r = await fetch(RT_URL, { headers: { "User-Agent": "Kumm (temps réel TER)" }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    updates = decodeTripUpdates(new Uint8Array(await r.arrayBuffer()), new Set(trips.map(t => t.id)));
    rtAt = Date.now(); rtError = ""; built = null;
  } catch (e) {
    rtError = e instanceof Error ? e.message : String(e);
    console.warn("TER : temps réel indisponible :", rtError);
  }
}

/* ---------- trains du jour, horaires recalés ---------- */
export interface TrainRun {
  id: string; num: string; route: string; dest: string; cancelled: boolean; rt: boolean;
  calls: { uic: string; name: string; arr: number; dep: number; aimArr: number; aimDep: number; board: boolean; skipped: boolean; delay?: number }[];
}

function runsOf(t: Trip, date: string, rtFresh: boolean): TrainRun {
  const base = dayBase(date), u = rtFresh ? updates.get(`${t.id}|${date}`) : undefined;
  let delay: number | undefined;                     // retard propagé aux gares suivantes (règle GTFS-RT)
  const calls = t.stops.map(s => {
    const aimArr = base + s.arr * 1000, aimDep = base + s.dep * 1000;
    const su = u?.stops.find(x => (x.seq !== undefined && x.seq === s.seq) || (x.uic && x.uic === s.uic));
    let arr = aimArr, dep = aimDep;
    if (su) {
      if (su.arr?.time) arr = su.arr.time * 1000; else if (su.arr?.delay !== undefined) arr = aimArr + su.arr.delay * 1000; else if (delay !== undefined) arr = aimArr + delay * 1000;
      if (su.dep?.time) dep = su.dep.time * 1000; else if (su.dep?.delay !== undefined) dep = aimDep + su.dep.delay * 1000; else dep = Math.max(aimDep, arr);
      delay = Math.round((dep - aimDep) / 1000);
    } else if (delay !== undefined) { arr = aimArr + delay * 1000; dep = Math.max(aimDep, arr); }
    if (dep < arr) dep = arr;
    return { uic: s.uic, name: stations.get(s.uic)?.name ?? s.uic, arr, dep, aimArr, aimDep, board: s.board, skipped: !!su?.skipped, ...(delay !== undefined ? { delay } : {}) };
  });
  return { id: `ter:${t.num}:${date}`, num: t.num, route: t.route, dest: calls[calls.length - 1].name, cancelled: !!u?.cancelled, rt: !!u, calls };
}

let built: { minute: number; runs: TrainRun[] } | null = null;
/** Trains qui roulent entre il y a 3 h et dans 6 h (recalculé au plus une fois par minute ou à chaque temps réel) */
export function trainRuns(now = Date.now()): TrainRun[] {
  const minute = Math.floor(now / 60_000);
  if (built?.minute === minute) return built.runs;
  const rtFresh = now - rtAt < Math.max(5 * 60, TER_POLL_S * 4) * 1000;
  const seen = new Set<string>(), runs: TrainRun[] = [];
  for (const date of daysAround(now)) {
    const base = dayBase(date);
    for (const t of trips) {
      if (!t.dates.includes(date)) continue;
      const first = base + t.stops[0].dep * 1000, last = base + t.stops[t.stops.length - 1].arr * 1000;
      if (last < now - 3 * 3600_000 || first > now + 6 * 3600_000) continue;
      const run = runsOf(t, date, rtFresh);
      if (seen.has(run.id)) continue;                // même train dans deux fichiers d'horaires
      seen.add(run.id); runs.push(run);
    }
  }
  built = { minute, runs };
  return runs;
}

/** Prochains départs d'une gare (uic) : trains supprimés compris, pour l'afficher */
export function trainDepartures(uic: string, now = Date.now(), max = 30): TrainDeparture[] {
  const out: TrainDeparture[] = [];
  for (const r of trainRuns(now)) {
    const i = r.calls.findIndex(c => c.uic === uic);
    if (i < 0 || i === r.calls.length - 1) continue;                  // terminus : on ne peut pas y monter
    const c = r.calls[i];
    if (!c.board || c.dep < now - 60_000 || c.aimDep > now + 4 * 3600_000) continue;
    out.push({
      t: c.dep, aim: c.aimDep, num: r.num, dest: r.dest, route: r.route,
      ...(c.delay !== undefined ? { delay: c.delay } : {}), ...(r.cancelled || c.skipped ? { cancelled: true } : {})
    });
  }
  return out.sort((a, b) => a.t - b.t).slice(0, max);
}

/** Trains en circulation, au format des courses CTS (pour situer les véhicules et partager un trajet) */
export function terCourses(now = Date.now()): { courses: Course[]; stopPos: Map<string, { lat: number; lon: number }> } {
  const courses: Course[] = [];
  for (const r of trainRuns(now)) {
    if (r.cancelled) continue;
    const calls = r.calls.filter(c => !c.skipped);
    if (calls.length < 2 || now > calls[calls.length - 1].arr || now < calls[0].dep - 30 * 60_000) continue;
    courses.push({
      id: r.id, line: "TER", dest: r.dest, realTime: r.rt, mode: "ter", num: r.num, aimed: calls[0].aimDep,
      calls: calls.map(c => ({ code: TER_CODE + c.uic, name: c.name, arr: c.arr, dep: c.dep, aim: c.aimArr }))
    });
  }
  return { courses, stopPos: terStopPos };
}
const terStopPos = new Map<string, { lat: number; lon: number }>();

/** Code lisible d'un train : « terelsass830860 » */
export const trainCode = (num: string): string => TER_TRIP_PREFIX + num;

export function startTer(): void {
  if (TER_POLL_S <= 0) return;
  const load = async (): Promise<void> => {
    await loadGtfs();
    terStopPos.clear();
    for (const [uic, p] of stations) terStopPos.set(TER_CODE + uic, { lat: p.lat, lon: p.lon });
    built = null;
    await refreshRt();
  };
  void load();
  setInterval(() => { void load(); }, 3 * 3600_000).unref();          // nouveau jour ou nouveaux horaires
  setInterval(() => { void refreshRt(); }, TER_POLL_S * 1000).unref();
}

/** Pour /health */
export function terStatus(now = Date.now()): Record<string, unknown> {
  return {
    actif: TER_POLL_S > 0, trains: trips.length, gares: stations.size, horaires_du: loadedFor || null,
    temps_reel_age_s: rtAt ? Math.round((now - rtAt) / 1000) : null, trains_recales: updates.size,
    derniere_erreur: lastError || rtError || null
  };
}

