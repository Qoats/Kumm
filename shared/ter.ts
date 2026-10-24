/**
 * Gares TER de l'Eurométropole de Strasbourg (code UIC SNCF, nom affiché, position de la gare).
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
  { uic: "87212316", name: "La Wantzenau", lat: 48.665204, lon: 7.824822 }
];

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
