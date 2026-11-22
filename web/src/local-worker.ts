/** GTFS parsing and queries stay off the UI thread. ZIP reads are from the app’s local WebView origin. */
import { planLocal } from "./local-planner";
import { createSchedule } from "./local-schedule";
import { buildChains, vehiclesAt } from "./local-vehicles";
import type { LocalCourse } from "./local-vehicles";
const feeds = { cts: createSchedule(), ter: createSchedule(true) };
type Source = keyof typeof feeds;
interface Saved { bytes: Uint8Array; checked: number; etag?: string; modified?: string; revision: string }
const state: Partial<Record<Source, Saved>> = {};
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("kumm-gtfs", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("feeds");
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
async function stored(source: Source, value?: Saved): Promise<Saved | undefined> {
  const d = await db();
  try { return await new Promise((resolve, reject) => {
    const t = d.transaction("feeds", value ? "readwrite" : "readonly");
    const r = value ? t.objectStore("feeds").put(value, source) : t.objectStore("feeds").get(source);
    t.oncomplete = () => resolve(value ?? r.result); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  }); } finally { d.close(); }
}
const ready = Promise.all((Object.keys(feeds) as Source[]).map(async s => {
  const v = await stored(s); if (v) { try { await feeds[s].load(v.bytes); state[s] = v; } catch (e) { console.warn("Archive locale illisible", s, e); } }
}));
const chainCache = new WeakMap<object, Map<string, LocalCourse>>();
const uic = (id: string): string => id.match(/\d{8}/)?.[0] ?? id;
async function request(path: string): Promise<unknown> {
  const u = new URL(path, "https://localhost"), p = u.pathname.replace(/^\/api/, ""), q = u.searchParams;
  const c = feeds.cts, t = feeds.ter, at = Number(q.get("at")) || Date.now();
  if (p === "/geo/transit") {
    const point = (v: string | null) => { const [lat, lon] = (v ?? "").split(",").map(Number); if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw Error("Coordonnées invalides"); return { lat, lon }; };
    const time = Date.parse(q.get("time") ?? "") || at, arrive = q.get("arrive") === "1";
    if (q.get("stepfree") === "1") throw Error("Accessibilité des correspondances non vérifiée dans les données locales");
    const base = arrive ? time - 86400000 : time;
    const a = c.scheduledCourses(base, 86400000), b = t.scheduledCourses(base, 86400000);
    const courses = [...(a?.courses ?? []), ...(b?.courses ?? [])];
    const positions = new Map([...(a?.stopPos ?? []), ...(b?.stopPos ?? [])]);
    return planLocal(courses, positions, point(q.get("from")), point(q.get("to")), time, arrive);
  }
  if (p === "/vehicles") {
    // Positions théoriques calculées sur le téléphone : CTS (avec la fin des courses récentes, pour l'attente au terminus) et TER.
    const now = Date.now();
    const a = c.scheduledCourses(now, 2 * 3600_000, 40 * 60_000), b = t.scheduledCourses(now, 30 * 60_000);
    const courses = [...(a?.courses ?? []), ...(b?.courses ?? []).map(x => ({ ...x, line: "TER", mode: "ter" }))] as LocalCourse[];
    let chains = chainCache.get(a?.courses ?? []);
    if (!chains) { chains = buildChains((a?.courses ?? []) as LocalCourse[]); chainCache.set(a?.courses ?? [], chains); }
    const positions = new Map([...(a?.stopPos ?? []), ...(b?.stopPos ?? [])]);
    return { now, at: null, vehicles: vehiclesAt(now, courses, positions, chains) };
  }
  if (p === "/gtfs/stops") return c.scheduledStops();
  if (p === "/gtfs/lines") return c.scheduledLines();
  if (p === "/gtfs/departures") {
    if (!state.cts) throw Error("Horaires CTS indisponibles sur cet appareil.");
    return c.scheduledDepartures(q.get("MonitoringRef") ?? "", at);
  }
  if (p === "/quay-lines") return c.scheduledQuayLines();
  if (p === "/quay-modes") return c.scheduledQuayModes();
  if (p === "/line-route") return c.scheduledLineRoute(q.get("line") ?? "");
  const stations = t.scheduledStops().StopPointsDelivery.AnnotatedStopPointRef;
  if (p === "/ter-stations") return { items: [...new Map(stations.map(s => [uic(s.StopPointRef), { uic: uic(s.StopPointRef), name: s.StopName, lat: s.Location!.Latitude, lon: s.Location!.Longitude }])).values()] };
  if (p === "/trains") {
    if (!state.ter) throw Error("Données TER non téléchargées");
    const refs = stations.filter(s => uic(s.StopPointRef) === q.get("gare")).map(s => s.StopPointRef);
    return { trains: t.scheduledVisits(refs, at, 120).map(v => ({ t: v.time, dest: v.dest, aim: v.time, num: v.num, route: v.route })) };
  }
  if (p === "/geo/stoptimes") {
    const when = Date.parse(q.get("time") ?? "") || at;
    return { stopTimes: c.scheduledVisits([q.get("stop") ?? ""], when, 80).map(v => ({ routeShortName: v.line, headsign: v.dest, place: { scheduledDeparture: new Date(v.time).toISOString() } })) };
  }
  throw Error("Bientôt disponible");
}
self.onmessage = async (e: MessageEvent) => {
  const { id, method, source, value, path, archiveUrl } = e.data;
  try {
    await ready;
    let result: unknown;
    if (method === "status") result = Object.fromEntries(Object.entries(state).map(([k, v]) => [k, { checked: v.checked, revision: v.revision, etag: v.etag, modified: v.modified, validUntil: feeds[k as Source].validUntil(), expired: feeds[k as Source].validUntil() < new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "") }]));
    else if (method === "save") {
      // Parse a separate instance first; neither the persisted archive nor live queries change on failure.
      let bytes: Uint8Array = value.bytes;
      if (archiveUrl) {
        const response = await fetch(archiveUrl);
        if (!response.ok) throw Error("Archive locale indisponible (HTTP " + response.status + ")");
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      const next = createSchedule(source === "ter");
      await next.load(bytes, Boolean(state.cts || state.ter));
      const saved = { ...value, bytes };
      await stored(source, saved); feeds[source as Source] = next; state[source as Source] = saved; result = true;
    } else if (method === "checked") {
      const old = state[source as Source];
      if (!old) throw Error("Réponse 304 sans copie locale");
      const next = { ...old, checked: e.data.checked }; await stored(source, next); state[source as Source] = next; result = true;
    } else result = await request(path);
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
