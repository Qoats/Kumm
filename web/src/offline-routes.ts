/**
 * Itinéraires à pied et à vélo sans réseau : le graphe de rues de l'Eurométropole (OpenStreetMap, ODbL) est livré avec l'appli
 * (public/offline/walk-graph.bin, construit par scripts/build-walk-graph.mjs) et lu au premier besoin.
 * En dehors de la zone couverte, ou si le graphe est indisponible, l'appli retombe sur le service en ligne.
 */
import { gunzipSync, strFromU8 } from "fflate";
import { loadWalkGraph, routeOnGraph } from "../../shared/walk-graph";
import type { RawWalkGraph, WalkGraph, WalkMode } from "../../shared/walk-graph";
import type { OsrmResponse } from "../../shared/geo-api";
import type { LL } from "./geo";

let graph: Promise<WalkGraph | null> | undefined;

/** Lit et prépare le graphe (une seule fois) ; null si le fichier n'est pas disponible */
export function loadOfflineGraph(): Promise<WalkGraph | null> {
  graph ??= (async () => {
    try {
      const r = await fetch("/offline/walk-graph.bin");
      if (!r.ok) return null;
      const bytes = new Uint8Array(await r.arrayBuffer());
      // fichier compressé (gzip) ; certains serveurs le décompressent déjà en route
      const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? strFromU8(gunzipSync(bytes)) : strFromU8(bytes);
      return loadWalkGraph(JSON.parse(text) as RawWalkGraph);
    } catch { return null; }
  })();
  return graph;
}

/** Itinéraire calculé sur l'appareil ; null si le graphe manque ou si les points sortent de la zone (le service en ligne prend alors le relais) */
export async function offlineRoute(mode: WalkMode, from: LL, to: LL): Promise<OsrmResponse | null> {
  const g = await loadOfflineGraph();
  if (!g) return null;
  try {
    const j = routeOnGraph(g, mode, from, to);
    return j.code === "Ok" ? j : null;
  } catch { return null; }
}
