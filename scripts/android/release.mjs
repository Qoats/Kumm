import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

function signers(report) {
  return [...new Set([...report.matchAll(/^Signer #\d+ certificate SHA-256 digest:\s*([\da-f]{64})\s*$/gim)]
    .map(m => m[1].toLowerCase()))].sort();
}

export function makeRelease({ apk, code, previous, badging, oldSignature, newSignature, now = new Date() }) {
  const nextCode = Number(code);
  if (!Number.isSafeInteger(previous.code) || previous.code < 1 ||
      !Number.isSafeInteger(nextCode) || nextCode <= previous.code || nextCode > 2_100_000_000) {
    throw new Error("Le code de version Android doit augmenter");
  }
  const pkg = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m.exec(badging);
  if (!pkg || pkg[1] !== "fr.kumm.app" || Number(pkg[2]) !== nextCode) {
    throw new Error("Le paquet ou le code Android ne correspond pas à la publication");
  }
  const oldKeys = signers(oldSignature), newKeys = signers(newSignature);
  if (!oldKeys.length || oldKeys.join(",") !== newKeys.join(",")) {
    throw new Error("Le certificat diffère de celui de l’APK actuellement distribué");
  }
  if (!apk.length) throw new Error("APK vide");
  return {
    version: pkg[3], code: nextCode, size: apk.length,
    sha256: crypto.createHash("sha256").update(apk).digest("hex"), date: now.toISOString()
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [apk, code, previous, badging, oldSignature, newSignature, output] = process.argv.slice(2);
  const read = name => fs.readFileSync(name, "utf8");
  const release = makeRelease({
    apk: fs.readFileSync(apk), code, previous: JSON.parse(read(previous)),
    badging: read(badging), oldSignature: read(oldSignature), newSignature: read(newSignature)
  });
  fs.writeFileSync(output, JSON.stringify(release) + "\n");
}
