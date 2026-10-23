/// <reference types="@capacitor/background-runner" />
import fs from "node:fs";
import type { CapacitorConfig } from "@capacitor/cli";

/** Adresse du serveur lue dans web/.env.android : en http (test local), on autorise le contenu mixte ; en https, jamais. */
function apiBase(): string {
  try {
    const m = /^VITE_API_BASE=(.+)$/m.exec(fs.readFileSync("web/.env.android", "utf8"));
    return m ? m[1].trim() : "";
  } catch { return ""; }
}

const config: CapacitorConfig = {
  appId: "fr.kumm.app",
  appName: "Kumm",
  webDir: "dist/web",
  server: { androidScheme: "https" },
  android: { allowMixedContent: apiBase().startsWith("http://") },
  plugins: {
    // alertes trafic : web/public/runners/alerts.js, lancé par Android environ toutes les 15 minutes (minimum imposé)
    BackgroundRunner: { label: "fr.kumm.alerts", src: "runners/alerts.js", event: "checkAlerts", repeat: true, interval: 15, autoStart: true }
  }
};

export default config;
