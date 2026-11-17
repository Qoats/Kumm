/** Mises à jour stables facultatives depuis les GitHub Releases officielles. */
import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";


export interface Release { version: string; code: number; size: number; sha256: string; apkUrl: string }

interface Updater {
  source(): Promise<{ play: boolean }>;
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  install(o: { url: string; sha256: string }): Promise<void>;
  addListener(event: "progress", cb: (p: { done: number; total: number }) => void): Promise<PluginListenerHandle>;
}
// objet de l'extension : utilisé directement, jamais renvoyé par une fonction async (il répond aussi à « then »)
const Updater = registerPlugin<Updater>("KummUpdater");

export const CAN_UPDATE = import.meta.env["VITE_SIDELOAD_UPDATES"] === "1" && Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("KummUpdater");

/** Version plus récente que celle installée, null si à jour ; « unpublished » : le serveur n'a encore aucun APK à distribuer */
export async function checkUpdate(manual = false): Promise<Release | null | "unpublished"> {
  if (!CAN_UPDATE) return null;
  if (!manual && Date.now() - Number(localStorage.getItem("release-checked") ?? 0) < 86400000) return null;
  if ((await Updater.source()).play) { if (manual) throw Error("Utilisez Google Play pour mettre Kumm à jour"); return null; }
  const info = await App.getInfo();
  const r = await CapacitorHttp.get({ url: "https://api.github.com/repos/Qoats/Kumm/releases/latest", headers: { Accept: "application/vnd.github+json" }, connectTimeout: 10000, readTimeout: 15000 });
  if (r.status === 404) { localStorage.setItem("release-checked", String(Date.now())); return "unpublished"; }
  if (r.status !== 200) throw Error("GitHub HTTP " + r.status);
  const release = r.data as { draft?: boolean; prerelease?: boolean; assets?: { name: string; browser_download_url: string }[] };
  if (release.draft || release.prerelease) return null;
  const asset = (name: string) => release.assets?.find(a => a.name === name)?.browser_download_url;
  const manifest = asset("latest.json"), apkUrl = asset("kumm.apk");
  const official = (v: string | undefined): v is string => !!v && /^https:\/\/github\.com\/Qoats\/Kumm\/releases\/download\/[^/]+\/(latest\.json|kumm\.apk)$/.test(v);
  if (!official(manifest) || !official(apkUrl)) return "unpublished";
  const m = await CapacitorHttp.get({ url: manifest, connectTimeout: 10000, readTimeout: 15000 });
  if (m.status !== 200) throw Error("Manifeste GitHub indisponible");
  const j = (typeof m.data === "string" ? JSON.parse(m.data) : m.data) as Release;
  if (typeof j.version !== "string" || !Number.isSafeInteger(j.code) || j.code < 1 || j.code > 2_100_000_000 || !/^[0-9a-f]{64}$/.test(j.sha256) || !Number.isSafeInteger(j.size) || j.size <= 0) throw Error("Manifeste invalide");
  localStorage.setItem("release-checked", String(Date.now()));
  return j.code > Number(info.build) ? { ...j, apkUrl } : null;
}

/**
 * Télécharge et ouvre l'installateur. « permission » : Android demande d'abord d'autoriser Kumm à installer des applications
 * (le réglage vient d'être ouvert ; il suffit de revenir et de relancer).
 */
export async function installUpdate(rel: Release, onProgress: (pct: number) => void): Promise<"started" | "permission"> {
  if (!(await Updater.canInstall()).allowed) { await Updater.openInstallSettings(); return "permission"; }
  const h = await Updater.addListener("progress", p => onProgress(p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0));
  try { await Updater.install({ url: rel.apkUrl, sha256: rel.sha256 }); }
  finally { void h.remove(); }
  return "started";
}

/* ---------- page de mise à jour (plein écran) ---------- */
const mo = (b: number): string => (b / 1e6).toFixed(1).replace(".", ",") + " Mo";
const escText = (t: string): string => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Proposition facultative : téléchargement, report ou refus de cette version */
export function updateView(p: { rel: Release | null; phase: "ready" | "down" | "perm" | "error" | "launched"; pct: number; err?: string }, current: string): string {
  const web = !Capacitor.isNativePlatform();
  const title = p.rel ? "Mise à jour disponible" : "Mises à jour";
  const text = p.rel
    ? `La version ${escText(p.rel.version)} de Kumm est disponible. Vous pouvez l’installer maintenant ou continuer avec votre version actuelle.`
    : web
      ? "Une nouvelle version de Kumm est en ligne. Rechargez la page pour l’utiliser."
      : "Consultez les dernières versions de Kumm sur GitHub.";
  let status = "", actions = "";
  if (p.phase === "down") {
    status = `<div class="upd-bar" role="progressbar" aria-valuenow="${p.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p.pct}%"></i></div>
      <p class="upd-pct">Téléchargement… ${p.pct} %</p>`;
  } else {
    if (p.phase === "perm") status = `<p class="upd-msg">Android demande d’autoriser Kumm à installer des applications : activez « Autoriser depuis cette source », puis revenez ici et relancez le téléchargement si vous souhaitez continuer.</p>`;
    if (p.phase === "error") status = `<p class="upd-msg upd-err" role="alert">${escText(p.err ?? "Le téléchargement a échoué.")} Vérifiez votre connexion et réessayez.</p>`;
    if (p.phase === "launched") status = `<p class="upd-msg">L’installateur d’Android s’est ouvert : touchez « Mettre à jour ». S’il a été fermé ou affiche « Application non installée », relancez l’installation ci-dessous.</p>`;
    const label = p.phase === "error" ? "Réessayer" : p.phase === "launched" ? "Relancer l’installation" : "Télécharger et installer";
    actions = web
      ? `<button class="onb-main" data-upd="reload">Recharger</button>`
      : `${p.rel ? `<button class="onb-main" data-upd="go">${label}</button>` : ""}<button class="onb-sec" data-upd="later">Plus tard</button><button class="onb-sec" data-upd="ignore">Ignorer cette version</button>
        ${p.phase === "launched" || p.phase === "error" ? `<a class="upd-alt" href="https://github.com/Qoats/Kumm/releases" target="_blank" rel="noopener">Télécharger l’APK avec le navigateur</a>` : ""}`;
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
