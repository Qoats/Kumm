import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

function signers(report) {
  // apksigner écrit « Signer #1 » pour un APK v1/v2 et « Signer (minSdkVersion=24, maxSdkVersion=…) » pour un APK v3 récent
  return [...new Set([...report.matchAll(/^Signer (?:#\d+|\([^)]*\)) certificate SHA-256 digest:\s*([\da-f]{64})\s*$/gim)]
    .map(m => m[1].toLowerCase()))].sort();
}

/** allowCertificateChange : migration volontaire et unique vers une nouvelle clé (les utilisateurs devront réinstaller) ; jamais par défaut */
export function makeRelease({ apk, code, previous, badging, oldSignature, newSignature, allowCertificateChange = false, now = new Date() }) {
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
  // Les empreintes de certificat sont publiques : elles sont affichées pour comprendre un refus.
  console.log(`Certificat de l’APK distribué : ${oldKeys.join(",") || "aucun lu"} ; candidat : ${newKeys.join(",") || "aucun lu"}`);
  if (!newKeys.length) throw new Error("L’APK candidat n’est pas signé");
  if (!allowCertificateChange && (!oldKeys.length || oldKeys.join(",") !== newKeys.join(","))) {
    throw new Error("Le certificat diffère de celui de l’APK actuellement distribué");
  }
  if (allowCertificateChange && oldKeys.join(",") !== newKeys.join(",")) {
    console.warn(`MIGRATION DE SIGNATURE : ${oldKeys.join(",") || "aucun"} -> ${newKeys.join(",")}`);
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
    badging: read(badging), oldSignature: read(oldSignature), newSignature: read(newSignature),
    allowCertificateChange: process.env.KUMM_ALLOW_CERT_CHANGE === "1"
  });
  fs.writeFileSync(output, JSON.stringify(release) + "\n");
}
