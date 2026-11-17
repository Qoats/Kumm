// Parcours fonctionnels de l'interface Android autonome avec les vraies archives GTFS officielles.
// Prérequis : `npx vite --host 127.0.0.1 --port 5173` dans un autre terminal.
// Usage : node scripts/check-android-ui.mjs /chemin/cts.zip /chemin/sncf.zip [http://127.0.0.1:5173]
import assert from "node:assert/strict";
import { openApp } from "./android-ui-harness.mjs";

const [cts, ter, base = "http://127.0.0.1:5173"] = process.argv.slice(2);
const { browser, page, forbidden, errors } = await openApp({ cts, ter, base });
const text = async () => await page.locator("body").innerText();
const checks = [];
const ok = name => { checks.push(name); console.log("OK  ", name); };
try {
  // 1. Accueil : seules les tuiles « Info trafic » et « Vélhop » sont masquées
  let t = await text();
  assert.doesNotMatch(t, /Info trafic|Vélhop/);
  for (const label of ["Naviguer", "Toutes les lignes", "Horaires par ligne", "Ponctualité", "Parkings relais", "Objets perdus"]) assert.match(t, new RegExp(label));
  ok("accueil : Info trafic et Vélhop masqués, le reste conservé");

  // 2. Lignes → liste des arrêts, sens et terminus
  await page.locator('nav [data-tab="lines"], [data-tab="lines"]').last().click();
  await page.locator('[data-line="B"]').first().click();
  await page.waitForSelector(".rail");
  const stops = await page.locator(".stopline[data-stop]").count();
  assert.ok(stops >= 15, "liste d'arrêts de la ligne B : " + stops);
  assert.match(await text(), /Ligne B/);
  const first = await page.locator(".stopline").first().innerText();
  assert.ok(await page.locator("[data-ldir]").count() >= 2, "deux sens");
  await page.locator("[data-ldir]").nth(1).click();
  await page.waitForFunction(f => document.querySelector(".stopline")?.textContent !== f, first);
  ok("ligne B : liste d'arrêts, deux sens, terminus inversés");

  // 3. Arrêt de la liste → passages théoriques, favori conservé après rechargement
  await page.locator(".stopline[data-stop]").nth(2).click();
  await page.waitForFunction(() => document.getElementById("stopdeps")?.textContent?.includes("min"), null, { timeout: 20000 });
  assert.match(await text(), /Horaires théoriques/i);
  const stopId = await page.evaluate(() => window.__kumm.S.overlay.id);
  await page.locator(`[data-fav="${stopId}"]`).click();
  assert.deepEqual(await page.evaluate(() => window.__kumm.S.fav), [stopId]);
  await page.reload();
  await page.waitForFunction(() => window.__kumm?.STOPS.length > 1500, null, { timeout: 90000 });
  assert.deepEqual(await page.evaluate(() => window.__kumm.S.fav), [stopId]);
  await page.waitForFunction(id => document.getElementById("fav-" + id)?.textContent?.includes("′"), stopId, { timeout: 20000 });
  ok("arrêt : passages théoriques, favori conservé et affiché à l'accueil après rechargement");

  // 4. Recherche
  await page.locator('nav [data-tab="search"], [data-tab="search"]').last().click();
  await page.locator("input").first().fill("Homme de Fer");
  await page.waitForFunction(() => document.body.innerText.includes("Homme de Fer"), null, { timeout: 5000 });
  ok("recherche d'un arrêt");

  // 5. Carte : véhicules animés sur leur tracé
  await page.evaluate(() => { const k = window.__kumm; k.S.tab = "nearby"; k.S.overlay = null; k.render(); });
  await page.waitForFunction(() => window.__kummMap);
  await page.evaluate(() => window.__kummMap.setView([48.5846, 7.7507], 15, { animate: false }));
  await page.waitForFunction(() => window.__kummVeh?.size > 20 && document.querySelectorAll(".vm").length > 5, null, { timeout: 30000 });
  const veh = await page.evaluate(() => {
    const now = Date.now(), all = [...window.__kummVeh.values()];
    return { n: all.length, stale: all.filter(v => !v.w && v.a[2] !== v.b[2] && (v.a[2] > now + 35000 || v.b[2] < now - 35000)).length,
      trams: all.filter(v => v.m === "tram").length, bus: all.filter(v => v.m === "bus").length, withPath: all.filter(v => v.p && v.p.length > 1).length,
      markers: document.querySelectorAll(".vm").length };
  });
  assert.equal(veh.stale, 0, "chaque véhicule est entre deux arrêts de son horaire (à l actualisation de 30 s près)");
  assert.ok(veh.trams > 0 && veh.bus > 0 && veh.withPath > 0, JSON.stringify(veh));
  // animation : un véhicule en mouvement se déplace
  const ids = await page.evaluate(() => [...document.querySelectorAll(".vm[data-vid]")].map(e => e.getAttribute("data-vid"))
    .filter(id => { const v = window.__kummVeh.get(id); return v && !v.w && v.a[2] !== v.b[2]; }).slice(0, 12));
  assert.ok(ids.length, "des véhicules en mouvement sont affichés");
  const pos = () => page.evaluate(list => list.map(i => document.querySelector(`[data-vid="${i}"]`)?.style.transform), ids);
  const before = await pos();
  await page.waitForTimeout(6000);
  const after = await pos();
  assert.ok(after.some((t, i) => t && t !== before[i]), "au moins un véhicule avance");
  const moving = ids[after.findIndex((t, i) => t && t !== before[i])];
  assert.equal(await page.locator(".vm.vapprox").count(), 0, "pas de cadre « approximatif » sur les véhicules théoriques");
  ok(`carte : ${veh.n} véhicules théoriques (${veh.trams} trams, ${veh.bus} bus, ${veh.withPath} sur un tracé), animés`);

  // 6. Suivi d'un véhicule
  await page.evaluate(id => document.querySelector(`[data-vid="${id}"]`)?.click(), moving);
  await page.waitForFunction(() => window.__kumm.S.follow, null, { timeout: 5000 });
  await page.waitForSelector("#fv-state");
  assert.match(await text(), /vers|Prochain/i);
  ok("suivi d'un véhicule : panneau et prochains arrêts");
  await page.evaluate(() => { window.__kumm.S.follow = null; window.__kumm.render(); });

  // 7. Itinéraire entre deux arrêts depuis l'interface
  await page.evaluate(() => { window.__kumm.S.tab = "trips"; window.__kumm.render(); });
  await page.locator("#tfrom").fill("Homme de Fer");
  await page.locator("[data-goto], [data-sg], [data-sel]").first().waitFor();
  await page.locator("[data-goto], [data-sg], [data-sel]").first().click();
  await page.locator("#tto").fill("Gare Centrale");
  await page.waitForTimeout(800);
  await page.locator("[data-goto], [data-sg], [data-sel]").first().click();
  await page.waitForFunction(() => document.body.innerText.includes("Départ") && document.body.innerText.includes("min"), null, { timeout: 30000 });
  assert.match(await text(), /Horaires théoriques/i);
  ok("itinéraire entre deux arrêts");

  // 8. Fonctions réellement temps réel : « Bientôt disponible »
  for (const overlay of ["msgs", "stats"]) {
    await page.evaluate(k => { window.__kumm.S.overlay = { k }; window.__kumm.render(); }, overlay);
    assert.match(await text(), /Bientôt disponible/);
  }
  ok("infos trafic et ponctualité : Bientôt disponible");

  // 9. Échec du téléchargement initial : cause affichée avec « Réessayer » (pas de liste vide silencieuse)
  const bad = await openApp({ cts, ter, base, failSync: true });
  try {
    await bad.page.waitForFunction(() => document.body.innerText.includes("Horaires indisponibles"), null, { timeout: 15000 });
    assert.ok(await bad.page.locator('[data-act="syncGtfs"]').count());
  } finally { await bad.browser.close(); }
  ok("échec du téléchargement initial : cause et « Réessayer » visibles");

  assert.deepEqual(forbidden, [], "aucune requête vers le serveur Kumm");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "passed", checks }));
} finally { await browser.close(); }
