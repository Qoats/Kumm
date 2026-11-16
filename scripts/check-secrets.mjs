// Analyse des fichiers qui peuvent être commités, sans afficher leurs valeurs.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0").filter(Boolean);
const sensitive = /(?:^|\/)(?:\.env(?:\.[^/]*)?|.*\.(?:keystore|jks|pem|p12|pfx|key|zip|apk|aab)|local\.properties|google-services\.json|session-key)$/i;
const examples = new Set([".env.example", ".env.production.example", "web/.env.android"]);
const textFile = /(?:^|\/)(?:Dockerfile|Caddyfile|\.env[^/]*)$|\.(?:ts|js|mjs|json|md|txt|csv|yml|yaml|html|xml|sh|properties|gradle|py)$/i;
const direct = /^[ \t]*(?:export[ \t]+)?([A-Z0-9_]*(?:CTS_TOKEN|SNCF_TOKEN|API_KEY|APP_KEY|PASSWORD|CLIENT_SECRET))\s*=\s*["']?([^\s"'#]+)/i;
const privateMaterial = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})\b/i;
const uuid = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i;
const uri = /https?:\/\/[^\s/<>\x27\x22:@]+:[^\s/<>\x27\x22@]+@/i;
const placeholder = /^(?:votre|your|fixture|xxx+|changeme|<|\$\{|\.{3})/i;
const failures = new Set();

for (const file of files) {
  if (sensitive.test(file) && !examples.has(file)) failures.add(file + " : fichier sensible ou archive");
  if (!textFile.test(file) || file === "package-lock.json" || !fs.existsSync(file)) continue;
  fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    const value = direct.exec(line)?.[2];
    if ((value && !placeholder.test(value)) || privateMaterial.test(line) || uuid.test(line) || uri.test(line)) {
      failures.add(`${file}:${i + 1} : contenu sensible possible`);
    }
  });
}
if (failures.size) {
  console.error([...failures].join("\n"));
  process.exitCode = 1;
} else {
  console.log("Contrôle des fichiers Git réussi.");
}
