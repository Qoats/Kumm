export interface LL { lat: number; lon: number }

const R = 6371000;
const rad = (d: number): number => (d * Math.PI) / 180;

/** Distance entre deux points, en mètres */
export function haversine(a: LL, b: LL): number {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance (m) entre un point et le tracé [lon, lat][] */
export function distToRoute(p: LL, coords: [number, number][]): number {
  if (!coords.length) return Infinity;
  const xy = (c: [number, number]) => ({ x: rad(c[0] - p.lon) * Math.cos(rad(p.lat)) * R, y: rad(c[1] - p.lat) * R });
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = xy(coords[i]), b = xy(coords[i + 1]);
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return coords.length === 1 ? haversine(p, { lon: coords[0][0], lat: coords[0][1] }) : best;
}

/** Distance cumulée (m) le long du tracé, un point par sommet */
export function cumulative(coords: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    out.push(out[i - 1] + haversine({ lon: coords[i - 1][0], lat: coords[i - 1][1] }, { lon: coords[i][0], lat: coords[i][1] }));
  }
  return out;
}

/** Point situé à la distance d (m) du début du tracé */
export function pointAt(coords: [number, number][], cum: number[], d: number): LL {
  const last = coords.length - 1;
  if (d <= 0) return { lon: coords[0][0], lat: coords[0][1] };
  if (d >= cum[last]) return { lon: coords[last][0], lat: coords[last][1] };
  let i = 1;
  while (cum[i] < d) i++;
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return { lon: coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]), lat: coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1]) };
}

export const fmtDist = (m: number): string =>
  m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;

export const fmtMin = (sec: number): string => `${Math.max(1, Math.round(sec / 60))} min`;

/** Durée à la façon d'un calculateur d'itinéraire : « 26 min », « 1 h 16 » */
export function fmtDur(sec: number): string {
  const m = Math.max(1, Math.round(sec / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** Durée de marche estimée à vol d'oiseau (×1,25 pour les détours, 80 m/min) */
export const walkMin = (m: number): number => Math.max(1, Math.round((m * 1.25) / 80));
