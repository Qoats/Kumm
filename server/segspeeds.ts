/**
 * Vitesses réelles entre deux arrêts, apprises des trajets partagés par les voyageurs (POST /api/ride) : chaque position
 * envoyée en roulant (plus de 11 km/h) donne la vitesse du téléphone sur le tronçon où il se trouve. Seules ces vitesses
 * sont gardées, par tronçon (« 412D>413A »), au plus 40 par tronçon : ni position, ni heure, ni identifiant. La vitesse de
 * croisière d'un tronçon (80e centile, au moins 6 mesures) remplace alors la valeur par défaut dans la position estimée
 * des véhicules (vehicles.ts → champ c, web/src/vehicles.ts). Gardé dans le dossier d'état.
 */
import fs from "node:fs";
import path from "node:path";

const MAX_SAMPLES = 40, MIN_SAMPLES = 6, MIN_SPEED = 3;   // m/s
const samples = new Map<string, number[]>();
let FILE = "", dirty = false;

export function initSegSpeeds(stateDir: string): void {
  FILE = path.join(stateDir, "segment-speeds.json");
  try {
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(FILE, "utf8")) as Record<string, number[]>))
      if (Array.isArray(v)) samples.set(k, v.filter(x => typeof x === "number").slice(-MAX_SAMPLES));
  } catch { /* premier démarrage */ }
  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + ".tmp", JSON.stringify(Object.fromEntries(samples))); fs.renameSync(FILE + ".tmp", FILE); }
    catch (e) { console.warn("Vitesses des tronçons : état non enregistré :", e instanceof Error ? e.message : e); }
  }, 5 * 60_000).unref();
}

/** Vitesse mesurée (m/s) par un voyageur à bord, sur le tronçon a → b */
export function learnSpeed(a: string, b: string, speed: number): void {
  if (!(speed >= MIN_SPEED && speed < 30)) return;
  const k = `${a}>${b}`, list = samples.get(k) ?? [];
  list.push(Math.round(speed * 10) / 10);
  samples.set(k, list.slice(-MAX_SAMPLES));
  dirty = true;
}

/** Vitesse de croisière apprise sur le tronçon a → b, en km/h ; null s'il n'y a pas assez de mesures */
export function cruiseOf(a: string, b: string): number | null {
  const list = samples.get(`${a}>${b}`);
  if (!list || list.length < MIN_SAMPLES) return null;
  const s = [...list].sort((x, y) => x - y);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.8))] * 3.6);
}

export const segSpeedStatus = (): Record<string, unknown> => ({
  troncons_mesures: samples.size, troncons_utilises: [...samples.values()].filter(l => l.length >= MIN_SAMPLES).length
});
