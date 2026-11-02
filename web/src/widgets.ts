/**
 * Widgets de l'écran d'accueil Android (code natif : android-src/WidgetCore.java, module KummWidgets).
 * - L'application leur transmet ce dont ils ont besoin : adresse du serveur, couleurs des lignes, lignes suivies (infos
 *   trafic) et dernière position (arrêt le plus proche) ; seulement quand quelque chose change.
 * - Toucher un widget ouvre Kumm sur l'écran voulu ; un widget pas encore réglé ouvre l'écran de choix (arrêt, ligne et
 *   direction, station Vélhop ou P+R), puis Kumm se referme pour revenir à l'écran d'accueil.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { API_BASE, APP_KEY } from "./config";
import { COLORS, TEXT_COLORS } from "./data";
import { THEME_TOKENS } from "./themes";
import { S, STOPS, USER, render, stopById } from "./store";

interface KummWidgetsPlugin {
  sync(data: Record<string, unknown>): Promise<void>;
  configure(o: { widgetId: number; config: Record<string, unknown> }): Promise<void>;
  refresh(): Promise<void>;
  pending(): Promise<{ open?: string }>;
  addListener(ev: "open", fn: (d: { open: string }) => void): Promise<PluginListenerHandle>;
}

export const WIDGETS = Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("KummWidgets");
const Widgets = registerPlugin<KummWidgetsPlugin>("KummWidgets");

/** Choix d'un widget en cours (écran ouvert depuis un widget pas encore réglé) */
export interface WidgetSetup {
  id: number; type: string; q: string; stop?: string; deps?: { line: string; dest: string }[];
  /** widget « arrêt favori » : directions cochées (aucune = toutes) */
  sel?: number[];
}

/** Thème des widgets : celui de l'application (« automatique » : clair ou sombre selon le téléphone, au moment de l'envoi) */
function widgetTheme(): { palette: string; ink: string; mute: string } {
  const dark = document.documentElement.dataset["scheme"] === "dark";
  // forme « Papier » en automatique : fonds papier (clair) et encre (sombre), comme dans l'application
  if (S.prefs.ui === "ios" && S.prefs.theme === "auto") return dark ? { palette: "sysdark", ink: "#F2F2F7", mute: "#A1A1A8" } : { palette: "sys", ink: "#111114", mute: "#6C6C70" };
  if (S.prefs.ui === "papier" && S.prefs.theme === "auto") return dark ? { palette: "ink", ink: "#ECE8DD", mute: "#9BA49D" } : { palette: "paper", ink: "#15201B", mute: "#5E6A63" };
  const th = S.prefs.theme === "auto" ? (dark ? "dark" : "light") : S.prefs.theme;
  const t = THEME_TOKENS[th];
  return { palette: th, ink: t.ink, mute: t.mute };
}

let last = "";
let timer = 0;
/** Données transmises aux widgets ; envoyées seulement si elles ont changé (chaque envoi les fait se mettre à jour) */
export function syncWidgets(): void {
  if (!WIDGETS) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    // lignes des infos trafic : celles des alertes, sinon celles des arrêts favoris, sinon tout le réseau
    const favLines = [...new Set(S.fav.flatMap(id => stopById(id)?.lines ?? []))].filter(l => l !== "TER");
    const lines = S.alerts.lines.length ? S.alerts.lines : favLines;
    const data: Record<string, unknown> = {
      base: API_BASE, key: APP_KEY, colors: COLORS, text: TEXT_COLORS, lines, theme: widgetTheme(),
      ...(S.locOn ? { pos: { lat: Math.round(USER.lat * 1e3) / 1e3, lon: Math.round(USER.lon * 1e3) / 1e3 } } : {})
    };
    const key = JSON.stringify(data);
    if (key === last) return;
    last = key;
    const pos = data["pos"] as Record<string, number> | undefined;
    if (pos) pos["t"] = Date.now();
    void Widgets.sync(data).catch(() => { /* widgets indisponibles : rien à faire */ });
  }, 2000);
}

/** En quittant Kumm, les widgets se mettent à jour (horaires frais sur l'écran d'accueil) */
export function refreshWidgets(): void {
  if (WIDGETS) void Widgets.refresh().catch(() => { /* rien */ });
}

/** Ouvre l'écran demandé par un widget touché */
function openFrom(what: string): void {
  const [kind, a = "", b = ""] = what.split(":");
  S.follow = null;
  if (kind === "config") { S.tab = "home"; S.wsetup = { id: Number(a), type: b, q: "" }; S.overlay = { k: "widget" }; }
  else if (kind === "stop" && stopById(a)) { S.overlay = { k: "stop", id: a }; }
  else if (kind === "poi") { S.tab = "nearby"; S.overlay = { k: "poi", id: what.slice(4) }; }
  else if (kind === "carte") { S.tab = "nearby"; S.overlay = null; }
  else if (kind === "search") { S.tab = "search"; S.overlay = null; }
  else if (kind === "favs") { S.overlay = { k: "favs" }; S.favQ = ""; }
  else if (kind === "msgs") { S.overlay = { k: "msgs" }; }
  // notification du trajet suivi : la carte, sur le véhicule
  else if (kind === "trajet") { S.tab = "nearby"; S.overlay = null; if (S.journey) S.follow = { id: S.journey.detail.id, paused: false }; }
  render();
}

export async function initWidgets(): Promise<void> {
  if (!WIDGETS) return;
  void Widgets.addListener("open", d => openFrom(d.open));
  try { const p = await Widgets.pending(); if (p.open) openFrom(p.open); } catch { /* rien */ }
  document.addEventListener("visibilitychange", () => { if (document.hidden) refreshWidgets(); });
}

/** Enregistre le choix fait pour un widget, puis revient à l'écran d'accueil du téléphone */
export async function configureWidget(config: Record<string, unknown>): Promise<void> {
  const w = S.wsetup;
  if (!w) return;
  await Widgets.configure({ widgetId: w.id, config: { type: w.type, ...config } });
  S.wsetup = null; S.overlay = null;
  render();
  const { App } = await import("@capacitor/app");
  setTimeout(() => { void App.minimizeApp().catch(() => { /* rien */ }); }, 500);
}

/** Arrêt choisi pour un widget : ce qu'il faut pour demander ses passages au serveur */
export const stopConfig = (id: string): Record<string, unknown> | null => {
  const s = STOPS.find(x => x.id === id);
  return s ? { stopId: s.id, name: s.name, refs: (s.refs ?? []).slice(0, 40), ...(s.sncf ? { sncf: s.sncf } : {}) } : null;
};
