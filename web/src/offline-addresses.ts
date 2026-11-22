import type { Place } from "../../shared/types";

let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<number, (matches: Place[]) => void>();

export function offlineAddresses(query: string): Promise<Place[]> {
  if (!worker) {
    worker = new Worker(new URL("./address-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = event => {
      const { id, matches } = event.data as { id: number; matches: Place[] };
      pending.get(id)?.(matches);
      pending.delete(id);
    };
    worker.onerror = () => {
      for (const resolve of pending.values()) resolve([]);
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  return new Promise(resolve => {
    const id = ++sequence;
    pending.set(id, resolve);
    worker?.postMessage({ id, query });
  });
}
