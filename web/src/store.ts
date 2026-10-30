import type { StepId } from "./onboarding";
import type { Release } from "./update";
import type { Place, Poi, Stop } from "../../shared/types";
import { LAYERS } from "./kinds";
import { loadPrefs } from "./themes";
import { loadAlerts } from "./alerts";
import type { AlertPrefs } from "./alerts";
import type { Prefs } from "./themes";
import type { Journey } from "./journey";
import type { Layer } from "./kinds";
import { CONFIG } from "./config";
import { CENTER, KX, KY, MOCK_POIS, MOCK_STOPS } from "./data";

export type Tab = "home" | "search" | "lines" | "nearby" | "trips";
export type Filter = "all" | "bus" | "tram" | "ter";
export type Overlay = { k: "line"; id: string } | { k: "stop"; id: string; /** onglet des départs : tous, ou un seul mode (arrêts desservis par trams et bus) */ mode?: "tram" | "bus" | "ter";
  /** horaires prévus à partir de cette heure (sinon : passages en temps réel) ; pick : choix de la date en cours */
  at?: number; pick?: boolean; /** date et heure en cours de choix (gardées si l'écran se redessine) */ draft?: number } | { k: "poi"; id: string } | { k: "veh"; id: string } | { k: "settings" } | { k: "look" } | { k: "stats" } | { k: "noel" } | { k: "bikepick" } | { k: "placeset"; which: PlaceKey } | { k: "msgs" } | { k: "favs" } | { k: "account" } | { k: "help" } | { k: "widget" } | null;
/** adresses enregistrées de l'accueil */
export type PlaceKey = "home" | "work";

export interface Modal { t: string; p: string; b: string[]; go?: () => void }

export interface State {
  tab: Tab;
  filter: Filter;
  prefs: Prefs;
  /** alertes trafic (notifications) */
  alerts: AlertPrefs;
  /** catégories visibles sur la carte */
  layers: Record<Layer, boolean>;
  /** hauteur du panneau « À proximité » : 0 réduit (la carte en entier), 1 moitié, 2 agrandi */
  sheet: 0 | 1 | 2;
  overlay: Overlay;
  q: string;
  fav: string[];
  /** station Vélhop choisie pour la tuile de l'accueil (appui long) ; null : la plus proche */
  bikeStation: string | null;
  /** adresses enregistrées pour les tuiles « Maison » et « Travail » de l'accueil */
  places: Partial<Record<PlaceKey, Place>>;
  /** saisie de l'écran de choix d'une adresse, et ses suggestions (arrêts, puis adresses) */
  placeQ: string;
  placeSugg: Place[];
  modal: Modal | null;
  /** fenêtre « prévenez-moi avant ce passage » ouverte (choix du délai) */
  arrPick: { line: string; dest: string; at: number; times: number[]; stopId: string } | null;
  /** adresses trouvées par la recherche (Base Adresse Nationale), pour le texte `q` */
  searchAddr: { q: string; items: Place[] } | null;
  /** texte cherché dans « Mes arrêts favoris » */
  favQ: string;
  /** fiche d'une ligne : sens affiché (index dans les parcours de la ligne) */
  lineDir: number;
  /** réglage d'un widget de l'écran d'accueil en cours (voir widgets.ts) */
  wsetup: import("./widgets").WidgetSetup | null;
  /** écran à retrouver en quittant l'écran des itinéraires (ouvert par « Naviguer ») */
  tripBack: { tab: Tab; overlay: Overlay } | null;
  trip: {
    fromText: string;
    toText: string;
    /** mode choisi : à pied, à vélo, en transports (tram/bus) */
    mode: "walk" | "bike" | "transit";
    /** départ = ma position (sinon `from`, une adresse ou un arrêt choisi) */
    fromIsMe: boolean;
    from: Place | null;
    dest: Place | null;
    sugg: { field: "from" | "to"; items: Place[] } | null;
    /** trajet (ou itinéraire vélo) choisi dans la liste, affiché sur la carte */
    sel: number;
    /** heure du trajet en transports : maintenant, « Partir à » ou « Arriver avant » (at : millisecondes) */
    when: { kind: "now" | "depart" | "arrive"; at: number };
    /** panneau « heure du trajet » ouvert : choix en cours, appliqué par « Valider » */
    whenDraft: { kind: "now" | "depart" | "arrive"; at: number } | null;
  };
  locOn: boolean;
  askedLoc: boolean;
  swiped: boolean;
  toast: string;
  /** « Êtes-vous dans le C6 ? » (ride.ts) : question posée, puis trajet partagé en cours */
  ridePrompt: { id: string; line: string; dest: string } | null;
  riding: { id: string; line: string; dest: string } | null;
  /** alertes de descente pendant une navigation : course suivie (journey.ts) */
  journey: Journey | null;
  /** véhicule suivi sur la carte « À proximité » (paused : l'utilisateur a déplacé la carte) */
  follow: { id: string; paused: boolean } | null;
  /** présentation du premier lancement : étapes à montrer et étape en cours (null : terminée) */
  onb: { steps: StepId[]; i: number; refused: boolean } | null;
  /** page de mise à jour (plein écran, l'application n'est plus utilisable tant qu'elle n'est pas à jour) */
  upd: UpdatePage | null;
}

export interface UpdatePage {
  /** version à installer (null : version trop ancienne pour le serveur, sans mise à jour téléchargeable) */
  rel: Release | null;
  phase: "ready" | "down" | "perm" | "error" | "launched";
  pct: number;
  err?: string;
}

export const STOPS: Stop[] = CONFIG.USE_MOCK ? [...MOCK_STOPS] : [];
export const POIS: Poi[] = CONFIG.USE_MOCK ? [...MOCK_POIS] : [];
export const USER = { ...CENTER };

/** Place un arrêt sur la carte schématique, centrée sur la position de l'utilisateur */
export function project<T extends { lat: number; lon: number; x: number; y: number }>(s: T): T {
  s.x = 170 + (s.lon - USER.lon) * KX;
  s.y = 222 - (s.lat - USER.lat) * KY;
  return s;
}

export const stopById = (id: string): Stop | undefined => STOPS.find(s => s.id === id);
export const mins = (t: number): number => Math.max(0, Math.round((t - Date.now()) / 60000));

export const S: State = {
  tab: "home", filter: "all", prefs: loadPrefs(), alerts: loadAlerts(), layers: Object.fromEntries(LAYERS.map(k => [k, true])) as Record<Layer, boolean>, sheet: 1, overlay: null, q: "", fav: [], bikeStation: null, places: {}, placeQ: "", placeSugg: [], modal: null, arrPick: null, searchAddr: null, favQ: "", lineDir: 0, wsetup: null, tripBack: null,
  trip: { fromText: "Ma position", toText: "", mode: "transit", fromIsMe: true, from: null, dest: null, sugg: null, sel: 0, when: { kind: "now", at: 0 }, whenDraft: null }, locOn: false, askedLoc: false, swiped: false, toast: "", ridePrompt: null, riding: null, journey: null, follow: null, onb: null, upd: null
};
try { S.fav = JSON.parse(localStorage.getItem("fav") ?? "[]") as string[]; } catch { /* stockage indisponible */ }
try { S.bikeStation = localStorage.getItem("bikeStation"); } catch { /* stockage indisponible */ }
try { S.places = JSON.parse(localStorage.getItem("places") ?? "{}") as State["places"]; } catch { /* stockage indisponible */ }

/* Le rendu est branché par main.ts (évite les imports circulaires) */
export const hooks = { render: (): void => {} };
export const render = (): void => hooks.render();

export function toggleFav(id: string): void {
  S.fav = S.fav.includes(id) ? S.fav.filter(x => x !== id) : [...S.fav, id];
  try { localStorage.setItem("fav", JSON.stringify(S.fav)); } catch { /* ignoré */ }
  render();
}

export function setPlace(which: PlaceKey, p: Place | null): void {
  if (p) S.places[which] = { label: p.label, lat: p.lat, lon: p.lon }; else delete S.places[which];
  try { localStorage.setItem("places", JSON.stringify(S.places)); } catch { /* ignoré */ }
}

export function setBikeStation(id: string | null): void {
  S.bikeStation = id;
  try { if (id) localStorage.setItem("bikeStation", id); else localStorage.removeItem("bikeStation"); } catch { /* ignoré */ }
}

export function toast(t: string): void {
  S.toast = t;
  render();
  setTimeout(() => { S.toast = ""; render(); }, 1800);
}
