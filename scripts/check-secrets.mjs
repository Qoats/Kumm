// Contrôle avant de publier : cherche jetons, clés privées et fichiers sensibles dans le projet.
// Utilisation : npm run check:secrets   (code de sortie 1 si quelque chose est trouvé)
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".gradle", "build"]);
const SKIP_PREFIX = ["android/app/src/main/assets/public"];
const BINARY = /\.(png|jpg|jpeg|gif|ico|jar|woff2?|ttf|zip|apk|aab)$/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TOKEN_LINE = /(CTS_TOKEN|TOKEN|API_KEY|SECRET|PASSWORD)\s*[=:]\s*["']?([^\s"'#]+)/i;
// valeurs d'exemple et lectures de variables (process.env.X, import.meta…) : pas des secrets
const PLACEHOLDER = /^(colle-ton-token-ici|votre|xxx+|\.\.\.|changeme|<.*>|\$\{.*\}|process\.env|import\.meta|os\.environ|Boolean\(|env\.)/i;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const SENSITIVE_FILE = /(^|\/)(\.env|\.env\.local|.*\.keystore|.*\.jks|.*\.pem|local\.properties|google-services\.json)$/;

const mask = s => (s.length <= 6 ? "***" : s.slice(0, 4) + "…(masqué)");
const problems = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    const rel = path.relative(ROOT, full).split(path.sep).join("/");
    if (name.isDirectory()) { if (!SKIP_DIRS.has(name.name) && !SKIP_PREFIX.some(p => rel.startsWith(p))) walk(full); continue; }
    if (SENSITIVE_FILE.test(rel)) problems.push(`${rel} : fichier sensible, à ne pas publier (exclu par .gitignore, mais ne l'envoyez pas à la main)`);
    if (BINARY.test(rel) || rel === "package-lock.json") continue;
    let text; try { text = fs.readFileSync(full, "utf8"); } catch { continue; }
    text.split("\n").forEach((line, i) => {
      const where = `${rel}:${i + 1}`;
      if (PRIVATE_KEY.test(line)) problems.push(`${where} : clé privée`);
      const t = TOKEN_LINE.exec(line);
      if (t && t[2].length >= 8 && !PLACEHOLDER.test(t[2])) problems.push(`${where} : valeur secrète possible (${t[1]} = ${mask(t[2])})`);
      for (const m of line.matchAll(UUID)) problems.push(`${where} : identifiant de forme jeton (${mask(m[0])})`);
    });
  }
}

walk(ROOT);
if (problems.length) {
  console.error("✗ À corriger avant de publier :\n" + [...new Set(problems)].map(p => "  - " + p).join("\n"));
  process.exit(1);
}
console.log("✓ Aucun jeton, clé privée ni fichier sensible trouvé.");
