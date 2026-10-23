import type { Place } from "../../shared/types";
import { startNav } from "./nav";
import { fetchWalk } from "./walk";
import { fetchBike } from "./bike";
import { JOURNEYS, PLAN, TRIP } from "./trip";
import { hm, minutes } from "./transit";
import type { Journey } from "./transit";
import { CONFIG } from "./config";
import { POIS, USER, toast } from "./store";
import { esc } from "./util";

const fail = (): void => toast("Itinéraire à pied indisponible pour le moment");

async function leg2(line: string): Promise<void> {
  const leg = PLAN?.lines[line];
  if (!PLAN || !leg) return;
  const from: Place = { label: leg.alight.name, lat: leg.alight.lat, lon: leg.alight.lon };
  try {
    const route = await fetchWalk(from, PLAN.dest);
    startNav({ title: `À pied vers ${PLAN.dest.label}`, route, dest: PLAN.dest });
  } catch { fail(); }
}

/** Lance le guidage : « walk » (tout à pied) ou « board:LIGNE » (marche jusqu'à l'arrêt de départ) */
export async function launchNav(kind: string): Promise<void> {
  const plan = PLAN;
  if (!plan) return;
  if (kind.startsWith("j:")) return launchJourney(Number(kind.slice(2)));
  try {
    if (kind === "walk") {
      // déjà calculé pour l'écran Itinéraires : pas de nouvel appel
      const route = TRIP?.walk.data && TRIP.origin === plan.origin ? TRIP.walk.data : await fetchWalk(plan.origin, plan.dest);
      startNav({ title: `À pied vers ${plan.dest.label}`, route, dest: plan.dest });
      return;
    }
    const line = kind.split(":")[1] ?? "";
    const leg = plan.lines[line];
    if (!leg) return;
    const board = { label: leg.board.name, lat: leg.board.lat, lon: leg.board.lon };
    const route = await fetchWalk(plan.origin, board);
    startNav({
      title: `Vers l’arrêt ${leg.board.name}`, route, dest: board,
      endHtml: `Prenez la ligne <b>${esc(line)}</b> et descendez à <b>${esc(leg.alight.name)}</b>. Vérifiez la direction sur l’affichage de l’arrêt.`,
      actions: [{ label: `Marche jusqu’à ${plan.dest.label}`, run: () => { void leg2(line); } }]
    });
  } catch { fail(); }
}

/** Guidage à pied depuis votre position jusqu'à un point de la carte (Vélhop, P+R…) */
export async function walkToPoi(id: string): Promise<void> {
  await navToPoi(id, "walk");
}

/** Guidage à vélo vers un point de la carte */
export async function bikeToPoi(id: string): Promise<void> {
  await navToPoi(id, "bike");
}

/** Guidage vers un point de la carte, à pied ou à vélo */
async function navToPoi(id: string, mode: "walk" | "bike"): Promise<void> {
  if (CONFIG.USE_MOCK) { toast("Le guidage est disponible avec le serveur"); return; }
  const p = POIS.find(x => x.id === id);
  if (!p) return;
  const dest = { lat: p.lat, lon: p.lon, label: p.name };
  try {
    if (mode === "bike") {
      const routes = await fetchBike(USER, p);
      startNav({ title: `À vélo vers ${p.name}`, route: toWalkRoute(routes[0], "bike"), dest });
    } else {
      startNav({ title: `À pied vers ${p.name}`, route: await fetchWalk(USER, p), dest });
    }
  } catch { fail(); }
}

/** Convertit un itinéraire vélo au format attendu par le guidage, avec la vitesse à vélo */
function toWalkRoute(r: { distance: number; duration: number; coords: [number, number][]; steps: import("../../shared/types").WalkStep[] }, mode: "bike"): import("../../shared/types").WalkRoute {
  return { distance: r.distance, duration: r.duration, coords: r.coords, steps: r.steps, mode };
}

/** Résumé des étapes en transport : « Ligne B vers … : départ 14:32 à …, arrivée 14:46 à … » */
function journeySummary(j: Journey): string {
  return j.legs.filter(l => l.kind !== "walk").map(l =>
    `<b>${esc(l.line ?? "?")}</b>${l.headsign ? ` vers ${esc(l.headsign)}` : ""} : départ ${hm(l.start)} à <b>${esc(l.from.name)}</b>, arrivée ${hm(l.end)} à <b>${esc(l.to.name)}</b> (${minutes(l.duration)} min)`
  ).join("<br>");
}

/** Marche jusqu'au premier arrêt ; à l'arrivée, résumé du trajet et marche finale jusqu'à la destination */
async function launchJourney(i: number): Promise<void> {
  const plan = PLAN, j = JOURNEYS[i];
  if (!plan || !j) return;
  const first = j.legs.find(l => l.kind !== "walk");
  if (!first) return;
  const lastTransit = [...j.legs].reverse().find(l => l.kind !== "walk") ?? first;
  const board = { label: first.from.name || "l’arrêt de départ", lat: first.from.lat, lon: first.from.lon };
  const alight = { label: lastTransit.to.name || "l’arrêt d’arrivée", lat: lastTransit.to.lat, lon: lastTransit.to.lon };
  try {
    const route = await fetchWalk(plan.origin, board);
    startNav({
      title: `Vers l’arrêt ${board.label}`, route, dest: board,
      endHtml: `Votre trajet :<br>${journeySummary(j)}`,
      actions: [{
        label: `Marche jusqu’à ${plan.dest.label}`,
        run: () => {
          fetchWalk(alight, plan.dest)
            .then(r => startNav({ title: `À pied vers ${plan.dest.label}`, route: r, dest: plan.dest }))
            .catch(fail);
        }
      }]
    });
  } catch { fail(); }
}
