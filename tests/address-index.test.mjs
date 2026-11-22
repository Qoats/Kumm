import assert from "node:assert/strict";
import test from "node:test";
import { createAddressIndex } from "../web/src/address-index.ts";

const search = createAddressIndex([
  ["Rue de la Verdure", "Fegersheim", "67640", [["1a", 7.69, 48.50], ["12", 7.68, 48.51]]],
  ["Rue de la Verdure", "Strasbourg", "67000", [["1a", 7.75, 48.58]]],
  ["Rue du Vingt-Deux Novembre", "Strasbourg", "67000", [["4", 7.74, 48.58]]],
  ["Avenue de la Forêt-Noire", "Strasbourg", "67000", [["32", 7.77, 48.58]]]
]);

test("address search matches house suffixes, municipality and postal code", () => {
  assert.deepEqual(search("1 a r. de la verd 67640 Fégersheim"), [
    { label: "1a Rue de la Verdure, 67640 Fegersheim", lon: 7.69, lat: 48.50 }
  ]);
  assert.deepEqual(search("13 rue de la verdure Fegersheim"), []);
  assert.deepEqual(search("32 av foret noire Lyon"), []);
});

test("address search expands abbreviations and keeps numbers in street names", () => {
  assert.equal(search("32 av foret noire")[0].label, "32 Avenue de la Forêt-Noire, 67000 Strasbourg");
  assert.equal(search("rue du 22 novembre")[0].label, "Rue du Vingt-Deux Novembre, 67000 Strasbourg");
});
