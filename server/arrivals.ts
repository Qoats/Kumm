/**
 * « Prévenez-moi avant le passage » : depuis un arrêt, la personne choisit un passage (ligne, direction, heure) et
 * combien de minutes avant être prévenue. Le serveur suit ce passage dans les horaires en temps réel (il peut prendre
 * du retard) et envoie la notification (Firebase) quand il arrive dans le délai choisi, même application fermée.
 * - POST /api/arrival { token, refs, stop, line, dest, at, lead } ; { token, cancel: true, refs, line, dest } pour annuler ;
 * - gardé dans state/arrival-watches.json (un redémarrage du serveur ne fait rien perdre).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LINE, TOKEN_FORMAT, alertsReady, notify } from "./alerts.js";
import { upcomingFor } from "./realtime.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const FILE = path.join(process.env.STATE_DIR ?? path.join(ROOT, "state"), "arrival-watches.json");
const REF = /^[A-Za-z0-9:_.\-]{1,40}$/;
const MAX_PER_TOKEN = 5, MAX_TOTAL = 20_000;
const TRACK_MS = 20 * 60_000;      // même passage retrouvé s'il a bougé de 20 min au plus (retard, avance)

interface Watch { token: string; refs: string[]; stop: string; line: string; dest: string; at: number; lead: number; created: number }
const watches = new Map<string, Watch>();
const counts = { envoyees: 0, expirees: 0 };
const keyOf = (w: Pick<Watch, "token" | "refs" | "line" | "dest">): string => `${w.token}|${w.refs[0]}|${w.line}|${w.dest}`;

try { for (const w of JSON.parse(fs.readFileSync(FILE, "utf8")) as Watch[]) watches.set(keyOf(w), w); } catch { /* premier démarrage */ }
let saveTimer: NodeJS.Timeout | null = null;
function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + ".tmp", JSON.stringify([...watches.values()])); fs.renameSync(FILE + ".tmp", FILE); }
    catch (e) { console.warn("Arrivées : état non enregistré :", e instanceof Error ? e.message : e); }
  }, 2000);
  saveTimer.unref();
}

/** Demande (ou annulation) d'une alerte avant un passage ; renvoie un code HTTP et un message */
export function watchArrival(body: unknown, now = Date.now()): { status: number; msg: string } {
  if (!alertsReady()) return { status: 503, msg: "Notifications non configurées sur ce serveur" };
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const token = typeof b["token"] === "string" ? b["token"] : "";
  const refs = Array.isArray(b["refs"]) ? b["refs"].filter((r): r is string => typeof r === "string" && REF.test(r)).slice(0, 20) : [];
  const line = typeof b["line"] === "string" ? b["line"] : "", dest = typeof b["dest"] === "string" ? b["dest"].slice(0, 80) : "";
  if (!TOKEN_FORMAT.test(token) || !refs.length || !LINE.test(line) || !dest) return { status: 400, msg: "Demande invalide" };
  if (b["cancel"] === true) { watches.delete(keyOf({ token, refs, line, dest })); saveSoon(); return { status: 200, msg: "Annulée" }; }
  const at = Number(b["at"]), lead = Math.round(Number(b["lead"]));
  if (!Number.isFinite(at) || at < now - 60_000 || at > now + 4 * 3600_000 || !(lead >= 1 && lead <= 30)) return { status: 400, msg: "Heure ou délai invalide" };
  const mine = [...watches.values()].filter(w => w.token === token);
  if (mine.length >= MAX_PER_TOKEN && !watches.has(keyOf({ token, refs, line, dest }))) return { status: 429, msg: "5 alertes au plus en même temps" };
  if (watches.size >= MAX_TOTAL) return { status: 503, msg: "Trop d'alertes en cours" };
  const stop = typeof b["stop"] === "string" ? b["stop"].slice(0, 80) : "";
  watches.set(keyOf({ token, refs, line, dest }), { token, refs, stop, line, dest, at, lead, created: now });
  saveSoon();
  return { status: 200, msg: "Enregistrée" };
}

const hm = (t: number): string => new Date(t).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

/** Toutes les 20 s : recale chaque passage suivi sur les horaires en temps réel, prévient quand il est assez proche */
async function round(now = Date.now()): Promise<void> {
  for (const [k, w] of watches) {
    if (now - w.created > 5 * 3600_000) { watches.delete(k); counts.expirees++; continue; }
    const vs = upcomingFor(w.refs, now);
    if (!vs) continue;                                     // horaires momentanément indisponibles : on attend
    const v = vs.filter(x => x.line === w.line && x.dest === w.dest && !x.cancelled && Math.abs(x.time - w.at) < TRACK_MS)
      .sort((a, b) => Math.abs(a.time - w.at) - Math.abs(b.time - w.at))[0];
    if (!v) { if (now > w.at + 3 * 60_000) { watches.delete(k); counts.expirees++; } continue; }
    w.at = v.time;
    const left = Math.round((v.time - now) / 60_000);
    if (v.time - now > w.lead * 60_000) continue;
    watches.delete(k);
    const when = left <= 0 ? "arrive maintenant" : `arrive dans ${left} min`;
    try {
      await notify(w.token, `${w.line} vers ${w.dest} · ${when}`, `${w.stop ? w.stop + " · " : ""}passage à ${hm(v.time)}`, `arr-${w.line}-${w.refs[0]}`.slice(0, 60), { arrival: w.line });
      counts.envoyees++;
    } catch (e) { console.warn("Arrivées : envoi impossible :", e instanceof Error ? e.message : e); }
  }
  saveSoon();
}

export function startArrivals(): void {
  setInterval(() => { void round(); }, 20_000).unref();
}

export const arrivalsStatus = (): Record<string, unknown> => ({ en_cours: watches.size, ...counts });
