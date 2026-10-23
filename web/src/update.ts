/**
 * Mises à jour de l'application Android depuis l'application elle-même : au lancement, Kumm demande au serveur la dernière
 * version publiée (/app/latest.json) ; si elle est plus récente, il la propose, la télécharge et ouvre l'installateur d'Android
 * (module natif KummUpdater, dossier android-src/).
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { appHeaders, url } from "./config";

export interface Release { version: string; code: number; size: number; sha256: string }

interface Updater {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  install(o: { url: string; sha256: string }): Promise<void>;
  addListener(event: "progress", cb: (p: { done: number; total: number }) => void): Promise<PluginListenerHandle>;
}
// objet de l'extension : utilisé directement, jamais renvoyé par une fonction async (il répond aussi à « then »)
const Updater = registerPlugin<Updater>("KummUpdater");

export const CAN_UPDATE = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("KummUpdater");

/** Version plus récente que celle installée, ou null (à jour, hors ligne, rien de publié) */
export async function checkUpdate(): Promise<Release | null> {
  if (!CAN_UPDATE) return null;
  const [info, r] = await Promise.all([App.getInfo(), fetch(url("/app/latest.json"), { cache: "no-store", headers: appHeaders() })]);
  if (!r.ok) return null;
  const j = (await r.json()) as Partial<Release>;
  if (typeof j.version !== "string" || !Number.isInteger(j.code) || typeof j.sha256 !== "string" || !Number.isInteger(j.size)) return null;
  return j.code! > Number(info.build) ? (j as Release) : null;
}

/**
 * Télécharge et ouvre l'installateur. « permission » : Android demande d'abord d'autoriser Kumm à installer des applications
 * (le réglage vient d'être ouvert ; il suffit de revenir et de relancer).
 */
export async function installUpdate(rel: Release, onProgress: (pct: number) => void): Promise<"started" | "permission"> {
  if (!(await Updater.canInstall()).allowed) { await Updater.openInstallSettings(); return "permission"; }
  const h = await Updater.addListener("progress", p => onProgress(p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0));
  try { await Updater.install({ url: url("/app/kumm.apk"), sha256: rel.sha256 }); }
  finally { void h.remove(); }
  return "started";
}
