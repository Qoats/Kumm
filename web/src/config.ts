import { AUTONOMOUS, localInit } from "./local";
/** numéro affiché en bas de l'accueil : sert à vérifier quelle version tourne */
export const VERSION = "0.53.0";

/**
 * Adresse du serveur Kumm. Vide sur le web (même adresse que la page).
 * Android utilise les archives locales et ne contacte pas le serveur Kumm.
 */
export const API_BASE: string = (AUTONOMOUS ? "" : ((import.meta.env["VITE_API_BASE"] as string | undefined) ?? "")).replace(/\/+$/, "");
export const url = (path: string): string => API_BASE + path;

export const CONFIG = {
  /** Aucun mode de démonstration dans les versions distribuées. */
  USE_MOCK: false,
  CTS_REALTIME: false,
  CTS_TRAFFIC: false,
  SERVER_READY: false,
  /** relais côté serveur : le token CTS n'est jamais dans le navigateur */
  CTS_BASE: API_BASE + "/api"
};

/** Un serveur plus ancien ou indisponible laisse l’application en horaires théoriques. */
export async function loadServerMode(): Promise<void> {
  if (AUTONOMOUS) { await localInit(); CONFIG.SERVER_READY = true; return; }
  if (CONFIG.USE_MOCK) return;
  try {
    const res = await fetch(url("/api/kumm-mode"), { cache: "no-store", signal: AbortSignal.timeout(3500) });
    if (!res.ok) return;
    const mode = await res.json() as { protocol?: number; cts?: string; traffic?: boolean; private?: boolean };
    if (mode.protocol !== 1 || (mode.cts !== "scheduled" && mode.cts !== "live")) return;
    CONFIG.SERVER_READY = true;
    CONFIG.CTS_REALTIME = mode.cts === "live" && !(mode.private === true && Boolean(API_BASE));
    CONFIG.CTS_TRAFFIC = CONFIG.CTS_REALTIME && mode.traffic === true;
  } catch { /* le flux GTFS reste demandé explicitement */ }
}
