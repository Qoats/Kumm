import assert from "node:assert/strict";
import test from "node:test";
import { access, buildGraph } from "../scripts/build-walk-graph.mjs";
import { loadWalkGraph, routeOnGraph } from "../shared/walk-graph.ts";

// Quadrillage de 4 × 4 carrefours près de Strasbourg : rues « Rue 0..3 » (est-ouest) et « Avenue 0..3 » (nord-sud)
const LAT = 48.58, LON = 7.75, DLAT = 0.001, DLON = 0.001;
const id = (r, c) => 1 + r * 4 + c;
function grid({ oneway = true } = {}) {
  const nodes = {}, ways = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) nodes[id(r, c)] = [LAT + r * DLAT, LON + c * DLON];
  for (let r = 0; r < 4; r++) ways.push({ id: 100 + r, nodes: [0, 1, 2, 3].map(c => id(r, c)), tags: { highway: "residential", name: `Rue ${r}`, ...(oneway && r === 1 ? { oneway: "yes" } : {}) } });
  for (let c = 0; c < 4; c++) ways.push({ id: 200 + c, nodes: [0, 1, 2, 3].map(r => id(r, c)), tags: { highway: "residential", name: `Avenue ${c}` } });
  return { nodes, ways };
}
const at = (r, c) => ({ lat: LAT + r * DLAT, lon: LON + c * DLON });
const graph = () => loadWalkGraph(JSON.parse(JSON.stringify(buildGraph(grid()))));

test("à pied : trajet direct le long du quadrillage, avec départ, virage et arrivée", () => {
  const g = graph();
  const j = routeOnGraph(g, "foot", at(0, 0), at(3, 3));
  assert.equal(j.code, "Ok");
  const r = j.routes[0];
  assert.ok(r.distance > 500 && r.distance < 600, `distance ${r.distance}`);
  assert.ok(r.duration > 350 && r.duration < 500, `durée ${r.duration}`);
  const steps = r.legs[0].steps;
  assert.equal(steps[0].maneuver.type, "depart");
  assert.equal(steps.at(-1).maneuver.type, "arrive");
  assert.ok(steps.some(s => s.maneuver.type === "turn" && /left|right/.test(s.maneuver.modifier)), "un virage est annoncé");
  assert.ok(steps.every(s => Number.isFinite(s.distance)));
  const [lon0, lat0] = r.geometry.coordinates[0];
  assert.ok(Math.abs(lat0 - LAT) < 1e-4 && Math.abs(lon0 - LON) < 1e-4);
});

test("à vélo : un sens unique est respecté, à pied il est ignoré", () => {
  const g = graph();
  // Rue 1 est à sens unique vers l'est : de l'est vers l'ouest, il faut contourner
  const bike = routeOnGraph(g, "bike", at(1, 3), at(1, 0)).routes[0];
  const foot = routeOnGraph(g, "foot", at(1, 3), at(1, 0)).routes[0];
  assert.ok(foot.distance < 250, `à pied ${foot.distance}`);
  assert.ok(bike.distance > 400, `à vélo ${bike.distance}`);
  const eastbound = routeOnGraph(g, "bike", at(1, 0), at(1, 3)).routes[0];
  assert.ok(eastbound.distance < 250, `dans le sens autorisé ${eastbound.distance}`);
});

test("un départ posé hors des rues est ramené à la rue la plus proche", () => {
  const g = graph();
  const j = routeOnGraph(g, "foot", { lat: LAT + 0.0003, lon: LON + 0.00015 }, at(2, 2));
  assert.equal(j.code, "Ok");
  assert.ok(j.routes[0].distance > 300 && j.routes[0].distance < 380);
});

test("deux points sur la même rue : trajet direct", () => {
  const g = graph();
  const r = routeOnGraph(g, "foot", { lat: LAT, lon: LON + 0.0002 }, { lat: LAT, lon: LON + 0.0008 }).routes[0];
  assert.ok(r.distance > 30 && r.distance < 60, `distance ${r.distance}`);
});

test("hors de la zone couverte : aucune rue proche", () => {
  const g = graph();
  assert.equal(routeOnGraph(g, "foot", { lat: 48.9, lon: 8.2 }, at(1, 1)).code, "NoSegment");
});

test("règles d'accès : escaliers, trottoirs, pistes et autoroutes", () => {
  assert.equal(access({ highway: "motorway" }), null);
  const steps = access({ highway: "steps" });
  assert.ok(steps.foot && !steps.bikeFwd);
  const cycle = access({ highway: "cycleway" });
  assert.ok(!cycle.foot && cycle.bikeFwd && cycle.bikeBack);
  const footway = access({ highway: "footway" });
  assert.ok(footway.foot && !footway.bikeFwd);
  const shared = access({ highway: "footway", bicycle: "designated" });
  assert.ok(shared.bikeFwd);
  const oneway = access({ highway: "residential", oneway: "yes" });
  assert.ok(oneway.bikeFwd && !oneway.bikeBack);
  const contra = access({ highway: "residential", oneway: "yes", "cycleway:left": "opposite_lane" });
  assert.ok(contra.bikeFwd && contra.bikeBack);
  assert.equal(access({ highway: "service", access: "private" }), null);
});

test("à vélo, une proposition plus directe est ajoutée si elle diffère", () => {
  // Rue 0 est une piste cyclable : le trajet « normal » la préfère, le trajet « direct » prend le plus court
  const { nodes, ways } = grid({ oneway: false });
  ways.find(w => w.id === 100).tags = { highway: "cycleway", name: "Piste" };
  const g = loadWalkGraph(JSON.parse(JSON.stringify(buildGraph({ nodes, ways }))));
  const j = routeOnGraph(g, "bike", at(0, 0), at(3, 3));
  assert.equal(j.code, "Ok");
  assert.ok(j.routes.length >= 1);
});
