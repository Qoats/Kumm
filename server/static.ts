/** Fichiers de l'application (dist/web) : gardés en mémoire, compressés une fois, mis en cache par le navigateur. */
import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { WEB } from "./config.js";
import { send } from "./http.js";
import type { Memo } from "./http.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json"
};

interface Loaded { buf: Buffer; mtime: number; type: string; memo: Memo }
const files = new Map<string, Loaded>();
const MAX_FILES = 300;

export async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  let p: string;
  try { p = path.normalize(decodeURIComponent(pathname)); } catch { return send(res, 400, "text/plain", "Adresse invalide"); }
  if (p === "/" || p === path.sep) p = "/index.html";
  const file = path.join(WEB, p);
  if (!file.startsWith(WEB)) return send(res, 403, "text/plain", "Interdit");
  try {
    const st = await fs.promises.stat(file);
    if (!st.isFile()) throw new Error("pas un fichier");
    let f = files.get(file);
    if (!f || f.mtime !== st.mtimeMs) {
      f = { buf: await fs.promises.readFile(file), mtime: st.mtimeMs, type: MIME[path.extname(file)] ?? "application/octet-stream", memo: {} };
      files.set(file, f);
      if (files.size > MAX_FILES) files.delete(files.keys().next().value as string);
    }
    // les fichiers de /assets/ portent leur empreinte dans leur nom : conservables un an ; la page d'accueil est toujours revérifiée
    return send(res, 200, f.type, f.buf, undefined, { memo: f.memo, cache: p.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
  } catch {
    return send(res, 404, "text/plain", "Introuvable (avez-vous lancé « npm run build » ?)");
  }
}
