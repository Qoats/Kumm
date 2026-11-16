/**
 * Alertes trafic par notifications push (Firebase Cloud Messaging) : chaque minute, le serveur compare les infos trafic
 * de la CTS à celles déjà vues ; pour chaque nouvelle perturbation, il notifie les téléphones abonnés aux lignes concernées.
 * - abonnements : POST /api/alerts { token, enabled, works, lines } envoyé par l'application ;
 * - clé Firebase (compte de service) : fichier JSON dans secrets/firebase.json (jamais dans le dépôt ni dans l'image) ;
 * - état (abonnements, messages déjà annoncés) : dossier state/, gardé entre deux redémarrages (volume Docker).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TrafficMessage } from "./messages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const STATE_DIR = process.env.STATE_DIR ?? path.join(ROOT, "state");
const KEY_FILE = process.env.FCM_KEY_FILE ?? path.join(ROOT, "secrets", "firebase.json");
const POLL_MS = Number(process.env.ALERT_POLL_MS) || 60_000;
const MAX_SUBS = 50_000;
const MAX_PER_ROUND = 5;          // au plus 5 nouvelles perturbations annoncées par minute (évite une avalanche)

interface Sub { lines: string[]; works: boolean; at: number }
interface ServiceAccount { project_id: string; client_email: string; private_key: string }

const subs = new Map<string, Sub>();
let seen = new Set<string>();
let seenReady = false;
let account: ServiceAccount | null = null;
const counts = { envoyees: 0, echecs: 0, jetons_retires: 0, derniere_erreur: "" };

/* ---------- état sur disque ---------- */
const SUBS_FILE = path.join(STATE_DIR, "alert-subscriptions.json");
const SEEN_FILE = path.join(STATE_DIR, "alert-seen.json");

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; }
}
let saveTimer: NodeJS.Timeout | null = null;
function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      const write = (file: string, data: unknown): void => { fs.writeFileSync(file + ".tmp", JSON.stringify(data), { mode: 0o600 }); fs.renameSync(file + ".tmp", file); };
      write(SUBS_FILE, Object.fromEntries(subs));
      write(SEEN_FILE, [...seen]);
    } catch (e) { console.warn("Alertes : état non enregistré :", e instanceof Error ? e.message : e); }
  }, 2000);
  saveTimer.unref();
}

/* ---------- abonnements ---------- */
export const TOKEN_FORMAT = /^[A-Za-z0-9:_\-]{100,400}$/;
export const LINE = /^[A-Za-z0-9\-]{1,12}$|^\*$/;
/** Notifications possibles (clé Firebase présente) */
export const alertsReady = (): boolean => !!account;

/** Inscription, mise à jour ou désinscription d'un téléphone ; renvoie un code HTTP et un message */
export function subscribe(body: unknown): { status: number; msg: string } {
  if (!account) return { status: 503, msg: "Alertes non configurées sur ce serveur" };
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const token = typeof b["token"] === "string" ? b["token"] : "";
  if (!TOKEN_FORMAT.test(token)) return { status: 400, msg: "Jeton invalide" };
  if (b["enabled"] === false) { subs.delete(token); saveSoon(); return { status: 200, msg: "Désinscrit" }; }
  const lines = Array.isArray(b["lines"]) ? b["lines"].filter((l): l is string => typeof l === "string" && LINE.test(l)).slice(0, 100) : [];
  if (!lines.length) return { status: 400, msg: "Aucune ligne choisie" };
  if (!subs.has(token) && subs.size >= MAX_SUBS) return { status: 503, msg: "Trop d'abonnés" };
  subs.set(token, { lines, works: b["works"] === true, at: Date.now() });
  saveSoon();
  return { status: 200, msg: "Inscrit" };
}

const wants = (s: Sub, m: TrafficMessage): boolean =>
  (m.channel === "disruption" || s.works) && (s.lines.includes("*") || m.lines.some(l => s.lines.includes(l)));

/* ---------- Firebase Cloud Messaging (API HTTP v1) ---------- */
const b64url = (b: Buffer | string): string => Buffer.from(b).toString("base64url");
let access: { value: string; exp: number } | null = null;
let pending: Promise<string> | null = null;

/** Jeton d'accès Google (OAuth 2, compte de service), renouvelé avant expiration ; une seule demande à la fois */
function accessToken(): Promise<string> {
  if (access && access.exp > Date.now() + 60_000) return Promise.resolve(access.value);
  pending ??= requestToken().finally(() => { pending = null; });
  return pending;
}

async function requestToken(): Promise<string> {
  if (!account) throw new Error("clé Firebase absente");
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = b64url(crypto.createSign("RSA-SHA256").update(`${head}.${claims}`).sign(account.private_key));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` })
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error("authentification Google refusée : " + (j.error_description ?? r.status));
  access = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return access.value;
}

/** Envoie une notification à un téléphone ; false si le jeton n'est plus valable (application désinstallée…) */
async function push(token: string, m: TrafficMessage): Promise<boolean> {
  const lines = m.lines.slice(0, 4).join(", ");
  const body = [lines ? `Lignes ${lines}` : "", m.period].filter(Boolean).join(" · ") || "Touchez pour voir le détail";
  return notify(token, (m.channel === "disruption" ? "Perturbation · " : "Travaux · ") + m.title, body, m.id.slice(0, 60), { msg: m.id });
}

/** Notification quelconque (alerte trafic, arrivée d'un tram…) ; false si le jeton n'est plus valable */
export async function notify(token: string, title: string, body: string, tag: string, data: Record<string, string> = {}): Promise<boolean> {
  if (!account) return true;
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: {
      token, notification: { title, body }, data,
      android: { priority: "HIGH", notification: { channel_id: "alertes", icon: "ic_stat_kumm", color: "#136342", tag } }
    } })
  });
  if (r.ok) { counts.envoyees++; return true; }
  const text = await r.text().catch(() => "");
  if (r.status === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT/.test(text)) return false;
  counts.echecs++;
  counts.derniere_erreur = `HTTP ${r.status} ${text.slice(0, 120)}`;
  return true;
}

/** Annonce une perturbation à tous les abonnés concernés (8 envois en parallèle au plus) */
async function broadcast(m: TrafficMessage): Promise<void> {
  const targets = [...subs].filter(([, s]) => wants(s, m)).map(([t]) => t);
  for (let i = 0; i < targets.length; i += 8) {
    await Promise.all(targets.slice(i, i + 8).map(async t => {
      try {
        if (!(await push(t, m))) { subs.delete(t); counts.jetons_retires++; saveSoon(); }
      } catch (e) { counts.echecs++; counts.derniere_erreur = e instanceof Error ? e.message : String(e); }
    }));
  }
}

/* ---------- surveillance ---------- */
async function round(load: () => Promise<TrafficMessage[]>): Promise<void> {
  let items: TrafficMessage[];
  try { items = await load(); } catch { return; }
  if (!items.length && seen.size) return;          // réponse vide (panne probable) : on ne « oublie » rien
  if (!seenReady) {
    // premier passage après un démarrage sans état : tout ce qui est en cours est considéré comme déjà connu
    if (!seen.size) items.forEach(m => seen.add(m.id));
    seenReady = true;
    saveSoon();
    return;
  }
  const fresh = items.filter(m => !seen.has(m.id));
  for (const m of fresh.slice(0, MAX_PER_ROUND)) { seen.add(m.id); await broadcast(m); }
  // on oublie les messages terminés (sinon la liste grandirait sans fin)
  const current = new Set(items.map(m => m.id));
  seen = new Set([...seen].filter(id => current.has(id) || fresh.some(f => f.id === id)));
  if (fresh.length) saveSoon();
}

export function startAlerts(load: () => Promise<TrafficMessage[]>): void {
  // raison précise quand la clé n'est pas utilisable (fichier absent, illisible par le serveur, mauvais fichier)
  let why = "pas de secrets/firebase.json";
  if (fs.existsSync(KEY_FILE)) {
    try {
      const a = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")) as Partial<ServiceAccount> & { type?: string };
      if (a.project_id && a.client_email && a.private_key) account = a as ServiceAccount;
      else why = "secrets/firebase.json n'est pas une clé de compte de service (Firebase → Paramètres → Comptes de service → Générer une nouvelle clé privée)";
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      why = code === "EACCES"
        ? `secrets/firebase.json illisible par le serveur (utilisateur ${process.getuid?.() ?? "?"}) : sudo chown ${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000} secrets/firebase.json`
        : "secrets/firebase.json illisible : " + (e instanceof Error ? e.message : String(e));
    }
  }
  if (!account) { console.log(`Alertes push : désactivées (${why})`); return; }
  for (const [t, s] of Object.entries(readJson<Record<string, Sub>>(SUBS_FILE, {}))) subs.set(t, s);
  seen = new Set(readJson<string[]>(SEEN_FILE, []));
  seenReady = seen.size > 0;
  console.log(`Alertes push : actives (projet ${account.project_id}, ${subs.size} abonné${subs.size > 1 ? "s" : ""})`);
  void round(load);
  setInterval(() => { void round(load); }, POLL_MS).unref();
}

/** Pour /health (aucun jeton n'est affiché) */
export const alertsStatus = (): Record<string, unknown> => ({ actives: !!account, abonnes: subs.size, ...counts, derniere_erreur: counts.derniere_erreur || null });
