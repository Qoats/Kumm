import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { COLORS, lineLabel } from "./data";
import { fmtDur } from "./geo";
import { S, render } from "./store";
import { makeBaseLayer, wantsDarkMap } from "./tiles";
import { legColor } from "./transit";
import { TRIP } from "./trip";

/**
 * Carte de l'écran Itinéraires : tracé du mode choisi, durée de chaque possibilité dans une bulle (comme Google Maps).
 * Créée une seule fois puis déplacée dans la page à chaque affichage : le zoom est conservé quand l'écran se redessine.
 */
let host: HTMLDivElement | null = null;
let map: L.Map | null = null;
let routes: L.LayerGroup | null = null;
let base: L.Layer | null = null;
let baseDark: boolean | null = null;
let lastSig = "";

const BLUE = "#1A73E8", GREY = "#9AA5B1", WALK = "#6B7785";

function useBaseLayer(m: L.Map): void {
  const dark = wantsDarkMap();
  if (base && baseDark === dark) return;
  if (base) m.removeLayer(base);
  base = makeBaseLayer(dark).addTo(m);
  (base as L.GridLayer).bringToBack?.();
  baseDark = dark;
}

function create(): void {
  host = document.createElement("div");
  host.style.cssText = "position:absolute;inset:0;z-index:0";
  map = L.map(host, { zoomControl: false, attributionControl: false });
  useBaseLayer(map);
  routes = L.layerGroup().addTo(map);
}

const ll = (coords: [number, number][]): L.LatLngTuple[] => coords.map(([lon, lat]) => [lat, lon]);
const point = (cls: string, size: number, html = ""): L.DivIcon => L.divIcon({ html, className: "lm-icon " + cls, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
const PIN = '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" fill="#E8402F" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>';

/** Bulle de durée posée sur un tracé ; touchée, elle choisit ce tracé */
function bubble(at: L.LatLngExpression, text: string, on: boolean, pick?: () => void): void {
  const m = L.marker(at, {
    icon: L.divIcon({ html: `<span class="tm-bubble${on ? " on" : ""}">${text}</span>`, className: "lm-icon tm-b", iconSize: undefined, iconAnchor: [0, 0] }),
    zIndexOffset: on ? 900 : 800, keyboard: false
  }).addTo(routes!);
  if (pick) m.on("click", pick);
}

const choose = (i: number) => (): void => { S.trip.sel = i; render(); };

function draw(): void {
  const t = TRIP, m = map, g = routes;
  if (!m || !g) return;
  const sig = t ? [t.key, t.at, S.trip.mode, S.trip.sel, t.transit.status, t.walk.status, t.bike.status, !!t.transit.data].join("|") : "";
  if (sig === lastSig) return;
  lastSig = sig;
  g.clearLayers();
  if (!t) return;
  const all: L.LatLngTuple[] = [[t.origin.lat, t.origin.lon], [t.dest.lat, t.dest.lon]];
  const sel = S.trip.sel;

  if (S.trip.mode === "walk" && t.walk.data) {
    const p = ll(t.walk.data.coords);
    L.polyline(p, { color: BLUE, weight: 7, dashArray: "1 11", lineCap: "round" }).addTo(g);
    bubble(p[Math.floor(p.length / 2)], fmtDur(t.walk.data.duration), true);
    all.push(...p);
  }
  if (S.trip.mode === "bike" && t.bike.data) {
    const list = t.bike.data.map((r, i) => ({ r, i, p: ll(r.coords) }));
    // l'itinéraire choisi est dessiné en dernier, au-dessus des autres
    for (const { r, i, p } of [...list.filter(x => x.i !== sel), ...list.filter(x => x.i === sel)]) {
      const on = i === sel;
      if (on) L.polyline(p, { color: "#fff", weight: 11, opacity: 0.9 }).addTo(g);
      L.polyline(p, { color: on ? BLUE : GREY, weight: on ? 7 : 6, opacity: on ? 1 : 0.85 }).on("click", choose(i)).addTo(g);
      bubble(p[Math.floor(p.length * (0.35 + 0.2 * i))] ?? p[0], fmtDur(r.duration), on, choose(i));
      all.push(...p);
    }
  }
  if (S.trip.mode === "transit" && t.transit.data?.length) {
    const j = t.transit.data[Math.min(sel, t.transit.data.length - 1)];
    for (const l of j.legs) {
      if (l.kind === "walk") { L.polyline(l.path, { color: WALK, weight: 6, dashArray: "1 10", lineCap: "round" }).addTo(g); continue; }
      const c = legColor(l, COLORS[lineLabel(l.line ?? "")]);
      L.polyline(l.path, { color: "#fff", weight: 11, opacity: 0.9 }).addTo(g);
      L.polyline(l.path, { color: c, weight: 7 }).addTo(g);
      for (const s of [l.from, l.to]) L.circleMarker([s.lat, s.lon], { radius: 6, color: c, weight: 3, fillColor: "#fff", fillOpacity: 1 }).addTo(g);
    }
    for (const l of j.legs) all.push(...l.path);
    const mid = j.legs.find(l => l.kind !== "walk") ?? j.legs[0];
    if (mid?.path.length) bubble(mid.path[Math.floor(mid.path.length / 2)], fmtDur(j.duration), true);
  }

  L.marker([t.origin.lat, t.origin.lon], { icon: point("", 22, '<div class="me-dot"></div>'), interactive: false, zIndexOffset: 1000 }).addTo(g);
  L.marker([t.dest.lat, t.dest.lon], { icon: L.divIcon({ html: PIN, className: "lm-icon", iconSize: [34, 34], iconAnchor: [17, 32] }), interactive: false, zIndexOffset: 1000 }).addTo(g);
  m.fitBounds(L.latLngBounds(all), { padding: [40, 40], maxZoom: 17 });
}

export function mountTripMap(slot: HTMLElement): void {
  if (!host || !map) create();
  const m = map as L.Map;
  useBaseLayer(m);
  slot.appendChild(host as HTMLDivElement);
  // la taille n'est connue qu'une fois la page mise en place : on attend l'affichage avant de cadrer
  requestAnimationFrame(() => {
    m.invalidateSize();
    if (!lastSig) m.setView([TRIP?.origin.lat ?? 48.5846, TRIP?.origin.lon ?? 7.7507], 14);
    draw();
  });
}

/** À appeler quand un résultat arrive sans que l'écran ait été redessiné */
export const refreshTripMap = (): void => { if (host?.isConnected) draw(); };
/** Après un changement d'écran, le prochain affichage recadre la carte */
export const resetTripMap = (): void => { lastSig = ""; };
