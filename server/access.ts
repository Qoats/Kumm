/**
 * Accès privé à l'application web (bêta sur invitation) : avec WEB_LOGIN défini, le navigateur doit se connecter
 * (identifiant + mot de passe) avant d'afficher l'application ou d'utiliser l'API.
 * - comptes : WEB_LOGIN="nom:motdepasse,autre:motdepasse" dans le .env du serveur (jamais dans le dépôt) ;
 * - l'APK Android n'a rien à saisir : ses requêtes viennent de son navigateur interne (origine https://localhost) ;
 * - session : cookie signé (HMAC), valable 30 jours ; changer le mot de passe d'un compte déconnecte ses sessions.
 * Sans WEB_LOGIN, tout reste ouvert (développement, ou publication publique).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { APP_KEY, ORIGINS } from "./config.js";
import { clientIp } from "./limit.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const STATE_DIR = process.env.STATE_DIR ?? path.join(ROOT, "state");
const COOKIE = "kumm_session";
const DAYS = 30;
const TRIES_PER_10_MIN = 8;

/** nom → mot de passe */
const accounts = new Map<string, string>();
for (const part of (process.env.WEB_LOGIN ?? "").split(",")) {
  const i = part.indexOf(":");
  if (i > 0 && part.slice(i + 1)) accounts.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
}
export const WEB_PRIVATE = accounts.size > 0;

/** Clé de signature des sessions : gardée dans state/ pour que les sessions survivent aux mises à jour */
function sessionKey(): Buffer {
  const file = path.join(STATE_DIR, "session-key");
  try { const k = fs.readFileSync(file); if (k.length >= 32) return k; } catch { /* première fois */ }
  const k = crypto.randomBytes(32);
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(file, k, { mode: 0o600 }); }
  catch (e) { console.warn("Accès privé : clé de session non enregistrée (déconnexion à chaque redémarrage) :", e instanceof Error ? e.message : e); }
  return k;
}
const KEY = WEB_PRIVATE ? sessionKey() : Buffer.alloc(0);

const sign = (user: string, exp: number): string =>
  crypto.createHmac("sha256", KEY).update(`${user}|${exp}|${accounts.get(user) ?? ""}`).digest("base64url");

function sameText(a: string, b: string): boolean {
  const x = crypto.createHash("sha256").update(a).digest(), y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

function cookieUser(req: IncomingMessage): string | null {
  const raw = (req.headers.cookie ?? "").split(";").map(c => c.trim()).find(c => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [u64, expS, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!u64 || !expS || !sig) return null;
  const user = Buffer.from(u64, "base64url").toString("utf8"), exp = Number(expS);
  if (!accounts.has(user) || !(exp > Date.now()) || !sameText(sig, sign(user, exp))) return null;
  return user;
}

/** Comparaison à temps constant : le temps de réponse ne révèle pas la clé, caractère par caractère */
export function keyMatches(sent: unknown): boolean {
  const a = Buffer.from(String(sent ?? "")), b = Buffer.from(APP_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

if (WEB_PRIVATE && !APP_KEY) console.warn("Accès privé : APP_KEY n'est pas défini, l'APK est reconnu à son seul en-tête Origin (falsifiable). Définissez APP_KEY (serveur) et VITE_APP_KEY (APK).");

/** Requête de l'APK Android.
 *  - API (/api, /geo, /poi) : avec APP_KEY défini, la clé X-App-Key est exigée (Origin et Referer sont falsifiables par n'importe quel client, donc jamais suffisants) ;
 *  - tuiles : un <img> ne peut pas envoyer d'en-tête, on se fie à Origin/Referer (données publiques, limitées par adresse) ;
 *  - tout le reste (pages, fichiers) : jamais sans connexion, l'APK les charge localement. */
function fromApp(req: IncomingMessage, p: string): boolean {
  const service = p.startsWith("/api/") || p.startsWith("/geo/") || p.startsWith("/poi/");
  if (service && APP_KEY) return keyMatches(req.headers["x-app-key"]);
  if (!service && !p.startsWith("/tiles/")) return false;
  const o = req.headers.origin;
  if (typeof o === "string" && ORIGINS.includes(o)) return true;
  const ref = req.headers.referer;
  if (typeof ref === "string") { try { return ORIGINS.includes(new URL(ref).origin); } catch { return false; } }
  return false;
}

/** Ce chemin est-il accessible sans connexion ? (page de connexion, supervision, mises à jour de l'APK) */
const OPEN = (p: string): boolean => p === "/connexion" || p === "/health" || p.startsWith("/app/") || p === "/favicon.svg" || p === "/robots.txt";

/** true : la requête peut continuer ; false : la réponse (page de connexion ou 401) a déjà été envoyée */
export function allowed(req: IncomingMessage, res: ServerResponse, p: string): boolean {
  if (!WEB_PRIVATE || OPEN(p) || fromApp(req, p) || cookieUser(req)) return true;
  const isPage = req.method === "GET" && (p === "/" || p.endsWith(".html") || !p.includes("."));
  if (isPage && !p.startsWith("/api/") && !p.startsWith("/geo/") && !p.startsWith("/poi/") && !p.startsWith("/tiles/")) {
    res.writeHead(302, { Location: "/connexion", "Cache-Control": "no-store" });
  } else {
    res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  }
  res.end(isPage ? "" : "Connexion nécessaire");
  return false;
}

/* ---------- page de connexion ---------- */
const tries = new Map<string, { n: number; reset: number }>();
setInterval(() => { const now = Date.now(); for (const [k, v] of tries) if (v.reset < now) tries.delete(k); }, 60_000).unref();

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function page(res: ServerResponse, status: number, msg = "", user = ""): void {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kumm – connexion</title><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><link rel="icon" href="/favicon.svg">
<style>
:root{--bg:#F2F6F3;--card:#fff;--ink:#13201A;--mute:#56665D;--line:#DCE6DF;--accent:#1B7F55;--on:#fff;--err:#C62828}
@media (prefers-color-scheme:dark){:root{--bg:#0B1410;--card:#13211A;--ink:#E7F1EC;--mute:#9AB0A4;--line:#22382C;--accent:#4FD39A;--on:#06251A;--err:#FF8A80}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:20px}
form{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:28px;box-shadow:0 18px 40px -18px rgba(0,0,0,.35)}
img{width:56px;height:56px;border-radius:16px;display:block;margin-bottom:16px}h1{font-size:24px;margin:0 0 6px}p{color:var(--mute);margin:0 0 20px;font-size:15.5px}
label{display:block;font-weight:700;font-size:14.5px;margin:14px 0 6px}input{width:100%;font:inherit;padding:13px 14px;border-radius:14px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
input:focus{outline:2px solid var(--accent);outline-offset:1px}button{width:100%;margin-top:22px;font:inherit;font-weight:800;padding:14px;border:0;border-radius:28px;background:var(--accent);color:var(--on);cursor:pointer}
.err{color:var(--err);font-weight:600;margin:12px 0 0;font-size:15px}
</style></head><body><form method="post" action="/connexion">
<img src="/favicon.svg" alt=""><h1>Kumm</h1><p>Version de test privée : connectez-vous avec l'accès qui vous a été donné.</p>
<label for="u">Identifiant</label><input id="u" name="user" autocomplete="username" autocapitalize="none" required value="${esc(user)}">
<label for="pw">Mot de passe</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ""}<button type="submit">Se connecter</button></form></body></html>`;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}

/** GET : formulaire ; POST : vérification puis cookie de session */
export async function loginRoute(req: IncomingMessage, res: ServerResponse, readBody: (r: IncomingMessage) => Promise<string>): Promise<void> {
  if (!WEB_PRIVATE) { res.writeHead(302, { Location: "/" }); return void res.end(); }
  if (req.method !== "POST") return page(res, 200);
  const ip = clientIp(req), now = Date.now();
  let t = tries.get(ip);
  if (!t || t.reset < now) { t = { n: 0, reset: now + 10 * 60_000 }; tries.set(ip, t); }
  if (++t.n > TRIES_PER_10_MIN) return page(res, 429, "Trop d'essais : réessayez dans quelques minutes.");
  let user = "", pass = "";
  try { const f = new URLSearchParams(await readBody(req)); user = (f.get("user") ?? "").trim().toLowerCase(); pass = f.get("password") ?? ""; }
  catch { return page(res, 400, "Requête invalide"); }
  const expected = accounts.get(user);
  // comparaison même pour un nom inconnu : la durée de la réponse ne révèle pas quels comptes existent
  const ok = sameText(pass, expected ?? crypto.randomBytes(16).toString("hex")) && expected !== undefined;
  if (!ok) return page(res, 401, "Identifiant ou mot de passe incorrect.", user);
  tries.delete(ip);
  const exp = now + DAYS * 86_400_000;
  const value = `${Buffer.from(user).toString("base64url")}.${exp}.${sign(user, exp)}`;
  res.writeHead(303, {
    Location: "/", "Cache-Control": "no-store",
    "Set-Cookie": `${COOKIE}=${value}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`
  });
  res.end();
}

export function logoutRoute(res: ServerResponse): void {
  res.writeHead(303, { Location: "/connexion", "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
  res.end();
}
