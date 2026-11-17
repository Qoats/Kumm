/**
 * Tracés des lignes (data/shapes.json, extrait d'OpenStreetMap par scripts/build-shapes.mjs) : un véhicule suit les rails
 * ou la route entre deux arrêts, au lieu d'une ligne droite qui couperait à travers les immeubles.
 * Le calcul est dans shared/shapes-core.ts (partagé avec le moteur local d'Android).
 *
 * Morceaux de tracé retirés (data/shape-cuts.json, écrit par scripts/check-shapes-plan.py) : là où OpenStreetMap fait passer
 * une ligne alors que le plan officiel de la CTS ne la montre pas. Le tracé y est coupé ; le bus suit alors la route (roads.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createShapes } from "../shared/shapes-core.js";
import type { ShapeCuts, ShapesData } from "../shared/shapes-core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = [path.join(here, "..", "..", "data", "shapes.json"), path.join(here, "..", "data", "shapes.json")].find(f => fs.existsSync(f));
const CUTS_FILE = FILE ? path.join(path.dirname(FILE), "shape-cuts.json") : null;

let cuts: ShapeCuts = {};
try {
  if (CUTS_FILE && fs.existsSync(CUTS_FILE)) cuts = JSON.parse(fs.readFileSync(CUTS_FILE, "utf8")) as ShapeCuts;
} catch (e) { console.warn("Morceaux de tracé à retirer illisibles :", e instanceof Error ? e.message : e); }

let shapes = createShapes({});
try {
  if (FILE) shapes = createShapes(JSON.parse(fs.readFileSync(FILE, "utf8")) as ShapesData, cuts);
} catch (e) { console.warn("Tracés des lignes illisibles :", e instanceof Error ? e.message : e); }
if (shapes.removedKm > 0) console.log(`Tracés des lignes : ${shapes.removedKm.toFixed(1)} km retirés (absents du plan de la CTS, ou trous)`);
console.log(`Tracés des lignes : ${shapes.lines ? shapes.lines + " lignes" : "aucun (véhicules en ligne droite entre deux arrêts)"}`);

export const pathBetween = shapes.pathBetween;
