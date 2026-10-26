/**
 * Trams et bus en circulation : position estimée par le serveur d'après les horaires temps réel (/api/vehicles),
 * puis animée ici seconde par seconde entre l'arrêt quitté et le suivant.
 */
import { CONFIG } from "./config";
import { isTram } from "./data";
import { appHeaders, url } from "./config";

export interface Vehicle {
  id: string;
  line: string;
  dest: string;
  rt: boolean;
  /** « tram » ou « bus » selon la CTS */
  m?: string;
  /** [latitude, longitude, heure en ms] au début et à la fin du tronçon en cours */
  a: [number, number, number];
  b: [number, number, number];
  h: number;
  next: [string, number][];
  /** tracé de la ligne entre a et b ; absent : ligne droite */
  p?: [number, number][];
  /** code du trajet (« hoeb2610240612 » : terminus de départ, ligne, date, heure de départ prévue) */
  n?: string;
  /** à quai au terminus, en attente du départ de sa prochaine course */
  w?: boolean;
  /** vitesse estimée par le serveur (km/h) ; pour un tram ou un bus, l'application calcule la vitesse du moment (profileOf) */
  s?: number;
  /** tram ou bus : vitesse de croisière réelle sur ce tronçon (km/h), apprise des trajets partagés par les voyageurs */
  c?: number;
  /** tram ou bus : temps à quai observé à l'arrêt de départ (s), appris des trajets partagés */
  q?: number;
  /** position partagée par un voyageur à bord */
  g?: boolean;
  /** retard sur l'horaire prévu, en secondes (négatif : en avance), d'après la position partagée */
  d?: number;
  /** immobilisé (panne, accident, bouchon) depuis cette heure (ms), d'après les horaires repoussés par la CTS */
  x?: number;
}

export const VEHICLES = new Map<string, Vehicle>();
/** écart entre l'horloge du serveur et celle du téléphone (ms) */
let skew = 0;
let lastFetch = 0, loading = false;
const REFRESH_MS = 20_000;

/** Heure « serveur » : les positions restent justes même si l'horloge du téléphone est décalée */
export const serverNow = (): number => Date.now() + skew;

/** Recharge les positions si les dernières ont plus de 20 s ; rappelle onUpdate quand elles arrivent */
export function refreshVehicles(onUpdate: () => void): void {
  if (CONFIG.USE_MOCK || loading || Date.now() - lastFetch < REFRESH_MS) return;
  loading = true;
  fetch(url("/api/vehicles"), { headers: appHeaders() })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((j: { now: number; vehicles?: Vehicle[] }) => {
      skew = j.now - Date.now();
      keepContinuity(new Map(VEHICLES), j.vehicles ?? [], serverNow());
      VEHICLES.clear();
      for (const v of j.vehicles ?? []) VEHICLES.set(v.id, v);
      onUpdate();
    })
    .catch(e => console.warn("Véhicules indisponibles :", e))
    .finally(() => { loading = false; lastFetch = Date.now(); });
}

const rad = (d: number): number => (d * Math.PI) / 180;
const len = (a: [number, number], b: [number, number]): number => Math.hypot((b[1] - a[1]) * Math.cos(rad(a[0])), b[0] - a[0]);
/** Distances cumulées le long du tracé (calculées une fois par véhicule) */
const cums = new WeakMap<Vehicle, number[]>();
function cumOf(v: Vehicle, p: [number, number][]): number[] {
  let c = cums.get(v);
  if (!c) { c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + len(p[i - 1], p[i])); cums.set(v, c); }
  return c;
}

/* Profil de vitesse d'un tram ou d'un bus sur le tronçon : quelques secondes encore à quai, accélération, croisière, freinage,
   arrivée à l'heure annoncée. Sert à la vitesse affichée et à l'avancée du repère (qui démarre doucement et freine). */
/* Les horaires CTS laissent ~95 s pour ~500 m entre deux stations (20 km/h de moyenne), dont 20 à 30 s à quai et l'attente
   aux feux. Le véhicule reste donc à quai une partie du créneau, puis roule à une vitesse de croisière normale (CRUISE) ;
   si l'horaire laisse plus de temps que ça, il roule un peu moins vite, s'il en laisse moins, plus vite. */
const ACCEL: Record<string, number> = { tram: 1.0, bus: 0.9 };
const CRUISE: Record<string, number> = { tram: 40 / 3.6, bus: 35 / 3.6 };   // m/s
const MAX_WAIT = 45;   // s, temps à quai au plus (montées et descentes, feu au départ, horaire arrondi à la minute)
interface Profile { wait: number; T: number; D: number; acc: number; vc: number; ramp: number }
const profiles = new WeakMap<Vehicle, Profile | null>();
function profileOf(v: Vehicle): Profile | null {
  if (profiles.has(v)) return profiles.get(v)!;
  let pr: Profile | null = null;
  const acc0 = ACCEL[v.m ?? ""], vt = v.c && v.c > 8 ? v.c / 3.6 : CRUISE[v.m ?? ""], span = (v.b[2] - v.a[2]) / 1000;
  const D = v.p && v.p.length > 1 ? cumOf(v, v.p)[v.p.length - 1] * 111_320 : len([v.a[0], v.a[1]], [v.b[0], v.b[1]]) * 111_320;
  if (acc0 && vt && span > 10 && D > 30) {
    // temps qu'il faut à vitesse normale (accélération et freinage compris) ; le reste du créneau : à quai, au plus MAX_WAIT
    const need = D < (vt * vt) / acc0 ? 2 * Math.sqrt(D / acc0) : D / vt + vt / acc0;
    // temps à quai : celui observé à cet arrêt par les voyageurs (champ q), sinon ce que l'horaire laisse, au plus MAX_WAIT
    const wait = Math.min(v.q ?? MAX_WAIT, Math.max(0, span - need), span * 0.6), T = span - wait;
    // croisière vc pour parcourir D en T : D = vc·T − vc²/acc ; trop court pour cette accélération : profil en triangle
    let acc = acc0;
    const disc = acc * acc * T * T - 4 * acc * D;
    let vc: number;
    if (disc >= 0) vc = (acc * T - Math.sqrt(disc)) / 2;
    else { acc = (4 * D) / (T * T); vc = (acc * T) / 2; }
    pr = { wait, T, D, acc, vc, ramp: vc / acc };
  }
  profiles.set(v, pr);
  return pr;
}
/** Secondes de roulage écoulées sur le tronçon selon le profil (bornées à 0..T) */
const runTime = (v: Vehicle, pr: Profile, t: number): number => Math.max(0, Math.min(pr.T, (t - v.a[2]) / 1000 - pr.wait));

/** Avancée sur le tronçon d'après les horaires reçus (0 = arrêt quitté, 1 = arrêt suivant) */
function rawProgress(v: Vehicle, t: number): number {
  const t1 = v.a[2], t2 = v.b[2];
  if (t2 <= t1) return 1;
  const pr = profileOf(v);
  if (!pr) return Math.max(0, Math.min(1, (t - t1) / (t2 - t1)));
  const x = runTime(v, pr, t), { acc, vc, ramp, T, D } = pr;
  const d = x < ramp ? 0.5 * acc * x * x : x > T - ramp ? D - 0.5 * acc * (T - x) ** 2 : 0.5 * acc * ramp * ramp + vc * (x - ramp);
  return Math.max(0, Math.min(1, d / D));
}

/* Continuité d'une actualisation à l'autre (toutes les 20 s) : les horaires recalés par la CTS (retard, avance) déplacent
   l'estimation. Au lieu d'un saut, le véhicule repart d'où il était affiché et rejoint la nouvelle estimation en douceur
   pendant BLEND_MS ; sur un même tronçon, il ne recule jamais (au pire, il ralentit). */
const BLEND_MS = 20_000;
const segOf = (v: Vehicle): string => `${v.a[0]},${v.a[1]}>${v.b[0]},${v.b[1]}`;
const blends = new Map<string, { seg: string; off: number; at: number }>();
const shownF = new Map<string, { seg: string; f: number; t: number; hist: [number, number][] }>();
/** Estimation repoussée derrière la position affichée (retard annoncé) : le véhicule continue au pas (m/s), sans dépasser
    l'approche de l'arrêt (fraction du tronçon), au lieu de s'arrêter net en pleine voie */
const CREEP_MS = 2.5, CREEP_MAX = 0.92;

/* Passage au tronçon suivant pendant une actualisation, alors que le véhicule affiché n'avait pas fini le précédent : il le
   termine d'abord (en quelques secondes, à allure plausible), puis repart du quai sur le nouveau tronçon. */
const carries = new Map<string, { o: Vehicle; f0: number; at: number; ms: number }>();
function carry(v: Vehicle, t: number): { o: Vehicle; f: number } | null {
  const c = carries.get(v.id);
  if (!c) return null;
  const k = (t - c.at) / c.ms;
  if (k >= 1) { if (t >= serverNow() - 1000) carries.delete(v.id); return null; }
  return { o: c.o, f: c.f0 + (1 - c.f0) * Math.max(0, k) };
}
const posOn = (v: Vehicle, f: number): [number, number] => {
  const a = along(v, f);
  return a ? a.pos : [v.a[0] + (v.b[0] - v.a[0]) * f, v.a[1] + (v.b[1] - v.a[1]) * f];
};

function smoothProgress(v: Vehicle, t: number): number {
  let f = rawProgress(v, t);
  const b = blends.get(v.id);
  if (b && b.seg === segOf(v)) f += b.off * Math.max(0, Math.min(1, 1 - (t - b.at) / BLEND_MS));
  return Math.max(0, Math.min(1, f));
}

/** Avancée affichée sur le tronçon : lissée, jamais en arrière, et jamais figée en pleine voie */
function progress(v: Vehicle, t: number): number {
  let f = smoothProgress(v, t);
  const seg = segOf(v), last = shownF.get(v.id), live = t >= serverNow() - 1000;
  const same = last && last.seg === seg;
  if (same && f < last.f) {
    const dt = Math.max(0, (t - last.t) / 1000), D = profileOf(v)?.D ?? 300;
    f = last.f < CREEP_MAX ? Math.min(CREEP_MAX, last.f + (CREEP_MS * dt) / D) : last.f;
  }
  if (live) {
    // historique des 3 dernières secondes : vitesse affichée = mouvement réellement visible
    const hist = same ? last.hist.filter(([at]) => t - at < 3000) : [];
    if (!hist.length || t - hist[hist.length - 1][0] >= 250) hist.push([t, f]);
    shownF.set(v.id, { seg, f, t, hist });
  }
  return f;
}

/** Nouvelles positions reçues : chaque véhicule toujours sur le même tronçon garde sa position affichée comme point de départ */
function keepContinuity(prev: Map<string, Vehicle>, next: Vehicle[], now: number): void {
  blends.clear();
  for (const v of next) {
    const o = prev.get(v.id);
    if (o && segOf(o) !== segOf(v)) {
      shownF.delete(v.id);
      // tronçon suivant : on finit d'abord le précédent, puis le nouveau part de son début
      const f0 = carry(o, now)?.f ?? progress(o, now);
      const fromEnd = o.b[0] === v.a[0] && o.b[1] === v.a[1];
      if (fromEnd && f0 < 0.98) {
        const left = (1 - f0) * (profileOf(o)?.D ?? 300);
        const ms = Math.max(1500, Math.min(15_000, (left / 9) * 1000));
        carries.set(v.id, { o, f0, at: now, ms });
        const off = -rawProgress(v, now + ms);
        if (off < -0.02) blends.set(v.id, { seg: segOf(v), off, at: now + ms });
      } else carries.delete(v.id);
      continue;
    }
    if (!o) continue;
    const off = progress(o, now) - rawProgress(v, now);
    if (Math.abs(off) > 0.02 && Math.abs(off) < 0.7) blends.set(v.id, { seg: segOf(v), off, at: now });
  }
  for (const id of shownF.keys()) if (!next.some(v => v.id === id)) shownF.delete(id);
}

/** Vitesse à l'instant t (km/h), d'après le mouvement affiché sur la carte (moyenne sur 2 s) ; null sans profil */
function speedAt(v: Vehicle, t: number): number | null {
  const pr = profileOf(v);
  if (!pr) return null;
  const f = progress(v, t), first = shownF.get(v.id)?.hist[0];
  const dt = first ? (t - first[0]) / 1000 : 0;
  const ms = first && dt >= 0.8 ? (pr.D * Math.max(0, f - first[1])) / dt : 0;
  // horaire très serré (arrondi à la minute) : on n'affiche pas une vitesse impossible
  return Math.round(Math.min(v.m === "tram" ? 70 : 60, ms * 3.6));
}

/** Point du tracé à la fraction f, et indice du segment où il se trouve */
function along(v: Vehicle, f: number): { pos: [number, number]; i: number } | null {
  const p = v.p;
  if (!p || p.length < 2) return null;
  const c = cumOf(v, p), target = f * c[c.length - 1];
  let i = 1;
  while (i < c.length - 1 && c[i] < target) i++;
  const k = c[i] > c[i - 1] ? (target - c[i - 1]) / (c[i] - c[i - 1]) : 0;
  return { pos: [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * k, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k], i };
}

/** Position à l'instant t : le long du tracé de la ligne s'il est connu, sinon en ligne droite entre les deux arrêts */
export function vehiclePos(v: Vehicle, t = serverNow()): [number, number] {
  const c = carry(v, t);
  if (c) return posOn(c.o, c.f);
  const f = progress(v, t), a = along(v, f);
  if (a) return a.pos;
  const [la1, lo1] = v.a, [la2, lo2] = v.b;
  return [la1 + (la2 - la1) * f, lo1 + (lo2 - lo1) * f];
}

/**
 * Position décalée de « meters » le long du tracé (négatif : en arrière), sans sortir du tronçon : sert à faire attendre un
 * véhicule juste avant l'icône d'une station en restant sur sa voie, virages compris. null si le tracé est inconnu.
 */
/** Avancée affichée sur le tronçon (0 à 1), pour les mesures de scripts/check-map.mjs */
export const shownProgress = (id: string): number | null => shownF.get(id)?.f ?? null;

/** Tracé sur lequel le véhicule est affiché (celui du tronçon précédent tant qu'il le termine) : pour scripts/check-map.mjs */
export const shownPath = (v: Vehicle, t = serverNow()): [number, number][] | undefined => (carry(v, t)?.o ?? v).p;

export function vehiclePosAlong(v: Vehicle, meters: number, t = serverNow()): [number, number] | null {
  const k = carry(v, t), w = k ? k.o : v;   // fin du tronçon précédent : sur son tracé
  if (!w.p || w.p.length < 2) return null;
  const c = cumOf(w, w.p), total = c[c.length - 1] * 111_320;   // longueur du tronçon en mètres
  if (total < 1) return null;
  return along(w, Math.max(0, Math.min(1, (k ? k.f : progress(v, t)) + meters / total)))?.pos ?? null;
}

/** Direction à l'instant t (degrés) : celle du tracé à cet endroit, pour que la flèche suive les virages */
export function vehicleHeading(v: Vehicle, t = serverNow()): number {
  const c = carry(v, t), w = c ? c.o : v;
  const a = along(w, c ? c.f : progress(v, t));
  if (!a || !w.p) return w.h;
  const p0 = w.p[a.i - 1], p1 = w.p[a.i];
  return (Math.atan2((p1[1] - p0[1]) * Math.cos(rad(p0[0])), p1[0] - p0[0]) * 180 / Math.PI + 360) % 360;
}

/** Ce qu'affiche le panneau d'un véhicule suivi : état, vitesse moyenne estimée sur le tronçon, prochains arrêts */
export function followInfo(v: Vehicle, t = serverNow()): { state: string; speed: number | null; next: [string, number][] } {
  // arrêts déjà passés : retirés dès l'heure de passage
  const next = v.next.filter(([, at]) => at > t).map(([name, at]) => [name, Math.max(0, Math.round((at - t) / 60000))] as [string, number]);
  if (v.w) return { state: "Au terminus", speed: 0, next };
  if (v.x) return { state: "Immobilisé", speed: 0, next };   // la durée est dans l'encadré au-dessus
  const atStop = v.a[0] === v.b[0] && v.a[1] === v.b[1];
  if (atStop) return { state: "À quai", speed: 0, next };
  // tram ou bus : vitesse du moment (encore à quai, accélération, croisière, freinage) ; train : moyenne du serveur
  const pr = profileOf(v);
  if (pr && (t - v.a[2]) / 1000 < pr.wait && progress(v, t) < 0.01) return { state: "À quai", speed: 0, next };
  const now = speedAt(v, t);
  if (now !== null) return { state: "En route", speed: now, next };
  if (v.s !== undefined) return { state: "En route", speed: v.s, next };
  const meters = v.p && v.p.length > 1 ? cumOf(v, v.p)[v.p.length - 1] * 111_320 : len([v.a[0], v.a[1]], [v.b[0], v.b[1]]) * 111_320;
  const secs = (v.b[2] - v.a[2]) / 1000;
  return { state: "En route", speed: secs > 0 ? Math.round((meters / secs) * 3.6) : null, next };
}

export const vehicleKind = (v: Vehicle): "tram" | "bus" | "ter" => (v.m === "ter" ? "ter" : v.m === "tram" ? "tram" : v.m === "bus" ? "bus" : isTram(v.line) ? "tram" : "bus");
