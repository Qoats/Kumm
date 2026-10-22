import type { Poi, Stop } from "../../shared/types";
import { words } from "./network";

/**
 * Véloparks (parkings à vélos sécurisés) : sites cités par la CTS, tous à côté d'une station de tram ou d'un arrêt de bus.
 * Source : page « Véloparcs CTS (P+V) » de cts-strasbourg.eu (liste des sites) ; ils sont placés à la position de l'arrêt
 * du même nom dans la liste des arrêts de la CTS. VéloParcs du centre-ville : strasbourg.eu « Où garer son vélo à Strasbourg ? ».
 */
export const VELOPARCS: { name: string; stops: string[]; info?: string }[] = [
  { name: "Jean Jaurès", stops: ["Jean Jaurès"] },
  { name: "Schluthfeld", stops: ["Schluthfeld"] },
  { name: "Kibitzenau", stops: ["Kibitzenau"] },
  { name: "Krimmeri Stade de la Meinau", stops: ["Krimmeri Stade de la Meinau"] },
  { name: "Illkirch Lixenbuhl", stops: ["Illkirch Lixenbuhl"] },
  { name: "Parc des Sports", stops: ["Parc des Sports", "Parc des Sports Zénith"] },
  { name: "Rives de l'Aar", stops: ["Rives de l'Aar"] },
  { name: "Boecklin", stops: ["Robertsau Boecklin", "Boecklin"] },
  { name: "Rotonde", stops: ["Rotonde"], info: "Titre « Vélo » gratuit à retirer à l'agence CTS" },
  { name: "Baggersee", stops: ["Baggersee"] },
  { name: "Montagne Verte", stops: ["Montagne Verte"] },
  { name: "Poteries", stops: ["Poteries"] },
  { name: "Hoenheim Gare", stops: ["Hoenheim Gare"] },
  { name: "Hohwart", stops: ["Hohwart"] },
  { name: "Wolfisheim Henri Rendu", stops: ["Wolfisheim Henri Rendu"] },
  { name: "Winston Churchill", stops: ["Winston Churchill"] },
  { name: "Campus d'Illkirch", stops: ["Campus d'Illkirch"] },
  { name: "Plobsheim Mairie", stops: ["Plobsheim Mairie"] },
  { name: "Lorient", stops: ["Lorient"] }
];

/** VéloParcs du centre-ville (gérés par Strasbourg Mobilités) : position fixe */
export const VELOPARCS_CENTRE: { name: string; lat: number; lon: number; info: string }[] = [
  { name: "VéloParc Gare", lat: 48.5849, lon: 7.7352, info: "760 places · niveau -1 de la Grande Verrière · sur abonnement" },
  { name: "VéloParc Sainte-Aurélie", lat: 48.58255, lon: 7.73228, info: "680 places · 1 boulevard de Metz · sur abonnement" },
  { name: "Parking vélos Wodli", lat: 48.58738, lon: 7.73677, info: "126 places couvertes gratuites" }
];

const key = (s: string): string => words(s).join("");

/** Place chaque Vélopark à la position de l'arrêt du même nom, légèrement décalé pour ne pas cacher le repère de l'arrêt */
export function buildVeloparks(stops: Stop[]): Poi[] {
  const byName = new Map<string, Stop>();
  for (const s of stops) if (!byName.has(key(s.name))) byName.set(key(s.name), s);
  const out: Poi[] = [];
  VELOPARCS.forEach((v, i) => {
    const s = v.stops.map(n => byName.get(key(n))).find(Boolean);
    if (!s) return;
    out.push({ id: `velopark-${i}`, kind: "velopark", name: `Véloparc ${v.name}`, lat: s.lat + 0.00008, lon: s.lon + 0.00008, x: 0, y: 0,
      info: v.info ?? "Parking vélos sécurisé et couvert · accès 24 h/24 avec Badgéo" });
  });
  VELOPARCS_CENTRE.forEach((v, i) => out.push({ id: `velopark-c${i}`, kind: "velopark", name: v.name, lat: v.lat, lon: v.lon, x: 0, y: 0, info: v.info }));
  return out;
}
