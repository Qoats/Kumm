/** Envoi des réponses : compression, en-têtes de sécurité, mise en cache navigateur. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { TRUST_PROXY } from "./config.js";

const gzip = promisify(zlib.gzip);

/** La requête qui correspond à chaque réponse (pour lire « Accept-Encoding » sans changer toutes les signatures) */
export const reqOf = new WeakMap<ServerResponse, IncomingMessage>();

/** Version compressée gardée avec la ressource : on compresse une fois, pas à chaque visite */
export interface Memo { gz?: Buffer }

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest\+json)|image\/svg\+xml)/;
const MIN_COMPRESS = 1024;

/** Ce que la page a le droit de charger : un texte injecté par erreur ne pourrait ni exécuter de script ni envoyer de données ailleurs.
   Les styles inline restent permis (l'interface en utilise partout) ; l'APK charge ses fichiers localement et n'est pas concerné. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  // carte 3D du guidage : style, tuiles vectorielles, polices et icônes d'OpenFreeMap ; MapLibre dessine dans un « worker »
  "connect-src 'self' https://tiles.openfreemap.org",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

/** En-têtes appliqués à toutes les réponses */
export function securityHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
  res.setHeader("Content-Security-Policy", CSP);
  if (TRUST_PROXY && req.headers["x-forwarded-proto"] === "https") res.setHeader("Strict-Transport-Security", "max-age=31536000");
}

function addVary(res: ServerResponse, value: string): string {
  const cur = res.getHeader("Vary");
  const list = new Set((typeof cur === "string" ? cur : "").split(",").map(s => s.trim()).filter(Boolean));
  list.add(value);
  return [...list].join(", ");
}

export async function send(
  res: ServerResponse, status: number, type: string, body: string | Buffer, tag?: string,
  opts?: { memo?: Memo; cache?: string }
): Promise<void> {
  try {
    if (res.writableEnded || res.destroyed) return;
    const headers: Record<string, string | number> = { "Content-Type": type };
    if (tag) headers["X-Cache"] = tag;
    if (opts?.cache) headers["Cache-Control"] = opts.cache;
    let payload: string | Buffer = body;
    const compressible = COMPRESSIBLE.test(type);
    if (compressible) headers["Vary"] = addVary(res, "Accept-Encoding");
    const size = typeof body === "string" ? Buffer.byteLength(body) : body.length;
    if (status === 200 && compressible && size >= MIN_COMPRESS && /\bgzip\b/.test(String(reqOf.get(res)?.headers["accept-encoding"] ?? ""))) {
      let gz = opts?.memo?.gz;
      if (!gz) { gz = await gzip(body, { level: 6 }); if (opts?.memo) opts.memo.gz = gz; }
      payload = gz;
      headers["Content-Encoding"] = "gzip";
    }
    headers["Content-Length"] = Buffer.byteLength(payload);
    res.writeHead(status, headers);
    res.end(payload);
  } catch {
    try { if (!res.headersSent) res.writeHead(500); res.end(); } catch { /* client parti */ }
  }
}
