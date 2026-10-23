/**
 * Positions de défilement gardées d'un redessin à l'autre, pour TOUTES les zones qui défilent (verticalement ou de côté).
 *
 * L'interface est redessinée en entier à chaque changement (render → innerHTML) : sans ce module, chaque liste revenait
 * en haut dès qu'on touchait un bouton (réglages, choix d'une direction, catégories de la carte…). Plutôt qu'une liste de
 * zones à surveiller (qu'on oubliait de compléter à chaque nouveau menu), on mémorise toutes celles qui ont défilé.
 *
 * Chaque zone est reconnue par son id, son attribut data-scroll, ou à défaut par sa place dans la page. Les positions
 * sont rangées par écran : un onglet retrouve sa position quand on y revient ; une fiche (arrêt, ligne, réglages…)
 * repart du haut à chaque ouverture.
 */

/** écran → zone → [haut, gauche] */
const memory = new Map<string, Map<string, [number, number]>>();

function keyOf(el: HTMLElement, root: HTMLElement): string {
  if (el.id) return "#" + el.id;
  if (el.dataset["scroll"]) return "@" + el.dataset["scroll"];
  const parts: string[] = [];
  for (let e: HTMLElement | null = el; e && e !== root; e = e.parentElement) {
    const p = e.parentElement;
    if (!p) break;
    // balise et rang seulement : les classes changent d'un redessin à l'autre (animation « enter », « on »…)
    parts.unshift(e.tagName + Array.prototype.indexOf.call(p.children, e));
  }
  return parts.join(">");
}

/** Zone qu'on fait défiler au doigt (et non un texte simplement coupé, en overflow:hidden) */
function canScroll(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  return /auto|scroll/.test(s.overflowY) || /auto|scroll/.test(s.overflowX);
}

/** Zones qui défilent ; la carte (Leaflet) et ses milliers de repères sont ignorés */
function scrollables(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (el: Element): void => {
    for (const c of Array.from(el.children)) {
      if (!(c instanceof HTMLElement) || c.classList.contains("leaflet-container") || c.classList.contains("maplibregl-map")) continue;
      if ((c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1) && canScroll(c)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** Avant le redessin : note la position de chaque zone de l'écran affiché */
export function saveScroll(root: HTMLElement, screen: string): void {
  const m = memory.get(screen) ?? new Map<string, [number, number]>();
  for (const el of scrollables(root)) {
    const k = keyOf(el, root);
    if (el.scrollTop || el.scrollLeft) m.set(k, [el.scrollTop, el.scrollLeft]); else m.delete(k);
  }
  memory.set(screen, m);
}

/** Après le redessin : remet chaque zone à sa position (à rappeler quand un contenu chargé plus tard l'a allongée) */
export function restoreScroll(root: HTMLElement, screen: string): void {
  const m = memory.get(screen);
  if (!m?.size) return;
  for (const el of scrollables(root)) {
    const pos = m.get(keyOf(el, root));
    if (!pos) continue;
    if (pos[0] && el.scrollTop !== pos[0]) el.scrollTop = pos[0];
    if (pos[1] && el.scrollLeft !== pos[1]) el.scrollLeft = pos[1];
  }
}

/** Une fiche fermée repart du haut à sa prochaine ouverture */
export function forgetScroll(screen: string): void { memory.delete(screen); }
