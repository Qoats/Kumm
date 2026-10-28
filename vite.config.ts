import { defineConfig } from "vite";

// Développement : Vite sert l'app sur :5173 et envoie /api et /geo vers le serveur Node (:3000)
export default defineConfig({
  root: "web",
  build: { outDir: "../dist/web", emptyOutDir: true, sourcemap: false, minify: "esbuild" },
  server: { proxy: { "/api": "http://localhost:3000", "/geo": "http://localhost:3000", "/diag": "http://localhost:3000", "/poi": "http://localhost:3000", "/tiles": "http://localhost:3000" } }
});
