/**
 * Ponctualité du réseau CTS : à chaque mise à jour du temps réel, chaque tram et bus qui vient de quitter un arrêt est
 * comparé à son horaire prévu (schedule.ts). Seuls des totaux sont gardés, par jour, ligne, type de jour (semaine,
 * samedi, dimanche) et plage horaire : nombre de passages, retard cumulé, passages en retard (> 3 min) et en avance
 * (> 1 min). Gardés 12 mois dans state/punctuality.json. Aucune donnée de voyageur.
 * GET /api/stats : toutes les lignes ; /api/stats?line=B : détail d'une ligne par type de jour et plage horaire.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ymd } from "./gtfs.js";
import { contextOf } from "./observations.js";
import type { Course } from "./realtime.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const FILE = path.join(process.env.STATE_DIR ?? path.join(ROOT, "state"), "punctuality.json");
const KEEP_DAYS = 366, LATE = 180_000, EARLY = -60_000, MAX_DELAY = 3600_000;

/** [passages, retard cumulé (s), en retard, en avance] */
type Tally = [number, number, number, number];
/** jour « AAAAMMJJ » → « ligne|type de jour|plage » → totaux */
let days: Record<string, Record<string, Tally>> = {};
try { days = JSON.parse(fs.readFileSync(FILE, "utf8")) as typeof days; } catch { /* premier démarrage */ }
let last = 0;

const dayType = (dow: number): string => (dow === 0 ? "D" : dow === 6 ? "S" : "W");
/** plages : nuit, pointe du matin (6 h - 9 h 30), journée, pointe du soir (16 h - 19 h 30), soirée */
const band = (slot: number): string => (slot < 12 ? "n" : slot < 19 ? "pm" : slot < 32 ? "j" : slot < 39 ? "ps" : "s");

let saveTimer: NodeJS.Timeout | null = null;
function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const oldest = ymd(Date.now() - KEEP_DAYS * 86_400_000);
    for (const d of Object.keys(days)) if (d < oldest) delete days[d];
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + ".tmp", JSON.stringify(days)); fs.renameSync(FILE + ".tmp", FILE); }
    catch (e) { console.warn("Ponctualité : non enregistrée :", e instanceof Error ? e.message : e); }
  }, 60_000);
  saveTimer.unref();
}

/** Après chaque mise à jour du temps réel : les départs d'arrêt survenus depuis la précédente */
export function recordPunctuality(list: Course[], now = Date.now()): void {
  const from = last || now - 30_000;
  last = now;
  if (now - from > 10 * 60_000) return;          // longue coupure : on ne rattrape pas
  let added = 0;
  for (const c of list) {
    if (!c.realTime || c.mode === "ter") continue;
    // dernier arrêt quitté dans l'intervalle (un seul par course, pour ne pas compter plusieurs fois un même retard)
    let k = -1;
    for (let i = c.calls.length - 1; i >= 0; i--) { const x = c.calls[i]; if (x.dep > from && x.dep <= now && x.aim !== undefined && !x.est) { k = i; break; } }
    if (k < 0 || k === c.calls.length - 1) continue;
    const call = c.calls[k], delay = call.dep - call.aim!;
    if (Math.abs(delay) > MAX_DELAY) continue;    // horaire mal rapproché
    const ctx = contextOf(call.dep), day = ymd(call.dep);
    const key = `${c.line}|${dayType(ctx.dow)}|${band(ctx.slot)}`;
    const t = ((days[day] ??= {})[key] ??= [0, 0, 0, 0]);
    t[0]++; t[1] += Math.round(delay / 1000); if (delay > LATE) t[2]++; if (delay < EARLY) t[3]++;
    added++;
  }
  if (added) saveSoon();
}

interface Sum { n: number; avg: number; late: number; early: number; onTime: number }
const sum = (ts: Tally[]): Sum => {
  const n = ts.reduce((a, t) => a + t[0], 0);
  const s = ts.reduce((a, t) => a + t[1], 0), l = ts.reduce((a, t) => a + t[2], 0), e = ts.reduce((a, t) => a + t[3], 0);
  return { n, avg: n ? Math.round(s / n) : 0, late: n ? Math.round((l / n) * 100) : 0, early: n ? Math.round((e / n) * 100) : 0, onTime: n ? Math.round(((n - l - e) / n) * 100) : 0 };
};

/** Ponctualité sur les `daysBack` derniers jours : toutes les lignes, ou une ligne détaillée */
export function stats(line: string | null, daysBack = 30, now = Date.now()): unknown {
  const oldest = ymd(now - daysBack * 86_400_000);
  const pick = Object.entries(days).filter(([d]) => d >= oldest).flatMap(([, m]) => Object.entries(m));
  const since = Object.keys(days).filter(d => d >= oldest).sort()[0] ?? null;
  if (!line) {
    const byLine = new Map<string, Tally[]>();
    for (const [k, t] of pick) { const l = k.split("|")[0]; (byLine.get(l) ?? byLine.set(l, []).get(l)!).push(t); }
    return { since, days: daysBack, lines: [...byLine].map(([l, ts]) => ({ line: l, ...sum(ts) })).filter(x => x.n >= 20).sort((a, b) => b.onTime - a.onTime) };
  }
  const mine = pick.filter(([k]) => k.split("|")[0] === line);
  const group = (f: (k: string) => string): Record<string, Sum> => {
    const g = new Map<string, Tally[]>();
    for (const [k, t] of mine) { const x = f(k); (g.get(x) ?? g.set(x, []).get(x)!).push(t); }
    return Object.fromEntries([...g].map(([x, ts]) => [x, sum(ts)]));
  };
  return { since, days: daysBack, line, all: sum(mine.map(([, t]) => t)), byDay: group(k => k.split("|")[1]), byBand: group(k => k.split("|")[1] + "|" + k.split("|")[2]) };
}

export const punctualityStatus = (): Record<string, unknown> => ({ jours: Object.keys(days).length });
