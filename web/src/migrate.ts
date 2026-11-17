import type { Stop } from "../../shared/types";
const name = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Keep unknown favourites: another source update may restore a renamed or temporarily absent stop. */
export function migrateFavourites(ids: string[], old: Stop[], current: Stop[]): string[] {
  return [...new Set(ids.map(id => {
    if (current.some(s => s.id === id)) return id;
    const prior = old.find(s => s.id === id);
    const byRef = current.find(s => s.refs?.includes(id) || prior?.refs?.some(r => s.refs?.includes(r)));
    if (byRef) return byRef.id;
    if (!prior) return id;
    return current.find(s => name(s.name) === name(prior.name) && Math.hypot(s.lat - prior.lat, s.lon - prior.lon) < .002)?.id ?? id;
  }))];
}
