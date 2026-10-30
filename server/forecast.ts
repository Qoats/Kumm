/**
 * Prévision d'occupation (vélos d'une station Vélhop, places libres d'un parking relais) : chaque relevé est ajouté à une
 * moyenne par lieu, type de jour (semaine, samedi, dimanche) et demi-heure. La moyenne suit les dernières semaines
 * (poids plafonné), pour s'adapter aux saisons. La prévision part de la situation actuelle et rejoint peu à peu
 * l'habitude du lieu à l'heure visée. Gardé dans le dossier d'état (un fichier par source).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contextOf } from "./observations.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const SLOT = 30 * 60_000;
/** poids maximal d'une moyenne : 3 relevés par demi-heure, environ 4 semaines */
const MAX_N = 12;
/** l'écart à l'habitude constaté maintenant s'efface en environ 1 h */
const DECAY = 60 * 60_000;

/** [relevés, disponible moyen, reste moyen, part du temps à zéro (vide, ou complet pour un parking)] */
type Avg = [number, number, number, number];
const dayType = (dow: number): string => (dow === 0 ? "D" : dow === 6 ? "S" : "W");
const keyOf = (t: number): string => { const c = contextOf(t); return `${dayType(c.dow)}|${c.slot}`; };
const round1 = (x: number): number => Math.round(x * 10) / 10;

/** maintenant, puis toutes les 30 min pendant 4 h : disponible (vélos, places libres), reste, part du temps à zéro */
export interface ForecastPoint { t: number; free: number; other: number; zero: number; sure: boolean }

export class Forecaster {
  private readonly file: string;
  private hist: Record<string, Record<string, Avg>> = {};
  private now: Record<string, { a: number; b: number; at: number }> = {};
  lastRun = 0;
  lastError = "";

  constructor(name: string) {
    this.file = path.join(process.env.STATE_DIR ?? path.join(ROOT, "state"), name);
    try { this.hist = JSON.parse(fs.readFileSync(this.file, "utf8")) as typeof this.hist; } catch { /* premier démarrage */ }
  }

  /** Un relevé complet : lieu → [disponible, reste] */
  record(values: Map<string, [number, number]>, t = Date.now()): void {
    const key = keyOf(t), next: typeof this.now = {};
    for (const [id, [a, b]] of values) {
      next[id] = { a, b, at: t };
      const m = ((this.hist[id] ??= {})[key] ??= [0, 0, 0, 0]);
      const n = Math.min(m[0] + 1, MAX_N);
      m[1] = round1(m[1] + (a - m[1]) / n); m[2] = round1(m[2] + (b - m[2]) / n);
      m[3] = Math.round((m[3] + ((a === 0 ? 1 : 0) - m[3]) / n) * 100) / 100; m[0] = n;
    }
    this.now = next; this.lastRun = t; this.lastError = "";
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.hist));
      fs.renameSync(this.file + ".tmp", this.file);
    } catch (e) { this.lastError = e instanceof Error ? e.message : String(e); }
  }

  /** Prévision d'un lieu ; null s'il n'a jamais été relevé */
  forecast(id: string, at = Date.now()): ForecastPoint[] | null {
    const h = this.hist[id], cur = this.now[id];
    if (!h && !cur) return null;
    const typical = (t: number): Avg | undefined => h?.[keyOf(t)];
    const here = typical(at);
    // écart de maintenant à l'habitude, qui s'estompe avec le temps
    const gapA = cur && here && here[0] >= 3 ? cur.a - here[1] : 0, gapB = cur && here && here[0] >= 3 ? cur.b - here[2] : 0;
    const points: ForecastPoint[] = [];
    if (cur) points.push({ t: cur.at, free: cur.a, other: cur.b, zero: cur.a === 0 ? 1 : 0, sure: true });
    for (let t = Math.ceil(at / SLOT) * SLOT; t <= at + 4 * 3600_000; t += SLOT) {
      const m = typical(t);
      if (!m || m[0] < 3) {
        // pas encore assez de relevés à cette heure : on garde la situation actuelle, marquée incertaine
        if (cur) points.push({ t, free: cur.a, other: cur.b, zero: cur.a === 0 ? 1 : 0, sure: false });
        continue;
      }
      const w = Math.exp(-(t - at) / DECAY);
      const total = cur ? cur.a + cur.b : m[1] + m[2];
      const free = Math.max(0, Math.min(total, Math.round(m[1] + gapA * w)));
      const other = Math.max(0, Math.min(total - free, Math.round(m[2] + gapB * w)));
      points.push({ t, free, other, zero: m[3], sure: m[0] >= 6 });
    }
    return points;
  }

  status(): Record<string, unknown> {
    return { lieux: Object.keys(this.hist).length, dernier_releve: this.lastRun ? new Date(this.lastRun).toISOString() : null, erreur: this.lastError || null };
  }
}
