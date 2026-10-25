/**
 * Alertes de descente pendant une navigation (« Naviguer », puis un itinéraire en transports, flow.ts). Pour chaque étape en
 * tram ou en bus, Kumm retrouve la course à prendre (ligne, arrêt de montée, arrêt de descente, heure) puis :
 * - avant de monter : rappel « Pensez à valider votre titre » quand le véhicule arrive (2 min avant) ;
 * - à bord : prévenu 5 arrêts avant la descente, puis à 2 arrêts (vibration), puis « Descendez au prochain arrêt » ;
 * - correspondance : l'étape suivante est suivie à son tour ; véhicule manqué : le suivant de la même ligne ;
 * - à bord, la position du téléphone, sans identifiant, améliore la position et la vitesse du véhicule pour tout le monde.
 * Sur Android, un service natif (android-src/TripService.java) fait tout cela même écran éteint. Ailleurs (version web),
 * le suivi se fait d'après les horaires, tant que la page est ouverte, et la position est partagée comme avec ride.ts.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { API_BASE, APP_KEY, appHeaders, url } from "./config";
import { COLORS, lineLabel } from "./data";
import { S, render, toast } from "./store";
import { endSharingQuietly, shareAboard } from "./ride";

export interface TripCall { code: string; name: string; lat: number; lon: number; arr: number; dep: number }
export interface TripDetail { id: string; line: string; dest: string; mode: string; n: string; calls: TripCall[]; board?: number; alight?: number }
/** board : indice de l'arrêt de montée ; alight : indice de l'arrêt de descente */
export interface Journey { detail: TripDetail; board: number; alight: number; native: boolean; status?: NativeStatus;
  /** étapes déjà annoncées par le bandeau (début, arrivée du véhicule, 5, 2 et 1 arrêts) */
  shown: Set<string>;
  /** version web : position partagée une fois à bord */
  sharing?: boolean }
interface NativeStatus { active: boolean; boarded?: boolean; remaining?: number; next?: string; alight?: string; board?: string; eta?: number; speed?: number }

/** Étape en transport d'un itinéraire : ligne, arrêts de montée et de descente, heure de départ prévue */
export interface RouteLeg {
  line: string; headsign?: string; start: number;
  from: { name: string; lat: number; lon: number };
  to: { name: string; lat: number; lon: number };
}

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

/* ---------- itinéraire suivi : ses étapes, l'une après l'autre ---------- */
let legs: RouteLeg[] = [], legIdx = 0, retryTimer = 0, missed = 0;

/** Navigation lancée : les étapes en tram ou en bus de l'itinéraire seront suivies */
export function followRoute(list: RouteLeg[]): void {
  stopJourney(true);
  legs = list.filter(l => l.line); legIdx = 0; missed = 0;
  if (legs.length) void startLeg(legs[0].start - 120_000, true);
}

/** Retrouve la course de l'étape en cours ; pas encore publiée par la CTS (départ lointain) : nouvel essai chaque minute */
async function startLeg(after: number, first = false): Promise<void> {
  window.clearTimeout(retryTimer);
  const leg = legs[legIdx];
  if (!leg) return;
  const q = new URLSearchParams({
    stop: leg.from.name, line: leg.line, dest: leg.headsign ?? "", to: leg.to.name, after: String(Math.round(after)),
    lat: String(leg.from.lat), lon: String(leg.from.lon), tolat: String(leg.to.lat), tolon: String(leg.to.lon)
  });
  const d = await fetchTrip(q.toString());
  if (legs[legIdx] !== leg) return;                          // autre navigation lancée entre-temps
  if (!d || d.board === undefined || d.alight === undefined) {
    if (Date.now() < leg.start + 20 * 60_000) retryTimer = window.setTimeout(() => { void startLeg(after); }, 60_000);
    if (first) toast(`Le ${lineLabel(leg.line)} sera suivi dès qu'il apparaîtra dans les horaires en direct`);
    return;
  }
  await startJourney(d, d.board, d.alight);
}

/** Étape terminée : la suivante (correspondance), s'il y en a une */
function nextLeg(): void {
  if (legIdx + 1 >= legs.length) { legs = []; return; }
  legIdx++; missed = 0;
  void startLeg(legs[legIdx].start - 120_000);
}

/** Lance le suivi d'une course, de l'arrêt de montée jusqu'à l'arrêt de descente */
async function startJourney(d: TripDetail, board: number, alight: number): Promise<void> {
  const j: Journey = { detail: d, board, alight, native: NATIVE, shown: new Set() };
  if (NATIVE) {
    try {
      const r = await Trip.start({
        base: API_BASE, key: APP_KEY, id: d.id, line: lineLabel(d.line), dest: d.dest, n: d.n, color: COLORS[lineLabel(d.line)] ?? "#136342",
        board, alight, calls: d.calls.map(c => ({ name: c.name, lat: c.lat, lon: c.lon, arr: c.arr }))
      });
      if (!r.notifications) toast("Notifications refusées : les alertes s'afficheront seulement dans l'application");
    } catch { j.native = false; }
  }
  if (j.native) endSharingQuietly();
  S.journey = j;
  render();
  toast(`Alertes de descente : Kumm vous préviendra 5 arrêts avant ${d.calls[alight].name}`);
  tick();
}

/** Arrêt du suivi (bouton « Arrêter », nouvelle navigation) ; quiet : sans redessiner */
export function stopJourney(quiet = false): void {
  window.clearTimeout(retryTimer);
  if (!quiet) legs = [];
  if (S.journey?.native) void Trip.stop().catch(() => { /* rien */ });
  S.journey = null;
  hideBanner(true);
  if (!quiet) render();
}

/** Fin d'une étape (arrivée, ou course terminée) : étape suivante */
function legDone(): void {
  S.journey = null; hideBanner(true); render();
  nextLeg();
}

/** Où en est le trajet : état du service natif, sinon d'après les horaires */
function state(j: Journey, now = Date.now()): { boarded: boolean; remaining: number; next: string; eta: number } {
  const st = j.status, c = j.detail.calls;
  if (j.native && st?.active) return { boarded: !!st.boarded, remaining: st.remaining ?? 0, next: st.next ?? "", eta: st.eta ?? 0 };
  const boarded = now > c[j.board].arr + 20_000;
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
   Il apparaît au début du trajet, quand le véhicule arrive (avant de monter), puis à 5, 2 et 1 arrêts de la descente ;
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
  if (s.remaining === 5 || s.remaining === 2 || s.remaining === 1) return "r" + s.remaining;
  if (s.remaining === 4 || s.remaining === 3) return "r5";   // trajet commencé à moins de 5 arrêts
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
  const s = state(j, now);
  // véhicule parti sans la personne (2 min après son passage, pas monté) : le suivant de la même ligne, deux fois au plus
  if (!s.boarded && j.board >= 0 && now > c[j.board].dep + 120_000 && missed < 2) {
    missed++; toast(`${lineLabel(j.detail.line)} manqué ? Kumm suit le suivant`);
    stopJourney(true); void startLeg(now - 30_000);
    return;
  }
  if (!j.native && s.boarded && !j.sharing) { j.sharing = true; shareAboard({ id: j.detail.id, line: j.detail.line, dest: j.detail.dest }); }
  if (!j.native && now > c[j.alight].arr + 60_000) { toast(`Arrivée à ${c[j.alight].name}`); legDone(); }
}

/** Chaque 3 s, application ouverte : état du service natif, puis bandeau si une étape est franchie */
setInterval(() => {
  const j = S.journey;
  if (!j || document.hidden) return;
  if (!j.native) return tick();
  void Trip.status().then(st => {
    if (S.journey !== j) return;
    j.status = st;
    if (!st.active) { legDone(); return; }
    tick();
  }).catch(() => { /* rien */ });
}, 3000);

function vibrate(pattern: number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* rien */ }
}
