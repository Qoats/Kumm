import type { Layer } from "./kinds";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Types numériques de lignes (convention GTFS) */
const GTFS: Record<string, Layer> = { "0": "tram", "1": "tram", "2": "ter", "3": "bus", "11": "bus", "700": "bus", "900": "tram", "100": "ter", "101": "ter", "102": "ter", "109": "ter" };

/** Devine tram / bus / TER d'après les champs « mode », « type » ou « route » d'une ligne */
function modeOf(o: Record<string, unknown>): Layer | undefined {
  const texts: string[] = [];
  const collect = (v: unknown, key: string, depth: number): void => {
    if (depth > 3) return;
    if (typeof v === "number") { if (/route.?type|mode/i.test(key)) texts.push(String(v)); return; }
    if (typeof v === "string") { if (/mode|type|route|categ/i.test(key)) texts.push(v); return; }
    if (Array.isArray(v)) { v.forEach(x => collect(x, key, depth + 1)); return; }
    if (isObj(v)) Object.entries(v).forEach(([k, x]) => collect(x, k, depth + 1));
  };
  collect(o, "", 0);
  for (const t of texts) {
    if (/tram/i.test(t)) return "tram";
    if (/\bter\b|\brail\b|train|ferroviaire/i.test(t)) return "ter";
    if (/\bbus\b|coach|autobus|autocar/i.test(t)) return "bus";
    if (GTFS[t.trim()]) return GTFS[t.trim()];
  }
  return undefined;
}

export interface LineInfo {
  /** { "A": "tram", "10": "bus", … } */
  modes: Record<string, Layer>;
  /** nom public de chaque ligne quand il diffère de son identifiant : { "100": "A" } */
  names: Record<string, string>;
}

/** Lit la réponse lines-discovery : identifiant, nom public et mode de chaque ligne */
export function parseLineInfo(json: unknown): LineInfo {
  const out: LineInfo = { modes: {}, names: {} };
  const walk = (v: unknown, depth: number): void => {
    if (depth > 8) return;
    if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1)); return; }
    if (!isObj(v)) return;
    const str = (k: string): string | undefined => (typeof v[k] === "string" && v[k] !== "" ? (v[k] as string) : undefined);
    const ref = str("LineRef");
    // « LineName » est souvent le nom long du parcours (« Hoenheim Gare - Lingolsheim Tiergaertel ») : on ne garde que les noms courts
    const short = (x: string | undefined): string | undefined => (x && x.length <= 5 && !/\s/.test(x) ? x : undefined);
    const pub = short(str("PublishedLineName")) ?? short(str("LineName")) ?? short(str("Name"));
    const ids = [...new Set([ref, pub, str("PublishedLineName"), str("LineName")].filter((x): x is string => !!x))];
    if (ids.length) {
      const m = modeOf(v);
      if (m) ids.forEach(id => { out.modes[id] = m; });
      if (ref && pub && ref !== pub) out.names[ref] = pub;
      return;
    }
    Object.values(v).forEach(x => walk(x, depth + 1));
  };
  walk(json, 0);
  return out;
}

/** Ancienne forme : seulement les modes */
export const parseLineModes = (json: unknown): Record<string, Layer> => parseLineInfo(json).modes;
