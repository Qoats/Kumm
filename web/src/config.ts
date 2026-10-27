/** numéro affiché en bas de l'accueil : sert à vérifier quelle version tourne */
export const VERSION = "0.37.0";

/**
 * Adresse du serveur Kumm. Vide sur le web (même adresse que la page).
 * Pour l'APK Android, elle est fixée à la compilation dans web/.env.android (VITE_API_BASE=https://…).
 */
export const API_BASE: string = ((import.meta.env["VITE_API_BASE"] as string | undefined) ?? "").replace(/\/+$/, "");
export const url = (path: string): string => API_BASE + path;

export const CONFIG = {
  /** ajoutez ?mock à l'adresse pour le mode démo (données fictives) */
  USE_MOCK: import.meta.env["VITE_DEMO"] === "1" || new URLSearchParams(location.search).has("mock"),
  /** relais côté serveur : le token CTS n'est jamais dans le navigateur */
  CTS_BASE: API_BASE + "/api"
};

/** Clé d'application : si le serveur exige l'en-tête X-App-Key (APP_KEY côté serveur), elle est fixée à la compilation (VITE_APP_KEY). */
export const APP_KEY = ((import.meta.env["VITE_APP_KEY"] as string | undefined) ?? "").trim();
export const appHeaders = (): Record<string, string> => APP_KEY ? { "X-App-Key": APP_KEY } : {};
