import "leaflet/dist/leaflet.css";
import type { WalkRoute } from "../../shared/types";
import { bearing, distToRoute, fmtDist, fmtMin, haversine, nearestOnRoute } from "./geo";
import { toast } from "./store";
import type { LL } from "./geo";
import { createNavView } from "./navmap";
import type { NavView } from "./navmap";
import { arrowFor, fetchWalk } from "./walk";
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
/** Au-delà, le guidage n'a pas de sens (position hors de Strasbourg, mauvaise destination…) */
const MAX_KM = { walk: 30, bike: 80 };
let current: (() => void) | null = null;
let currentSpeed: number = WALK_SPEED;

export function stopNav(): void {
  current?.();
  current = null;
}

export function startNav(o: NavOptions): void {
  const mode = o.route.mode ?? "walk";
  if (o.route.distance > MAX_KM[mode] * 1000) {
    toast(`Trajet de ${fmtDist(o.route.distance)} : trop long pour un guidage ${mode === "bike" ? "à vélo" : "à pied"}. Vérifiez votre position.`);
    return;
  }
  stopNav();
  currentSpeed = o.route.mode === "bike" ? BIKE_SPEED : WALK_SPEED;
  let route = o.route;
  let idx = Math.min(1, route.steps.length - 1);
  const spoken = new Set<number>();
  let finished = false, wasOnRoute = false, offCount = 0, lastReroute = 0, rerouting = false;
  let watchId: number | null = null;

  const layer = document.createElement("div");
  layer.id = "navlayer";
  layer.innerHTML = `
    <div class="nv-top"><div class="nv-dir"><span id="nv-arrow">↑</span><small id="nv-dist"></small></div><b id="nv-text"></b></div>
    <div id="nv-map"></div>
    <button id="nv-recenter" hidden>➤ Recentrer</button>
    <div id="nv-end" hidden></div>
    <div class="nv-bottom">
      <div><b id="nv-eta"></b><small id="nv-rem"></small></div>
      <div class="nv-btns"><button id="nv-quit">Quitter</button></div>
    </div>`;
  document.body.appendChild(layer);
  const $ = <T extends HTMLElement>(id: string): T => layer.querySelector<T>("#" + id) as T;

  const first = route.coords[0];
  // carte 3D (ou 2D de repli), créée en arrière-plan : les consignes s'affichent sans l'attendre
  let view: NavView | null = null, stopped = false, lastPos: LL | null = null, lastBearing: number | null = null;
  void createNavView($("nv-map"), route.coords, o.dest).then(({ view: v, mode }) => {
    if (stopped) { v.destroy(); return; }
    view = v;
    layer.dataset.mode = mode;
    v.onUserMove(() => { v.setFollow(false); $("nv-recenter").hidden = false; });
    if (lastPos) showOnMap(lastPos);
  });
  /** Position sur la carte : la ligne bleue ne garde que ce qui reste à parcourir, la carte s'oriente dans le sens du trajet */
  function showOnMap(p: LL): void {
    if (!view) return;
    const near = wasOnRoute ? nearestOnRoute(p, route.coords) : null;
    if (near) {
      const a = route.coords[near.i], b = route.coords[near.i + 1] ?? a;
      lastBearing = bearing({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });
      view.setRemaining([near.point, ...route.coords.slice(near.i + 1)]);
    }
    view.setPosition(p, lastBearing);
  }
  /** Heure d'arrivée estimée, à l'heure de Strasbourg */
  const arrival = (sec: number): string => new Date(Date.now() + sec * 1000).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

  function speak(text: string): void {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    window.speechSynthesis.speak(u);
  }

  function finish(): void {
    if (finished) return;
    finished = true;
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
    lastPos = p;
    const dRoute = distToRoute(p, route.coords);
    if (dRoute < 150) wasOnRoute = true;
    if (!wasOnRoute) {
      $("nv-arrow").textContent = "↑";
      $("nv-text").textContent = "Rejoignez le départ de l’itinéraire";
      $("nv-dist").textContent = fmtDist(haversine(p, { lon: route.coords[0][0], lat: route.coords[0][1] }));
      return;
    }
    showOnMap(p);
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
    if (offCount >= 3 && !rerouting && Date.now() - lastReroute > 15000) {
      rerouting = true; lastReroute = Date.now();
      $("nv-text").textContent = "Recalcul de l’itinéraire…";
      fetchWalk(p, o.dest).then(r => {
        route = r; idx = Math.min(1, r.steps.length - 1); spoken.clear(); offCount = 0;
        view?.setRemaining(r.coords);
      }).catch(() => { /* on garde l'ancien tracé */ }).finally(() => { rerouting = false; });
    }
  }

  // position réelle
  if ("geolocation" in navigator) {
    watchId = navigator.geolocation.watchPosition(
      pos => onPos({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => { if (!wasOnRoute) { $("nv-text").textContent = "Position indisponible : activez la localisation"; $("nv-dist").textContent = ""; } },
      { enableHighAccuracy: true, maximumAge: 2000 }
    );
  }
  onPos({ lat: first[1], lon: first[0] });

  $("nv-quit").onclick = stopNav;
  $("nv-recenter").onclick = () => {
    $("nv-recenter").hidden = true;
    view?.setFollow(true);
    if (lastPos) showOnMap(lastPos);
  };

  current = () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    window.speechSynthesis?.cancel();
    stopped = true;
    view?.destroy();
    layer.remove();
  };
}
