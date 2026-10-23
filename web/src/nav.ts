import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { WalkRoute } from "../../shared/types";
import { cumulative, distToRoute, fmtDist, fmtMin, haversine, pointAt } from "./geo";
import type { LL } from "./geo";
import { arrowFor, fetchWalk } from "./walk";
import { accentColor } from "./themes";
import { makeBaseLayer } from "./tiles";
import { esc } from "./util";

export interface NavAction { label: string; run: () => void }
export interface NavOptions {
  /** texte brut (échappé à l'affichage) */
  title: string;
  route: WalkRoute;
  dest: LL & { label: string };
  /** message affiché à l'arrivée (HTML) et boutons proposés */
  endHtml?: string;
  actions?: NavAction[];
}

const WALK_SPEED = 1.35;   // m/s, marche normale
const BIKE_SPEED = 4.2;    // m/s, vélo en ville (~15 km/h)
const SIM_STEP = 14;       // mètres parcourus par tick en simulation
let current: (() => void) | null = null;
let currentSpeed: number = WALK_SPEED;

export function stopNav(): void {
  current?.();
  current = null;
}

export function startNav(o: NavOptions): void {
  stopNav();
  currentSpeed = o.route.mode === "bike" ? BIKE_SPEED : WALK_SPEED;
  let route = o.route;
  let cum = cumulative(route.coords);
  let idx = Math.min(1, route.steps.length - 1);
  const spoken = new Set<number>();
  let sound = true, finished = false, wasOnRoute = false, offCount = 0, lastReroute = 0, rerouting = false;
  let simTimer = 0, simDist = 0, watchId: number | null = null;

  const layer = document.createElement("div");
  layer.id = "navlayer";
  layer.innerHTML = `
    <div class="nv-top"><div class="nv-dir"><span id="nv-arrow">↑</span><small id="nv-dist"></small></div><b id="nv-text"></b></div>
    <div id="nv-map"></div>
    <button id="nv-recenter" hidden>➤ Recentrer</button>
    <div id="nv-end" hidden></div>
    <div class="nv-bottom">
      <div><b id="nv-eta"></b><small id="nv-rem"></small></div>
      <div class="nv-btns"><button id="nv-snd" aria-label="Son">🔊</button><button id="nv-sim">Simuler</button><button id="nv-quit">Quitter</button></div>
    </div>`;
  document.body.appendChild(layer);
  const $ = <T extends HTMLElement>(id: string): T => layer.querySelector<T>("#" + id) as T;

  const first = route.coords[0];
  const map = L.map($("nv-map"), { zoomControl: false }).setView([first[1], first[0]], 17);
  makeBaseLayer().addTo(map);
  const latlngs = (c: [number, number][]): L.LatLngTuple[] => c.map(([lo, la]) => [la, lo]);
  const line = L.polyline(latlngs(route.coords), { color: "#1B6EC2", weight: 7, opacity: 0.9 }).addTo(map);
  L.circleMarker([o.dest.lat, o.dest.lon], { radius: 9, color: "#fff", weight: 3, fillColor: accentColor(), fillOpacity: 1 }).addTo(map);
  const me = L.circleMarker([first[1], first[0]], { radius: 9, color: "#fff", weight: 3, fillColor: "#4A90E2", fillOpacity: 1 }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [50, 50] });
  setTimeout(() => map.invalidateSize(), 50);
  // la carte suit la position ; si on la déplace au doigt, elle s'arrête jusqu'à « Recentrer »
  let follow = true, lastPos: LL | null = null;
  map.on("dragstart", () => { follow = false; $("nv-recenter").hidden = false; });
  /** Heure d'arrivée estimée, à l'heure de Strasbourg */
  const arrival = (sec: number): string => new Date(Date.now() + sec * 1000).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

  function speak(text: string): void {
    if (!sound || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    window.speechSynthesis.speak(u);
  }

  function finish(): void {
    if (finished) return;
    finished = true;
    window.clearInterval(simTimer);
    $("nv-text").textContent = `Vous êtes arrivé : ${o.dest.label}`;
    $("nv-dist").textContent = "";
    $("nv-arrow").textContent = "⚑";
    speak("Vous êtes arrivé");
    const end = $("nv-end");
    end.hidden = false;
    end.innerHTML = `<b>${esc(o.title)}</b><p>${o.endHtml ?? "Vous êtes arrivé à destination."}</p><div class="nv-acts"></div>`;
    const acts = end.querySelector(".nv-acts") as HTMLElement;
    for (const a of o.actions ?? []) {
      const b = document.createElement("button");
      b.className = "go";
      b.textContent = a.label;
      b.onclick = () => { stopNav(); a.run(); };
      acts.appendChild(b);
    }
    const done = document.createElement("button");
    done.className = "nv-done";
    done.textContent = "Terminer";
    done.onclick = stopNav;
    acts.appendChild(done);
  }

  function onPos(p: LL): void {
    if (finished) return;
    me.setLatLng([p.lat, p.lon]);
    lastPos = p;
    const dRoute = distToRoute(p, route.coords);
    if (dRoute < 150) wasOnRoute = true;
    if (!wasOnRoute) {
      $("nv-arrow").textContent = "↑";
      $("nv-text").textContent = "Rejoignez le départ de l’itinéraire";
      $("nv-dist").textContent = fmtDist(haversine(p, { lon: route.coords[0][0], lat: route.coords[0][1] }));
      return;
    }
    if (follow) map.panTo([p.lat, p.lon], { animate: true });
    const steps = route.steps;
    while (idx < steps.length - 1 && haversine(p, steps[idx]) < 25) idx++;
    const next = steps[idx];
    const d = haversine(p, next);
    if (idx === steps.length - 1 && d < 20) { finish(); return; }

    $("nv-arrow").textContent = arrowFor(next);
    const isEnd = next.type === "arrive";
    $("nv-text").textContent = isEnd ? `Destination : ${o.dest.label}` : next.text;
    $("nv-dist").textContent = d > 30 ? fmtDist(d) : "";
    let remaining = d;
    for (let j = idx; j < steps.length; j++) remaining += steps[j].distance;
    $("nv-eta").textContent = fmtMin(remaining / currentSpeed);
    $("nv-rem").textContent = `${fmtDist(remaining)} · ${arrival(remaining / currentSpeed)}`;
    if (d < 80 && !spoken.has(idx)) { spoken.add(idx); speak(`Dans ${Math.round(d / 10) * 10} mètres, ${isEnd ? "votre destination" : next.text}`); }

    // hors itinéraire : recalcul depuis la position actuelle
    offCount = dRoute > 60 ? offCount + 1 : 0;
    if (offCount >= 3 && !rerouting && simTimer === 0 && Date.now() - lastReroute > 15000) {
      rerouting = true; lastReroute = Date.now();
      $("nv-text").textContent = "Recalcul de l’itinéraire…";
      fetchWalk(p, o.dest).then(r => {
        route = r; cum = cumulative(r.coords); idx = Math.min(1, r.steps.length - 1); spoken.clear(); offCount = 0;
        line.setLatLngs(latlngs(r.coords));
      }).catch(() => { /* on garde l'ancien tracé */ }).finally(() => { rerouting = false; });
    }
  }

  // position réelle
  if ("geolocation" in navigator) {
    watchId = navigator.geolocation.watchPosition(
      pos => { if (simTimer === 0) onPos({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
      () => { if (!wasOnRoute) { $("nv-text").textContent = "Position indisponible : utilisez « Simuler »"; $("nv-dist").textContent = ""; } },
      { enableHighAccuracy: true, maximumAge: 2000 }
    );
  }
  onPos({ lat: first[1], lon: first[0] });

  // simulation de marche (pour tester sans bouger)
  $("nv-sim").onclick = () => {
    if (simTimer) { window.clearInterval(simTimer); simTimer = 0; $("nv-sim").textContent = "Simuler"; return; }
    $("nv-sim").textContent = "Arrêter";
    simDist = 0; idx = Math.min(1, route.steps.length - 1); spoken.clear(); wasOnRoute = true;
    simTimer = window.setInterval(() => {
      simDist += SIM_STEP;
      onPos(pointAt(route.coords, cum, simDist));
      if (simDist >= cum[cum.length - 1]) { window.clearInterval(simTimer); simTimer = 0; finish(); }
    }, 500);
  };
  $("nv-snd").onclick = () => { sound = !sound; $("nv-snd").textContent = sound ? "🔊" : "🔇"; if (!sound) window.speechSynthesis?.cancel(); };
  $("nv-quit").onclick = stopNav;
  $("nv-recenter").onclick = () => {
    follow = true; $("nv-recenter").hidden = true;
    if (lastPos) map.setView([lastPos.lat, lastPos.lon], Math.max(map.getZoom(), 17), { animate: true });
  };

  current = () => {
    window.clearInterval(simTimer);
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    window.speechSynthesis?.cancel();
    map.remove();
    layer.remove();
  };
}
