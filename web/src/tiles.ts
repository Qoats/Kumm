import { AUTONOMOUS } from "./local";
import * as L from "leaflet";
import { url } from "./config";
import { loadMapLibre, offlineStyle } from "./offline-map";

/** Tuiles servies par notre serveur (même origine : identifiées, gardées en mémoire, lisibles par le canevas) */
const TILE_URL = AUTONOMOUS ? "https://tile.openstreetmap.org/{z}/{x}/{y}.png" : url("/tiles/{z}/{x}/{y}.png");

/**
 * Assombrit une tuile : inverse les couleurs puis fait tourner les teintes de 180° pour retrouver les couleurs
 * d'origine (l'eau reste bleue, les parcs verts), avec un léger éclaircissement. Fait une seule fois par tuile,
 * sans filtre CSS : pas de scintillement quand la carte se redessine.
 */
export function darken(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = 255 - data[i], g = 255 - data[i + 1], b = 255 - data[i + 2];
    data[i]     = (-0.574 * r + 1.43 * g + 0.144 * b) * 0.9;
    data[i + 1] = ( 0.426 * r + 0.43 * g + 0.144 * b) * 0.9;
    data[i + 2] = ( 0.426 * r + 1.43 * g - 0.856 * b) * 0.9;
  }
}

class DarkTiles extends L.GridLayer {
  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement("canvas");
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    const img = new Image();
    img.crossOrigin = "anonymous";   // serveur sur une autre adresse (APK) : nécessaire pour assombrir la tuile
    img.onload = () => {
      const ctx = tile.getContext("2d");
      if (!ctx) { done(new Error("canevas indisponible"), tile); return; }
      ctx.drawImage(img, 0, 0, size.x, size.y);
      const px = ctx.getImageData(0, 0, size.x, size.y);
      darken(px.data);
      ctx.putImageData(px, 0, 0);
      done(undefined, tile);
    };
    // adresse à part (« ?c=1 ») : la même tuile déjà chargée par la carte claire est gardée en cache sans l'autorisation
    // d'être lue par le canevas ; la réutiliser ferait échouer la tuile sombre. Un échec (réseau) est retenté une fois.
    const src = TILE_URL.replace("{z}", String(coords.z)).replace("{x}", String(coords.x)).replace("{y}", String(coords.y)) + "?c=1";
    let retried = false;
    img.onerror = () => {
      if (!retried) { retried = true; window.setTimeout(() => { img.src = src + "&r=" + Date.now(); }, 800); return; }
      done(new Error("tuile indisponible"), tile);
    };
    img.src = src;
    return tile;
  }
}

/** Le thème actuel demande-t-il une carte sombre ? */
export const wantsDarkMap = (): boolean => {
  const r = document.documentElement.dataset;
  return (r["scheme"] === "dark" || r["scheme"] === "contrast") && r["mapdark"] !== "0";
};

const onlineBase = (dark: boolean): L.GridLayer => dark ? new DarkTiles({ maxZoom: 19 }) : L.tileLayer(TILE_URL, { maxZoom: 19 });

function hasWebGL(): boolean {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") ?? c.getContext("webgl")); } catch { return false; }
}

/**
 * Fond de carte sans réseau (tuiles vectorielles livrées avec l'appli, dessinées par MapLibre) : MapLibre n'est chargé qu'à
 * l'ajout à la carte. Si le téléphone ne sait pas dessiner en WebGL ou si le paquet manque, on retombe sur les tuiles en ligne.
 */
class OfflineBase extends L.Layer {
  private inner: L.Layer | null = null;
  private map: L.Map | null = null;
  constructor(private dark: boolean) { super(); }
  override onAdd(map: L.Map): this {
    this.map = map;
    void this.attach(map);
    return this;
  }
  private async attach(map: L.Map): Promise<void> {
    let layer: L.Layer;
    try {
      if (!hasWebGL()) throw new Error("WebGL indisponible");
      const [ml, plugin, style] = await Promise.all([loadMapLibre(), import("@maplibre/maplibre-gl-leaflet"), offlineStyle(this.dark)]);
      void ml;
      layer = plugin.maplibreGL({ style: style as never, interactive: false } as never);
    } catch { layer = onlineBase(this.dark); }
    if (this.map !== map) return;       // retirée de la carte pendant le chargement
    this.inner = layer.addTo(map);
  }
  override onRemove(map: L.Map): this {
    this.map = null;
    this.inner?.remove();
    this.inner = null;
    void map;
    return this;
  }
}

export function makeBaseLayer(dark = wantsDarkMap()): L.Layer {
  return AUTONOMOUS ? new OfflineBase(dark) : onlineBase(dark);
}
