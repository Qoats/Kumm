import type { Place } from "../../shared/types";
import { fold } from "./util";

type House = [number: string, lon: number, lat: number];
export type StreetAddresses = [street: string, city: string, postal: string, houses: House[]];

const ALIASES: Record<string, string> = {
  av: "avenue", bd: "boulevard", pl: "place", rte: "route", r: "rue", imp: "impasse", st: "saint", ste: "sainte"
};
const ARTICLES = new Set(["de", "du", "des", "d", "l", "la", "le", "les"]);
const DAYS = ["un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze",
  "quinze", "seize", "dix sept", "dix huit", "dix neuf", "vingt", "vingt et un", "vingt deux", "vingt trois", "vingt quatre",
  "vingt cinq", "vingt six", "vingt sept", "vingt huit", "vingt neuf", "trente", "trente et un"];
const SPELLING = new RegExp(`\\b(${DAYS.join("|")})(?= (?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\\b)`, "g");
const tokens = (text: string): string[] => fold(text).replace(SPELLING, day => String(DAYS.indexOf(day) + 1)).split(/[^a-z0-9]+/).filter(Boolean);
const expanded = (words: string[]): string[] => words.map(w => ALIASES[w] ?? w);
const houseKey = (s: string): string => fold(s).replaceAll(" ", "");

export function createAddressIndex(rows: StreetAddresses[]): (query: string) => Place[] {
  const streets = rows.map(([street, city, postal, houses]) => ({
    street, city, postal, houses, streetWords: expanded(tokens(street)), cityWords: expanded(tokens(city))
  }));

  return query => {
    const words = tokens(query);
    const postal = words.find(w => /^\d{5}$/.test(w));
    let number = /^\d{1,4}(?:[a-h]|bis|ter|quater)?$/.test(words[0] ?? "") ? words.shift()! : "";
    if (number && /^\d+$/.test(number) && /^(?:[a-h]|bis|ter|quater)$/.test(words[0] ?? "")) number += words.shift();
    const terms = expanded(words.filter(w => w !== postal && !ARTICLES.has(w)));
    if (!terms.length) return [];

    const matches: { score: number; place: Place }[] = [];
    candidates: for (const entry of streets) {
      if (postal && entry.postal !== postal) continue;
      let score = 0;
      let streetMatches = 0;
      for (const term of terms) {
        if (entry.streetWords.includes(term)) { score += 10; streetMatches++; }
        else if (entry.cityWords.includes(term)) score += 9;
        else if (entry.streetWords.some(w => w.startsWith(term))) { score += 5; streetMatches++; }
        else if (entry.cityWords.some(w => w.startsWith(term))) score += 4;
        else continue candidates;
      }
      if (!streetMatches) continue;
      const point = number ? entry.houses.find(([n]) => houseKey(n) === number) : entry.houses[Math.floor(entry.houses.length / 2)];
      if (!point) continue;
      const [n, lon, lat] = point;
      const label = `${number ? `${n} ` : ""}${entry.street}, ${entry.postal ? `${entry.postal} ` : ""}${entry.city}`;
      matches.push({ score: score - Math.hypot(lon - 7.75, lat - 48.58), place: { label, lon, lat } });
    }
    return matches.sort((a, b) => b.score - a.score || a.place.label.localeCompare(b.place.label, "fr")).slice(0, 5).map(x => x.place);
  };
}
