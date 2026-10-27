export type Theme = "auto" | "light" | "sand" | "dark" | "ocean" | "night" | "contrast";
export type Accent = "green" | "teal" | "blue" | "purple" | "red";

/** Forme de l'interface : arrondis, ombres, densité, en-têtes (voir style.css, data-ui) */
export type Ui = "kumm" | "epure" | "bulles" | "compact";

export interface Prefs { theme: Theme; accent: Accent; ui: Ui; darkMap: boolean; v?: number }
export const DEFAULT_PREFS: Prefs = { theme: "auto", accent: "green", ui: "kumm", darkMap: true };

/** Thèmes proposés dans les réglages (couleurs de l'aperçu) */
export const THEMES: { id: Theme; label: string; hint: string; bg: string; bar: string }[] = [
  { id: "auto",     label: "Automatique",      hint: "suit votre téléphone", bg: "linear-gradient(135deg,#F2F6F3 50%,#0D1612 50%)", bar: "#DDF2E8" },
  { id: "light",    label: "Menthe",           hint: "clair et frais",       bg: "#F2F6F3", bar: "#FFFFFF" },
  { id: "sand",     label: "Sable",            hint: "clair et chaleureux",  bg: "#F5EFE4", bar: "#FFFCF6" },
  { id: "dark",     label: "Forêt",            hint: "sombre et reposant",   bg: "#0D1612", bar: "#15211B" },
  { id: "ocean",    label: "Océan",            hint: "bleu nuit profond",    bg: "#0A1222", bar: "#13203A" },
  { id: "night",    label: "Nuit",             hint: "noir pur, sobre en batterie", bg: "#000000", bar: "#141416" },
  { id: "contrast", label: "Contraste élevé",  hint: "lisible en plein soleil", bg: "#000000", bar: "#FFFFFF" }
];

/** Couleurs principales proposées */
export const ACCENTS: { id: Accent; label: string; color: string }[] = [
  { id: "green",  label: "Vert",      color: "#1C8A5A" },
  { id: "teal",   label: "Turquoise", color: "#0C8C95" },
  { id: "blue",   label: "Bleu",      color: "#2563C9" },
  { id: "purple", label: "Violet",    color: "#7B47C8" },
  { id: "red",    label: "Rouge", color: "#C8333B" }
];

/** Formes d'interface proposées */
export const UIS: { id: Ui; label: string; hint: string }[] = [
  { id: "kumm",    label: "Kumm",    hint: "l’original" },
  { id: "epure",   label: "Épuré",   hint: "sobre, sans couleur en haut" },
  { id: "bulles",  label: "Bulles",  hint: "tout en rondeur" },
  { id: "compact", label: "Compact", hint: "plus d’infos à l’écran" }
];

/** Fond clair ou sombre de chaque thème (le reste du style en découle), et sa palette propre */
const SCHEME: Record<Exclude<Theme, "auto">, "light" | "dark" | "contrast"> = { light: "light", sand: "light", dark: "dark", ocean: "dark", night: "dark", contrast: "contrast" };

export function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem("prefs") ?? "{}") as Partial<Prefs>;
    return {
      theme: THEMES.some(t => t.id === p.theme) ? (p.theme as Theme) : DEFAULT_PREFS.theme,
      accent: ACCENTS.some(a => a.id === p.accent) ? (p.accent as Accent) : DEFAULT_PREFS.accent,
      ui: UIS.some(u => u.id === p.ui) ? (p.ui as Ui) : DEFAULT_PREFS.ui,
      darkMap: p.v === 2 && typeof p.darkMap === "boolean" ? p.darkMap : DEFAULT_PREFS.darkMap
    };
  } catch { return { ...DEFAULT_PREFS }; }
}

export function savePrefs(p: Prefs): void {
  try { localStorage.setItem("prefs", JSON.stringify({ ...p, v: 2 })); } catch { /* stockage indisponible */ }
}

const dark = (): boolean => typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;

/** Applique les réglages à la page : tout le style en découle (voir style.css) */
export function applyTheme(p: Prefs): void {
  const r = document.documentElement;
  r.dataset.scheme = p.theme === "auto" ? (dark() ? "dark" : "light") : SCHEME[p.theme];
  r.dataset.palette = p.theme === "auto" ? "" : p.theme;
  r.dataset.accent = p.accent;
  r.dataset.ui = p.ui;
  r.dataset.mapdark = p.darkMap ? "1" : "0";
  // couleur de la barre du navigateur sur téléphone
  const head = getComputedStyle(r).getPropertyValue("--head-a").trim();
  if (head) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", head);
}

/** Couleurs de chaque thème et de chaque couleur principale, pour les aperçus de l'écran Apparence (mêmes valeurs que style.css) */
export interface Tokens { bg: string; card: string; ink: string; mute: string; line: string; chip: string; dark: boolean; head?: [string, string] }
export const THEME_TOKENS: Record<Exclude<Theme, "auto">, Tokens> = {
  light:    { bg: "#F2F6F3", card: "#FFFFFF", ink: "#15201B", mute: "#5F6E66", line: "#E0E8E2", chip: "#E7EEE9", dark: false },
  sand:     { bg: "#F5EFE4", card: "#FFFCF6", ink: "#2B2218", mute: "#7A6A58", line: "#E8DDCC", chip: "#EEE5D5", dark: false },
  dark:     { bg: "#0D1612", card: "#15211B", ink: "#E8F1EC", mute: "#8FA298", line: "#22312A", chip: "#1C2A23", dark: true },
  ocean:    { bg: "#0A1222", card: "#111C31", ink: "#E6EEFA", mute: "#8C9BB5", line: "#1D2A42", chip: "#18253D", dark: true, head: ["#0F2244", "#173563"] },
  night:    { bg: "#000000", card: "#0F0F11", ink: "#F2F2F2", mute: "#9A9AA0", line: "#1C1C20", chip: "#1A1A1D", dark: true, head: ["#0F0F11", "#16161A"] },
  contrast: { bg: "#000000", card: "#0A0A0A", ink: "#FFFFFF", mute: "#E6E6E6", line: "#FFFFFF", chip: "#1A1A1A", dark: true, head: ["#000000", "#000000"] }
};
/** [couleur, en-tête début, en-tête fin, fond doux] en clair puis en sombre */
export const ACCENT_TOKENS: Record<Accent, { light: [string, string, string, string]; dark: [string, string, string, string] }> = {
  green:  { light: ["#1C8A5A", "#136A45", "#1C8A5A", "#DDF2E8"], dark: ["#4ED39B", "#0E3A2A", "#17382B", "#17382B"] },
  teal:   { light: ["#0C8C95", "#096A71", "#0C8C95", "#D7F0F2"], dark: ["#3DD0D8", "#0B3A3E", "#143A3D", "#143A3D"] },
  blue:   { light: ["#2563C9", "#1B4A9C", "#2563C9", "#DFE9FB"], dark: ["#74A6FF", "#13305F", "#172C4F", "#172C4F"] },
  purple: { light: ["#7B47C8", "#5C33A2", "#7B47C8", "#EBE0F8"], dark: ["#B791FF", "#35205F", "#2A2046", "#2A2046"] },
  red:    { light: ["#C8333B", "#A2262D", "#C8333B", "#F9E1E2"], dark: ["#FF7077", "#4B1A1D", "#3A1F21", "#3A1F21"] }
};

export const accentColor = (): string => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1C8A5A";
