/**
 * Animation de lancement (dessinée dans index.html, avant le chargement du code) : retirée une fois l'application affichée,
 * après la fin de l'animation (1,9 s depuis l'ouverture, le logo complet reste visible un instant), ou tout de suite si l'utilisateur préfère réduire les animations.
 */
const MIN_MS = 1900;

export function hideSplash(): void {
  const el = document.getElementById("splash");
  if (!el) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = reduce ? 0 : Math.max(0, MIN_MS - performance.now());
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 500);
  }, wait);
}
