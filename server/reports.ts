/**
 * Signalements des voyageurs, à un arrêt : ascenseur ou escalator en panne, distributeur de titres hors service, écran
 * d'information éteint, véhicule bondé, arrêt dégradé. Aucun texte libre (rien à modérer, rien de personnel) :
 * - un signalement n'est montré qu'une fois confirmé par au moins 2 appareils différents (un seul ne suffit pas à
 *   afficher une fausse information) ;
 * - chacun peut répondre « toujours vrai » (prolonge) ou « c'est réglé » ; 2 « réglé » de plus que de « toujours vrai »
 *   le retirent ;
 * - il s'efface seul (30 min pour un véhicule bondé, 12 h pour un écran, 48 h pour le reste), sauf s'il est reconfirmé ;
 * - appareils reconnus par un identifiant tiré au hasard dans l'application, haché : aucune donnée de voyageur n'est
 *   gardée ; au plus 20 envois par heure et par appareil, et 40 par adresse IP (non gardée sur disque).
 * Gardé dans state/reports.json. GET /api/reports?stop=ID ; POST /api/report { stop, kind, device, vote? }
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const FILE = path.join(process.env.STATE_DIR ?? path.join(ROOT, "state"), "reports.json");

export const KINDS: Record<string, number> = { lift: 48 * 3600_000, ticket: 48 * 3600_000, screen: 12 * 3600_000, crowd: 30 * 60_000, damage: 48 * 3600_000 };
const MIN_CONFIRM = 2, PER_HOUR = 20, PER_IP_HOUR = 40, MAX_STOPS = 5000;

interface Report { kind: string; first: number; last: number; yes: string[]; no: string[] }
let reports: Record<string, Report[]> = {};
try { reports = JSON.parse(fs.readFileSync(FILE, "utf8")) as typeof reports; } catch { /* premier démarrage */ }
const sent = new Map<string, number[]>();
// limites d'envoi : rien n'est gardé plus d'une heure (ni l'adresse IP, ni l'identifiant haché)
setInterval(() => { const now = Date.now(); for (const [k, v] of sent) if (now - v[v.length - 1] > 3600_000) sent.delete(k); }, 10 * 60_000).unref();
const stats = { recus: 0, refuses: 0 };

let saveTimer: NodeJS.Timeout | null = null;
function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + ".tmp", JSON.stringify(reports)); fs.renameSync(FILE + ".tmp", FILE); }
    catch (e) { console.warn("Signalements : non enregistrés :", e instanceof Error ? e.message : e); }
  }, 10_000);
  saveTimer.unref();
}

/** Retire les signalements expirés ou réglés */
function prune(now: number): void {
  for (const [stop, list] of Object.entries(reports)) {
    const keep = list.filter(r => now - r.last < KINDS[r.kind] && r.no.length - r.yes.length < MIN_CONFIRM);
    if (keep.length) reports[stop] = keep; else delete reports[stop];
  }
}

const STOP = /^[\w:.\- ]{1,40}$/, DEVICE = /^[a-f0-9]{16,64}$/i;
const hashOf = (device: string): string => crypto.createHash("sha256").update("kumm-report|" + device).digest("hex").slice(0, 16);

export function receiveReport(body: unknown, ip: string, now = Date.now()): { status: number; msg: string } {
  const b = (typeof body === "object" && body ? body : {}) as Record<string, unknown>;
  const stop = String(b["stop"] ?? ""), kind = String(b["kind"] ?? ""), device = String(b["device"] ?? ""), vote = b["vote"];
  if (!STOP.test(stop) || !(kind in KINDS) || !DEVICE.test(device) || (vote !== undefined && vote !== "yes" && vote !== "no")) { stats.refuses++; return { status: 400, msg: "Signalement invalide" }; }
  const who = hashOf(device), byIp = "ip|" + ip;
  const times = (sent.get(who) ?? []).filter(t => now - t < 3600_000), ipTimes = (sent.get(byIp) ?? []).filter(t => now - t < 3600_000);
  if (times.length >= PER_HOUR || ipTimes.length >= PER_IP_HOUR) { stats.refuses++; return { status: 429, msg: "Trop de signalements : réessayez plus tard" }; }
  times.push(now); ipTimes.push(now); sent.set(who, times); sent.set(byIp, ipTimes);
  prune(now);
  if (!reports[stop] && Object.keys(reports).length >= MAX_STOPS) return { status: 503, msg: "Signalements indisponibles" };
  const list = (reports[stop] ??= []);
  let r = list.find(x => x.kind === kind);
  if (!r) {
    if (vote === "no") return { status: 200, msg: "Rien à retirer" };
    r = { kind, first: now, last: now, yes: [], no: [] };
    list.push(r);
  }
  // un appareil ne compte qu'une fois, dans un seul camp ; « toujours vrai » prolonge le signalement
  r.yes = r.yes.filter(x => x !== who); r.no = r.no.filter(x => x !== who);
  if (vote === "no") r.no.push(who); else { r.yes.push(who); r.last = now; }
  stats.recus++;
  prune(now);
  saveSoon();
  return { status: 200, msg: "Merci pour votre signalement" };
}

/** Signalements d'un arrêt : confirmés (montrés à tous) ; non confirmés seulement à l'appareil qui les a faits (mine) */
export function reportsFor(stop: string, device: string, now = Date.now()): { kind: string; since: number; n: number; mine: boolean; shown: boolean }[] {
  prune(now);
  const who = DEVICE.test(device) ? hashOf(device) : "";
  return (reports[stop] ?? []).map(r => ({ kind: r.kind, since: r.first, n: r.yes.length, mine: !!who && (r.yes.includes(who) || r.no.includes(who)), shown: r.yes.length >= MIN_CONFIRM }))
    .filter(r => r.shown || r.mine);
}

export const reportsStatus = (): Record<string, unknown> => ({ arrets: Object.keys(reports).length, ...stats });
