import type { Place, WalkRoute, WalkStep } from "../../shared/types";
import type { AddressResponse, OsrmResponse, OsrmStep } from "../../shared/geo-api";
import type { LL } from "./geo";
import { url } from "./config";

const DIR: Record<string, string> = {
  left: "à gauche", "slight left": "légèrement à gauche", "sharp left": "franchement à gauche",
  right: "à droite", "slight right": "légèrement à droite", "sharp right": "franchement à droite"
};

/** Consigne en français à partir d'une manœuvre OSRM */
export function stepText(type: string, modifier: string | undefined, name: string | undefined, exit?: number): string {
  const on = name ? ` sur ${name}` : "";
  const dir = modifier ? DIR[modifier] : undefined;
  if (type === "depart") return `Partez${on}`;
  if (type === "arrive") return "Vous êtes arrivé";
  if (type === "roundabout" || type === "rotary") {
    return exit ? `Au rond-point, prenez la ${exit}${exit === 1 ? "re" : "e"} sortie${on}` : `Prenez le rond-point${on}`;
  }
  if (modifier === "uturn") return "Faites demi-tour";
  if (dir) return `Tournez ${dir}${on}`;
  if (type === "turn" || type === "end of road" || type === "fork") return `Continuez tout droit${on}`;
  return `Continuez${on}`;
}

export function arrowFor(step: WalkStep): string {
  if (step.type === "arrive") return "⚑";
  switch (step.modifier) {
    case "left": case "sharp left": return "↰";
    case "right": case "sharp right": return "↱";
    case "slight left": return "↖";
    case "slight right": return "↗";
    case "uturn": return "↶";
    default: return "↑";
  }
}

const toStep = (s: OsrmStep): WalkStep => ({
  text: stepText(s.maneuver.type, s.maneuver.modifier, s.name, s.maneuver.exit),
  type: s.maneuver.type, modifier: s.maneuver.modifier, distance: s.distance,
  lat: s.maneuver.location[1], lon: s.maneuver.location[0]
});

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(url(path));
  if (!r.ok) throw new Error("Service " + r.status);
  return (await r.json()) as T;
}

/** Itinéraire à pied entre deux points */
export async function fetchWalk(from: LL, to: LL): Promise<WalkRoute> {
  const j = await getJson<OsrmResponse>(`/geo/walk?from=${from.lat},${from.lon}&to=${to.lat},${to.lon}`);
  const r = j.routes?.[0];
  if (j.code !== "Ok" || !r) throw new Error("Aucun itinéraire à pied");
  return { distance: r.distance, duration: r.duration, coords: r.geometry.coordinates, steps: r.legs.flatMap(l => l.steps).map(toStep) };
}

/** Recherche d'adresses (base adresse nationale), résultats du Bas-Rhin en premier */
export async function geocode(q: string): Promise<Place[]> {
  const j = await getJson<AddressResponse>("/geo/address?q=" + encodeURIComponent(q));
  const all = (j.features ?? []).map(f => ({
    label: f.properties.label, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    local: (f.properties.context ?? "").startsWith("67")
  }));
  const local = all.filter(a => a.local);
  return (local.length ? local : all).slice(0, 5).map(({ label, lat, lon }) => ({ label, lat, lon }));
}
