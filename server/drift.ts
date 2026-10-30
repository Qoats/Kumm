/**
 * Correction des courses aux horaires figés : certaines courses gardent les mêmes heures plusieurs minutes, puis la CTS
 * les recale d'un coup. À chaque recalage après un gel d'au moins 2 min, l'écart (heure annoncée − nouvelle heure, au
 * prochain arrêt ; positif : le véhicule était en avance) est ajouté à une moyenne par ligne, type de jour et plage horaire.
 * Quand cet écart est net et régulier (assez de recalages, moyenne nettement non nulle), les courses figées de cette ligne
 * à cette heure sont avancées (ou retardées) d'autant, au prorata de la durée du gel. Gardé dans state/drift.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contextOf } from "./observations.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const FILE = path.join(process.env.STATE_DIR ?? path.join(ROOT, "state"), "drift.json");
const MIN_FREEZE = 120_000, MAX_N = 200, MIN_N = 40, MIN_MEAN = 20, MAX_SHIFT = 120;

/** [recalages, écart moyen (s), écart absolu moyen (s), gel moyen (s)] */
type Avg = [number, number, number, number];
let stats: Record<string, Avg> = {};
try { stats = JSON.parse(fs.readFileSync(FILE, "utf8")) as typeof stats; } catch { /* premier démarrage */ }
let dirty = false;
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + ".tmp", JSON.stringify(stats)); fs.renameSync(FILE + ".tmp", FILE); }
  catch (e) { console.warn("Recalages : non enregistrés :", e instanceof Error ? e.message : e); }
}, 5 * 60_000).unref();

const dayType = (dow: number): string => (dow === 0 ? "D" : dow === 6 ? "S" : "W");
const band = (slot: number): string => (slot < 12 ? "n" : slot < 19 ? "pm" : slot < 32 ? "j" : slot < 39 ? "ps" : "s");
const keyOf = (line: string, t: number): string => { const c = contextOf(t); return `${line}|${dayType(c.dow)}|${band(c.slot)}`; };

/** Recalage d'une course : anciennes et nouvelles heures (mêmes arrêts), durée du gel */
export function learnDrift(line: string, oldTimes: number[], newTimes: number[], frozenMs: number, now: number): void {
  if (frozenMs < MIN_FREEZE || oldTimes.length !== newTimes.length) return;
  const i = newTimes.findIndex(t => t > now);       // prochain arrêt
  if (i < 0 || !Number.isFinite(oldTimes[i])) return;
  const J = (oldTimes[i] - newTimes[i]) / 1000;
  if (Math.abs(J) < 5 || Math.abs(J) > 600) return;   // pas un recalage, ou un incident
  const m = (stats[keyOf(line, now)] ??= [0, 0, 0, 0]);
  const n = Math.min(m[0] + 1, MAX_N);
  m[1] += (J - m[1]) / n; m[2] += (Math.abs(J) - m[2]) / n; m[3] += (frozenMs / 1000 - m[3]) / n; m[0] = n;
  dirty = true;
}

/** Avance probable (s, positive : en avance sur ses heures) d'une course figée depuis frozenMs ; 0 si rien de net */
export function driftOf(line: string, frozenMs: number, now = Date.now()): number {
  const m = stats[keyOf(line, now)];
  if (!m || m[0] < MIN_N || Math.abs(m[1]) < MIN_MEAN || Math.abs(m[1]) < 0.6 * m[2]) return 0;
  const k = Math.min(1, frozenMs / 1000 / Math.max(60, m[3]));
  return Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, Math.round(m[1] * k)));
}

export const driftStatus = (): Record<string, unknown> => {
  const all = Object.entries(stats), on = all.filter(([, m]) => m[0] >= MIN_N && Math.abs(m[1]) >= MIN_MEAN && Math.abs(m[1]) >= 0.6 * m[2]);
  return { suivis: all.length, corriges: on.map(([k, m]) => `${k} : ${m[1] > 0 ? "+" : ""}${Math.round(m[1])} s`) };
};
