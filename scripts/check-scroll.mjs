// Vérifie qu'aucun menu ne revient en haut quand l'écran se redessine (voir web/src/scroll.ts et le README).
// Pour chaque menu : fait défiler toutes les zones, redessine l'écran deux fois, vérifie que chaque zone est restée à sa place.
// Utilisation : serveur lancé (npm start), puis  node scripts/check-scroll.mjs [http://localhost:3000/]
// Il faut Playwright : npm i -D playwright && npx playwright install chromium (ou PLAYWRIGHT=chemin du module, CHROMIUM=chemin du navigateur).
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const URL_APP = process.argv[2] ?? "http://localhost:3000/";
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await b.newContext({ viewport: { width: 390, height: 700 }, geolocation: { latitude: 48.5835, longitude: 7.7458 }, permissions: ["geolocation"] });
await ctx.addInitScript(() => {
  localStorage.setItem("onboarding", JSON.stringify({ done: true, terms: "2026-10-23" }));
  localStorage.setItem("fav", JSON.stringify([]));
  localStorage.setItem("alerts", JSON.stringify({ enabled: true, works: false, lines: ["A", "B"] }));
});
const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto(URL_APP, { waitUntil: "networkidle" }); await p.waitForTimeout(4000);
if (await p.locator('[data-onb="accept"]').count()) { await p.click('[data-onb="accept"]'); await p.waitForTimeout(800); }   // conditions modifiées
const ids = await p.evaluate(() => {
  const K = window.__kumm; const hdf = K.STOPS.find(s => s.name === "Homme de Fer"); const gare = K.STOPS.find(s => s.name === "Gare Centrale");
  K.S.fav.push(hdf.id, gare.id);
  return { hdf: hdf.id, gare: gare.id, poi: K.POIS[0]?.id };
});
const views = [
  ["Accueil", { tab: "home", overlay: null }],
  ["Recherche (résultats)", { tab: "search", q: "ga", overlay: null }],
  ["Toutes les lignes", { tab: "lines", overlay: null }],
  ["À proximité", { tab: "nearby", overlay: null }],
  ["Itinéraires", { tab: "trips", overlay: null }],
  ["Itinéraires (trajet)", { tab: "trips", overlay: null, trip: { fromText: "Ma position", toText: "Gare Centrale", mode: "transit", fromIsMe: true, from: null, dest: { label: "Gare Centrale", lat: 48.5846, lon: 7.7350 }, sugg: null, sel: 0, when: { kind: "now", at: 0 }, whenDraft: null } }],
  ["Billets", { tab: "buy", overlay: null }],
  ["Réglages", { tab: "home", overlay: { k: "settings" } }],
  ["Infos trafic", { tab: "home", overlay: { k: "msgs" } }],
  ["Favoris", { tab: "home", overlay: { k: "favs" } }],
  ["Fiche ligne A", { tab: "home", overlay: { k: "line", id: "A" } }],
  ["Fiche arrêt Homme de Fer", { tab: "home", overlay: { k: "stop", id: ids.hdf } }],
  ["Fiche Gare Centrale", { tab: "home", overlay: { k: "stop", id: ids.gare } }],
  ["Fiche point (P+R/Vélhop)", { tab: "nearby", overlay: { k: "poi", id: ids.poi } }],
];
let bad = 0;
for (const [name, st] of views) {
  await p.evaluate(st => { Object.assign(window.__kumm.S, st); window.__kumm.render(); }, st);
  await p.waitForTimeout(st.trip ? 9000 : 2500);
  const set = await p.evaluate(() => {
    const out = [];
    const walk = el => { for (const c of el.children) { if (c.classList.contains("leaflet-container")) continue;
      const cs = getComputedStyle(c); const v = c.scrollHeight > c.clientHeight + 1 && /auto|scroll/.test(cs.overflowY), h = c.scrollWidth > c.clientWidth + 1 && /auto|scroll/.test(cs.overflowX);
      if (v || h) { if (v) c.scrollTop = Math.round((c.scrollHeight - c.clientHeight) * 0.6); if (h) c.scrollLeft = Math.round((c.scrollWidth - c.clientWidth) * 0.6);
        out.push({ name: (c.id ? "#" + c.id : (typeof c.className === "string" && c.className.replace("enter", "").trim().split(" ")[0]) || c.tagName.toLowerCase()), top: c.scrollTop, left: c.scrollLeft }); }
      walk(c); } };
    walk(document.getElementById("app")); return out;
  });
  await p.evaluate(() => window.__kumm.render()); await p.waitForTimeout(1200);
  await p.evaluate(() => window.__kumm.render()); await p.waitForTimeout(1200);   // deux redessins, avec les listes rechargées entre les deux
  const after = await p.evaluate(() => {
    const out = [];
    const walk = el => { for (const c of el.children) { if (c.classList.contains("leaflet-container")) continue;
      const cs = getComputedStyle(c); if ((c.scrollHeight > c.clientHeight + 1 && /auto|scroll/.test(cs.overflowY)) || (c.scrollWidth > c.clientWidth + 1 && /auto|scroll/.test(cs.overflowX))) out.push({ top: c.scrollTop, left: c.scrollLeft }); walk(c); } };
    walk(document.getElementById("app")); return out;
  });
  const res = set.map((z, i) => { const a = after[i]; const ok = a && Math.abs(a.top - z.top) <= 2 && Math.abs(a.left - z.left) <= 2; if (!ok) bad++; return `${z.name} ${z.top || z.left}→${a ? (a.top || a.left) : "?"} ${ok ? "✓" : "✗"}`; });
  console.log(`${name.padEnd(26)} ${res.length ? res.join(" | ") : "(aucune zone défilante)"}`);
}
console.log(`\n${bad ? bad + " zone(s) qui bougent" : "Aucune zone ne bouge"} | erreurs JS : ${errs.length ? errs : "aucune"}`);
await b.close();
process.exit(bad || errs.length ? 1 : 0);
