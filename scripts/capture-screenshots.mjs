// Génère les captures d'écran avec les vraies archives GTFS officielles :
//   docs/images/*.png        : README (clair)
//   vitrine/img/*-clair.jpg  : site kumm.fr, thème clair
//   vitrine/img/*-sombre.jpg : site kumm.fr, thème sombre
// Prérequis : `npx vite --host 127.0.0.1 --port 5173` dans un autre terminal, et Internet (fond de carte OpenStreetMap).
// Usage : node scripts/capture-screenshots.mjs /chemin/cts.zip /chemin/sncf.zip [http://127.0.0.1:5173]
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { openApp } from "./android-ui-harness.mjs";

const [cts, ter, base = "http://127.0.0.1:5173"] = process.argv.slice(2);
const dir = rel => fileURLToPath(new URL(rel, import.meta.url));
const docs = dir("../docs/images/"), vitrine = dir("../vitrine/img/");
fs.mkdirSync(docs, { recursive: true }); fs.mkdirSync(vitrine, { recursive: true });

async function run(scheme) {
  const { browser, page } = await openApp({ cts, ter, base, tiles: true, scale: 2, viewport: { width: 390, height: 844 }, colorScheme: scheme });
  const suffix = scheme === "dark" ? "sombre" : "clair";
  // name : fichier du README (clair seulement), site : nom de l'image de la vitrine
  const shot = async (name, site) => {
    await page.waitForTimeout(800);
    // le site n'affiche ni infos trafic ni Vélhop ni ponctualité : les captures non plus
    await page.addStyleTag({ content: '[data-act="msgs"]{display:none!important}' });
    await page.evaluate(() => { for (const b of document.querySelectorAll("button, a, div")) if (b.children.length < 4 && /^Ponctualité$/.test((b.textContent ?? "").trim()) && b.closest("[data-go], button")) (b.closest("[data-go], button")).style.visibility = "hidden"; });
    if (scheme === "light" && name) await page.screenshot({ path: docs + name, type: "png" });
    if (site) await page.screenshot({ path: `${vitrine}${site}-${suffix}.jpg`, type: "jpeg", quality: 84 });
    console.log(scheme, name ?? "", site ?? "");
  };
  try {
    const hdf = await page.evaluate(() => window.__kumm.STOPS.find(s => /^Homme de Fer$/i.test(s.name)));
    await page.evaluate(id => { const x = window.__kumm; x.S.fav = [id]; localStorage.setItem("fav", JSON.stringify([id])); x.render(); }, hdf.id);
    await page.waitForFunction(id => document.getElementById("fav-" + id)?.textContent?.includes("′"), hdf.id, { timeout: 20000 });
    await shot("01-accueil.png", "accueil");

    await page.evaluate(() => { const x = window.__kumm; x.S.overlay = { k: "line", id: "B" }; x.render(); });
    await page.waitForSelector(".rail");
    await shot("02-ligne.png");

    await page.evaluate(id => { const x = window.__kumm; x.S.overlay = { k: "stop", id }; x.render(); }, hdf.id);
    await page.waitForFunction(() => document.getElementById("stopdeps")?.textContent?.includes("min"), null, { timeout: 20000 });
    await shot("03-arret.png", "arret");

    await page.evaluate(() => { const x = window.__kumm; x.S.overlay = null; x.S.tab = "nearby"; x.S.sheet = 1; x.render(); });
    await page.waitForFunction(() => window.__kummMap && window.__kummVeh?.size > 20, null, { timeout: 30000 });
    await page.evaluate(() => window.__kummMap.setView([48.5846, 7.7507], 15, { animate: false }));
    await page.waitForFunction(() => document.querySelectorAll(".vm").length >= 4 && document.querySelectorAll(".leaflet-tile-loaded").length > 6, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    await shot("04-carte.png", "carte");

    if (scheme === "light") {
      await page.evaluate(() => { window.__kumm.S.tab = "trips"; window.__kumm.render(); });
      await page.locator("#tfrom").fill("Homme de Fer");
      await page.locator("[data-goto], [data-sg], [data-sel]").first().click();
      await page.locator("#tto").fill("Gare Centrale");
      await page.waitForTimeout(800);
      await page.locator("[data-goto], [data-sg], [data-sel]").first().click();
      await page.waitForFunction(() => document.body.innerText.includes("Départ") && document.body.innerText.includes("min"), null, { timeout: 30000 });
      await page.waitForTimeout(2500);
      await shot("05-itineraire.png");
    }
  } finally { await browser.close(); }
}
await run("light");
await run("dark");
