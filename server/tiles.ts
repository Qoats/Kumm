/** Relais des tuiles de carte (OpenStreetMap) : identifie l'application, garde les tuiles en mémoire, même origine que la page. */
import type { ServerResponse } from "node:http";
import { GEO_USER_AGENT } from "./geo.js";

const BASE = process.env.TILE_BASE ?? "https://tile.openstreetmap.org";
/** Fournisseur dédié : paramètres ajoutés à chaque tuile, par exemple « ?key=MA_CLE » (jamais visible dans l'application) */
const QUERY = process.env.TILE_QUERY ?? "";
const RE = /^\/tiles\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/;
const MAX_ENTRIES = 800;
const TTL_MS = 24 * 3600_000;

interface Tile { buf: Buffer; exp: number }
const cache = new Map<string, Tile>();
const inflight = new Map<string, Promise<Buffer | null>>();

/** « /tiles/z/x/y.png » valide ? (zoom 0 à 19, x et y dans la grille) */
export function parseTilePath(path: string): { z: number; x: number; y: number } | null {
  const m = RE.exec(path);
  if (!m) return null;
  const z = Number(m[1]), x = Number(m[2]), y = Number(m[3]);
  return z <= 19 && x < 2 ** z && y < 2 ** z ? { z, x, y } : null;
}

async function download(url: string): Promise<Buffer | null> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": GEO_USER_AGENT }, signal: ctl.signal });
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  } catch { return null; }
  finally { clearTimeout(to); }
}

export async function serveTile(res: ServerResponse, path: string): Promise<void> {
  const t = parseTilePath(path);
  if (!t) { res.writeHead(400); return void res.end(); }
  const key = `${t.z}/${t.x}/${t.y}`;
  const hit = cache.get(key);
  let buf: Buffer | null = hit && hit.exp > Date.now() ? hit.buf : null;
  if (!buf) {
    let p = inflight.get(key);
    if (!p) { p = download(`${BASE}/${key}.png${QUERY}`).finally(() => inflight.delete(key)); inflight.set(key, p); }
    buf = await p;
    if (buf) {
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
      cache.set(key, { buf, exp: Date.now() + TTL_MS });
    }
  }
  if (!buf) { res.writeHead(502, { "Content-Type": "text/plain" }); return void res.end("Tuile indisponible"); }
  res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
  res.end(buf);
}

export const TILE_ORIGIN = BASE;
