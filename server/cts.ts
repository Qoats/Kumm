/** Appels sortants vers la CTS et les services externes : prudents pour ne pas surcharger les serveurs. */

export interface CtsResult {
  status: number;
  type: string;
  body: string;
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** Message lisible, avec la cause réseau (ex. « fetch failed (ECONNRESET) ») */
export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
  const detail = cause?.code ?? cause?.message;
  return detail ? `${e.message} (${detail})` : e.message;
}

/* Au plus 4 requêtes en même temps vers l'extérieur ; les autres attendent leur tour */
import { CTS_BUDGET_PER_MIN, UPSTREAM_QUEUE_MAX } from "./config.js";
import { stats } from "./stats.js";

const MAX_PARALLEL = 4;
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) {
    // trop de demandes en attente : on refuse plutôt que de laisser tout s'accumuler
    if (waiting.length >= UPSTREAM_QUEUE_MAX) throw new Error("serveur saturé");
    await new Promise<void>(res => waiting.push(res));
  }
  running++;
  try { return await fn(); }
  finally { running--; waiting.shift()?.(); }
}

/** Un seul nouvel essai, et seulement après une erreur 5xx. Une connexion coupée n'est jamais répétée. */
export function fetchRetry(url: string, headers: Record<string, string>): Promise<CtsResult> {
  return slot(async () => {
    for (let i = 0; i < 2; i++) {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 8000);
      try {
        const r = await fetch(url, { headers, signal: ctl.signal });
        if (r.status >= 500 && i === 0) { await sleep(500); continue; }
        return { status: r.status, type: r.headers.get("content-type") ?? "application/json", body: await r.text() };
      } finally {
        clearTimeout(to);
      }
    }
    throw new Error("inatteignable");
  });
}

/* Disjoncteur : si la CTS coupe la connexion, on arrête de l'appeler pendant 2 minutes */
const PAUSE_MS = 120_000;
let blockedUntil = 0;
let lastFailure = "";

export function ctsPaused(): { paused: boolean; seconds: number; why: string } {
  const left = blockedUntil - Date.now();
  return { paused: left > 0, seconds: Math.ceil(left / 1000), why: lastFailure };
}

/* Plafond global d'appels vers la CTS : une fenêtre glissante d'une minute, partagée par tous les visiteurs */
const callTimes: number[] = [];
export const ctsCallsLastMinute = (): number => { const lim = Date.now() - 60_000; while (callTimes.length && callTimes[0] < lim) callTimes.shift(); return callTimes.length; };

export async function fetchCts(base: string, auth: string, name: string, search: string): Promise<CtsResult> {
  if (CTS_BUDGET_PER_MIN > 0 && ctsCallsLastMinute() >= CTS_BUDGET_PER_MIN) {
    stats.budgetRefused++;
    throw new Error("budget d'appels CTS atteint");
  }
  callTimes.push(Date.now()); stats.ctsCalls++;
  const p = ctsPaused();
  if (p.paused) throw new Error(`CTS en pause ${p.seconds} s après une erreur : ${p.why}`);
  try {
    return await fetchRetry(`${base}/${name}${search}`, { Authorization: auth, Accept: "application/json" });
  } catch (e) {
    stats.upstreamErrors++;
    lastFailure = describeError(e);
    blockedUntil = Date.now() + PAUSE_MS;
    console.error(`CTS injoignable (${lastFailure}) : pause de ${PAUSE_MS / 1000} s`);
    throw e;
  }
}
