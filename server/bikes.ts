/**
 * Prévision des vélos Vélhop (forecast.ts) : toutes les 10 minutes, vélos et places libres de chaque station (flux GBFS
 * ouvert). Gardé dans state/velhop-history.json. GET /poi/velhop-forecast?id=velhop-123
 */
import { fetchRetry } from "./cts.js";
import { Forecaster } from "./forecast.js";
import { GEO_USER_AGENT } from "./geo.js";
import { VELHOP_STATUS } from "./poi.js";

const EVERY = 10 * 60_000;
const fc = new Forecaster("velhop-history.json");

async function sample(): Promise<void> {
  try {
    const r = await fetchRetry(VELHOP_STATUS, { "User-Agent": GEO_USER_AGENT, Accept: "application/json" });
    if (r.status !== 200) throw new Error("HTTP " + r.status);
    const list = (JSON.parse(r.body) as { data?: { stations?: Record<string, unknown>[] } }).data?.stations ?? [];
    const values = new Map<string, [number, number]>();
    for (const s of list) {
      const b = Number(s["num_bikes_available"]), d = Number(s["num_docks_available"]);
      if (!Number.isFinite(b) || !Number.isFinite(d) || s["is_renting"] === false || s["is_renting"] === 0) continue;
      values.set(String(s["station_id"]), [b, d]);
    }
    fc.record(values);
  } catch (e) {
    fc.lastError = e instanceof Error ? e.message : String(e);
  }
}

export function startBikes(): void {
  void sample();
  setInterval(() => { void sample(); }, EVERY).unref();
}

export interface BikeForecast {
  /** maintenant, puis toutes les 30 min pendant 4 h */
  points: { t: number; bikes: number; docks: number; empty: number; sure: boolean }[];
}

/** Prévision d'une station (« velhop-123 » ou « 123 ») ; null si elle n'a jamais été relevée */
export function bikeForecast(poiId: string, at = Date.now()): BikeForecast | null {
  const pts = fc.forecast(poiId.replace(/^velhop-/, ""), at);
  return pts ? { points: pts.map(p => ({ t: p.t, bikes: p.free, docks: p.other, empty: p.zero, sure: p.sure })) } : null;
}

export const bikesStatus = (): Record<string, unknown> => fc.status();
