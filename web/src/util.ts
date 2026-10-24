const ENT: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Échappe le texte venant de l'API avant de l'insérer dans du HTML */
export const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, c => ENT[c]);

/** Compare deux numéros de version (« 0.10.2 » > « 0.9.0 ») : négatif si a < b, 0 si égaux, positif si a > b */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(n => parseInt(n, 10) || 0), pb = b.split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Texte comparable pour la recherche : sans accents ni majuscules, « œ » → « oe », tirets et apostrophes → espaces */
export const fold = (t: string): string =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/[-’'/]+/g, " ").replace(/\s+/g, " ").trim();
