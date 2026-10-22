/**
 * Parkings relais (P+R) du réseau CTS : noms, positions et capacités.
 * Source : jeu de données « occupation des parkings en temps réel » / « parkings » de l'Eurométropole de
 * Strasbourg (data.strasbourg.eu, Licence Ouverte), tel que repris par strasbourg365.com/parkings ; liste des 12 P+R
 * confirmée par la page « Park-and-Ride » de la CTS. L'occupation en direct est ajoutée quand le service répond.
 */
export interface PrSite { id: string; name: string; lat: number; lon: number; capacity: number }

export const PR_SITES: PrSite[] = [
  { id: "pr-ducs",      name: "Ducs d'Alsace",                  lat: 48.5892383943901, lon: 7.71596677960563, capacity: 600 },
  { id: "pr-baggersee", name: "Baggersee",                      lat: 48.5446469517313, lon: 7.73569466237007, capacity: 460 },
  { id: "pr-rives",     name: "Rives de l'Aar",                 lat: 48.5996315289378, lon: 7.75381030140218, capacity: 456 },
  { id: "pr-hoenheim",  name: "Hoenheim Gare",                  lat: 48.62788850674,   lon: 7.75778587766437, capacity: 340 },
  { id: "pr-romains",   name: "Parc des Romains",               lat: 48.581556385183,  lon: 7.724652978338745, capacity: 324 },
  { id: "pr-elsau",     name: "Elsau",                          lat: 48.5684033861816, lon: 7.73031009299049, capacity: 220 },
  { id: "pr-rotonde",   name: "Rotonde",                        lat: 48.5912264325338, lon: 7.72610093327335, capacity: 450 },
  { id: "pr-eee",       name: "Espace Européen de l'Entreprise", lat: 48.6167445706505, lon: 7.71966106577424, capacity: 170 },
  { id: "pr-wolfisheim", name: "Wolfisheim Henri Rendu",        lat: 48.591898967989,  lon: 7.6719818029537885, capacity: 103 },
  { id: "pr-boecklin",  name: "Robertsau Boecklin",             lat: 48.5979711278741, lon: 7.77656295435852, capacity: 92 },
  { id: "pr-poteries",  name: "Poteries",                       lat: 48.5833504860946, lon: 7.69108730315623, capacity: 102 },
  { id: "pr-kibitzenau", name: "Kibitzenau",                    lat: 48.5556289,       lon: 7.7677689,       capacity: 93 }
];
