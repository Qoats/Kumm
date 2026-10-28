/**
 * Horaires théoriques du réseau CTS (GTFS, données ouvertes : https://opendata.cts-strasbourg.eu/google_transit.zip).
 * Le temps réel de la CTS (estimated-timetable) ne donne que les heures estimées ; ces horaires donnent l'heure prévue de
 * chaque course à chaque arrêt, d'où le retard (ponctualité, punctuality.ts) et le vrai départ prévu d'une course.
 * - les identifiants de course sont les mêmes des deux côtés (« 22164433-26PVSB-UPCBus-Semaine-00 ») ;
 * - les codes d'arrêt du temps réel sont les « stop_code » du GTFS (« 275A ») ;
 * - téléchargé au plus une fois toutes les 20 h, gardé dans le dossier d'état ; seules les courses d'hier et
 *   d'aujourd'hui sont gardées en mémoire (une course partie hier soir peut rouler après minuit).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DAY, dayBase, eachRow, ymd, zipEntries } from "./gtfs.js";

const GTFS_URL = process.env.CTS_GTFS_URL ?? "https://opendata.cts-strasbourg.eu/google_transit.zip";
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const FILE = path.join(process.env.STATE_DIR ?? path.join(ROOT, "state"), "cts-gtfs.zip");
const MAX_AGE = 20 * 3600_000;

/** Course : codes d'arrêt (index dans `codes`), heures de départ en secondes depuis le début de la journée de service */
interface Trip { stops: Uint16Array; secs: Int32Array; dates: string[] }
let trips = new Map<string, Trip>();
let codes: string[] = [];
let loadedFor = "", fileDate = 0, lastError = "";

/** Jours de service actifs (calendar + calendar_dates) pour une liste de dates « AAAAMMJJ » */
async function activeServices(buf: Buffer, entries: ReturnType<typeof zipEntries>, dates: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, Set<string>>();
  const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dow = (d: string): number => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)), 12)).getUTCDay();
  if (entries.has("calendar.txt")) {
    await eachRow(buf, entries, "calendar.txt", (r, c) => {
      for (const d of dates) if (r[c["start_date"]] <= d && d <= r[c["end_date"]] && r[c[WD[dow(d)]]] === "1") {
        const s = r[c["service_id"]];
        (out.get(s) ?? out.set(s, new Set()).get(s)!).add(d);
      }
    });
  }
  if (entries.has("calendar_dates.txt")) {
    await eachRow(buf, entries, "calendar_dates.txt", (r, c) => {
      const d = r[c["date"]];
      if (!dates.includes(d)) return;
      const s = r[c["service_id"]];
      if (r[c["exception_type"]] === "1") (out.get(s) ?? out.set(s, new Set()).get(s)!).add(d);
      else out.get(s)?.delete(d);
    });
  }
  return new Map([...out].filter(([, v]) => v.size).map(([k, v]) => [k, [...v]]));
}

async function parse(buf: Buffer, now: number): Promise<void> {
  const entries = zipEntries(buf);
  const dates = [ymd(now - DAY), ymd(now)];
  const services = await activeServices(buf, entries, dates);
  const tripDates = new Map<string, string[]>();
  await eachRow(buf, entries, "trips.txt", (r, c) => { const d = services.get(r[c["service_id"]]); if (d) tripDates.set(r[c["trip_id"]], d); });
  const codeOf = new Map<string, number>(), codeList: string[] = [];
  await eachRow(buf, entries, "stops.txt", (r, c) => {
    const code = r[c["stop_code"]] || r[c["stop_id"]];
    if (!codeOf.has(r[c["stop_id"]])) { codeOf.set(r[c["stop_id"]], codeList.length); codeList.push(code); }
  });
  // stop_times est rangé par course (dans l'ordre des arrêts, le plus souvent) : regroupé course par course
  const kept = new Map<string, Trip>();
  let cur = "", seq: number[] = [], st: number[] = [], sc: number[] = [];
  const flush = (): void => {
    const d = tripDates.get(cur);
    if (!d || st.length < 2) return;
    const order = seq.map((_, i) => i).sort((a, b) => seq[a] - seq[b]);
    kept.set(cur, { stops: Uint16Array.from(order.map(i => st[i])), secs: Int32Array.from(order.map(i => sc[i])), dates: d });
  };
  await eachRow(buf, entries, "stop_times.txt", (r, c) => {
    const id = r[c["trip_id"]];
    if (id !== cur) { flush(); cur = id; seq = []; st = []; sc = []; }
    if (!tripDates.has(id)) return;
    const s = codeOf.get(r[c["stop_id"]]);
    const t = r[c["departure_time"]] || r[c["arrival_time"]];
    if (s === undefined || !t) return;
    const [h, m, x] = t.split(":").map(Number);
    seq.push(Number(r[c["stop_sequence"]])); st.push(s); sc.push(h * 3600 + m * 60 + (x || 0));
  });
  flush();
  trips = kept; codes = codeList; loadedFor = ymd(now);
  console.log(`Horaires CTS : ${kept.size} courses pour hier et aujourd'hui`);
}

export async function loadSchedule(): Promise<void> {
  try {
    let st: fs.Stats | null = null;
    try { st = fs.statSync(FILE); } catch { /* jamais téléchargé */ }
    if (!st || Date.now() - st.mtimeMs > MAX_AGE) {
      const r = await fetch(GTFS_URL, { headers: { "User-Agent": "Kumm (horaires CTS)" }, signal: AbortSignal.timeout(180_000) });
      if (!r.ok) throw new Error("horaires CTS : HTTP " + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      zipEntries(buf);                               // fichier tronqué : refusé, l'ancien est gardé
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE + ".part", buf);
      fs.renameSync(FILE + ".part", FILE);
      st = fs.statSync(FILE);
    }
    if (st.mtimeMs !== fileDate || loadedFor !== ymd(Date.now())) {
      await parse(fs.readFileSync(FILE), Date.now());
      fileDate = st.mtimeMs;
    }
    lastError = "";
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    console.warn("Horaires CTS non chargés :", lastError);
  }
}

/** Au démarrage, puis toutes les heures (nouvelle journée, nouveau fichier de la CTS) */
export function startSchedule(): void {
  void loadSchedule();
  setInterval(() => { void loadSchedule(); }, 3600_000).unref();
}

/**
 * Heures prévues d'une course, arrêt par arrêt (ms), alignées sur les codes d'arrêt donnés ; null si la course est inconnue.
 * near : une heure estimée de la course (choisit la bonne journée : hier ou aujourd'hui).
 */
export function aimedTimes(tripId: string, stopCodes: string[], near: number): { start: number; aim: (number | undefined)[] } | null {
  const t = trips.get(tripId);
  if (!t) return null;
  // journée de service la plus proche de l'heure estimée
  let base = 0, best = Infinity;
  for (const d of t.dates) {
    const b = dayBase(d), gap = Math.abs(b + t.secs[0] * 1000 - near);
    if (gap < best) { best = gap; base = b; }
  }
  const start = base + t.secs[0] * 1000;
  // chaque arrêt de la course temps réel, dans l'ordre : le premier passage prévu à ce code après le précédent
  let from = 0;
  const aim = stopCodes.map(code => {
    for (let i = from; i < t.stops.length; i++) if (codes[t.stops[i]] === code) { from = i + 1; return base + t.secs[i] * 1000; }
    return undefined;
  });
  return { start, aim };
}

export const scheduleStatus = (): Record<string, unknown> => ({ courses: trips.size, du: loadedFor || null, erreur: lastError || null });
