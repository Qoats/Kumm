/**
 * Alertes trafic : notification pour chaque nouvelle perturbation sur les lignes suivies.
 * - Application Android : notifications push (Firebase). Le téléphone s'enregistre auprès de Firebase, puis envoie
 *   son jeton et ses lignes au serveur Kumm (POST /api/alerts) ; c'est le serveur qui surveille la CTS et envoie.
 * - Version web : notifications du navigateur, seulement tant que la page est ouverte.
 */
import { Capacitor } from "@capacitor/core";
import { appHeaders, url } from "./config";
import type { TrafficMsg } from "./data";

export interface AlertPrefs {
  enabled: boolean;
  /** inclure aussi les travaux et changements prévus (sinon seulement les incidents) */
  works: boolean;
  /** lignes suivies ; « * » = toutes */
  lines: string[];
}

const KEY = "alerts", SEEN = "alertsSeen", TOKEN_KEY = "pushToken";
export const NATIVE = Capacitor.isNativePlatform();
/** Firebase est configuré dans cette application (fichier google-services.json fourni à la compilation) */
export const PUSH_READY = import.meta.env["VITE_PUSH"] === "1";

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

const push = async () => (await import("@capacitor/push-notifications")).PushNotifications;

/** Demande l'autorisation d'afficher des notifications ; true si accordée */
export async function askPermission(): Promise<boolean> {
  try {
    if (NATIVE) {
      if (!PUSH_READY) return false;
      const P = await push();
      const r = await P.requestPermissions();
      if (r.receive !== "granted") return false;
      // canal Android « Alertes trafic » (son, bannière) : utilisé par le serveur pour chaque alerte
      await P.createChannel({ id: "alertes", name: "Alertes trafic", description: "Perturbations sur vos lignes", importance: 4, visibility: 1 }).catch(() => {});
      return true;
    }
    if (!("Notification" in window)) return false;
    return (Notification.permission === "granted") || (await Notification.requestPermission()) === "granted";
  } catch { return false; }
}

/** Jeton Firebase du téléphone (nouvel enregistrement à chaque démarrage : Firebase peut le changer) */
async function pushToken(): Promise<string> {
  const P = await push();
  return new Promise<string>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("pas de réponse de Firebase")), 15_000);
    void P.addListener("registration", t => { clearTimeout(to); try { localStorage.setItem(TOKEN_KEY, t.value); } catch { /* ignoré */ } resolve(t.value); });
    void P.addListener("registrationError", e => { clearTimeout(to); reject(new Error(e.error)); });
    void P.register();
  });
}

/** Envoie l'abonnement (ou la désinscription) au serveur Kumm ; lève une erreur lisible en cas de refus */
async function sendSubscription(body: Record<string, unknown>): Promise<void> {
  const r = await fetch(url("/api/alerts"), { method: "POST", headers: { ...appHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { message?: string };
    throw new Error(r.status === 503 ? "Le serveur Kumm n'est pas encore configuré pour les alertes (Firebase)" : (j.message ?? "HTTP " + r.status));
  }
}

/** Applique les réglages : abonnement au serveur (application) ; seen : messages en cours à ne pas annoncer (web) */
export async function syncAlerts(p: AlertPrefs, seen?: string[]): Promise<void> {
  if (seen) { try { localStorage.setItem(SEEN, JSON.stringify(seen)); } catch { /* ignoré */ } }
  if (!NATIVE || !PUSH_READY) return;
  if (p.enabled) await sendSubscription({ token: await pushToken(), enabled: true, works: p.works, lines: p.lines });
  else {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) await sendSubscription({ token: saved, enabled: false });
  }
}

/** Après une mise à jour des infos trafic (version web) : notifie les nouvelles perturbations des lignes suivies */
export function checkAlerts(p: AlertPrefs, messages: TrafficMsg[]): void {
  if (!p.enabled || NATIVE) return;   // application : c'est le serveur qui envoie les notifications
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

/** Notification touchée (application fermée ou ouverte) : ouvrir les infos trafic */
export function onAlertTap(open: () => void): void {
  if (!NATIVE || !PUSH_READY) return;
  void push().then(P => P.addListener("pushNotificationActionPerformed", () => open())).catch(() => {});
}
