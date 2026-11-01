/**
 * Gares TER de l'Eurométropole de Strasbourg, de la ligne Strasbourg – Lauterbourg et de la ligne Paris-Est – Strasbourg (code UIC SNCF, nom affiché, position).
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

/** Ligne Paris-Est – Strasbourg (trains TER directs et omnibus) : gares hors de l'Eurométropole, de Paris à Strasbourg
    (de Strasbourg vers Paris). Leurs départs sont affichés comme ceux des gares de l'Eurométropole. */
export const TER_STATIONS_PARIS: TerStation[] = [
  { uic: "87212126", name: "Stephansfeld", lat: 48.717587, lon: 7.704595 },
  { uic: "87212134", name: "Brumath", lat: 48.733077, lon: 7.700421 },
  { uic: "87212142", name: "Mommenheim", lat: 48.755951, lon: 7.642303 },
  { uic: "87212159", name: "Schwindratzheim", lat: 48.753658, lon: 7.600597 },
  { uic: "87212167", name: "Hochfelden", lat: 48.755416, lon: 7.572281 },
  { uic: "87212175", name: "Wilwisheim", lat: 48.745877, lon: 7.507836 },
  { uic: "87212183", name: "Dettwiller", lat: 48.751916, lon: 7.465077 },
  { uic: "87212209", name: "Steinbourg", lat: 48.763529, lon: 7.416299 },
  { uic: "87212225", name: "Saverne", lat: 48.744483, lon: 7.362055 },
  { uic: "87215160", name: "Lutzelbourg", lat: 48.730011, lon: 7.251587 },
  { uic: "87215079", name: "Réding", lat: 48.74296, lon: 7.095885 },
  { uic: "87215012", name: "Sarrebourg", lat: 48.73808, lon: 7.05285 },
  { uic: "87215103", name: "Igney - Avricourt", lat: 48.646701, lon: 6.805306 },
  { uic: "87141150", name: "Lunéville", lat: 48.58799, lon: 6.496997 },
  { uic: "87141143", name: "Mont-sur-Meurthe", lat: 48.559964, lon: 6.449774 },
  { uic: "87141135", name: "Blainville - Damelevières", lat: 48.564799, lon: 6.386948 },
  { uic: "87141127", name: "Rosières-aux-Salines", lat: 48.605441, lon: 6.350631 },
  { uic: "87141119", name: "Dombasle-sur-Meurthe", lat: 48.623332, lon: 6.343566 },
  { uic: "87141101", name: "Varangéville - Saint-Nicolas", lat: 48.635215, lon: 6.313142 },
  { uic: "87141093", name: "Laneuveville-devant-Nancy", lat: 48.65568, lon: 6.227977 },
  { uic: "87141010", name: "Jarville-la-Malgrange", lat: 48.669712, lon: 6.202401 },
  { uic: "87141002", name: "Nancy", lat: 48.689857, lon: 6.174579 },
  { uic: "87141085", name: "Champigneulles", lat: 48.735025, lon: 6.168952 },
  { uic: "87141077", name: "Frouard", lat: 48.755428, lon: 6.143927 },
  { uic: "87141069", name: "Liverdun", lat: 48.749387, lon: 6.061669 },
  { uic: "87141051", name: "Fontenoy-sur-Moselle", lat: 48.711419, lon: 5.980173 },
  { uic: "87141044", name: "Toul", lat: 48.679011, lon: 5.880499 },
  { uic: "87141036", name: "Foug", lat: 48.679264, lon: 5.791265 },
  { uic: "87175828", name: "Pagny-sur-Meuse", lat: 48.696582, lon: 5.733632 },
  { uic: "87175257", name: "Commercy", lat: 48.765749, lon: 5.58861 },
  { uic: "87175240", name: "Lérouville", lat: 48.796902, lon: 5.538437 },
  { uic: "87175067", name: "Nançois - Tronville", lat: 48.718022, lon: 5.29114 },
  { uic: "87175042", name: "Bar-le-Duc", lat: 48.773598, lon: 5.167053 },
  { uic: "87175018", name: "Revigny", lat: 48.824193, lon: 4.985513 },
  { uic: "87174276", name: "Vitry-le-François", lat: 48.717913, lon: 4.587515 },
  { uic: "87174003", name: "Châlons-en-Champagne", lat: 48.955252, lon: 4.348656 },
  { uic: "87171553", name: "Épernay", lat: 49.046289, lon: 3.959798 },
  { uic: "87171512", name: "Dormans", lat: 49.07908, lon: 3.641835 },
  { uic: "87116582", name: "Château-Thierry", lat: 49.03814, lon: 3.409302 },
  { uic: "87116517", name: "La Ferté-sous-Jouarre", lat: 48.95078, lon: 3.125466 },
  { uic: "87113001", name: "Paris Est", lat: 48.876742, lon: 2.358424 }
];

/** Toutes les gares TER connues de Kumm (fiche et départs) */
export const TER_STATIONS: TerStation[] = [...TER_STATIONS_EMS, ...TER_STATIONS_PARIS];

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
