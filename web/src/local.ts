import { Capacitor, registerPlugin } from "@capacitor/core";
export const AUTONOMOUS = Capacitor.getPlatform() === "android";
type Source = "cts" | "ter";
interface Status { checked: number; revision: string; etag?: string; modified?: string; error?: string; expired?: boolean; validUntil?: string }
const Gtfs = registerPlugin<{ sync(o: { manual: boolean }): Promise<Record<Source, Status>>; read(o: { source: Source }): Promise<{ data: string }> }>("KummGtfs");
export let LOCAL_STATUS: Partial<Record<Source, Status>> = {};
let worker: Worker | undefined, seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
function rpc<T>(data: object): Promise<T> {
  worker ??= new Worker(new URL("./local-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.error ? p.reject(Error(e.data.error)) : p.resolve(e.data.result); };
  worker.onerror = () => { for (const p of pending.values()) p.reject(Error("Lecture GTFS interrompue")); pending.clear(); worker?.terminate(); worker = undefined; };
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); worker!.postMessage({ id, ...data }); });
}
export const localQuery = <T>(path: string): Promise<T> => rpc<T>({ method: "query", path });
let syncing: Promise<void> | undefined, retryAt = 0;
export async function localInit(): Promise<void> {
  LOCAL_STATUS = await rpc({ method: "status" });
  if (Object.keys(LOCAL_STATUS).length) void syncLocal(false).catch(console.warn);
  else await syncLocal(false);
}
/** Conditional requests only on manual refresh or after 24 hours. One synchronization at a time. */
export function syncLocal(manual = true): Promise<void> {
  if (syncing) return syncing;
  if (Date.now() < retryAt) return Promise.reject(Error("Nouvel essai dans une minute"));
  return syncing = (async () => {
    LOCAL_STATUS = await rpc({ method: "status" });
    const errors: string[] = [];
    let changed = false;
    const native = await Gtfs.sync({ manual });
    for (const source of ["cts", "ter"] as Source[]) {
      const n = native[source], old = LOCAL_STATUS[source];
      if (n.error) errors.push(source.toUpperCase() + " : " + n.error);
      if (!n.revision) continue;
      try {
        if (old?.revision !== n.revision) {
          const r = await Gtfs.read({ source });
          const raw = atob(r.data), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
          await rpc({ method: "save", source, value: { bytes, ...n } }); changed = true;
        } else if (n.checked !== old.checked) await rpc({ method: "checked", source, checked: n.checked });
      } catch (e) { errors.push(source.toUpperCase() + " : " + String(e)); }
    }
    LOCAL_STATUS = await rpc({ method: "status" });
    if (changed) window.dispatchEvent(new Event("kumm:gtfs"));
    if (errors.length) { retryAt = Date.now() + 60_000; throw Error(errors.join(" · ")); }

  })().finally(() => { syncing = undefined; });
}
export function syncLabel(): string {
  return (["cts", "ter"] as Source[]).map(s => {
    const d = LOCAL_STATUS[s];
    return `${s.toUpperCase()} : ${d ? new Date(d.checked).toLocaleString("fr-FR") + (d.expired ? " · Données périmées" : "") + (Date.now() - d.checked > 86400_000 ? " · Synchronisation ancienne" : "") : "non téléchargé"}`;
  }).join(" · ");
}
