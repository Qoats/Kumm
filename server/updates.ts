/** Distribution hors Play depuis le volume APK alimenté par deploy/kumm-update.sh. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { send } from "./http.js";
import { withinLimit } from "./limit.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.basename(path.dirname(here)) === "dist" ? path.join(here, "..", "..") : path.join(here, "..");
const DIR = process.env.APK_DIR ?? path.join(ROOT, "apk");
const MANIFEST = path.join(DIR, "latest.json"), APK = path.join(DIR, "kumm.apk");
const DOWNLOADS_PER_MIN = 6;

export interface Release { version: string; code: number; size: number; sha256: string; date?: string }

const fingerprint = (s: fs.Stats): string => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(":");
let cached: { fingerprint: string; release: Release | null } | undefined;

function readRelease(fd: number): Release | null {
  try {
    const st = fs.fstatSync(fd);
    const key = fingerprint(fs.statSync(MANIFEST)) + "/" + fingerprint(st);
    if (cached?.fingerprint === key) return cached.release;
    const j = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as Partial<Release>;
    const valid = typeof j.version === "string" && Number.isSafeInteger(j.code) && j.code! > 0
      && typeof j.sha256 === "string" && /^[0-9a-f]{64}$/.test(j.sha256)
      && Number.isSafeInteger(j.size) && j.size === st.size && st.size > 0;
    const hash = valid ? crypto.createHash("sha256").update(fs.readFileSync(fd)).digest("hex") : null;
    const release = valid && hash === j.sha256
      ? { version: j.version!, code: j.code!, size: j.size!, sha256: j.sha256!, date: j.date }
      : null;
    cached = { fingerprint: key, release };
    return release;
  } catch { return null; }
}

export function latestRelease(): Release | null {
  let fd: number;
  try { fd = fs.openSync(APK, "r"); } catch { return null; }
  try { return readRelease(fd); } finally { fs.closeSync(fd); }
}

export async function serveUpdate(req: IncomingMessage, res: ServerResponse, p: string): Promise<void> {
  if (p === "/app/latest.json") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const rel = latestRelease();
    if (!rel) return send(res, 404, "application/json; charset=utf-8", JSON.stringify({ message: "Aucune version publiée" }), undefined, { cache: "no-store" });
    return send(res, 200, "application/json; charset=utf-8", JSON.stringify(rel), undefined, { cache: "no-cache" });
  }

  let fd: number;
  try { fd = fs.openSync(APK, "r"); } catch { return send(res, 404, "text/plain", "Aucune version publiée"); }
  const rel = readRelease(fd);
  if (!rel) {
    fs.closeSync(fd);
    return send(res, 404, "text/plain", "Aucune version publiée");
  }
  if (!withinLimit(req, "apk", DOWNLOADS_PER_MIN)) {
    fs.closeSync(fd);
    res.writeHead(429, { "Content-Type": "text/plain", "Retry-After": "60" });
    return void res.end("Trop de téléchargements : réessayez dans une minute");
  }
  res.writeHead(200, {
    "Content-Type": "application/vnd.android.package-archive", "Content-Length": rel.size, "Cache-Control": "no-cache",
    "Content-Disposition": `attachment; filename="kumm-${rel.version.replace(/[^0-9A-Za-z.\-]/g, "")}.apk"`
  });
  if (req.method === "HEAD") {
    fs.closeSync(fd);
    return void res.end();
  }
  // Garde le fichier vérifié ouvert, même si le VPS installe une version entre-temps.
  const stream = fs.createReadStream(APK, { fd, start: 0 });
  res.on("close", () => stream.destroy());
  stream.on("error", () => res.destroy()).pipe(res);
}

export const updateStatus = (): Record<string, unknown> => {
  const r = latestRelease();
  return r ? { version: r.version, code: r.code } : { version: null };
};
