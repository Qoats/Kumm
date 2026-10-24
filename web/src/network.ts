/**
 * Listes de référence trouvées sur internet, pour classer les arrêts d'après leur NOM
 * (sans dépendre de la façon dont l'API CTS désigne les lignes).
 *
 * Sources :
 *  - Stations de tram : index des stations du plan du tramway de Strasbourg, version 2.12
 *    du 19 janvier 2026 (cartometro.com), complété par les noms cités par la CTS dans ses
 *    avis de trafic (prolongement de la ligne F vers Wolfisheim, terminus de la ligne A, etc.).
 * Les gares TER sont dans shared/ter.ts (gares SNCF de l'Eurométropole).
 * Pour corriger ou compléter : ajoutez simplement un nom dans l'une de ces listes.
 */

export const TRAM_STATIONS: string[] = [
  "Alt Winmärik (Vieux Marché aux Vins)", "Alt Winmärik", "Ancienne Synagogue Les Halles", "Aristide Briand", "Baggersee",
  "Bohrie", "Broglie", "Campus d'Illkirch", "Cervantès", "Citadelle", "Colonne", "Comtes", "Dante", "Droits de l'Homme",
  "Ducs d'Alsace", "Elmerforst", "Elsau", "Emile Mathis", "Esplanade", "Etoile Bourse", "Etoile Polygone",
  "Faubourg de Saverne", "Faubourg National", "Forum de l'Ill", "Futura Glacière", "Général de Gaulle", "Gallia",
  "Gare Centrale", "Gravière", "Hôpital de Hautepierre", "Hochschule / Läger", "Hoenheim Gare", "Hohwart", "Homme de Fer",
  "Illkirch Lixenbuhl", "Illkirch Graffenstaden", "Jardiniers", "Jean Jaurès", "Kehl Bahnhof", "Kehl Rathaus", "Kibitzenau",
  "Krimmeri Stade de la Meinau", "Laiterie", "Landsberg", "Langstross Grand'Rue", "Le Galet", "Le Marais", "Le Ried",
  "Leclerc", "Lingolsheim Alouettes", "Lingolsheim Tiergaertel", "Lycée Couffignal", "Lycée Jean Monnet", "Lycée Kléber",
  "Lycée Marc Bloch", "Mélanie Binger", "Marcel Rudloff", "Martin Schongauer", "Montagne Verte", "Musée d'Art Moderne",
  "Observatoire", "Ostwald Hôtel de Ville", "Papeterie Niederau", "Parc des Romains", "Parc des Sports", "Parc des Sports Zénith",
  "Parc du Contades", "Parlement Européen", "Paul Eluard", "Place d'Islande", "Pont Phario", "Pont Vauban", "Port du Rhin",
  "Porte Blanche", "Porte de l'Hôpital", "Poteries", "République", "Rives de l'Aar", "Robertsau Boecklin", "Robertsau L'Escale",
  "Rodolphe Reuss", "Neuhof Rodolphe Reuss", "Rotonde", "Saint Christophe", "Schluthfeld", "Saint Florent", "Starcoop",
  "Université", "Wacken", "Wihrel", "Winston Churchill",
  // prolongement de la ligne F vers Wolfisheim
  "Wolfisheim Henri Rendu", "Parc d'activités d'Eckbolsheim Zénith", "Bois Romain", "Eckelse", "Octroi", "Hohberg", "Gruber"
];

/** Pôles d'échanges : une seule icône de gare sur la carte, et une fiche avec tous les départs (onglets Tous / Tram / Bus) */
export const HUBS: string[] = ["Gare Centrale"];

/** minuscules, sans accents ni ponctuation : « Langstross/Grand’Rue » = « langstross grand rue » */
export function words(s: string): string[] {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae")
    .replace(/&/g, " ").split(/[^a-z0-9]+/).filter(Boolean);
}
const key = (s: string): string => words(s).join("");

const TRAM_SET = new Set(TRAM_STATIONS.map(key));

export const isTramStationName = (name: string): boolean => TRAM_SET.has(key(name));
const HUB_SET = new Set(HUBS.map(key));
export const isHubName = (name: string): boolean => HUB_SET.has(key(name));
/** Clé de regroupement des quais : « Gare Centrale » et « Gare centrale » sont le même arrêt */
export const stopKey = key;
