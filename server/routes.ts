/**
 * Parcours des lignes (arrêts dans l'ordre), appris des courses de la CTS : sa liste d'arrêts ne dit pas dans quel ordre
 * une ligne les dessert. Seules les courses pas encore parties comptent (leurs passages sont tous là, du départ au
 * terminus). Pour chaque ligne et chaque sens, le parcours le plus fréquent des 3 derniers jours est le parcours
 * principal ; les autres (services partiels, variantes, déviations ponctuelles) sont gardés à part.
 * Gardé dans le dossier d'état, comme les quais : un redémarrage ne fait rien oublier.
 */
import fs from "node:fs";
import path from "node:path";
import type { Course } from "./realtime.js";

interface Variant { codes: string[]; names: string[]; dest: string; n: number; last: number }
/** clé « ligne|sens » → parcours vus (clé : codes des quais à la suite) */
const routes = new Map<string, Map<string, Variant>>();
/** courses déjà comptées (une même course revient à chaque photo du réseau) */
let seenIds = new Set<string>(), seenOld = new Set<string>();
const KEEP_MS = 3 * 86_400_000, DROP_MS = 21 * 86_400_000;

let FILE = "";
let dirty = false;
export function initRoutes(stateDir: string): void {
  FILE = path.join(stateDir, "line-routes.json");
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8")) as Record<string, Variant[]>;
    for (const [k, vs] of Object.entries(saved)) routes.set(k, new Map(vs.map(v => [v.codes.join(" "), v])));
  } catch { /* premier démarrage */ }
  setInterval(save, 5 * 60_000).unref();
}
function save(): void {
  if (!dirty || !FILE) return;
  dirty = false;
  const now = Date.now(), out: Record<string, Variant[]> = {};
  for (const [k, m] of routes) { const vs = [...m.values()].filter(v => now - v.last < DROP_MS); if (vs.length) out[k] = vs; }
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + ".tmp", JSON.stringify(out)); fs.renameSync(FILE + ".tmp", FILE); }
  catch (e) { console.warn("Parcours des lignes : état non enregistré :", e instanceof Error ? e.message : e); }
}

/** À chaque photo du réseau : compte le parcours des courses qui n'ont pas encore commencé */
export function learnRoutes(list: Course[], now = Date.now()): void {
  if (seenIds.size > 20_000) { seenOld = seenIds; seenIds = new Set(); }
  for (const c of list) {
    if (c.mode === "ter" || !c.line || c.calls.length < 2 || c.calls[0].dep <= now) continue;
    if (seenIds.has(c.id) || seenOld.has(c.id)) continue;
    seenIds.add(c.id);
    const key = `${c.line}|${c.dir ?? c.dest}`, codes = c.calls.map(x => x.code), sig = codes.join(" ");
    const m = routes.get(key) ?? routes.set(key, new Map()).get(key)!;
    const v = m.get(sig) ?? m.set(sig, { codes, names: c.calls.map(x => x.name), dest: c.dest || c.calls[c.calls.length - 1].name, n: 0, last: now }).get(sig)!;
    v.n++; v.last = now; v.names = c.calls.map(x => x.name);
    dirty = true;
  }
}

export interface LineRoute { dest: string; from: string; codes: string[]; names: string[]; share: number;
  /** autres tronçons du même sens, sans arrêt commun (ligne coupée en deux pendant des travaux) */
  extra?: LineRoute[] }
/** Parcours d'une ligne : le principal de chaque sens, puis les variantes fréquentes (au moins 10 % des courses du sens) */
export function lineRoutes(line: string, now = Date.now()): { main: LineRoute[]; other: LineRoute[] } {
  const main: LineRoute[] = [], other: LineRoute[] = [];
  for (const [k, m] of routes) {
    if (k.slice(0, k.lastIndexOf("|")) !== line) continue;
    const vs = [...m.values()].filter(v => now - v.last < KEEP_MS);
    const pool = vs.length ? vs : [...m.values()];
    const total = pool.reduce((s, v) => s + v.n, 0);
    pool.sort((a, b) => b.n - a.n || b.codes.length - a.codes.length);
    const r = (v: Variant): LineRoute => ({ dest: v.dest, from: v.names[0], codes: v.codes, names: v.names, share: Math.round((v.n / total) * 100) / 100 });
    if (!pool[0]) continue;
    const first = r(pool[0]), names = new Set(pool[0].names);
    for (const v of pool.slice(1)) {
      if (v.n / total < 0.1) continue;
      // tronçon à part (aucun arrêt commun avec ceux déjà retenus) : il complète le parcours au lieu d'en être une variante
      if (v.names.every(n => !names.has(n))) { (first.extra ??= []).push(r(v)); v.names.forEach(n => names.add(n)); }
      else other.push(r(v));
    }
    main.push(first);
  }
  // sens « aller » d'abord : celui dont le terminus vient en premier dans l'ordre alphabétique (stable d'un jour à l'autre)
  main.sort((a, b) => a.dest.localeCompare(b.dest, "fr"));
  return { main, other };
}

export const routesStatus = (): Record<string, unknown> => ({ lignes_sens: routes.size });
