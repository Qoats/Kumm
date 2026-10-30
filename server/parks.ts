/**
 * Prévision des places libres des parkings relais (forecast.ts) : toutes les 10 minutes, places libres et occupées de
 * chaque P+R (open data de l'Eurométropole). Gardé dans state/pr-history.json. GET /poi/pr-forecast?id=pr-rotonde
 */
import { Forecaster } from "./forecast.js";
import { prOccupancy } from "./poi.js";

const EVERY = 10 * 60_000;
const fc = new Forecaster("pr-history.json");

async function sample(): Promise<void> {
  try {
    const occ = await prOccupancy();
    if (!occ.size) throw new Error("aucune occupation reçue");
    fc.record(new Map([...occ].map(([id, o]) => [id, [Math.max(0, o.free), Math.max(0, o.total - o.free)]])));
  } catch (e) {
    fc.lastError = e instanceof Error ? e.message : String(e);
  }
}

export function startParks(): void {
  void sample();
  setInterval(() => { void sample(); }, EVERY).unref();
}

/** maintenant, puis toutes les 30 min pendant 4 h : places libres, part du temps où le parking est complet */
export function parkForecast(id: string, at = Date.now()): { points: { t: number; free: number; total: number; full: number; sure: boolean }[] } | null {
  const pts = fc.forecast(id, at);
  return pts ? { points: pts.map(p => ({ t: p.t, free: p.free, total: p.free + p.other, full: p.zero, sure: p.sure })) } : null;
}

export const parksStatus = (): Record<string, unknown> => fc.status();
