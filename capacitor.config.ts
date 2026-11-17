/// <reference types="@capacitor/push-notifications" />
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "fr.kumm.app",
  appName: "Kumm",
  webDir: "dist/web",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false },
  plugins: {
    // alertes trafic (Firebase) : notification affichée même quand l'application est ouverte
    PushNotifications: { presentationOptions: ["sound", "alert"] }
  }
};

export default config;
