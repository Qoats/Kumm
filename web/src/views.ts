import type { Place, Stop, StopDeparture } from "../../shared/types";
import { CONFIG, VERSION } from "./config";
import { ALL_LINES, COLORS, DIRS, MESSAGES, MSG_STATE, hasAlert, isTram, kindOfStop, lineKind, lineLabel, messagesFor } from "./data";
import type { TrafficMsg } from "./data";
import { KINDS, LAYERS } from "./kinds";
import { ACCENTS, THEMES } from "./themes";
import { CTS_APP_ANDROID, CTS_APP_IOS, CTS_POINTS_DE_VENTE, CTS_SITE, isIOS } from "./links";
import type { Layer } from "./kinds";
import { marker, markerIcon } from "./markers";
import { ic, type IconName } from "./icons";
import { MAPPATHS, mapRoutes } from "./map";
import { POIS, S, STOPS, USER, mins, stopById } from "./store";
import { debug, nextDepartures } from "./api";
import { fmtDist, haversine, walkMin } from "./geo";
import { fetchTransit, hm, legColor, minutes } from "./transit";
import type { Journey } from "./transit";
import { fetchBike } from "./bike";
import type { BikeRoute } from "./bike";
import type { LL } from "./geo";
import { esc } from "./util";

/* ============ COMPOSANTS ============ */
export const lineChip = (l: string, sm = false): string => {
  const name = lineLabel(l);
  return `<span class="ln ${sm ? "sm" : ""}" style="background:${COLORS[name] ?? COLORS[l] ?? "#777"};${name === "G" ? "color:#222" : ""}">${esc(name)}</span>`;
};
const chipAlert = (l: string): string =>
  `<button class="ln" data-line="${esc(l)}" style="background:${COLORS[l]};${l === "G" ? "color:#222" : ""}">${esc(l)}${hasAlert(l) ? '<span class="al" style="color:#fff">!</span>' : ""}</button>`;
const live = '<span class="live"></span>';
const dirs = (l: string): [string, string] => DIRS[l] ?? ["", ""];
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
function trafficSummary(): string {
  if (!MESSAGES.length) {
    const t = MSG_STATE.status === "loading" ? "Chargement des infos trafic…" : MSG_STATE.status === "error" ? "Infos trafic indisponibles pour le moment" : "Aucune perturbation signalée par la CTS";
    return `<div class="box"><span>${t}</span><span class="rb">${ic("bus")}</span></div>`;
  }
  const rest = MESSAGES.length - 2;
  return `<button class="box" data-act="msgs" style="text-align:left"><span>${MESSAGES.slice(0, 2).map(m =>
    `<span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">${m.lines.slice(0, 4).map(l => lineChip(l, true)).join("")}<b>${esc(m.title)}</b></span>`).join("")}${rest > 0 ? `<small style="color:var(--mute)">et ${rest} autre${rest > 1 ? "s" : ""} info${rest > 1 ? "s" : ""} trafic</small>` : ""}</span><span class="rb">${ic("bus")}</span></button>`;
}

const pinIcon = (): string => ic("pin", 'width="22" height="22" fill="none" stroke="var(--accent)" stroke-width="2"');

const greeting = (): string => {
  const h = new Date().getHours();
  const hello = h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
  const date = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return `${hello} · ${date}`;
};

export function header(): string {
  return `<header>
    <div class="top">
      <button data-act="account" aria-label="Compte">${ic("user")}</button>
      <span class="ic"><button data-act="msgs" aria-label="Messages">${ic("mail")}</button><button data-act="prefs" aria-label="Réglages">${ic("sliders")}</button><button data-act="favs" aria-label="Favoris">${ic("heart")}</button></span>
    </div>
    <p class="hello">${greeting()}</p>
    <div class="search"><input id="hq" placeholder="Où voulez-vous aller ?" readonly><span class="go">${ic("search")}</span></div>
    <div class="strip">${["A", "B", "C", "D", "E", "F"].map(l => `<i style="background:${COLORS[l]}"></i>`).join("")}</div>
  </header>`;
}

export function bar(title: string, back?: string): string {
  return `<div class="bar"><button data-act="${back ?? "closeOverlay"}" aria-label="Retour">${ic("back")}</button><span>${esc(title)}</span></div>`;
}

/* ============ ÉCRANS ============ */
export function screenHome(): string {
  const favStops = S.fav.map(stopById).filter((s): s is Stop => !!s);
  const more: [string, string, IconName, string?][] = [
    ["Mon compte", "#EF8B00", "user2"], ["Flex’hop", "#fff", "clock"], ["Objets perdus", "#00BFA5", "lost"], ["Parkings", "#1B6EC2", "parking"],
    ["Points de vente", "#C0892F", "store", CTS_POINTS_DE_VENTE], ["Plans", "#D582E1", "map"], ["Vélo", "#86B80B", "bike"], ["FAQ/ Contact", "#AAB4BC", "help"]
  ];
  return `<div class="pad">
    <div class="qa"><button data-tab="trips"><span class="qi">${ic("route")}</span>Itinéraire</button><button data-tab="nearby"><span class="qi">${ic("pin")}</span>À proximité</button><button data-tab="buy"><span class="qi">${ic("ticket")}</span>Billets</button></div>
    <h2>Prochains passages <button class="pill" data-act="favs">Personnaliser</button></h2>
    ${favStops.length ? favStops.map(s => `<div id="fav-${esc(s.id)}"></div>`).join("") :
      `<div class="box"><span>Affichez les prochains passages à vos arrêts favoris</span><span class="rb">${ic("heart")}</span></div>`}

    <h2>Infos trafic <button class="pill" data-act="msgs">Toutes les perturbations</button></h2>
    ${trafficSummary()}
    <div class="sub">Toutes les lignes</div>
    <div class="chips">${ALL_LINES.map(chipAlert).join("")}</div>

    <h2>Horaires <span><button class="pill" data-tab="search">Par arrêts</button><button class="pill" data-tab="lines">Par ligne</button></span></h2>
    <button class="box" data-tab="search"><span>Trouvez les horaires d’une ligne à un arrêt</span><span class="rb">${ic("clock")}</span></button>

    <h2>En plus</h2>
    <div class="more">${more.map(m => { const inner = `<div class="c" style="background:${m[1]}">${m[1] === "#fff" ? '<b style="color:#999;font-size:20px;line-height:1">flex<br>hop</b>' : ic(m[2])}</div>${m[0].replace(" ", "<br>")}`; return m[3] ? `<a href="${m[3]}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<button data-more="${m[0]}">${inner}</button>`; }).join("")}</div>

    <p class="ver">Kumm v${VERSION}${CONFIG.USE_MOCK ? " · démonstration : données fictives" : ""}</p>
  </div>`;
}

export function screenSearch(): string {
  const q = S.q.trim().toLowerCase();
  const stops = STOPS.filter(s => !q || s.name.toLowerCase().includes(q)).slice(0, 40);
  const lines = ALL_LINES.filter(l => !q || l.toLowerCase() === q || dirs(l).some(d => d.toLowerCase().includes(q)));
  const results = !q
    ? `<div class="empty">Ici, vous pouvez rechercher un arrêt, un point de vente et beaucoup d’autres choses.<div class="ico">${ic("store")}${ic("bus")}${ic("parking")}${ic("bike")}${ic("clock")}</div></div>`
    : (lines.length ? `<div class="sub">Lignes</div>` + lines.map(l => `<button class="item" data-line="${esc(l)}">${lineChip(l, true)}<span>${esc(dirs(l)[0])} ⇄ ${esc(dirs(l)[1])}</span></button>`).join("") : "") +
      (stops.length ? `<div class="sub">Arrêts</div>` + stops.map(s => `<button class="item" data-stop="${esc(s.id)}">${pinIcon()}<span>${esc(s.name)}</span><span class="ml">${s.lines.slice(0, 6).map(l => lineChip(l, true)).join("")}</span></button>`).join("") : "") +
      (!stops.length && !lines.length ? `<div class="empty">Aucun résultat pour « ${esc(S.q)} »</div>` : "");
  return `<div class="bar" style="padding:calc(10px + var(--safe-top)) 14px 10px"><div class="search" style="flex:1"><input id="sq" value="${esc(S.q)}" placeholder="Recherche…" autocomplete="off"><span class="go">${ic("search")}</span></div></div>
  <div class="pad" style="padding-top:6px">
    <button class="box" style="border:0;background:none;padding:6px 0;font-size:24px" data-tab="lines"><span>Voir toutes les lignes</span>${ic("chev", 'width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"')}</button>
    ${results}
  </div>`;
}

export function screenLines(): string {
  return bar("Toutes les lignes", "tabHome") + `<div class="pad">${ALL_LINES.map(l => `<button class="item" data-line="${esc(l)}">${lineChip(l)}<span>${esc(dirText(l))}<br><small style="color:var(--mute)">${isTram(l) ? "Tram" : "Bus"}</small></span>${hasAlert(l) ? '<span class="warn ml">!</span>' : ""}</button>`).join("")}</div>`;
}

export const layerCounts = (): Record<Layer, number> => {
  const c: Record<Layer, number> = { tram: 0, bus: 0, ter: 0, velhop: 0, velopark: 0, pr: 0, flexhop: 0 };
  STOPS.forEach(s => { c[kindOfStop(s)]++; });
  POIS.forEach(p => { c[p.kind]++; });
  return c;
};

export function screenNearby(): string {
  const h = S.sheet ? "84%" : "42%";
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
    <div class="layers">${chips}</div>
    <div class="tools"><button data-act="prefs" aria-label="Réglages">${ic("gear", 'stroke="currentColor"')}</button><button data-act="locate" aria-label="Me localiser">${ic("target", 'stroke="var(--accent)"')}</button></div>
    <div class="sheet" style="height:${h}">
      <button class="grab" data-act="sheet" aria-label="Agrandir">${ic(S.sheet ? "down" : "up")}</button>
      <h3>À proximité</h3>
      <div class="seg">
        <button data-f="bus" class="${S.filter === "bus" ? "on" : ""}">${ic("bus")}Bus</button>
        <button data-f="tram" class="${S.filter === "tram" ? "on" : ""}">${ic("tram")}Tram</button>
        <button data-f="all" class="${S.filter === "all" ? "on" : ""}">${ic("bus")}Tous</button>
      </div>
      <div class="list" id="nearlist"></div>
    </div>
  </div>`;
}

export function overlayPoi(id: string): string {
  const p = POIS.find(x => x.id === id);
  if (!p) return "";
  return `<div class="overlay">${bar(p.name)}<main><div class="pad">
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">${markerIcon(p.kind, 44)}<b style="font-size:19px">${KINDS[p.kind].label}</b></div>
    ${p.info ? `<div class="box" style="margin-bottom:14px"><span>${esc(p.info)}</span></div>` : ""}
    <button class="go" data-poinav="${esc(p.id)}">Y aller à pied</button>
    <button class="go" data-poibike="${esc(p.id)}" style="margin-top:8px">Y aller à vélo</button>
    <button class="go" style="margin-top:8px" data-poitrip="${esc(p.id)}">Y aller en transports</button>
  </div></main></div>`;
}

/* ---------- itinéraires ---------- */
export const nearestStops = (n: number, from: LL = USER): { s: Stop; d: number }[] =>
  STOPS.map(s => ({ s, d: haversine(from, s) })).sort((x, y) => x.d - y.d).slice(0, n);

export const tripReady = (): boolean => !!S.trip.dest && (S.trip.fromIsMe || !!S.trip.from);
const originPlace = (): Place => (!S.trip.fromIsMe && S.trip.from) ? S.trip.from : { label: "Ma position", lat: USER.lat, lon: USER.lon };

/** Dernier calcul : sert au guidage (voir flow.ts) */
export interface PlanCtx {
  origin: Place;
  dest: Place;
  lines: Record<string, { board: Stop; alight: Stop }>;
}
export let PLAN: PlanCtx | null = null;

function suggestionsHtml(): string {
  const sg = S.trip.sugg;
  if (!sg) return "";
  const me = sg.field === "from" ? `<button class="item" data-sg="me">${ic("target", 'width="22" height="22" fill="none" stroke="var(--accent)" stroke-width="2"')}<span>Ma position</span></button>` : "";
  const items = sg.items.map((p, i) => `<button class="item" data-sg="${i}">${p.stop ? pinIcon() : ic("map", 'width="22" height="22" fill="none" stroke="#7A8087" stroke-width="2"')}<span>${esc(p.label)}</span>${p.stop ? `<span class="ml">${p.stop.lines.slice(0, 4).map(l => lineChip(l, true)).join("")}</span>` : ""}</button>`).join("");
  return me + (items || `<div class="empty" style="padding:24px">Recherche…</div>`);
}

/** Trajets en transports du dernier calcul (sert au guidage, voir flow.ts) */
export let JOURNEYS: Journey[] = [];

function journeyHtml(j: Journey, i: number): string {
  const bar = j.legs.map(l => {
    const label = l.kind === "walk" ? "" : esc(lineLabel(l.line ?? ""));
    return `<i style="flex:${Math.max(l.duration, 60)};background:${legColor(l, COLORS[lineLabel(l.line ?? "")])};${(l.line === "G" || lineLabel(l.line ?? "") === "G") ? "color:#222" : ""}">${label}</i>`;
  }).join("");
  const steps = j.legs.map(l => {
    if (l.kind === "walk") return `<div class="jl"><span class="jw">🚶</span><span>${minutes(l.duration)} min à pied${l.distance ? ` · ${fmtDist(l.distance)}` : ""}</span></div>`;
    return `<div class="jl"><span>${lineChip(l.line ?? "?", true)}</span><span><b>${esc(l.from.name)}</b> ${hm(l.start)} → <b>${esc(l.to.name)}</b> ${hm(l.end)}<br><small style="color:var(--mute)">${l.headsign ? `vers ${esc(l.headsign)} · ` : ""}${minutes(l.duration)} min${l.stops ? ` · ${l.stops + 1} arrêts` : ""}${l.realTime ? " · temps réel" : ""}</small></span></div>`;
  }).join("");
  const transfers = j.transfers === 0 ? "Direct" : `${j.transfers} correspondance${j.transfers > 1 ? "s" : ""}`;
  return `<div class="trip"><div class="top"><b style="font-size:22px">${minutes(j.duration)} min</b><span style="color:var(--mute)">${hm(j.start)} → ${hm(j.end)}</span></div>
    <div class="tl">${bar}</div>${steps}
    <small style="color:var(--mute)">${transfers}</small>
    <div class="acts"><button class="go" data-nav="j:${i}">Guider à pied jusqu’à l’arrêt</button></div></div>`;
}

/** Repli si le calculateur est injoignable : lignes directes d'après les arrêts connus */
async function directLineCards(origin: Place, dest: Place): Promise<{ lines: PlanCtx["lines"]; cards: { score: number; html: string }[] }> {
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
          + `<div class="acts"><button class="go" data-nav="board:${esc(l)}">Guider jusqu’à l’arrêt</button></div></div>`
      });
    }
  }
  cards.sort((a, b) => a.score - b.score);
  return { lines, cards };
}

export const BIKE_ROUTES: BikeRoute[] = [];

/** Itinéraires à vélo : cartes cliquables, chaque tracé s'affiche avant de lancer le guidage */
function bikeCards(routes: BikeRoute[]): string {
  return `<div class="sub">À vélo</div>` + routes.map((r, i) => {
    const pts = r.coords.map(([lo, la]) => `${lo},${la}`).join(" ");
    const [w, h] = svgSize(r.coords);
    const [minx, miny] = svgBounds(r.coords);
    return `<div class="trip"><div class="top"><b style="font-size:18px">🚲 ${minutes(r.duration)}</b><span style="color:var(--mute)">${fmtDist(r.distance)}${i > 0 ? " · itinéraire alternatif" : " · le plus rapide"}</span></div>
      <svg class="tripsvg" viewBox="${minx} ${miny} ${w} ${h}" preserveAspectRatio="xMidYMid meet"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="${Math.max(w, h) / 200}" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <small style="color:var(--mute)">${r.steps.length} consignes · itinéraire guidé virage par virage</small>
      <div class="acts"><button class="go" data-bikenav="${i}">Démarrer à vélo</button></div></div>`;
  }).join("");
}

/** Cadre du tracé SVG (lon/lat → coordonnées locales) */
function svgBounds(coords: [number, number][]): [number, number] {
  const xs = coords.map(c => c[0]), ys = coords.map(c => c[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  return [minx - (maxx - minx) * 0.08, miny - (maxy - miny) * 0.08];
}
function svgSize(coords: [number, number][]): [number, number] {
  const xs = coords.map(c => c[0]), ys = coords.map(c => c[1]);
  const w = (Math.max(...xs) - Math.min(...xs)) * 1.16 || 0.01;
  const h = (Math.max(...ys) - Math.min(...ys)) * 1.16 || 0.01;
  return [w, h];
}

export async function planTrips(): Promise<string> {
  const dest = S.trip.dest;
  if (!dest) return "";
  const origin = originPlace();
  const direct = haversine(origin, dest);
  const walk = `<div class="trip"><div class="top"><b style="font-size:18px">À pied</b><span style="color:var(--mute)">🚶 ~${walkMin(direct)} min · ${fmtDist(direct * 1.25)}</span></div><small style="color:var(--mute)">Itinéraire guidé, virage par virage</small><div class="acts"><button class="go" data-nav="walk">Démarrer à pied</button></div></div>`;

  const mode = S.trip.mode;

  if (mode === "walk") return `<div class="sub" style="margin-top:4px">À pied</div>` + walk;

  if (mode === "bike") {
    BIKE_ROUTES.length = 0;
    try {
      const routes = await fetchBike(origin, dest);
      BIKE_ROUTES.push(...routes);
      return bikeCards(routes) + `<small style="color:var(--mute)">Pistes et voies cyclables d'après OpenStreetMap (service OSRM).</small>`;
    } catch (e) {
      return `<div class="trip"><div class="top"><b style="font-size:18px">À vélo</b></div><small style="color:var(--mute)">Itinéraire vélo indisponible (${esc(e instanceof Error ? e.message : String(e))}).</small></div>` + `<div class="sub">À pied</div>` + walk;
    }
  }

  let journeys: Journey[] = [];
  let failure = "";
  try { journeys = await fetchTransit(origin, dest); }
  catch (e) { failure = e instanceof Error ? e.message : String(e); }
  JOURNEYS = journeys;
  PLAN = { origin, dest, lines: {} };

  if (journeys.length) {
    return `<div class="sub" style="margin-top:4px">En transports</div>` + journeys.map(journeyHtml).join("") + `<div class="sub">À pied</div>` + walk
      + `<small style="color:var(--mute)">Trajets calculés avec les horaires du réseau (service Transitous, données ouvertes).</small>`;
  }
  // repli : lignes directes d'après la liste des arrêts
  const fb = await directLineCards(origin, dest);
  PLAN = { origin, dest, lines: fb.lines };
  const why = failure
    ? `Calculateur d'itinéraires injoignable (${esc(failure)}) : seules les lignes directes sont proposées.`
    : "Aucun trajet en transports trouvé pour ce départ et cette destination.";
  return walk + fb.cards.slice(0, 4).map(c => c.html).join("") + `<small style="color:var(--mute)">${why}</small>`;
}

export function screenTrips(): string {
  const t = S.trip, has = t.toText.trim().length > 1;
  const body = CONFIG.USE_MOCK
    ? (has ? `<div id="trips"></div>` : `<div class="empty" style="font-weight:700;padding-top:90px;font-size:20px">Aucun itinéraire trouvé</div>`)
    : t.sugg ? suggestionsHtml()
    : tripReady() ? `<div id="trips"><div class="empty" style="padding:30px">Recherche…</div></div>`
    : `<div class="empty" style="padding-top:70px">Choisissez un départ (adresse ou « Ma position ») et une destination.</div>`;
  const modes: { id: "walk" | "bike" | "transit"; label: string; icon: IconName }[] = [
    { id: "transit", label: "Transports", icon: "tram" },
    { id: "bike", label: "Vélo", icon: "bike" },
    { id: "walk", label: "À pied", icon: "pin" }
  ];
  const seg = `<div class="seg" style="margin:10px 0">${modes.map(m =>
    `<button data-mode="${m.id}" class="${t.mode === m.id ? "on" : ""}" style="flex:1;justify-content:center">${ic(m.icon)}${m.label}</button>`).join("")}</div>`;
  return bar("Itinéraires", "tabHome") + `<div class="pad" style="padding-top:12px">
    <div class="field">${ic("target")}<input id="tfrom" value="${esc(t.fromText)}" placeholder="Départ : adresse à Strasbourg" autocomplete="off" ${CONFIG.USE_MOCK ? "readonly" : ""}></div>
    <div class="field">${ic("search")}<input id="tto" value="${esc(t.toText)}" placeholder="Où voulez-vous aller ?" autocomplete="off"></div>
    ${seg}
    ${body}
  </div>`;
}

/** Résultats d'exemple (mode démo uniquement) */
export function tripsDemo(): string {
  const now = new Date(), f = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const opts = [{ l: ["D"], w: 4, m: 18, c: 0 }, { l: ["A", "C"], w: 6, m: 24, c: 1 }, { l: ["B"], w: 9, m: 27, c: 0 }];
  const chev = ic("chev", 'width="14" height="14" fill="none" stroke="#888" stroke-width="3"');
  return opts.map((o, i) => {
    const dep = new Date(now.getTime() + (3 + i * 6) * 60000), arr = new Date(dep.getTime() + o.m * 60000);
    return `<div class="trip"><div class="top"><b>${o.m} min</b><span style="color:var(--mute)">${f(dep)} → ${f(arr)}</span></div>
      <div class="tl"><i style="flex:${o.w};background:#B9BEC4"></i>${o.l.map(l => `<i style="flex:${(o.m - o.w - 3) / o.l.length};background:${COLORS[l]}">${l}</i>`).join("")}<i style="flex:3;background:#B9BEC4"></i></div>
      <div class="legs"><small>🚶 ${o.w} min</small>${o.l.map(l => `${chev}${lineChip(l, true)}`).join("")}${chev}<small>🚶 3 min</small></div>
      <small style="color:var(--mute)">${o.c ? "1 correspondance" : "Direct"}</small></div>`;
  }).join("") + `<small style="color:var(--mute)">Itinéraires de démonstration.</small>`;
}

export function screenBuy(): string {
  const ios = isIOS();
  const primary = ios ? CTS_APP_IOS : CTS_APP_ANDROID;
  const ext = 'target="_blank" rel="noopener noreferrer"';
  return `<div class="bar" style="font-size:22px">Billets</div><div class="pad" style="padding-top:14px">
    <div class="buy-hero">
      <span class="qi">${ic("ticket")}</span>
      <h3>Les billets s’achètent dans l’application officielle de la CTS</h3>
      <p>Kumm est une application indépendante : elle ne vend aucun titre de transport. Pour acheter vos titres, utiliser Badgéo sur mobile ou recharger votre carte Badgéo, passez par l’application officielle « CTS Transports Strasbourg ».</p>
      <a class="go big" href="${primary}" ${ext}>Ouvrir l’application CTS</a>
      <p class="alt">${ios ? "iPhone (App Store)" : "Android (Google Play)"} · autre téléphone : <a href="${ios ? CTS_APP_ANDROID : CTS_APP_IOS}" ${ext}>${ios ? "Google Play" : "App Store"}</a></p>
    </div>
    <div class="sub">Autres moyens</div>
    <a class="box link" href="${CTS_POINTS_DE_VENTE}" ${ext}><span><b>Points de vente CTS</b><br><small style="color:var(--mute)">Agences et distributeurs : page officielle</small></span>${ic("chev", 'width="22" height="22" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"')}</a>
    <a class="box link" href="${CTS_SITE}" ${ext} style="margin-top:10px"><span><b>Site de la CTS</b><br><small style="color:var(--mute)">Tarifs, titres et informations officielles</small></span>${ic("chev", 'width="22" height="22" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"')}</a>
    <p class="src" style="margin-top:16px">Les prix et les conditions de vente sont ceux de la CTS : consultez-les dans son application ou sur son site. Si l’application est déjà installée, le magasin d’applications propose de l’ouvrir.</p>
  </div>`;
}

/* ============ ÉCRANS SUPERPOSÉS ============ */
export function overlayLine(l: string): string {
  const stops = STOPS.filter(s => s.lines.includes(l));
  return `<div class="overlay" style="--c:${COLORS[l] ?? "#777"}">${bar("Ligne " + l)}
   <main><div class="pad"><div style="display:flex;gap:12px;align-items:center;margin-bottom:6px">${lineChip(l)}<b style="font-size:18px">${esc(dirText(l))}</b></div>
   ${messagesFor(l).length ? `<div style="margin:10px 0">${messagesFor(l).map(m => msgCard(m, false)).join("")}</div>` : ""}
   <div style="position:relative;margin-top:10px"><div class="rail"></div>${stops.map(s => `<button class="stopline" style="width:100%;text-align:left" data-stop="${esc(s.id)}"><span class="d"></span><span class="r">${esc(s.name)}</span></button>`).join("")}</div></div></main></div>`;
}

export function overlayStop(id: string): string {
  const s = stopById(id);
  if (!s) return "";
  const fav = S.fav.includes(id);
  return `<div class="overlay">${bar(s.name)}
   <main><div class="pad"><div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><span style="display:flex;align-items:center;gap:8px;font-weight:700">${markerIcon(kindOfStop(s), 30)}${KINDS[kindOfStop(s)].label}</span><span style="flex:1;display:flex;gap:6px;flex-wrap:wrap">${s.lines.slice(0, 12).map(l => lineChip(l, true)).join("")}</span>
   <button class="star ${fav ? "on" : ""}" data-fav="${esc(id)}" aria-label="Favori">${ic("heart")}</button></div><div id="stopdeps"></div></div></main></div>`;
}

export function overlayMsgs(): string {
  const dis = MESSAGES.filter(m => m.channel === "disruption"), works = MESSAGES.filter(m => m.channel === "works");
  const empty = MSG_STATE.status === "loading" ? "Chargement…" : MSG_STATE.status === "error" ? "Infos trafic indisponibles pour le moment." : "Aucune perturbation signalée.";
  return `<div class="overlay">${bar("Infos trafic")}<main><div class="pad">
    ${dis.length ? `<div class="sub" style="margin-top:4px">Incidents en cours</div>${dis.map(m => msgCard(m)).join("")}` : ""}
    ${works.length ? `<div class="sub">Travaux et changements</div>${works.map(m => msgCard(m)).join("")}` : ""}
    ${MESSAGES.length ? "" : `<div class="empty">${empty}</div>`}
    <small style="color:var(--mute)">${CONFIG.USE_MOCK ? "Messages fictifs (mode démonstration)." : "Source : CTS, infos trafic en temps réel (mises à jour toutes les 5 minutes)."}</small></div></main></div>`;
}

export function overlayFavs(): string {
  return `<div class="overlay">${bar("Mes arrêts favoris")}<main><div class="pad"><p style="color:var(--mute);margin-top:0">Touchez le cœur pour afficher un arrêt dans « Prochains passages ».</p>${STOPS.slice(0, 200).map(s => `<div class="item"><span style="flex:1">${esc(s.name)}</span><button class="star ${S.fav.includes(s.id) ? "on" : ""}" data-fav="${esc(s.id)}" aria-label="Favori">${ic("heart")}</button></div>`).join("")}</div></main></div>`;
}

/* ============ PASSAGES ============ */
export function depCards(list: StopDeparture[]): string {
  const rows: string[] = [];
  for (const { stop, d } of list) {
    const t = d.times.filter(x => x > Date.now() - 30000);
    if (!t.length) continue;
    const m = mins(t[0]);
    rows.push(`<button class="dep" style="--lc:${COLORS[d.line] ?? "#999"}" data-stop="${esc(stop.id)}">
      <div class="h">${lineChip(d.line, true)}${hasAlert(d.line) ? '<span class="warn">!</span>' : ""}<b>${esc(stop.name)}</b><span class="t ${m < 2 ? "soon" : ""}">${m < 1 ? "À quai" : m + " min"}${live}</span></div>
      <div class="f"><span>${ic(lineKind(d.line) === "ter" ? "train" : isTram(d.line) ? "tram" : "bus", 'width="22" height="22" fill="none" stroke="#999" stroke-width="1.800"')} vers <span class="to"><b>${esc(d.dest)}</b></span></span><span style="white-space:nowrap">${t.slice(1, 3).map(x => `<span class="n">${mins(x)} min${live}</span>`).join("")}</span></div></button>`);
  }
  return rows.join("") || '<div class="empty" style="padding:24px">Aucun passage prévu pour le moment</div>';
}

export function debugBox(): string {
  if (CONFIG.USE_MOCK || (!debug.last.length && !debug.info)) return "";
  const txt = esc(JSON.stringify({ arret: debug.info, essais: debug.last }).slice(0, 2000));
  return `<details style="margin-top:12px"><summary style="color:var(--mute)">Détails techniques</summary><pre style="white-space:pre-wrap;word-break:break-all;font-size:11px;user-select:all">${txt}</pre></details>`;
}

/* ============ RÉGLAGES ============ */
const check = (): string => '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';

export function overlaySettings(): string {
  const p = S.prefs;
  const themes = THEMES.map(t => `<button class="theme-card ${p.theme === t.id ? "on" : ""}" data-theme-pick="${t.id}" aria-pressed="${p.theme === t.id}">
      <div class="prev" style="background:${t.bg}"><b></b><i style="background:${t.bar}"></i></div>
      <strong>${t.label}</strong><small>${t.hint}</small><span class="ok">${check()}</span></button>`).join("");
  const accents = ACCENTS.map(a => `<button class="acc ${p.accent === a.id ? "on" : ""}" data-accent-pick="${a.id}" aria-pressed="${p.accent === a.id}" aria-label="${a.label}">
      <span class="dot" style="background:${a.color}">${check()}</span>${a.label}</button>`).join("");
  return `<div class="overlay">${bar("Réglages")}<main><div class="pad">
    <div class="sub" style="margin-top:4px">Thème</div>
    <div class="theme-grid">${themes}</div>
    <div class="sub">Couleur principale</div>
    <div class="accent-row">${accents}</div>
    <div class="sub">Carte</div>
    <button class="row-switch" data-darkmap="1"><span>Carte sombre avec les thèmes sombres</span><span class="switch ${p.darkMap ? "on" : ""}"></span></button>
    <div class="sub">À propos</div>
    <div class="box" style="display:block"><div class="about"><img src="/favicon.svg" width="52" height="52" alt=""><div><b>Kumm · version ${VERSION}</b><div class="src" style="margin-top:2px">Transports de Strasbourg</div></div></div>
      <div class="src">Horaires et arrêts : CTS (open data)<br>Parkings relais et places : Eurométropole de Strasbourg (open data, Licence Ouverte)<br>Vélhop : flux GBFS nextbike / Eurométropole<br>Véloparks : CTS et Strasbourg Mobilités<br>Cartes et marche à pied : © contributeurs OpenStreetMap<br>Adresses : Base Adresse Nationale<br>Trajets : Transitous (MOTIS)<br>Stations de tram : plan CartoMetro ; gares TER : CTS<br>Application indépendante, non affiliée à la CTS ni à l’Eurométropole</div></div>
    <button class="ghost" data-reset="1">Rétablir les réglages d’origine</button>
  </div></main></div>`;
}
