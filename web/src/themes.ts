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

export const accentColor = (): string => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1C8A5A";
