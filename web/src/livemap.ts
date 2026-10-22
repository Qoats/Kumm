import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { kindOfStop } from "./data";
import { KINDS } from "./kinds";
import type { Layer } from "./kinds";
import { markerIcon } from "./markers";
import { makeBaseLayer, wantsDarkMap } from "./tiles";
import { POIS, S, STOPS, USER, render } from "./store";

/**
 * Vraie carte (OpenStreetMap) pour l'écran « À proximité ».
 * La carte est créée une seule fois et déplacée dans la page à chaque affichage :
 * le zoom et la position sont conservés quand l'écran se redessine.
 */
let host: HTMLDivElement | null = null;
let map: L.Map | null = null;
let markers: L.LayerGroup | null = null;
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

const MAX_STOPS = 300;
const MAX_POIS = 200;

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
  L.control.zoom({ position: "topright" }).addTo(map);
  markers = L.layerGroup().addTo(map);
  me = L.marker([USER.lat, USER.lon], {
    icon: L.divIcon({ html: '<div class="me-dot"></div>', className: "lm-icon", iconSize: [22, 22], iconAnchor: [11, 11] }),
    interactive: false, zIndexOffset: 1000
  }).addTo(map);
  map.on("moveend", sync);
}

/** Affiche seulement les repères visibles à l'écran (la liste complète compte des milliers d'arrêts) */
function sync(): void {
  if (!map || !markers) return;
  const b = map.getBounds().pad(0.25);
  const key = [b.getSouth().toFixed(4), b.getWest().toFixed(4), b.getNorth().toFixed(4), b.getEast().toFixed(4), S.filter,
    Object.values(S.layers).map(v => (v ? 1 : 0)).join(""), STOPS.length, POIS.length].join("|");
  if (key === lastKey) return;
  lastKey = key;
  markers.clearLayers();

  let n = 0;
  for (const s of STOPS) {
    if (n >= MAX_STOPS) break;
    if (!b.contains([s.lat, s.lon])) continue;
    const k = kindOfStop(s);
    if (!S.layers[k] || (S.filter === "tram" && k !== "tram") || (S.filter === "bus" && k !== "bus")) continue;
    L.marker([s.lat, s.lon], { icon: icon(k, 30), title: `${KINDS[k].label} · ${s.name}`, keyboard: false })
      .on("click", () => { S.overlay = { k: "stop", id: s.id }; render(); })
      .addTo(markers);
    n++;
  }
  let m = 0;
  for (const p of POIS) {
    if (m >= MAX_POIS) break;
    if (!b.contains([p.lat, p.lon]) || !S.layers[p.kind]) continue;
    L.marker([p.lat, p.lon], { icon: icon(p.kind, 30), title: `${KINDS[p.kind].label} · ${p.name}`, keyboard: false })
      .on("click", () => { S.overlay = { k: "poi", id: p.id }; render(); })
      .addTo(markers);
    m++;
  }
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
}

export function recenter(): void {
  map?.setView([USER.lat, USER.lon], Math.max(map.getZoom(), 16));
}
