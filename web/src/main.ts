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
// forme « Papier » : jeux complets (chaque fichier ne se charge que pour les caractères présents à l'écran)
import "@fontsource/instrument-serif/400.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./style.css";
import { CONFIG, VERSION, url } from "./config";
import { COLORS, DIRS, LINE_MODES, LINE_NAMES, MESSAGES, TEXT_COLORS, MOCK_MESSAGES, MSG_STATE, isHub, isTram, kindOfStop, lineKind, lineLabel } from "./data";
import { ic, type IconName } from "./icons";
import { TRAINS, ensureForecast, ensureReports, sendReport, ensureLineRoute, ensureStats, loadLineInfo, loadMessages, loadPois, loadQuayLines, loadQuayModes, loadStops, nextDepartures, nextTrains, OFFLINE, onOfflineChange, placeOnTramQuays, plannedDepartures } from "./api";
import { fmtDist, haversine } from "./geo";
import { hm } from "./transit";
import { STRASBOURG_VILLE } from "../../shared/ter";
import { KINDS } from "./kinds";
import type { Layer } from "./kinds";
import { POIS, S, STOPS, USER, hooks, project, render, setBikeStation, setPlace, stopById, toast, toggleFav } from "./store";
import type { PlaceKey } from "./store";
import type { Filter, Tab } from "./store";
import {
  overlayAccount, overlayHelp, overlayWidget, debugBox, depCards, pickDir, stopNotice, stopTabs, trainBoard, header, layerCounts, overlayFavs, overlayLine, overlayMsgs, overlayPoi, overlaySettings, overlayLook, overlayStats, overlayNoel, overlayBikePick, overlayPlaceSet, overlayVehicle, overlayStop, screenHome, favRows, departureBoard, contremarqueInfo, arrivalPicker, plannedBoard,
  screenLines, screenNearby, screenSearch, screenTrips, tripsDemo, whenSheet
} from "./views";
import { cmpVersion, esc, fold } from "./util";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { stopNav } from "./nav";
import { DEFAULT_PREFS, applyTheme, savePrefs } from "./themes";
import type { Accent, Theme, Ui } from "./themes";
import type { Place, Poi, StopDeparture } from "../../shared/types";
import { buildVeloparks } from "./places";
import { geocode } from "./walk";
import { launchNav } from "./flow";
import { BIKE_ROUTES, PLAN, ensurePlanned, replan } from "./trip";
import { mountTripMap } from "./tripmap";
import { startNav } from "./nav";
import { refreshVehicles } from "./vehicles";
import { hideSplash } from "./splash";
import { configureWidget, initWidgets, stopConfig, syncWidgets } from "./widgets";
import { followFromSearch, showOnMap, mountLiveMap, recenter, refreshMarkers, zoomBy } from "./livemap";
import { CAN_UPDATE, checkUpdate, installUpdate, updateView } from "./update";
import { forgetScroll, restoreScroll, saveScroll } from "./scroll";
import { stopJourney } from "./journey";
import { answerRide, rideBanner, rideDebug, startRideDetection, stopRideDetection, stopSharing } from "./ride";
import { acceptTerms, allSteps, onboardingDone, onboardingSteps, onboardingView } from "./onboarding";
import type { Release } from "./update";
import { NATIVE, PUSH_READY, addArrival, askPermission, checkAlerts, followed, onAlertTap, removeArrival, saveAlerts, syncAlerts } from "./alerts";

const app = document.getElementById("app") as HTMLElement;

const NAV: [Tab, string, IconName][] = [
  ["home", "Accueil", "home"], ["search", "Recherche", "search"], ["nearby", "Carte", "pin"]
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
  else if (t === "search") body = `<main><h1 class="sr">Recherche</h1>${screenSearch()}</main>`;
  else if (t === "lines") body = `<main><h1 class="sr">Toutes les lignes</h1>${screenLines()}</main>`;
  else if (t === "nearby") body = `<main><h1 class="sr">Carte et arrêts à proximité</h1>${screenNearby()}</main>`;
  else body = `<main><h1 class="sr">Itinéraire</h1>${screenTrips()}</main>`;

  const o = S.overlay;
  const ov0 = !o ? "" : o.k === "line" ? overlayLine(o.id) : o.k === "stop" ? overlayStop(o.id) : o.k === "poi" ? overlayPoi(o.id) : o.k === "veh" ? overlayVehicle(o.id) : o.k === "settings" ? overlaySettings() : o.k === "look" ? overlayLook() : o.k === "stats" ? overlayStats() : o.k === "noel" ? overlayNoel() : o.k === "bikepick" ? overlayBikePick() : o.k === "placeset" ? overlayPlaceSet(o.which) : o.k === "msgs" ? overlayMsgs() : o.k === "account" ? overlayAccount() : o.k === "help" ? overlayHelp() : o.k === "widget" ? overlayWidget() : overlayFavs();

  // fiche ouverte : c'est une fenêtre (lecteur d'écran) ; l'écran en dessous est mis de côté
  const ov = ov0.replace('<div class="overlay"', '<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="ovtitle"');
  if (o) body = body.replace(/<(main|header)\b/g, '<$1 inert aria-hidden="true"');
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
    (S.arrPick ? arrivalPicker(S.arrPick) : "") +
    (S.journey ? "" : rideBanner()) +
    (S.toast ? `<div class="toast">${esc(S.toast)}</div>` : "") +
    // hors connexion : on affiche les dernières données reçues, en disant de quand elles datent
    (OFFLINE.on || !navigator.onLine ? `<div class="offbar">${ic("clock", 'width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"')}Hors connexion${OFFLINE.at ? ` · horaires de ${hm(OFFLINE.at)}` : ""}</div>` : "");

  if (act) {
    const el = document.getElementById(act) as HTMLInputElement | null;
    if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* champ sans sélection */ } }
  }
  // petite animation à l'ouverture d'un écran ou d'une fiche (pas à chaque mise à jour)
  if (t !== lastTab) { document.querySelector("#app > main")?.classList.add("enter"); lastTab = t; }
  // changer d'onglet dans une fiche (Tous / Tram / Bus / Train) n'est pas l'ouverture d'une nouvelle fiche : pas d'animation
  const okey = o ? `${o.k}:${"id" in o ? o.id : ""}` : "";
  if (okey !== lastOverlay) { if (o) document.querySelector(".overlay")?.classList.add("enter"); lastOverlay = okey; }
  const slot = document.getElementById("livemap-slot");
  if (slot) mountLiveMap(slot);
  const tslot = document.getElementById("tripmap-slot");
  if (tslot) mountTripMap(tslot);
  restoreSlots();
  // accueil : les tuiles de la colonne de droite sont marquées (forme « Papier » : trait vertical entre les deux colonnes)
  app.querySelectorAll<HTMLElement>(".tiles").forEach(g => {
    const mid = g.getBoundingClientRect().left + g.clientWidth / 2;
    g.querySelectorAll<HTMLElement>(":scope > .tile").forEach(t => t.classList.toggle("col2", !t.classList.contains("w") && t.getBoundingClientRect().left > mid));
  });
  // après restoreSlots : les listes chargées à part ont retrouvé leur contenu, donc leur hauteur
  restoreScroll(app, screen);
  void loadDeps();
  if (o?.k === "line") { ensureLineRoute(o.id, render); ensureStats(o.id, render); }
  if (o?.k === "stats") ensureStats("", render);
  if (o?.k === "stop") ensureReports(o.id, render);
  if (o?.k === "noel") for (const p of POIS) if (p.kind === "pr") ensureForecast(p.id, render);
  if (o?.k === "poi" && (o.id.startsWith("velhop-") || o.id.startsWith("pr-"))) ensureForecast(o.id, render);
  syncWidgets();   // n'envoie rien si les données des widgets n'ont pas changé
}
hooks.render = draw;

/* ============ CHARGEMENT DES PASSAGES ============ */
/* Les passages déjà chargés sont gardés d'un affichage à l'autre : l'écran se redessine souvent (filtre, fiche…),
   et sans cela les cartes disparaîtraient le temps de les recharger. Elles sont ensuite mises à jour discrètement. */
const slotCache = new Map<string, string>();
const slotKey = (id: string): string =>
  id === "nearlist" ? `nearlist|${S.filter}`
  : id === "stopdeps" ? `stopdeps|${S.overlay?.k === "stop" ? S.overlay.id + "|" + (S.overlay.at ?? "") : ""}`
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
  if (!el) return;
  // les zones défilantes à l'intérieur (sélecteur de direction…) gardent leur position quand la liste se met à jour
  saveScroll(app, lastScreen);
  el.innerHTML = html;
  restoreScroll(app, lastScreen);
}
function restoreSlots(): void {
  document.querySelectorAll<HTMLElement>("#nearlist,#stopdeps,#trips,[id^=fav-]").forEach(el => {
    const html = slotCache.get(slotKey(el.id));
    if (html && (!el.innerHTML || el.id === "trips")) el.innerHTML = html;
  });
}

const sortByTime = (a: StopDeparture, b: StopDeparture): number => a.d.times[0] - b.d.times[0];
const matchesFilter = (s: { name: string; sncf?: string }): boolean =>
  S.filter === "all" || (S.filter === "ter" ? !!s.sncf : isHub(s) || kindOfStop(s) === S.filter);

/** Un seul chargement des passages à la fois ; un redessin pendant le chargement en relance un seul à la fin */
let depsRunning = false, depsAgain = false;
async function loadDeps(): Promise<void> {
  if (depsRunning) { depsAgain = true; return; }
  depsRunning = true;
  try { await loadDepsNow(); } finally {
    depsRunning = false;
    if (depsAgain) { depsAgain = false; void loadDeps(); }
  }
}

/** Distances au-delà desquelles un arrêt, ou une gare, n'est plus « à proximité » (sauf la gare la plus proche, onglet TER) */
const STOP_NEAR_M = 2000, GARE_NEAR_M = 1500;

async function loadDepsNow(): Promise<void> {
  try {
    if (S.tab === "nearby" && !S.overlay && S.filter === "ter") {
      // gare la plus proche (Strasbourg-Ville comprise, rattachée à Gare Centrale) et ses prochains trains ; d'autres gares
      // seulement si elles sont aussi à moins de 1,5 km (à Sarrebourg : Sarrebourg seule, pas Réding ni Lutzelbourg)
      const gares = STOPS.filter(s => s.sncf).map(s => ({ s, d: haversine(USER, s) })).sort((a, b) => a.d - b.d)
        .filter((g, i) => i === 0 || g.d < GARE_NEAR_M).slice(0, 3);
      await fillSlot("nearlist", async () => {
        const res = await Promise.all(gares.map(({ s }) => nextTrains(s.sncf!).catch(() => null)));
        if (res.every(r => r === null)) throw new Error("Serveur Kumm injoignable");
        return gares.map(({ s, d }, i) => trainBoard(res[i] ?? [], 4, s.sncf === STRASBOURG_VILLE ? "Strasbourg-Ville" : s.name, `Gare · ${fmtDist(d)}`, s.id, s.sncf)).join("");
      });
    } else if (S.tab === "nearby" && !S.overlay) {
      // les 12 arrêts les plus proches sont interrogés, et les 4 plus proches qui ont encore des passages sont affichés :
      // le soir, l'arrêt de bus le plus proche n'a souvent plus rien, alors qu'un tram passe un peu plus loin
      // seulement les arrêts à moins de 2 km, et une gare (sans tram ni bus) à moins de 1,5 km : loin de Strasbourg
      // (Sarrebourg), la liste se remplissait sinon de gares lointaines et d'arrêts CTS à 70 km
      const near = STOPS.map(s => ({ s, d: haversine(USER, s) }))
        .filter(({ s, d }) => matchesFilter(s) && d < STOP_NEAR_M && (!s.sncf || s.lines.some(l => l !== "TER") || d < GARE_NEAR_M))
        .sort((a, b) => a.d - b.d).slice(0, 12).map(x => x.s);
      const filter = S.filter;
      await fillSlot("nearlist", async () => {
        if (!near.length) return `<div class="empty" style="padding:24px">Aucun arrêt ${filter === "all" ? "ni gare " : ""}à moins de 2 km.${filter === "all" ? " Les gares plus lointaines sont dans l’onglet TER." : ""}</div>`;
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
        await fillSlot("fav-" + id, async () => favRows((await nextDepartures(s)).map(d => ({ stop: s, d }))));
      }
    }
    if (S.overlay?.k === "stop" && S.overlay.at) {
      // horaires prévus d'un autre jour ou d'une autre heure (horaires ouverts de la CTS, par Transitous)
      const s = stopById(S.overlay.id), at = S.overlay.at;
      if (s && document.getElementById("stopdeps")) await fillSlot("stopdeps", async () => plannedBoard(s.name, await plannedDepartures(s, at), at));
    } else if (S.overlay?.k === "stop") {
      const s = stopById(S.overlay.id);
      if (s && document.getElementById("stopdeps")) {
        await fillSlot("stopdeps", async () => {
          const all = (await nextDepartures(s)).map(d => ({ stop: s, d })).sort(sortByTime);
          // arrêt desservi par plusieurs modes (Gare Centrale, Homme de Fer…) : onglets Tous / Tram / Bus
          const modes = (["tram", "bus", "ter"] as const).filter(m => all.some(x => lineKind(x.d.line) === m));
          const cur = S.overlay?.k === "stop" && S.overlay.mode && modes.includes(S.overlay.mode) ? S.overlay.mode : null;
          const tabs = modes.length > 1 ? stopTabs(modes, cur) : "";
          // gare : tableau des départs des trains (retards, suppressions), sous les trams et bus dans l'onglet « Tous »
          const trains = s.sncf ? TRAINS[s.sncf] ?? [] : [], others = all.filter(x => lineKind(x.d.line) !== "ter");
          const h = tabs + (cur === "ter" ? trainBoard(trains)
            : cur ? departureBoard(s.name, all.filter(x => lineKind(x.d.line) === cur), 16, s.id)
            : (others.length || !s.sncf ? departureBoard(s.name, others, 16, s.id) : "") + (s.sncf && (trains.length || !others.length) ? trainBoard(trains, others.length ? 6 : 15) : ""));
          // sans passage : souvent un arrêt non desservi (travaux, déviation) ; l'info trafic l'explique mieux que les détails techniques
          const none = !h.includes('class="lb-r');
          return stopNotice(s, none) + (none ? h + debugBox() : h);
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
      if (el.querySelector(".dep, .trow, .lb-r")) {
        if (!el.querySelector(".stalenote")) el.insertAdjacentHTML("afterbegin", '<div class="stalenote">Connexion perdue : derniers horaires connus</div>');
      } else if (el.id !== "nearlist" || !el.innerHTML.trim() || el.querySelector(".empty")) {
        el.innerHTML = '<div class="empty" style="padding:24px">Horaires indisponibles pour le moment : nouvel essai dans quelques secondes.</div>';
      }
    }
  }
}

/* ============ ÉVÉNEMENTS ============ */
const CLICKABLE = "[data-tab],[data-act],[data-line],[data-ldir],[data-stop],[data-f],[data-fav],[data-mb],[data-sg],[data-nav],[data-layer],[data-poi],[data-poitrip],[data-bikenav],[data-mode],[data-smode],[data-dirk],[data-onb],[data-upd],[data-ride],[data-sel],[data-alerts],[data-aline],[data-wk],[data-wq],[data-goto],[data-follow],[data-jstop],[data-wpick],[data-theme-pick],[data-accent-pick],[data-ui-pick],[data-darkmap],[data-reset],[data-bikest],[data-place],[data-pset],[data-arr],[data-arrlead],[data-arrat],[data-rep]";

app.addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(CLICKABLE);
  // ne jamais remonter hors de l'application : la page elle-même porte des attributs de thème (data-darkmap…)
  if (!b || !app.contains(b)) return;
  const d = b.dataset;
  if (d.onb) { void onboardingAction(d.onb); return; }
  if (d.arr && S.overlay?.k === "stop") {
    const [line, dest, ts] = d.arr.split("|"), times = ts.split(",").map(Number).filter(t => t > Date.now());
    if (!times.length) return;
    // le premier passage s'il laisse au moins 2 min, sinon le suivant
    const at = times.find(t => t - Date.now() > 2 * 60_000) ?? times[0];
    S.arrPick = { line, dest, at, times, stopId: S.overlay.id }; render(); return;
  }
  if (d.arrat && S.arrPick) { S.arrPick.at = Number(d.arrat); render(); return; }
  if (d.arrlead !== undefined && S.arrPick) {
    const pick = S.arrPick, s = stopById(pick.stopId);
    S.arrPick = null; render();
    if (d.arrlead === "x" || !s) return;
    const a = { stopId: s.id, refs: s.refs?.length ? s.refs : [s.id], stop: s.name, line: pick.line, dest: pick.dest, at: pick.at, lead: Number(d.arrlead) };
    if (d.arrlead === "del") { void removeArrival(a).then(() => { toast("Alerte annulée"); render(); }); return; }
    void addArrival(a, x => { toast(`${x.line} vers ${x.dest} : passage dans ${x.lead} min`); render(); })
      .then(() => { toast(`Kumm vous préviendra ${a.lead} min avant le passage du ${a.line}`); render(); })
      .catch(e => toast(e instanceof Error ? e.message : "Alerte impossible"));
    return;
  }
  if (d.place) {
    const w = d.place as PlaceKey, p = S.places[w];
    if (p) openTrip(p); else openPlaceSet(w);
    return;
  }
  if (d.pset !== undefined && S.overlay?.k === "placeset") {
    const w = S.overlay.which;
    if (d.pset === "del") { setPlace(w, null); toast("Adresse retirée"); }
    else {
      const p = d.pset === "me" ? { label: "Position enregistrée", lat: USER.lat, lon: USER.lon } : S.placeSugg[Number(d.pset)];
      if (!p) return;
      setPlace(w, p); toast(`${w === "home" ? "Maison" : "Travail"} : ${p.label}`);
    }
    S.overlay = null; render(); return;
  }
  if (d.bikest !== undefined) {
    setBikeStation(d.bikest || null); S.overlay = null;
    toast(d.bikest ? "Station Vélhop enregistrée pour l’accueil" : "La station la plus proche sera affichée"); render(); return;
  }
  if (d.ride) { if (d.ride === "stop") stopSharing(); else answerRide(d.ride === "yes"); return; }
  if (d.jstop) { stopJourney(); toast("Alertes de descente arrêtées"); return; }
  if (d.upd) { updateAction(d.upd); return; }
  if (d.dirk !== undefined && d.dirv !== undefined) { pickDir(d.dirk, d.dirv); render(); return; }   // direction d'une ligne, sans ouvrir l'arrêt
  if (d.rep && S.overlay?.k === "stop") {
    const [kind, v] = d.rep.split("|"), stop = S.overlay.id;
    S.overlay.rep = false; render();
    sendReport(stop, kind, v === "new" ? undefined : (v as "yes" | "no"))
      .then(m => toast(v === "no" ? "Merci : noté comme réglé" : m), e => toast(e instanceof Error ? e.message : "Envoi impossible"))
      .finally(() => ensureReports(stop, render, true));
    return;
  }
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
    S.trip.sugg = null; replan(); render(); return;
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
  if (d.poitrip) {
    const p = POIS.find(x => x.id === d.poitrip);
    if (p) openTrip({ label: p.name, lat: p.lat, lon: p.lon });
    return;
  }
  if (d.wpick) { void pickForWidget(d.wpick); return; }   // réglage d'un widget de l'écran d'accueil
  if (d.follow) { followFromSearch(d.follow); return; }   // véhicule trouvé par son code de trajet
  if (d.goto) {
    // « Naviguer » : arrêt (fiche ou recherche) ou adresse trouvée par la recherche
    const [kind, ref] = [d.goto.slice(0, d.goto.indexOf(":")), d.goto.slice(d.goto.indexOf(":") + 1)];
    const s = kind === "stop" ? stopById(ref) : undefined, a = kind === "addr" ? S.searchAddr?.items[Number(ref)] : undefined;
    if (s) openTrip({ label: s.name, lat: s.lat, lon: s.lon, stop: s });
    else if (a) openTrip(a);
    return;
  }
  if (d.stepfree) { S.prefs.stepFree = !S.prefs.stepFree; savePrefs(S.prefs); render(); return; }
  if (d.themePick || d.accentPick || d.uiPick || d.darkmap || d.reset) {
    if (d.themePick) S.prefs.theme = d.themePick as Theme;
    if (d.uiPick) S.prefs.ui = d.uiPick as Ui;
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
  if (d.line) { S.overlay = { k: "line", id: d.line }; S.lineDir = 0; render(); return; }
  if (d.ldir !== undefined) { S.lineDir = Number(d.ldir); render(); return; }
  if (d.stop) { S.overlay = { k: "stop", id: d.stop }; render(); return; }
  if (d.f) { S.filter = d.f as Filter; render(); return; }
  if (d.fav) { toggleFav(d.fav); return; }
  switch (d.act) {
    case "closeOverlay": S.overlay = null; break;
    case "tabHome":
      // écran des itinéraires ouvert par « Naviguer » : retour à la fiche ou à la recherche d'où l'on vient
      if (S.tab === "trips" && S.tripBack) { S.tab = S.tripBack.tab; S.overlay = S.tripBack.overlay; S.tripBack = null; break; }
      S.tab = S.tab === "lines" ? "search" : "home"; break;
    case "swap": swapTrip(); break;
    case "when": S.trip.whenDraft = { ...S.trip.when, at: S.trip.when.at || Math.ceil(Date.now() / 300_000) * 300_000 }; break;
    case "whenClose": S.trip.whenDraft = null; break;
    case "replan": replan(); break;
    case "report": if (S.overlay?.k === "stop") S.overlay.rep = true; break;
    case "whenOk": if (S.trip.whenDraft) S.trip.when = S.trip.whenDraft; S.trip.whenDraft = null; S.trip.sel = 0; break;
    case "sheet": if (S.swiped) return; S.sheet = S.sheet === 0 ? 1 : S.sheet === 2 ? 1 : 0; break;
    case "msgs": S.overlay = { k: "msgs" }; break;
    case "favs": S.overlay = { k: "favs" }; S.favQ = ""; break;
    case "locate": recenter(); toast("Position centrée"); return;
    case "zoomIn": zoomBy(1); return;
    case "zoomOut": zoomBy(-1); return;
    case "account": S.overlay = { k: "account" }; break;
    case "help": S.overlay = { k: "help" }; break;
    case "mapParkings": showOnMap(["pr"]); return;
    case "mapBikes": showOnMap(["velhop", "velopark"], true); return;
    case "prefs": S.overlay = { k: "settings" }; break;
    case "look": S.overlay = { k: "look" }; break;
    case "stats": S.overlay = { k: "stats" }; break;
    case "noel": S.overlay = { k: "noel" }; break;
    case "stopPick": if (S.overlay?.k === "stop") S.overlay.pick = true; break;
    case "stopNow": if (S.overlay?.k === "stop") { delete S.overlay.at; delete S.overlay.pick; } break;
    case "stopAt": {
      const date = (document.getElementById("sdate") as HTMLInputElement | null)?.value, time = (document.getElementById("stime") as HTMLInputElement | null)?.value;
      const at = date && time ? new Date(`${date}T${time}`).getTime() : NaN;
      if (S.overlay?.k === "stop" && Number.isFinite(at)) { S.overlay.at = at; delete S.overlay.pick; delete S.overlay.draft; }
      break;
    }
    case "contremarque": S.modal = contremarqueInfo(); break;
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
  navigator.geolocation?.getCurrentPosition(p => { setUserPosition(p); if (!CONFIG.USE_MOCK) startRideDetection(); }, () => { /* position refusée : on garde Homme de Fer */ });
}
// « Êtes-vous dans ce bus ? » : seulement application ouverte (aucun suivi en arrière-plan)
document.addEventListener("visibilitychange", () => {
  // retour dans l'application : l'itinéraire affiché est recalculé s'il date (ou si l'heure choisie est passée)
  if (!document.hidden && S.tab === "trips" && !S.overlay) render();
  if (document.hidden) stopRideDetection();
  else if (S.locOn && onboardingDone() && !CONFIG.USE_MOCK) startRideDetection();
});

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
/** Choix fait dans l'écran de réglage d'un widget */
async function pickForWidget(v: string): Promise<void> {
  const w = S.wsetup;
  if (!w) return;
  const [kind, ref] = [v.slice(0, v.indexOf(":")), v.slice(v.indexOf(":") + 1)];
  try {
    if (kind === "poi") {
      const p = POIS.find(x => x.id === ref);
      if (p) await configureWidget({ id: p.id, name: p.name });
    } else if (kind === "stop") {
      const cfg = stopConfig(ref), s = stopById(ref);
      if (!cfg || !s) return;
      // les lignes et directions qui passent à cet arrêt : une seule pour « Mon trajet », une ou plusieurs pour l'arrêt favori
      w.stop = ref; w.deps = undefined; w.sel = []; render();
      const deps = await nextDepartures(s);
      w.deps = deps.map(d => ({ line: d.line, dest: d.dest })).sort((a, b) => a.line.localeCompare(b.line, "fr", { numeric: true }) || a.dest.localeCompare(b.dest, "fr"));
      render();
    } else if (kind === "dir" && w.deps) {
      const i = Number(ref), sel = w.sel ?? [];
      w.sel = sel.includes(i) ? sel.filter(x => x !== i) : [...sel, i];
      render();
    } else if (kind === "done" && w.stop && w.deps) {
      const cfg = stopConfig(w.stop);
      const only = (w.sel ?? []).map(i => w.deps![i]).filter(Boolean).map(d => `${d.line}|${d.dest}`);
      if (cfg) await configureWidget({ ...cfg, only });
    } else if (kind === "line" && w.stop && w.deps) {
      const d = w.deps[Number(ref)], cfg = stopConfig(w.stop);
      if (d && cfg) await configureWidget({ ...cfg, line: d.line, dest: d.dest });
    }
  } catch { toast("Impossible de régler le widget : réessayez"); }
}

/** Ouvre l'écran des itinéraires vers ce lieu, depuis ma position ; son bouton retour ramène à l'écran actuel */
function openTrip(dest: Place): void {
  S.tripBack = { tab: S.tab, overlay: S.overlay };
  Object.assign(S.trip, { dest, toText: dest.label, mode: "transit", sugg: null, sel: 0 });
  if (!S.trip.from && !S.trip.fromIsMe) Object.assign(S.trip, { fromIsMe: true, fromText: "Ma position" });
  S.overlay = null; S.tab = "trips";
  render();
}

/** Adresses pour la recherche (Base Adresse Nationale), à partir de 3 lettres, après une courte pause de frappe */
let addrTimer = 0;
function searchAddresses(): void {
  window.clearTimeout(addrTimer);
  const q = S.q.trim();
  if (q.length < 3 || CONFIG.USE_MOCK) { if (S.searchAddr) { S.searchAddr = null; render(); } return; }
  addrTimer = window.setTimeout(() => {
    geocode(q).then(items => { if (S.q.trim() === q) { S.searchAddr = { q, items }; render(); } }).catch(() => { /* adresses indisponibles : arrêts et lieux seulement */ });
  }, 350);
}

/** Écran de choix de l'adresse Maison / Travail */
function openPlaceSet(which: PlaceKey): void {
  S.placeQ = ""; S.placeSugg = []; S.overlay = { k: "placeset", which }; render();
  setTimeout(() => document.getElementById("pq")?.focus(), 50);
}
let placeTimer = 0;
/** Suggestions de l'écran Maison / Travail : arrêts tout de suite, adresses un instant plus tard */
function askPlaces(): void {
  window.clearTimeout(placeTimer);
  const q = S.placeQ.trim();
  const stops: Place[] = q.length < 2 ? [] : STOPS.filter(s => fold(s.name).includes(fold(q))).slice(0, 3).map(s => ({ label: s.name, lat: s.lat, lon: s.lon, stop: s }));
  S.placeSugg = stops; render();
  if (q.length < 3) return;
  placeTimer = window.setTimeout(() => {
    geocode(q).then(addr => { if (S.placeQ.trim() === q) { S.placeSugg = [...addr, ...stops]; render(); } }).catch(() => { /* adresses indisponibles */ });
  }, 300);
}

function askSuggestions(field: "from" | "to"): void {
  window.clearTimeout(sgTimer);
  const q = textOf(field).trim();
  if (q.length < 2) { S.trip.sugg = null; render(); return; }
  const ql = fold(q);
  const stops: Place[] = STOPS.filter(s => fold(s.name).includes(ql)).slice(0, 4).map(s => ({ label: s.name, lat: s.lat, lon: s.lon, stop: s }));
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
  if (t.id === "fq") { S.favQ = t.value; render(); return; }
  if (t.id === "pq") { S.placeQ = t.value; askPlaces(); return; }
  if (t.id === "wq" && S.wsetup) { S.wsetup.q = t.value; render(); return; }
  if (t.id === "sq") {
    S.q = t.value; render(); searchAddresses();
    // codes de trajet des véhicules : positions chargées au besoin (au plus toutes les 20 s)
    if (S.q.trim().length > 2) refreshVehicles(() => { if (S.tab === "search") render(); });
  }
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
  if ((t.id === "sdate" || t.id === "stime") && S.overlay?.k === "stop") {
    const date = (document.getElementById("sdate") as HTMLInputElement | null)?.value, time = (document.getElementById("stime") as HTMLInputElement | null)?.value;
    const ms = date && time ? new Date(`${date}T${time}`).getTime() : NaN;
    if (Number.isFinite(ms)) S.overlay.draft = ms;
    return;
  }
  if (!w || (t.id !== "wdate" && t.id !== "wtime")) return;
  const date = (document.getElementById("wdate") as HTMLInputElement | null)?.value, time = (document.getElementById("wtime") as HTMLInputElement | null)?.value;
  const ms = date && time ? new Date(`${date}T${time}`).getTime() : NaN;
  if (!Number.isNaN(ms)) { w.at = ms; render(); }
});

app.addEventListener("focusin", e => {
  const t = e.target as HTMLInputElement;
  if (t.id === "hq") {
    // « Où voulez-vous aller ? » : la recherche (arrêts, adresses, lieux), puis « Naviguer »
    t.blur(); S.tab = "search"; S.overlay = null; render();
    setTimeout(() => document.getElementById("sq")?.focus(), 50);
  }
  if (t.id === "tfrom" && S.trip.fromIsMe) t.select();
});

/* appui long (data-hold) : action secondaire d'une tuile, par exemple choisir la station Vélhop de l'accueil ;
   le clic qui suit l'appui long est ignoré, et le menu du navigateur (copier, partager…) n'apparaît jamais */
let holdTimer = 0, held = false, holdAt: [number, number] | null = null, holdCopy: string | null = null;
const cancelHold = (): void => { window.clearTimeout(holdTimer); holdAt = null; holdCopy = null; };
app.addEventListener("pointerdown", e => {
  held = false;   // l'appui long précédent n'a pas toujours été suivi d'un clic (l'écran a changé sous le doigt)
  const h = (e.target as HTMLElement).closest<HTMLElement>("[data-hold]");
  if (!h) return;
  holdAt = [e.clientX, e.clientY];
  holdTimer = window.setTimeout(() => {
    held = true; holdAt = null;
    try { navigator.vibrate?.(25); } catch { /* rien */ }
    if (h.dataset.hold === "bikepick") { S.overlay = { k: "bikepick" }; render(); }
    else if (h.dataset.hold?.startsWith("place:")) openPlaceSet(h.dataset.hold.slice(6) as PlaceKey);
    // copie : faite au moment où le doigt se lève (Android n'autorise le presse-papiers que pendant un geste)
    else if (h.dataset.hold?.startsWith("copy:")) holdCopy = h.dataset.hold.slice(5);
  }, 550);
});
app.addEventListener("pointermove", e => { if (holdAt && Math.hypot(e.clientX - holdAt[0], e.clientY - holdAt[1]) > 10) cancelHold(); });
app.addEventListener("pointerup", () => { const t = holdCopy; cancelHold(); if (t) void copyText(t); });
app.addEventListener("pointercancel", cancelHold);
app.addEventListener("click", e => { if (held) { held = false; e.stopPropagation(); e.preventDefault(); } }, true);
document.addEventListener("contextmenu", e => { if (!(e.target as HTMLElement).closest("input,textarea")) e.preventDefault(); });

/** Copie dans le presse-papiers (appui long sur un code de trajet) */
async function copyText(t: string): Promise<void> {
  // d'abord la copie classique, immédiate (pendant le geste), puis l'API du presse-papiers ; message seulement si l'une a réussi
  const ta = document.createElement("textarea");
  ta.value = t; ta.readOnly = true; ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.top = "0";
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { /* rien */ }
  ta.remove();
  if (!ok) { try { await navigator.clipboard.writeText(t); ok = true; } catch { /* refusé */ } }
  toast(ok ? `Code du trajet copié : ${t}` : "Copie impossible sur ce téléphone");
}

/* glisser le panneau « À proximité » vers le haut ou le bas */
let y0: number | null = null;
app.addEventListener("pointerdown", e => { y0 = (e.target as HTMLElement).closest(".sheet .grab,.sheet h3,.sheet .shead") ? e.clientY : null; });
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

/* Lignes de chaque quai, apprises par le serveur au fil des passages : complètent les arrêts (la liste de la CTS ne les donne pas) */
let quayLines: Record<string, string[]> = {};
try { quayLines = JSON.parse(localStorage.getItem("quayLines") ?? "{}") as Record<string, string[]>; } catch { /* rien */ }
function applyQuayLines(): void {
  for (const s of STOPS) {
    if (s.lines.some(l => l !== "TER") || !s.quays?.length) continue;
    const set = new Set<string>(s.lines);
    for (const q of s.quays) for (const l of quayLines[q.code] ?? []) set.add(l);
    if (set.size) s.lines = [...set].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
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
  void loadLineInfo().then(info => { Object.assign(LINE_MODES, info.modes); Object.assign(LINE_NAMES, info.names); Object.assign(COLORS, info.colors); Object.assign(TEXT_COLORS, info.text); Object.assign(DIRS, info.ends); render(); }).catch(e => console.warn("lines-discovery indisponible :", e));
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
  applyQuayLines();
  void loadQuayLines().then(m => {
    if (!Object.keys(m).length) return;
    quayLines = m;
    try { localStorage.setItem("quayLines", JSON.stringify(m)); } catch { /* ignoré */ }
    applyQuayLines(); render();
  }).catch(() => { /* on garde les lignes connues */ });
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
window.addEventListener("offline", () => render());
onOfflineChange(() => render());

/* Android : le bouton « retour » ferme d'abord le guidage, une fenêtre ou une fiche, puis revient à l'accueil, puis quitte */
if (Capacitor.isNativePlatform()) {
  void CapApp.addListener("backButton", () => {
    if (S.upd) void CapApp.exitApp();   // application à mettre à jour : « retour » quitte
    else if (S.onb) { if (S.onb.i > 0) { S.onb.i--; render(); } }
    else if (document.getElementById("navlayer")) stopNav();
    else if (S.modal) { S.modal = null; render(); }
    else if (S.arrPick) { S.arrPick = null; render(); }
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
(window as unknown as { __kumm: unknown }).__kumm = { STOPS, POIS, LINE_MODES, LINE_NAMES, kindOfStop, S, render, ride: rideDebug };

// premier lancement (ou conditions modifiées) : présentation avant tout le reste
{ const steps = onboardingSteps(); if (steps.length) S.onb = { steps, i: 0, refused: false }; }

if (CONFIG.USE_MOCK) { MESSAGES.push(...MOCK_MESSAGES); MSG_STATE.status = "ok"; }
else void initReal();
render();
hideSplash();
void initWidgets();   // l'application est affichée sous l'animation de lancement : elle peut s'effacer
