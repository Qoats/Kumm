import type { Stop } from "../../shared/types";
import type { AnnotatedStopPoint, SiriStopPoints } from "../../shared/cts-api";
import { STRASBOURG_VILLE } from "../../shared/ter";
import type { TerStation } from "../../shared/ter";
import { kindOfStop } from "./data";
import { isHubName, stopKey } from "./network";

/** Code « logique » d'un arrêt : champ dédié s'il existe, sinon le code du quai sans son suffixe (LAMEY_01 → LAMEY) */
function logicalCode(s: AnnotatedStopPoint): string {
  const find = (o: unknown, d: number): string | undefined => {
    if (d > 2 || typeof o !== "object" || o === null) return undefined;
    for (const [k, v] of Object.entries(o)) {
      if (/logical.?stop.?code|logicalcode/i.test(k) && typeof v === "string" && v) return v;
      const r = find(v, d + 1);
      if (r) return r;
    }
    return undefined;
  };
  return find(s, 0) ?? s.StopPointRef.replace(/_\d+$/, "");
}

/** Liste des arrêts du réseau, quais regroupés par nom */
const caps = (t: string): number => (t.match(/\p{Lu}/gu) ?? []).length;

export function groupStops(j: SiriStopPoints, ter: TerStation[]): Stop[] {
  interface Group { id: string; name: string; codes: Set<string>; quays: string[]; pos: { code: string; lat: number; lon: number }[]; lat: number; lon: number; n: number; lines: Set<string> }
  const by: Record<string, Group> = {};
  for (const s of j.StopPointsDelivery.AnnotatedStopPointRef ?? []) {
    if (!s.Location) continue;
    // « Gare Centrale » et « Gare centrale » : un seul arrêt (la CTS écrit parfois le même nom de deux façons)
    const g = (by[stopKey(s.StopName)] ??= { id: s.StopPointRef, name: s.StopName, codes: new Set(), quays: [], pos: [], lat: 0, lon: 0, n: 0, lines: new Set() });
    if (caps(s.StopName) > caps(g.name)) g.name = s.StopName;
    g.codes.add(logicalCode(s));
    g.quays.push(s.StopPointRef);
    if (s.Extension?.StopCode) g.pos.push({ code: s.Extension.StopCode, lat: Number(s.Location.Latitude), lon: Number(s.Location.Longitude) });
    g.lat += Number(s.Location.Latitude);
    g.lon += Number(s.Location.Longitude);
    g.n++;
    for (const l of s.Lines ?? []) {
      const id = typeof l === "string" ? l : (l.LineRef ?? l.PublishedLineName ?? "");
      if (id) g.lines.add(id);
    }
  }
  const stops: Stop[] = Object.values(by).map(g => ({
    id: g.id, name: g.name, refs: [...g.codes, ...g.quays], lat: g.lat / g.n, lon: g.lon / g.n, x: 0, y: 0, lines: [...g.lines], quays: g.pos
  }));
  // gares TER (Eurométropole, ligne de Paris, Grand Est) ; Strasbourg-Ville est rattachée à Gare Centrale (une seule fiche : trams, bus et trains)
  for (const t of ter) {
    const hub = t.uic === STRASBOURG_VILLE ? stops.find(s => isHubName(s.name)) : undefined;
    if (hub) { hub.sncf = t.uic; hub.lines.push("TER"); continue; }
    stops.push({ id: "SNCF:" + t.uic, name: t.name, refs: [], lat: t.lat, lon: t.lon, x: 0, y: 0, lines: ["TER"], sncf: t.uic });
  }
  return stops;
}

/**
 * Station de tram dont certains quais ne servent qu'aux bus (Krimmeri, Lycée Couffignal…) : le repère est placé au centre
 * de ses quais de tram, et non entre le tram et les arrêts de bus.
 * Renvoie true si au moins une position a changé.
 */
export function placeOnTramQuays(stops: Stop[], modes: Record<string, string>): boolean {
  let changed = false;
  for (const s of stops) {
    if (kindOfStop(s) !== "tram" || !s.quays?.length) continue;
    const tram = s.quays.filter(q => modes[q.code]?.includes("tram"));
    // 1 ou 2 quais de tram (une ligne, un quai par sens) avec des arrêts de bus à côté ; les grands croisements
    // (République, Homme de Fer…) ont plusieurs quais de tram autour d'une place : on y garde le centre de tous les quais
    if (!tram.length || tram.length > 2 || tram.length === s.quays.length) continue;
    const lat = tram.reduce((a, q) => a + q.lat, 0) / tram.length, lon = tram.reduce((a, q) => a + q.lon, 0) / tram.length;
    if (Math.abs(lat - s.lat) > 1e-6 || Math.abs(lon - s.lon) > 1e-6) { s.lat = lat; s.lon = lon; changed = true; }
  }
  return changed;
}
