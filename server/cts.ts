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

/* Au plus UPSTREAM_PARALLEL requêtes en même temps par file ; les autres attendent leur tour.
   Deux files séparées : un calcul d'itinéraire lent ne bloque pas les passages en direct de la CTS. */
import { CTS_BUDGET_PER_MIN, CTS_LIVE, CTS_TRAFFIC, TOKEN, UPSTREAM_PARALLEL, UPSTREAM_QUEUE_MAX } from "./config.js";
import { stats } from "./stats.js";

export type Pool = "cts" | "ext";

/** Refus local (file pleine) : ce n'est pas une panne du service distant */
export class SaturatedError extends Error {
  constructor() { super("serveur saturé"); }
}

const pools: Record<Pool, { running: number; waiting: (() => void)[] }> = {
  cts: { running: 0, waiting: [] },
  ext: { running: 0, waiting: [] }
};
async function slot<T>(pool: Pool, fn: () => Promise<T>): Promise<T> {
  const q = pools[pool];
  if (q.running >= UPSTREAM_PARALLEL) {
    // trop de demandes en attente : on refuse plutôt que de laisser tout s'accumuler
    if (q.waiting.length >= UPSTREAM_QUEUE_MAX) throw new SaturatedError();
    await new Promise<void>(res => q.waiting.push(res));
  }
  q.running++;
  try { return await fn(); }
  finally { q.running--; q.waiting.shift()?.(); }
}

/** Un seul nouvel essai, et seulement après une erreur 5xx. Une connexion coupée n'est jamais répétée. */
export function fetchRetry(url: string, headers: Record<string, string>, pool: Pool = "ext"): Promise<CtsResult> {
  return slot(pool, async () => {
    for (let i = 0; i < 2; i++) {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 8000);
      try {
        const r = await fetch(url, { headers, signal: ctl.signal, redirect: pool === "cts" ? "error" : "follow" });
        if (r.status >= 500 && i === 0) { await sleep(500); continue; }
        return { status: r.status, type: r.headers.get("content-type") ?? "application/json", body: await r.text() };
      } finally {
        clearTimeout(to);
      }
    }
    throw new Error("inatteignable");
  });
}

/* Disjoncteur : si la CTS coupe la connexion, on arrête de l'appeler pendant 2 minutes.
   Une file pleine (refus local) ne compte pas ; un délai dépassé ne compte qu'à partir de 3 d'affilée. */
const PAUSE_MS = 120_000;
const TIMEOUTS_BEFORE_PAUSE = 3;
let blockedUntil = 0;
let lastFailure = "";
let timeoutsInARow = 0;

export function ctsPaused(): { paused: boolean; seconds: number; why: string } {
  const left = blockedUntil - Date.now();
  return { paused: left > 0, seconds: Math.ceil(left / 1000), why: lastFailure };
}

const isTimeout = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

/* Plafond global d'appels vers la CTS : une fenêtre glissante d'une minute, partagée par tous les visiteurs */
const callTimes: number[] = [];
export const ctsCallsLastMinute = (): number => { const lim = Date.now() - 60_000; while (callTimes.length && callTimes[0] < lim) callTimes.shift(); return callTimes.length; };

export async function fetchCts(base: string, auth: string, name: string, search: string): Promise<CtsResult> {
  if (!CTS_LIVE || !TOKEN || (name === "general-message" && !CTS_TRAFFIC)) {
    return { status: 503, type: "application/json", body: JSON.stringify({ error: "Données CTS désactivées" }) };
  }
  const p = ctsPaused();
  if (p.paused) throw new Error(`CTS en pause ${p.seconds} s après une erreur : ${p.why}`);
  if (CTS_BUDGET_PER_MIN > 0 && ctsCallsLastMinute() >= CTS_BUDGET_PER_MIN) {
    stats.budgetRefused++;
    throw new Error("budget d'appels CTS atteint");
  }
  callTimes.push(Date.now()); stats.ctsCalls++;
  try {
    const r = await fetchRetry(`${base}/${name}${search}`, { Authorization: auth, Accept: "application/json" }, "cts");
    timeoutsInARow = 0;
    return r;
  } catch (e) {
    if (e instanceof SaturatedError) throw e;
    stats.upstreamErrors++;
    lastFailure = describeError(e);
    if (isTimeout(e) && ++timeoutsInARow < TIMEOUTS_BEFORE_PAUSE) throw e;
    timeoutsInARow = 0;
    blockedUntil = Date.now() + PAUSE_MS;
    console.error(`CTS injoignable (${lastFailure}) : pause de ${PAUSE_MS / 1000} s`);
    throw e;
  }
}
