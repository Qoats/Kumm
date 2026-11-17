// Parcours fonctionnels du site statique (GitHub Pages) : aucune API Kumm, aucun serveur, horaires ouverts uniquement.
// Prérequis : npm run build:pages puis node scripts/serve-static.mjs dist/pages 4173
// Usage : node scripts/check-static-site.mjs [http://127.0.0.1:4173]
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => localStorage.setItem("onboarding", JSON.stringify({ done: true, terms: "2026-10-23" })));
const page = await context.newPage();
const errors = [], forbidden = [], hosts = new Set();
page.on("pageerror", e => errors.push(e.message));
await context.route("**/*", route => {
  const u = new URL(route.request().url());
  hosts.add(u.host);
  if (u.origin === new URL(base).origin && /^\/(api|geo|poi|tiles|health|app|deconnexion)(\/|$)/.test(u.pathname)) { forbidden.push(u.pathname); return route.abort(); }
  return route.continue();
});
const text = async () => await page.locator("body").innerText();
const checks = [];
const ok = n => { checks.push(n); console.log("OK  ", n); };
try {
  await page.goto(base);
  await page.waitForFunction(() => window.__kumm?.STOPS.length > 1500, null, { timeout: 90000 });
  const t = await text();
  assert.doesNotMatch(t, /Info trafic|Vélhop/);
  ok("accueil : horaires ouverts chargés, Info trafic et Vélhop masqués");

  await page.locator('nav [data-tab="lines"], [data-tab="lines"]').last().click();
  await page.locator('[data-line="B"]').first().click();
  await page.waitForSelector(".rail");
  assert.ok(await page.locator(".stopline[data-stop]").count() >= 15);
  assert.ok(await page.locator("[data-ldir]").count() >= 2);
  ok("ligne B : arrêts et deux sens");

  await page.locator(".stopline[data-stop]").nth(2).click();
  await page.waitForFunction(() => document.getElementById("stopdeps")?.textContent?.includes("min"), null, { timeout: 20000 });
  const stopId = await page.evaluate(() => window.__kumm.S.overlay.id);
  await page.locator(`[data-fav="${stopId}"]`).click();
  await page.reload();
  await page.waitForFunction(() => window.__kumm?.STOPS.length > 1500, null, { timeout: 90000 });
  assert.deepEqual(await page.evaluate(() => window.__kumm.S.fav), [stopId]);
  ok("arrêt : passages théoriques, favori conservé après rechargement");

  await page.evaluate(() => { const k = window.__kumm; k.S.overlay = null; k.S.tab = "nearby"; k.render(); });
  await page.waitForFunction(() => window.__kummMap);
  await page.evaluate(() => window.__kummMap.setView([48.5846, 7.7507], 15, { animate: false }));
  await page.waitForFunction(() => window.__kummVeh?.size > 20 && document.querySelectorAll(".vm").length > 3, null, { timeout: 30000 });
  assert.equal(await page.locator(".vm.vapprox").count(), 0);
  assert.equal(await page.locator('.lyr[data-layer="velhop"]').count(), 0, "pas de filtre Vélhop sur la carte");
  assert.equal(await page.locator('header [data-act="msgs"], [data-act="msgs"]').count(), 0, "pas d'icône Infos trafic");
  ok("carte : véhicules théoriques calculés dans le navigateur");

  await page.evaluate(() => { window.__kumm.S.tab = "trips"; window.__kumm.render(); });
  await page.locator("#tfrom").fill("Homme de Fer");
  await page.locator("[data-goto], [data-sg], [data-sel]").first().click();
  await page.locator("#tto").fill("Gare Centrale");
  await page.waitForTimeout(800);
  await page.locator("[data-goto], [data-sg], [data-sel]").first().click();
  await page.waitForFunction(() => document.body.innerText.includes("Départ") && document.body.innerText.includes("min"), null, { timeout: 30000 });
  ok("itinéraire entre deux arrêts");

  await page.evaluate(() => { window.__kumm.S.overlay = { k: "settings" }; window.__kumm.render(); });
  const settings = await text();
  assert.doesNotMatch(settings, /Se déconnecter|Google Play|Alertes trafic|Vélhop|Info trafic/i);
  assert.match(settings, /Télécharger l’application Android/);
  ok("réglages : pas de connexion ni de lien Google Play");

  assert.deepEqual(forbidden, [], "aucune requête vers un serveur Kumm");
  assert.deepEqual(errors, []);
  console.log("hôtes contactés :", [...hosts].join(", "));
  console.log(JSON.stringify({ result: "passed", checks }));
} finally { await browser.close(); }
