/** Optional online services contact their public providers directly. GTFS queries never use these services. */
import { CapacitorHttp } from "@capacitor/core";
import type { Poi } from "../../shared/types";
import { PR_SITES } from "../../server/poi-data";
export function publicUrl(path: string): string {
  const u = new URL(path, "https://localhost"), q = u.searchParams;
  if (u.pathname === "/geo/address") return "https://data.geopf.fr/geocodage/search?limit=8&autocomplete=1&lat=48.5846&lon=7.7507&q=" + encodeURIComponent(q.get("q") ?? "");
  if (u.pathname === "/geo/walk" || u.pathname === "/geo/bike") {
    const mode = u.pathname.endsWith("bike") ? "bike" : "foot";
    const coords = (key: string) => { const [lat, lon] = (q.get(key) ?? "").split(",").map(Number); if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw Error("Coordonnées invalides"); return `${lon},${lat}`; };
    return `https://routing.openstreetmap.de/routed-${mode}/route/v1/${mode}/${coords("from")};${coords("to")}?overview=full&geometries=geojson&steps=true&alternatives=${mode === "bike"}`;
  }
  throw Error("Bientôt disponible");
}
export async function publicJson<T>(path: string): Promise<T> {
  const r = await CapacitorHttp.get({ url: publicUrl(path), connectTimeout: 10000, readTimeout: 15000 });
  if (r.status !== 200) throw Error("Service public HTTP " + r.status);
  return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
}
export async function localPois(): Promise<Poi[]> {
  let stations: { station_id: string; name: string; lat: number; lon: number }[] = [];
  try {
    const cached = localStorage.getItem("velhop-static"); if (cached) stations = JSON.parse(cached);
    const r = await CapacitorHttp.get({ url: "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_ae/fr/station_information.json", connectTimeout: 10000, readTimeout: 15000 });
    if (r.status === 200) {
      const j = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
      if (Array.isArray(j.data?.stations)) { stations = j.data.stations; localStorage.setItem("velhop-static", JSON.stringify(stations)); }
    }
  } catch { /* Saved station locations remain available. */ }
  return [
    ...PR_SITES.map(p => ({ id: p.id, name: `P+R ${p.name}`, kind: "pr" as const, lat: p.lat, lon: p.lon, x: 0, y: 0, info: `${p.capacity} places · Disponibilités : Bientôt disponible` })),
    ...stations.map(p => ({ id: "velhop-" + p.station_id, name: p.name, kind: "velhop" as const, lat: p.lat, lon: p.lon, x: 0, y: 0, info: "Disponibilités : Bientôt disponible" }))
  ];
}
