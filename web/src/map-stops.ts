import type { FeatureCollection, Point } from "geojson";
import type { FilterSpecification, StyleSpecification } from "maplibre-gl";
import type { Stop } from "../../shared/types";
import { isHub, kindOfStop } from "./data";
import { markerIcon } from "./markers";

export const STOP_SOURCE = "kumm-stops";
export const STOP_LAYERS = ["kumm-stops-overview", "kumm-stops-nearby", "kumm-stops-icons"];
const STOP_KINDS = ["tram", "bus", "ter"] as const;
export const bundledStopCounts = { tram: 0, bus: 0, ter: 0 };
let bundled: Promise<FeatureCollection<Point>> | undefined;

export function bundledStopFeatures(): Promise<FeatureCollection<Point>> {
  return bundled ??= fetch("/data/map-stops.geojson").then(async r => {
    if (!r.ok) return stopFeatures([]);
    const data = await r.json() as FeatureCollection<Point>;
    for (const point of data.features) {
      const kind: unknown = point.properties?.kind;
      if (kind === "tram" || kind === "bus" || kind === "ter") bundledStopCounts[kind]++;
    }
    return data;
  }).catch(() => stopFeatures([]));
}

export function stopFeatures(stops: Stop[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: stops.map(stop => {
      const kind = kindOfStop(stop);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [stop.lon, stop.lat] },
        properties: { id: stop.id, name: stop.name, kind, hub: isHub(stop), priority: kind === "bus" ? 2 : kind === "tram" ? 1 : 0 }
      };
    })
  };
}

export function stopFilters(active: string[], hubs: boolean): FilterSpecification[] {
  const visible: FilterSpecification = ["case", ["get", "hub"], hubs, ["in", ["get", "kind"], ["literal", active]]];
  return [["all", visible, ["!=", ["get", "kind"], "bus"]], visible, visible];
}

export function addStopLayers(style: StyleSpecification, mobile: boolean, data: FeatureCollection<Point>): void {
  style.sources[STOP_SOURCE] = { type: "geojson", data };
  const filters = stopFilters([...STOP_KINDS], true);
  const bands = [[0, 13, 0.28], [13, 15, 0.36], [15, 24, 1]];
  for (const [index, id] of STOP_LAYERS.entries()) {
    const [minzoom, maxzoom, size] = bands[index];
    style.layers.push({ id, type: "symbol", source: STOP_SOURCE, minzoom, maxzoom, filter: filters[index], layout: {
      "icon-image": ["concat", "kumm-stop-", ["get", "kind"]],
      "icon-size": size, "icon-padding": mobile ? 3 : 1, "symbol-sort-key": ["get", "priority"],
      "icon-allow-overlap": index === 2
    } });
  }
}

let icons: Promise<Map<string, ImageData>> | undefined;
export function stopImages(): Promise<Map<string, ImageData>> {
  return icons ??= Promise.all(STOP_KINDS.map(async kind => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 60;
    const context = canvas.getContext("2d");
    if (!context) throw Error("Icônes d’arrêts indisponibles");
    const img = new Image();
    const svg = markerIcon(kind, 60).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    context.drawImage(img, 0, 0);
    return [`kumm-stop-${kind}`, context.getImageData(0, 0, 60, 60)] as const;
  })).then(entries => new Map(entries));
}
