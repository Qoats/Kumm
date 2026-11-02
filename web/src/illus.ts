/**
 * Dessins de la forme « Alsace » : maisons à colombages, cathédrale de Strasbourg (une seule flèche, au nord) et tram,
 * au trait légèrement tremblé (filtre de bruit) pour un rendu dessiné à la main. Couleur : celle du thème (--draw).
 */
const HAND = `<filter id="kumm-hand"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="2.2"/></filter>`;
const G = `fill="none" stroke="var(--draw)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" filter="url(#kumm-hand)"`;

/** Strasbourg en une ligne : en tête de l'accueil */
export const TOWN = `<svg class="town" viewBox="0 0 390 118" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><defs>${HAND}</defs><g ${G}>
  <path d="M0 112 H390"/>
  <path d="M8 112 V70 L30 44 L52 70 V112"/><path d="M8 70 H52 M8 86 H52 M8 100 H52 M19 70 L30 86 L41 70 M19 86 L30 100 L41 86 M30 44 V70"/>
  <rect x="14" y="74" width="8" height="8"/><rect x="38" y="74" width="8" height="8"/><path d="M26 112 V102 H34 V112"/>
  <path d="M52 112 V78 L70 58 L88 78 V112"/><path d="M52 92 H88 M61 78 L70 92 L79 78 M61 92 L70 104 L79 92"/><rect x="57" y="82" width="7" height="7"/><rect x="76" y="82" width="7" height="7"/>
  <path d="M112 112 V52 H176 V112"/><path d="M112 52 L118 44 H170 L176 52"/>
  <circle cx="144" cy="78" r="13"/><circle cx="144" cy="78" r="5"/><path d="M131 78 H157 M144 65 V91 M135 69 L153 87 M153 69 L135 87"/>
  <path d="M128 112 V98 Q134 90 140 98 V112 M148 112 V98 Q154 90 160 98 V112"/>
  <path d="M112 52 V28 H130 V52"/><path d="M114 28 L121 6 L128 28"/><path d="M121 6 V1"/><path d="M116 22 H126 M117 16 H125 M118 10 H124"/>
  <path d="M117 36 V46 M125 36 V46"/><path d="M158 52 V40 H174 V52"/>
  <path d="M190 112 V74 L208 50 L226 74 V112"/><path d="M190 74 H226 M190 90 H226 M199 74 L208 90 L217 74 M208 50 V74"/><rect x="195" y="94" width="8" height="10"/><rect x="213" y="94" width="8" height="10"/>
  <path d="M240 108 V84 Q240 78 246 78 H362 Q378 78 382 92 L384 108 Z"/>
  <path d="M250 84 H268 V96 H250 Z M276 84 H294 V96 H276 Z M302 84 H320 V96 H302 Z M328 84 H346 V96 H328 Z M356 84 H370 Q376 84 378 96 H356 Z"/>
  <path d="M270 78 V74 H286 L282 70 M282 70 L292 62"/><circle cx="262" cy="110" r="3"/><circle cx="350" cy="110" r="3"/>
</g></svg>`;

/** Deux maisons à colombages : en coin, en tête d'une fiche */
export const HOUSES = `<svg class="stamp" viewBox="0 0 120 80" aria-hidden="true"><defs>${HAND.replace('id="kumm-hand"', 'id="kumm-hand2"')}</defs><g ${G.replace("kumm-hand", "kumm-hand2")} opacity=".55">
  <path d="M8 78 V34 L30 10 L52 34 V78"/><path d="M8 34 H52 M8 52 H52 M19 34 L30 52 L41 34 M19 52 L30 68 L41 52 M30 10 V34"/>
  <path d="M52 78 V44 L72 22 L92 44 V78"/><path d="M52 58 H92 M62 44 L72 58 L82 44"/><rect x="58" y="62" width="9" height="9"/><rect x="77" y="62" width="9" height="9"/>
</g></svg>`;
