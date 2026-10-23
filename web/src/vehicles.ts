/**
 * Trams et bus en circulation : position estimée par le serveur d'après les horaires temps réel (/api/vehicles),
 * puis animée ici seconde par seconde entre l'arrêt quitté et le suivant.
 */
import { CONFIG } from "./config";
import { isTram } from "./data";
import { appHeaders, url } from "./config";

export interface Vehicle {
  id: string;
  line: string;
  dest: string;
  rt: boolean;
  /** [latitude, longitude, heure en ms] au début et à la fin du tronçon en cours */
  a: [number, number, number];
  b: [number, number, number];
  h: number;
  next: [string, number][];
}

export const VEHICLES = new Map<string, Vehicle>();
/** écart entre l'horloge du serveur et celle du téléphone (ms) */
let skew = 0;
let lastFetch = 0, loading = false;
const REFRESH_MS = 20_000;

/** Heure « serveur » : les positions restent justes même si l'horloge du téléphone est décalée */
export const serverNow = (): number => Date.now() + skew;

/** Recharge les positions si les dernières ont plus de 20 s ; rappelle onUpdate quand elles arrivent */
export function refreshVehicles(onUpdate: () => void): void {
  if (CONFIG.USE_MOCK || loading || Date.now() - lastFetch < REFRESH_MS) return;
  loading = true;
  fetch(url("/api/vehicles"), { headers: appHeaders() })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((j: { now: number; vehicles?: Vehicle[] }) => {
      skew = j.now - Date.now();
      VEHICLES.clear();
      for (const v of j.vehicles ?? []) VEHICLES.set(v.id, v);
      onUpdate();
    })
    .catch(e => console.warn("Véhicules indisponibles :", e))
    .finally(() => { loading = false; lastFetch = Date.now(); });
}

/** Position à l'instant t, entre l'arrêt quitté et le suivant */
export function vehiclePos(v: Vehicle, t = serverNow()): [number, number] {
  const [la1, lo1, t1] = v.a, [la2, lo2, t2] = v.b;
  const f = t2 > t1 ? Math.max(0, Math.min(1, (t - t1) / (t2 - t1))) : 1;
  return [la1 + (la2 - la1) * f, lo1 + (lo2 - lo1) * f];
}

export const vehicleKind = (v: Vehicle): "tram" | "bus" => (isTram(v.line) ? "tram" : "bus");
