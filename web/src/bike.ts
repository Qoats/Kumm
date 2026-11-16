import type { WalkRoute } from "../../shared/types";
import type { OsrmResponse, OsrmRoute } from "../../shared/geo-api";
import type { LL } from "./geo";
import { url } from "./config";

export interface BikeRoute {
  distance: number;
  duration: number;
  coords: [number, number][];
  steps: WalkRoute["steps"];
}

const toSteps = (r: OsrmRoute): WalkRoute["steps"] =>
  r.legs.flatMap(l => l.steps).map(s => ({
    text: s.name ? `Suivez ${s.name}` : "Continuez",
    type: s.maneuver.type, modifier: s.maneuver.modifier, distance: s.distance,
    lat: s.maneuver.location[1], lon: s.maneuver.location[0]
  }));

/** Un ou plusieurs itinéraires à vélo (le serveur demande les alternatives à OSRM) */
export async function fetchBike(from: LL, to: LL): Promise<BikeRoute[]> {
  const r = await fetch(url(`/geo/bike?from=${from.lat},${from.lon}&to=${to.lat},${to.lon}`));
  if (!r.ok) throw new Error("Service " + r.status);
  const j = (await r.json()) as OsrmResponse;
  if (j.code !== "Ok" || !j.routes?.length) throw new Error("Aucun itinéraire vélo");
  return j.routes.map(rt => ({ distance: rt.distance, duration: rt.duration, coords: rt.geometry.coordinates, steps: toSteps(rt) }));
}
