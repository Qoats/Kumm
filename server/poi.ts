/** Points d'intérêt (Vélhop, parkings relais) : sources ouvertes, résultat simplifié pour l'application. */
import { fetchRetry } from "./cts.js";
import type { CtsResult } from "./cts.js";
import { GEO_USER_AGENT } from "./geo.js";
import { PR_SITES } from "./poi-data.js";

export const VELHOP_INFO = process.env.VELHOP_INFO ?? "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_ae/fr/station_information.json";
export const VELHOP_STATUS = process.env.VELHOP_STATUS ?? "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_ae/fr/station_status.json";
export const OCCUPATION = process.env.OCCUPATION_URL ?? "https://data.strasbourg.eu/api/explore/v2.1/catalog/datasets/occupation-parkings-temps-reel/records?limit=100";

export interface PoiItem { id: string; name: string; lat: number; lon: number; info?: string }

const HEADERS = { "User-Agent": GEO_USER_AGENT, Accept: "application/json" };
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const json = (r: CtsResult): unknown => { if (r.status !== 200) throw new Error("HTTP " + r.status); return JSON.parse(r.body); };

/** minuscules sans accents ni ponctuation */
export const norm = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* ---------- Vélhop : flux GBFS (stations + disponibilités) ---------- */
interface GbfsStations { data?: { stations?: Record<string, unknown>[] } }

export function mergeGbfs(info: unknown, status: unknown): PoiItem[] {
  const st = new Map<string, Record<string, unknown>>();
  for (const s of (status as GbfsStations)?.data?.stations ?? []) st.set(String(s["station_id"]), s);
  const out: PoiItem[] = [];
  for (const s of (info as GbfsStations)?.data?.stations ?? []) {
    const lat = num(s["lat"]), lon = num(s["lon"]);
    if (lat === null || lon === null) continue;
    const id = String(s["station_id"]), live = st.get(id);
    const bikes = live ? num(live["num_bikes_available"]) : null, docks = live ? num(live["num_docks_available"]) : null;
    const parts: string[] = [];
    if (bikes !== null) parts.push(`${bikes} vélo${bikes > 1 ? "s" : ""} disponible${bikes > 1 ? "s" : ""}`);
    if (docks !== null) parts.push(`${docks} place${docks > 1 ? "s" : ""} libre${docks > 1 ? "s" : ""}`);
    out.push({ id: "velhop-" + id, name: String(s["name"] ?? "Station Vélhop"), lat, lon, info: parts.length ? parts.join(" · ") : undefined });
  }
  return out;
}

export async function velhop(): Promise<PoiItem[]> {
  const [i, s] = await Promise.all([fetchRetry(VELHOP_INFO, HEADERS), fetchRetry(VELHOP_STATUS, HEADERS).catch(() => null)]);
  return mergeGbfs(json(i), s ? (() => { try { return json(s); } catch { return null; } })() : null);
}

/* ---------- Parkings relais : liste fixe + occupation en direct ---------- */
/** Associe les enregistrements d'occupation (open data de l'Eurométropole) aux P+R par leur nom */
export function applyOccupation(records: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const list = isObj(records) && Array.isArray(records["results"]) ? (records["results"] as unknown[]) : Array.isArray(records) ? records : [];
  for (const r of list) {
    if (!isObj(r)) continue;
    const key = (re: RegExp) => Object.keys(r).find(k => re.test(k));
    const nk = key(/^(nom|name|libelle)$/i) ?? key(/nom|name|libell/i);
    const name = nk && typeof r[nk] === "string" ? norm(r[nk] as string) : "";
    const free = num(r[key(/libre|free|dispo/i) ?? ""]), total = num(r[key(/^total$|capac|max/i) ?? ""]);
    if (!name || free === null) continue;
    for (const p of PR_SITES) {
      const pn = norm(p.name);
      if (name.includes(pn) || (pn.length > 5 && pn.includes(name) && name.length > 4)) {
        out.set(p.id, `${free} places libres sur ${total ?? p.capacity}`);
      }
    }
  }
  return out;
}

export async function parkingsRelais(): Promise<PoiItem[]> {
  let live = new Map<string, string>();
  try { live = applyOccupation(json(await fetchRetry(OCCUPATION, HEADERS))); } catch { /* occupation indisponible : on garde la liste fixe */ }
  return PR_SITES.map(p => ({ id: p.id, name: `P+R ${p.name}`, lat: p.lat, lon: p.lon, info: live.get(p.id) ?? `${p.capacity} places` }));
}

export const poiResult = (items: PoiItem[]): CtsResult => ({ status: 200, type: "application/json", body: JSON.stringify({ items }) });
