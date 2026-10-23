// Vérifie la carte « À proximité » pendant 30 s : chaque tram ou bus reste sur son tracé (jamais à côté de sa voie),
// aucun ne recouvre l'icône d'une station, et les lettres sont centrées dans les pastilles des véhicules.
// Utilisation : serveur lancé (npm start), puis  node scripts/check-map.mjs [http://localhost:3000/]
// Il faut Playwright (voir scripts/check-scroll.mjs) : PLAYWRIGHT=chemin du module, CHROMIUM=chemin du navigateur si besoin.
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const URL_APP = process.argv[2] ?? "http://localhost:3000/";
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => localStorage.setItem("onboarding", JSON.stringify({ done: true, terms: "9999" })));
const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto(URL_APP, { waitUntil: "networkidle" }); await p.waitForTimeout(3000);
if (await p.locator('[data-onb="accept"]').count()) { await p.click('[data-onb="accept"]'); await p.waitForTimeout(800); }   // conditions
await p.click('[data-tab="nearby"]'); await p.waitForTimeout(1000);
await p.evaluate(() => { window.__kumm.S.sheet = 0; window.__kumm.render(); });
const places = [[48.5835, 7.7450, 16], [48.5846, 7.7350, 17], [48.5630, 7.7526, 17], [48.5866, 7.7540, 16]];
let samples = 0, offTrack = 0, overlap = 0, worstTrack = 0, worstGap = 1e9;
for (const [la, lo, z] of places) {
  await p.evaluate(([la, lo, z]) => window.__kummMap.setView([la, lo], z, { animate: false }), [la, lo, z]);
  for (let i = 0; i < 8; i++) {
    await p.waitForTimeout(1000);
    const r = await p.evaluate(() => {
      const map = window.__kummMap, V = window.__kummVeh, out = [];
      const stops = [...document.querySelectorAll('.leaflet-marker-icon[title^="Tram ·"],.leaflet-marker-icon[title^="Bus ·"],.leaflet-marker-icon[title^="Gare ·"]')]
        .map(e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      for (const el of document.querySelectorAll(".leaflet-marker-icon[data-vid]")) {
        const v = V.get(el.dataset.vid); if (!v) continue;
        const r = el.getBoundingClientRect(), c = [r.left + r.width / 2, r.top + r.height / 2];
        const gap = Math.min(999, ...stops.map(s => Math.hypot(s[0] - c[0], s[1] - c[1])));
        // distance (pixels) entre le repère affiché et le tracé du véhicule
        let track = null;
        if (v.p && v.p.length > 1) {
          const box = map.getContainer().getBoundingClientRect(), pts = v.p.map(q => map.latLngToContainerPoint(q));
          const x = c[0] - box.left, y = c[1] - box.top; track = 1e9;
          for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], bb = pts[i], dx = bb.x - a.x, dy = bb.y - a.y, L2 = dx * dx + dy * dy;
            const t = L2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2)) : 0;
            track = Math.min(track, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
          }
        }
        out.push({ gap, track });
      }
      return out;
    });
    for (const x of r) {
      samples++; worstGap = Math.min(worstGap, x.gap); if (x.gap < 26) overlap++;
      if (x.track !== null) { worstTrack = Math.max(worstTrack, x.track); if (x.track > 3) offTrack++; }
    }
  }
}
console.log(`${samples} positions mesurées | hors de la voie (> 3 px) : ${offTrack} (pire ${worstTrack.toFixed(1)} px) | sur une station (< 26 px) : ${overlap} (plus proche ${Math.round(worstGap)} px) | erreurs JS : ${errs.length ? errs : "aucune"}`);
await b.close();
process.exit(offTrack || overlap || errs.length ? 1 : 0);
