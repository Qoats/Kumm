import assert from "node:assert/strict";
import fs from "node:fs";

const read = file => JSON.parse(fs.readFileSync(new URL("../data/" + file, import.meta.url), "utf8"));
const { lines } = read("shapes.json");
const { ways } = read("rail.json");
const cuts = read("shape-cuts.json");

function point(p) {
  return Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) &&
    Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
}
const segments = paths => Array.isArray(paths) && paths.length > 0 &&
  paths.every(segment => Array.isArray(segment) && segment.length >= 2 && segment.every(point));

assert.ok(Object.keys(lines).length && Object.values(lines).every(segments), "Tracés des lignes invalides");
assert.ok(segments(ways), "Voies ferrées invalides");
assert.ok(Number.isFinite(cuts.rayon_m) && cuts.rayon_m > 0 &&
  Object.values(cuts.lines).every(p => Array.isArray(p) && p.every(point)), "Coupures des tracés invalides");
console.log(`${Object.keys(lines).length} lignes et ${ways.length} segments ferroviaires vérifiés.`);
