import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import test from "node:test";
import { packTiles, tileKey, tileList, tileX, tileY } from "../scripts/build-map-pack.mjs";
import { findTile } from "../web/src/offline-map.ts";

const read = buf => {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = view.getUint32(4);
  return { bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), view, count, dataStart: 16 + count * 12 };
};

test("paquet de tuiles : chaque tuile se retrouve par z/x/y, une absente donne null", () => {
  const tiles = [[14, 8500, 5600, "a"], [3, 4, 2, "bb"], [14, 8501, 5600, "ccc"], [0, 0, 0, "dddd"]].map(([z, x, y, s]) => ({ z, x, y, data: zlib.gzipSync(Buffer.from(s)) }));
  const p = read(packTiles(tiles));
  assert.equal(p.count, 4);
  for (const [z, x, y, s] of [[14, 8500, 5600, "a"], [3, 4, 2, "bb"], [14, 8501, 5600, "ccc"], [0, 0, 0, "dddd"]]) {
    assert.equal(zlib.gunzipSync(findTile(p, z, x, y)).toString(), s);
  }
  assert.equal(findTile(p, 14, 1, 1), null);
});

test("zone de l'Eurométropole : 517 tuiles, du niveau 0 au niveau 14, centre de Strasbourg compris", () => {
  const list = tileList();
  assert.equal(list.length, 517);
  assert.equal(Math.max(...list.map(t => t[0])), 14);
  const cx = tileX(7.7507, 14), cy = tileY(48.5846, 14);
  assert.ok(list.some(([z, x, y]) => z === 14 && x === cx && y === cy));
  assert.ok(tileKey(14, cx, cy) < 2 ** 32);
});

test("le paquet livré avec l'appli contient le centre de Strasbourg à tous les niveaux", { skip: !fs.existsSync("web/public/offline/map/tiles.kmp") }, () => {
  const p = read(fs.readFileSync("web/public/offline/map/tiles.kmp"));
  for (const z of [0, 5, 10, 14]) {
    const t = findTile(p, z, tileX(7.7507, z), tileY(48.5846, z));
    assert.ok(t && zlib.gunzipSync(t).length > 0, `tuile ${z}`);
  }
  assert.equal(findTile(p, 14, tileX(2.35, 14), tileY(48.85, 14)), null, "Paris n'est pas dans le paquet");
});
