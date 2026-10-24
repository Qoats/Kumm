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

/** Version plus récente que celle installée, null si à jour ; « unpublished » : le serveur n'a encore aucun APK à distribuer */
export async function checkUpdate(): Promise<Release | null | "unpublished"> {
  if (!CAN_UPDATE) return null;
  const [info, r] = await Promise.all([App.getInfo(), fetch(url("/app/latest.json"), { cache: "no-store", headers: appHeaders() })]);
  if (r.status === 404) return "unpublished";
  if (!r.ok) throw new Error("HTTP " + r.status);
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

/* ---------- page de mise à jour (plein écran) ---------- */
const mo = (b: number): string => (b / 1e6).toFixed(1).replace(".", ",") + " Mo";
const escText = (t: string): string => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Page affichée tant que l'application n'est pas à jour : télécharger et installer, ou quitter */
export function updateView(p: { rel: Release | null; phase: "ready" | "down" | "perm" | "error" | "launched"; pct: number; err?: string }, current: string): string {
  const web = !Capacitor.isNativePlatform();
  const title = p.rel ? "Mise à jour disponible" : "Mise à jour nécessaire";
  const text = p.rel
    ? `La version ${escText(p.rel.version)} de Kumm est disponible. Installez-la pour continuer à utiliser l’application.`
    : web
      ? "Une nouvelle version de Kumm est en ligne. Rechargez la page pour l’utiliser."
      : "Cette version de Kumm n’est plus compatible avec le serveur. Installez la dernière version pour continuer.";
  let status = "", actions = "";
  if (p.phase === "down") {
    status = `<div class="upd-bar" role="progressbar" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p.pct}%"></i></div>
      <p class="upd-pct">Téléchargement… ${p.pct} %</p>`;
  } else {
    if (p.phase === "perm") status = `<p class="upd-msg">Android demande d’autoriser Kumm à installer des applications : activez « Autoriser depuis cette source », puis revenez ici. L’installation reprendra toute seule.</p>`;
    if (p.phase === "error") status = `<p class="upd-msg upd-err" role="alert">${escText(p.err ?? "Le téléchargement a échoué.")} Vérifiez votre connexion et réessayez.</p>`;
    if (p.phase === "launched") status = `<p class="upd-msg">L’installateur d’Android s’est ouvert : touchez « Mettre à jour ». S’il a été fermé ou affiche « Application non installée », relancez l’installation ci-dessous.</p>`;
    const label = p.phase === "error" ? "Réessayer" : p.phase === "launched" ? "Relancer l’installation" : "Télécharger et installer";
    actions = web
      ? `<button class="onb-main" data-upd="reload">Recharger</button>`
      : `${p.rel ? `<button class="onb-main" data-upd="go">${label}</button>` : ""}<button class="onb-sec" data-upd="quit">Quitter</button>
        ${p.phase === "launched" || p.phase === "error" ? `<a class="upd-alt" href="${url("/app/kumm.apk")}" target="_blank" rel="noopener">Télécharger l’APK avec le navigateur</a>` : ""}`;
  }
  return `<div class="onb upd" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="onb-top"></div>
    <div class="onb-body">
      <div class="onb-logo">${'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>'}</div>
      <h1>${title}</h1>
      <p>${text}</p>
      <div class="upd-ver"><span>Version installée <b>${escText(current)}</b></span>${p.rel ? `<span>Nouvelle version <b>${escText(p.rel.version)}</b> · ${mo(p.rel.size)}</span>` : ""}</div>
      ${status}
    </div>
    <div class="onb-actions">${actions}</div></div>`;
}
