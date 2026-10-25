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
export interface Journey { detail: TripDetail; board: number; alight: number; native: boolean; status?: NativeStatus;
  /** étapes déjà annoncées par le bandeau (début, arrivée du véhicule, 3, 2 et 1 arrêts) */
  shown: Set<string> }
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
export async function startJourney(alight: number, note?: string): Promise<void> {
  const p = S.tripPick;
  if (!p) return;
  const d = p.detail, j: Journey = { detail: d, board: p.board, alight, native: NATIVE, shown: new Set() };
  S.tripPick = null; S.overlay = null; S.tpq = "";
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
  toast(note ?? `Kumm vous préviendra avant ${d.calls[alight].name}`);
  tick();
}

/** Arrêt qui n'est pas sur le trajet : prévenu à l'arrêt du trajet le plus proche (correspondance) */
export async function startJourneyNear(stop: { name: string; lat: number; lon: number }): Promise<void> {
  const p = S.tripPick;
  if (!p) return;
  const k = Math.cos((stop.lat * Math.PI) / 180);
  let best = p.from, dBest = Infinity;
  p.detail.calls.forEach((c, i) => {
    if (i < p.from) return;
    const dd = Math.hypot((c.lon - stop.lon) * k, c.lat - stop.lat);
    if (dd < dBest) { dBest = dd; best = i; }
  });
  await startJourney(best, `${stop.name} n'est pas sur ce trajet : Kumm vous préviendra à ${p.detail.calls[best].name}, l'arrêt le plus proche`);
}

export function stopJourney(): void {
  if (S.journey?.native) void Trip.stop().catch(() => { /* rien */ });
  S.journey = null;
  hideBanner(true);
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

function bannerText(j: Journey): string {
  const s = state(j), c = j.detail.calls, line = lineLabel(j.detail.line), to = c[j.alight].name;
  if (!s.boarded) {
    const m = Math.round(s.eta / 60_000);
    return `${line} à ${c[j.board].name} ${m < 1 ? "à l'approche" : `dans ${m} min`} · pensez à valider votre titre · descente à ${to}`;
  }
  return s.remaining <= 1 ? `Descendez au prochain arrêt : ${to}` : `Plus que ${s.remaining} arrêts · descente à ${to}`;
}

/* ---------- bandeau : apparaît, fait défiler son texte une fois, puis se cache ----------
   Il apparaît au début du trajet, quand le véhicule arrive (avant de monter), puis à 3, 2 et 1 arrêts de la descente ;
   à 2 et à 1 arrêt, le téléphone vibre. Il est hors de la page (#app) : les redessins ne relancent pas le défilement. */
let banner: HTMLElement | null = null, hideTimer = 0;

function showBanner(text: string): void {
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "jbanner";
    banner.innerHTML = `<span class="ride-dot"></span><span class="jb-t"><span class="jb-in"></span></span><button type="button">Arrêter</button>`;
    banner.querySelector("button")!.addEventListener("click", () => { stopJourney(); toast("Suivi du trajet arrêté"); });
    document.body.appendChild(banner);
  }
  window.clearTimeout(hideTimer);
  const box = banner.querySelector<HTMLElement>(".jb-t")!, inner = banner.querySelector<HTMLElement>(".jb-in")!;
  inner.getAnimations().forEach(a => a.cancel());
  inner.textContent = text;
  banner.classList.add("show");
  requestAnimationFrame(() => {
    const over = inner.scrollWidth - box.clientWidth;
    if (over > 4) {
      const a = inner.animate([{ transform: "translateX(0)" }, { transform: `translateX(-${over + 12}px)` }],
        { duration: 1200 + over * 28, delay: 1000, easing: "linear", fill: "forwards" });
      a.onfinish = () => { hideTimer = window.setTimeout(() => hideBanner(), 1800); };
    } else hideTimer = window.setTimeout(() => hideBanner(), 4500);
  });
}

function hideBanner(now = false): void {
  window.clearTimeout(hideTimer);
  if (!banner) return;
  banner.classList.remove("show");
  if (now) { banner.remove(); banner = null; }
}

/** Étape du trajet qui fait apparaître le bandeau (une seule fois chacune) */
function stepOf(j: Journey, now: number): string | null {
  const s = state(j, now);
  if (!s.boarded) return s.eta < 120_000 ? "arrive" : "debut";
  if (s.remaining <= 3 && s.remaining >= 1) return "r" + s.remaining;
  return "debut";
}

function tick(): void {
  const j = S.journey;
  if (!j || document.hidden) return;
  const now = Date.now(), c = j.detail.calls;
  const step = stepOf(j, now);
  if (step && !j.shown.has(step)) {
    j.shown.add(step);
    if (step === "debut" && j.shown.size > 1) return;        // « début » seulement au tout début du trajet
    showBanner(bannerText(j));
    // le service Android vibre déjà avec ses notifications
    if (!j.native && (step === "r2" || step === "r1")) vibrate(step === "r1" ? [400, 200, 400, 200, 600] : [300, 150, 300]);
  }
  if (!j.native && now > c[j.alight].arr + 60_000) { S.journey = null; hideBanner(true); render(); toast(`Arrivée à ${c[j.alight].name}`); }
}

/** Chaque 3 s, application ouverte : état du service natif, puis bandeau si une étape est franchie */
setInterval(() => {
  const j = S.journey;
  if (!j || document.hidden) return;
  if (!j.native) return tick();
  void Trip.status().then(st => {
    if (S.journey !== j) return;
    j.status = st;
    if (!st.active) { S.journey = null; hideBanner(true); render(); return; }
    tick();
  }).catch(() => { /* rien */ });
}, 3000);

function vibrate(pattern: number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* rien */ }
}
