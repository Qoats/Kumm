import type { Place, Stop, StopDeparture } from "../../shared/types";
import type { TrainDeparture } from "../../shared/ter";
import { CONFIG, VERSION } from "./config";
import { ALL_LINES, COLORS, DIRS, TRAMS, isHub, lineText, MESSAGES, MSG_STATE, hasAlert, messagesForStop, stopLabel, isTram, kindOfStop, lineKind, lineLabel, messagesFor } from "./data";
import type { TrafficMsg } from "./data";
import { KINDS, LAYERS } from "./kinds";
import { ACCENTS, ACCENT_TOKENS, THEMES, THEME_TOKENS, UIS } from "./themes";
import type { Accent, Theme, Ui } from "./themes";
import { CTS_APP_ANDROID, CTS_APP_IOS, CTS_CONTACT, CTS_FAQ, CTS_OBJETS_TROUVES, KUMM_CONTACT, isIOS } from "./links";
import type { Layer } from "./kinds";
import { marker, markerIcon } from "./markers";
import { ic, type IconName } from "./icons";
import { MAPPATHS, mapRoutes } from "./map";
import { POIS, S, STOPS, USER, mins, stopById } from "./store";
import { LINE_ROUTES, debug, nextDepartures } from "./api";
import type { LineRoute } from "./api";
import { stopKey } from "./network";
import { fmtDist, fmtDur, haversine, walkMin } from "./geo";
import { hm, minutes } from "./transit";
import type { JLeg, Journey } from "./transit";
import { TRIP, tripReady } from "./trip";
import type { PlanCtx } from "./trip";
import type { LL } from "./geo";
import { esc, fold } from "./util";
import { VEHICLES, followInfo, serverNow } from "./vehicles";
import { NATIVE, PUSH_READY } from "./alerts";
import { CAN_UPDATE } from "./update";

/* ============ COMPOSANTS ============ */
/** Pastille d'une ligne ; alert : petit « ! » posé sur le coin (le texte à côté reste aligné avec les autres tuiles) */
export const lineChip = (l: string, sm = false, alert = false): string => {
  const name = lineLabel(l);
  return `<span class="ln ${sm ? "sm" : ""}" style="background:${COLORS[name] ?? COLORS[l] ?? "#777"};color:${lineText(COLORS[name] ? name : l)}">${esc(name)}${alert ? '<span class="al" aria-label="Perturbation">!</span>' : ""}</span>`;
};
const chipAlert = (l: string): string =>
  `<button class="ln" data-line="${esc(l)}" style="background:${COLORS[l] ?? "#777"};color:${lineText(l)}">${esc(l)}${hasAlert(l) ? '<span class="al" style="color:#fff">!</span>' : ""}</button>`;
const live = '<span class="live"></span>';
/** Ordre des lignes : trams (A à F), lignes G et H, lignes à lettre et numéro (C1, L1…), puis bus par numéro */
const lineOrder = (l: string): string =>
  /^[A-F]$/.test(l) ? "0" + l : /^[GH]$/.test(l) ? "1" + l : /^[A-Z]+\d+$/.test(l) ? "2" + l.replace(/\d+/, d => d.padStart(4, "0")) : /^\d+$/.test(l) ? "3" + l.padStart(4, "0") : "4" + l;
/** Toutes les lignes du réseau : celles qui desservent les arrêts connus (la liste fixe ALL_LINES tant qu'ils ne sont pas chargés) */
export function networkLines(): string[] {
  const set = new Set<string>(ALL_LINES);
  for (const st of STOPS) for (const l of st.lines) { const n = lineLabel(l); if (lineKind(l) !== "ter" && n.length <= 5) set.add(n); }
  return [...set].sort((a, b) => lineOrder(a).localeCompare(lineOrder(b)));
}
/** Terminus d'une ligne : ceux publiés par la CTS, sinon les destinations des véhicules en circulation */
const dirs = (l: string): [string, string] => {
  if (DIRS[l]) return DIRS[l];
  const d = [...new Set([...VEHICLES.values()].filter(v => v.line === l).map(v => v.dest))].sort((a, b) => a.localeCompare(b, "fr"));
  return d.length ? [d[0], d[1] ?? d[0]] : ["", ""];
};
const dirText = (l: string): string => { const d = dirs(l); return d[0] + (d[0] !== d[1] ? " ⇄ " + d[1] : ""); };
/** Date et heure à Strasbourg ; 04h00 et 02h00 sont le début et la fin de journée de service de la CTS : on n'affiche alors que la date */
function moment(iso?: string): { day: string; hm: string; today: boolean; dayOnly: boolean } | null {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const tz = { timeZone: "Europe/Paris" } as const;
  const day = d.toLocaleDateString("fr-FR", { ...tz, day: "2-digit", month: "2-digit" });
  const hm = d.toLocaleTimeString("fr-FR", { ...tz, hour: "2-digit", minute: "2-digit" }).replace(":", "h");
  return { day, hm, today: day === new Date().toLocaleDateString("fr-FR", { ...tz, day: "2-digit", month: "2-digit" }), dayOnly: hm === "04h00" || hm === "02h00" };
}
/** « 15h49 », « le 21/10 à 15h49 » ou « le 21/10 » */
const at = (t: NonNullable<ReturnType<typeof moment>>): string => (t.dayOnly ? `le ${t.day}` : t.today ? t.hm : `le ${t.day} à ${t.hm}`);

/** Heures d'une info trafic : début précis d'un incident et dernière mise à jour */
function msgTimes(m: TrafficMsg): string {
  const start = moment(m.start), upd = moment(m.updated);
  const parts: string[] = [];
  if (m.channel === "disruption" && start) parts.push(`Depuis ${at(start)}`);
  if (upd && (m.channel !== "disruption" || !start || Date.parse(m.updated!) - Date.parse(m.start!) > 60_000)) {
    parts.push(`${m.channel === "disruption" ? "mis à jour" : "Publié"} ${upd.today && !upd.dayOnly ? "à " : ""}${at(upd)}`);
  }
  return parts.join(" · ");
}

/** Une info trafic de la CTS : lignes, titre, heures, période, et le détail repliable */
const msgCard = (m: TrafficMsg, withLines = true): string =>
  `<div class="box" style="display:block;margin-bottom:10px${m.channel === "disruption" ? ";border-color:#E8402F" : ""}">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${m.channel === "disruption" ? '<span class="warn">!</span>' : ""}${withLines ? m.lines.slice(0, 8).map(l => lineChip(l, true)).join("") : ""}<b>${esc(m.title)}</b></div>
    ${msgTimes(m) ? `<small style="display:block;margin-top:4px;font-weight:600">${esc(msgTimes(m))}</small>` : ""}
    ${m.period ? `<small style="color:var(--mute);display:block;margin-top:2px">${esc(m.period)}</small>` : ""}
    ${m.text ? `<details style="margin-top:6px"><summary style="color:var(--mute);cursor:pointer">Détails</summary><p style="white-space:pre-line;margin:8px 0 0">${esc(m.text)}</p></details>` : ""}
  </div>`;

/** Résumé de l'accueil : les deux premières infos trafic (incidents d'abord) */
const pinIcon = (): string => ic("pin", 'width="22" height="22" fill="none" stroke="var(--accent)" stroke-width="2"');

/** En-tête de l'accueil : date, salutation, raccourcis, puis la recherche */
export function header(): string {
  const h = new Date().getHours();
  const hello = h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
  const date = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return `<header class="thead">
    <div class="top">
      <div><small>${esc(date.charAt(0).toUpperCase() + date.slice(1))}</small><h1>${hello}</h1></div>
      <span class="ic"><button data-act="msgs" aria-label="Messages">${ic("mail")}</button><button data-act="prefs" aria-label="Réglages">${ic("sliders")}</button><button data-act="account" aria-label="Compte">${ic("user")}</button></span>
    </div>
  </header>`;
}

export function bar(title: string, back?: string): string {
  return `<div class="bar"><button data-act="${back ?? "closeOverlay"}" aria-label="Retour">${ic("back")}</button><span>${esc(title)}</span></div>`;
}

/* ============ ÉCRANS ============ */
/** Tuile Vélhop : la station choisie (appui long sur la tuile), sinon la plus proche, et ses vélos disponibles */
function bikeTile(): string {
  const chosen = S.bikeStation ? POIS.find(p => p.id === S.bikeStation && p.kind === "velhop") : undefined;
  const st = chosen ? { p: chosen, d: haversine(USER, chosen) }
    : POIS.filter(p => p.kind === "velhop").map(p => ({ p, d: haversine(USER, p) })).sort((a, b) => a.d - b.d)[0];
  const n = st?.p.info?.match(/(\d+)\s*vélo/i)?.[1];
  return `<button class="tile tile-bike" data-act="mapBikes" data-hold="bikepick"><h4>${ic("bike")}Vélhop${chosen ? ` ${ic("star")}` : ""}</h4>${n !== undefined
    ? `<div class="big">${n}<small> vélo${n === "1" ? "" : "s"}</small></div><p>${esc(st!.p.name.replace(/^Vélhop\s*/i, ""))} · ${fmtDist(st!.d)}</p>`
    : `<div class="big sm">Stations</div><p>${st ? esc(st.p.name.replace(/^Vélhop\s*/i, "")) : "Vélos en libre-service"}</p>`}</button>`;
}

/** Choix de la station Vélhop de l'accueil : la plus proche (par défaut), ou une station précise */
export function overlayBikePick(): string {
  const list = POIS.filter(p => p.kind === "velhop").map(p => ({ p, d: haversine(USER, p) })).sort((a, b) => a.d - b.d);
  const row = (id: string, name: string, sub: string, on: boolean): string =>
    `<button class="item${on ? " on" : ""}" data-bikest="${esc(id)}">${markerIcon("velhop", 28)}<span>${esc(name)}<br><small style="color:var(--mute)">${esc(sub)}</small></span>${on ? `<span class="ml pick">${check()}</span>` : ""}</button>`;
  return `<div class="overlay">${bar("Station Vélhop de l’accueil")}<main><div class="pad">
    <p class="src" style="margin:0 0 8px">La tuile Vélhop de l’accueil affiche les vélos disponibles à cette station.</p>
    ${row("", "La plus proche", "Change selon votre position", !S.bikeStation)}
    <div class="sub">Toutes les stations</div>
    ${list.map(({ p, d }) => row(p.id, p.name.replace(/^Vélhop\s*/i, ""), `${p.info ? p.info + " · " : ""}${fmtDist(d)}`, S.bikeStation === p.id)).join("") || '<div class="empty">Stations en cours de chargement…</div>'}
  </div></main></div>`;
}

/** Tuile infos trafic : nombre de perturbations et la première */
function trafficTile(): string {
  if (!MESSAGES.length) {
    const t = MSG_STATE.status === "loading" ? "Chargement…" : MSG_STATE.status === "error" ? "Indisponibles pour le moment" : "Aucune perturbation signalée";
    return `<button class="tile tile-ok" data-act="msgs"><h4>${ic("bell")}Info trafic</h4><p class="msg">${t}</p></button>`;
  }
  const m = MESSAGES[0], n = MESSAGES.length;
  return `<button class="tile tile-alert" data-act="msgs"><h4>${ic("bell")}Info trafic · ${n}</h4>
    <div class="ls">${m.lines.slice(0, 3).map(l => lineChip(l, true)).join("")}</div><p class="msg">${esc(m.title)}</p></button>`;
}

/** Accueil en tuiles : itinéraire, arrêts favoris (prochains passages), info trafic, Vélhop, lignes et services */
export function screenHome(): string {
  const favStops = S.fav.map(stopById).filter((s): s is Stop => !!s);
  // un seul favori, ou le dernier d'un nombre impair : tuile pleine largeur
  const favs = favStops.map((s, i) => `<div class="tile tile-stop${favStops.length % 2 && i === favStops.length - 1 ? " w" : ""}" role="button" tabindex="0" data-stop="${esc(s.id)}">
      <h4>${ic("star")}${esc(s.name)}</h4><div id="fav-${esc(s.id)}"></div></div>`).join("");
  const svc: [string, IconName, string][] = [
    ["Horaires par ligne", "clock", "tab:lines"], ["Parkings relais", "parking", "act:mapParkings"],
    ["Objets perdus", "lost", CTS_OBJETS_TROUVES], ["Aide et contact", "help", "act:help"]
  ];
  return `<div class="pad tiles">
    <button class="tile w tile-go" data-tab="search"><h4>${ic("navigate")}Naviguer</h4><div class="big sm">Où allez-vous ?</div><p>Tram, bus, train, vélo ou à pied, guidé jusqu’à destination</p></button>
    ${favs || `<button class="tile w tile-empty" data-act="favs"><h4>${ic("star")}Vos arrêts</h4><p>Ajoutez vos arrêts favoris : leurs prochains passages s’afficheront ici</p></button>`}
    ${trafficTile()}
    ${bikeTile()}
    <div class="tile w tile-lines"><h4>${ic("tram")}Toutes les lignes</h4><div class="chips">${networkLines().map(chipAlert).join("")}</div></div>
    ${svc.map(([label, icon, to]) => {
      const inner = `<span class="si">${ic(icon)}</span><b>${label}</b>`;
      return to.startsWith("act:") ? `<button class="tile tile-svc" data-act="${to.slice(4)}">${inner}</button>`
        : to.startsWith("tab:") ? `<button class="tile tile-svc" data-tab="${to.slice(4)}">${inner}</button>`
        : `<a class="tile tile-svc" href="${to}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }).join("")}
    <button class="tile-add w" data-act="favs">${ic("plus")}${favStops.length ? "Gérer mes arrêts favoris" : "Ajouter un arrêt favori"}</button>
    <p class="ver w">Kumm v${VERSION}${CONFIG.USE_MOCK ? " · démonstration : données fictives" : ""}</p>
  </div>`;
}

/** Contenu d'une tuile d'arrêt favori : les 3 prochains départs, toutes lignes confondues */
export function favRows(list: StopDeparture[]): string {
  const now = Date.now();
  const rows = list.flatMap(({ d }) => d.times.filter(t => t > now - 30000).slice(0, 1).map(t => ({ d, t })))
    .sort((a, b) => a.t - b.t).slice(0, 3);
  if (!rows.length) return '<p class="none">Aucun passage prévu</p>';
  return rows.map(({ d, t }) => {
    const m = mins(t);
    return `<div class="trow">${lineChip(d.line, true)}<b class="dn">${esc(d.dest)}</b><i class="${m < 2 ? "soon" : ""}${m < 1 ? " q" : ""}">${m < 1 ? "À quai" : m + "′"}</i></div>`;
  }).join("");
}

export function screenSearch(): string {
  const q = fold(S.q);
  const stops = STOPS.filter(s => !q || fold(s.name).includes(q)).slice(0, 40);
  const lines = networkLines().filter(l => !q || l.toLowerCase() === q || dirs(l).some(d => fold(d).includes(q)));
  // lieux de la carte (P+R, Vélhop, Véloparks…) et adresses : chaque résultat mène à l'écran des itinéraires (« Naviguer »)
  const pois = q.length > 1 ? POIS.filter(p => fold(p.name).includes(q)).slice(0, 8) : [];
  const addr = q.length > 2 && S.searchAddr && fold(S.searchAddr.q) === q ? S.searchAddr.items : [];
  // véhicules en circulation, par le code de trajet attribué par Kumm (« hoeb2610241412 », « terelsass830860 ») ou le numéro du train
  const code = q.replace(/\s+/g, "");
  const vehs = code.length > 2 ? [...VEHICLES.values()].filter(v => v.n && (fold(v.n).includes(code) || (v.m === "ter" && /^\d+$/.test(code) && v.n.endsWith(code))))
    .sort((a, b) => fold(a.n!).indexOf(code) - fold(b.n!).indexOf(code) || a.n!.localeCompare(b.n!)).slice(0, 10) : [];
  const goBtn = (ref: string): string => `<button class="sgo" data-goto="${esc(ref)}" aria-label="Naviguer">${ic("navigate")}</button>`;
  const results = !q
    ? `<div class="empty">Cherchez un arrêt, une adresse, un lieu ou un code de trajet (« terelsass830860 »), puis touchez « Naviguer » pour choisir votre itinéraire.<div class="ico">${ic("store")}${ic("bus")}${ic("parking")}${ic("bike")}${ic("clock")}</div></div>`
    : (lines.length ? `<div class="sub">Lignes</div>` + lines.map(l => `<button class="item" data-line="${esc(l)}">${lineChip(l, true)}<span>${esc(dirs(l)[0])} ⇄ ${esc(dirs(l)[1])}</span></button>`).join("") : "") +
      (vehs.length ? `<div class="sub">Véhicules en circulation</div>` + vehs.map(v => `<button class="item" data-follow="${esc(v.id)}">${lineChip(v.line, true)}<span><b>${esc(v.n!)}</b><br><small style="color:var(--mute)">vers ${esc(v.dest)}${v.w ? " · au terminus" : ""}</small></span></button>`).join("") : "") +
      (stops.length ? `<div class="sub">Arrêts</div>` + stops.map(s => `<div class="srow"><button class="item" data-stop="${esc(s.id)}">${pinIcon()}<span>${esc(s.name)}</span><span class="ml">${s.lines.slice(0, 6).map(l => lineChip(l, true)).join("")}</span></button>${goBtn("stop:" + s.id)}</div>`).join("") : "") +
      (pois.length ? `<div class="sub">Lieux</div>` + pois.map(p => `<button class="item" data-poi="${esc(p.id)}">${markerIcon(p.kind, 26)}<span>${esc(p.name)}<br><small style="color:var(--mute)">${esc(KINDS[p.kind].label)}</small></span></button>`).join("") : "") +
      (addr.length ? `<div class="sub">Adresses</div>` + addr.map((a, i) => `<button class="item" data-goto="addr:${i}">${pinIcon()}<span>${esc(a.label)}</span></button>`).join("") : "") +
      (!stops.length && !lines.length && !pois.length && !addr.length && !vehs.length ? `<div class="empty">${q.length > 2 && (!S.searchAddr || fold(S.searchAddr.q) !== q) ? "Recherche…" : `Aucun résultat pour « ${esc(S.q)} »`}</div>` : "");
  return `<div class="bar" style="padding:calc(10px + var(--safe-top)) 14px 10px"><div class="search" style="flex:1"><input id="sq" value="${esc(S.q)}" placeholder="Arrêt, adresse, lieu…" autocomplete="off"><span class="go">${ic("search")}</span></div></div>
  <div class="pad" style="padding-top:6px">
    <button class="box" style="border:0;background:none;padding:6px 0;font-size:24px" data-tab="lines"><span>Voir toutes les lignes</span>${ic("chev", 'width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"')}</button>
    ${results}
  </div>`;
}

export function screenLines(): string {
  return bar("Toutes les lignes", "tabHome") + `<div class="pad">${networkLines().map(l => `<button class="item" data-line="${esc(l)}">${lineChip(l)}<span>${esc(dirText(l))}<br><small style="color:var(--mute)">${isTram(l) ? "Tram" : "Bus"}</small></span>${hasAlert(l) ? '<span class="ml"><span class="warn" aria-label="Perturbation">!</span></span>' : ""}</button>`).join("")}</div>`;
}

export const layerCounts = (): Record<Layer, number> => {
  const c: Record<Layer, number> = { tram: 0, bus: 0, ter: 0, velhop: 0, velopark: 0, pr: 0, flexhop: 0 };
  STOPS.forEach(s => { c[kindOfStop(s)]++; });
  POIS.forEach(p => { c[p.kind]++; });
  return c;
};

export function screenNearby(): string {
  // ouvert en grand : le panneau s'arrête sous la recherche et les filtres, sa poignée reste toujours touchable
  const h = S.sheet === 2 ? "calc(100% - 132px - var(--safe-top))" : `calc(${S.sheet === 0 ? "64px" : "42%"} + var(--navh, 0px))`;
  const inView = (p: { x: number; y: number }): boolean => p.x > -10 && p.x < 370 && p.y > -10 && p.y < 450;
  const stopPins = STOPS
    .filter(s => {
      const k = kindOfStop(s);
      return S.layers[k] && (S.filter === "all" || (S.filter === "tram" ? k === "tram" : k === "bus"));
    })
    .filter(inView).slice(0, 90)
    .map(s => marker(kindOfStop(s), s.x, s.y, `data-stop="${esc(s.id)}"`)).join("");
  const poiPins = POIS.filter(p => S.layers[p.kind] && inView(p)).slice(0, 120)
    .map(p => marker(p.kind, p.x, p.y, `data-poi="${esc(p.id)}"`)).join("");
  const counts = layerCounts();
  const chips = LAYERS.map(k => `<button class="lyr ${S.layers[k] ? "on" : ""} ${!CONFIG.USE_MOCK && !counts[k] ? "nodata" : ""}" data-layer="${k}" aria-pressed="${S.layers[k]}">${markerIcon(k, 24)}<span>${KINDS[k].label}</span></button>`).join("");
  const background = CONFIG.USE_MOCK
    ? `<svg class="m" viewBox="0 0 360 440" preserveAspectRatio="xMidYMid slice">${MAPPATHS}${S.filter === "bus" ? "" : mapRoutes()}
      ${stopPins}${poiPins}
      <circle cx="170" cy="222" r="14" fill="#4A90E2" opacity=".25"><animate attributeName="r" values="8;20;8" dur="2.4s" repeatCount="indefinite"/></circle><circle cx="170" cy="222" r="7" fill="#4A90E2" stroke="#fff" stroke-width="2.500"/>
    </svg>`
    : `<div id="livemap-slot"></div><span class="osm" style="bottom:calc(${h} + 4px)">© OpenStreetMap</span>`;
  return `<div class="map">
    ${background}
    <button class="msearch" data-tab="search">${ic("search")}<span>Où allez-vous ?</span></button>
    <div class="layers">${chips}</div>
    <div class="mapbtns"><div class="tools"><button data-act="prefs" aria-label="Réglages">${ic("gear", 'stroke="currentColor"')}</button><button data-act="locate" aria-label="Me localiser">${ic("target", 'stroke="var(--accent)"')}</button></div>
    ${CONFIG.USE_MOCK ? "" : `<div class="tools zoom"><button data-act="zoomIn" aria-label="Zoomer">${ic("plus", 'stroke="currentColor"')}</button><button data-act="zoomOut" aria-label="Dézoomer">${ic("minus", 'stroke="currentColor"')}</button></div>`}</div>
    <div class="sheet${S.sheet === 0 ? " min" : ""}" style="height:${h}">
      <button class="grab" data-act="sheet" aria-label="${S.sheet === 0 ? "Afficher les passages" : "Réduire"}">${ic(S.sheet === 0 ? "up" : "down")}</button>
      ${S.follow ? followPanel(S.follow) : `<h3 class="shead"${S.sheet === 0 ? ' data-act="sheet"' : ""}>À proximité</h3>
      <div class="seg pills">
        <button data-f="all" class="${S.filter === "all" ? "on" : ""}">Tout</button>
        <button data-f="tram" class="${S.filter === "tram" ? "on" : ""}">${ic("tram")}Tram</button>
        <button data-f="bus" class="${S.filter === "bus" ? "on" : ""}">${ic("bus")}Bus</button>
      </div>
      <div class="list" id="nearlist"></div>`}
    </div>
  </div>`;
}

/** Fiche d'un tram ou bus en circulation : destination et prochains arrêts */
/** Arrêts à venir du véhicule suivi (le panneau est mis à jour chaque seconde par la carte, voir livemap.ts) */
export function followStops(next: [string, number][]): string {
  return next.length
    ? next.map(([name, m]) => `<div class="stopline vn"><span class="d"></span><span class="r">${esc(name)}</span><b>${m < 1 ? "à l'approche" : m + " min"}</b></div>`).join("")
    : '<div class="empty">Arrivée au terminus.</div>';
}

/** Écart avec l'horaire prévu, d'après la position partagée par un voyageur */
export const delayText = (sec: number): string => {
  const m = Math.round(sec / 60);
  return m >= 1 ? `${m} min de retard sur l’horaire annoncé` : m <= -1 ? `${-m} min d’avance sur l’horaire annoncé` : "à l’heure";
};


/** Panneau « À proximité » remplacé par le véhicule suivi : ligne, trajet, prochain arrêt, état, prochains arrêts */
function followPanel(f: { id: string; paused: boolean }): string {
  const v = VEHICLES.get(f.id);
  if (!v) return `<h3>Véhicule</h3><div class="empty">Ce véhicule n'est plus en circulation.</div>`;
  const info = followInfo(v), first = info.next[0];
  return `<div class="fhead">${lineChip(v.line)}<div class="ft"><b>vers ${esc(v.dest)}</b>${v.n ? `<small class="fcode" data-hold="copy:${esc(v.n)}">Trajet ${esc(v.n)}</small>` : ""}</div>
      <button class="fclose" data-act="unfollow" aria-label="Arrêter de suivre"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    ${v.g ? `<div class="fshared"><span class="ride-dot"></span>Position partagée par un voyageur à bord${v.d !== undefined ? ` · ${delayText(v.d)}` : ""}</div>` : ""}
    ${v.x ? `<div class="fstall"><b>Immobilisé depuis ${Math.max(1, Math.round((serverNow() - v.x) / 60000))} min</b><small>La CTS repousse sans cesse son arrivée au prochain arrêt : panne, accident ou bouchon. Position estimée au moment où il s’est arrêté.</small></div>` : ""}
    <div class="fstats">
      <div><b id="fv-next">${first ? (first[1] < 1 ? "< 1 min" : first[1] + " min") : "—"}</b><small id="fv-nextname">${first ? esc(first[0]) : "terminus"}</small></div>
      <div class="fstate"><b id="fv-state">${esc(info.state)}</b></div>
    </div>
    ${S.journey?.detail.id === v.id ? `<div class="ftrip"><span>${ic("bell", 'width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"')}Alerte avant ${esc(S.journey.detail.calls[S.journey.alight]?.name ?? "")}</span><button class="stop" data-jstop="1">Arrêter</button></div>` : ""}
    ${f.paused ? `<button class="go fre" data-act="refollow">${ic("target", 'stroke="currentColor"')} Suivre de nouveau</button>` : ""}
    <div class="list"><div style="position:relative;--c:${COLORS[lineLabel(v.line)] ?? "#1296A8"}"><div class="rail"></div><div id="fv-stops">${followStops(info.next)}</div></div>
      <small class="src" style="display:block;margin-top:10px">Position estimée d'après les horaires ${v.m === "ter" ? "de la SNCF" : "de la CTS"} : ce n'est pas un GPS.</small></div>`;
}

export function overlayVehicle(id: string): string {
  const v = VEHICLES.get(id);
  if (!v) return `<div class="overlay">${bar("Véhicule")}<main><div class="pad"><div class="empty">Ce véhicule n'est plus en circulation.</div></div></main></div>`;
  const now = serverNow();
  const next = v.next.filter(([, t]) => t > now).map(([name, t]) => {
    const m = Math.max(0, Math.round((t - now) / 60000));
    return `<div class="stopline vn"><span class="d"></span><span class="r">${esc(name)}</span><b>${m < 1 ? "à l'approche" : m + " min"}</b></div>`;
  }).join("");
  const wait = v.w ? Math.max(0, Math.round((v.a[2] - now) / 60000)) : null;
  return `<div class="overlay">${bar(v.m === "ter" ? "Train TER" : "Ligne " + lineLabel(v.line))}<main><div class="pad">
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:6px">${lineChip(v.line)}<b style="font-size:18px">vers ${esc(v.dest)}</b></div>
    ${v.g ? `<div class="fshared" style="margin:0 0 10px"><span class="ride-dot"></span>Position partagée par un voyageur à bord${v.d !== undefined ? ` · ${delayText(v.d)}` : ""}</div>` : ""}
    ${v.x ? `<div class="fstall"><b>Immobilisé depuis ${Math.max(1, Math.round((serverNow() - v.x) / 60000))} min</b><small>La CTS repousse sans cesse son arrivée au prochain arrêt : panne, accident ou bouchon. Position estimée au moment où il s’est arrêté.</small></div>` : ""}
    ${wait !== null ? `<div class="box vwait"><b>Au terminus</b><span>Départ ${wait < 1 ? "imminent" : `dans ${wait} min`}</span></div>` : ""}
    ${v.n ? `<div class="vno" data-hold="copy:${esc(v.n)}">Trajet <b>${esc(v.n)}</b><small>${v.m === "ter" ? "TER d’Alsace (Elsàss en alsacien) et numéro du train." : "Terminus de départ, ligne, date et heure de départ prévue."}</small></div>` : ""}
    <small class="src" style="display:block;margin-bottom:14px">Position estimée d'après les horaires ${v.rt ? "en temps réel" : "théoriques (pas de suivi en direct pour ce véhicule)"} ${v.m === "ter" ? "de la SNCF" : "de la CTS"} : ce n'est pas un GPS.</small>
    ${messagesFor(v.line).map(m => `<button class="box" data-act="msgs" style="display:flex;gap:10px;align-items:center;margin-bottom:10px;text-align:left${m.channel === "disruption" ? ";border-color:#E8402F" : ""}"><span class="warn">!</span><span style="flex:1"><b>${esc(m.title)}</b>${m.period ? `<br><small style="color:var(--mute)">${esc(m.period)}</small>` : ""}</span></button>`).join("")}
    <div class="sub" style="margin-top:0">Prochains arrêts</div>
    <div style="position:relative;--c:${COLORS[lineLabel(v.line)] ?? "#1296A8"}"><div class="rail"></div>${next || '<div class="empty">Arrivée au terminus.</div>'}</div>
  </div></main></div>`;
}

export function overlayPoi(id: string): string {
  const p = POIS.find(x => x.id === id);
  if (!p) return "";
  return `<div class="overlay">${bar(p.name)}<main><div class="pad">
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">${markerIcon(p.kind, 44)}<b style="font-size:19px">${KINDS[p.kind].label}</b></div>
    ${p.info ? `<div class="box" style="margin-bottom:14px"><span>${esc(p.info)}</span></div>` : ""}
    <button class="go" data-poitrip="${esc(p.id)}">${ic("navigate", 'width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"')}Naviguer</button>
  </div></main></div>`;
}

/* ---------- itinéraires ---------- */
export const nearestStops = (n: number, from: LL = USER): { s: Stop; d: number }[] =>
  STOPS.map(s => ({ s, d: haversine(from, s) })).sort((x, y) => x.d - y.d).slice(0, n);


function suggestionsHtml(): string {
  const sg = S.trip.sugg;
  if (!sg) return "";
  const me = sg.field === "from" ? `<button class="item" data-sg="me">${ic("target", 'width="22" height="22" fill="none" stroke="var(--accent)" stroke-width="2"')}<span>Ma position</span></button>` : "";
  const items = sg.items.map((p, i) => `<button class="item" data-sg="${i}">${p.stop ? pinIcon() : ic("map", 'width="22" height="22" fill="none" stroke="#7A8087" stroke-width="2"')}<span>${esc(p.label)}</span>${p.stop ? `<span class="ml">${p.stop.lines.slice(0, 4).map(l => lineChip(l, true)).join("")}</span>` : ""}</button>`).join("");
  return me + (items || `<div class="empty" style="padding:24px">Recherche…</div>`);
}

/** Repli si le calculateur est injoignable : lignes directes d'après les arrêts connus */
export async function directLineCards(origin: Place, dest: Place): Promise<{ lines: PlanCtx["lines"]; cards: { score: number; html: string }[] }> {
  const lines: PlanCtx["lines"] = {};
  const cards: { score: number; html: string }[] = [];
  const near = nearestStops(20, origin).filter(x => x.d < 1500);
  const destNear = nearestStops(40, dest).filter(x => x.d < 800);
  for (const { s: board, d: dBoard } of near) {
    for (const l of board.lines) {
      if (lines[l]) continue;
      const alt = destNear.find(x => x.s.lines.includes(l) && x.s.name !== board.name);
      if (!alt) continue;
      lines[l] = { board, alight: alt.s };
      const deps = (await nextDepartures(board)).filter(x => x.line === l).sort((x, y) => x.times[0] - y.times[0]);
      cards.push({
        score: dBoard + alt.d,
        html: `<div class="trip"><div class="top"><span style="display:flex;gap:10px;align-items:center">${lineChip(l)}<b style="font-size:18px">${esc(board.name)}</b></span><span style="color:var(--mute)">🚶 ~${walkMin(dBoard)} min</span></div>`
          + (deps.length ? deps.slice(0, 2).map(x => `<div style="display:flex;justify-content:space-between;margin-top:6px;gap:8px"><span>vers <b>${esc(x.dest)}</b></span><span style="white-space:nowrap">${x.times.slice(0, 2).map(t => mins(t) + " min").join(" · ")}</span></div>`).join("") : '<small style="color:var(--mute)">Aucun passage prévu</small>')
          + `<div class="legs" style="margin-top:8px"><small>Descendre à ${esc(alt.s.name)}, puis 🚶 ~${walkMin(alt.d)} min jusqu’à la destination</small></div>`
          + `<div class="acts"><button class="go" data-nav="board:${esc(l)}">Démarrer la navigation</button></div></div>`
      });
    }
  }
  cards.sort((a, b) => a.score - b.score);
  return { lines, cards };
}

/** Étapes à afficher : une marche de quelques mètres (changement de quai) n'apporte rien */
const shownLegs = (j: Journey): JLeg[] => j.legs.filter(l => l.kind !== "walk" || (l.distance ?? 999) >= 50 || l.duration >= 120);

/** Détail d'un trajet choisi : chaque étape, puis le guidage */
function journeySteps(j: Journey, i: number): string {
  const steps = shownLegs(j).map(l => {
    if (l.kind === "walk") return `<div class="jl"><span class="jw">${ic("walk")}</span><span>${minutes(l.duration)} min à pied${l.distance ? ` · ${fmtDist(l.distance)}` : ""}</span></div>`;
    return `<div class="jl"><span>${lineChip(l.line ?? "?", true)}</span><span><b>${esc(l.from.name)}</b> ${hm(l.start)} → <b>${esc(l.to.name)}</b> ${hm(l.end)}<br><small style="color:var(--mute)">${l.headsign ? `vers ${esc(l.headsign)} · ` : ""}${minutes(l.duration)} min${l.stops ? ` · ${l.stops + 1} arrêts` : ""}${l.realTime ? " · temps réel" : ""}</small></span></div>`;
  }).join("");
  return `<div class="jdet">${steps}<div class="acts"><button class="go" data-nav="j:${i}">Démarrer la navigation</button></div></div>`;
}

/** Une ligne de la liste des trajets : horaires, durée, enchaînement des lignes ; touchée, elle s'affiche sur la carte */
function journeyRow(j: Journey, i: number): string {
  const on = i === S.trip.sel;
  const chev = '<span class="jc">›</span>';
  const chain = shownLegs(j).map(l => l.kind === "walk" ? `<span class="jwk">${ic("walk")}<small>${minutes(l.duration)}</small></span>` : lineChip(l.line ?? "?", true)).join(chev);
  const first = j.legs.find(l => l.kind !== "walk");
  const live = j.legs.some(l => l.kind !== "walk" && l.realTime);
  const info = first ? `Départ ${hm(first.start)} de ${esc(first.from.name)}${live ? " · temps réel" : ""}` : "";
  return `<button class="jrow${on ? " on" : ""}" data-sel="${i}">
      <span class="jr1"><b>${hm(j.start)} – ${hm(j.end)}</b><b>${fmtDur(j.duration)}</b></span>
      <span class="jr2">${chain}</span>
      <small>${info}${j.transfers ? ` · ${j.transfers} correspondance${j.transfers > 1 ? "s" : ""}` : " · direct"}</small>
    </button>${on ? journeySteps(j, i) : ""}`;
}

/** Durée affichée dans l'onglet d'un mode */
function modeDuration(mode: "transit" | "walk" | "bike"): string {
  const t = TRIP;
  if (!t) return "";
  const part = t[mode];
  if (part.status === "loading" && !part.data) return "…";
  if (mode === "transit") { const d = t.transit.data ?? []; return d.length ? fmtDur(Math.min(...d.map(j => j.duration))) : "–"; }
  if (mode === "walk") return t.walk.data ? fmtDur(t.walk.data.duration) : "–";
  return t.bike.data?.length ? fmtDur(t.bike.data[0].duration) : "–";
}

const calculating = '<div class="empty" style="padding:24px">Calcul de l’itinéraire…</div>';

/** Liste sous la carte, pour le mode choisi */
function tripList(): string {
  const t = TRIP;
  if (!t) return calculating;
  if (S.trip.mode === "walk") {
    if (!t.walk.data) return t.walk.status === "loading" ? calculating : `<div class="empty">Itinéraire à pied indisponible (${esc(t.walk.error ?? "")})</div>`;
    const r = t.walk.data;
    return `<div class="jrow on"><span class="jr1"><b>${fmtDur(r.duration)} <span class="jm">(${fmtDist(r.distance)})</span></b></span><small>Itinéraire guidé, virage par virage</small></div>
      <div class="jdet"><div class="acts"><button class="go" data-nav="walk">Démarrer</button></div></div>`;
  }
  if (S.trip.mode === "bike") {
    if (!t.bike.data?.length) return t.bike.status === "loading" ? calculating : `<div class="empty">Itinéraire vélo indisponible (${esc(t.bike.error ?? "")})</div>`;
    return t.bike.data.map((r, i) => {
      const on = i === S.trip.sel;
      return `<button class="jrow${on ? " on" : ""}" data-sel="${i}"><span class="jr1"><b>${fmtDur(r.duration)} <span class="jm">(${fmtDist(r.distance)})</span></b><small>${i === 0 ? "le plus rapide" : "autre itinéraire"}</small></span><small>${r.steps.length} consignes · pistes et voies cyclables d’OpenStreetMap</small></button>`
        + (on ? `<div class="jdet"><div class="acts"><button class="go" data-bikenav="${i}">Démarrer à vélo</button></div></div>` : "");
    }).join("");
  }
  const list = t.transit.data ?? [];
  if (list.length) {
    return list.map(journeyRow).join("") + `<small class="src">Horaires du réseau et temps réel : Transitous (données ouvertes).${t.transit.status === "error" ? " Mise à jour impossible : derniers trajets connus." : ""}</small>`;
  }
  if (t.transit.status === "loading") return calculating;
  const why = t.transit.status === "error"
    ? `Calculateur d'itinéraires injoignable (${esc(t.transit.error ?? "")}) : seules les lignes directes sont proposées.`
    : "Aucun trajet en transports trouvé : voici les lignes directes proches.";
  return `<small class="src" style="display:block;margin-bottom:10px">${why}</small>` + (t.fallback ?? calculating);
}

/** « Partir maintenant », « Partir à 08:00 », « Arriver avant 08:00 · demain » */
function whenLabel(w: { kind: "now" | "depart" | "arrive"; at: number }): string {
  if (w.kind === "now") return "Partir maintenant";
  const d = new Date(w.at), now = new Date();
  const hmTxt = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day) / 864e5);
  const when = diff === 0 ? "" : diff === 1 ? " · demain" : ` · ${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}`;
  return `${w.kind === "arrive" ? "Arriver avant" : "Partir à"} ${hmTxt}${when}`;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Panneau du bas : heure du trajet en transports (affiché par-dessus l'écran, voir main.ts) */
export function whenSheet(): string {
  const w = S.trip.whenDraft;
  if (!w) return "";
  const d = new Date(w.at);
  const kinds = [["now", "Maintenant"], ["depart", "Partir à"], ["arrive", "Arriver avant"]] as const;
  return `<div class="wback" data-act="whenClose"></div><div class="wsheet" role="dialog" aria-label="Heure du trajet">
    <b class="wtitle">Heure du trajet</b>
    <div class="wtabs">${kinds.map(([k, l]) => `<button data-wk="${k}" class="${w.kind === k ? "on" : ""}">${l}</button>`).join("")}</div>
    ${w.kind === "now" ? `<p class="wnow">Trajets au départ dès maintenant, avec les horaires en temps réel.</p>` : `
    <div class="wpick">
      <input id="wdate" type="date" value="${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}" aria-label="Date">
      <input id="wtime" type="time" value="${pad2(d.getHours())}:${pad2(d.getMinutes())}" aria-label="Heure">
    </div>
    <div class="wquick"><button data-wq="15">+15 min</button><button data-wq="60">+1 h</button><button data-wq="t8">Demain 8h</button></div>`}
    <button class="go wok" data-act="whenOk">Valider</button>
  </div>`;
}

export function screenTrips(): string {
  const t = S.trip, mock = CONFIG.USE_MOCK;
  const pin = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" fill="#E8402F"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>';
  const form = `<div class="thead">
    <button class="tback" data-act="tabHome" aria-label="Retour">${ic("back")}</button>
    <div class="trail"><i class="tdot"></i><i class="tline"></i>${pin}</div>
    <div class="tinputs">
      <input id="tfrom" value="${esc(t.fromText)}" placeholder="Départ" autocomplete="off" ${mock ? "readonly" : ""}>
      <input id="tto" value="${esc(t.toText)}" placeholder="Où voulez-vous aller ?" autocomplete="off">
    </div>
    <button class="tswap" data-act="swap" aria-label="Inverser départ et destination" ${mock ? "disabled" : ""}>${ic("swap")}</button>
  </div>`;
  if (mock) {
    const has = t.toText.trim().length > 1;
    return form + `<div class="pad">${has ? `<div id="trips"></div>` : `<div class="empty" style="font-weight:700;padding-top:90px;font-size:20px">Aucun itinéraire trouvé</div>`}</div>`;
  }
  if (t.sugg) return form + `<div class="pad">${suggestionsHtml()}</div>`;
  if (!tripReady()) return form + `<div class="empty" style="padding-top:70px">Choisissez un départ (adresse ou « Ma position ») et une destination.</div>`;
  const modes: { id: "transit" | "walk" | "bike"; icon: IconName; label: string }[] = [
    { id: "transit", icon: "tram", label: "Transports" }, { id: "walk", icon: "walk", label: "À pied" }, { id: "bike", icon: "bike", label: "Vélo" }
  ];
  const whenRow = t.mode !== "transit" ? "" : `<div class="twhen"><button class="twchip" data-act="when">${ic("clock")}<span>${esc(whenLabel(t.when))}</span><b>▾</b></button></div>`;
  const tabs = `<div class="tmodes">${modes.map(m => `<button data-mode="${m.id}" class="${t.mode === m.id ? "on" : ""}" aria-label="${m.label}">${ic(m.icon)}<span>${modeDuration(m.id)}</span></button>`).join("")}</div>`;
  return form + tabs + whenRow + `<div class="tmap"><div id="tripmap-slot"></div><span class="osm">© OpenStreetMap</span></div><div class="pad tlist">${tripList()}</div>`;
}

/** Résultats d'exemple (mode démo uniquement) */
export function tripsDemo(): string {
  const now = new Date(), f = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const opts = [{ l: ["D"], w: 4, m: 18, c: 0 }, { l: ["A", "C"], w: 6, m: 24, c: 1 }, { l: ["B"], w: 9, m: 27, c: 0 }];
  const chev = ic("chev", 'width="14" height="14" fill="none" stroke="#888" stroke-width="3"');
  return opts.map((o, i) => {
    const dep = new Date(now.getTime() + (3 + i * 6) * 60000), arr = new Date(dep.getTime() + o.m * 60000);
    return `<div class="trip"><div class="top"><b>${o.m} min</b><span style="color:var(--mute)">${f(dep)} → ${f(arr)}</span></div>
      <div class="tl"><i style="flex:${o.w};background:#B9BEC4"></i>${o.l.map(l => `<i style="flex:${(o.m - o.w - 3) / o.l.length};background:${COLORS[l]};color:${lineText(l)}">${l}</i>`).join("")}<i style="flex:3;background:#B9BEC4"></i></div>
      <div class="legs"><small>🚶 ${o.w} min</small>${o.l.map(l => `${chev}${lineChip(l, true)}`).join("")}${chev}<small>🚶 3 min</small></div>
      <small style="color:var(--mute)">${o.c ? "1 correspondance" : "Direct"}</small></div>`;
  }).join("") + `<small style="color:var(--mute)">Itinéraires de démonstration.</small>`;
}

/* ============ ÉCRANS SUPERPOSÉS ============ */
/** Arrêt de l'application pour un quai d'un parcours : par son code, sinon par son nom */
function stopForCall(code: string, name: string): Stop | undefined {
  return STOPS.find(s => s.quays?.some(q => q.code === code)) ?? STOPS.find(s => stopKey(s.name) === stopKey(name));
}

/** Tronçons d'une ligne coupée, dans l'ordre du trajet : le terminus de l'un est au plus près du départ du suivant */
function orderParts(parts: LineRoute[]): LineRoute[] {
  if (parts.length < 2) return parts;
  const at = (p: LineRoute, i: number): Stop | undefined => stopForCall(p.codes.at(i)!, p.names.at(i)!);
  const gap = (a: LineRoute, b: LineRoute): number => {
    const x = at(a, -1), y = at(b, 0);
    return x && y ? Math.hypot(x.lat - y.lat, (x.lon - y.lon) * 0.66) : 1;
  };
  const best = (rest: LineRoute[], seq: LineRoute[]): { seq: LineRoute[]; d: number } => !rest.length ? { seq, d: 0 }
    : rest.map(p => { const r = best(rest.filter(q => q !== p), [...seq, p]); return { seq: r.seq, d: r.d + (seq.length ? gap(seq.at(-1)!, p) : 0) }; })
      .reduce((a, b) => (b.d < a.d ? b : a));
  return parts.length > 5 ? parts : best(parts, []).seq;
}

export function overlayLine(l: string): string {
  const r = LINE_ROUTES[l];
  const route = r?.main[Math.min(S.lineDir, r.main.length - 1)];
  const row = (id: string | undefined, name: string): string => id
    ? `<button class="stopline" style="width:100%;text-align:left" data-stop="${esc(id)}"><span class="d"></span><span class="r">${esc(name)}</span></button>`
    : `<div class="stopline"><span class="d"></span><span class="r">${esc(name)}</span></div>`;
  let list: string, title = dirText(l);
  if (route) {
    const parts = orderParts([route, ...(route.extra ?? [])]);
    const rail = (p: LineRoute): string => {
      // un arrêt une seule fois, même si la CTS en donne deux quais à la suite
      const rows: { id?: string; name: string }[] = [];
      p.codes.forEach((c, i) => { const s = stopForCall(c, p.names[i]), name = s?.name ?? p.names[i];
        if (rows.at(-1)?.name !== name) rows.push({ id: s?.id, name }); });
      return `<div style="position:relative;margin-top:10px"><div class="rail"></div>${rows.map(x => row(x.id, x.name)).join("")}</div>`;
    };
    const lastDest = (m: LineRoute): string => orderParts([m, ...(m.extra ?? [])]).at(-1)!.dest;
    title = `${parts[0].from} ⇄ ${lastDest(route)}`;
    const others = r.other.filter(o => !r.main.some(m => m.from === o.from && m.dest === o.dest));
    list = (r.main.length > 1 ? `<div class="ldirs" role="group" aria-label="Sens">${r.main.map((m, i) =>
      `<button data-ldir="${i}" class="${m === route ? "on" : ""}">vers ${esc(lastDest(m))}</button>`).join("")}</div>` : "") +
      (parts.length > 1 ? `<p class="src" style="margin-top:12px">La ligne circule en ${parts.length} tronçons séparés (travaux ou perturbation).</p>` : "") +
      parts.map((p, i) => (i ? `<div class="sub" style="margin-top:16px">Tronçon ${i + 1} : ${esc(p.from)} → ${esc(p.dest)}</div>` : parts.length > 1 ? `<div class="sub" style="margin-top:12px">Tronçon 1 : ${esc(p.from)} → ${esc(p.dest)}</div>` : "") + rail(p)).join("") +
      (others.length ? `<p class="src" style="margin-top:14px">Certains passages font un autre parcours : ${others.map(o => `${esc(o.from)} → ${esc(o.dest)}`).join(" ; ")}.</p>` : "");
  } else if (!r) list = `<div class="empty">Chargement du parcours…</div>`;
  else {
    // parcours pas encore connu du serveur (ligne qui n'a pas circulé depuis sa mise en route) : liste sans ordre
    const stops = STOPS.filter(s => s.lines.includes(l));
    list = `<p class="src" style="margin-top:10px">${r.failed ? "Parcours indisponible pour le moment" : "Ordre des arrêts pas encore connu"} : arrêts desservis, par ordre alphabétique.</p>
      <div style="position:relative;margin-top:10px"><div class="rail"></div>${stops.map(s => row(s.id, s.name)).join("")}</div>`;
  }
  return `<div class="overlay" style="--c:${COLORS[l] ?? "#777"}">${bar("Ligne " + l)}
   <main><div class="pad"><div style="display:flex;gap:12px;align-items:center;margin-bottom:6px">${lineChip(l)}<b style="font-size:18px">${esc(title)}</b></div>
   ${messagesFor(l).length ? `<div style="margin:10px 0">${messagesFor(l).map(m => msgCard(m, false)).join("")}</div>` : ""}
   ${list}</div></main></div>`;
}

export function overlayStop(id: string): string {
  const s = stopById(id);
  if (!s) return "";
  const fav = S.fav.includes(id);
  return `<div class="overlay">${bar(s.name)}
   <main><div class="pad"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px"><span style="display:flex;align-items:center;gap:8px;font-weight:700;flex:1">${markerIcon(kindOfStop(s), 30)}${esc(stopLabel(s))}</span><span style="flex:1;display:flex;gap:6px;flex-wrap:wrap${s.lines.length > 5 ? ";order:3;flex-basis:100%" : ""}">${s.lines.slice(0, 12).map(l => lineChip(l, true)).join("")}</span>
   <button class="star ${fav ? "on" : ""}" data-fav="${esc(id)}" aria-label="Favori">${ic("heart")}</button></div>
   <button class="go" data-goto="stop:${esc(id)}" style="margin:0 0 14px">${ic("navigate", 'width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"')}Naviguer</button><div id="stopdeps"></div></div></main></div>`;
}

export function overlayMsgs(): string {
  const dis = MESSAGES.filter(m => m.channel === "disruption"), works = MESSAGES.filter(m => m.channel === "works");
  const empty = MSG_STATE.status === "loading" ? "Chargement…" : MSG_STATE.status === "error" ? "Infos trafic indisponibles pour le moment." : "Aucune perturbation signalée.";
  return `<div class="overlay">${bar("Infos trafic")}<main><div class="pad">
    ${dis.length ? `<div class="sub" style="margin-top:4px">Incidents en cours</div>${dis.map(m => msgCard(m)).join("")}` : ""}
    ${works.length ? `<div class="sub">Travaux et changements</div>${works.map(m => msgCard(m)).join("")}` : ""}
    ${MESSAGES.length ? "" : `<div class="empty">${empty}</div>`}
    <button class="go" data-act="prefs" style="margin:6px 0 12px">🔔 ${S.alerts.enabled ? "Gérer mes alertes" : "Recevoir une alerte en cas de perturbation"}</button>
    <small style="color:var(--mute);display:block">${CONFIG.USE_MOCK ? "Messages fictifs (mode démonstration)." : "Source : CTS, infos trafic en temps réel (mises à jour toutes les 5 minutes)."}</small></div></main></div>`;
}

const ext = (href: string, label: string, sub: string, icon: IconName): string =>
  `<a class="box hlink" href="${esc(href)}" target="_blank" rel="noopener noreferrer"><span class="hl-i">${ic(icon)}</span><span style="flex:1"><b>${esc(label)}</b><small>${esc(sub)}</small></span>${ic("chev", 'width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"')}</a>`;
const act = (a: string, label: string, sub: string, icon: IconName): string =>
  `<button class="box hlink" data-act="${a}"><span class="hl-i">${ic(icon)}</span><span style="flex:1;text-align:left"><b>${esc(label)}</b><small>${esc(sub)}</small></span>${ic("chev", 'width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"')}</button>`;

/** « Mon compte » : Kumm ne demande aucun compte ; tout reste sur le téléphone. Le compte Badgéo se gère chez la CTS. */
export function overlayAccount(): string {
  return `<div class="overlay">${bar("Mon compte")}<main><div class="pad">
    <div class="box" style="display:block;margin-bottom:16px"><b>Pas besoin de compte</b><p style="margin:6px 0 0;color:var(--mute)">Vos favoris, vos alertes et vos réglages restent sur ce téléphone. Kumm ne demande ni nom, ni adresse e-mail, ni mot de passe.</p></div>
    ${act("favs", "Mes arrêts favoris", `${S.fav.length} arrêt${S.fav.length > 1 ? "s" : ""} affiché${S.fav.length > 1 ? "s" : ""} à l’accueil`, "heart")}
    ${act("prefs", "Alertes et réglages", S.alerts.enabled ? "Alertes trafic activées" : "Thème, alertes trafic, présentation", "sliders")}
    <div class="sub">Compte CTS (carte Badgéo, abonnements)</div>
    ${ext(isIOS() ? CTS_APP_IOS : CTS_APP_ANDROID, "Application officielle CTS", "Votre compte, vos titres et votre carte Badgéo", "ticket")}
  </div></main></div>`;
}

/** « FAQ / Contact » : questions fréquentes sur Kumm, contact de Kumm, et aide de la CTS pour les titres de transport */
export function overlayHelp(): string {
  const qa: [string, string][] = [
    ["Les horaires sont-ils en temps réel ?", "Oui quand la CTS ou la SNCF les publient en temps réel (petit signal à côté des minutes) ; sinon ce sont les horaires prévus."],
    ["La position des trams, bus et trains est-elle un GPS ?", "Non : elle est estimée d’après les horaires. Quand un voyageur partage son trajet, la position devient réelle pour tout le monde."],
    ["Comment aller quelque part ?", "Cherchez un arrêt, une adresse ou un lieu dans Recherche, puis touchez « Naviguer » : transports, à pied ou à vélo."],
    ["Kumm vend-il des billets ?", "Non. Les titres de transport s’achètent dans l’application officielle de la CTS, en agence ou dans les points de vente."],
    ["Mes données sont-elles collectées ?", "Non : pas de compte, pas de publicité, pas de pistage. Le détail est dans la page confidentialité."]
  ];
  return `<div class="overlay">${bar("FAQ et contact")}<main><div class="pad">
    ${qa.map(([q, a]) => `<details class="box faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}
    <div class="sub">Contacter Kumm</div>
    ${ext("mailto:" + KUMM_CONTACT + "?subject=Kumm", "Écrire à Kumm", KUMM_CONTACT + " · un bug, une idée, une question sur l’application", "mail")}
    <div class="sub">Titres de transport, carte Badgéo, réclamations</div>
    ${ext(CTS_FAQ, "Aide de la CTS", "Questions fréquentes sur le réseau et les abonnements", "help")}
    ${ext(CTS_CONTACT, "Contacter la CTS", "Pour tout ce qui concerne les titres de transport et le réseau", "phone")}
    <p class="src" style="margin-top:14px">Kumm est une application indépendante, non affiliée à la CTS.</p>
  </div></main></div>`;
}

/** Réglage d'un widget de l'écran d'accueil : arrêt (puis ligne et direction pour « Mon trajet »), ou station Vélhop / P+R */
export function overlayWidget(): string {
  const w = S.wsetup;
  if (!w) return "";
  const q = fold(w.q);
  const search = (ph: string): string => `<div class="search" style="margin-bottom:12px"><input id="wq" value="${esc(w.q)}" placeholder="${ph}" autocomplete="off"><span class="go">${ic("search")}</span></div>`;
  const title = w.type === "poi" ? "Widget Vélhop / P+R" : w.type === "stop" ? "Widget arrêt favori" : "Widget mon trajet";
  let body = "";
  if (w.type === "poi") {
    const list = POIS.filter(p => (p.kind === "velhop" || p.kind === "pr") && (!q || fold(p.name).includes(q))).sort((a, b) => a.name.localeCompare(b.name, "fr")).slice(0, 60);
    body = search("Station Vélhop ou parking relais…") + `<p style="color:var(--mute);margin-top:0">Choisissez la station ou le parking à afficher sur l’écran d’accueil.</p>` +
      (list.map(p => `<button class="item" data-wpick="poi:${esc(p.id)}">${markerIcon(p.kind, 26)}<span>${esc(p.name)}<br><small style="color:var(--mute)">${esc(p.info ?? KINDS[p.kind].label)}</small></span></button>`).join("") || `<div class="empty">Aucun résultat</div>`);
  } else if (w.stop && w.deps && w.type === "stop") {
    // arrêt favori : une ou plusieurs directions (aucune cochée = toutes)
    const s = stopById(w.stop), sel = w.sel ?? [];
    body = `<p style="color:var(--mute);margin-top:0">${esc(s?.name ?? "")} : cochez les directions à afficher, ou gardez-les toutes.</p>` +
      w.deps.map((d, i) => `<button class="item wdir${sel.includes(i) ? " on" : ""}" data-wpick="dir:${i}" aria-pressed="${sel.includes(i)}"><span class="wck">${sel.includes(i) ? check() : ""}</span>${lineChip(d.line, true)}<span>vers <b>${esc(d.dest)}</b></span></button>`).join("") +
      `<button class="go" data-wpick="done:1" style="width:100%;margin-top:16px">${sel.length ? `Valider (${sel.length} direction${sel.length > 1 ? "s" : ""})` : "Afficher toutes les directions"}</button>`;
  } else if (w.stop && w.deps) {
    const s = stopById(w.stop);
    body = `<p style="color:var(--mute);margin-top:0">${esc(s?.name ?? "")} : choisissez la ligne et la direction.</p>` +
      (w.deps.map((d, i) => `<button class="item" data-wpick="line:${i}">${lineChip(d.line, true)}<span>vers <b>${esc(d.dest)}</b></span></button>`).join("") || `<div class="empty">Aucun passage à cet arrêt pour le moment : réessayez plus tard ou choisissez un autre arrêt.</div>`);
  } else {
    const favs = S.fav.map(stopById).filter((s): s is Stop => !!s && (!q || fold(s.name).includes(q)));
    const others = q ? STOPS.filter(s => !S.fav.includes(s.id) && fold(s.name).includes(q)).sort((a, b) => a.name.localeCompare(b.name, "fr")).slice(0, 50) : [];
    const row = (s: Stop): string => `<button class="item" data-wpick="stop:${esc(s.id)}">${pinIcon()}<span>${esc(s.name)}</span><span class="ml">${s.lines.slice(0, 5).map(l => lineChip(l, true)).join("")}</span></button>`;
    body = search("Rechercher un arrêt…") + `<p style="color:var(--mute);margin-top:0">${w.type === "stop" ? "Choisissez l’arrêt, puis les directions à afficher." : "Choisissez votre arrêt de départ, puis la ligne et la direction."}</p>` +
      (favs.length ? `<div class="sub">Mes favoris</div>${favs.map(row).join("")}` : "") +
      (others.length ? `<div class="sub">Arrêts</div>${others.map(row).join("")}` : "") +
      (!favs.length && !others.length ? `<div class="empty">${q ? "Aucun arrêt trouvé" : "Tapez le nom d’un arrêt"}</div>` : "");
  }
  return `<div class="overlay">${bar(title)}<main><div class="pad">${body}</div></main></div>`;
}

/** Favoris : recherche d'un arrêt (sans accents ni majuscules), favoris actuels en haut, puis tous les arrêts par ordre alphabétique */
const FAV_MAX = 80;
export function overlayFavs(): string {
  const q = fold(S.favQ);
  const row = (s: Stop): string => `<div class="item"><span style="flex:1;min-width:0">${esc(s.name)}<span class="ml fl">${s.lines.slice(0, 5).map(l => lineChip(l, true)).join("")}</span></span><button class="star ${S.fav.includes(s.id) ? "on" : ""}" data-fav="${esc(s.id)}" aria-label="${S.fav.includes(s.id) ? "Retirer des favoris" : "Ajouter aux favoris"}">${ic("heart")}</button></div>`;
  const mine = S.fav.map(stopById).filter((s): s is Stop => !!s);
  const all = STOPS.filter(s => !S.fav.includes(s.id) && (!q || fold(s.name).includes(q))).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return `<div class="overlay">${bar("Mes arrêts favoris")}<main><div class="pad">
    <div class="search" style="margin-bottom:12px"><input id="fq" value="${esc(S.favQ)}" placeholder="Rechercher un arrêt…" autocomplete="off" enterkeyhint="search"><span class="go">${ic("search")}</span></div>
    <p style="color:var(--mute);margin-top:0">Touchez le cœur pour afficher un arrêt dans « Prochains passages ».</p>
    ${mine.length && !q ? `<div class="sub">Mes favoris</div>${mine.map(row).join("")}` : ""}
    <div class="sub">${q ? "Résultats" : "Tous les arrêts"}</div>
    ${all.length ? all.slice(0, FAV_MAX).map(row).join("") : `<div class="empty">Aucun arrêt pour « ${esc(S.favQ)} »</div>`}
    ${all.length > FAV_MAX ? `<p class="src" style="text-align:center;margin-top:12px">${all.length - FAV_MAX} autres arrêts : précisez la recherche.</p>` : ""}
  </div></main></div>`;
}

/* ============ PASSAGES ============ */
/** Direction choisie pour chaque ligne à chaque arrêt (« arrêt|ligne » → destination), gardée sur le téléphone */
const DIR_KEY = "dirPick";
let dirPick: Record<string, string> = {};
try { dirPick = JSON.parse(localStorage.getItem(DIR_KEY) ?? "{}") as Record<string, string>; } catch { /* stockage indisponible */ }
export function pickDir(key: string, dest: string): void {
  dirPick[key] = dest;
  try { localStorage.setItem(DIR_KEY, JSON.stringify(dirPick)); } catch { /* ignoré */ }
}

/** Une tuile par ligne et par arrêt : si la ligne part dans plusieurs directions, un sélecteur permet de choisir la sienne */
export function depCards(list: StopDeparture[], max = Infinity): string {
  const now = Date.now();
  const groups = new Map<string, { stop: StopDeparture["stop"]; line: string; dests: Map<string, number[]>; cx: Map<string, number[]> }>();
  for (const { stop, d } of list) {
    const t = d.times.filter(x => x > now - 30000);
    if (!t.length) continue;
    const k = stop.id + "|" + d.line;
    const g = groups.get(k) ?? groups.set(k, { stop, line: d.line, dests: new Map(), cx: new Map() }).get(k)!;
    const cx = (d.cancelled ?? []).filter(x => x > now - 60_000 && x < now + 3600_000);
    if (cx.length) g.cx.set(d.dest, [...(g.cx.get(d.dest) ?? []), ...cx].sort((a, b) => a - b));
    g.dests.set(d.dest, [...(g.dests.get(d.dest) ?? []), ...t].sort((a, b) => a - b));   // même direction sur deux quais : horaires réunis
  }
  const cards = [...groups].map(([k, g]) => {
    const dests = [...g.dests.keys()].sort((a, b) => a.localeCompare(b, "fr"));
    const soonest = [...g.dests].sort((a, b) => a[1][0] - b[1][0])[0][0];
    const dest = dirPick[k] && g.dests.has(dirPick[k]) ? dirPick[k] : soonest;
    return { k, g, dests, dest, t: g.dests.get(dest)!, first: g.dests.get(soonest)![0] };
  }).sort((a, b) => a.first - b.first);   // ordre selon le prochain départ de la ligne : la tuile ne bouge pas quand on change de direction
  const rows = cards.slice(0, max).map(({ k, g, dests, dest, t }) => {
    const m = mins(t[0]), c = COLORS[g.line] ?? COLORS[lineLabel(g.line)] ?? "#999";
    const picker = dests.length > 1
      // repère stable (data-scroll) : la position du sélecteur est gardée même si l'ordre des cartes change entre deux redessins
      ? `<div class="dirs${dests.length > 2 ? " many" : ""}" role="group" aria-label="Direction" data-scroll="dirs-${esc(k)}">${dests.map(x =>
          `<button data-dirk="${esc(k)}" data-dirv="${esc(x)}" class="${x === dest ? "on" : ""}" aria-pressed="${x === dest}">${esc(x)}</button>`).join("")}</div>`
      : "";
    return `<div class="dep" role="button" tabindex="0" style="--lc:${c};--lt:${lineText(COLORS[g.line] ? g.line : lineLabel(g.line))}" data-stop="${esc(g.stop.id)}">
      <div class="h">${lineChip(g.line, true, hasAlert(g.line))}<b>${esc(g.stop.name)}</b><span class="t ${m < 2 ? "soon" : ""}">${m < 1 ? "À quai" : m + " min"}${live}</span></div>
      ${picker}
      ${g.cx.get(dest)?.length ? `<div class="cxl">Supprimé : ${g.cx.get(dest)!.slice(0, 3).map(x => hm(x)).join(", ")}</div>` : ""}
      ${picker && t.length < 2 ? "" : `<div class="f">${picker
        // la direction est déjà dans le sélecteur : seulement les passages suivants
        ? `<span>Ensuite</span>`
        : `<span>${ic(lineKind(g.line) === "ter" ? "train" : isTram(g.line) ? "tram" : "bus", 'width="22" height="22" fill="none" stroke="#999" stroke-width="1.800"')} vers <span class="to"><b>${esc(dest)}</b></span></span>`}<span style="white-space:nowrap">${t.slice(1, 3).map(x => `<span class="n">${mins(x)} min${live}</span>`).join("")}</span></div>`}</div>`;
  });
  return rows.join("") || '<div class="empty" style="padding:24px">Aucun passage prévu pour le moment</div>';
}

/** Départs d'un arrêt façon écran en station : une ligne par ligne et direction, prochain passage en grand, le suivant à côté */
export function departureBoard(name: string, list: StopDeparture[], max = 16): string {
  const now = Date.now();
  const rows = new Map<string, { line: string; dest: string; t: number[]; cx: number[] }>();
  for (const { d } of list) {
    const k = d.line + "|" + d.dest;
    const r = rows.get(k) ?? rows.set(k, { line: d.line, dest: d.dest, t: [], cx: [] }).get(k)!;
    r.t.push(...d.times.filter(x => x > now - 30000));
    r.cx.push(...(d.cancelled ?? []).filter(x => x > now - 60_000 && x < now + 3600_000));
  }
  const list2 = [...rows.values()].filter(r => r.t.length).map(r => ({ ...r, t: r.t.sort((a, b) => a - b) })).sort((a, b) => a.t[0] - b.t[0]).slice(0, max);
  if (!list2.length) return '<div class="empty" style="padding:24px">Aucun passage prévu pour le moment</div>';
  const body = list2.map(r => {
    const m = mins(r.t[0]), n = r.t[1] !== undefined ? mins(r.t[1]) : null;
    return `<button class="lb-r" data-line="${esc(r.line)}">${lineChip(r.line, true, hasAlert(r.line))}<span class="lb-d"><b>${esc(r.dest)}</b>${r.cx.length ? `<small class="lb-x">Supprimé : ${r.cx.slice(0, 2).map(x => hm(x)).join(", ")}</small>` : n !== null ? `<small>puis ${n} min</small>` : ""}</span>${m < 1 ? '<span class="lb-m q">À quai</span>' : `<span class="lb-m">${m}<small>min</small></span>`}</button>`;
  }).join("");
  return `<div class="lboard"><div class="lb-h"><span><small>Prochains départs</small><b>${esc(name)}</b></span><span class="lb-clock">${hm(now)}</span></div>${body}</div>`;
}

/** Tableau des départs d'une gare, comme sur les écrans en gare : heure prévue, retard ou suppression, destination, numéro du train */
export function trainBoard(list: TrainDeparture[], max = 15): string {
  const now = Date.now();
  const rows = list.filter(t => t.t > now - 60_000).slice(0, max).map(t => {
    const late = !t.cancelled && (t.delay ?? 0) >= 60, m = mins(t.t);
    const state = t.cancelled ? `<b class="tb-x">Supprimé</b>`
      : late ? `<b class="tb-late">+${Math.round(t.delay! / 60)} min</b>`
      : t.delay !== undefined ? `<span class="tb-ok">À l’heure</span>` : "";
    return `<div class="tb-row${t.cancelled ? " off" : ""}">
      <span class="tb-t">${late ? `<s>${hm(t.aim)}</s>${hm(t.t)}` : hm(t.aim)}</span>
      <span class="tb-d"><b>${esc(t.dest)}</b><small>TER ${esc(t.num)} · ${esc(t.route)}</small></span>
      <span class="tb-s">${state}${t.cancelled ? "" : `<small>${m < 1 ? "À quai" : m + " min"}</small>`}</span></div>`;
  });
  if (!rows.length) return '<div class="empty" style="padding:24px">Aucun train au départ dans les 4 prochaines heures</div>';
  return `<div class="tboard"><div class="tb-h">${ic("train")}<span>Trains au départ</span><small>Horaires SNCF</small></div>${rows.join("")}</div>`;
}

/** Onglets des départs d'un arrêt desservi par plusieurs modes */
export function stopTabs(modes: readonly ("tram" | "bus" | "ter")[], cur: "tram" | "bus" | "ter" | null): string {
  const lab = { tram: "Tram", bus: "Bus", ter: "Train" } as const, icn = { tram: "tram", bus: "bus", ter: "train" } as const;
  return `<div class="seg stabs"><button data-smode="" class="${cur ? "" : "on"}">${ic("bus")}Tous</button>${modes.map(m =>
    `<button data-smode="${m}" class="${cur === m ? "on" : ""}">${ic(icn[m])}${lab[m]}</button>`).join("")}</div>`;
}

/** Fiche d'un arrêt : infos trafic qui le concernent (un arrêt sans passage est souvent un arrêt non desservi) */
export function stopNotice(s: { name: string; lines: string[]; sncf?: string }, noDeparture = false): string {
  if (s.sncf && !isHub(s)) return "";   // gare SNCF seule : les infos trafic de la CTS ne la concernent pas
  let list = messagesForStop(s.name);
  if (noDeparture) {
    // aucun passage : on montre aussi les infos trafic des lignes de l'arrêt (ex. réseau tram interrompu), qui ne citent pas
    // forcément son nom ; incidents comme changements prévus (la CTS classe « réseau tram interrompu » dans les seconds).
    // Station de tram dont les lignes ne sont pas encore connues : lignes de tram A à F.
    const lines = s.lines.length ? s.lines.map(l => lineLabel(l)) : kindOfStop(s) === "tram" ? TRAMS : [];
    const cited = new Set(list);
    const score = (m: typeof MESSAGES[number]): number => m.lines.filter(l => lines.includes(lineLabel(l))).length + (cited.has(m) ? 1 : 0);
    list = MESSAGES.filter(m => score(m) > 0).sort((a, b) => score(b) - score(a));
  }
  return list.slice(0, noDeparture ? 4 : 3).map(m => `<button class="stopnote" data-act="msgs">
      <span class="sn-i">!</span><span><b>${esc(m.title)}</b>${m.period ? `<small>${esc(m.period)}</small>` : ""}${m.lines.length ? `<span class="sn-l">${m.lines.slice(0, 6).map(l => lineChip(l, true)).join("")}</span>` : ""}</span></button>`).join("");
}

export function debugBox(): string {
  if (CONFIG.USE_MOCK || (!debug.last.length && !debug.info)) return "";
  const txt = esc(JSON.stringify({ arret: debug.info, essais: debug.last }).slice(0, 2000));
  return `<details style="margin-top:12px"><summary style="color:var(--mute)">Détails techniques</summary><pre style="white-space:pre-wrap;word-break:break-all;font-size:11px">${txt}</pre></details>`;
}

/* ============ RÉGLAGES ============ */
/** Lignes proposées pour les alertes : trams, lignes des arrêts favoris, lignes déjà choisies et lignes citées par les infos trafic */
function alertLineChoices(): string[] {
  const set = new Set<string>(ALL_LINES);
  S.fav.map(stopById).forEach(s => s?.lines.forEach(l => set.add(lineLabel(l))));
  S.alerts.lines.forEach(l => { if (l !== "*") set.add(l); });
  MESSAGES.forEach(m => m.lines.forEach(l => set.add(l)));
  return [...set].sort((a, b) => lineOrder(a).localeCompare(lineOrder(b))).slice(0, 60);
}

function alertSettings(): string {
  const a = S.alerts, all = a.lines.includes("*");
  const chips = ["*", ...alertLineChoices()].map(l => {
    const on = l === "*" ? all : !all && a.lines.includes(l);
    return `<button class="achip${on ? " on" : ""}" data-aline="${esc(l)}" aria-pressed="${on}">${l === "*" ? "Toutes" : lineChip(l, true)}</button>`;
  }).join("");
  return `<button class="row-switch" data-alerts="works" style="margin-top:8px"><span>Aussi les travaux et changements prévus</span><span class="switch ${a.works ? "on" : ""}"></span></button>
    <div class="sub" style="font-size:13px;margin:14px 0 4px">Lignes suivies</div>
    <div class="alines">${chips}</div>
    <small class="src" style="display:block;margin-top:8px">${NATIVE
      ? "Notifications envoyées par le serveur Kumm dès qu'une perturbation est publiée par la CTS (en général moins de 2 minutes), même application fermée."
      : "Version web : les alertes n'arrivent que tant que la page est ouverte. Avec l'application Android, elles arrivent à tout moment."}</small>`;
}
const check = (): string => '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';

/** Aperçu miniature de l'accueil de Kumm dans un thème, une couleur et une forme donnés (couleurs : themes.ts) */
function miniApp(theme: Theme, accent: Accent, ui: Ui, tiny = false): string {
  const one = (th: Exclude<Theme, "auto">): string => {
    const t = THEME_TOKENS[th], a = ACCENT_TOKENS[accent][t.dark ? "dark" : "light"];
    const [ha, hb] = t.head ?? [a[1], a[2]];
    const vars = `--m-bg:${t.bg};--m-card:${t.card};--m-ink:${t.ink};--m-mute:${t.mute};--m-line:${t.line};--m-chip:${t.chip};--m-a:${a[0]};--m-ha:${ha};--m-hb:${hb};--m-soft:${a[3]}`;
    const chip = (l: string): string => `<span class="mc" style="background:${COLORS[l]};color:${lineText(l)}">${l}</span>`;
    return `<div class="mini ui-${ui}${th === "contrast" ? " hc" : ""}" style="${vars}">
      <div class="m-head"><span><small>Mardi 28 octobre</small><b>Bonsoir</b></span><i></i><i></i></div>
      <div class="m-go"><small>NAVIGUER</small><b>Où allez-vous ?</b></div>
      <div class="m-row"><div class="m-tile"><b>★ Homme de Fer</b><p>${chip("A")}<span>Illkirch</span><em>2′</em></p><p>${chip("D")}<span>Kehl</span><em>5′</em></p></div>
        <div class="m-tile"><b>★ République</b><p>${chip("B")}<span>Hoenheim</span><em>3′</em></p><p>${chip("E")}<span>Robertsau</span><em>6′</em></p></div></div>
      <div class="m-row"><div class="m-tile m-alert"><b>INFO TRAFIC</b><p><span>Ligne C : travaux</span></p></div><div class="m-tile m-bike"><b>VÉLHOP</b><p class="m-n">7 <span>vélos</span></p></div></div>

    </div>`;
  };
  // automatique : moitié clair, moitié sombre
  const inner = theme === "auto" ? `${one("light")}<div class="m-half">${one("dark")}</div>` : one(theme);
  return `<span class="mini-wrap${tiny ? " tiny" : ""}" aria-hidden="true">${inner}</span>`;
}

/** Apparence : thème, couleur principale et forme de l'interface, chacun avec un aperçu de l'application */
export function overlayLook(): string {
  const p = S.prefs;
  const themes = THEMES.map(t => `<button class="look-card${p.theme === t.id ? " on" : ""}" data-theme-pick="${t.id}" aria-pressed="${p.theme === t.id}">
      ${miniApp(t.id, p.accent, p.ui)}<strong>${t.label}</strong><small>${t.hint}</small></button>`).join("");
  const accents = ACCENTS.map(a => `<button class="acc ${p.accent === a.id ? "on" : ""}" data-accent-pick="${a.id}" aria-pressed="${p.accent === a.id}" aria-label="${a.label}">
      <span class="dot" style="background:${a.color}">${check()}</span>${a.label}</button>`).join("");
  const uis = UIS.map(u => `<button class="look-card${p.ui === u.id ? " on" : ""}" data-ui-pick="${u.id}" aria-pressed="${p.ui === u.id}">
      ${miniApp(p.theme, p.accent, u.id)}<strong>${u.label}</strong><small>${u.hint}</small></button>`).join("");
  return `<div class="overlay">${bar("Apparence", "prefs")}<main><div class="pad">
    <div class="look-hero">${miniApp(p.theme, p.accent, p.ui)}</div>
    <div class="sub">Thème</div>
    <div class="look-row" data-scroll="look-themes">${themes}</div>
    <div class="sub">Couleur principale</div>
    <div class="accent-row">${accents}</div>
    <div class="sub">Forme de l’interface</div>
    <div class="look-row" data-scroll="look-uis">${uis}</div>
    <div class="sub">Carte</div>
    <button class="row-switch" data-darkmap="1"><span>Carte sombre avec les thèmes sombres</span><span class="switch ${p.darkMap ? "on" : ""}"></span></button>
  </div></main></div>`;
}

export function overlaySettings(): string {
  const p = S.prefs;
  const t = THEMES.find(x => x.id === p.theme), u = UIS.find(x => x.id === p.ui), c = ACCENTS.find(x => x.id === p.accent);
  return `<div class="overlay">${bar("Réglages")}<main><div class="pad">
    <div class="sub" style="margin-top:4px">Apparence</div>
    <button class="look-link" data-act="look">${miniApp(p.theme, p.accent, p.ui, true)}<span><b>Thème, couleur et forme</b><small>${esc(t?.label ?? "")} · ${esc(c?.label ?? "")} · ${esc(u?.label ?? "")}</small></span>${ic("chev", 'width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"')}</button>
    <div class="sub">Alertes trafic</div>
    <button class="row-switch" data-alerts="toggle"><span>Me prévenir des perturbations<br><small style="color:var(--mute)">${NATIVE && !PUSH_READY ? "Indisponible dans cette version de l'application" : "Une notification pour chaque nouvel incident sur les lignes suivies"}</small></span><span class="switch ${S.alerts.enabled ? "on" : ""}"></span></button>
    ${S.alerts.enabled ? alertSettings() : ""}
    <div class="sub">À propos</div>
    <div class="box" style="display:block"><div class="about"><img src="/favicon.svg" width="52" height="52" alt=""><div><b>Kumm · version ${VERSION}</b><div class="src" style="margin-top:2px">Transports de Strasbourg</div></div></div>
      <div class="src">Horaires et arrêts : CTS (open data)<br>Parkings relais et places : Eurométropole de Strasbourg (open data, Licence Ouverte)<br>Vélhop : flux GBFS nextbike / Eurométropole<br>Véloparks : CTS et Strasbourg Mobilités<br>Cartes et marche à pied : © contributeurs OpenStreetMap<br>Carte 3D du guidage : OpenFreeMap, OpenMapTiles<br>Adresses : Base Adresse Nationale<br>Trajets : Transitous (MOTIS)<br>Stations de tram : plan CartoMetro<br>Trains TER (gares, horaires, temps réel) : SNCF open data ; voies ferrées : © contributeurs OpenStreetMap<br>Application indépendante, non affiliée à la CTS, à la SNCF ni à l’Eurométropole</div>
      <div class="src" style="margin-top:10px"><a href="https://kumm.fr/mentions-legales.html" target="_blank" rel="noopener">Mentions légales</a> · <a href="https://kumm.fr/confidentialite.html" target="_blank" rel="noopener">Confidentialité</a></div></div>
    <button class="ghost" data-act="replayOnb">Revoir la présentation</button>
    ${CAN_UPDATE ? `<button class="ghost" data-act="checkUpdate">Rechercher une mise à jour</button>` : ""}
    <button class="ghost" data-reset="1">Rétablir les réglages d’origine</button>
    ${NATIVE ? "" : `<a class="ghost" href="/deconnexion" style="display:block;text-align:center;text-decoration:none;margin-top:10px">Se déconnecter</a>`}
  </div></main></div>`;
}
