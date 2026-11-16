/**
 * « Êtes-vous dans le C6 ? » : quand l'application est ouverte et que la position est autorisée, Kumm compare la position
 * du téléphone à celle des trams et bus en circulation. Si la personne se déplace avec le même véhicule pendant au moins
 * 40 s, l'application lui demande si elle est à bord, puis propose de partager son trajet : sa position est alors envoyée
 * toutes les 10 s, sans aucun identifiant, et améliore la position et les horaires de ce véhicule pour tout le monde.
 * Le partage s'arrête au terminus, si la personne quitte le trajet, après 60 min, ou quand l'application passe en arrière-plan.
 */
import { url } from "./config";
import { lineLabel } from "./data";
import { S, render, toast } from "./store";
import { VEHICLES, refreshVehicles, vehicleHeading, vehiclePos } from "./vehicles";

const NEAR_M = 250;             // distance maximale au véhicule estimé (l'estimation d'après les horaires peut avoir du retard)
const MIN_SPEED = 2.8;          // m/s (10 km/h) : en dessous, la personne marche ou attend
const SAMPLES = 4, MIN_SPAN = 40_000;
const SEND_EVERY = 10_000, MAX_SHARE = 60 * 60_000, COOLDOWN = 15 * 60_000;

export interface RideState { id: string; line: string; dest: string }
let watchId: number | null = null;
let last: { lat: number; lon: number; t: number } | null = null;
let candidate: { id: string; n: number; misses: number; since: number; from: { lat: number; lon: number } } | null = null;
let refused = new Set<string>(), quietUntil = 0;
let sharing: { id: string; started: number; lastSent: number; misses: number } | null = null;

const rad = (d: number): number => (d * Math.PI) / 180;
const meters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number =>
  Math.hypot((b.lon - a.lon) * 111_320 * Math.cos(rad(a.lat)), (b.lat - a.lat) * 110_540);
const bearing = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number =>
  (Math.atan2((b.lon - a.lon) * Math.cos(rad(a.lat)), b.lat - a.lat) * 180 / Math.PI + 360) % 360;
const angleGap = (x: number, y: number): number => { const d = Math.abs(x - y) % 360; return d > 180 ? 360 - d : d; };

/** Démarre l'écoute de la position (application visible seulement) */
export function startRideDetection(): void {
  if (watchId !== null || !navigator.geolocation || document.hidden) return;
  watchId = navigator.geolocation.watchPosition(onPosition, () => { /* refusée ou indisponible : rien à faire */ },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30_000 });
}

export function stopRideDetection(): void {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null; last = null; candidate = null;
  if (sharing) stopSharing("L’application est passée en arrière-plan : partage du trajet arrêté");
}

/** État de la détection, pour les tests (window.__kumm.ride) */
export const rideDebug = (): unknown => ({ candidate, sharing, quietUntil, refused: [...refused], last: lastWhy });
let lastWhy = "";

function onPosition(pos: GeolocationPosition): void {
  const here = { lat: pos.coords.latitude, lon: pos.coords.longitude, t: pos.timestamp || Date.now() };
  const prev = last; last = here;
  refreshVehicles(() => { /* les positions des véhicules sont rafraîchies par la carte ou ici */ });
  if (sharing) return void share(here, pos.coords.speed);
  if (!prev || S.ridePrompt || Date.now() < quietUntil) return;
  const dt = (here.t - prev.t) / 1000, moved = meters(prev, here);
  const speed = pos.coords.speed ?? (dt > 0 ? moved / dt : 0);
  const moving = speed >= MIN_SPEED && moved >= 15, dir = moving ? bearing(prev, here) : null;
  // véhicule le plus proche (dans la même direction si la personne roule)
  let best: { id: string; d: number } | null = null;
  for (const v of VEHICLES.values()) {
    if (v.w || refused.has(v.id)) continue;
    if (v.id.startsWith("gtfs:")) continue;
    const [la, lo] = vehiclePos(v), d = meters(here, { lat: la, lon: lo });
    if (d > NEAR_M || (dir !== null && angleGap(dir, vehicleHeading(v)) > 75)) continue;
    if (!best || d < best.d) best = { id: v.id, d };
  }
  if (candidate && best?.id === candidate.id) {
    candidate.n++; candidate.misses = 0;
    lastWhy = `avec ${best.id} (${Math.round(best.d)} m, ${candidate.n} mesures)`;
  } else if (candidate && ++candidate.misses < 2) {
    // un seul écart (virage, arrêt, position imprécise) : on garde le véhicule suivi
    lastWhy = "écart toléré";
    return;
  } else {
    // nouveau véhicule seulement si la personne roule : pas de question à quelqu'un qui attend à côté d'un bus à quai
    candidate = best && moving ? { id: best.id, n: 1, misses: 0, since: here.t, from: here } : null;
    lastWhy = candidate ? `nouveau candidat ${best!.id}` : best ? "à l'arrêt près d'un véhicule" : "aucun véhicule proche";
    return;
  }
  if (candidate.n >= SAMPLES && here.t - candidate.since >= MIN_SPAN && meters(candidate.from, here) > 150) {
    const v = VEHICLES.get(candidate.id);
    candidate = null;
    if (!v) return;
    S.ridePrompt = { id: v.id, line: v.line, dest: v.dest };
    render();
  }
}

/** Réponse à « Êtes-vous dans le C6 ? » */
export function answerRide(yes: boolean): void {
  const p = S.ridePrompt;
  S.ridePrompt = null;
  if (!p) return;
  if (!yes) { refused.add(p.id); quietUntil = Date.now() + COOLDOWN; render(); return; }
  sharing = { id: p.id, started: Date.now(), lastSent: 0, misses: 0 };
  S.riding = p;
  render();
  toast(`Merci ! Votre trajet dans le ${lineLabel(p.line)} est partagé`);
  if (last) share(last, null);
}

/** Partage de la position à bord d'un véhicule choisi (trajet suivi sans service natif, voir journey.ts) */
export function shareAboard(p: RideState): void {
  if (sharing?.id === p.id) return;
  sharing = { id: p.id, started: Date.now(), lastSent: 0, misses: 0 };
  S.riding = p;
  startRideDetection();
  if (last) share(last, null);
}

/** Le service natif du trajet suivi prend le relais : la page n'envoie plus rien elle-même */
export function endSharingQuietly(): void {
  if (!sharing) return;
  refused.add(sharing.id);
  sharing = null; S.riding = null;
}

export function stopSharing(msg = "Partage du trajet arrêté"): void {
  if (!sharing) return;
  refused.add(sharing.id);
  sharing = null; S.riding = null; render(); toast(msg);
}

function share(here: { lat: number; lon: number; t: number }, speed: number | null): void {
  const s = sharing;
  if (!s) return;
  if (Date.now() - s.started > MAX_SHARE) return stopSharing("Partage du trajet terminé (1 h)");
  if (Date.now() - s.lastSent < SEND_EVERY) return;
  s.lastSent = Date.now();
  fetch(url("/api/ride"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trip: s.id, lat: here.lat, lon: here.lon, ...(speed !== null && speed >= 0 ? { speed } : {}) })
  }).then(r => {
    if (r.status === 404) return stopSharing("Terminus atteint : partage du trajet terminé, merci !");
    // position éloignée du trajet 3 fois de suite : la personne est descendue
    if (r.status === 409) { if (++s.misses >= 3) stopSharing("Vous avez quitté le trajet : partage arrêté"); return; }
    if (r.ok) s.misses = 0;
  }).catch(() => { /* hors ligne : nouvel essai à la position suivante */ });
}

/** Bandeaux affichés en haut de l'écran : la question, puis le partage en cours */
export function rideBanner(): string {
  const p = S.ridePrompt, r = S.riding;
  if (p) return `<div class="ride" role="dialog" aria-label="Êtes-vous dans ce véhicule ?">
      <b>Êtes-vous dans le ${lineLabel(p.line)} vers ${escText(p.dest)} ?</b>
      <small>En partageant votre trajet, votre position (sans nom ni identifiant) améliore la position et les horaires de ce véhicule pour tout le monde, jusqu’à votre descente.</small>
      <div class="ride-bt"><button class="onb-main" data-ride="yes">Oui, partager mon trajet</button><button class="onb-sec" data-ride="no">Non</button></div></div>`;
  if (r) return `<div class="ride sharing"><span class="ride-dot"></span><span>Trajet partagé · ${lineLabel(r.line)} vers ${escText(r.dest)}</span><button data-ride="stop">Arrêter</button></div>`;
  return "";
}

const escText = (t: string): string => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
