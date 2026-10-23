/** Relais vers les services d'adresses (BAN) et de marche à pied (OSRM, profil « foot »). */

const ADDR = process.env.GEO_ADDRESS_BASE ?? "https://api-adresse.data.gouv.fr/search/";
const WALK = process.env.GEO_WALK_BASE ?? "https://routing.openstreetmap.de/routed-foot/route/v1/foot";
const BIKE = process.env.GEO_BIKE_BASE ?? "https://routing.openstreetmap.de/routed-bike/route/v1/bike";
export const TRANSIT = process.env.TRANSIT_BASE ?? "https://api.transitous.org/api/v5/plan";
export const GEO_USER_AGENT = process.env.GEO_USER_AGENT ?? "Kumm/0.8";

const LATLON = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export interface GeoUpstream { url: string; ttl: number; /** secondes pendant lesquelles on peut servir la dernière réponse si le service est en panne */ stale: number }

/** Construit l'adresse du service externe à partir de paramètres validés (jamais d'URL fournie par le client) */
export function geoUpstream(url: URL): GeoUpstream | null {
  if (url.pathname === "/geo/address") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    if (q.length < 2) return null;
    const u = new URL(ADDR);
    u.searchParams.set("q", q);
    u.searchParams.set("limit", "8");
    u.searchParams.set("autocomplete", "1");
    u.searchParams.set("lat", "48.5846");   // on favorise les résultats proches de Strasbourg
    u.searchParams.set("lon", "7.7507");
    return { url: u.toString(), ttl: 3600, stale: 86400 };
  }
  if (url.pathname === "/geo/transit") {
    const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "", time = url.searchParams.get("time");
    const arrive = url.searchParams.get("arrive") === "1";   // « Arriver avant » l'heure donnée (sinon « Partir à »)
    if (!LATLON.test(from) || !LATLON.test(to) || (time !== null && !ISO_TIME.test(time)) || (arrive && time === null)) return null;
    const u = new URL(TRANSIT);
    u.searchParams.set("fromPlace", from);
    u.searchParams.set("toPlace", to);
    u.searchParams.set("numItineraries", "5");
    u.searchParams.set("language", "fr");
    u.searchParams.set("detailedTransfers", "false");
    if (time) u.searchParams.set("time", time);
    if (arrive) u.searchParams.set("arriveBy", "true");
    return { url: u.toString(), ttl: 60, stale: 120 };
  }
/** Construit la requête OSRM (piéton ou vélo) à partir de coordonnées validées */
function osrm(base: string, from: string, to: string, alternatives: boolean): string | null {
  const [fa, fo] = from.split(","), [ta, tn] = to.split(",");
  return `${base}/${fo},${fa};${tn},${ta}?overview=full&geometries=geojson&steps=true&alternatives=${alternatives}`;
}

  if (url.pathname === "/geo/walk") {
    const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
    if (!LATLON.test(from) || !LATLON.test(to)) return null;
    return { url: osrm(WALK, from, to, false) as string, ttl: 300, stale: 3600 };
  }
  if (url.pathname === "/geo/bike") {
    const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
    if (!LATLON.test(from) || !LATLON.test(to)) return null;
    return { url: osrm(BIKE, from, to, true) as string, ttl: 300, stale: 3600 };
  }
  return null;
}
