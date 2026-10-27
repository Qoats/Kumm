import type { Place } from "../../shared/types";
import { startNav, startTransitNav } from "./nav";
import type { TransitStatus, TransitStop } from "./nav";
import { fetchWalk } from "./walk";
import { JOURNEYS, PLAN, TRIP } from "./trip";
import { hm } from "./transit";
import { followRoute, legState, legStops, skipLeg, stopJourney } from "./journey";
import { COLORS, lineKind, lineLabel, lineText } from "./data";
import { fmtMin, haversine } from "./geo";
import { toast } from "./store";

const fail = (): void => toast("Itinéraire à pied indisponible pour le moment");

/** Étape d'une navigation de bout en bout : marche (consignes pas à pas) ou trajet en tram, bus ou train */
type Phase =
  | { kind: "walk"; from: Place; to: Place }
  | { kind: "ride"; line: string; mode: string; headsign?: string; from: Place; to: Place; start?: number; end?: number;
      path: [number, number][]; color?: string;
      /** indice de l'étape dans la liste donnée à followRoute (alertes de descente) ; -1 : non suivie (train) */
      follow: number };

/** Lance le guidage : « walk » (tout à pied), « j:N » (trajet N du calculateur) ou « board:LIGNE » (repli : ligne directe) */
export async function launchNav(kind: string): Promise<void> {
  const plan = PLAN;
  if (!plan) return;
  if (kind.startsWith("j:")) return launchJourney(Number(kind.slice(2)));
  if (kind === "walk") {
    try {
      // déjà calculé pour l'écran Itinéraires : pas de nouvel appel
      const route = TRIP?.walk.data && TRIP.origin === plan.origin ? TRIP.walk.data : await fetchWalk(plan.origin, plan.dest);
      startNav({ title: `À pied vers ${plan.dest.label}`, route, dest: plan.dest });
    } catch { fail(); }
    return;
  }
  const line = kind.split(":")[1] ?? "";
  const leg = plan.lines[line];
  if (!leg) return;
  const board: Place = { label: leg.board.name, lat: leg.board.lat, lon: leg.board.lon };
  const alight: Place = { label: leg.alight.name, lat: leg.alight.lat, lon: leg.alight.lon };
  followRoute([{ line, start: Date.now(), from: leg.board, to: leg.alight }]);
  runPhases([
    { kind: "walk", from: plan.origin, to: board },
    { kind: "ride", line, mode: lineKind(line), from: board, to: alight, path: [[board.lat, board.lon], [alight.lat, alight.lon]], follow: 0 },
    { kind: "walk", from: alight, to: plan.dest }
  ], plan.dest);
}

/** Navigation de bout en bout d'un trajet du calculateur : marche jusqu'à l'arrêt, attente, trajet à bord (arrêts restants,
    alertes de descente), correspondances, puis marche jusqu'à la destination. Les étapes s'enchaînent d'elles-mêmes. */
function launchJourney(i: number): void {
  const plan = PLAN, j = JOURNEYS[i];
  if (!plan || !j) return;
  const followed = j.legs.filter(l => (l.kind === "tram" || l.kind === "bus") && l.line);
  // alertes de descente et partage de la position à bord (amélioration de la position des véhicules), voir journey.ts
  followRoute(followed.map(l => ({ line: l.line ?? "", headsign: l.headsign, start: l.start, from: l.from, to: l.to })));
  const place = (p: { name: string; lat: number; lon: number }, fallback: string): Place => ({ label: p.name || fallback, lat: p.lat, lon: p.lon });
  const phases: Phase[] = [];
  let at: Place = plan.origin;
  for (const l of j.legs) {
    if (l.kind === "walk") continue;
    const from = place(l.from, "l’arrêt de départ"), to = place(l.to, "l’arrêt d’arrivée");
    // marche jusqu'à l'arrêt (ou correspondance) ; même quai ou quelques mètres : pas d'étape à pied
    if (haversine(at, from) > 60) phases.push({ kind: "walk", from: at, to: from });
    phases.push({
      kind: "ride", line: l.line ?? "?", mode: l.kind, headsign: l.headsign, from, to, start: l.start, end: l.end,
      path: l.path.length > 1 ? l.path : [[from.lat, from.lon], [to.lat, to.lon]], color: l.color, follow: followed.indexOf(l)
    });
    at = to;
  }
  if (haversine(at, plan.dest) > 30 || !phases.length) phases.push({ kind: "walk", from: at, to: plan.dest });
  runPhases(phases, plan.dest);
}

/** Lance l'étape k, puis la suivante à son arrivée */
function runPhases(phases: Phase[], dest: Place, k = 0): void {
  const p = phases[k];
  if (!p) return;
  const last = k === phases.length - 1;
  const next = last ? undefined : () => runPhases(phases, dest, k + 1);
  const onQuit = (): void => stopJourney();
  if (p.kind === "walk") {
    const title = last ? `À pied vers ${dest.label}` : `Vers l’arrêt ${p.to.label}`;
    fetchWalk(p.from, p.to)
      .then(route => startNav({ title, route, dest: p.to, next, onQuit }))
      .catch(() => { fail(); next?.(); });
    return;
  }
  const label = lineLabel(p.line);
  startTransitNav({
    title: `${label} jusqu’à ${p.to.label}`,
    path: p.path.map(([lat, lon]) => [lon, lat] as [number, number]),
    dest: p.to, line: label, caption: `${p.mode === "bus" ? "Bus" : p.mode === "tram" ? "Tram" : "Train"}${p.headsign ? ` vers ${p.headsign}` : ""}`, color: COLORS[label] ?? p.color ?? "#136342", ink: COLORS[label] ? lineText(label) : "#fff",
    status: () => rideStatus(p),
    skip: () => { if (p.follow >= 0) skipLeg(p.follow); },
    next, onQuit
  });
}

/** Ce qu'affiche le guidage pendant une étape en transport : d'après la course suivie (journey.ts), sinon les horaires */
function rideStatus(p: Extract<Phase, { kind: "ride" }>): TransitStatus {
  const now = Date.now(), label = lineLabel(p.line), to = p.to.label;
  const st = p.follow >= 0 ? legState(p.follow) : null;
  const ended: TransitStatus = { done: true, boarded: true, title: "", sub: "", big: "", bigLabel: "", stops: [] };
  if (st?.done) return ended;
  // arrêts de la montée à la descente : ceux de la course suivie, sinon les deux extrémités
  const ls = p.follow >= 0 ? legStops(p.follow) : null;
  const calls = ls?.calls ?? [{ name: p.from.label, arr: p.start ?? 0 }, { name: to, arr: p.end ?? 0 }];
  const boarded = st ? st.boarded : p.start !== undefined && now >= p.start;
  if (!st && p.end !== undefined && now > p.end + 60_000) return ended;
  const at = boarded ? (ls ? ls.at : 1) : 0, last = calls.length - 1;
  const stops: TransitStop[] = calls.map((c, i) => ({
    name: c.name, time: c.arr || undefined,
    state: i === last ? "end" : i === at ? "now" : i < at ? "past" : "next"
  }));
  const shown = boarded ? stops.slice(Math.max(0, at - 1)) : stops;
  if (!boarded) {
    const eta = st ? Math.max(0, st.eta) : p.start !== undefined ? Math.max(0, p.start - now) : null;
    const dep = eta !== null ? now + eta : null;
    return {
      done: false, boarded: false, title: `Prenez le ${label}`, sub: `à ${p.from.label}`,
      big: eta === null ? "—" : eta < 60_000 ? "À quai" : fmtMin(eta / 1000),
      bigLabel: dep === null ? "en attente des horaires" : eta! < 60_000 ? "le véhicule arrive" : `avant le départ · ${hm(dep)}`,
      stops: shown
    };
  }
  const remaining = st ? st.remaining : null;
  const end = calls[last].arr || p.end;
  const left = end ? Math.max(0, end - now) : null;
  return {
    done: false, boarded: true,
    title: remaining !== null && remaining <= 1 ? "Descendez au prochain arrêt" : `Descendez à ${to}`,
    sub: remaining === null ? `${label} jusqu’à ${to}` : remaining <= 1 ? to : `dans ${remaining} arrêts`,
    big: left === null ? "—" : fmtMin(left / 1000),
    bigLabel: end ? `avant ${to} · ${hm(end)}` : `jusqu’à ${to}`,
    stops: shown,
    say: remaining === 1 ? `Descendez au prochain arrêt, ${to}` : undefined
  };
}
