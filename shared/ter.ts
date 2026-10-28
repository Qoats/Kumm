/**
 * Gares TER de l'Eurométropole de Strasbourg et de la ligne Strasbourg – Lauterbourg (code UIC SNCF, nom affiché, position).
 * Positions et codes : horaires ouverts de la SNCF (GTFS « Export_OpenData_SNCF_GTFS »).
 * Strasbourg-Ville est rattachée au pôle d'échanges « Gare Centrale » de la CTS (une seule fiche : trams, bus et trains).
 */
export interface TerStation { uic: string; name: string; lat: number; lon: number }

export const TER_STATIONS_EMS: TerStation[] = [
  { uic: "87212027", name: "Strasbourg-Ville", lat: 48.58511, lon: 7.733882 },
  { uic: "87212191", name: "Strasbourg-Roethig", lat: 48.563303, lon: 7.69485 },
  { uic: "87338525", name: "Krimmeri-Meinau", lat: 48.563644, lon: 7.752614 },
  { uic: "87214502", name: "Lingolsheim", lat: 48.559408, lon: 7.678569 },
  { uic: "87214528", name: "Entzheim-Aéroport", lat: 48.54699, lon: 7.62794 },
  { uic: "87212241", name: "Graffenstaden", lat: 48.532834, lon: 7.689874 },
  { uic: "87212258", name: "Geispolsheim", lat: 48.519052, lon: 7.684358 },
  { uic: "87212266", name: "Fegersheim-Lipsheim", lat: 48.490589, lon: 7.672481 },
  { uic: "87212308", name: "Bischheim", lat: 48.611835, lon: 7.742217 },
  { uic: "87338517", name: "Hœnheim-Tram", lat: 48.628622, lon: 7.758123 },
  { uic: "87212100", name: "Mundolsheim", lat: 48.644773, lon: 7.721389 },
  { uic: "87212118", name: "Vendenheim", lat: 48.665922, lon: 7.717777 },
  { uic: "87212316", name: "La Wantzenau", lat: 48.665204, lon: 7.824822 },
  // ligne Strasbourg – Lauterbourg, au-delà de La Wantzenau
  { uic: "87212324", name: "Kilstett", lat: 48.679287, lon: 7.854769 },
  { uic: "87212332", name: "Gambsheim", lat: 48.694909, lon: 7.879179 },
  { uic: "87212340", name: "Herrlisheim", lat: 48.72792, lon: 7.910146 },
  { uic: "87212357", name: "Drusenheim", lat: 48.765844, lon: 7.947796 },
  { uic: "87212365", name: "Sessenheim", lat: 48.796467, lon: 7.989311 },
  { uic: "87212373", name: "Rountzenheim", lat: 48.820457, lon: 8.011774 },
  { uic: "87212407", name: "Roeschwoog", lat: 48.833437, lon: 8.029823 },
  { uic: "87212415", name: "Roppenheim", lat: 48.851162, lon: 8.06231 },
  { uic: "87212431", name: "Seltz", lat: 48.896564, lon: 8.098672 },
  { uic: "87212449", name: "Munchhausen", lat: 48.923851, lon: 8.141035 },
  { uic: "87212456", name: "Mothern", lat: 48.93475, lon: 8.161664 },
  { uic: "87212464", name: "Lauterbourg", lat: 48.967697, lon: 8.182682 }
];

/** Gares où l'on peut voyager en TER avec un abonnement CTS (carte Badgéo) et la contremarque TER :
    les 13 gares de l'Eurométropole, en tête de la liste ci-dessus (sans la ligne vers Kehl) */
export const CONTREMARQUE_TER = new Set(TER_STATIONS_EMS.slice(0, 13).map(s => s.uic));

/** Gare de Strasbourg, rattachée à « Gare Centrale » */
export const STRASBOURG_VILLE = "87212027";

/** Préfixe des identifiants de trajet des trains : « terelsass » (Elsàss, l'Alsace en alsacien) + numéro du train */
export const TER_TRIP_PREFIX = "terelsass";

/** Un départ de train dans une gare */
export interface TrainDeparture {
  /** heure de départ estimée (ms) */
  t: number;
  /** heure prévue (ms) */
  aim: number;
  /** numéro du train */
  num: string;
  dest: string;
  /** nom de la ligne (« Strasbourg - Molsheim ») */
  route: string;
  /** retard en secondes (temps réel SNCF), absent si inconnu */
  delay?: number;
  /** train supprimé, ou gare non desservie ce jour-là */
  cancelled?: boolean;
}
