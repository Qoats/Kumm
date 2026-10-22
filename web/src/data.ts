import type { Poi, Stop } from "../../shared/types";
import type { Layer } from "./kinds";
import { isTerStationName, isTramStationName } from "./network";

/* Centre de la carte (Homme de Fer) et échelle : 1° de longitude ≈ 8832 unités, 1° de latitude ≈ 13344 unités */
export const CENTER = { lat: 48.5846, lon: 7.7507 };
export const KX = 8832;
export const KY = 13344;

export const COLORS: Record<string, string> = {A:"#E30613",B:"#009FE3",C:"#F29100",D:"#009A3E",E:"#8E84BA",F:"#9AC20C",G:"#F5CD00",H:"#A5213F",C1:"#1FAE85",L1:"#7AB8E0",L2:"#C7A6D9",L3:"#E6A0B5"};
export const TRAMS: string[] = ["A","B","C","D","E","F"];
export const ALERTS: string[] = ["A","B","C","D","F","G","C1"];
export const ALL_LINES: string[] = ["A","B","C","D","E","F","G","H","C1","L1","L2","L3"];
export const DIRS: Record<string, [string, string]> = {
  A:["Illkirch Lixenbühl","Parc des Sports Zénith"], B:["Hœnheim Gare","Lingolsheim Alouettes"],
  C:["Gare Centrale","Neuhof R. Reuss"], D:["Kehl Rathaus","Hôpital de Hautepierre"],
  E:["Robertsau Boecklin","Campus d’Illkirch"], F:["Place d’Islande","Place d’Islande"],
  G:["Place d’Islande","Espace Européen de l’Entreprise"], H:["Hôpital Civil","Elsau"],
  C1:["Gare Centrale","Poteries"], L1:["Gare Centrale","Ostwald"], L2:["Gare Centrale","Eckbolsheim"], L3:["Gare Centrale","Schiltigheim"]
};

/** Mode de chaque ligne d'après lines-discovery (rempli au démarrage) ; à défaut on devine d'après le nom */
export const LINE_MODES: Record<string, Layer> = {};
/** Nom public d'une ligne quand l'API la désigne par un identifiant interne (« 100 » → « A ») */
export const LINE_NAMES: Record<string, string> = {};
export const lineLabel = (l: string): string => {
  const n = LINE_NAMES[l];
  return n && n.length <= 5 && !/\s/.test(n) ? n : l;   // jamais un nom long de parcours
};
export const isTram = (l: string): boolean => (LINE_MODES[l] ? LINE_MODES[l] === "tram" : TRAMS.includes(lineLabel(l)));
export const isRail = (l: string): boolean => (LINE_MODES[l] ? LINE_MODES[l] === "ter" : /^(TER|RER)/i.test(lineLabel(l)));
export const lineKind = (l: string): Layer => (isRail(l) ? "ter" : isTram(l) ? "tram" : "bus");

/**
 * Type d'un arrêt : d'après son NOM (listes de stations trouvées sur internet, voir network.ts),
 * jamais d'après les lignes de l'API. Une station de tram reste « tram » même si des bus s'y arrêtent.
 */
export function stopKind(name: string): Layer {
  if (isTramStationName(name)) return "tram";
  if (isTerStationName(name)) return "ter";
  return "bus";
}

const kindCache = new Map<string, Layer>();
export const kindOfStop = (s: { name: string }): Layer => {
  let k = kindCache.get(s.name);
  if (!k) { k = stopKind(s.name); kindCache.set(s.name, k); }
  return k;
};

/* Arrêts de démonstration (mode ?mock) : x,y = position sur la carte schématique (0–360 / 0–440) */
const RAW_STOPS: { id: string; name: string; x: number; y: number; lines: string[] }[] = [
  {id:"HDF",name:"Homme de Fer",x:150,y:210,lines:["A","D","B","C","F"]},
  {id:"LGS",name:"Langstross/Grand Rue",x:96,y:236,lines:["D"]},
  {id:"GCE",name:"Gare Centrale",x:76,y:150,lines:["A","D","C","E"]},
  {id:"BRO",name:"Broglie",x:208,y:176,lines:["B","C","E"]},
  {id:"REP",name:"République",x:262,y:138,lines:["E","H","L3"]},
  {id:"ETO",name:"Étoile Bourse",x:268,y:244,lines:["A","D","G"]},
  {id:"HCV",name:"Hôpital Civil",x:166,y:310,lines:["G","H"]},
  {id:"OBS",name:"Observatoire",x:252,y:196,lines:["C1","L1"]},
  {id:"KRU",name:"Krutenau",x:208,y:290,lines:["C","F","L2"]},
  {id:"FAU",name:"Faubourg National",x:118,y:176,lines:["C1","H"]},
  {id:"BOU",name:"Boulevard de la Marne",x:60,y:350,lines:["B","E"]},
  {id:"ESP",name:"Esplanade",x:130,y:370,lines:["A","D","E"]}
];

export const MOCK_STOPS: Stop[] = RAW_STOPS.map(r => ({
  ...r,
  lat: CENTER.lat - (r.y - 222) / KY,
  lon: CENTER.lon + (r.x - 170) / KX
}));

export const NEWS: { t: string; s: string }[] = [
  {t:"Agence commerciale temporairement fermée",s:"À partir du 17 octobre et pour une durée indéterminée"},
  {t:"Gagnez vos places pour l’Opéra !",s:"Tentez de remporter 2 places pour l’opéra Ariane à Naxos le 4 novembre à 20 h !"},
  {t:"Travaux ligne B",s:"Trafic perturbé entre Gare Centrale et Broglie ce week-end"},
  {t:"Nouveau : Flex’hop",s:"Le transport à la demande étendu à de nouvelles communes"},
  {t:"Vélhop",s:"Louez un vélo pour la journée dès 3 €"}
];


export const MSG: Record<string, string> = {
  A:"Tous les jours dès 20 h, le terminus côté Parc des Sports Zénith est déplacé à Hôpital de Hautepierre. Parc des Sports Zénith, Le Galet, Cervantès et Dante ne sont plus desservis.",
  B:"Ligne interrompue entre Martin Schongauer et Montagne Verte en journée, puis entre Ostwald Hôtel de Ville et Montagne Verte après 20 h. Bus de remplacement : ligne C4 (Ostwald, Wihrel, Elmerforst) ou arrêt provisoire au 41 rue de l’Unterelsau.",
  C:"Dès 20 h, le terminus vers Neuhof Rodolphe Reuss est déplacé à Kibitzenau. Saint Christophe et Neuhof Rodolphe Reuss ne sont plus desservis.",
  D:"Dès 20 h, le terminus vers Poteries est déplacé à Hôpital de Hautepierre. Dante, Paul Eluard, Marcel Rudloff et Poteries ne sont plus desservis.",
  F:"Dès 20 h, le terminus vers Wolfisheim Henri Rendu est déplacé à Comtes. Les stations au-delà de Comtes ne sont plus desservies."
};


/* Points de démonstration (mode ?mock) */
const RAW_POIS: { id: string; kind: Poi["kind"]; name: string; x: number; y: number; info?: string }[] = [
  { id: "vh1", kind: "velhop", name: "Vélhop Homme de Fer", x: 128, y: 196, info: "8 vélos disponibles" },
  { id: "vh2", kind: "velhop", name: "Vélhop Broglie", x: 196, y: 150, info: "3 vélos disponibles" },
  { id: "vh3", kind: "velhop", name: "Vélhop Étoile", x: 236, y: 262, info: "12 vélos disponibles" },
  { id: "vh4", kind: "velhop", name: "Vélhop Krutenau", x: 184, y: 300 },
  { id: "vp1", kind: "velopark", name: "Vélopark Gare Centrale", x: 96, y: 166, info: "Parking vélos sécurisé" },
  { id: "vp2", kind: "velopark", name: "Vélopark République", x: 276, y: 160 },
  { id: "vp3", kind: "velopark", name: "Vélopark Esplanade", x: 150, y: 352 },
  { id: "pr1", kind: "pr", name: "P+R Rotonde", x: 36, y: 262, info: "212 places libres sur 400" },
  { id: "pr2", kind: "pr", name: "P+R Elsau", x: 306, y: 330, info: "58 places libres sur 250" },
  { id: "fx1", kind: "flexhop", name: "Zone Flex’hop Nord", x: 40, y: 110, info: "Transport à la demande, réservation dans l’app" },
  { id: "fx2", kind: "flexhop", name: "Zone Flex’hop Sud", x: 326, y: 252 },
  { id: "ter1", kind: "ter", name: "Strasbourg-Ville", x: 54, y: 128, info: "Gare TER" }
];
export const MOCK_POIS: Poi[] = RAW_POIS.map(r => ({
  ...r,
  lat: CENTER.lat - (r.y - 222) / KY,
  lon: CENTER.lon + (r.x - 170) / KX
}));
