import type { ServerResponse } from "node:http";
import { AUTH, BASE, CTS_LIVE, REQUESTOR, ROOT, TOKEN } from "./config.js";
import { ctsPaused, describeError } from "./cts.js";
import { GEO_USER_AGENT, TRANSIT } from "./geo.js";
import { send } from "./http.js";
import { OCCUPATION, VELHOP_INFO, velhop } from "./poi.js";
import { TILE_ORIGIN } from "./tiles.js";

/* ---------- /diag : contrôle de la connexion, sans afficher le token ---------- */
interface Probe { status?: number; type?: string; error?: string; text?: string }
async function probe(url: string, headers: Record<string, string> = {}, wantText = false): Promise<Probe> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal, redirect: "error" });
    const type = r.headers.get("content-type") ?? "";
    return { status: r.status, type, text: wantText ? (await r.text()).slice(0, 4_000_000) : undefined };
  } catch (e) {
    return { error: describeError(e) };
  } finally {
    clearTimeout(to);
  }
}
const brief = (p: Probe): string => (p.error ? "ERREUR : " + p.error : String(p.status));

let lastDiag = 0;
export async function diag(res: ServerResponse): Promise<void> {
  if (!CTS_LIVE) return send(res, 404, "text/plain", "Diagnostic indisponible");
  if (Date.now() - lastDiag < 10_000) return send(res, 429, "text/plain", "Patientez 10 secondes entre deux diagnostics");
  lastDiag = Date.now();
  const origin = new URL(ROOT).origin;
  const hdr = { Authorization: AUTH, Accept: "application/json" };

  const hosts = [`https://www.cts-strasbourg.eu`, `https://opendata.cts-strasbourg.eu`, origin];
  const reseau = Object.fromEntries(await Promise.all(hosts.map(async h => [h, brief(await probe(h))])));
  const siri = brief(await probe(`${BASE}/lines-discovery?RequestorRef=${REQUESTOR}`, hdr));

  const donnees: Record<string, string> = {};
  for (const name of ["park-and-ride", "veloparc", "retail-outlet"]) {
    for (const base of [ROOT, BASE]) donnees[`${base}/${name}`] = brief(await probe(`${base}/${name}?RequestorRef=${REQUESTOR}`, hdr));
  }

  // à la recherche d'une description de l'API (swagger) pour connaître les vrais chemins
  const docs: Record<string, string> = {};
  let chemins: string[] | undefined;
  for (const c of ["/swagger", "/swagger.json", "/swagger/v1/swagger.json", "/v1/swagger.json", "/openapi.json", "/v1/openapi.json", "/docs", "/v1/docs", "/api-docs", "/v1"]) {
    const r = await probe(origin + c, hdr, true);
    docs[origin + c] = brief(r);
    if (!chemins && r.text && r.status === 200) {
      try {
        const j = JSON.parse(r.text) as { paths?: Record<string, unknown> };
        if (j.paths) { chemins = Object.keys(j.paths).slice(0, 120); docs[origin + c] += " (description trouvée)"; }
      } catch { /* pas du JSON */ }
    }
  }

  // échantillons de données brutes, pour comprendre comment les lignes sont désignées
  const echantillons: Record<string, unknown> = {};
  try {
    const sp = await probe(`${BASE}/stoppoints-discovery?RequestorRef=${REQUESTOR}`, hdr, true);
    const st = (JSON.parse(sp.text ?? "{}") as { StopPointsDelivery?: { AnnotatedStopPointRef?: { Lines?: unknown[] }[] } }).StopPointsDelivery?.AnnotatedStopPointRef ?? [];
    const vues = new Set<string>();
    st.forEach(a => (a.Lines ?? []).forEach(l => vues.add(typeof l === "string" ? l : JSON.stringify(l))));
    echantillons["arrets"] = { total: st.length, avec_lignes: st.filter(a => (a.Lines ?? []).length > 0).length, lignes_vues_sur_les_arrets: [...vues].slice(0, 40), exemples: st.slice(0, 2) };
  } catch (e) { echantillons["arrets"] = "illisible : " + describeError(e); }
  try {
    const lp = await probe(`${BASE}/lines-discovery?RequestorRef=${REQUESTOR}`, hdr, true);
    const ln = (JSON.parse(lp.text ?? "{}") as { LinesDelivery?: { AnnotatedLineRef?: unknown[] } }).LinesDelivery?.AnnotatedLineRef ?? [];
    echantillons["lignes"] = { total: ln.length, exemples: ln.slice(0, 3) };
  } catch (e) { echantillons["lignes"] = "illisible : " + describeError(e); }

  // calculateur d'itinéraires en transports : Hoenheim → Gare Centrale
  let transitous: unknown;
  try {
    const tp = await probe(`${TRANSIT}?fromPlace=48.6190,7.7510&toPlace=48.5849,7.7352&numItineraries=3&language=fr`, { "User-Agent": GEO_USER_AGENT, Accept: "application/json" }, true);
    if (tp.error) transitous = "ERREUR : " + tp.error;
    else {
      const j = JSON.parse(tp.text ?? "{}") as { itineraries?: { duration: number; transfers: number; legs: { mode: string; routeShortName?: string }[] }[] };
      transitous = { statut: tp.status, nb_trajets: j.itineraries?.length ?? 0,
        premier: j.itineraries?.[0] ? { minutes: Math.round(j.itineraries[0].duration / 60), correspondances: j.itineraries[0].transfers, etapes: j.itineraries[0].legs.map(l => l.routeShortName ? `${l.mode} ${l.routeShortName}` : l.mode) } : null };
    }
  } catch (e) { transitous = "illisible : " + describeError(e); }

  // sources des catégories de la carte
  const sources: Record<string, string> = {};
  sources["tuiles de carte"] = brief(await probe(`${TILE_ORIGIN}/0/0/0.png`, { "User-Agent": GEO_USER_AGENT }));
  try { const v = await velhop(); sources["Vélhop (GBFS)"] = `${v.length} stations`; } catch (e) { sources["Vélhop (GBFS)"] = "ERREUR : " + describeError(e); }
  const occ = await probe(OCCUPATION, { "User-Agent": GEO_USER_AGENT, Accept: "application/json" }, true);
  sources["occupation des parkings (open data)"] = occ.error ? "ERREUR : " + occ.error : `HTTP ${occ.status}`;
  sources["adresse du flux Vélhop"] = VELHOP_INFO;

  const out = {
    version_node: process.version,
    token: { defini: Boolean(TOKEN) },   // jamais la moindre partie du jeton
    requestor_ref: REQUESTOR,
    pause_cts: ctsPaused(),
    reseau,
    siri_lines_discovery: siri,
    donnees_poi: donnees,
    transitous,
    sources_carte: sources,
    echantillons,
    documentation_api: docs,
    chemins_de_l_api: chemins ?? "aucune description trouvée"
  };
  send(res, 200, "application/json; charset=utf-8", JSON.stringify(out, null, 2));
}

