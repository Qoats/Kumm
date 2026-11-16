/**
 * Données des widgets Android (écran d'accueil du téléphone) : réponses courtes, tirées de la mémoire du serveur
 * (photo du réseau CTS, trains SNCF, infos trafic, Vélhop et P+R), sans appel supplémentaire à la CTS.
 *   /api/widget/stop?refs=…&sncf=…    prochains passages d'un arrêt (codes de l'arrêt et de ses quais ; gare SNCF éventuelle) ;
 *                                     &only=C|Gare Centrale~B|Hoenheim Gare : seulement ces lignes et directions
 *   /api/widget/nearby?lat=…&lon=…    arrêt le plus proche qui a encore des passages
 *   /api/widget/traffic?lines=A,C     infos trafic des lignes suivies
 *   /api/widget/poi?id=velhop-…|pr-…  vélos ou places disponibles
 * Les heures sont en millisecondes ; le widget les affiche en heure de passage (« 18:44 »).
 */
import { CTS_LIVE } from "./config.js";
import { scheduledNearby, scheduledVisits } from "./schedule.js";
import type { CtsResult } from "./cts.js";
import type { TrafficMessage } from "./messages.js";
import { nearestWithDepartures, upcomingFor } from "./realtime.js";
import type { WidgetVisit } from "./realtime.js";
import { isFollowedStation, trainDepartures } from "./ter.js";

interface Dep { l: string; d: string; t: number[]; rt: boolean; x?: number[] }
const json = (body: unknown, status = 200): CtsResult => ({ status, type: "application/json; charset=utf-8", body: JSON.stringify(body) });
const list = (v: string | null, max: number): string[] => (v ?? "").split(",").map(s => s.trim()).filter(s => s && s.length <= 40).slice(0, max);

/** Passages regroupés par ligne et direction (3 heures au plus chacune), triés par premier départ */
function group(visits: WidgetVisit[], max = 6): Dep[] {
  const by = new Map<string, Dep>();
  for (const v of visits.sort((a, b) => a.time - b.time)) {
    const g = by.get(v.line + "|" + v.dest) ?? by.set(v.line + "|" + v.dest, { l: v.line, d: v.dest, t: [], rt: false }).get(v.line + "|" + v.dest)!;
    if (v.cancelled) { (g.x ??= []).push(v.time); continue; }
    if (g.t.length < 3) g.t.push(v.time);
    if (v.rt) g.rt = true;
  }
  return [...by.values()].filter(g => g.t.length).sort((a, b) => a.t[0] - b.t[0]).slice(0, max);
}

function trains(uic: string): Dep[] {
  if (!isFollowedStation(uic)) return [];
  const by = new Map<string, Dep>();
  for (const t of trainDepartures(uic)) {
    const g = by.get(t.dest) ?? by.set(t.dest, { l: "TER", d: t.dest, t: [], rt: false }).get(t.dest)!;
    if (t.cancelled) { (g.x ??= []).push(t.aim); continue; }
    if (g.t.length < 3) g.t.push(t.t);
    if (t.delay !== undefined) g.rt = true;
  }
  return [...by.values()].filter(g => g.t.length);
}

/** Valeurs lues dans le texte des Vélhop (« 3 vélos disponibles · 2 places libres ») et des P+R (« 212 places libres sur 600 ») */
function poiNumbers(id: string, info: string): Record<string, number | null> {
  const n = (re: RegExp): number | null => { const m = re.exec(info); return m ? Number(m[1]) : null; };
  return id.startsWith("velhop")
    ? { velos: n(/(\d+)\s+vélos?/), places: n(/(\d+)\s+places?\s+libres?/) }
    : { libres: n(/(\d+)\s+places?\s+libres?/), total: n(/sur\s+(\d+)/) ?? n(/^(\d+)\s+places?$/) };
}

export async function widgetData(
  name: string, url: URL, messages: () => Promise<TrafficMessage[]>,
  pois: (kind: "velhop" | "pr") => Promise<{ id: string; name: string; info?: string }[]>
): Promise<CtsResult> {
  const now = Date.now(), q = url.searchParams;
  if (name === "stop") {
    const refs = list(q.get("refs"), 40), sncf = q.get("sncf") ?? "";
    const theoretical = !CTS_LIVE && q.get("gtfs") === "1";
    const v = theoretical ? scheduledVisits(refs, now, 150) : CTS_LIVE && refs.length ? upcomingFor(refs, now) : [];
    if (v === null && !sncf) return json({ erreur: "Passages momentanément indisponibles" }, 503);
    // directions choisies pour ce widget (« ligne|destination », séparées par ~) ; sinon toutes
    const only = (q.get("only") ?? "").split("~").filter(Boolean).slice(0, 20);
    const all = [...group(v ?? [], 40), ...(sncf ? trains(sncf) : [])].filter(g => !only.length || only.includes(g.l + "|" + g.d));
    const deps = all.sort((a, b) => a.t[0] - b.t[0]).slice(0, 6);
    return json({ now, deps, scheduled: theoretical && deps.some(d => d.l !== "TER") });
  }
  if (name === "nearby") {
    const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
    if (!(Math.abs(lat - 48.58) < 0.6 && Math.abs(lon - 7.75) < 0.8)) return json({ erreur: "Position hors de l'Eurométropole" }, 400);
    if (!CTS_LIVE) {
      const s = q.get("gtfs") === "1" ? scheduledNearby(lat, lon, now) : null;
      return json(s ? { now, name: s.name, dist: s.dist, deps: group(s.visits, 4), scheduled: true } : { now, deps: [] });
    }
    const s = nearestWithDepartures(lat, lon, now);
    if (!s) return json({ now, deps: [] });
    return json({ now, name: s.name, dist: s.dist, deps: group(upcomingFor(s.codes, now) ?? [], 4) });
  }
  if (name === "traffic") {
    const lines = list(q.get("lines"), 60);
    const items = (await messages()).filter(m => lines.includes("*") || m.lines.some(l => lines.includes(l)))
      .sort((a, b) => (a.channel === "disruption" ? 0 : 1) - (b.channel === "disruption" ? 0 : 1));
    return json({ now, n: items.length, items: items.slice(0, 3).map(m => ({ t: m.title, l: m.lines.filter(l => lines.includes(l) || lines.includes("*")).slice(0, 6), c: m.channel, p: m.period })) });
  }
  if (name === "poi") {
    const id = q.get("id") ?? "";
    const kind = id.startsWith("velhop-") ? "velhop" : id.startsWith("pr-") ? "pr" : null;
    if (!kind) return json({ erreur: "Lieu inconnu" }, 404);
    const p = (await pois(kind)).find(x => x.id === id);
    if (!p) return json({ erreur: "Lieu introuvable" }, 404);
    return json({ now, name: p.name, kind, ...poiNumbers(id, p.info ?? "") });
  }
  return json({ erreur: "Widget inconnu" }, 404);
}
