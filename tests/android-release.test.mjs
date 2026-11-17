import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { makeRelease } from "../scripts/android/release.mjs";

const signature = Hex => "Signer #1 certificate SHA-256 digest: " + Hex.repeat(64);
const apk = Buffer.from("apk de test");
const input = {
  apk, code: "131", previous: { code: 130 },
  badging: "package: name='fr.kumm.app' versionCode='131' versionName='0.52.2'",
  oldSignature: signature("a"), newSignature: signature("a")
};

test("publication Android compatible, croissante et signée", () => {
  assert.equal(makeRelease(input).sha256, crypto.createHash("sha256").update(apk).digest("hex"));
  assert.throws(() => makeRelease({ ...input, previous: { code: 131 } }), /doit augmenter/);
  assert.throws(() => makeRelease({ ...input, badging: input.badging.replace("131", "130") }), /ne correspond pas/);
  assert.throws(() => makeRelease({ ...input, newSignature: signature("b") }), /certificat diffère/);
  assert.throws(() => makeRelease({ ...input, oldSignature: "" }), /certificat diffère/);
  // apksigner récent : « Signer (minSdkVersion=…) » au lieu de « Signer #1 »
  const ranged = Hex => `Signer (minSdkVersion=24, maxSdkVersion=2147483647) certificate SHA-256 digest: ${Hex.repeat(64)}`;
  assert.equal(makeRelease({ ...input, newSignature: ranged("a") }).code, 131);
  assert.throws(() => makeRelease({ ...input, newSignature: ranged("b") }), /certificat diffère/);
  // migration volontaire : seulement avec l’autorisation explicite, et jamais pour un APK non signé
  assert.equal(makeRelease({ ...input, newSignature: signature("b"), allowCertificateChange: true }).code, 131);
  assert.throws(() => makeRelease({ ...input, newSignature: "", allowCertificateChange: true }), /pas signé/);
});

test("le canal de mise à jour refuse aussi un APK corrompu de même taille", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kumm-apk-tests-"));
  process.env.APK_DIR = dir;
  const { serveUpdate } = await import("../server/updates.ts");
  const server = http.createServer((req, res) => serveUpdate(req, res, req.url));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
    delete process.env.APK_DIR;
  });
  const base = "http://127.0.0.1:" + server.address().port + "/app/";
  const manifest = JSON.stringify(makeRelease(input));
  await fs.writeFile(path.join(dir, "latest.json"), manifest);
  assert.equal((await fetch(base + "latest.json")).status, 404);
  const filename = path.join(dir, "kumm.apk");
  await fs.writeFile(filename, apk);
  assert.equal((await (await fetch(base + "latest.json")).json()).code, 131);
  const head = await fetch(base + "kumm.apk", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(apk.length));
  assert.deepEqual(Buffer.from(await (await fetch(base + "kumm.apk")).arrayBuffer()), apk);
  await fs.writeFile(path.join(dir, "replace.apk"), Buffer.alloc(apk.length));
  await fs.rename(path.join(dir, "replace.apk"), filename);
  assert.equal((await fetch(base + "latest.json")).status, 404);
  assert.equal((await fetch(base + "kumm.apk")).status, 404);
});
