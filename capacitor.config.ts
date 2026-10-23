/// <reference types="@capacitor/push-notifications" />
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
    // alertes trafic (Firebase) : notification affichée même quand l'application est ouverte
    PushNotifications: { presentationOptions: ["sound", "alert"] }
  }
};

export default config;
