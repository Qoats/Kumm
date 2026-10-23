/**
 * Alertes trafic : notification pour chaque nouvelle perturbation sur les lignes suivies.
 * - Application Android : un petit programme (web/public/runners/alerts.js) vérifie environ toutes les 15 minutes,
 *   même application fermée ; on lui transmet les réglages et on le lance aussi à chaque mise à jour des infos trafic.
 * - Version web : notifications du navigateur, seulement tant que la page est ouverte.
 */
import { Capacitor } from "@capacitor/core";
import { API_BASE, APP_KEY } from "./config";
import type { TrafficMsg } from "./data";

export interface AlertPrefs {
  enabled: boolean;
  /** inclure aussi les travaux et changements prévus (sinon seulement les incidents) */
  works: boolean;
  /** lignes suivies ; « * » = toutes */
  lines: string[];
}

const KEY = "alerts", SEEN = "alertsSeen", LABEL = "fr.kumm.alerts";
export const NATIVE = Capacitor.isNativePlatform();

export function loadAlerts(): AlertPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<AlertPrefs>;
    return { enabled: p.enabled === true, works: p.works === true, lines: Array.isArray(p.lines) ? p.lines.filter(l => typeof l === "string") : [] };
  } catch { return { enabled: false, works: false, lines: [] }; }
}

export function saveAlerts(p: AlertPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* stockage indisponible */ }
}

export const followed = (m: TrafficMsg, p: AlertPrefs): boolean =>
  (m.channel === "disruption" || p.works) && (p.lines.includes("*") || m.lines.some(l => p.lines.includes(l)));

const runner = async () => (await import("@capacitor/background-runner")).BackgroundRunner;

/** Demande l'autorisation d'afficher des notifications ; true si accordée */
export async function askPermission(): Promise<boolean> {
  try {
    if (NATIVE) {
      const r = (await (await runner()).requestPermissions({ apis: ["notifications"] })) as { notifications?: string };
      return r.notifications === "granted";
    }
    if (!("Notification" in window)) return false;
    return (Notification.permission === "granted") || (await Notification.requestPermission()) === "granted";
  } catch { return false; }
}

/** Transmet les réglages au programme d'arrière-plan ; seen : messages en cours à ne pas annoncer (à l'activation) */
export async function syncAlerts(p: AlertPrefs, seen?: string[]): Promise<void> {
  if (seen) { try { localStorage.setItem(SEEN, JSON.stringify(seen)); } catch { /* ignoré */ } }
  if (!NATIVE) return;
  try {
    await (await runner()).dispatchEvent({ label: LABEL, event: "kummConfig", details: { ...p, apiBase: API_BASE, appKey: APP_KEY, ...(seen ? { seen } : {}) } });
  } catch (e) { console.warn("Alertes trafic : réglages non transmis", e); }
}

/** Après une mise à jour des infos trafic : notifie les nouvelles perturbations des lignes suivies */
export function checkAlerts(p: AlertPrefs, messages: TrafficMsg[]): void {
  if (!p.enabled) return;
  if (NATIVE) {
    // le programme d'arrière-plan fait la vérification (et tient la liste des messages déjà annoncés)
    void runner().then(r => r.dispatchEvent({ label: LABEL, event: "checkAlerts", details: {} })).catch(() => {});
    return;
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  let seen: string[] = [];
  try { seen = JSON.parse(localStorage.getItem(SEEN) ?? "[]") as string[]; } catch { /* rien */ }
  for (const m of messages.filter(m => followed(m, p) && !seen.includes(m.id)).slice(0, 4)) {
    try {
      new Notification((m.channel === "disruption" ? "Perturbation · " : "Travaux · ") + m.title, {
        body: (m.lines.length ? "Lignes " + m.lines.slice(0, 4).join(", ") : "") + (m.period ? " · " + m.period : ""),
        icon: "/icon-192.png", tag: m.id
      });
    } catch { /* notifications indisponibles (certains navigateurs mobiles) */ }
  }
  try { localStorage.setItem(SEEN, JSON.stringify(messages.map(m => m.id))); } catch { /* ignoré */ }
}

/** Touche d'une notification (Android) : ouvrir les infos trafic */
export function onAlertTap(open: () => void): void {
  if (!NATIVE) return;
  void runner().then(r => r.addListener("backgroundRunnerNotificationReceived", () => open())).catch(() => {});
}
