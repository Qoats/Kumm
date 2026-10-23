import type { Poi, Stop } from "../../shared/types";
import type { Layer } from "./kinds";
import { isTerStationName, isTramStationName } from "./network";

/* Centre de la carte (Homme de Fer) et échelle : 1° de longitude ≈ 8832 unités, 1° de latitude ≈ 13344 unités */
export const CENTER = { lat: 48.5846, lon: 7.7507 };
export const KX = 8832;
export const KY = 13344;

/** Couleurs officielles des lignes (fond, puis texte quand il n'est pas blanc), d'après la CTS (lines-discovery : RouteColor,
   RouteTextColor). Valeurs de départ (affichage immédiat, hors ligne), remplacées au lancement par celles envoyées par la CTS. */
export const COLORS: Record<string, string> = {10:"#F8B705",12:"#89CDD1",15:"#89CDD1",17:"#F3C6DB",18:"#F8B705",2:"#E10D19",22:"#89CDD1",30:"#FFDC08",31:"#F3C6DB",40:"#FFDC08",42:"#C273A8",43:"#E75113",44:"#729ECF",45:"#9A5527",57:"#EC7007",60:"#EC7007",62:"#BDD753",63:"#7DBBDF",64:"#EA5297",67:"#6DB122",70:"#F8B705",71:"#73B3DE",72:"#F3C6DB",73:"#B5833C",74:"#008231",75:"#9FC204",76:"#C273A8",A:"#E10D19",B:"#009EE0",C:"#F29400",C1:"#22AE84",C3:"#9FC204",C4:"#F08118",C5:"#25715C",C6:"#7D5D9F",C7:"#008A27",C8:"#88CDD5",C9:"#F26640",D:"#009933",E:"#9085BA",F:"#97BF0D",G:"#F6C900",H:"#A62341",N1:"#B55C38",N2:"#7F0047",N3:"#2D3E58",S1:"#BD2685",S10:"#BD2685",S12:"#BD2685",S13:"#BD2685",S14:"#BD2685",S16:"#BD2685",S2:"#BD2685",S5:"#BD2685",S6:"#BD2685",S8:"#BD2685",L1:"#7AB8E0",L2:"#C7A6D9",L3:"#E6A0B5"};
export const TEXT_COLORS: Record<string, string> = {10:"#000000",12:"#000000",15:"#000000",17:"#000000",18:"#000000",22:"#000000",30:"#000000",31:"#000000",40:"#000000",57:"#000000",62:"#000000",63:"#000000",70:"#000000",72:"#000000",75:"#000000",C3:"#000000",C8:"#000000",G:"#000000",S1:"#FAB937",S10:"#FAB937",S12:"#FAB937",S13:"#FAB937",S14:"#FAB937",S16:"#FAB937",S2:"#FAB937",S5:"#FAB937",S6:"#FAB937",S8:"#FAB937"};
/** Couleur du texte sur la pastille d'une ligne */
export const lineText = (l: string): string => TEXT_COLORS[l] ?? "#fff";
export const TRAMS: string[] = ["A","B","C","D","E","F"];
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

/** Une info trafic de la CTS (texte brut, préparé par le serveur : /api/messages) */
export interface TrafficMsg {
  id: string;
  channel: "disruption" | "works";
  lines: string[];
  title: string;
  period: string;
  text: string;
  /** début de la perturbation, fin prévue, dernière mise à jour (dates ISO) */
  start?: string;
  end?: string;
  updated?: string;
}

/** Infos trafic en cours (rempli au démarrage puis toutes les 5 minutes) */
export const MESSAGES: TrafficMsg[] = [];
export const MSG_STATE: { status: "loading" | "ok" | "error" } = { status: "loading" };
const sameLine = (a: string, b: string): boolean => a === b || lineLabel(a) === lineLabel(b);
export const messagesFor = (l: string): TrafficMsg[] => MESSAGES.filter(m => m.lines.some(r => sameLine(r, l)));
/** Infos trafic qui citent un arrêt par son nom (arrêt non desservi, déplacé, terminus modifié…) */
const fold = (t: string): string => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, " ").toLowerCase();
export function messagesForStop(name: string): TrafficMsg[] {
  const n = fold(name).trim();
  if (n.length < 4) return [];
  const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}($|[^a-z0-9])`);
  return MESSAGES.filter(m => re.test(fold(m.title + " " + m.text)));
}
/** Ligne touchée par un incident ou des travaux en cours */
export const hasAlert = (l: string): boolean => MESSAGES.some(m => m.lines.some(r => sameLine(r, l)));

/** Infos trafic de démonstration (mode ?mock uniquement) */
export const MOCK_MESSAGES: TrafficMsg[] = [
  { id: "demo-1", channel: "disruption", lines: ["B"], title: "Exemple : ligne B interrompue", period: "Démonstration", text: "Message fictif du mode démonstration." },
  { id: "demo-2", channel: "works", lines: ["C1", "G"], title: "Exemple : arrêt déplacé", period: "Démonstration", text: "Message fictif du mode démonstration." }
];

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
