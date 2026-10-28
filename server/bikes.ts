/**
 * Prévision des vélos Vélhop : toutes les 10 minutes, le nombre de vélos et de places libres de chaque station (flux GBFS
 * ouvert) est ajouté à une moyenne par station, type de jour (semaine, samedi, dimanche) et demi-heure. La moyenne suit
 * les dernières semaines (poids plafonné), pour s'adapter aux saisons et aux changements de station.
 * La prévision part de la situation actuelle et rejoint peu à peu l'habitude de la station à l'heure visée.
 * Gardé dans state/velhop-history.json. GET /poi/velhop-forecast?id=velhop-123
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRetry } from "./cts.js";
import { GEO_USER_AGENT } from "./geo.js";
import { contextOf } from "./observations.js";
import { VELHOP_STATUS } from "./poi.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const FILE = path.join(process.env.STATE_DIR ?? path.join(ROOT, "state"), "velhop-history.json");
const EVERY = 10 * 60_000, SLOT = 30 * 60_000;
/** poids maximal d'une moyenne : 3 relevés par demi-heure, environ 4 semaines */
const MAX_N = 12;
/** l'écart à l'habitude constaté maintenant s'efface en environ 1 h */
const DECAY = 60 * 60_000;

/** [relevés, vélos moyens, places moyennes, part du temps sans vélo] */
type Avg = [number, number, number, number];
/** station → « type de jour|demi-heure » → moyenne */
let hist: Record<string, Record<string, Avg>> = {};
try { hist = JSON.parse(fs.readFileSync(FILE, "utf8")) as typeof hist; } catch { /* premier démarrage */ }
let now: Record<string, { b: number; d: number; at: number }> = {};
let lastError = "", lastRun = 0;

const dayType = (dow: number): string => (dow === 0 ? "D" : dow === 6 ? "S" : "W");
const keyOf = (t: number): string => { const c = contextOf(t); return `${dayType(c.dow)}|${c.slot}`; };
const round1 = (x: number): number => Math.round(x * 10) / 10;

async function sample(): Promise<void> {
  try {
    const r = await fetchRetry(VELHOP_STATUS, { "User-Agent": GEO_USER_AGENT, Accept: "application/json" });
    if (r.status !== 200) throw new Error("HTTP " + r.status);
    const list = (JSON.parse(r.body) as { data?: { stations?: Record<string, unknown>[] } }).data?.stations ?? [];
    const t = Date.now(), key = keyOf(t), next: typeof now = {};
    for (const s of list) {
      const b = Number(s["num_bikes_available"]), d = Number(s["num_docks_available"]);
      if (!Number.isFinite(b) || !Number.isFinite(d) || s["is_renting"] === false || s["is_renting"] === 0) continue;
      const id = String(s["station_id"]);
      next[id] = { b, d, at: t };
      const a = ((hist[id] ??= {})[key] ??= [0, 0, 0, 0]);
      const n = Math.min(a[0] + 1, MAX_N);
      a[1] = round1(a[1] + (b - a[1]) / n); a[2] = round1(a[2] + (d - a[2]) / n);
      a[3] = Math.round((a[3] + ((b === 0 ? 1 : 0) - a[3]) / n) * 100) / 100; a[0] = n;
    }
    now = next; lastRun = t; lastError = "";
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(hist));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
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
  const id = poiId.replace(/^velhop-/, ""), h = hist[id], cur = now[id];
  if (!h && !cur) return null;
  const typical = (t: number): Avg | undefined => h?.[keyOf(t)];
  const here = typical(at);
  // écart de maintenant à l'habitude, qui s'estompe avec le temps
  const gapB = cur && here && here[0] >= 3 ? cur.b - here[1] : 0, gapD = cur && here && here[0] >= 3 ? cur.d - here[2] : 0;
  const points: BikeForecast["points"] = [];
  const start = Math.ceil(at / SLOT) * SLOT;
  if (cur) points.push({ t: cur.at, bikes: cur.b, docks: cur.d, empty: cur.b === 0 ? 1 : 0, sure: true });
  for (let t = start; t <= at + 4 * 3600_000; t += SLOT) {
    const a = typical(t);
    if (!a || a[0] < 3) {
      // pas encore assez de relevés à cette heure : on garde la situation actuelle, marquée incertaine
      if (cur) points.push({ t, bikes: cur.b, docks: cur.d, empty: cur.b === 0 ? 1 : 0, sure: false });
      continue;
    }
    const w = Math.exp(-(t - at) / DECAY);
    const total = cur ? cur.b + cur.d : a[1] + a[2];
    const bikes = Math.max(0, Math.min(total, Math.round(a[1] + gapB * w)));
    const docks = Math.max(0, Math.min(total - bikes, Math.round(a[2] + gapD * w)));
    points.push({ t, bikes, docks, empty: a[3], sure: a[0] >= 6 });
  }
  return { points };
}

export const bikesStatus = (): Record<string, unknown> => ({
  stations: Object.keys(hist).length,
  dernier_releve: lastRun ? new Date(lastRun).toISOString() : null,
  erreur: lastError || null
});
