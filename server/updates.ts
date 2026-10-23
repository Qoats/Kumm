/**
 * Mises à jour de l'application Android, distribuées par ce serveur :
 * - /app/latest.json : dernière version publiée { version, code, size, sha256, date } ;
 * - /app/kumm.apk : le fichier APK signé.
 * Ces deux fichiers sont déposés dans le dossier apk/ par le script de mise à jour du serveur (deploy/kumm-update.sh),
 * qui les prend sur la branche « apk » du dépôt, où GitHub publie chaque APK signé.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { send } from "./http.js";
import { withinLimit } from "./limit.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const DIR = process.env.APK_DIR ?? path.join(ROOT, "apk");
const DOWNLOADS_PER_MIN = 6;

export interface Release { version: string; code: number; size: number; sha256: string; date?: string }

let cached: { mtime: number; rel: Release | null } | null = null;

/** Version publiée (relue seulement si le fichier a changé) ; null si aucune, ou si l'APK ne correspond pas */
export function latestRelease(): Release | null {
  try {
    const st = fs.statSync(path.join(DIR, "latest.json"));
    if (cached?.mtime === st.mtimeMs) return cached.rel;
    const j = JSON.parse(fs.readFileSync(path.join(DIR, "latest.json"), "utf8")) as Partial<Release>;
    const ok = typeof j.version === "string" && Number.isInteger(j.code) && typeof j.sha256 === "string" && /^[0-9a-f]{64}$/.test(j.sha256)
      && Number.isInteger(j.size) && fs.statSync(path.join(DIR, "kumm.apk")).size === j.size;
    cached = { mtime: st.mtimeMs, rel: ok ? { version: j.version!, code: j.code!, size: j.size!, sha256: j.sha256!, date: j.date } : null };
    return cached.rel;
  } catch { return null; }
}

export async function serveUpdate(req: IncomingMessage, res: ServerResponse, p: string): Promise<void> {
  const rel = latestRelease();
  if (p === "/app/latest.json") {
    if (!rel) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ message: "Aucune version publiée" }), undefined, { cache: "no-store" });
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify(rel), undefined, { cache: "no-cache" });
  }
  if (!rel) return send(res, 404, "text/plain", "Aucune version publiée");
  if (!withinLimit(req, "apk", DOWNLOADS_PER_MIN)) {
    res.writeHead(429, { "Content-Type": "text/plain", "Retry-After": "60" });
    return void res.end("Trop de téléchargements : réessayez dans une minute");
  }
  res.writeHead(200, {
    "Content-Type": "application/vnd.android.package-archive", "Content-Length": rel.size, "Cache-Control": "no-cache",
    "Content-Disposition": `attachment; filename="kumm-${rel.version.replace(/[^0-9A-Za-z.\-]/g, "")}.apk"`
  });
  if (req.method === "HEAD") return void res.end();
  fs.createReadStream(path.join(DIR, "kumm.apk")).on("error", () => res.destroy()).pipe(res);
}

/** Pour /health */
export const updateStatus = (): Record<string, unknown> => { const r = latestRelease(); return r ? { version: r.version, code: r.code } : { version: null }; };
