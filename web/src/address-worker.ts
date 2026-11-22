import { gunzipSync, strFromU8 } from "fflate";
import { createAddressIndex } from "./address-index";
import type { StreetAddresses } from "./address-index";

const index = fetch("/offline/addresses.bin").then(async response => {
  if (!response.ok) throw Error("Index d’adresses indisponible");
  const bytes = new Uint8Array(await response.arrayBuffer());
  return createAddressIndex(JSON.parse(strFromU8(gunzipSync(bytes))) as StreetAddresses[]);
});

self.onmessage = async (event: MessageEvent<{ id: number; query: string }>) => {
  const { id, query } = event.data;
  try { self.postMessage({ id, matches: (await index)(query) }); }
  catch { self.postMessage({ id, matches: [] }); }
};
