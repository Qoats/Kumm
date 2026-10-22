/** Réglages du serveur, lus dans les variables d'environnement (voir .env.example). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const num = (v: string | undefined, d: number): number => { const n = Number(v); return v !== undefined && v !== "" && Number.isFinite(n) ? n : d; };

export const TOKEN = process.env.CTS_TOKEN ?? "";
export const AUTH = "Basic " + Buffer.from(TOKEN + ":").toString("base64");
export const BASE = process.env.CTS_BASE ?? "https://api.cts-strasbourg.eu/v1/siri/2.0";
export const ROOT = process.env.CTS_ROOT ?? "https://api.cts-strasbourg.eu/v1";
/** Identifiant du demandeur exigé par le protocole SIRI (n'importe quel nom court) */
export const REQUESTOR = process.env.CTS_REQUESTOR ?? "kumm";
export const PORT = num(process.env.PORT, 3000);
/** Clé d'application : si définie, /api, /geo et /poi exigent l'en-tête X-App-Key (l'application l'envoie ; vide = aucune vérification). Une clé dans l'APK reste extractible : cela bloque les appels extérieurs simples, pas un attaquant déterminé. */
export const APP_KEY = process.env.APP_KEY ?? "";

/* protection et capacité */
export const LIMIT = num(process.env.RATE_LIMIT_PER_MIN, 240);          // API, adresses, trajets, parkings… par adresse (0 = aucune limite)
export const TILE_LIMIT = num(process.env.TILE_LIMIT_PER_MIN, 1500);    // tuiles de carte
export const TRUST_PROXY = process.env.TRUST_PROXY === "1";             // derrière un hébergeur : lit la vraie adresse dans X-Forwarded-For
export const ENABLE_DIAG = process.env.ENABLE_DIAG === "1";             // page /diag (jamais sur un serveur public)
export const CACHE_MAX = num(process.env.CACHE_MAX_ENTRIES, 4000);      // réponses gardées en mémoire
export const STALE_REALTIME_S = num(process.env.STALE_REALTIME_S, 120); // en panne, on ressert les passages « temps réel » au plus 2 min
export const UPSTREAM_QUEUE_MAX = num(process.env.UPSTREAM_QUEUE_MAX, 300);
/** Requêtes simultanées vers l'extérieur, par file (CTS d'un côté, autres services de l'autre) */
export const UPSTREAM_PARALLEL = Math.max(1, num(process.env.UPSTREAM_PARALLEL, 4));
/** Plafond global d'appels vers la CTS par minute, tous visiteurs confondus (0 = aucun plafond). À régler avec les quotas donnés par la CTS. */
export const CTS_BUDGET_PER_MIN = num(process.env.CTS_BUDGET_PER_MIN, 1500);
/** Arrêts dont le code n'est pas dans la liste officielle : nombre de demandes acceptées par minute, tous visiteurs confondus */
export const UNKNOWN_REF_PER_MIN = num(process.env.UNKNOWN_REF_PER_MIN, 60);
export const VALIDATE_STOP_REFS = process.env.VALIDATE_STOP_REFS !== "0";

/** Origines autorisées à appeler le serveur depuis un autre site (l'APK Android appelle depuis https://localhost) */
export const ORIGINS = (process.env.CORS_ORIGINS ?? "https://localhost,http://localhost,capacitor://localhost,http://localhost:5173")
  .split(",").map(o => o.trim()).filter(Boolean);

/** Les applications plus anciennes que cette version affichent « mise à jour nécessaire » (voir /health) */
export const MIN_APP_VERSION = process.env.MIN_APP_VERSION ?? "0.0.0";

const here = path.dirname(fileURLToPath(import.meta.url));
const inDist = path.basename(path.dirname(here)) === "dist";
export const WEB = inDist ? path.join(here, "..", "web") : path.join(here, "..", "dist", "web");

function readVersion(): string {
  for (const p of [path.join(here, "..", "..", "package.json"), path.join(here, "..", "package.json")]) {
    try { return (JSON.parse(fs.readFileSync(p, "utf8")) as { version?: string }).version ?? "?"; } catch { /* essai suivant */ }
  }
  return "?";
}
export const VERSION = process.env.APP_VERSION ?? readVersion();
