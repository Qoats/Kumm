/**
 * Bus ou tram bloqué (panne, accident, bouchon) : la CTS ne publie pas la position des véhicules, mais quand l'un d'eux
 * n'avance plus, son système de suivi repousse l'heure d'arrivée au prochain arrêt à chaque mise à jour, d'à peu près le
 * temps écoulé. Sans cette détection, le véhicule glissait lentement vers l'arrêt sur la carte, comme s'il roulait.
 * Ici : 6 mises à jour de suite (≈ 3 min) où l'heure d'arrivée recule d'au moins 60 % du temps écoulé = véhicule immobilisé.
 * Il est alors affiché immobile à l'endroit estimé au début du blocage, jusqu'à ce que ses horaires avancent de nouveau.
 * Seules les courses suivies en temps réel par la CTS sont concernées (les autres n'ont que des horaires théoriques).
 */
import type { Course } from "./realtime.js";

const PUSHES = 6, RATIO = 0.6;

interface Track {
  key: string;          // tronçon ou arrêt en cours (index du passage, à quai ou non)
  at: number;           // heure de la mise à jour précédente
  t: number;            // heure annoncée à ce moment-là (départ si à quai, sinon arrivée au prochain arrêt)
  pushes: number;
  since: number;        // début du blocage (première heure repoussée)
  f: number;            // avancement sur le tronçon au début du blocage (0 = au départ de l'arrêt)
}
const tracks = new Map<string, Track>();
const counts = { immobilises: 0 };

/** Position d'une course : à quai à l'arrêt k, ou entre k et k + 1 ; null si pas encore partie ou arrivée */
function where(c: Course, now: number): { k: number; quay: boolean; t: number; f: number } | null {
  const cs = c.calls;
  for (let k = 0; k < cs.length; k++) {
    if (now >= cs[k].arr && now <= cs[k].dep) return { k, quay: true, t: cs[k].dep, f: 0 };
    const n = cs[k + 1];
    if (n && now > cs[k].dep && now < n.arr) return { k, quay: false, t: n.arr, f: Math.min(1, (now - cs[k].dep) / Math.max(1, n.arr - cs[k].dep)) };
  }
  return null;
}

/** À chaque nouvelle photo du réseau : met à jour le suivi des heures repoussées */
export function updateStalls(list: Course[], now = Date.now()): void {
  const seen = new Set<string>();
  for (const c of list) {
    if (!c.realTime) continue;
    const w = where(c, now);
    if (!w) continue;
    seen.add(c.id);
    const key = `${w.k}|${w.quay}`, prev = tracks.get(c.id);
    if (!prev || prev.key !== key) { tracks.set(c.id, { key, at: now, t: w.t, pushes: 0, since: now, f: w.f }); continue; }
    const elapsed = now - prev.at, pushed = w.t - prev.t;
    if (elapsed > 0 && pushed >= elapsed * RATIO) {
      if (prev.pushes === 0) { prev.since = prev.at; prev.f = Math.min(prev.f, w.f); }
      prev.pushes++;
    } else { prev.pushes = 0; prev.f = w.f; }
    prev.at = now; prev.t = w.t;
  }
  for (const id of tracks.keys()) if (!seen.has(id)) tracks.delete(id);
  counts.immobilises = [...tracks.values()].filter(t => t.pushes >= PUSHES).length;
}

/** Course immobilisée : arrêt k (à quai) ou tronçon k → k + 1 à l'avancement f, depuis `since` ; null sinon */
export function stallOf(id: string): { k: number; quay: boolean; f: number; since: number } | null {
  const t = tracks.get(id);
  if (!t || t.pushes < PUSHES) return null;
  const [k, quay] = t.key.split("|");
  return { k: Number(k), quay: quay === "true", f: t.f, since: t.since };
}

/** Pour /health */
export const stallStatus = (): Record<string, unknown> => ({ suivis: tracks.size, ...counts });
