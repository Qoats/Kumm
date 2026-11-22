import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync, strToU8 } from "fflate";

const dataset = "https://data.strasbourg.eu/api/explore/v2.1/catalog/datasets/referentiel_adresse_eurometrostras/exports/json";
const url = new URL(dataset);
url.searchParams.set("select", "nom_rue,nom_commune,code_postal,numero,x_4326,y_4326");
const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
if (!response.ok) throw Error(`Référentiel d’adresses : HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || !rows.length) throw Error("Référentiel d’adresses vide ou illisible");

const streets = new Map();
for (const row of rows) {
  const { nom_rue: street, nom_commune: city, code_postal, numero, x_4326: lon, y_4326: lat } = row;
  const postal = String(code_postal ?? "");
  if (!street || !city || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
  const key = JSON.stringify([street, city, postal]);
  if (!streets.has(key)) streets.set(key, [street, city, postal, new Map()]);
  const points = streets.get(key)[3];
  // Le référentiel utilise 99999 pour le milieu d'une voie sans numéro postal.
  const number = numero === "99999" || !numero ? "" : String(numero).trim();
  if (!points.has(number)) points.set(number, [number, Number(lon.toFixed(6)), Number(lat.toFixed(6))]);
}
const index = [...streets.values()].map(([street, city, postal, points]) => [street, city, postal,
  [...points.values()].sort(([a], [b]) => a.localeCompare(b, "fr", { numeric: true }))]);
const count = index.reduce((sum, [, , , points]) => sum + points.length, 0);
if (!count) throw Error("Aucune adresse exploitable dans le référentiel");
const out = path.join(process.argv[2], "offline");
await fs.mkdir(out, { recursive: true });
const bytes = gzipSync(strToU8(JSON.stringify(index)), { level: 9 });
// Android retire l’extension .gz et décompresse ces fichiers lors de l’empaquetage.
await fs.writeFile(path.join(out, "addresses.bin"), bytes);
console.log(`${count} adresses et repères de rue, ${new Set(index.map(([, city]) => city)).size} communes, ${Math.round(bytes.length / 1000)} ko`);
