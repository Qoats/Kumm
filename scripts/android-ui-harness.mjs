// Harnais navigateur : exécute l'interface en mode Android autonome avec un pont natif simulé
// qui sert les vraies archives GTFS officielles. Ne contacte jamais le serveur Kumm.
// Usage : import { openApp } from "./android-ui-harness.mjs"
import fs from "node:fs";
import { chromium } from "@playwright/test";

export async function openApp({ cts, ter, base = "http://127.0.0.1:5173", viewport = { width: 390, height: 844 }, headless = true, clockAt } = {}) {
  cts ??= process.env.GTFS_CTS; ter ??= process.env.GTFS_TER;
  if (!cts || !ter) throw Error("GTFS_CTS et GTFS_TER (archives officielles) sont requis");
  const bytes = { cts: fs.readFileSync(cts).toString("base64"), ter: fs.readFileSync(ter).toString("base64") };
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport });
  const forbidden = [], errors = [], consoleErrors = [];
  await context.exposeFunction("__native", async (plugin, method, options) => {
    if (plugin === "KummGtfs") {
      if (method === "sync") return Object.fromEntries(["cts", "ter"].map(s => [s, { revision: s + "-official", checked: Date.now() }]));
      if (method === "read") return { data: bytes[options.source] };
    }
    if (plugin === "App") return { version: "0.53.0", build: "10000" };
    if (plugin === "KummUpdater") {
      if (method === "source") return { play: false };
      if (method === "canInstall") return { allowed: true };
      return {};
    }
    if (plugin === "Geolocation") return { coords: { latitude: 48.5846, longitude: 7.7507, accuracy: 20 }, timestamp: Date.now() };
    throw Error("Service en ligne indisponible dans le harnais");
  });
  await context.addInitScript(() => {
    window.androidBridge = {}; window.__listeners = {};
    window.Capacitor = {
      PluginHeaders: [
        { name: "KummGtfs", methods: ["sync", "read"].map(name => ({ name, rtype: "promise" })) },
        { name: "App", methods: [{ name: "getInfo", rtype: "promise" }, { name: "addListener" }, { name: "removeListener" }] },
        { name: "CapacitorHttp", methods: [{ name: "get", rtype: "promise" }] },
        { name: "KummUpdater", methods: [...["source", "canInstall", "install", "openInstallSettings"].map(name => ({ name, rtype: "promise" })), { name: "addListener" }, { name: "removeListener" }] }
      ],
      nativePromise: (p, m, o) => window.__native(p, m, o),
      nativeCallback: (p, m, o, fn) => { (window.__listeners[o.eventName] ??= []).push(fn); return Promise.resolve("listener"); }
    };
    localStorage.setItem("onboarding", JSON.stringify({ done: true, terms: "2026-10-23" }));
  });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  await context.route("**/*", async route => {
    const u = new URL(route.request().url());
    if (u.origin === base && /^\/(api|geo|poi|tiles|health|app)(\/|$)/.test(u.pathname)) { forbidden.push(u.pathname); return route.abort(); }
    if (/tile\.openstreetmap\.org|openfreemap|geopf|routing\.openstreetmap/.test(u.host)) return route.abort(); // pas d'Internet dans le harnais
    return route.continue();
  });
  if (clockAt) await page.clock.install({ time: clockAt });
  await page.goto(base);
  await page.waitForFunction(() => window.__kumm?.STOPS.length > 1500, null, { timeout: 90000 });
  return { browser, context, page, forbidden, errors, consoleErrors };
}
