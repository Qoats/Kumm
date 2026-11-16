/** Horaires théoriques officiels CTS. Le GTFS reste disponible sans accès SIRI. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DAY, dayBase, eachRow, ymd, zipEntries } from "./gtfs.js";
import type { AnnotatedStopPoint, SiriStopMonitoring } from "../shared/cts-api.js";
import type { Course, WidgetVisit } from "./realtime.js";
import type { LineRoute } from "./routes.js";

const GTFS_URL = process.env.CTS_GTFS_URL ?? "https://opendata.cts-strasbourg.eu/google_transit.zip";
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const FILE = path.join(process.env.STATE_DIR ?? path.join(ROOT, "state"), "cts-gtfs.zip");
const MAX_AGE = 20 * 3600_000;
const HOUR = 3600_000;
const MAX_DOWNLOAD = 64 * 1024 * 1024;

interface Route { code: string; name: string; type: number; color: string; text: string }
interface Stop { id: string; code: string; parent: string; name: string; lat: number; lon: number; lines: Set<string> }
interface Service { from: string; to: string; days: boolean[]; exceptions: Map<string, boolean> }
interface Trip { id: string; route: Route; service: Service; dest: string; direction: string; calls: Call[] }
interface Call { stop: Stop; seq: number; arr: number; dep: number; board: boolean; dest: string }
interface Visit { trip: Trip; call: Call }
interface Feed {
  routes: Map<string, Route>;
  stops: AnnotatedStopPoint[];
  aliases: Map<string, Stop[]>;
  byStop: Map<Stop, Visit[]>;
  trips: Map<string, Trip>;
  positions: Map<string, { lat: number; lon: number }>;
  variants: Map<string, { main: LineRoute[]; other: LineRoute[] }>;
  lookback: number;
}

const WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const daytime = (date: string): Date =>
  new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)), 12));
const serviceDay = (date: string, offset: number): string => new Date(+daytime(date) + offset * DAY).toISOString().slice(0, 10).replaceAll("-", "");
const seconds = (v: string): number => {
  if (!/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(v)) return NaN;
  const [h, m, s] = v.split(":").map(Number);
  return 3600 * h + 60 * m + s;
};
const isTram = (route: Route): boolean => route.type === 0 || (route.type >= 900 && route.type < 1000);
const isActive = (s: Service, day: { date: string; dow: number }): boolean =>
  s.exceptions.get(day.date) ?? (s.from <= day.date && day.date <= s.to && s.days[day.dow] === true);
let feed: Feed | null = null;
let fileDate = 0, lastError = "";
let loading: Promise<void> | null = null;
let retryAfter = 0;

async function parse(buf: Buffer): Promise<Feed> {
  const entries = zipEntries(buf);
  const services = new Map<string, Service>();
  const service = (id: string): Service => {
    const old = services.get(id);
    if (old) return old;
    const created = { from: "", to: "", days: [], exceptions: new Map<string, boolean>() };
    services.set(id, created);
    return created;
  };
  if (entries.has("calendar.txt")) await eachRow(buf, entries, "calendar.txt", (r, c) => {
    const s = service(r[c["service_id"]]);
    s.from = r[c["start_date"]];
    s.to = r[c["end_date"]];
    s.days = WEEK.map(day => r[c[day]] === "1");
  });
  if (entries.has("calendar_dates.txt")) await eachRow(buf, entries, "calendar_dates.txt", (r, c) => {
    service(r[c["service_id"]]).exceptions.set(r[c["date"]], r[c["exception_type"]] === "1");
  });

  const routes = new Map<string, Route>(), stopById = new Map<string, Stop>(), trips = new Map<string, Trip>();
  await eachRow(buf, entries, "routes.txt", (r, c) => {
    const id = r[c["route_id"]];
    routes.set(id, { code: r[c["route_short_name"]] || id, name: r[c["route_long_name"]], type: Number(r[c["route_type"]]), color: r[c["route_color"]], text: r[c["route_text_color"]] });
  });
  await eachRow(buf, entries, "stops.txt", (r, c) => {
    const id = r[c["stop_id"]], lat = Number(r[c["stop_lat"]]), lon = Number(r[c["stop_lon"]]);
    if (id && lat && lon && Number.isFinite(lat) && Number.isFinite(lon)) stopById.set(id, {
      id, code: r[c["stop_code"]] || id, parent: r[c["parent_station"]] || id.replace(/_\d+$/, ""),
      name: r[c["stop_name"]], lat, lon, lines: new Set()
    });
  });
  await eachRow(buf, entries, "trips.txt", (r, c) => {
    const id = r[c["trip_id"]], route = routes.get(r[c["route_id"]]), s = services.get(r[c["service_id"]]);
    if (route && s) trips.set(id, { id, route, service: s, dest: r[c["trip_headsign"]], direction: r[c["direction_id"]], calls: [] });
  });
  let lookback = 1;
  await eachRow(buf, entries, "stop_times.txt", (r, c) => {
    const trip = trips.get(r[c["trip_id"]]), stop = stopById.get(r[c["stop_id"]]);
    if (!trip || !stop) return;
    const dep = seconds(r[c["departure_time"]] || r[c["arrival_time"]] || "");
    const arr = seconds(r[c["arrival_time"]] || r[c["departure_time"]] || "");
    if (!Number.isFinite(dep) || !Number.isFinite(arr)) return;
    trip.calls.push({ stop, seq: Number(r[c["stop_sequence"]]), arr, dep, board: r[c["pickup_type"]] !== "1", dest: r[c["stop_headsign"]] });
    stop.lines.add(trip.route.code);
    lookback = Math.max(lookback, Math.floor(dep / 86400));
  });

  const byStop = new Map<Stop, Visit[]>();
  const counts = new Map<string, Map<string, { variant: LineRoute; count: number }>>();
  for (const [id, trip] of trips) {
    trip.calls.sort((a, b) => a.seq - b.seq);
    if (trip.calls.length < 2) { trips.delete(id); continue; }
    trip.dest ||= trip.calls.at(-1)!.stop.name;
    const direction = trip.route.code + "|" + (trip.direction || trip.dest);
    const signature = trip.calls.map(c => c.stop.id).join(" ");
    const patterns = counts.get(direction) ?? new Map();
    counts.set(direction, patterns);
    const prior = patterns.get(signature);
    if (prior) prior.count++;
    else patterns.set(signature, { count: 1, variant: {
      dest: trip.dest, from: trip.calls[0].stop.name, codes: trip.calls.map(c => c.stop.id),
      names: trip.calls.map(c => c.stop.name), share: 0
    } });
    for (const call of trip.calls.slice(0, -1)) {
      if (!call.board) continue;
      const visits = byStop.get(call.stop) ?? [];
      visits.push({ trip, call });
      byStop.set(call.stop, visits);
    }
  }
  const variants: Feed["variants"] = new Map();
  for (const [direction, patterns] of counts) {
    const code = direction.split("|", 1)[0], line = variants.get(code) ?? { main: [], other: [] };
    const ordered = [...patterns.values()].sort((a, b) => b.count - a.count);
    const total = ordered.reduce((sum, p) => sum + p.count, 0);
    ordered.forEach(({ variant, count }, i) => {
      variant.share = Math.round(count / total * 100);
      if (i === 0) line.main.push(variant);
      else if (count >= total * 0.1) line.other.push(variant);
    });
    variants.set(code, line);
  }

  const aliases: Feed["aliases"] = new Map(), positions: Feed["positions"] = new Map();
  const stops = [...stopById.values()].filter(s => s.lines.size > 0).map(s => {
    for (const a of new Set([s.id, s.code, s.parent])) {
      const group = aliases.get(a) ?? [];
      group.push(s);
      aliases.set(a, group);
    }
    positions.set(s.id, { lat: s.lat, lon: s.lon });
    return {
      StopPointRef: s.id, StopName: s.name, Lines: [...s.lines],
      Location: { Latitude: s.lat, Longitude: s.lon },
      Extension: { StopCode: s.id, LogicalStopCode: s.parent }
    };
  });
  if (!stops.length || !variants.size || !byStop.size) throw new Error("Flux CTS sans arrêts ni horaires exploitables");
  return { routes, stops, aliases, byStop, trips, positions, variants, lookback };
}

export function loadSchedule(): Promise<void> {
  if (loading) return loading;
  if (Date.now() < retryAfter) return Promise.resolve();
  return loading = refresh().finally(() => { loading = null; });
}
async function refresh(): Promise<void> {
  const existing = await fs.stat(FILE).catch(() => null);
  if (!feed && existing) {
    try { feed = await parse(await fs.readFile(FILE)); fileDate = existing.mtimeMs; }
    catch { /* téléchargement d'une copie de remplacement */ }
  }
  if (feed && existing && Date.now() - existing.mtimeMs <= MAX_AGE) return;
  try {
    const r = await fetch(GTFS_URL, { headers: { "User-Agent": "Kumm (horaires théoriques CTS)" }, signal: AbortSignal.timeout(120_000) });
    if (!r.ok || !r.body) throw new Error("Téléchargement CTS HTTP " + r.status);
    const parts: Uint8Array[] = [];
    let size = 0;
    for await (const part of r.body) {
      size += part.byteLength;
      if (size > MAX_DOWNLOAD) throw new Error("Archive CTS trop volumineuse");
      parts.push(part);
    }
    const buf = Buffer.concat(parts, size);
    const next = await parse(buf);
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE + ".part", buf, { mode: 0o600 });
    await fs.rename(FILE + ".part", FILE);
    fileDate = (await fs.stat(FILE)).mtimeMs;
    feed = next;
    lastError = "";
    console.log(`Horaires CTS : ${next.trips.size} courses et ${next.stops.length} quais`);
  } catch (e) {
    retryAfter = Date.now() + 60_000;
    lastError = e instanceof Error ? e.message : "Erreur de lecture du GTFS";
    console.warn("Horaires CTS non actualisés :", lastError);
  }
}

export function startSchedule(): void {
  void loadSchedule();
  setInterval(() => { void loadSchedule(); }, HOUR).unref();
}

const days = (at: number, lookback: number, ahead: number) =>
  Array.from({ length: lookback + ahead + 1 }, (_, i) => {
    const date = serviceDay(ymd(at), i - lookback);
    return { date, dow: daytime(date).getUTCDay(), base: dayBase(date) };
  });

export function scheduledVisits(refs: string[], at: number, limit: number): WidgetVisit[] {
  const f = feed;
  if (!f) return [];
  const dates = days(at, f.lookback, 1), stops = new Set(refs.flatMap(ref => f.aliases.get(ref) ?? []));
  const out: WidgetVisit[] = [];
  for (const stop of stops) for (const { trip, call } of f.byStop.get(stop) ?? []) for (const d of dates) {
    const time = d.base + call.dep * 1000;
    if (time >= at && time < at + DAY && isActive(trip.service, d)) {
      out.push({ time, line: trip.route.code, dest: call.dest || trip.dest, rt: false, stopName: stop.name });
    }
  }
  return out.sort((a, b) => a.time - b.time).slice(0, limit);
}

export function scheduledNearby(lat: number, lon: number, at: number): { name: string; dist: number; visits: WidgetVisit[] } | null {
  const f = feed;
  if (!f) return null;
  const closest = f.stops.map(s => ({
    id: s.StopPointRef, name: s.StopName,
    dist: Math.round(Math.hypot((Number(s.Location?.Latitude) - lat) * 110540, (Number(s.Location?.Longitude) - lon) * 111320 * Math.cos(lat * Math.PI / 180)))
  })).filter(s => s.dist <= 3500).sort((a, b) => a.dist - b.dist);
  for (const s of closest.slice(0, 20)) {
    const visits = scheduledVisits([s.id], at, 40);
    if (visits.length) return { ...s, visits };
  }
  return null;
}
export const scheduleReady = (): boolean => feed !== null;
export const scheduledStops = () => ({ StopPointsDelivery: { AnnotatedStopPointRef: feed?.stops ?? [] } });
export const scheduledLines = () => ({ lines: [...(feed?.routes.values() ?? [])].map(r => ({
  LineRef: r.code, PublishedLineName: r.code, LineName: r.name, RouteType: r.type, RouteColor: r.color, RouteTextColor: r.text
})) });
export const scheduledLineRoute = (line: string): { main: LineRoute[]; other: LineRoute[] } => feed?.variants.get(line) ?? { main: [], other: [] };
export const scheduledDepartures = (ref: string, at: number): SiriStopMonitoring => ({
  ServiceDelivery: { StopMonitoringDelivery: [{ MonitoredStopVisit: scheduledVisits([ref], at, 120).map(v => ({
    MonitoredVehicleJourney: { PublishedLineName: v.line, DestinationName: v.dest,
      MonitoredCall: { AimedDepartureTime: new Date(v.time).toISOString() } }
  })) }] }
});
export const scheduledQuayLines = () => Object.fromEntries((feed?.stops ?? []).map(s => [s.StopPointRef, s.Lines ?? []]));
export const scheduledQuayModes = () => {
  const modes = new Map([...(feed?.routes.values() ?? [])].map(r => [r.code, isTram(r) ? "tram" : "bus"]));
  return Object.fromEntries((feed?.stops ?? []).map(s => [s.StopPointRef, (s.Lines ?? []).some(l => modes.get(String(l)) === "tram") ? "tram" : "bus"]));
};

let courseCache: { feed: Feed; at: number; courses: Course[] } | null = null;
export function scheduledCourses(now: number): { courses: Course[]; stopPos: Feed["positions"] } | null {
  const f = feed;
  if (!f) return null;
  if (courseCache?.feed === f && Math.abs(now - courseCache.at) < 15_000) return { courses: courseCache.courses, stopPos: f.positions };
  const out: Course[] = [], dates = days(now, f.lookback, 1);
  for (const trip of f.trips.values()) for (const d of dates) {
    const first = d.base + trip.calls[0].dep * 1000, last = d.base + trip.calls.at(-1)!.arr * 1000;
    if (first > now + 2 * HOUR || last < now - 60_000 || !isActive(trip.service, d)) continue;
    out.push({
      id: `gtfs:${d.date}:${trip.id}`, line: trip.route.code, dest: trip.dest, mode: isTram(trip.route) ? "tram" : "bus",
      realTime: false, aimed: first, dir: trip.direction,
      calls: trip.calls.map(c => ({ code: c.stop.id, name: c.stop.name, arr: d.base + c.arr * 1000, dep: d.base + c.dep * 1000 }))
    });
  }
  courseCache = { feed: f, at: now, courses: out };
  return { courses: out, stopPos: f.positions };
}

/** Alignement de la course SIRI sur les heures théoriques lorsque le temps réel est autorisé. */
export function aimedTimes(tripId: string, stopCodes: string[], near: number): { start: number; aim: (number | undefined)[] } | null {
  const trip = feed?.trips.get(tripId);
  if (!trip) return null;
  const choices = days(near, feed!.lookback, 1).filter(d => isActive(trip.service, d));
  const startTime = trip.calls[0].dep * 1000;
  choices.sort((a, b) => Math.abs(a.base + startTime - near) - Math.abs(b.base + startTime - near));
  if (!choices.length) return null;
  const { base } = choices[0];
  let from = 0;
  const aim = stopCodes.map(code => {
    const idx = trip.calls.findIndex((c, i) => i >= from && (c.stop.code === code || c.stop.id === code));
    if (idx < 0) return undefined;
    from = idx + 1;
    return base + trip.calls[idx].dep * 1000;
  });
  return { start: base + startTime, aim };
}

export const scheduleStatus = () => ({ courses: feed?.trips.size ?? 0, date_source: fileDate ? new Date(fileDate).toISOString() : null, erreur: lastError || null });
