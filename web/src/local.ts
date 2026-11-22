import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
/** Site statique (GitHub Pages) : mêmes calculs locaux qu'Android, archives GTFS servies par le site lui-même */
export const STATIC_SITE = import.meta.env["VITE_STATIC"] === "1" && !Capacitor.isNativePlatform();
export const AUTONOMOUS = Capacitor.getPlatform() === "android" || STATIC_SITE;
type Source = "cts" | "ter";
interface Status { checked: number; revision: string; etag?: string; modified?: string; error?: string; expired?: boolean; validUntil?: string; bundled?: boolean }
interface GtfsBridge { sync(o: { manual: boolean }): Promise<Record<Source, Status>>; read(o: { source: Source; revision: string }): Promise<{ path?: string; data?: string; bytes?: Uint8Array }> }

/**
 * Archives du site (publiées chaque jour depuis transport.data.gouv.fr par scripts/fetch-open-data.mjs) :
 * /data/manifest.json décrit la révision de chacune ; l'archive n'est relue que si sa révision a changé.
 */
const webGtfs: GtfsBridge = {
  async sync() {
    const r = await fetch("/data/manifest.json", { cache: "no-store" });
    if (!r.ok) throw Error("Données horaires indisponibles sur ce site (HTTP " + r.status + ")");
    const m = (await r.json()) as { sources?: Partial<Record<Source, { revision?: string }>> };
    const out = {} as Record<Source, Status>;
    for (const s of ["cts", "ter"] as Source[]) {
      const revision = m.sources?.[s]?.revision;
      if (!revision) throw Error("Manifeste de données incomplet : " + s.toUpperCase());
      out[s] = { revision, checked: Date.now() };
    }
    return out;
  },
  async read({ source }) {
    const m = (await (await fetch("/data/manifest.json", { cache: "no-store" })).json()) as { sources: Record<Source, { revision: string }> };
    const r = await fetch(`/data/${source}.zip?v=${encodeURIComponent(m.sources[source].revision)}`);
    if (!r.ok) throw Error("Archive " + source.toUpperCase() + " indisponible (HTTP " + r.status + ")");
    return { bytes: new Uint8Array(await r.arrayBuffer()) };
  }
};
const nativeGtfs = registerPlugin<GtfsBridge & {
  cached(): Promise<Record<Source, Status>>;
  addListener(event: "networkReady", listener: () => void): Promise<PluginListenerHandle>;
}>("KummGtfs");
const Gtfs = STATIC_SITE ? webGtfs : nativeGtfs;

export function onScheduleNetworkReady(listener: () => void): void {
  if (!STATIC_SITE) void nativeGtfs.addListener("networkReady", listener).catch(console.warn);
}
export let LOCAL_STATUS: Partial<Record<Source, Status>> = {};
/** État visible du chargement des horaires et des erreurs de synchronisation. */
export const LOCAL_STATE: { phase: "idle" | "loading" | "error"; error?: string; since: number } = { phase: "idle", since: 0 };
function setState(phase: "idle" | "loading" | "error", error?: string): void {
  LOCAL_STATE.phase = phase; LOCAL_STATE.error = error; LOCAL_STATE.since = Date.now();
  window.dispatchEvent(new Event("kumm:gtfs-state"));
}
let worker: Worker | undefined, seq = 0, startup: Promise<void> | undefined;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
function rpc<T>(data: object, transfer: Transferable[] = []): Promise<T> {
  worker ??= new Worker(new URL("./local-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.error ? p.reject(Error(e.data.error)) : p.resolve(e.data.result); };
  worker.onerror = () => { setState("error", "Lecture des horaires interrompue (mémoire du téléphone ?)"); for (const p of pending.values()) p.reject(Error("Lecture GTFS interrompue")); pending.clear(); worker?.terminate(); worker = undefined; startup = undefined; };
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); worker!.postMessage({ id, ...data }, transfer); });
}
export const localQuery = <T>(path: string): Promise<T> => rpc<T>({ method: "query", path });
let syncing: Promise<void> | undefined, retryAt = 0;
function prepareLocal(): Promise<void> {
  // Une reprise Android peut demander une synchronisation avant la fin du premier affichage.
  return startup ??= (async () => {
    LOCAL_STATUS = await rpc({ method: "status" });
    if (!STATIC_SITE && !LOCAL_STATUS.cts) {
      try { await importArchives(await nativeGtfs.cached()); }
      catch (e) { console.warn("Horaires Android en cache indisponibles", e); }
    }
  })().catch(e => { startup = undefined; throw e; });
}

export async function localInit(): Promise<void> {
  await prepareLocal();
  if (Object.keys(LOCAL_STATUS).length) void syncLocal(false).catch(console.warn);
  else await syncLocal(false);
}

async function importArchives(available: Record<Source, Status>): Promise<string[]> {
  const errors: string[] = [];
  let changed = false;
  for (const source of ["cts", "ter"] as Source[]) {
    const next = available[source], old = LOCAL_STATUS[source];
    if (next.error) errors.push(source.toUpperCase() + " : " + next.error);
    if (!next.revision) continue;
    try {
      if (old?.revision !== next.revision) {
        const r = source === "cts" && next.bundled ? { path: "/data/cts.zip" } : await Gtfs.read({ source, revision: next.revision });
        if (r.path) {
          const archiveUrl = next.bundled ? r.path : Capacitor.convertFileSrc(r.path);
          await rpc({ method: "save", source, value: next, archiveUrl });
        } else {
          const bytes = r.bytes ?? Uint8Array.from(atob(r.data ?? ""), c => c.charCodeAt(0));
          await rpc({ method: "save", source, value: { bytes, ...next } }, bytes.buffer instanceof ArrayBuffer ? [bytes.buffer] : []);
        }
        changed = true;
      } else if (next.checked !== old.checked) await rpc({ method: "checked", source, checked: next.checked });
    } catch (e) { errors.push(source.toUpperCase() + " : " + String(e)); }
  }
  LOCAL_STATUS = await rpc({ method: "status" });
  if (changed) window.dispatchEvent(new Event("kumm:gtfs"));
  return errors;
}

/** Native verifies freshness per feed. Background errors leave the current schedule in service. */
export function syncLocal(manual = true): Promise<void> {
  if (syncing) return syncing;
  if (Date.now() < retryAt) return Promise.reject(Error("Nouvel essai dans une minute"));
  return syncing = (async () => {
    await prepareLocal();
    LOCAL_STATUS = await rpc({ method: "status" });
    if (!LOCAL_STATUS.cts) setState("loading");
    const errors = await importArchives(await Gtfs.sync({ manual }));
    if (errors.length) { retryAt = Date.now() + 60_000; throw Error(errors.join(" · ")); }
    if (LOCAL_STATE.phase !== "idle") setState("idle");

  })().catch(e => {
    if (!LOCAL_STATUS.cts) setState("error", String(e instanceof Error ? e.message : e));
    else if (LOCAL_STATE.phase !== "idle") setState("idle");
    throw e;
  })
    .finally(() => { syncing = undefined; });
}
