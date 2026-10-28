/**
 * Tuiles « Maison » et « Travail » de l'accueil : le meilleur trajet en transports depuis ma position vers chaque adresse
 * enregistrée, recalculé au plus toutes les 2 minutes (et quand on s'est déplacé de plus de 300 m).
 */
import { haversine } from "./geo";
import { S, USER, render } from "./store";
import type { PlaceKey } from "./store";
import { fetchTransit } from "./transit";
import type { Journey } from "./transit";

const MAX_AGE = 120_000;
interface Commute { at: number; from: { lat: number; lon: number }; to: string; j?: Journey; error?: boolean }
const cache = new Map<PlaceKey, Commute>();
const running = new Set<PlaceKey>();

/** Trajet connu vers l'adresse (null : en cours de calcul) ; lance le calcul s'il manque ou date */
export function commuteTo(which: PlaceKey): Commute | null {
  const p = S.places[which];
  if (!p) return null;
  const to = `${p.lat},${p.lon}`, c = cache.get(which);
  const fresh = c && c.to === to && Date.now() - c.at < MAX_AGE && haversine(c.from, USER) < 300;
  if (!fresh && !running.has(which)) {
    running.add(which);
    const from = { lat: USER.lat, lon: USER.lon };
    fetchTransit(from, p)
      .then(list => {
        // le trajet qui arrive le plus tôt, parmi ceux qui ne sont pas déjà partis
        const j = list.filter(x => x.start > Date.now() - 60_000).sort((a, b) => a.end - b.end)[0];
        cache.set(which, { at: Date.now(), from, to, j });
      })
      .catch(() => cache.set(which, { at: Date.now(), from, to, error: true }))
      .finally(() => { running.delete(which); if (S.tab === "home" && !S.overlay) render(); });
  }
  return c && c.to === to ? c : null;
}
