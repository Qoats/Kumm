// police de l'interface, servie par Kumm lui-même (pas de requête vers Google Fonts : l'adresse IP des visiteurs reste privée)
import "@fontsource/plus-jakarta-sans/latin-400.css";
import "@fontsource/plus-jakarta-sans/latin-ext-400.css";
import "@fontsource/plus-jakarta-sans/latin-500.css";
import "@fontsource/plus-jakarta-sans/latin-ext-500.css";
import "@fontsource/plus-jakarta-sans/latin-600.css";
import "@fontsource/plus-jakarta-sans/latin-ext-600.css";
import "@fontsource/plus-jakarta-sans/latin-700.css";
import "@fontsource/plus-jakarta-sans/latin-ext-700.css";
import "@fontsource/plus-jakarta-sans/latin-800.css";
import "@fontsource/plus-jakarta-sans/latin-ext-800.css";
import "./style.css";
import { CONFIG, VERSION, url } from "./config";
import { COLORS, LINE_MODES, LINE_NAMES, MESSAGES, TEXT_COLORS, MOCK_MESSAGES, MSG_STATE, isHub, isTram, kindOfStop, lineKind, lineLabel } from "./data";
import { ic, type IconName } from "./icons";
import { loadLineInfo, loadMessages, loadPois, loadQuayModes, loadStops, nextDepartures, placeOnTramQuays } from "./api";
import { KINDS } from "./kinds";
import type { Layer } from "./kinds";
import { POIS, S, STOPS, USER, hooks, project, render, stopById, toast, toggleFav } from "./store";
import type { Filter, Tab } from "./store";
import {
  debugBox, depCards, pickDir, stopNotice, stopTabs, header, layerCounts, overlayFavs, overlayLine, overlayMsgs, overlayPoi, overlaySettings, overlayVehicle, overlayStop, screenBuy, screenHome,
  screenLines, screenNearby, screenSearch, screenTrips, tripsDemo, whenSheet
} from "./views";
import { cmpVersion, esc } from "./util";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { stopNav } from "./nav";
import { DEFAULT_PREFS, applyTheme, savePrefs } from "./themes";
import type { Accent, Theme } from "./themes";
import type { Place, Poi, StopDeparture } from "../../shared/types";
import { buildVeloparks } from "./places";
import { geocode } from "./walk";
import { bikeToPoi, launchNav, walkToPoi } from "./flow";
import { BIKE_ROUTES, PLAN, ensurePlanned } from "./trip";
import { mountTripMap } from "./tripmap";
import { startNav } from "./nav";
import { mountLiveMap, recenter, refreshMarkers, zoomBy } from "./livemap";
import { CAN_UPDATE, checkUpdate, installUpdate, updateView } from "./update";
import { forgetScroll, restoreScroll, saveScroll } from "./scroll";
import { acceptTerms, allSteps, onboardingDone, onboardingSteps, onboardingView } from "./onboarding";
import type { Release } from "./update";
import { NATIVE, PUSH_READY, askPermission, checkAlerts, followed, onAlertTap, saveAlerts, syncAlerts } from "./alerts";

const app = document.getElementById("app") as HTMLElement;

const NAV: [Tab, string, IconName][] = [
  ["home", "Accueil", "home"], ["search", "Recherche", "search"], ["nearby", "A Proximité", "pin"], ["trips", "Itinéraires", "route"], ["buy", "Billets", "ticket"]
];

/* ============ RENDU ============ */
let lastTab: Tab | null = null;
let lastOverlay = "";

let lastScreen = "";

let lastPage = "";

function draw(): void {
  // pages plein écran (mise à jour obligatoire, puis présentation du premier lancement) : rien n'est dessiné derrière,
  // et la page n'est redessinée que si elle change (pas de clignotement entre deux étapes)
  const page = S.upd ? updateView(S.upd, VERSION) : S.onb ? onboardingView(S.onb.steps, S.onb.i, S.onb.refused) : "";
  if (page) {
    if (page !== lastPage) { app.innerHTML = page; lastPage = page; }
    return;
  }
  lastPage = "";
  const t = S.tab;
  let body: string;
  if (t === "home") body = header() + `<main>${screenHome()}</main>`;
  else if (t === "search") body = `<main>${screenSearch()}</main>`;
  else if (t === "lines") body = `<main>${screenLines()}</main>`;
  else if (t === "nearby") body = `<main>${screenNearby()}</main>`;
  else if (t === "trips") body = `<main>${screenTrips()}</main>`;
  else body = `<main>${screenBuy()}</main>`;

  const o = S.overlay;
  const ov = !o ? "" : o.k === "line" ? overlayLine(o.id) : o.k === "stop" ? overlayStop(o.id) : o.k === "poi" ? overlayPoi(o.id) : o.k === "veh" ? overlayVehicle(o.id) : o.k === "settings" ? overlaySettings() : o.k === "msgs" ? overlayMsgs() : overlayFavs();

  // positions de défilement de toutes les zones (listes, fiches, rangées de catégories…), par écran : voir scroll.ts
  const screen = o ? `${t}|${o.k}:${"id" in o ? String(o.id) : ""}` : t;
  saveScroll(app, lastScreen);
  if (lastScreen !== screen && lastScreen.includes("|")) forgetScroll(lastScreen);   // fiche fermée : repartira du haut
  lastScreen = screen;
  const active = document.activeElement as HTMLInputElement | null;
  const act = active?.id, pos = active?.selectionStart ?? null;

  app.innerHTML = body + ov +
    `<nav>${NAV.map(n => `<button data-tab="${n[0]}" class="${t === n[0] || (n[0] === "search" && t === "lines") ? "on" : ""}"><span class="ni">${ic(n[2])}</span>${n[1]}</button>`).join("")}</nav>` +
    whenSheet() +
    (S.modal ? `<div class="modal"><div class="dlg"><h4>${S.modal.t}</h4><p>${S.modal.p}</p><div class="bt">${S.modal.b.map((b, i) => `<button data-mb="${i}">${b}</button>`).join("")}</div></div></div>` : "") +
    (S.toast ? `<div class="toast">${esc(S.toast)}</div>` : "");

  if (act) {
    const el = document.getElementById(act) as HTMLInputElement | null;
    if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* champ sans sélection */ } }
  }
  // petite animation à l'ouverture d'un écran ou d'une fiche (pas à chaque mise à jour)
  if (t !== lastTab) { document.querySelector("#app > main")?.classList.add("enter"); lastTab = t; }
  const okey = o ? JSON.stringify(o) : "";
  if (okey !== lastOverlay) { if (o) document.querySelector(".overlay")?.classList.add("enter"); lastOverlay = okey; }
  const slot = document.getElementById("livemap-slot");
  if (slot) mountLiveMap(slot);
  const tslot = document.getElementById("tripmap-slot");
  if (tslot) mountTripMap(tslot);
  restoreSlots();
  // après restoreSlots : les listes chargées à part ont retrouvé leur contenu, donc leur hauteur
  restoreScroll(app, screen);
  void loadDeps();
}
hooks.render = draw;

/* ============ CHARGEMENT DES PASSAGES ============ */
/* Les passages déjà chargés sont gardés d'un affichage à l'autre : l'écran se redessine souvent (filtre, fiche…),
   et sans cela les cartes disparaîtraient le temps de les recharger. Elles sont ensuite mises à jour discrètement. */
const slotCache = new Map<string, string>();
const slotKey = (id: string): string =>
  id === "nearlist" ? `nearlist|${S.filter}`
  : id === "stopdeps" ? `stopdeps|${S.overlay?.k === "stop" ? S.overlay.id : ""}`
  : id === "trips" ? `trips|${S.trip.mode}|${S.trip.dest?.label ?? ""}|${S.trip.fromIsMe ? "me" : S.trip.from?.label ?? ""}`
  : id;
/** Remplit une zone avec un résultat arrivé après une attente : ignoré si l'écran a changé entre-temps
   (autre arrêt, autre mode…), sinon un ancien résultat s'afficherait au mauvais endroit */
async function fillSlot(id: string, load: () => Promise<string>): Promise<void> {
  const key = slotKey(id);
  const html = await load();
  if (slotKey(id) !== key) return;
  slotCache.set(key, html);
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
function restoreSlots(): void {
  document.querySelectorAll<HTMLElement>("#nearlist,#stopdeps,#trips,[id^=fav-]").forEach(el => {
    const html = slotCache.get(slotKey(el.id));
    if (html && (!el.innerHTML || el.id === "trips")) el.innerHTML = html;
  });
}

const sortByTime = (a: StopDeparture, b: StopDeparture): number => a.d.times[0] - b.d.times[0];
const matchesFilter = (s: { name: string }): boolean =>
  S.filter === "all" || isHub(s) || (S.filter === "tram" ? kindOfStop(s) === "tram" : kindOfStop(s) === "bus");

async function loadDeps(): Promise<void> {
  try {
    if (S.tab === "nearby" && !S.overlay) {
      // les 12 arrêts les plus proches sont interrogés, et les 4 plus proches qui ont encore des passages sont affichés :
      // le soir, l'arrêt de bus le plus proche n'a souvent plus rien, alors qu'un tram passe un peu plus loin
      const near = STOPS.filter(s => matchesFilter(s))
        .sort((a, b) => Math.hypot(a.x - 170, a.y - 222) - Math.hypot(b.x - 170, b.y - 222)).slice(0, 12);
      const filter = S.filter;
      await fillSlot("nearlist", async () => {
        const res = await Promise.all(near.map(s => nextDepartures(s).then(ds => ds.map(d => ({ stop: s, d }))).catch(() => null)));
        // aucun arrêt n'a pu être interrogé : on garde la liste affichée (voir le catch de loadDeps)
        if (res.every(r => r === null)) throw new Error("Serveur Kumm injoignable");
        const all: StopDeparture[] = [];
        let stops = 0;
        for (const rows of res) {   // dans l'ordre de distance
          if (!rows) continue;
          // les 2 premières lignes de chaque arrêt, avec toutes leurs directions (choisies dans la tuile)
          const now = Date.now();
          const kept = rows.filter(({ d }) => (filter === "all" || (filter === "tram") === isTram(d.line)) && d.times.some(t => t > now - 30000)).sort(sortByTime);
          if (!kept.length) continue;
          const lines = [...new Set(kept.map(r => r.d.line))].slice(0, 2);
          kept.filter(r => lines.includes(r.d.line)).forEach(r => all.push(r));
          if (++stops >= 4) break;
        }
        return depCards(all);
      });
    }
    if (S.tab === "home") {
      for (const id of S.fav) {
        const s = stopById(id);
        if (!s || !document.getElementById("fav-" + id)) continue;
        await fillSlot("fav-" + id, async () => depCards((await nextDepartures(s)).map(d => ({ stop: s, d })).sort(sortByTime), 2));
      }
    }
    if (S.overlay?.k === "stop") {
      const s = stopById(S.overlay.id);
      if (s && document.getElementById("stopdeps")) {
        await fillSlot("stopdeps", async () => {
          const all = (await nextDepartures(s)).map(d => ({ stop: s, d })).sort(sortByTime);
          // arrêt desservi par plusieurs modes (Gare Centrale, Homme de Fer…) : onglets Tous / Tram / Bus
          const modes = (["tram", "bus", "ter"] as const).filter(m => all.some(x => lineKind(x.d.line) === m));
          const cur = S.overlay?.k === "stop" && S.overlay.mode && modes.includes(S.overlay.mode) ? S.overlay.mode : null;
          const tabs = modes.length > 1 ? stopTabs(modes, cur) : "";
          const h = tabs + depCards(cur ? all.filter(x => lineKind(x.d.line) === cur) : all);
          // sans passage : souvent un arrêt non desservi (travaux, déviation) ; l'info trafic l'explique mieux que les détails techniques
          return stopNotice(s.name) + (h.includes('class="dep"') ? h : h + debugBox());
        });
      }
    }
    if (S.tab === "trips") {
      if (CONFIG.USE_MOCK) { if (document.getElementById("trips")) await fillSlot("trips", async () => tripsDemo()); }
      else ensurePlanned();   // calcule une seule fois par trajet ; chaque mode s'affiche dès qu'il arrive
    }
  } catch (e) {
    console.error(e);
    // serveur momentanément injoignable (mise à jour, réseau) : les derniers horaires restent affichés, avec un avertissement ;
    // la liste se remet à jour toute seule à la réponse suivante (toutes les 30 s)
    for (const el of document.querySelectorAll<HTMLElement>("#stopdeps, #nearlist, [id^=fav-]")) {
      if (el.querySelector(".dep")) {
        if (!el.querySelector(".stalenote")) el.insertAdjacentHTML("afterbegin", '<div class="stalenote">Connexion perdue : derniers horaires connus</div>');
      } else if (el.id !== "nearlist" || !el.innerHTML.trim() || el.querySelector(".empty")) {
        el.innerHTML = '<div class="empty" style="padding:24px">Horaires indisponibles pour le moment : nouvel essai dans quelques secondes.</div>';
      }
    }
  }
}

/* ============ ÉVÉNEMENTS ============ */
const CLICKABLE = "[data-tab],[data-act],[data-line],[data-stop],[data-f],[data-fav],[data-more],[data-mb],[data-sg],[data-nav],[data-layer],[data-poi],[data-poinav],[data-poibike],[data-poitrip],[data-bikenav],[data-mode],[data-smode],[data-dirk],[data-onb],[data-upd],[data-sel],[data-alerts],[data-aline],[data-wk],[data-wq],[data-theme-pick],[data-accent-pick],[data-darkmap],[data-reset]";

app.addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(CLICKABLE);
  // ne jamais remonter hors de l'application : la page elle-même porte des attributs de thème (data-darkmap…)
  if (!b || !app.contains(b)) return;
  const d = b.dataset;
  if (d.onb) { void onboardingAction(d.onb); return; }
  if (d.upd) { updateAction(d.upd); return; }
  if (d.dirk !== undefined && d.dirv !== undefined) { pickDir(d.dirk, d.dirv); render(); return; }   // direction d'une ligne, sans ouvrir l'arrêt
  if (d.mb !== undefined) { const m = S.modal; S.modal = null; if (d.mb === "1" && m?.go) m.go(); render(); return; }
  if (d.tab) {
    S.tab = d.tab as Tab; S.overlay = null; S.follow = null;
    render(); return;
  }
  if (d.sg) {
    const sg = S.trip.sugg, field = sg?.field ?? "to";
    if (d.sg === "me") { S.trip.fromIsMe = true; S.trip.from = null; S.trip.fromText = "Ma position"; }
    else {
      const p = sg?.items[Number(d.sg)];
      if (p && field === "from") { S.trip.from = p; S.trip.fromIsMe = false; S.trip.fromText = p.label; }
      else if (p) { S.trip.dest = p; S.trip.toText = p.label; }
    }
    S.trip.sugg = null; render(); return;
  }
  if (d.nav) { void launchNav(d.nav); return; }
  if (d.bikenav) {
    const r = BIKE_ROUTES[Number(d.bikenav)];
    if (r && PLAN?.dest) startNav({ title: `À vélo vers ${PLAN.dest.label}`, route: { distance: r.distance, duration: r.duration, coords: r.coords, steps: r.steps, mode: "bike" }, dest: PLAN.dest });
    return;
  }
  if (d.smode !== undefined) { if (S.overlay?.k === "stop") { S.overlay = { ...S.overlay, mode: (d.smode || undefined) as "tram" | "bus" | "ter" | undefined }; } render(); return; }
  if (d.mode) { if (S.trip.mode !== d.mode) S.trip.sel = 0; S.trip.mode = d.mode as "walk" | "bike" | "transit"; render(); return; }
  if (d.sel !== undefined) { S.trip.sel = Number(d.sel); render(); return; }
  if (d.alerts) { void changeAlerts(d.alerts); return; }
  if (d.aline) {
    const a = S.alerts;
    if (d.aline === "*") a.lines = a.lines.includes("*") ? [] : ["*"];
    else { const l = a.lines.filter(x => x !== "*"); a.lines = l.includes(d.aline) ? l.filter(x => x !== d.aline) : [...l, d.aline]; }
    saveAlerts(a); render();
    if (a.enabled) syncAlerts(a).catch(e => toast(e instanceof Error ? e.message : "Alertes indisponibles"));
    return;
  }
  if (d.wk && S.trip.whenDraft) {
    const w = S.trip.whenDraft;
    w.kind = d.wk as typeof w.kind;
    // par défaut : les 5 prochaines minutes rondes (ex. 17h02 → 17h05)
    if (w.kind !== "now" && w.at < Date.now()) w.at = Math.ceil(Date.now() / 300_000) * 300_000;
    render(); return;
  }
  if (d.wq && S.trip.whenDraft) {
    const w = S.trip.whenDraft, base = Math.max(w.at, Date.now());
    if (d.wq === "t8") { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(8, 0, 0, 0); w.at = t.getTime(); }
    else w.at = base + Number(d.wq) * 60_000;
    render(); return;
  }
  if (d.poibike) { void bikeToPoi(d.poibike); return; }
  if (d.poitrip) {
    const p = POIS.find(x => x.id === d.poitrip);
    if (p) {
      S.trip.dest = { label: p.name, lat: p.lat, lon: p.lon };
      S.trip.toText = p.name;
      S.trip.mode = "transit";
      S.overlay = null;
      S.tab = "trips";
      render();
    }
    return;
  }
  if (d.themePick || d.accentPick || d.darkmap || d.reset) {
    if (d.themePick) S.prefs.theme = d.themePick as Theme;
    if (d.accentPick) S.prefs.accent = d.accentPick as Accent;
    if (d.darkmap) S.prefs.darkMap = !S.prefs.darkMap;
    if (d.reset) S.prefs = { ...DEFAULT_PREFS };
    savePrefs(S.prefs); applyTheme(S.prefs); render(); return;
  }
  if (d.layer) {
    const k = d.layer as Layer;
    if (!CONFIG.USE_MOCK && layerCounts()[k] === 0) { toast(`Pas encore de données pour « ${KINDS[k].label} »`); return; }
    S.layers[k] = !S.layers[k]; render(); return;
  }
  if (d.poi) { S.overlay = { k: "poi", id: d.poi }; render(); return; }
  if (d.poinav) { void walkToPoi(d.poinav); return; }
  if (d.line) { S.overlay = { k: "line", id: d.line }; render(); return; }
  if (d.stop) { S.overlay = { k: "stop", id: d.stop }; render(); return; }
  if (d.f) { S.filter = d.f as Filter; render(); return; }
  if (d.fav) { toggleFav(d.fav); return; }
  if (d.more) { toast(d.more + " : bientôt disponible"); return; }
  switch (d.act) {
    case "closeOverlay": S.overlay = null; break;
    case "tabHome": S.tab = S.tab === "lines" ? "search" : "home"; break;
    case "swap": swapTrip(); break;
    case "when": S.trip.whenDraft = { ...S.trip.when, at: S.trip.when.at || Math.ceil(Date.now() / 300_000) * 300_000 }; break;
    case "whenClose": S.trip.whenDraft = null; break;
    case "whenOk": if (S.trip.whenDraft) S.trip.when = S.trip.whenDraft; S.trip.whenDraft = null; S.trip.sel = 0; break;
    case "sheet": if (S.swiped) return; S.sheet = S.sheet === 0 ? 1 : S.sheet === 2 ? 1 : 0; break;
    case "msgs": S.overlay = { k: "msgs" }; break;
    case "favs": S.overlay = { k: "favs" }; break;
    case "locate": recenter(); toast("Position centrée"); return;
    case "zoomIn": zoomBy(1); return;
    case "zoomOut": zoomBy(-1); return;
    case "account": toast("Mon compte : bientôt disponible"); return;
    case "prefs": S.overlay = { k: "settings" }; break;
    case "checkUpdate": void offerUpdate(true); return;
    case "unfollow": S.follow = null; break;
    case "refollow": if (S.follow) S.follow.paused = false; break;
    case "replayOnb": S.overlay = null; S.onb = { steps: allSteps(), i: 0, refused: false }; break;
  }
  render();
});

/** Alertes trafic : activation (avec l'autorisation du téléphone), désactivation, travaux */
async function changeAlerts(what: string): Promise<void> {
  const a = S.alerts;
  const apply = async (seen?: string[]): Promise<boolean> => {
    try { await syncAlerts(a, seen); return true; }
    catch (e) { toast(e instanceof Error ? e.message : "Alertes indisponibles pour le moment"); return false; }
  };
  if (what === "works") { a.works = !a.works; saveAlerts(a); await apply(); render(); return; }
  if (a.enabled) { a.enabled = false; saveAlerts(a); await apply(); render(); toast("Alertes trafic désactivées"); return; }
  if (NATIVE && !PUSH_READY) { toast("Alertes indisponibles dans cette version de l'application"); return; }
  if (!(await askPermission())) { toast("Notifications refusées : autorisez-les pour Kumm dans les réglages du téléphone"); return; }
  if (!a.lines.length) {
    // par défaut : les lignes des arrêts favoris, sinon les trams
    const fromFavs = [...new Set(S.fav.map(stopById).flatMap(s => s?.lines ?? []).map(l => lineLabel(l)))];
    a.lines = fromFavs.length ? fromFavs : ["A", "B", "C", "D", "E", "F"];
  }
  a.enabled = true;
  toast("Activation des alertes…");
  // les perturbations déjà en cours ne sont pas annoncées : seulement les nouvelles
  if (!(await apply(MESSAGES.map(m => m.id)))) { a.enabled = false; render(); return; }
  saveAlerts(a);
  render();
  const now = MESSAGES.filter(m => followed(m, a)).length;
  toast(now ? `Alertes activées · ${now} perturbation${now > 1 ? "s" : ""} déjà en cours sur vos lignes` : "Alertes activées");
}

/* ---------- mises à jour de l'application (Android) : vérifiées au lancement, installées depuis l'application ---------- */
let waitingPermission: Release | null = null;

async function offerUpdate(manual: boolean): Promise<void> {
  if (!CAN_UPDATE) { if (manual) toast("Mises à jour automatiques disponibles dans l'application Android"); return; }
  let rel: Release | null | "unpublished";
  try { rel = await checkUpdate(); } catch { if (manual) toast("Impossible de vérifier les mises à jour pour le moment"); return; }
  if (rel === "unpublished") { if (manual) toast(`Version ${VERSION} · aucune mise à jour n'est encore proposée par le serveur`); return; }
  if (!rel) { if (manual) toast(`Kumm est à jour (version ${VERSION})`); return; }
  // une version plus récente existe : l'application n'est plus utilisable tant qu'elle n'est pas installée
  S.upd = { rel, phase: "ready", pct: 0 };
  render();
}

async function startUpdate(rel: Release): Promise<void> {
  if (S.upd?.phase === "down") return;
  S.upd = { rel, phase: "down", pct: 0 }; render();
  try {
    const r = await installUpdate(rel, pct => { if (S.upd && pct !== S.upd.pct) { S.upd.pct = pct; render(); } });
    if (r === "permission") {
      // Android ouvre son réglage ; au retour dans Kumm, l'installation reprend toute seule
      waitingPermission = rel;
      S.upd = { rel, phase: "perm", pct: 0 };
    } else {
      // l'installateur d'Android est ouvert ; si on l'annule ou s'il échoue, la page propose de le relancer
      S.upd = { rel, phase: "launched", pct: 0 };
    }
    render();
  } catch (e) {
    S.upd = { rel, phase: "error", pct: 0, err: e instanceof Error && e.message ? e.message : undefined }; render();
  }
}

function updateAction(a: string): void {
  if (a === "go" && S.upd?.rel) void startUpdate(S.upd.rel);
  else if (a === "quit") void CapApp.exitApp();
  else if (a === "reload") location.reload();
}

/* ---------- présentation du premier lancement ---------- */
async function onboardingAction(a: string): Promise<void> {
  const o = S.onb;
  if (!o) return;
  const next = (): void => { if (o.i < o.steps.length - 1) o.i++; render(); };
  if (a === "next") return next();
  if (a === "back") { if (o.i > 0) o.i--; o.refused = false; return render(); }
  // autorisations : la demande part, et on passe tout de suite à l'étape suivante. Sans attendre la réponse : une première
  // position GPS ou l'inscription aux notifications peuvent prendre plusieurs secondes, et l'écran semblait bloqué.
  if (a === "loc") {
    navigator.geolocation?.getCurrentPosition(setUserPosition, () => { /* refusée : la carte reste centrée sur Strasbourg */ }, { timeout: 20000, maximumAge: 60000 });
    return next();
  }
  if (a === "alerts") {
    if (!S.alerts.enabled) void changeAlerts("toggle");
    return next();
  }
  if (a === "accept") { acceptTerms(); S.onb = null; locateIfAllowed(); return render(); }
  if (a === "refuse") {
    if (NATIVE) return void CapApp.exitApp();
    o.refused = true; render();
  }
}

/** Position du téléphone : arrêts proches, « Ma position » */
function setUserPosition(p: GeolocationPosition): void {
  USER.lat = p.coords.latitude; USER.lon = p.coords.longitude;
  STOPS.forEach(project); POIS.forEach(project); S.locOn = true; render();
}
/** Au démarrage : position demandée seulement après la présentation (où son usage est expliqué) */
function locateIfAllowed(): void {
  if (!onboardingDone()) return;
  navigator.geolocation?.getCurrentPosition(setUserPosition, () => { /* position refusée : on garde Homme de Fer */ });
}

/** ⇅ : la destination devient le départ et inversement (« Ma position » passe en destination) */
function swapTrip(): void {
  const t = S.trip;
  if (!t.dest) return;
  const oldFrom = t.fromIsMe ? null : t.from, oldDest = t.dest;
  t.from = oldDest; t.fromIsMe = false; t.fromText = oldDest.label;
  t.dest = oldFrom ?? { label: "Ma position", lat: USER.lat, lon: USER.lon };
  t.toText = t.dest.label;
  t.sugg = null;
}

/* suggestions : arrêts connus tout de suite, adresses un instant plus tard */
let sgTimer = 0;
const textOf = (f: "from" | "to"): string => (f === "from" ? S.trip.fromText : S.trip.toText);
function askSuggestions(field: "from" | "to"): void {
  window.clearTimeout(sgTimer);
  const q = textOf(field).trim();
  if (q.length < 2) { S.trip.sugg = null; render(); return; }
  const ql = q.toLowerCase();
  const stops: Place[] = STOPS.filter(s => s.name.toLowerCase().includes(ql)).slice(0, 4).map(s => ({ label: s.name, lat: s.lat, lon: s.lon, stop: s }));
  S.trip.sugg = { field, items: stops };
  render();
  sgTimer = window.setTimeout(() => {
    geocode(q).then(addr => {
      if (S.trip.sugg?.field === field && textOf(field).trim() === q) { S.trip.sugg.items = [...stops, ...addr]; render(); }
    }).catch(() => { /* adresses indisponibles : on garde les arrêts */ });
  }, 300);
}

app.addEventListener("input", e => {
  const t = e.target as HTMLInputElement;
  if (t.id === "sq") { S.q = t.value; render(); }
  if (t.id === "tto" || t.id === "tfrom") {
    if (CONFIG.USE_MOCK) {
      if (t.id !== "tto") return;
      S.trip.toText = t.value;
      const tr = document.getElementById("trips");
      if (S.trip.toText.trim().length > 1) { if (!tr) render(); else tr.innerHTML = tripsDemo(); } else render();
      return;
    }
    if (t.id === "tto") { S.trip.toText = t.value; S.trip.dest = null; askSuggestions("to"); }
    else { S.trip.fromText = t.value; S.trip.fromIsMe = false; S.trip.from = null; askSuggestions("from"); }
  }
});

/* heure du trajet : champs date et heure du panneau (le choix n'est appliqué qu'avec « Valider ») */
app.addEventListener("change", e => {
  const t = e.target as HTMLInputElement, w = S.trip.whenDraft;
  if (!w || (t.id !== "wdate" && t.id !== "wtime")) return;
  const date = (document.getElementById("wdate") as HTMLInputElement | null)?.value, time = (document.getElementById("wtime") as HTMLInputElement | null)?.value;
  const ms = date && time ? new Date(`${date}T${time}`).getTime() : NaN;
  if (!Number.isNaN(ms)) { w.at = ms; render(); }
});

app.addEventListener("focusin", e => {
  const t = e.target as HTMLInputElement;
  if (t.id === "hq") {
    t.blur(); S.tab = "trips"; S.overlay = null; render();
    setTimeout(() => document.getElementById("tto")?.focus(), 50);
  }
  if (t.id === "tfrom" && S.trip.fromIsMe) t.select();
});

/* glisser le panneau « À proximité » vers le haut ou le bas */
let y0: number | null = null;
app.addEventListener("pointerdown", e => { y0 = (e.target as HTMLElement).closest(".sheet .grab,.sheet h3") ? e.clientY : null; });
app.addEventListener("pointerup", e => {
  if (y0 === null) return;
  const dy = e.clientY - y0;
  y0 = null;
  if (Math.abs(dy) > 24) { S.sheet = (dy < 0 ? Math.min(2, S.sheet + 1) : Math.max(0, S.sheet - 1)) as 0 | 1 | 2; S.swiped = true; setTimeout(() => { S.swiped = false; }, 300); render(); }
});

setInterval(() => { if (!document.hidden && document.activeElement?.tagName !== "INPUT") void loadDeps(); }, 30000);

/* ============ DONNÉES RÉELLES ============ */
let remotePois: Poi[] = [];

/** Catégories de la carte : Vélhop et parkings relais (sources ouvertes) + Véloparks placés sur les arrêts de la CTS */
function rebuildPois(): void {
  POIS.length = 0;
  [...remotePois, ...buildVeloparks(STOPS)].forEach(p => POIS.push(project(p)));
}

/** Infos trafic de la CTS : au démarrage puis toutes les 5 minutes ; en cas d'échec on garde les dernières connues */
async function refreshMessages(): Promise<void> {
  try {
    const list = await loadMessages();
    MESSAGES.length = 0; MESSAGES.push(...list);
    MSG_STATE.status = "ok";
    checkAlerts(S.alerts, MESSAGES);
    render();
  } catch (e) {
    console.warn("Infos trafic indisponibles :", e);
    if (MSG_STATE.status === "loading") { MSG_STATE.status = "error"; render(); }
  }
}

/* Mode de chaque quai (tram / bus) : les stations de tram sont placées sur leurs quais de tram (gardé sur le téléphone) */
let quayModes: Record<string, string> = {};
try { quayModes = JSON.parse(localStorage.getItem("quayModes") ?? "{}") as Record<string, string>; } catch { /* rien */ }
function applyQuayModes(): void {
  if (!placeOnTramQuays(STOPS, quayModes)) return;
  STOPS.forEach(project); rebuildPois(); refreshMarkers(); render();
}

async function initReal(): Promise<void> {
  // alertes : réglages renvoyés au programme d'arrière-plan à chaque démarrage ; toucher une notification ouvre les infos trafic
  if (S.alerts.enabled) syncAlerts(S.alerts).catch(e => console.warn("Alertes trafic :", e));
  onAlertTap(() => { S.overlay = { k: "msgs" }; render(); });
  void refreshMessages();
  setInterval(() => { if (!document.hidden) void refreshMessages(); }, 5 * 60_000);
  // modes des lignes (tram / bus / TER) : améliore le classement des arrêts dès qu'ils arrivent
  void loadLineInfo().then(info => { Object.assign(LINE_MODES, info.modes); Object.assign(LINE_NAMES, info.names); Object.assign(COLORS, info.colors); Object.assign(TEXT_COLORS, info.text); render(); }).catch(e => console.warn("lines-discovery indisponible :", e));
  // 1) démarrage instantané avec la liste d'arrêts gardée sur le téléphone (7 jours)
  try {
    const c = JSON.parse(localStorage.getItem("stopsCache2") ?? "null") as { t: number; list: typeof STOPS } | null;
    if (c && Date.now() - c.t < 7 * 864e5) { STOPS.length = 0; c.list.forEach(s => STOPS.push(project(s))); applyQuayModes(); render(); }
  } catch { /* pas de cache */ }
  // 2) mise à jour depuis l'API
  try {
    const list = await loadStops();
    STOPS.length = 0; list.forEach(s => STOPS.push(project(s)));
    placeOnTramQuays(STOPS, quayModes); STOPS.forEach(project);
    rebuildPois();
    try { localStorage.setItem("stopsCache2", JSON.stringify({ t: Date.now(), list })); } catch { /* ignoré */ }
    render();
  } catch (e) {
    console.error(e);
    if (!STOPS.length) toast("Connexion à l’API CTS impossible");
  }
  // modes des quais à jour (le serveur les connaît dès sa première photo du réseau)
  void loadQuayModes().then(m => {
    if (!Object.keys(m).length) return;
    quayModes = m;
    try { localStorage.setItem("quayModes", JSON.stringify(m)); } catch { /* ignoré */ }
    applyQuayModes();
  }).catch(() => { /* on garde les positions connues */ });
  // points d'intérêt (P+R, Vélopark…) : chargés à part, une panne ne bloque rien
  void loadPois().then(list => { remotePois = list; rebuildPois(); render(); });
  locateIfAllowed();
}

/* Le serveur peut exiger une version minimale de l'application (après une évolution incompatible) */
async function checkVersion(): Promise<void> {
  try {
    const r = await fetch(url("/health"));
    if (!r.ok) return;
    const j = (await r.json()) as { minApp?: string };
    if (j.minApp && cmpVersion(VERSION, j.minApp) < 0) {
      // version trop ancienne pour le serveur : page de mise à jour, avec l'APK à télécharger s'il est publié
      const rel = CAN_UPDATE ? await checkUpdate().catch(() => null) : null;
      S.upd = { rel: rel && rel !== "unpublished" ? rel : null, phase: "ready", pct: 0 };
      render();
    }
  } catch { /* serveur injoignable : les écrans l'indiquent déjà */ }
}
if (!CONFIG.USE_MOCK) void checkVersion();
// nouvelle version de l'application : proposée quelques secondes après le lancement (sans gêner l'affichage des horaires)
if (!CONFIG.USE_MOCK && CAN_UPDATE) {
  setTimeout(() => { if (!S.upd) void offerUpdate(false); }, 2500);
  void CapApp.addListener("resume", () => {
    if (!waitingPermission) return;
    const rel = waitingPermission; waitingPermission = null;
    void startUpdate(rel);
  });
}

/* Perte et retour de la connexion du téléphone */
window.addEventListener("offline", () => toast("Vous êtes hors ligne"));
window.addEventListener("online", () => { toast("Connexion rétablie"); void loadDeps(); });

/* Android : le bouton « retour » ferme d'abord le guidage, une fenêtre ou une fiche, puis revient à l'accueil, puis quitte */
if (Capacitor.isNativePlatform()) {
  void CapApp.addListener("backButton", () => {
    if (S.upd) void CapApp.exitApp();   // application à mettre à jour : « retour » quitte
    else if (S.onb) { if (S.onb.i > 0) { S.onb.i--; render(); } }
    else if (document.getElementById("navlayer")) stopNav();
    else if (S.modal) { S.modal = null; render(); }
    else if (S.trip.whenDraft) { S.trip.whenDraft = null; render(); }
    else if (S.overlay) { S.overlay = null; render(); }
    else if (S.follow) { S.follow = null; render(); }   // arrête de suivre le véhicule
    else if (S.tab !== "home") { S.tab = "home"; render(); }
    else void CapApp.exitApp();
  });
}

/* thème : appliqué au démarrage, et mis à jour si le téléphone change de mode (clair/sombre) en mode automatique */
applyTheme(S.prefs);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (S.prefs.theme === "auto") applyTheme(S.prefs); });

/* pour inspecter les données dans la console du navigateur : __kumm.STOPS, __kumm.LINE_MODES */
(window as unknown as { __kumm: unknown }).__kumm = { STOPS, POIS, LINE_MODES, LINE_NAMES, kindOfStop, S, render };

// premier lancement (ou conditions modifiées) : présentation avant tout le reste
{ const steps = onboardingSteps(); if (steps.length) S.onb = { steps, i: 0, refused: false }; }

if (CONFIG.USE_MOCK) { MESSAGES.push(...MOCK_MESSAGES); MSG_STATE.status = "ok"; }
else void initReal();
render();
