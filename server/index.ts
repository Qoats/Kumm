// Serveur Kumm : sert l'application et relaie les services (CTS, adresses, marche, trajets, parkings, vélos, tuiles)
// en gardant le jeton CTS côté serveur. Conçu pour un usage public : limites, cache borné, compression, arrêt propre.
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AUTH, BASE, CTS_LIVE, CTS_TRAFFIC, CACHE_MAX, CTS_BUDGET_PER_MIN, ENABLE_DIAG, LIMIT, MIN_APP_VERSION, ORIGINS, PORT, REQUESTOR, ROOT, STALE_REALTIME_S, TILE_LIMIT, TOKEN, UNKNOWN_REF_PER_MIN, VALIDATE_STOP_REFS, VERSION } from "./config.js";
import { cacheGet, cacheSet, cacheSize, cacheStats, cacheSweep } from "./cache.js";
import { ctsCallsLastMinute, ctsPaused, describeError, fetchCts, fetchRetry } from "./cts.js";
import { diag } from "./diag.js";
import { GEO_USER_AGENT, geoUpstream } from "./geo.js";
import { reqOf, securityHeaders, send } from "./http.js";
import { clientIp, withinLimit } from "./limit.js";
import { parkingsRelais, poiResult, velhop } from "./poi.js";
import { recordRequest, stats } from "./stats.js";
import { serveStatic } from "./static.js";
import { serveUpdate, updateStatus } from "./updates.js";
import { WEB_PRIVATE, allowed, loginRoute, logoutRoute } from "./access.js";
import { serveTile } from "./tiles.js";
import { parseGeneralMessages } from "./messages.js";
import { allCourses, vehiclesAt } from "./vehicles.js";
import { followedStations, isFollowedStation, startTer, terStatus, trainDepartures } from "./ter.js";
import { roadStatus } from "./roads.js";
import { widgetData } from "./widgets.js";
import { stallStatus } from "./stalls.js";
import { lineRoutes, routesStatus } from "./routes.js";
import { arrivalsStatus, startArrivals, watchArrival } from "./arrivals.js";
import { loadSchedule, scheduleStatus, scheduledDepartures, scheduledLineRoute, scheduledLines, scheduledQuayLines, scheduledQuayModes, scheduledStops, scheduledVisits, scheduleReady, startSchedule } from "./schedule.js";
import { bikeForecast, bikesStatus, startBikes } from "./bikes.js";
import { earlyStatus } from "./early.js";
import { receiveReport, reportsFor, reportsStatus } from "./reports.js";
import { driftStatus } from "./drift.js";
import { parkForecast, parksStatus, startParks } from "./parks.js";
import { punctualityStatus, stats as punctualityStats } from "./punctuality.js";
import { observationStatus } from "./observations.js";
import { tripAt, tripById } from "./trips.js";
import { alertsStatus, startAlerts, subscribe } from "./alerts.js";
import type { TrafficMessage } from "./messages.js";
import { quayLinesJson, quayModesJson, realtimeStatus, setStopIndex, startRealtime, stopMonitoringFromSnapshot } from "./realtime.js";
import { receiveRide, rideStatus } from "./ride.js";
import type { CtsResult } from "./cts.js";

if (CTS_LIVE && !TOKEN) {
  console.error("CTS_TOKEN manquant : copiez .env.example en .env et renseignez-le (ou définissez la variable chez votre hébergeur).");
  process.exit(1);
}

/** Services CTS relayés : durée de cache et durée de service en secours, en secondes */
const ALLOWED: Record<string, { ttl: number; stale: number }> = {
  "stop-monitoring":      { ttl: 20,   stale: STALE_REALTIME_S },   // passages en direct : jamais périmés bien longtemps
  "estimated-timetable":  { ttl: 30,   stale: STALE_REALTIME_S },
  "general-message":      { ttl: 60,   stale: 600 },
  "stoppoints-discovery": { ttl: 3600, stale: 86400 },
  "lines-discovery":      { ttl: 3600, stale: 86400 },
  "park-and-ride":        { ttl: 60,   stale: 600 },
  "veloparc":             { ttl: 3600, stale: 86400 },
  "retail-outlet":        { ttl: 3600, stale: 86400 }
};

/** Les services « SIRI » sont sous /v1/siri/2.0 ; les autres (P+R, vélo, points de vente) sont cherchés d'abord sous /v1 */
const SIRI_ONLY = new Set(["stop-monitoring", "stoppoints-discovery", "lines-discovery", "general-message", "estimated-timetable"]);
const REF = /^[A-Za-z0-9_.\-]{1,60}$/;

/** Tuiles : une page d'un autre site (que le navigateur signale dans Referer) ne peut pas s'en servir comme fournisseur gratuit.
   Sans Referer (navigateur qui le masque), on accepte : la limite par adresse s'applique toujours. */
export function tileRefererAllowed(req: IncomingMessage): boolean {
  const ref = req.headers.referer;
  if (!ref) return true;
  let origin: string, host: string;
  try { const u = new URL(ref); origin = u.origin; host = u.host; } catch { return false; }
  return host === req.headers.host || ORIGINS.includes(origin);
}

/** Ajoute RequestorRef aux demandes SIRI s'il manque */
export function withRequestor(search: string): string {
  const q = new URLSearchParams(search);
  if (!q.has("RequestorRef")) q.set("RequestorRef", REQUESTOR);
  return "?" + q.toString();
}

/** Ne transmet à la CTS que les paramètres prévus : un visiteur ne peut ni en inventer ni remplir le cache d'adresses arbitraires */
export function cleanQuery(name: string, url: URL): string | null {
  if (name === "stop-monitoring") {
    const refs = url.searchParams.getAll("MonitoringRef");
    if (refs.length !== 1 || !REF.test(refs[0])) return null;
    return "?MonitoringRef=" + encodeURIComponent(refs[0]);
  }
  return "";
}

/** Fin de validité d'une réponse : « ValidUntil » de la CTS si présent (entre 5 s et 1 h), sinon la durée par défaut */
export function expiry(body: string, ttl: number, now = Date.now()): number {
  const m = /"ValidUntil"\s*:\s*"([^"]+)"/.exec(body);
  const t = m ? Date.parse(m[1]) : NaN;
  if (Number.isNaN(t)) return now + ttl * 1000;
  return Math.min(Math.max(t, now + 5000), now + 3600_000);
}

const inflight = new Map<string, Promise<CtsResult>>();

/* ---------- arrêts connus : on ne laisse pas un visiteur parcourir des milliers de codes inventés ---------- */
let knownRefs: Set<string> | null = null;

/** Tous les codes valables pour interroger un arrêt : codes de quai, codes sans suffixe (LAMEY_01 → LAMEY) et codes « logiques » */
export function extractRefs(body: string): Set<string> | null {
  try {
    const list = (JSON.parse(body) as { StopPointsDelivery?: { AnnotatedStopPointRef?: unknown[] } }).StopPointsDelivery?.AnnotatedStopPointRef ?? [];
    const set = new Set<string>();
    const scan = (o: unknown, depth: number): void => {
      if (depth > 2 || typeof o !== "object" || o === null) return;
      for (const [k, v] of Object.entries(o)) {
        if (/logical.?stop.?code|^stop.?code$/i.test(k) && typeof v === "string" && v) set.add(v);
        else scan(v, depth + 1);
      }
    };
    for (const s of list) {
      if (typeof s !== "object" || s === null) continue;
      const ref = (s as Record<string, unknown>)["StopPointRef"];
      if (typeof ref === "string" && ref) { set.add(ref); set.add(ref.replace(/_\d+$/, "")); }
      scan(s, 0);
    }
    return set.size ? set : null;
  } catch { return null; }
}

let unknownWindow = { n: 0, reset: 0 };
function unknownRefAllowed(): boolean {
  if (UNKNOWN_REF_PER_MIN <= 0) return true;
  const now = Date.now();
  if (now > unknownWindow.reset) unknownWindow = { n: 0, reset: now + 60_000 };
  return ++unknownWindow.n <= UNKNOWN_REF_PER_MIN;
}

/** Réponse avec cache, une seule requête sortante par clé, et dernière réponse connue en cas de panne (dans la limite de son âge) */
async function cached(res: ServerResponse, key: string, ttl: number, staleS: number, fetcher: () => Promise<CtsResult>, store = true): Promise<void> {
  const hit = store ? cacheGet(key) : undefined;
  if (hit && hit.exp > Date.now()) { cacheStats.hits++; return send(res, 200, hit.type, hit.body, "HIT", { memo: hit.memo }); }
  cacheStats.misses++;
  const usable = hit && Date.now() < hit.exp + hit.staleMs ? hit : undefined;
  const serveStale = (): Promise<void> => { cacheStats.stale++; return send(res, 200, usable!.type, usable!.body, "STALE", { memo: usable!.memo }); };

  // si 50 personnes demandent la même chose en même temps, un seul appel part vers le service
  let p = inflight.get(key);
  if (!p) {
    p = fetcher().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  try {
    const r = await p;
    if (r.status === 200) {
      const e = { body: r.body, type: r.type, exp: expiry(r.body, ttl), staleMs: staleS * 1000, memo: {} };
      if (store) cacheSet(key, e);
      return send(res, 200, r.type, r.body, "MISS", { memo: e.memo });
    }
    console.warn("Service externe", r.status, key.split("?")[0].slice(-60));
    if (usable) return serveStale();
    return send(res, r.status, r.type, r.body, "MISS");
  } catch (e) {
    const why = describeError(e);
    if (usable) return serveStale();
    return send(res, why.includes("saturé") || why.includes("budget") ? 503 : 502, "text/plain", "Service injoignable : " + why);
  }
}

function upstreamFor(name: string, search: string): () => Promise<CtsResult> {
  return SIRI_ONLY.has(name)
    ? () => fetchCts(BASE, AUTH, name, search)
    : async () => {
        const r = await fetchCts(ROOT, AUTH, name, search);
        return r.status === 404 ? fetchCts(BASE, AUTH, name, search) : r;
      };
}

async function api(res: ServerResponse, url: URL): Promise<void> {
  const name = url.pathname.slice("/api/".length);
  if (name.startsWith("gtfs/")) {
    if (!scheduleReady()) await loadSchedule();
    if (!scheduleReady()) return send(res, 503, "text/plain", "Horaires théoriques CTS momentanément indisponibles");
    const ref = url.searchParams.get("MonitoringRef") ?? "";
    const body = name === "gtfs/stops" ? scheduledStops() : name === "gtfs/lines" ? scheduledLines()
      : name === "gtfs/departures" && REF.test(ref) ? scheduledDepartures(ref, Date.now() - 30_000) : null;
    if (!body) return send(res, 400, "text/plain", "Paramètres invalides");
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ...body, source: "gtfs" }), undefined,
      { cache: name === "gtfs/departures" ? "no-store" : "public, max-age=300" });
  }
  if (name === "messages" && !CTS_TRAFFIC) return send(res, 200, "application/json", JSON.stringify({ items: [], available: false, message: "Prochainement disponible" }), undefined, { cache: "no-store" });
  if (name === "messages") return cached(res, "info:messages", 60, 3600, trafficMessages);
  // widgets Android (écran d'accueil) : réponses courtes depuis la mémoire, gardées 20 à 60 s
  if (name === "widget/traffic" && !CTS_TRAFFIC) return send(res, 503, "text/plain", "Prochainement disponible");
  if (name.startsWith("widget/")) {
    const w = name.slice("widget/".length), ttl = w === "traffic" || w === "poi" ? 60 : 20;
    return cached(res, "widget:" + w + url.search, ttl, 0, () => widgetData(w, url, currentMessages, async kind => (kind === "velhop" ? velhopItems() : prItems())));
  }
  // position estimée des véhicules, depuis la photo du réseau en mémoire : recalculée au plus toutes les 5 s
  // mode des quais (tram ou bus) : place le repère d'une station de tram sur ses quais de tram, pas entre le tram et les bus
  if (name === "quay-lines") return send(res, 200, "application/json; charset=utf-8", JSON.stringify(CTS_LIVE ? quayLinesJson() : scheduledQuayLines()), undefined, { cache: "public, max-age=600" });
  if (name === "quay-modes") return send(res, 200, "application/json; charset=utf-8", JSON.stringify(CTS_LIVE ? quayModesJson() : scheduledQuayModes()), undefined, { cache: "public, max-age=600" });
  // départs des trains d'une gare de l'Eurométropole (horaires SNCF recalés en temps réel), recalculés au plus toutes les 20 s
  // gares TER suivies (Eurométropole, lignes de Lauterbourg et de Paris, tout le Grand Est) : fiches de l'application
  if (name === "ter-stations") return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ items: followedStations() }), undefined, { cache: "public, max-age=3600" });
  if (name === "trains") {
    const uic = url.searchParams.get("gare") ?? "";
    if (!isFollowedStation(uic)) return send(res, 404, "text/plain", "Gare inconnue");
    return cached(res, "info:trains:" + uic, 20, 0, async () => ({ status: 200, type: "application/json; charset=utf-8", body: JSON.stringify({ now: Date.now(), trains: trainDepartures(uic) }) }));
  }
  // trajet suivi pendant une navigation : la course d'un véhicule, ou la prochaine qui passe à un arrêt
  if (name === "trip") {
    const q = (k: string): string => url.searchParams.get(k) ?? "";
    const id = q("id"), stop = q("stop"), line = q("line"), dest = q("dest"), to = q("to"), after = Number(q("after")) || 0;
    const ok = (s: string): boolean => s.length > 0 && s.length <= 120;
    if (!(ok(id) || (ok(stop) && ok(line) && dest.length <= 120 && to.length <= 120))) return send(res, 400, "text/plain", "Paramètres invalides");
    const pt = (la: string, lo: string): { lat: number; lon: number } | undefined => {
      const lat = Number(q(la)), lon = Number(q(lo));
      return Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 ? { lat, lon } : undefined;
    };
    const t = id ? tripById(id) : tripAt(stop, line, dest, to, after, pt("lat", "lon"), pt("tolat", "tolon"));
    return send(res, t ? 200 : 404, "application/json; charset=utf-8", JSON.stringify(t ?? { error: "Trajet introuvable" }), undefined, { cache: "no-store" });
  }
  // arrêts d'une ligne dans l'ordre, pour chaque sens (appris des courses de la CTS)
  if (name === "line-route") {
    const line = url.searchParams.get("line") ?? "";
    if (!/^[A-Za-z0-9]{1,6}$/.test(line)) return send(res, 400, "text/plain", "Ligne invalide");
    return cached(res, "info:line-route:" + line, 300, 0, async () => ({ status: 200, type: "application/json; charset=utf-8", body: JSON.stringify(CTS_LIVE ? lineRoutes(line) : scheduledLineRoute(line)) }));
  }
  if (name === "stats") {
    const line = url.searchParams.get("line");
    if (line !== null && !/^[A-Za-z0-9]{1,6}$/.test(line)) return send(res, 400, "text/plain", "Ligne invalide");
    return cached(res, "info:stats:" + (line ?? ""), 300, 0, async () => ({ status: 200, type: "application/json; charset=utf-8", body: JSON.stringify(punctualityStats(line)) }));
  }
  if (name === "vehicles") return cached(res, "info:vehicles", 5, 0, async () => ({ status: 200, type: "application/json; charset=utf-8", body: JSON.stringify(vehiclesAt()) }));
  const conf = ALLOWED[name];
  if (!Object.hasOwn(ALLOWED, name)) return send(res, 404, "text/plain", "Endpoint inconnu");
  const clean = cleanQuery(name, url);
  if (clean === null) return send(res, 400, "text/plain", "Paramètres invalides");
  if (!CTS_LIVE) return send(res, 503, "text/plain", "Temps réel CTS indisponible");
  if (name === "general-message" && !CTS_TRAFFIC) return send(res, 503, "text/plain", "Prochainement disponible");
  // passages en direct : d'abord la photo du réseau gardée en mémoire (aucun appel à la CTS)
  if (name === "stop-monitoring") {
    const fromSnapshot = stopMonitoringFromSnapshot(url.searchParams.get("MonitoringRef") ?? "");
    if (fromSnapshot) { stats.snapshotServed++; return send(res, 200, "application/json; charset=utf-8", fromSnapshot, "SNAPSHOT"); }
  }
  const search = withRequestor(clean);
  // arrêt absent de la liste officielle : toléré (au cas où elle serait incomplète) mais limité, et jamais gardé en mémoire
  let store = true;
  if (name === "stop-monitoring" && VALIDATE_STOP_REFS && knownRefs && !knownRefs.has(url.searchParams.get("MonitoringRef") ?? "")) {
    stats.unknownRefs++;
    if (!unknownRefAllowed()) { stats.unknownRefused++; return send(res, 404, "text/plain", "Arrêt inconnu"); }
    store = false;
  }
  return cached(res, name + search, conf.ttl, conf.stale, upstreamFor(name, search), store);
}

/** Infos trafic en cours, en texte brut (l'application n'a jamais à afficher le HTML de la CTS) */
async function trafficMessages(): Promise<CtsResult> {
  const r = await fetchCts(BASE, AUTH, "general-message", withRequestor(""));
  if (r.status !== 200) return r;
  return { status: 200, type: "application/json; charset=utf-8", body: JSON.stringify({ items: parseGeneralMessages(r.body) }) };
}

/** Infos trafic pour la surveillance des alertes (même source que /api/messages, gardée 55 s) */
let msgMemo: { at: number; items: TrafficMessage[] } = { at: 0, items: [] };
async function currentMessages(): Promise<TrafficMessage[]> {
  if (!CTS_TRAFFIC) return [];
  if (Date.now() - msgMemo.at < 55_000) return msgMemo.items;
  const r = await trafficMessages();
  if (r.status !== 200) throw new Error("HTTP " + r.status);
  msgMemo = { at: Date.now(), items: (JSON.parse(r.body) as { items: TrafficMessage[] }).items };
  return msgMemo.items;
}

/** P+R pour les widgets (gardés 2 min) */
let prMemo: { at: number; items: Awaited<ReturnType<typeof parkingsRelais>> } = { at: 0, items: [] };
async function prItems(): Promise<Awaited<ReturnType<typeof parkingsRelais>>> {
  if (Date.now() - prMemo.at < 120_000) return prMemo.items;
  prMemo = { at: Date.now(), items: await parkingsRelais() };
  return prMemo.items;
}

/** Vélhop pour les widgets (gardés 60 s : un widget par station ne déclenche pas un appel chacun) */
let veloMemo: { at: number; items: Awaited<ReturnType<typeof velhop>> } = { at: 0, items: [] };
async function velhopItems(): Promise<Awaited<ReturnType<typeof velhop>>> {
  if (Date.now() - veloMemo.at < 60_000) return veloMemo.items;
  veloMemo = { at: Date.now(), items: await velhop() };
  return veloMemo.items;
}

/** Corps d'une requête POST (4 Ko au plus) */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0; const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => { size += c.length; if (size > 4096) { reject(new Error("trop long")); req.destroy(); } else parts.push(c); });
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

/** Charge à l'avance la liste des arrêts et des lignes (gardées en mémoire), puis la renouvelle avant qu'elle n'expire */
/** Après un échec (CTS injoignable, jeton pas encore actif…), nouvel essai une minute plus tard plutôt qu'au prochain renouvellement (50 min) */
let prefetchRetry: NodeJS.Timeout | null = null;
async function prefetch(): Promise<void> {
  let failed = false;
  for (const name of ["stoppoints-discovery", "lines-discovery"]) {
    try {
      const conf = ALLOWED[name], search = withRequestor("");
      const r = await upstreamFor(name, search)();
      if (r.status !== 200) throw new Error("HTTP " + r.status);
      cacheSet(name + search, { body: r.body, type: r.type, exp: expiry(r.body, conf.ttl), staleMs: conf.stale * 1000, memo: {} });
      if (name === "stoppoints-discovery") {
        setStopIndex(r.body);
        const refs = extractRefs(r.body);
        if (refs) knownRefs = refs;
        console.log(`Liste des arrêts chargée : ${refs ? refs.size + " codes" : "forme non reconnue (aucun filtrage)"}`);
      }
    } catch (e) {
      console.warn("Préchargement impossible (" + name + ") :", describeError(e));
      failed = true;
    }
  }
  if (failed && !prefetchRetry) {
    prefetchRetry = setTimeout(() => { prefetchRetry = null; void prefetch(); }, 60_000);
    prefetchRetry.unref();
  }
}

function geo(res: ServerResponse, url: URL): Promise<void> | void {
  if (url.pathname === "/geo/stoptimes") {
    const ref = url.searchParams.get("stop") ?? "", at = Date.parse(url.searchParams.get("time") ?? "");
    if (!REF.test(ref) || !Number.isFinite(at)) return send(res, 400, "text/plain", "Paramètres invalides");
    if (!scheduleReady()) return send(res, 503, "text/plain", "Horaires théoriques CTS momentanément indisponibles");
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ source: "gtfs", stopTimes: scheduledVisits([ref], at, 80).map(v => ({
      routeShortName: v.line, headsign: v.dest, place: { scheduledDeparture: new Date(v.time).toISOString() }
    })) }), undefined, { cache: "no-store" });
  }
  const g = geoUpstream(url);
  if (!g) return send(res, 400, "text/plain", "Paramètres invalides");
  return cached(res, g.url, g.ttl, g.stale, () => fetchRetry(g.url, { "User-Agent": GEO_USER_AGENT, Accept: "application/json" }));
}

/** État du service, pour la supervision (aucun secret, aucune donnée de visiteur) */
function health(res: ServerResponse): Promise<void> {
  const paused = ctsPaused();
  const body = JSON.stringify({
    ok: true, version: VERSION, minApp: MIN_APP_VERSION,
    uptime_s: Math.round((Date.now() - stats.started) / 1000),
    cache: { entrees: cacheSize(), max: CACHE_MAX, hits: cacheStats.hits, miss: cacheStats.misses, secours: cacheStats.stale, evinces: cacheStats.evicted },
    cts: { en_pause: paused.paused, secondes: paused.paused ? paused.seconds : 0, appels_derniere_minute: ctsCallsLastMinute(), plafond_par_minute: CTS_BUDGET_PER_MIN, refuses_plafond: stats.budgetRefused, arrets_connus: knownRefs?.size ?? null, arrets_inconnus_demandes: stats.unknownRefs, arrets_inconnus_refuses: stats.unknownRefused },
    reseau_en_memoire: { ...realtimeStatus(), arrets_servis_depuis_la_memoire: stats.snapshotServed },
    alertes: alertsStatus(),
    alertes_passage: arrivalsStatus(),
    horaires_cts: scheduleStatus(),
    ponctualite: punctualityStatus(),
    prevision_velhop: bikesStatus(),
    departs_en_avance: earlyStatus(),
    recalages: driftStatus(),
    signalements: reportsStatus(),
    prevision_pr: parksStatus(),
    apk: updateStatus(),
    trajets_partages: rideStatus(),
    trains_ter: terStatus(),
    trajets_routiers: roadStatus(),
    vehicules_immobilises: stallStatus(),
    parcours_lignes: routesStatus(),
    observations_trajets: observationStatus(),
    acces_web_prive: WEB_PRIVATE,
    requetes: { total: stats.requests, refusees_429: stats.limited, erreurs_5xx: stats.errors5xx, lentes: stats.slow, erreurs_services: stats.upstreamErrors }
  });
  res.setHeader("Cache-Control", "no-store");
  return send(res, 200, "application/json", body);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const started = Date.now();
  reqOf.set(res, req);
  let pathOnly = "?";
  res.on("finish", () => {
    const ms = Date.now() - started;
    recordRequest(res.statusCode, ms);
    // journal sans donnée personnelle : seulement la méthode, le chemin (jamais la requête : elle contient adresses et positions), le statut et la durée
    if (res.statusCode >= 500 || ms > 3000) console.warn(`${req.method} ${pathOnly} ${res.statusCode} ${ms} ms`);
  });

  let url: URL;
  try { url = new URL(req.url ?? "/", "http://localhost"); } catch { return send(res, 400, "text/plain", "Adresse invalide"); }
  pathOnly = url.pathname.slice(0, 80);

  securityHeaders(req, res);
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Kumm-Device", "Access-Control-Max-Age": "86400" }); return void res.end(); }
  // seule écriture possible : l'abonnement aux alertes trafic
  const isPost = req.method === "POST" && (url.pathname === "/api/alerts" || url.pathname === "/api/ride" || url.pathname === "/api/arrival" || url.pathname === "/api/report" || url.pathname === "/connexion");
  if (req.method !== "GET" && req.method !== "HEAD" && !isPost) return send(res, 405, "text/plain", "Méthode non autorisée");

  const p = url.pathname;
  if (p === "/health") return health(res);
  if (p === "/api/kumm-mode") return send(res, 200, "application/json",
    JSON.stringify({ protocol: 1, cts: CTS_LIVE ? "live" : "scheduled", traffic: CTS_TRAFFIC, private: WEB_PRIVATE }),
    undefined, { cache: "no-store" });
  // La bêta privée exige une session.
  if (p === "/connexion") return loginRoute(req, res, readBody);
  if (p === "/deconnexion") return logoutRoute(res);
  if (!allowed(req, res, p)) return;

  const isTile = p.startsWith("/tiles/");
  const isService = p.startsWith("/api/") || p.startsWith("/geo/") || p.startsWith("/poi/");
  if ((isTile && !withinLimit(req, "tiles", TILE_LIMIT)) || (isService && !withinLimit(req, "api", LIMIT))) {
    res.writeHead(429, { "Content-Type": "text/plain", "Retry-After": "60" });
    return void res.end("Trop de requêtes : réessayez dans une minute");
  }

  if (isPost) {
    let body: unknown;
    try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, "text/plain", "Requête invalide"); }
    if (url.pathname === "/api/report") {
      const r = receiveReport(body, clientIp(req));
      return send(res, r.status, "application/json; charset=utf-8", JSON.stringify({ ok: r.status === 200, message: r.msg }));
    }
    if (url.pathname === "/api/arrival") {
      if (!CTS_LIVE && (body as { enabled?: boolean } | null)?.enabled !== false) return send(res, 503, "text/plain", "Alertes de passage CTS indisponibles");
      const r = watchArrival(body);
      return send(res, r.status, "application/json; charset=utf-8", JSON.stringify({ ok: r.status === 200, message: r.msg }));
    }
    if (url.pathname === "/api/ride") {
      // position partagée par un voyageur à bord (voir ride.ts)
      const all = allCourses();
      const observed = all.courses.filter(c => !c.id.startsWith("gtfs:"));
      const r = observed.length ? receiveRide(body, observed, all.stopPos) : { status: 503, msg: "Réseau indisponible" };
      return send(res, r.status, "application/json; charset=utf-8", JSON.stringify({ ok: r.status === 200, message: r.msg }));
    }
    if (!CTS_TRAFFIC && (body as { enabled?: boolean } | null)?.enabled !== false) return send(res, 503, "text/plain", "Prochainement disponible");
    const r = subscribe(body);
    return send(res, r.status, "application/json; charset=utf-8", JSON.stringify({ ok: r.status === 200, message: r.msg }));
  }
  // signalements d'un arrêt : propres à chaque appareil (les siens, même non confirmés), donc jamais en cache
  if (p === "/api/reports") return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ items: reportsFor((url.searchParams.get("stop") ?? "").slice(0, 40), (typeof req.headers["x-kumm-device"] === "string" ? req.headers["x-kumm-device"] : "").slice(0, 64)) }), undefined, { cache: "private, no-store" });
  if (p.startsWith("/api/")) return api(res, url);
  if (p.startsWith("/geo/")) return geo(res, url);
  if (p === "/poi/velhop") return cached(res, "poi:velhop", 60, 600, async () => poiResult(await velhop()));
  if (p === "/poi/velhop-forecast") {
    const id = (url.searchParams.get("id") ?? "").slice(0, 60);
    if (!/^(velhop-)?[\w-]+$/.test(id)) return send(res, 400, "text/plain", "Station inconnue");
    const f = bikeForecast(id);
    return f ? send(res, 200, "application/json; charset=utf-8", JSON.stringify(f)) : send(res, 404, "text/plain", "Station inconnue");
  }
  if (p === "/poi/pr-forecast") {
    const f = parkForecast((url.searchParams.get("id") ?? "").slice(0, 40));
    return f ? send(res, 200, "application/json; charset=utf-8", JSON.stringify(f)) : send(res, 404, "text/plain", "Parking inconnu");
  }
  if (p === "/poi/pr") return cached(res, "poi:pr", 120, 3600, async () => poiResult(await parkingsRelais()));
  if (isTile) {
    if (!tileRefererAllowed(req)) { res.writeHead(403, { "Content-Type": "text/plain" }); return void res.end("Tuiles réservées à l'application"); }
    return serveTile(res, p);
  }
  if (p === "/app/latest.json" || p === "/app/kumm.apk") return serveUpdate(req, res, p);
  if (p === "/diag" && ENABLE_DIAG) return diag(res);
  return serveStatic(res, p);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    console.error("Erreur inattendue :", e instanceof Error ? e.message : e);
    try { if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" }); res.end("Erreur du serveur"); } catch { /* client parti */ }
  });
});
// délais prudents (un client lent ou malveillant ne doit pas garder des connexions ouvertes indéfiniment)
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;

setInterval(() => { cacheSweep(); }, 5 * 60_000).unref();
setInterval(() => {
  console.log(`Bilan : ${stats.requests} requêtes, ${stats.limited} refusées (429), ${stats.errors5xx} erreurs 5xx, cache ${cacheSize()}/${CACHE_MAX} (${cacheStats.hits} hits, ${cacheStats.misses} miss, ${cacheStats.stale} en secours)`);
}, 15 * 60_000).unref();

/* arrêt propre : l'hébergeur envoie SIGTERM lors d'une mise à jour ; on termine les requêtes en cours */
function shutdown(signal: string): void {
  console.log(`${signal} reçu : arrêt en cours…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", r => console.error("Promesse rejetée :", r instanceof Error ? r.message : r));
process.on("uncaughtException", e => { console.error("Erreur fatale :", e.message); process.exit(1); });

server.listen(PORT, () => {
  console.log(`Kumm ${VERSION} : http://localhost:${PORT}`);
  if (CTS_LIVE) {
    void prefetch();
    startRealtime();
    setInterval(() => { void prefetch(); }, 50 * 60_000).unref();
  }
  startSchedule();
  startTer();
  if (CTS_TRAFFIC) startAlerts(currentMessages);
  if (CTS_LIVE) startArrivals();
  startBikes();
  startParks();
});
