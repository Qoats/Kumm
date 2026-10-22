export type Theme = "auto" | "light" | "dark" | "contrast";
export type Accent = "green" | "teal" | "blue" | "purple" | "red";

export interface Prefs { theme: Theme; accent: Accent; darkMap: boolean; v?: number }
export const DEFAULT_PREFS: Prefs = { theme: "auto", accent: "green", darkMap: true };

/** Thèmes proposés dans les réglages (couleurs de l'aperçu) */
export const THEMES: { id: Theme; label: string; hint: string; bg: string; bar: string }[] = [
  { id: "auto",     label: "Automatique",      hint: "suit votre téléphone", bg: "linear-gradient(135deg,#F2F6F3 50%,#0D1612 50%)", bar: "#DDF2E8" },
  { id: "light",    label: "Menthe",           hint: "clair et frais",       bg: "#F2F6F3", bar: "#FFFFFF" },
  { id: "dark",     label: "Forêt",            hint: "sombre et reposant",   bg: "#0D1612", bar: "#15211B" },
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

export function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem("prefs") ?? "{}") as Partial<Prefs>;
    return {
      theme: THEMES.some(t => t.id === p.theme) ? (p.theme as Theme) : DEFAULT_PREFS.theme,
      accent: ACCENTS.some(a => a.id === p.accent) ? (p.accent as Accent) : DEFAULT_PREFS.accent,
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
  r.dataset.scheme = p.theme === "auto" ? (dark() ? "dark" : "light") : p.theme;
  r.dataset.accent = p.accent;
  r.dataset.mapdark = p.darkMap ? "1" : "0";
  // couleur de la barre du navigateur sur téléphone
  const head = getComputedStyle(r).getPropertyValue("--head-a").trim();
  if (head) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", head);
}

export const accentColor = (): string => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1C8A5A";
