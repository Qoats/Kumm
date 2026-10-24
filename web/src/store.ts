import type { StepId } from "./onboarding";
import type { Release } from "./update";
import type { Place, Poi, Stop } from "../../shared/types";
import { LAYERS } from "./kinds";
import { loadPrefs } from "./themes";
import { loadAlerts } from "./alerts";
import type { AlertPrefs } from "./alerts";
import type { Prefs } from "./themes";
import type { Layer } from "./kinds";
import { CONFIG } from "./config";
import { CENTER, KX, KY, MOCK_POIS, MOCK_STOPS } from "./data";

export type Tab = "home" | "search" | "lines" | "nearby" | "trips" | "buy";
export type Filter = "all" | "bus" | "tram";
export type Overlay = { k: "line"; id: string } | { k: "stop"; id: string; /** onglet des départs : tous, ou un seul mode (arrêts desservis par trams et bus) */ mode?: "tram" | "bus" | "ter" } | { k: "poi"; id: string } | { k: "veh"; id: string } | { k: "settings" } | { k: "msgs" } | { k: "favs" } | null;
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
  modal: Modal | null;
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
  tab: "home", filter: "all", prefs: loadPrefs(), alerts: loadAlerts(), layers: Object.fromEntries(LAYERS.map(k => [k, true])) as Record<Layer, boolean>, sheet: 1, overlay: null, q: "", fav: [], modal: null,
  trip: { fromText: "Ma position", toText: "", mode: "transit", fromIsMe: true, from: null, dest: null, sugg: null, sel: 0, when: { kind: "now", at: 0 }, whenDraft: null }, locOn: false, askedLoc: false, swiped: false, toast: "", onb: null, upd: null
};
try { S.fav = JSON.parse(localStorage.getItem("fav") ?? "[]") as string[]; } catch { /* stockage indisponible */ }

/* Le rendu est branché par main.ts (évite les imports circulaires) */
export const hooks = { render: (): void => {} };
export const render = (): void => hooks.render();

export function toggleFav(id: string): void {
  S.fav = S.fav.includes(id) ? S.fav.filter(x => x !== id) : [...S.fav, id];
  try { localStorage.setItem("fav", JSON.stringify(S.fav)); } catch { /* ignoré */ }
  render();
}

export function toast(t: string): void {
  S.toast = t;
  render();
  setTimeout(() => { S.toast = ""; render(); }, 1800);
}
