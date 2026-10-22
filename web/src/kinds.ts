import type { IconName } from "./icons";

/** Les catégories de points affichées sur la carte */
export type Layer = "tram" | "bus" | "ter" | "velhop" | "velopark" | "pr" | "flexhop";
export const LAYERS: Layer[] = ["tram", "bus", "velhop", "velopark", "pr", "flexhop", "ter"];

export type Shape = "circle" | "square" | "diamond" | "hexagon" | "shield" | "octagon";

/** Chaque catégorie a sa couleur, sa forme et son symbole : on les distingue même sans voir les couleurs */
export const KINDS: Record<Layer, { label: string; color: string; shape: Shape; glyph: IconName | "P" | "P+R" }> = {
  tram:     { label: "Tram",      color: "#0B4A9E", shape: "circle",  glyph: "tram" },
  bus:      { label: "Bus",       color: "#1296A8", shape: "square",  glyph: "bus" },
  velhop:   { label: "Vélhop",    color: "#86B80B", shape: "circle",  glyph: "bike" },
  velopark: { label: "Vélopark",  color: "#2E7D32", shape: "diamond", glyph: "P" },
  pr:       { label: "P+R",       color: "#1B6EC2", shape: "hexagon", glyph: "P+R" },
  flexhop:  { label: "Flex’hop",  color: "#E5007E", shape: "shield",  glyph: "phone" },
  ter:      { label: "Gare TER",  color: "#7B1FA2", shape: "octagon", glyph: "train" }
};
