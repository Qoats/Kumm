/**
 * Départs plus tôt qu'annoncé : la CTS annonçait encore un départ à venir, puis, à la mise à jour suivante, donne une heure
 * de départ déjà passée et bien plus tôt. Entre les deux, la carte montrait le véhicule en retard sur la réalité.
 * Seul un compte et les derniers exemples sont gardés (en mémoire), pour voir à quelles heures et sur quelles lignes ça arrive.
 */
import type { Course } from "./realtime.js";

const MIN_GAP = 45_000, KEEP = 24 * 3600_000;
let prev = new Map<string, number>(), prevAt = 0;
const seen: { at: number; line: string; stop: string; s: number }[] = [];
const hm = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

export function recordEarly(list: Course[], now = Date.now()): void {
  const next = new Map<string, number>();
  for (const c of list) {
    if (c.mode === "ter") continue;
    c.calls.forEach((x, i) => {
      if (x.est || !Number.isFinite(x.dep)) return;
      const key = `${c.id}|${i}|${x.code}`, old = prev.get(key);
      next.set(key, x.dep);
      // annoncé à venir à la mise à jour précédente, déjà parti maintenant, et bien plus tôt
      if (old !== undefined && prevAt && old > prevAt && x.dep <= now && old - x.dep >= MIN_GAP)
        seen.push({ at: now, line: c.line, stop: x.name, s: Math.round((old - x.dep) / 1000) });
    });
  }
  prev = next; prevAt = now;
  while (seen.length && seen[0].at < now - KEEP) seen.shift();
}

export const earlyStatus = (): Record<string, unknown> => ({
  dernieres_24h: seen.length,
  exemples: seen.slice(-12).map(e => `${hm.format(e.at)} ${e.line} ${e.stop} : ${e.s} s plus tôt`)
});
