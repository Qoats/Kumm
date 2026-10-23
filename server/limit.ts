/** Limite de requêtes par adresse et par minute. */
import type { IncomingMessage } from "node:http";
import { TRUST_PROXY } from "./config.js";

const hits = new Map<string, { n: number; reset: number }>();
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60_000).unref();

export function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    // la dernière adresse est celle ajoutée par notre proxy ; les précédentes peuvent venir du visiteur lui-même
    const f = req.headers["x-forwarded-for"];
    if (typeof f === "string" && f) return (f.split(",").pop() ?? "").trim() || (req.socket.remoteAddress ?? "?");
  }
  return req.socket.remoteAddress ?? "?";
}

export function withinLimit(req: IncomingMessage, bucket: "api" | "tiles" | "apk", limit: number): boolean {
  if (limit <= 0) return true;
  const key = `${bucket}|${clientIp(req)}`, now = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < now) { h = { n: 0, reset: now + 60_000 }; hits.set(key, h); }
  return ++h.n <= limit;
}
