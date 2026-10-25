/**
 * Trajet suivi : « Me prévenir pour descendre ». La personne choisit son arrêt de descente, depuis un véhicule suivi sur la
 * carte (elle est à bord) ou depuis un départ à un arrêt (elle va monter). Ensuite :
 * - avant de monter : rappel « Pensez à valider votre titre » quand le véhicule arrive (2 min avant) ;
 * - à bord : nombre d'arrêts restants, puis alerte « Descendez au prochain arrêt » juste avant l'arrêt choisi ;
 * - sa position, sans identifiant, améliore la position et la vitesse du véhicule pour tout le monde (POST /api/ride).
 * Sur Android, un service natif (android-src/TripService.java) fait tout cela même écran éteint. Ailleurs (version web),
 * le suivi se fait d'après les horaires, tant que la page est ouverte, et la position est partagée comme avec ride.ts.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { API_BASE, APP_KEY, appHeaders, url } from "./config";
import { COLORS, lineLabel } from "./data";
import { S, render, toast } from "./store";
import { endSharingQuietly, shareAboard } from "./ride";

export interface TripCall { code: string; name: string; lat: number; lon: number; arr: number; dep: number }
export interface TripDetail { id: string; line: string; dest: string; mode: string; n: string; calls: TripCall[]; board?: number }
/** board : indice de l'arrêt de montée (-1 : déjà à bord) ; alight : indice de l'arrêt de descente */
export interface Journey { detail: TripDetail; board: number; alight: number; native: boolean; reminded?: boolean; warned?: boolean; status?: NativeStatus }
interface NativeStatus { active: boolean; boarded?: boolean; remaining?: number; next?: string; alight?: string; board?: string; eta?: number; speed?: number }

interface KummTripPlugin {
  start(o: Record<string, unknown>): Promise<{ notifications: boolean }>;
  stop(): Promise<void>;
  status(): Promise<NativeStatus>;
}
const NATIVE = Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("KummTrip");
const Trip = registerPlugin<KummTripPlugin>("KummTrip");

async function fetchTrip(q: string): Promise<TripDetail | null> {
  try {
    const r = await fetch(url("/api/trip?" + q), { headers: appHeaders() });
    return r.ok ? (await r.json()) as TripDetail : null;
  } catch { return null; }
}

/** Premier arrêt encore devant le véhicule */
const ahead = (d: TripDetail, now = Date.now()): number => Math.max(0, d.calls.findIndex(c => c.arr > now - 20_000));

/** Choix de l'arrêt de descente : à bord d'un véhicule suivi */
export async function pickFromVehicle(id: string): Promise<void> {
  const d = await fetchTrip("id=" + encodeURIComponent(id));
  if (!d || d.calls.length < 2) { toast("Trajet introuvable : il vient peut-être de se terminer"); return; }
  S.tripPick = { detail: d, board: -1, from: ahead(d) };
  S.overlay = { k: "tripPick" };
  render();
}

/** Choix de l'arrêt de descente : avant de monter, depuis un départ à un arrêt */
export async function pickFromStop(stop: string, line: string, dest: string): Promise<void> {
  const d = await fetchTrip(`stop=${encodeURIComponent(stop)}&line=${encodeURIComponent(line)}&dest=${encodeURIComponent(dest)}`);
  if (!d || d.board === undefined) { toast("Ce passage n'est pas encore suivi : réessayez dans un instant"); return; }
  S.tripPick = { detail: d, board: d.board, from: d.board + 1 };
  S.overlay = { k: "tripPick" };
  render();
}

/** Lance le suivi jusqu'à l'arrêt choisi */
export async function startJourney(alight: number): Promise<void> {
  const p = S.tripPick;
  if (!p) return;
  const d = p.detail, j: Journey = { detail: d, board: p.board, alight, native: NATIVE };
  S.tripPick = null; S.overlay = null;
  if (NATIVE) {
    try {
      const r = await Trip.start({
        base: API_BASE, key: APP_KEY, id: d.id, line: lineLabel(d.line), dest: d.dest, n: d.n, color: COLORS[lineLabel(d.line)] ?? "#136342",
        board: p.board, alight, calls: d.calls.map(c => ({ name: c.name, lat: c.lat, lon: c.lon, arr: c.arr }))
      });
      if (!r.notifications) toast("Notifications refusées : les alertes s'afficheront seulement dans l'application");
    } catch { j.native = false; }
  }
  // à bord : la position est partagée par le service natif ; sinon par la page (tant qu'elle est ouverte)
  if (j.native) endSharingQuietly();
  else if (p.board < 0) shareAboard({ id: d.id, line: d.line, dest: d.dest });
  S.journey = j;
  render();
  toast(`Kumm vous préviendra avant ${d.calls[alight].name}`);
}

export function stopJourney(): void {
  if (S.journey?.native) void Trip.stop().catch(() => { /* rien */ });
  S.journey = null;
  render();
}

/** Où en est le trajet : état du service natif, sinon d'après les horaires */
function state(j: Journey, now = Date.now()): { boarded: boolean; remaining: number; next: string; eta: number } {
  const st = j.status, c = j.detail.calls;
  if (j.native && st?.active) return { boarded: !!st.boarded, remaining: st.remaining ?? 0, next: st.next ?? "", eta: st.eta ?? 0 };
  const boarded = j.board < 0 || now > c[j.board].arr + 20_000;
  const at = ahead(j.detail, now);
  return { boarded, remaining: Math.max(0, j.alight - at + 1), next: c[Math.min(at, c.length - 1)].name, eta: j.board >= 0 ? c[j.board].arr - now : 0 };
}

/** Bandeau du trajet en cours, en haut de l'écran */
export function journeyBanner(): string {
  const j = S.journey;
  if (!j) return "";
  return `<div class="ride sharing jtrip"><span class="ride-dot"></span><span id="jban">${esc(bannerText(j))}</span><button data-jstop="1">Arrêter</button></div>`;
}

function bannerText(j: Journey): string {
  const s = state(j), c = j.detail.calls, line = lineLabel(j.detail.line), to = c[j.alight].name;
  if (!s.boarded) {
    const m = Math.round(s.eta / 60_000);
    return `${line} à ${c[j.board].name} ${m < 1 ? "à l'approche" : `dans ${m} min`} · descente à ${to}`;
  }
  return s.remaining <= 1 ? `Prochain arrêt : ${to}, préparez-vous à descendre` : `Plus que ${s.remaining} arrêts · descente à ${to}`;
}

/** Chaque 3 s, application ouverte : bandeau à jour ; sans service natif, rappels et alerte dans l'application */
setInterval(() => {
  const j = S.journey;
  if (!j || document.hidden) return;
  const now = Date.now(), c = j.detail.calls;
  const refresh = (): void => { const el = document.getElementById("jban"); if (el) el.textContent = bannerText(j); };
  if (j.native) {
    void Trip.status().then(st => {
      if (S.journey !== j) return;
      j.status = st;
      if (!st.active) { S.journey = null; render(); return; }
      refresh();
    }).catch(() => { /* rien */ });
    return;
  }
  const s = state(j, now);
  if (!s.boarded && !j.reminded && s.eta < 120_000) { j.reminded = true; alertInApp(`Votre ${lineLabel(j.detail.line)} arrive : pensez à valider votre titre de transport en montant`); }
  if (s.boarded && !j.warned && s.remaining <= 1) { j.warned = true; alertInApp(`Descendez au prochain arrêt : ${c[j.alight].name}`); }
  if (now > c[j.alight].arr + 60_000) { S.journey = null; render(); toast(`Arrivée à ${c[j.alight].name}`); return; }
  refresh();
}, 3000);

function alertInApp(msg: string): void {
  toast(msg);
  try { navigator.vibrate?.([300, 150, 300]); } catch { /* rien */ }
}

const esc = (t: string): string => t.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
