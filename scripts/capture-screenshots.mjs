// Génère les captures d'écran du README (docs/images/) avec les vraies archives GTFS officielles.
// Prérequis : `npx vite --host 127.0.0.1 --port 5173` dans un autre terminal, et Internet (fond de carte OpenStreetMap).
// Usage : node scripts/capture-screenshots.mjs /chemin/cts.zip /chemin/sncf.zip [http://127.0.0.1:5173]
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { openApp } from "./android-ui-harness.mjs";

const [cts, ter, base = "http://127.0.0.1:5173"] = process.argv.slice(2);
const out = fileURLToPath(new URL("../docs/images/", import.meta.url));
fs.mkdirSync(out, { recursive: true });
const { browser, page } = await openApp({ cts, ter, base, tiles: true, scale: 2, viewport: { width: 390, height: 844 } });
const shot = async name => { await page.waitForTimeout(800); await page.screenshot({ path: out + name, type: "png" }); console.log("capture", name); };
const k = fn => page.evaluate(fn);
try {
  const hdf = await page.evaluate(() => window.__kumm.STOPS.find(s => /^Homme de Fer$/i.test(s.name)));
  // 1. Accueil, avec un arrêt favori
  await page.evaluate(id => { const x = window.__kumm; x.S.fav = [id]; localStorage.setItem("fav", JSON.stringify([id])); x.render(); }, hdf.id);
  await page.waitForFunction(id => document.getElementById("fav-" + id)?.textContent?.includes("′"), hdf.id, { timeout: 20000 });
  await shot("01-accueil.png");

  // 2. Une ligne : ses arrêts, dans l'ordre, dans les deux sens
  await page.evaluate(() => { const x = window.__kumm; x.S.overlay = { k: "line", id: "B" }; x.render(); });
  await page.waitForSelector(".rail");
  await shot("02-ligne.png");

  // 3. Un arrêt : prochains passages
  await page.evaluate(id => { const x = window.__kumm; x.S.overlay = { k: "stop", id }; x.render(); }, hdf.id);
  await page.waitForFunction(() => document.getElementById("stopdeps")?.textContent?.includes("min"), null, { timeout: 20000 });
  await shot("03-arret.png");

  // 4. La carte : arrêts et véhicules (positions théoriques)
  await page.evaluate(() => { const x = window.__kumm; x.S.overlay = null; x.S.tab = "nearby"; x.S.sheet = 1; x.render(); });
  await page.waitForFunction(() => window.__kummMap && window.__kummVeh?.size > 20, null, { timeout: 30000 });
  await page.evaluate(() => window.__kummMap.setView([48.5846, 7.7507], 15, { animate: false }));
  await page.waitForFunction(() => document.querySelectorAll(".vm").length >= 4 && document.querySelectorAll(".leaflet-tile-loaded").length > 6, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot("04-carte.png");

  // 5. Un itinéraire
  await page.evaluate(() => { window.__kumm.S.tab = "trips"; window.__kumm.render(); });
  await page.locator("#tfrom").fill("Homme de Fer");
  await page.locator("[data-goto], [data-sg], [data-sel]").first().click();
  await page.locator("#tto").fill("Gare Centrale");
  await page.waitForTimeout(800);
  await page.locator("[data-goto], [data-sg], [data-sel]").first().click();
  await page.waitForFunction(() => document.body.innerText.includes("Départ") && document.body.innerText.includes("min"), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot("05-itineraire.png");
} finally { await browser.close(); }
