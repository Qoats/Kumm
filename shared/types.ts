/** Types partagés entre le serveur et l'application */

export type LineId = string;

/** Un arrêt (les quais d'un même arrêt sont regroupés) */
export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** position sur la carte schématique */
  x: number;
  y: number;
  lines: LineId[];
  /** codes à essayer pour interroger l'API : code de l'arrêt, puis codes des quais */
  refs?: string[];
}

/** Prochains passages d'une ligne dans une direction (heures en millisecondes) */
export interface Departure {
  line: LineId;
  dest: string;
  times: number[];
}

export interface StopDeparture {
  stop: Stop;
  d: Departure;
}

/** Un lieu choisi par l'utilisateur : adresse ou arrêt */
export interface Place {
  label: string;
  lat: number;
  lon: number;
  stop?: Stop;
}

/** Une consigne de marche (« Tournez à gauche sur… ») */
export interface WalkStep {
  text: string;
  type: string;
  modifier?: string;
  /** distance jusqu'à la consigne suivante, en mètres */
  distance: number;
  /** lieu où la consigne s'applique */
  lat: number;
  lon: number;
}

export interface WalkRoute {
  distance: number;
  duration: number;
  /** tracé : [longitude, latitude] */
  coords: [number, number][];
  steps: WalkStep[];
}

/** Autres points d'intérêt de la carte (hors arrêts de bus et de tram) */
export type PoiKind = "velhop" | "velopark" | "pr" | "flexhop" | "ter";

export interface Poi {
  id: string;
  kind: PoiKind;
  name: string;
  lat: number;
  lon: number;
  /** position sur la carte schématique */
  x: number;
  y: number;
  /** ex. « 212 places libres sur 400 » */
  info?: string;
}
