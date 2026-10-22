import "./style.css";
import { CONFIG, VERSION, url } from "./config";
import { LINE_MODES, LINE_NAMES, NEWS, isTram, kindOfStop } from "./data";
import { ic, type IconName } from "./icons";
import { loadLineInfo, loadPois, loadStops, nextDepartures } from "./api";
import { KINDS } from "./kinds";
import type { Layer } from "./kinds";
import { POIS, S, STOPS, USER, hooks, project, render, stopById, toast, toggleFav } from "./store";
import type { Filter, Tab } from "./store";
import {
  debugBox, depCards, header, layerCounts, overlayFavs, overlayLine, overlayMsgs, overlayPoi, overlaySettings, overlayStop, planTrips, screenBuy, screenHome,
  screenLines, screenNearby, screenSearch, screenTrips, tripsDemo
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
import { BIKE_ROUTES, PLAN } from "./views";
import { startNav } from "./nav";
import { mountLiveMap, recenter } from "./livemap";

const app = document.getElementById("app") as HTMLElement;

const NAV: [Tab, string, IconName][] = [
  ["home", "Accueil", "home"], ["search", "Recherche", "search"], ["nearby", "A Proximité", "pin"], ["trips", "Itinéraires", "route"], ["buy", "Billets", "ticket"]
];

/* ============ RENDU ============ */
let lastTab: Tab | null = null;
let lastOverlay = "";

function draw(): void {
  const t = S.tab;
  let body: string;
  if (t === "home") body = header() + `<main>${screenHome()}</main>`;
  else if (t === "search") body = `<main>${screenSearch()}</main>`;
  else if (t === "lines") body = `<main>${screenLines()}</main>`;
  else if (t === "nearby") body = `<main>${screenNearby()}</main>`;
  else if (t === "trips") body = `<main>${screenTrips()}</main>`;
  else body = `<main>${screenBuy()}</main>`;

  const o = S.overlay;
  const ov = !o ? "" : o.k === "line" ? overlayLine(o.id) : o.k === "stop" ? overlayStop(o.id) : o.k === "poi" ? overlayPoi(o.id) : o.k === "settings" ? overlaySettings() : o.k === "msgs" ? overlayMsgs() : overlayFavs();

  const scroller = document.querySelector<HTMLElement>("#app > main");
  const top = scroller ? scroller.scrollTop : 0;
  const active = document.activeElement as HTMLInputElement | null;
  const act = active?.id, pos = active?.selectionStart ?? null;

  app.innerHTML = body + ov +
    `<nav>${NAV.map(n => `<button data-tab="${n[0]}" class="${t === n[0] || (n[0] === "search" && t === "lines") ? "on" : ""}"><span class="ni">${ic(n[2])}</span>${n[1]}</button>`).join("")}</nav>` +
    (S.modal ? `<div class="modal"><div class="dlg"><h4>${S.modal.t}</h4><p>${S.modal.p}</p><div class="bt">${S.modal.b.map((b, i) => `<button data-mb="${i}">${b}</button>`).join("")}</div></div></div>` : "") +
    (S.toast ? `<div class="toast">${esc(S.toast)}</div>` : "");

  const m = document.querySelector<HTMLElement>("#app > main");
  if (m && !o) m.scrollTop = top;
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
  restoreSlots();
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
  : id === "trips" ? `trips|${S.trip.dest?.label ?? ""}|${S.trip.fromIsMe ? "me" : S.trip.from?.label ?? ""}`
  : id;
function setSlot(el: HTMLElement, html: string): void {
  el.innerHTML = html;
  slotCache.set(slotKey(el.id), html);
}
function restoreSlots(): void {
  document.querySelectorAll<HTMLElement>("#nearlist,#stopdeps,#trips,[id^=fav-]").forEach(el => {
    const html = slotCache.get(slotKey(el.id));
    if (html && (!el.innerHTML || el.id === "trips")) el.innerHTML = html;
  });
}

const sortByTime = (a: StopDeparture, b: StopDeparture): number => a.d.times[0] - b.d.times[0];
const matchesFilter = (s: { name: string }): boolean =>
  S.filter === "all" || (S.filter === "tram" ? kindOfStop(s) === "tram" : kindOfStop(s) === "bus");

async function loadDeps(): Promise<void> {
  try {
    if (S.tab === "nearby" && !S.overlay) {
      const near = STOPS.filter(s => matchesFilter(s))
        .sort((a, b) => Math.hypot(a.x - 170, a.y - 222) - Math.hypot(b.x - 170, b.y - 222)).slice(0, 4);
      const res = await Promise.all(near.map(s => nextDepartures(s).then(ds => ds.map(d => ({ stop: s, d }))).catch(() => [] as StopDeparture[])));
      const all: StopDeparture[] = [];
      for (const rows of res) {
        rows.filter(({ d }) => S.filter === "all" || (S.filter === "tram") === isTram(d.line)).sort(sortByTime).slice(0, 2).forEach(r => all.push(r));
      }
      const el = document.getElementById("nearlist");
      if (el) setSlot(el, depCards(all));
    }
    if (S.tab === "home") {
      for (const id of S.fav) {
        const el = document.getElementById("fav-" + id), s = stopById(id);
        if (!el || !s) continue;
        setSlot(el, depCards((await nextDepartures(s)).map(d => ({ stop: s, d })).sort(sortByTime).slice(0, 2)));
      }
    }
    if (S.overlay?.k === "stop") {
      const s = stopById(S.overlay.id), el = document.getElementById("stopdeps");
      if (s && el) {
        const h = depCards((await nextDepartures(s)).map(d => ({ stop: s, d })).sort(sortByTime));
        setSlot(el, h.includes('class="dep"') ? h : h + debugBox());
      }
    }
    if (S.tab === "trips") {
      const el = document.getElementById("trips");
      if (el) setSlot(el, CONFIG.USE_MOCK ? tripsDemo() : await planTrips());
    }
  } catch (e) {
    console.error(e);
    const el = document.getElementById("stopdeps") ?? document.getElementById("nearlist");
    if (el) el.innerHTML = '<div class="empty" style="padding:24px">Erreur : ' + esc(e instanceof Error ? e.message : e) + "</div>";
  }
}

/* ============ ÉVÉNEMENTS ============ */
const CLICKABLE = "[data-tab],[data-act],[data-line],[data-stop],[data-f],[data-fav],[data-more],[data-mb],[data-sg],[data-nav],[data-layer],[data-poi],[data-poinav],[data-poibike],[data-poitrip],[data-bikenav],[data-mode],[data-theme-pick],[data-accent-pick],[data-darkmap],[data-reset]";

app.addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(CLICKABLE);
  // ne jamais remonter hors de l'application : la page elle-même porte des attributs de thème (data-darkmap…)
  if (!b || !app.contains(b)) return;
  const d = b.dataset;
  if (d.mb !== undefined) { const m = S.modal; S.modal = null; if (d.mb === "1" && m?.go) m.go(); render(); return; }
  if (d.tab) {
    S.tab = d.tab as Tab; S.overlay = null;
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
  if (d.mode) { S.trip.mode = d.mode as "walk" | "bike" | "transit"; render(); return; }
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
    case "sheet": if (S.swiped) return; S.sheet = !S.sheet; break;
    case "nextNews": rotateNews(); return;
    case "msgs": S.overlay = { k: "msgs" }; break;
    case "favs": S.overlay = { k: "favs" }; break;
    case "locate": recenter(); toast("Position centrée"); return;
    case "account": toast("Mon compte : bientôt disponible"); return;
    case "prefs": S.overlay = { k: "settings" }; break;
  }
  render();
});

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
  if (Math.abs(dy) > 24) { S.sheet = dy < 0; S.swiped = true; setTimeout(() => { S.swiped = false; }, 300); render(); }
});

setInterval(() => { if (!document.hidden && document.activeElement?.tagName !== "INPUT") void loadDeps(); }, 30000);
/** Change seulement l'actualité affichée : pas de redessin de tout l'accueil (les favoris restent en place) */
function rotateNews(): void {
  S.news = (S.news + 1) % NEWS.length;
  const n = NEWS[S.news], box = document.querySelector(".news");
  const b = box?.querySelector("b"), p = box?.querySelector("p");
  if (!b || !p) return;
  b.textContent = n.t; p.textContent = n.s;
  document.querySelectorAll(".dots i").forEach((i, k) => i.classList.toggle("on", k === S.news));
}
setInterval(() => { if (S.tab === "home" && !S.overlay && !S.modal) rotateNews(); }, 6000);

/* ============ DONNÉES RÉELLES ============ */
let remotePois: Poi[] = [];

/** Catégories de la carte : Vélhop et parkings relais (sources ouvertes) + Véloparks placés sur les arrêts de la CTS */
function rebuildPois(): void {
  POIS.length = 0;
  [...remotePois, ...buildVeloparks(STOPS)].forEach(p => POIS.push(project(p)));
}

async function initReal(): Promise<void> {
  // modes des lignes (tram / bus / TER) : améliore le classement des arrêts dès qu'ils arrivent
  void loadLineInfo().then(info => { Object.assign(LINE_MODES, info.modes); Object.assign(LINE_NAMES, info.names); render(); }).catch(e => console.warn("lines-discovery indisponible :", e));
  // 1) démarrage instantané avec la liste d'arrêts gardée sur le téléphone (7 jours)
  try {
    const c = JSON.parse(localStorage.getItem("stopsCache2") ?? "null") as { t: number; list: typeof STOPS } | null;
    if (c && Date.now() - c.t < 7 * 864e5) { STOPS.length = 0; c.list.forEach(s => STOPS.push(project(s))); render(); }
  } catch { /* pas de cache */ }
  // 2) mise à jour depuis l'API
  try {
    const list = await loadStops();
    STOPS.length = 0; list.forEach(s => STOPS.push(project(s)));
    rebuildPois();
    try { localStorage.setItem("stopsCache2", JSON.stringify({ t: Date.now(), list })); } catch { /* ignoré */ }
    render();
  } catch (e) {
    console.error(e);
    if (!STOPS.length) toast("Connexion à l’API CTS impossible");
  }
  // points d'intérêt (P+R, Vélopark…) : chargés à part, une panne ne bloque rien
  void loadPois().then(list => { remotePois = list; rebuildPois(); render(); });
  navigator.geolocation?.getCurrentPosition(p => {
    USER.lat = p.coords.latitude; USER.lon = p.coords.longitude;
    STOPS.forEach(project); POIS.forEach(project); S.locOn = true; render();
  }, () => { /* position refusée : on garde Homme de Fer */ });
}

/* Le serveur peut exiger une version minimale de l'application (après une évolution incompatible) */
async function checkVersion(): Promise<void> {
  try {
    const r = await fetch(url("/health"));
    if (!r.ok) return;
    const j = (await r.json()) as { minApp?: string };
    if (j.minApp && cmpVersion(VERSION, j.minApp) < 0) {
      S.modal = { t: "Mise à jour nécessaire", p: "Cette version de Kumm n'est plus compatible avec le serveur. Installez la dernière version de l'application.", b: ["Plus tard"] };
      render();
    }
  } catch { /* serveur injoignable : les écrans l'indiquent déjà */ }
}
if (!CONFIG.USE_MOCK) void checkVersion();

/* Perte et retour de la connexion du téléphone */
window.addEventListener("offline", () => toast("Vous êtes hors ligne"));
window.addEventListener("online", () => { toast("Connexion rétablie"); void loadDeps(); });

/* Android : le bouton « retour » ferme d'abord le guidage, une fenêtre ou une fiche, puis revient à l'accueil, puis quitte */
if (Capacitor.isNativePlatform()) {
  void CapApp.addListener("backButton", () => {
    if (document.getElementById("navlayer")) stopNav();
    else if (S.modal) { S.modal = null; render(); }
    else if (S.overlay) { S.overlay = null; render(); }
    else if (S.tab !== "home") { S.tab = "home"; render(); }
    else void CapApp.exitApp();
  });
}

/* thème : appliqué au démarrage, et mis à jour si le téléphone change de mode (clair/sombre) en mode automatique */
applyTheme(S.prefs);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (S.prefs.theme === "auto") applyTheme(S.prefs); });

/* pour inspecter les données dans la console du navigateur : __kumm.STOPS, __kumm.LINE_MODES */
(window as unknown as { __kumm: unknown }).__kumm = { STOPS, POIS, LINE_MODES, LINE_NAMES, kindOfStop };

if (!CONFIG.USE_MOCK) void initReal();
render();
