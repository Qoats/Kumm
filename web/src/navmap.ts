/**
 * Carte du guidage. En 3D (MapLibre + tuiles vectorielles OpenFreeMap) : vue inclinée, carte tournée dans le sens de la marche,
 * bâtiments en relief, comme un GPS. Repli sur la carte 2D (Leaflet) si le téléphone ne sait pas l'afficher ou si le fond
 * de carte 3D ne répond pas. Dans les deux cas, la ligne bleue ne montre que ce qui reste à parcourir.
 */
import * as L from "leaflet";
import type { LL } from "./geo";
import { makeBaseLayer, wantsDarkMap } from "./tiles";

export interface NavView {
  /** position actuelle ; bearing : direction de la marche en degrés (null : inconnue) */
  setPosition(p: LL, bearing: number | null): void;
  /** partie du trajet qui reste à parcourir, [longitude, latitude] */
  setRemaining(coords: [number, number][]): void;
  /** la carte suit la position (false après un déplacement au doigt) */
  setFollow(on: boolean): void;
  onUserMove(cb: () => void): void;
  destroy(): void;
}

const ROUTE = "#1A73E8", CASING = "#0B57D0";
const OFM = "https://tiles.openfreemap.org/styles/";

const ARROW = '<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="17" fill="#fff" opacity=".95"/><path d="M20 7 30 30 20 25 10 30Z" fill="#1A73E8" stroke="#0B57D0" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const PIN = '<svg viewBox="0 0 24 24" width="38" height="38"><path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" fill="#E8402F" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg>';

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch { return false; }
}

/** Style OpenFreeMap ; le style sombre n'a pas de bâtiments en relief : on les ajoute */
async function loadStyle(dark: boolean): Promise<unknown> {
  const r = await fetch(OFM + (dark ? "dark" : "liberty"));
  if (!r.ok) throw new Error("style " + r.status);
  const style = (await r.json()) as { layers: { id: string; type: string }[] };
  if (dark && !style.layers.some(l => l.type === "fill-extrusion")) {
    style.layers.push({
      id: "building-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 14,
      paint: { "fill-extrusion-color": "#2B3A33", "fill-extrusion-height": ["get", "render_height"], "fill-extrusion-base": ["get", "render_min_height"], "fill-extrusion-opacity": 0.85 }
    } as unknown as { id: string; type: string });
  }
  return style;
}

const line = (coords: [number, number][]): GeoJSON.Feature<GeoJSON.LineString> => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords.length >= 2 ? coords : [...coords, ...coords] } });

async function create3D(el: HTMLElement, coords: [number, number][], dest: LL): Promise<NavView> {
  const [ml, worker] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url")]);
  await import("maplibre-gl/dist/maplibre-gl.css");
  ml.setWorkerUrl(worker.default);
  const style = await loadStyle(wantsDarkMap());
  const map = new ml.Map({
    container: el, style: style as never, center: coords[0], zoom: 17.5, pitch: 60, bearing: 0,
    maxPitch: 70, attributionControl: { compact: true }, fadeDuration: 0
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("fond de carte 3D trop lent")), 10_000);
      map.once("load", () => { clearTimeout(to); resolve(); });
      map.once("error", e => { if (!map.loaded()) { clearTimeout(to); reject(e.error ?? new Error("fond de carte 3D")); } });
    });
  } catch (e) { map.remove(); throw e; }
  // crédits repliés derrière le bouton ⓘ (ils restent accessibles), pour ne pas masquer la carte
  el.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  map.addSource("route", { type: "geojson", data: line(coords) });
  map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": CASING, "line-width": 13 } });
  map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ROUTE, "line-width": 9 } });

  const pinEl = document.createElement("div"); pinEl.innerHTML = PIN;
  new ml.Marker({ element: pinEl, anchor: "bottom" }).setLngLat([dest.lon, dest.lat]).addTo(map);
  const meEl = document.createElement("div"); meEl.innerHTML = ARROW;
  const me = new ml.Marker({ element: meEl, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat(coords[0]).addTo(map);

  let follow = true, lastBearing = 0;
  const moveCbs: (() => void)[] = [];
  map.on("dragstart", () => moveCbs.forEach(cb => cb()));
  return {
    setPosition(p, bearing) {
      if (bearing !== null) lastBearing = bearing;
      me.setLngLat([p.lon, p.lat]).setRotation(lastBearing);
      // position dans le bas de l'écran, carte tournée dans le sens de la marche
      if (follow) map.easeTo({ center: [p.lon, p.lat], bearing: lastBearing, pitch: 60, zoom: Math.max(map.getZoom(), 17), padding: { top: el.clientHeight * 0.4, bottom: 0, left: 0, right: 0 }, duration: 900 });
    },
    setRemaining(c) { (map.getSource("route") as unknown as { setData(d: unknown): void }).setData(line(c)); },
    setFollow(on) { follow = on; },
    onUserMove(cb) { moveCbs.push(cb); },
    destroy() { map.remove(); }
  };
}

function create2D(el: HTMLElement, coords: [number, number][], dest: LL): NavView {
  const map = L.map(el, { zoomControl: false }).setView([coords[0][1], coords[0][0]], 17);
  makeBaseLayer().addTo(map);
  const ll = (c: [number, number][]): L.LatLngTuple[] => c.map(([lo, la]) => [la, lo]);
  const casing = L.polyline(ll(coords), { color: CASING, weight: 10 }).addTo(map);
  const route = L.polyline(ll(coords), { color: ROUTE, weight: 7 }).addTo(map);
  L.marker([dest.lat, dest.lon], { icon: L.divIcon({ html: PIN, className: "lm-icon", iconSize: [38, 38], iconAnchor: [19, 36] }), interactive: false }).addTo(map);
  const me = L.circleMarker([coords[0][1], coords[0][0]], { radius: 9, color: "#fff", weight: 3, fillColor: "#4A90E2", fillOpacity: 1 }).addTo(map);
  map.fitBounds(route.getBounds(), { padding: [50, 50] });
  setTimeout(() => map.invalidateSize(), 50);
  let follow = true;
  const moveCbs: (() => void)[] = [];
  map.on("dragstart", () => moveCbs.forEach(cb => cb()));
  return {
    setPosition(p) { me.setLatLng([p.lat, p.lon]); if (follow) map.panTo([p.lat, p.lon], { animate: true }); },
    setRemaining(c) { casing.setLatLngs(ll(c)); route.setLatLngs(ll(c)); },
    setFollow(on) { follow = on; },
    onUserMove(cb) { moveCbs.push(cb); },
    destroy() { map.remove(); }
  };
}

/** Vue 3D si possible, sinon 2D ; « mode » indique laquelle a été retenue */
export async function createNavView(el: HTMLElement, coords: [number, number][], dest: LL): Promise<{ view: NavView; mode: "3d" | "2d" }> {
  if (hasWebGL()) {
    try { return { view: await create3D(el, coords, dest), mode: "3d" }; }
    catch (e) { console.warn("Guidage en 3D indisponible, carte 2D :", e); el.innerHTML = ""; }
  }
  return { view: create2D(el, coords, dest), mode: "2d" };
}
