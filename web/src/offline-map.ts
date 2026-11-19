/**
 * Carte sans réseau : les tuiles vectorielles de l'Eurométropole de Strasbourg, le style, les icônes et les polices sont livrés avec
 * l'appli (public/offline/map/, construit par scripts/build-map-pack.mjs ; données © OpenStreetMap, OpenFreeMap, © OpenMapTiles).
 * MapLibre lit les tuiles par un protocole « kumm:// » qui les extrait du paquet de tuiles (format KMP1, décrit dans le script).
 */
import { gunzipSync, strFromU8 } from "fflate";
import type * as MapLibre from "maplibre-gl";

type ML = typeof MapLibre;
interface Pack { bytes: Uint8Array; view: DataView; count: number; dataStart: number }

let pack: Promise<Pack> | undefined;
let lib: Promise<ML> | undefined;

async function loadPack(): Promise<Pack> {
  const r = await fetch("/offline/map/tiles.kmp");
  if (!r.ok) throw new Error("paquet de carte indisponible");
  const bytes = new Uint8Array(await r.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "KMP1") throw new Error("paquet de carte invalide");
  const count = view.getUint32(4);
  return { bytes, view, count, dataStart: 16 + count * 12 };
}

/** Octets (gzip) de la tuile z/x/y, null si elle n'est pas dans le paquet (recherche dichotomique dans l'index trié) */
export function findTile(p: Pack, z: number, x: number, y: number): Uint8Array | null {
  const key = z * 2 ** 28 + x * 2 ** 14 + y;
  let lo = 0, hi = p.count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, at = 16 + mid * 12, k = p.view.getUint32(at);
    if (k === key) { const off = p.dataStart + p.view.getUint32(at + 4); return p.bytes.subarray(off, off + p.view.getUint32(at + 8)); }
    if (k < key) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}

/** MapLibre, chargé à la demande, avec le protocole des tuiles locales et son travailleur */
export function loadMapLibre(): Promise<ML> {
  lib ??= (async () => {
    const [ml, worker] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url")]);
    await import("maplibre-gl/dist/maplibre-gl.css");
    ml.setWorkerUrl(worker.default);
    ml.addProtocol("kumm", async params => {
      const m = /^kumm:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
      if (!m) throw new Error("tuile invalide");
      const p = await (pack ??= loadPack());
      const gz = findTile(p, +m[1], +m[2], +m[3]);
      if (!gz) return { data: new ArrayBuffer(0) };   // hors de la zone couverte : tuile vide
      const raw = gunzipSync(gz);
      return { data: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer };
    });
    return ml;
  })();
  return lib;
}

/** Style clair (« liberty ») ou sombre d'OpenFreeMap, branché sur les tuiles, icônes et polices livrées avec l'appli */
export async function offlineStyle(dark: boolean): Promise<{ layers: { id: string; type: string }[] }> {
  const r = await fetch(`/offline/map/style-${dark ? "dark" : "liberty"}.json`);
  if (!r.ok) throw new Error("style de carte indisponible");
  return JSON.parse(strFromU8(new Uint8Array(await r.arrayBuffer())).replaceAll("__ORIGIN__", location.origin));
}
