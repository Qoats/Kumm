/** Réponses gardées en mémoire : taille bornée (les plus anciennes partent d'abord) et durée de service « en secours ». */
import { CACHE_MAX } from "./config.js";
import type { Memo } from "./http.js";

export interface Entry {
  body: string;
  type: string;
  /** fin de validité normale */
  exp: number;
  /** durée pendant laquelle on peut encore la servir si le service d'origine est en panne */
  staleMs: number;
  memo: Memo;
}

const store = new Map<string, Entry>();
export const cacheStats = { hits: 0, misses: 0, stale: 0, evicted: 0 };

/** Lecture ; l'entrée devient « récente » (celles qu'on n'utilise plus sont évincées en premier) */
export function cacheGet(key: string): Entry | undefined {
  const e = store.get(key);
  if (e) { store.delete(key); store.set(key, e); }
  return e;
}

export function cacheSet(key: string, e: Entry): void {
  store.delete(key);
  store.set(key, e);
  while (store.size > CACHE_MAX) {
    const oldest = store.keys().next().value as string;
    store.delete(oldest);
    cacheStats.evicted++;
  }
}

/** Supprime ce qui est trop ancien pour servir, même en secours */
export function cacheSweep(now = Date.now()): number {
  let n = 0;
  for (const [k, e] of store) if (e.exp + e.staleMs < now) { store.delete(k); n++; }
  return n;
}

export const cacheSize = (): number => store.size;
