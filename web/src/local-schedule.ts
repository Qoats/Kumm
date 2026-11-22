import { unzipSync, Unzip, UnzipInflate } from "fflate";
import type { AnnotatedStopPoint, SiriStopMonitoring } from "../../shared/cts-api";
interface WidgetVisit { time: number; line: string; dest: string; rt: boolean; stopName: string; num: string; route: string }
interface LineRoute { dest: string; from: string; codes: string[]; names: string[]; share: number }
interface Course { id: string; line: string; dest: string; mode: string; realTime: boolean; aimed: number; dir: string; num?: string; calls: { code: string; name: string; arr: number; dep: number; board: boolean; alight: boolean }[] }
const paris = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function parisParts(t: number): Record<string, number> {
  return Object.fromEntries(paris.formatToParts(new Date(t)).filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
}
const ymd = (t: number): string => { const p = parisParts(t); return `${p["year"]}${String(p["month"]).padStart(2, "0")}${String(p["day"]).padStart(2, "0")}`; };
/** Début de la journée de service GTFS (midi moins 12 h, heure de Strasbourg) : juste même les jours de changement d'heure */
function dayBase(date: string): number {
  const noon = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)), 12);
  const p = parisParts(noon), offset = Date.UTC(p["year"], p["month"] - 1, p["day"], p["hour"], p["minute"]) - noon;
  return noon - offset - 12 * 3600_000;
}
const DAY = 86_400_000;
/** Hier, aujourd'hui et demain (un train parti hier soir peut rouler après minuit) */

function csv(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const HOUR = 3600_000;
const yieldWorker = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
function zipEntries(buf: Uint8Array): Set<string> {
  const names = new Set<string>();
  unzipSync(buf, { filter: f => { if (f.originalSize > 256 * 1024 * 1024) throw Error("Fichier GTFS trop volumineux"); names.add(f.name); return false; } });
  return names;
}
/** Incremental inflation/UTF-8 decoding avoids a second full string and an array of a million CSV lines. */
async function eachRow(buf: Uint8Array, entries: Set<string>, file: string, fn: (row: string[], col: Record<string, number>) => void, background: boolean) {
  if (!entries.has(file)) throw Error(file + " absent du GTFS");
  let header: Record<string, number> | undefined, rest = "", failure: Error | undefined;
  const decoder = new TextDecoder();
  const line = (text: string) => {
    if (!text) return;
    if (!header) header = Object.fromEntries(csv(text.replace(/^\uFEFF/, "")).map((s, i) => [s.trim(), i]));
    else fn(csv(text), header);
  };
  const unzip = new Unzip(entry => {
    if (entry.name !== file) return;
    entry.ondata = (error, chunk, final) => {
      if (error) { failure = error; return; }
      rest += decoder.decode(chunk, { stream: !final });
      let begin = 0, end: number;
      while ((end = rest.indexOf("\n", begin)) >= 0) { line(rest.slice(begin, end).replace(/\r$/, "")); begin = end + 1; }
      rest = rest.slice(begin);
      if (final && rest) { line(rest.replace(/\r$/, "")); rest = ""; }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < buf.length; offset += 65536) {
    unzip.push(buf.subarray(offset, offset + 65536), offset + 65536 >= buf.length);
    if (failure) throw failure;
    if (background && offset % 262144 === 0) await yieldWorker();
  }
  if (!header) throw Error(file + " vide");
}

export function createSchedule(railway = false) {
interface Route { code: string; name: string; type: number; color: string; text: string }
interface Stop { id: string; code: string; parent: string; name: string; lat: number; lon: number; lines: Set<string> }
interface Service { from: string; to: string; days: boolean[]; exceptions: Map<string, boolean> }
interface Trip { id: string; route: Route; service: Service; dest: string; num: string; direction: string; calls: Call[] }
interface Call { stop: Stop; seq: number; arr: number; dep: number; board: boolean; alight: boolean; dest: string }
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
let validity: string | undefined;




async function parse(buf: Uint8Array, background: boolean): Promise<Feed> {
  const entries = zipEntries(buf);
  const read = (file: string, fn: Parameters<typeof eachRow>[3]) => eachRow(buf, entries, file, fn, background);
  const services = new Map<string, Service>();
  const service = (id: string): Service => {
    const old = services.get(id);
    if (old) return old;
    const created = { from: "", to: "", days: [], exceptions: new Map<string, boolean>() };
    services.set(id, created);
    return created;
  };
  if (entries.has("calendar.txt")) await read("calendar.txt", (r, c) => {
    const s = service(r[c["service_id"]]);
    s.from = r[c["start_date"]];
    s.to = r[c["end_date"]];
    s.days = WEEK.map(day => r[c[day]] === "1");
  });
  if (entries.has("calendar_dates.txt")) await read("calendar_dates.txt", (r, c) => {
    service(r[c["service_id"]]).exceptions.set(r[c["date"]], r[c["exception_type"]] === "1");
  });

  const routes = new Map<string, Route>(), stopById = new Map<string, Stop>(), trips = new Map<string, Trip>();
  await read("routes.txt", (r, c) => {
    const id = r[c["route_id"]];
    routes.set(id, { code: railway ? "TER" : r[c["route_short_name"]] || id, name: r[c["route_long_name"]], type: Number(r[c["route_type"]]), color: r[c["route_color"]], text: r[c["route_text_color"]] });
  });
  await read("stops.txt", (r, c) => {
    const id = r[c["stop_id"]], lat = Number(r[c["stop_lat"]]), lon = Number(r[c["stop_lon"]]);
    if (railway && !id.startsWith("StopPoint:OCETrain TER-")) return;
    if (id && lat && lon && Number.isFinite(lat) && Number.isFinite(lon)) stopById.set(id, {
      id, code: r[c["stop_code"]] || id, parent: r[c["parent_station"]] || id.replace(/_\d+$/, ""),
      name: r[c["stop_name"]], lat, lon, lines: new Set()
    });
  });
  await read("trips.txt", (r, c) => {
    const id = r[c["trip_id"]], route = routes.get(r[c["route_id"]]), s = services.get(r[c["service_id"]]);
    if (route && s) trips.set(id, { id, route, service: s, dest: railway ? "" : r[c["trip_headsign"]], num: railway ? r[c["trip_headsign"]] : "", direction: r[c["direction_id"]], calls: [] });
  });
  let lookback = 1;
  await read("stop_times.txt", (r, c) => {
    const trip = trips.get(r[c["trip_id"]]), stop = stopById.get(r[c["stop_id"]]);
    if (!trip || !stop) return;
    const dep = seconds(r[c["departure_time"]] || r[c["arrival_time"]] || "");
    const arr = seconds(r[c["arrival_time"]] || r[c["departure_time"]] || "");
    if (!Number.isFinite(dep) || !Number.isFinite(arr)) return;
    trip.calls.push({ stop, seq: Number(r[c["stop_sequence"]]), arr, dep, board: r[c["pickup_type"]] !== "1", alight: r[c["drop_off_type"]] !== "1", dest: r[c["stop_headsign"]] });
    stop.lines.add(trip.route.code);
    lookback = Math.max(lookback, Math.floor(dep / 86400));
  });

  const byStop = new Map<Stop, Visit[]>();
  const counts = new Map<string, Map<string, { variant: LineRoute; count: number }>>();
  let processed = 0;
  for (const [id, trip] of trips) {
    if (background && ++processed % 512 === 0) await yieldWorker();
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

const days = (at: number, lookback: number, ahead: number) =>
  Array.from({ length: lookback + ahead + 1 }, (_, i) => {
    const date = serviceDay(ymd(at), i - lookback);
    return { date, dow: daytime(date).getUTCDay(), base: dayBase(date) };
  });

function scheduledVisits(refs: string[], at: number, limit: number): WidgetVisit[] {
  const f = feed;
  if (!f) return [];
  const dates = days(at, f.lookback, 1), stops = new Set(refs.flatMap(ref => f.aliases.get(ref) ?? []));
  const out: WidgetVisit[] = [];
  for (const stop of stops) for (const { trip, call } of f.byStop.get(stop) ?? []) for (const d of dates) {
    const time = d.base + call.dep * 1000;
    if (time >= at && time < at + DAY && isActive(trip.service, d)) {
      out.push({ time, line: trip.route.code, dest: call.dest || trip.dest, rt: false, stopName: stop.name, num: trip.num, route: trip.route.name });
    }
  }
  return out.sort((a, b) => a.time - b.time).slice(0, limit);
}

function scheduledNearby(lat: number, lon: number, at: number): { name: string; dist: number; visits: WidgetVisit[] } | null {
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
const scheduledStops = () => ({ StopPointsDelivery: { AnnotatedStopPointRef: feed?.stops ?? [] } });
const scheduledLines = () => ({ lines: [...(feed?.routes.values() ?? [])].map(r => ({
  LineRef: r.code, PublishedLineName: r.code, LineName: r.name, RouteType: r.type, RouteColor: r.color, RouteTextColor: r.text
})) });
const scheduledLineRoute = (line: string): { main: LineRoute[]; other: LineRoute[] } => feed?.variants.get(line) ?? { main: [], other: [] };
const scheduledDepartures = (ref: string, at: number): SiriStopMonitoring => ({
  ServiceDelivery: { StopMonitoringDelivery: [{ MonitoredStopVisit: scheduledVisits([ref], at, 120).map(v => ({
    MonitoredVehicleJourney: { PublishedLineName: v.line, DestinationName: v.dest,
      MonitoredCall: { AimedDepartureTime: new Date(v.time).toISOString() } }
  })) }] }
});
const scheduledQuayLines = () => Object.fromEntries((feed?.stops ?? []).map(s => [s.StopPointRef, s.Lines ?? []]));
const scheduledQuayModes = () => {
  const modes = new Map([...(feed?.routes.values() ?? [])].map(r => [r.code, isTram(r) ? "tram" : "bus"]));
  return Object.fromEntries((feed?.stops ?? []).map(s => [s.StopPointRef, (s.Lines ?? []).some(l => modes.get(String(l)) === "tram") ? "tram" : "bus"]));
};

let courseCache: { feed: Feed; at: number; horizon: number; back: number; courses: Course[] } | null = null;
/** Courses en cours ou à venir ; `back` : jusqu'à quand une course terminée reste dans la liste (attente au terminus) */
function scheduledCourses(now: number, horizon = 2 * HOUR, back = 60_000): { courses: Course[]; stopPos: Feed["positions"] } | null {
  const f = feed;
  if (!f) return null;
  if (courseCache?.feed === f && courseCache.horizon === horizon && courseCache.back === back && Math.abs(now - courseCache.at) < 15_000) return { courses: courseCache.courses, stopPos: f.positions };
  const out: Course[] = [], dates = days(now, f.lookback, 1);
  for (const trip of f.trips.values()) for (const d of dates) {
    const first = d.base + trip.calls[0].dep * 1000, last = d.base + trip.calls.at(-1)!.arr * 1000;
    if (first > now + horizon || last < now - back || !isActive(trip.service, d)) continue;
    out.push({
      id: `gtfs:${d.date}:${trip.id}`, line: trip.route.code, dest: trip.dest, mode: isTram(trip.route) ? "tram" : trip.route.type === 2 || trip.route.type >= 100 && trip.route.type < 200 ? "rail" : "bus",
      realTime: false, aimed: first, dir: trip.direction, ...(trip.num ? { num: trip.num } : {}),
      calls: trip.calls.map(c => ({ code: c.stop.id, name: c.stop.name, arr: d.base + c.arr * 1000, dep: d.base + c.dep * 1000, board: c.board, alight: c.alight }))
    });
  }
  courseCache = { feed: f, at: now, horizon, back, courses: out };
  return { courses: out, stopPos: f.positions };
}


function validUntil(): string {
  if (validity !== undefined) return validity;
  let end = "";
  const services = new Set<Service>();
  for (const trip of feed?.trips.values() ?? []) services.add(trip.service);
  for (const service of services) {
    if (service.to > end) end = service.to;
    for (const [date, active] of service.exceptions) if (active && date > end) end = date;
  }
  return validity = end;
}

return { load: async (bytes: Uint8Array, background = false) => { feed = await parse(bytes, background); validity = undefined; courseCache = null; }, validUntil, scheduledStops, scheduledLines, scheduledDepartures, scheduledLineRoute, scheduledQuayLines, scheduledQuayModes, scheduledVisits, scheduledCourses, scheduledNearby };
}
