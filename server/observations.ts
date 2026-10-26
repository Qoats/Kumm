/**
 * Observations des trajets partagés (POST /api/ride, pendant une navigation ou « Êtes-vous dans ce bus ? ») : ce que les
 * voyageurs à bord apprennent du vrai comportement des trams et bus, pour fiabiliser leur position estimée.
 *
 * Chaque observation note le contexte : jour de la semaine, mois, créneau d'une demi-heure, ligne, code du trajet (la CTS
 * ne publie pas le numéro du véhicule : le code du trajet, « hoeb2610240612 », désigne la course qu'il assure) et le
 * tronçon (quai de départ > quai d'arrivée). Jamais de position du voyageur, d'identifiant de téléphone ni de date exacte.
 *   v  vitesse en roulant (m/s), en pleine voie
 *   q  temps à quai à un arrêt (s)
 *   x  arrêt en pleine voie (feu, carrefour, bouchon) : endroit sur le tronçon (0 à 1) et durée (s)
 *   r  retard sur l'horaire théorique (s, négatif : avance)
 * Gardées dans state/ride-observations.jsonl (une ligne par observation, 12 mois au plus).
 *
 * Utilisation (vehicles.ts → web/src/vehicles.ts) : pour chaque véhicule, la vitesse de croisière du tronçon (champ c) et
 * le temps à quai au départ (champ q), d'abord pour le même type de jour et la même plage horaire, sinon tous créneaux
 * confondus, dès qu'il y a assez de mesures. Les arrêts en pleine voie et les retards sont collectés pour la suite.
 */
import fs from "node:fs";
import path from "node:path";
import type { Course } from "./realtime.js";

export interface Obs {
  k: "v" | "q" | "x" | "r";
  /** jour de la semaine (0 = dimanche), mois (1 à 12), année, créneau d'une demi-heure (0 à 47) */
  dow: number; m: number; y: number; slot: number;
  line: string; trip: string;
  /** tronçon « quai>quai » (v, x, r) ou quai (q) */
  seg: string;
  /** valeur : m/s (v), secondes (q, x, r) */
  val: number;
  /** x : endroit sur le tronçon (0 à 1) */
  f?: number;
}

const KEEP_MONTHS = 12, MIN_SPEED = 3, MIN_V = 6, MIN_Q = 4, MAX_LIST = 80;
let FILE = "";
let pending: string[] = [];
const counts = { observations: 0, ajoutees: 0 };

/* index en mémoire pour l'estimation : clé précise (type de jour + plage horaire) et clé générale */
const speeds = new Map<string, number[]>();
const dwells = new Map<string, number[]>();

const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "numeric", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
const DOW: Record<string, number> = { "dim.": 0, "lun.": 1, "mar.": 2, "mer.": 3, "jeu.": 4, "ven.": 5, "sam.": 6 };
/** Contexte d'une heure à Strasbourg : jour de la semaine, mois, année, créneau d'une demi-heure */
export function contextOf(t: number): { dow: number; m: number; y: number; slot: number } {
  const p = Object.fromEntries(parts.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { dow: DOW[p["weekday"] ?? ""] ?? new Date(t).getDay(), m: Number(p["month"]), y: Number(p["year"]), slot: Number(p["hour"]) * 2 + (Number(p["minute"]) >= 30 ? 1 : 0) };
}
/** Type de jour (semaine, samedi, dimanche) et plage horaire (nuit, pointe du matin, journée, pointe du soir, soirée) */
const dayType = (dow: number): string => (dow === 0 ? "D" : dow === 6 ? "S" : "W");
const band = (slot: number): string => (slot < 12 ? "n" : slot < 19 ? "pm" : slot < 32 ? "j" : slot < 39 ? "ps" : "s");
const keys = (o: { dow: number; slot: number }, seg: string): [string, string] => [`${seg}|${dayType(o.dow)}|${band(o.slot)}`, seg];

function index(o: Obs): void {
  const map = o.k === "v" ? speeds : o.k === "q" ? dwells : null;
  if (!map) return;
  for (const key of keys(o, o.seg)) {
    const l = map.get(key) ?? [];
    l.push(o.val);
    map.set(key, l.length > MAX_LIST ? l.slice(-MAX_LIST) : l);
  }
}

export function initObservations(stateDir: string): void {
  FILE = path.join(stateDir, "ride-observations.jsonl");
  const now = contextOf(Date.now()), keep: string[] = [];
  let dropped = 0;
  try {
    for (const line of fs.readFileSync(FILE, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const o = JSON.parse(line) as Obs;
        if ((now.y - o.y) * 12 + (now.m - o.m) >= KEEP_MONTHS) { dropped++; continue; }   // plus de 12 mois : oubliée
        index(o); keep.push(line); counts.observations++;
      } catch { /* ligne abîmée : ignorée */ }
    }
    if (dropped) fs.writeFileSync(FILE, keep.join("\n") + (keep.length ? "\n" : ""));
  } catch { /* premier démarrage */ }
  setInterval(flush, 60_000).unref();
}

function flush(): void {
  if (!pending.length || !FILE) return;
  const lines = pending; pending = [];
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.appendFileSync(FILE, lines.join("\n") + "\n"); }
  catch (e) { pending = lines.concat(pending).slice(-5000); console.warn("Observations des trajets : non enregistrées :", e instanceof Error ? e.message : e); }
}

function add(o: Obs): void {
  index(o); pending.push(JSON.stringify(o)); counts.observations++; counts.ajoutees++;
}

/* ---------- ce que révèle chaque position envoyée ---------- */

/** Suivi en cours de chaque course partagée : arrêt (à quai ou en pleine voie) commencé à quel moment */
const live = new Map<string, { at: number; stop?: { kind: "q" | "x"; seg: string; f?: number; since: number }; lastR: number }>();
setInterval(() => { const now = Date.now(); for (const [id, s] of live) if (now - s.at > 5 * 60_000) live.delete(id); }, 60_000).unref();

/**
 * Une position partagée, déjà située sur le trajet : tronçon k (indices dans c.calls), avancée f, distance au trajet d,
 * distance au quai le plus proche (m), vitesse GPS (m/s).
 */
export function observe(c: Course, code: string, k: number, f: number, d: number, nearStop: { k: number; m: number }, speed: number | null, now = Date.now()): void {
  if (c.mode === "ter" || k < 0 || k >= c.calls.length - 1) return;
  const ctx = contextOf(now), base = { ...ctx, line: c.line, trip: code };
  const seg = `${c.calls[k].code}>${c.calls[k + 1].code}`;
  const s = live.get(c.id) ?? { at: now, lastR: 0 };
  s.at = now;
  // vitesse en roulant, en pleine voie
  if (speed !== null && speed >= MIN_SPEED && speed < 30 && d < 60 && f > 0.1 && f < 0.9) add({ k: "v", ...base, seg, val: Math.round(speed * 10) / 10 });
  // arrêts : à quai (près d'un arrêt) ou en pleine voie ; durée notée quand le véhicule repart
  const still = speed !== null && speed < 1;
  if (still) {
    const atQuay = nearStop.m < 45;
    const kind = atQuay ? "q" : "x", where = atQuay ? c.calls[nearStop.k].code : seg;
    if (!s.stop || s.stop.kind !== kind || s.stop.seg !== where) s.stop = { kind, seg: where, ...(atQuay ? {} : { f: Math.round(f * 100) / 100 }), since: now };
  } else if (s.stop && speed !== null && speed > 2) {
    const dur = Math.round((now - s.stop.since) / 1000);
    if (dur >= 5 && dur <= 600) add({ k: s.stop.kind, ...base, seg: s.stop.seg, val: dur, ...(s.stop.f !== undefined ? { f: s.stop.f } : {}) });
    s.stop = undefined;
  }
  // retard sur l'horaire théorique, une fois par minute au plus
  const a = c.calls[k].aim, b = c.calls[k + 1].aim;
  if (a !== undefined && b !== undefined && now - s.lastR > 60_000) {
    s.lastR = now;
    add({ k: "r", ...base, seg, val: Math.round((now - (a + f * (b - a))) / 1000) });
  }
  live.set(c.id, s);
}

/* ---------- utilisation pour l'estimation ---------- */

const pick = (map: Map<string, number[]>, seg: string, now: number, min: number): number[] | null => {
  const ctx = contextOf(now);
  for (const key of keys(ctx, seg)) { const l = map.get(key); if (l && l.length >= min) return l; }
  return null;
};
const quantile = (l: number[], q: number): number => { const s = [...l].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

/** Vitesse de croisière observée sur le tronçon a → b (km/h, 80e centile), pour ce type de jour et cette heure si possible */
export function cruiseOf(a: string, b: string, now = Date.now()): number | null {
  const l = pick(speeds, `${a}>${b}`, now, MIN_V);
  return l ? Math.round(quantile(l, 0.8) * 3.6) : null;
}

/** Temps à quai observé à un arrêt (s, médiane), pour ce type de jour et cette heure si possible */
export function dwellOf(code: string, now = Date.now()): number | null {
  const l = pick(dwells, code, now, MIN_Q);
  return l ? Math.round(quantile(l, 0.5)) : null;
}

export const observationStatus = (): Record<string, unknown> => ({
  ...counts, troncons_vitesse: [...speeds.keys()].filter(k => !k.includes("|")).length,
  arrets_temps_a_quai: [...dwells.keys()].filter(k => !k.includes("|")).length
});
