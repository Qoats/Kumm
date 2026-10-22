/** Lecture tolérante d'une réponse JSON : retrouve tous les objets qui ont des coordonnées (nom, position, places). */

export interface RawPoint { name: string; lat: number; lon: number; info?: string }

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const find = (o: Record<string, unknown>, re: RegExp): unknown => {
  const k = Object.keys(o).find(key => re.test(key));
  return k === undefined ? undefined : o[k];
};

function coordsOf(o: Record<string, unknown>): { lat: number; lon: number } | null {
  const direct = (x: Record<string, unknown>) => {
    const lat = num(find(x, /^(lat|latitude)$/i)), lon = num(find(x, /^(lon|lng|long|longitude)$/i));
    return lat !== null && lon !== null ? { lat, lon } : null;
  };
  const d = direct(o);
  if (d) return d;
  for (const key of ["Location", "location", "Position", "position", "Coordinates", "coordinates", "geometry", "Geometry"]) {
    const c = o[key];
    if (Array.isArray(c) && c.length >= 2 && num(c[0]) !== null && num(c[1]) !== null) return { lon: num(c[0]) as number, lat: num(c[1]) as number };
    if (isObj(c)) {
      const r = direct(c) ?? (Array.isArray(c["coordinates"]) ? coordsOf({ coordinates: c["coordinates"] }) : null);
      if (r) return r;
    }
  }
  return null;
}

function nameOf(o: Record<string, unknown>): string {
  for (const re of [/^(name|nom|stopname|locationname|label|libelle|title)$/i, /name|nom|label|libell/i, /^description$/i]) {
    const v = find(o, re);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "Sans nom";
}

function infoOf(o: Record<string, unknown>): string | undefined {
  const free = num(find(o, /(free|libre|dispo|avail)/i));
  const cap = num(find(o, /(capac|total|max|nb.?places)/i));
  if (free !== null && cap !== null) return `${free} places libres sur ${cap}`;
  if (free !== null) return `${free} places libres`;
  if (cap !== null) return `${cap} places`;
  return undefined;
}

export function extractPoints(json: unknown): RawPoint[] {
  const out: RawPoint[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 7) return;
    if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1)); return; }
    if (!isObj(v)) return;
    const c = coordsOf(v);
    if (c && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180) {
      // GeoJSON : le nom et les places sont dans « properties », à côté des coordonnées
      const props = isObj(v["properties"]) ? { ...(v["properties"] as Record<string, unknown>), ...v } : v;
      const name = nameOf(props), key = `${name}|${c.lat.toFixed(5)}|${c.lon.toFixed(5)}`;
      if (!seen.has(key)) { seen.add(key); out.push({ name, lat: c.lat, lon: c.lon, info: infoOf(props) }); }
      return;
    }
    Object.values(v).forEach(x => walk(x, depth + 1));
  };
  walk(json, 0);
  return out;
}
