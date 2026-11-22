import { I } from "./icons";
import { KINDS } from "./kinds";
import type { Layer, Shape } from "./kinds";

const SHAPES: Record<Shape, string> = {
  circle: '<circle r="12"/>',
  square: '<rect x="-11" y="-11" width="22" height="22" rx="6"/>',
  diamond: '<rect x="-9" y="-9" width="18" height="18" rx="3" transform="rotate(45)"/>',
  hexagon: '<polygon points="0,-13 11.3,-6.5 11.3,6.5 0,13 -11.3,6.5 -11.3,-6.5"/>',
  octagon: '<polygon points="-4.6,-11 4.6,-11 11,-4.6 11,4.6 4.6,11 -4.6,11 -11,4.6 -11,-4.6"/>'
};

/** Dessin d'un repère (centré sur 0,0) */
function body(kind: Layer): string {
  const k = KINDS[kind];
  const glyph = k.glyph === "P" ? '<text text-anchor="middle" y="4.6" font-size="13" font-weight="800" fill="#fff">P</text>'
    : k.glyph === "P+R" ? '<text text-anchor="middle" y="3.2" font-size="8.5" font-weight="800" fill="#fff">P+R</text>'
    : `<g transform="translate(-7.5 -7.5) scale(.625)" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${I[k.glyph]}</g>`;
  return `<g fill="${k.color}" stroke="#fff" stroke-width="2">${SHAPES[k.shape]}</g>${glyph}`;
}

/** Repère placé sur la carte (attrs : data-stop="…" ou data-poi="…") */
export const marker = (kind: Layer, x: number, y: number, attrs: string): string =>
  `<g ${attrs} style="cursor:pointer" transform="translate(${x} ${y})"><title>${KINDS[kind].label}</title>${body(kind)}</g>`;

/** Petite icône (pour les boutons de filtre et les fiches) */
export const markerIcon = (kind: Layer, size = 24): string =>
  `<svg viewBox="-14 -14 28 28" width="${size}" height="${size}" aria-hidden="true">${body(kind)}</svg>`;
