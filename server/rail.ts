/**
 * Voies ferrées d'Alsace, de Lorraine et de la ligne Paris-Est → Strasbourg (data/rail.json, extrait d'OpenStreetMap par scripts/build-rail.mjs) : un train suit
 * les rails entre deux gares, au lieu d'une ligne droite. Le calcul est dans shared/rail-core.ts (partagé avec le moteur local d'Android).
 * Sans le fichier, ou si une gare est hors de la zone couverte, le train va en ligne droite.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRail } from "../shared/rail-core.js";

type Pt = [number, number];
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = [path.join(here, "..", "..", "data", "rail.json"), path.join(here, "..", "data", "rail.json")].find(f => fs.existsSync(f));

let rail = createRail([]);
try {
  if (FILE) rail = createRail((JSON.parse(fs.readFileSync(FILE, "utf8")) as { ways?: Pt[][] }).ways ?? [], m => console.log(m));
} catch (e) { console.warn("Voies ferrées illisibles :", e instanceof Error ? e.message : e); }
console.log(`Voies ferrées : ${rail.points ? rail.points + " points" : "aucune (trains en ligne droite entre deux gares)"}`);

export const railBetween = rail.railBetween;
