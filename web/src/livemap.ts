import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { isHub, kindOfStop } from "./data";
import { KINDS } from "./kinds";
import type { Layer } from "./kinds";
import { markerIcon } from "./markers";
import { makeBaseLayer, wantsDarkMap } from "./tiles";
import { POIS, S, STOPS, USER, render } from "./store";
import { COLORS, lineLabel, lineText } from "./data";
import { esc } from "./util";
import { VEHICLES, refreshVehicles, vehicleHeading, vehicleKind, vehiclePos, vehiclePosAlong } from "./vehicles";
import type { Vehicle } from "./vehicles";

/**
 * Vraie carte (OpenStreetMap) pour l'écran « À proximité ».
 * La carte est créée une seule fois et déplacée dans la page à chaque affichage :
 * le zoom et la position sont conservés quand l'écran se redessine.
 */
let host: HTMLDivElement | null = null;
let map: L.Map | null = null;
let markers: L.LayerGroup | null = null;
let vehLayer: L.LayerGroup | null = null;
const vehMarkers = new Map<string, L.Marker>();
let vehTimer = 0;
let me: L.Marker | null = null;
let lastKey = "";
let lastUser = "";
let centered = false;
let watcher: ResizeObserver | null = null;

let base: L.GridLayer | null = null;
let baseDark: boolean | null = null;
let tileErrors = 0, tilesLoaded = false, note: HTMLDivElement | null = null;

/** Fond de carte clair ou sombre selon le thème ; le remplace à chaud si le thème change */
function useBaseLayer(m: L.Map): void {
  const dark = wantsDarkMap();
  if (base && baseDark === dark) return;
  if (base) m.removeLayer(base);
  base = makeBaseLayer(dark);
  baseDark = dark;
  tileErrors = 0; tilesLoaded = false;
  base.on("tileload", () => { tilesLoaded = true; note?.remove(); note = null; });
  base.on("tileerror", () => {
    tileErrors++;
    if (!tilesLoaded && tileErrors >= 3 && !note && host) {
      note = document.createElement("div");
      note.className = "lm-note";
      note.textContent = "Fond de carte indisponible : le serveur n'arrive pas à joindre OpenStreetMap. Les arrêts restent affichés.";
      host.appendChild(note);
    }
  });
  base.addTo(m);
  base.bringToBack();
}

/* Niveaux de détail (comme un plan en ligne) : de près des icônes, plus loin de simples points dessinés sur un seul canevas
   (beaucoup plus léger que des centaines d'éléments de page), de très loin seulement les stations de tram et les P+R. */
const ICON_ZOOM = 16, DOT_ZOOM = 14;
const MAX_ICONS = 160, MAX_DOTS = 2500;
let dots: L.Canvas | null = null;
const shown = new Map<string, L.Layer>();
let shownMode = "";
let zooming = false;

const icon = (kind: Layer, size: number): L.DivIcon =>
  L.divIcon({ html: markerIcon(kind, size), className: "lm-icon", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

function create(): void {
  host = document.createElement("div");
  host.id = "livemap";
  // Important : le style doit être posé avant L.map(). Un élément pas encore dans la page n'a aucun style calculé :
  // Leaflet lui imposerait « position: relative » et la carte se retrouverait avec une hauteur de 0.
  host.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;z-index:0";
  map = L.map(host, { zoomControl: false, attributionControl: false }).setView([USER.lat, USER.lon], 16);
  useBaseLayer(map);
  markers = L.layerGroup().addTo(map);
  vehLayer = L.layerGroup().addTo(map);
  dots = L.canvas({ padding: 0.3 });
  // pendant l'animation du zoom, on ne déplace pas les véhicules (sinon saccades)
  map.on("zoomstart", () => { zooming = true; });
  map.on("zoomend", () => { zooming = false; });
  me = L.marker([USER.lat, USER.lon], {
    icon: L.divIcon({ html: '<div class="me-dot"></div>', className: "lm-icon", iconSize: [22, 22], iconAnchor: [11, 11] }),
    interactive: false, zIndexOffset: 1000
  }).addTo(map);
  map.on("moveend", sync);
  // pour inspecter la carte dans la console du navigateur (comme __kumm.STOPS)
  (window as unknown as { __kummMap?: L.Map; __kummVeh?: unknown }).__kummMap = map;
  (window as unknown as { __kummVeh?: unknown }).__kummVeh = VEHICLES;
}

/** Positions des arrêts modifiées (repères recentrés) : tous les repères sont recréés au prochain affichage */
export function refreshMarkers(): void {
  markers?.clearLayers(); shown.clear(); lastKey = "";
  sync();
}

/** Affiche seulement les repères visibles à l'écran (la liste complète compte des milliers d'arrêts) ;
   ne crée ou ne retire que ce qui change, au lieu de tout redessiner à chaque déplacement */
function sync(): void {
  if (!map || !markers || !dots) return;
  const z = map.getZoom();
  const mode = z >= ICON_ZOOM ? "icons" : z >= DOT_ZOOM ? "dots" : "far";
  const b = map.getBounds().pad(mode === "icons" ? 0.25 : 0.1);
  const key = [b.getSouth().toFixed(4), b.getWest().toFixed(4), b.getNorth().toFixed(4), b.getEast().toFixed(4), mode, S.filter,
    Object.values(S.layers).map(v => (v ? 1 : 0)).join(""), STOPS.length, POIS.length].join("|");
  if (key === lastKey) return;
  lastKey = key;
  if (mode !== shownMode) { markers.clearLayers(); shown.clear(); shownMode = mode; }

  const want = new Map<string, () => L.Layer>();
  const max = mode === "icons" ? MAX_ICONS : MAX_DOTS;
  const place = (id: string, lat: number, lon: number, kind: Layer, title: string, open: () => void): void => {
    if (want.size >= max || !b.contains([lat, lon])) return;
    want.set(id, () => {
      const layer = mode === "icons"
        ? L.marker([lat, lon], { icon: icon(kind, 30), title, keyboard: false })
        : L.circleMarker([lat, lon], { renderer: dots!, radius: mode === "far" ? 4 : 5, color: "#fff", weight: 1.5, fillColor: KINDS[kind].color, fillOpacity: 1 });
      return layer.on("click", open);
    });
  };
  for (const s of STOPS) {
    const k = kindOfStop(s);
    if (isHub(s)) {
      // pôle d'échanges : visible dès que les trams, les bus ou les gares sont affichés, même de loin
      if (!S.layers.tram && !S.layers.bus && !S.layers.ter) continue;
    } else {
      if (!S.layers[k] || (S.filter === "tram" && k !== "tram") || (S.filter === "bus" && k !== "bus")) continue;
      if (mode === "far" && k !== "tram") continue;
    }
    place("s:" + s.id, s.lat, s.lon, k, `${isHub(s) ? "Gare" : KINDS[k].label} · ${s.name}`, () => { S.overlay = { k: "stop", id: s.id }; render(); });
  }
  for (const p of POIS) {
    if (!S.layers[p.kind] || (mode === "far" && p.kind !== "pr")) continue;
    place("p:" + p.id, p.lat, p.lon, p.kind, `${KINDS[p.kind].label} · ${p.name}`, () => { S.overlay = { k: "poi", id: p.id }; render(); });
  }
  for (const [id, layer] of shown) if (!want.has(id)) { markers.removeLayer(layer); shown.delete(id); }
  for (const [id, make] of want) if (!shown.has(id)) { const l = make(); l.addTo(markers); shown.set(id, l); }
}

export function mountLiveMap(slot: HTMLElement): void {
  if (!host || !map || !me) create();
  const h = host as HTMLDivElement, m = map as L.Map;
  useBaseLayer(m);
  slot.appendChild(h);
  m.invalidateSize();
  // la taille de la zone peut encore changer après l'affichage (mise en page, rotation de l'écran…)
  if (typeof ResizeObserver !== "undefined") {
    watcher?.disconnect();
    watcher = new ResizeObserver(() => m.invalidateSize());
    watcher.observe(slot);
  }
  setTimeout(() => m.invalidateSize(), 150);
  const u = `${USER.lat},${USER.lon}`;
  if (u !== lastUser) {
    lastUser = u;
    (me as L.Marker).setLatLng([USER.lat, USER.lon]);
    if (!centered && S.locOn) { centered = true; m.setView([USER.lat, USER.lon], 16); }   // une seule fois, quand la position arrive
  }
  sync();
  startVehicles();
}

/* ---------- trams et bus en circulation ---------- */
const vehColor = (line: string): string => COLORS[lineLabel(line)] ?? COLORS[line] ?? (/^[A-F]$/.test(lineLabel(line)) ? "#0B4A9E" : "#1296A8");
const vehIcon = (line: string, h: number): L.DivIcon => L.divIcon({
  html: `<div class="veh" style="--c:${vehColor(line)};--t:${COLORS[lineLabel(line)] ? lineText(lineLabel(line)) : "#fff"}"><i class="va" style="transform:rotate(${h}deg)"></i><span class="vb">${esc(lineLabel(line))}</span></div>`,
  className: "lm-icon", iconSize: [34, 34], iconAnchor: [17, 17]
});

/** Place les véhicules visibles (catégories et filtre Tram / Bus respectés) ; appelé chaque seconde */
/**
 * Véhicule qui recouvrirait l'icône d'une station : il reste sur sa voie et attend juste avant l'icône (en arrivant), ou
 * se place juste après (en repartant). On cherche, le long de son propre tracé (virages compris), le premier point où il
 * ne touche plus aucune station. Un véhicule qui ne touche pas de station n'est jamais déplacé.
 */
function besideStops(m: L.Map, v: Vehicle, p: L.LatLngTuple, h: number, stops: L.Point[], min: number): L.LatLngTuple {
  const gap = (q: L.LatLngTuple): number => { const pt = m.latLngToContainerPoint(q); let d = Infinity; for (const s of stops) d = Math.min(d, s.distanceTo(pt)); return d; };
  if (gap(p) >= min) return p;
  const metersPerPx = 40_075_016.7 * Math.cos((p[0] * Math.PI) / 180) / (256 * 2 ** m.getZoom());
  const at = (px: number): L.LatLngTuple | null => vehiclePosAlong(v, px * metersPerPx);
  // arrive-t-il vers la station la plus proche, ou en repart-il ? (sa distance diminue-t-elle un peu plus loin sur le tracé ?)
  const ahead = at(4);
  const arriving = ahead ? gap(ahead) < gap(p) : true;
  for (const sign of arriving ? [-1, 1] : [1, -1]) {
    for (let px = 3; px <= min * 4; px += 3) {
      const q = at(sign * px);
      if (!q) break;                    // tracé inconnu (véhicule à quai)
      if (gap(q) >= min) return q;
    }
  }
  // à quai, sans tracé en cours : le long du quai (droit), juste avant la station
  const r = (h * Math.PI) / 180, dir = L.point(Math.sin(r), -Math.cos(r)), pt = m.latLngToContainerPoint(p);
  for (let px = 3; px <= min * 4; px += 3) {
    const q = m.containerPointToLatLng(pt.add(dir.multiplyBy(-px)));
    if (gap([q.lat, q.lng]) >= min) return [q.lat, q.lng];
  }
  return p;
}

function syncVehicles(): void {
  if (!map || !vehLayer) return;
  const b = map.getBounds().pad(0.3), seen = new Set<string>();
  if (zooming) return;
  // icônes des stations à l'écran (en pixels), pour que les véhicules ne les recouvrent pas
  const mp = map, stopPts: L.Point[] = [];
  for (const [id, layer] of shown) if (id.startsWith("s:")) stopPts.push(mp.latLngToContainerPoint((layer as L.Marker).getLatLng()));
  const clearance = shownMode === "icons" ? 33 : 20;
  const show = map.getZoom() >= DOT_ZOOM;
  let count = 0;
  for (const v of show ? VEHICLES.values() : []) {
    const k = vehicleKind(v);
    if (!S.layers[k] || (S.filter !== "all" && S.filter !== k)) continue;
    const h = Math.round(vehicleHeading(v)), raw = vehiclePos(v);
    if (!b.contains(raw) || ++count > 150) continue;
    const p = stopPts.length ? besideStops(mp, v, raw, h, stopPts, clearance) : raw;
    seen.add(v.id);
    let m = vehMarkers.get(v.id);
    if (!m) {
      m = L.marker(p, { icon: vehIcon(v.line, h), zIndexOffset: 500, keyboard: false, title: `${lineLabel(v.line)} vers ${v.dest}${v.w ? " · au terminus" : ""}${v.n ? ` · trajet ${v.n}` : ""}` })
        .on("click", () => { S.overlay = { k: "veh", id: v.id }; render(); })
        .addTo(vehLayer);
      m.getElement()?.setAttribute("data-vid", v.id);   // pour scripts/check-map.mjs
      m.getElement()?.classList.toggle("vwaiting", !!v.w);
      vehMarkers.set(v.id, m);
    } else {
      m.setLatLng(p);
      m.getElement()?.classList.toggle("vwaiting", !!v.w);   // en attente au terminus, puis en route
      // la flèche suit les virages du tracé, sans recréer l'icône
      const arrow = m.getElement()?.querySelector<HTMLElement>(".va");
      if (arrow) arrow.style.transform = `rotate(${h}deg)`;
    }
  }
  for (const [id, m] of vehMarkers) if (!seen.has(id)) { vehLayer.removeLayer(m); vehMarkers.delete(id); }
}

/** Animation : une fois par seconde tant que la carte est affichée ; nouvelles positions toutes les 20 s */
function startVehicles(): void {
  if (vehTimer) return;
  const tick = (): void => {
    if (!host?.isConnected) { window.clearInterval(vehTimer); vehTimer = 0; return; }
    if (document.hidden) return;
    refreshVehicles(() => { syncVehicles(); if (S.overlay?.k === "veh") render(); });
    syncVehicles();
  };
  vehTimer = window.setInterval(tick, 1000);
  tick();
}

/** Boutons + et − du panneau d'outils (au même style que Réglages et Position) */
export const zoomBy = (d: 1 | -1): void => { if (map) (d > 0 ? map.zoomIn() : map.zoomOut()); };

export function recenter(): void {
  map?.setView([USER.lat, USER.lon], Math.max(map.getZoom(), 16));
}
