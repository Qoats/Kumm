/**
 * Trajet routier entre deux arrêts, quand aucun tracé de ligne ne convient (déviation pour travaux, itinéraire absent
 * d'OpenStreetMap) : sans lui, le bus irait en ligne droite à travers les immeubles.
 * Calculé une seule fois par couple d'arrêts avec le routage OpenStreetMap (profil voiture, routing.openstreetmap.de, déjà
 * utilisé pour la marche), puis gardé en mémoire et dans le dossier d'état. Au plus un calcul à la fois, quelques par minute :
 * le service est gratuit et fait pour un usage modéré.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GEO_USER_AGENT } from "./geo.js";

type Pt = [number, number];

const CAR = process.env.GEO_CAR_BASE ?? "https://routing.openstreetmap.de/routed-car/route/v1/driving";
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const FILE = path.join(process.env.STATE_DIR ?? path.join(ROOT, "state"), "road-paths.json");
const PER_MINUTE = 12;
const RETRY_MS = 6 * 3600_000;          // trajet introuvable : nouvel essai au plus toutes les 6 h

const R = 6371000, rad = (d: number): number => (d * Math.PI) / 180;
const dist = (a: Pt, b: Pt): number => Math.hypot(rad(b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2)), rad(b[0] - a[0])) * R;

/** « lat,lon>lat,lon » → trajet ; null : pas de trajet plausible */
const known = new Map<string, Pt[] | null>();
const failedAt = new Map<string, number>();
const queue: { key: string; a: Pt; b: Pt }[] = [];
let dirty = false, busy = false, calls: number[] = [];
const counts = { calcules: 0, refuses: 0, erreurs: 0 };

try {
  const saved = JSON.parse(fs.readFileSync(FILE, "utf8")) as Record<string, Pt[] | null>;
  for (const [k, v] of Object.entries(saved)) known.set(k, v);
} catch { /* premier démarrage */ }

setInterval(() => {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + ".tmp", JSON.stringify(Object.fromEntries(known)));
    fs.renameSync(FILE + ".tmp", FILE);
  } catch (e) { console.warn("Trajets routiers : non enregistrés :", e instanceof Error ? e.message : e); }
}, 5 * 60_000).unref();

const keyOf = (a: Pt, b: Pt): string => `${a[0].toFixed(5)},${a[1].toFixed(5)}>${b[0].toFixed(5)},${b[1].toFixed(5)}`;

/** Trajet routier connu entre deux arrêts ; s'il n'est pas encore connu, il est demandé et sera prêt au prochain calcul */
export function roadBetween(a: Pt, b: Pt): Pt[] | null {
  const key = keyOf(a, b);
  if (known.has(key)) return known.get(key) ?? null;
  if (dist(a, b) < 30 || Date.now() - (failedAt.get(key) ?? 0) < RETRY_MS || queue.some(q => q.key === key)) return null;
  if (queue.length < 200) queue.push({ key, a, b });
  void next();
  return null;
}

async function next(): Promise<void> {
  if (busy || !queue.length) return;
  const now = Date.now();
  calls = calls.filter(t => now - t < 60_000);
  if (calls.length >= PER_MINUTE) { setTimeout(() => void next(), 5_000).unref(); return; }
  busy = true;
  const { key, a, b } = queue.shift()!;
  calls.push(now);
  try {
    const url = `${CAR}/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson&steps=false`;
    const r = await fetch(url, { headers: { "User-Agent": GEO_USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = (await r.json()) as { routes?: { distance: number; geometry: { coordinates: [number, number][] } }[] };
    const route = j.routes?.[0];
    const pts = (route?.geometry.coordinates ?? []).map(([lo, la]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5] as Pt);
    // détour invraisemblable (sens interdit, rue fermée aux voitures mais ouverte aux bus…) : ligne droite plutôt qu'un faux trajet
    const ok = route && pts.length >= 2 && route.distance < dist(a, b) * 3 + 400;
    known.set(key, ok ? [a, ...pts, b] : null);
    if (ok) counts.calcules++; else counts.refuses++;
    dirty = true;
  } catch {
    counts.erreurs++;
    failedAt.set(key, Date.now());
  } finally {
    busy = false;
    if (queue.length) setTimeout(() => void next(), 1_000).unref();
  }
}

/** Pour /health */
export const roadStatus = (): Record<string, unknown> => ({ connus: known.size, en_attente: queue.length, ...counts });
