// Télécharge les horaires théoriques (GTFS) CTS et SNCF depuis le portail officiel transport.data.gouv.fr
// et les écrit dans <dossier>/data/ avec un manifeste : le site statique les sert lui-même (même origine, sans CORS).
//
// Données ouvertes uniquement : aucune API CTS, aucun jeton, aucun temps réel.
//   CTS (trams et bus)  : jeu « Réseau urbain CTS », Licence Ouverte 2.0
//   SNCF (TER)          : jeu « Réseau SNCF TGV, Intercités et TER », ODbL
//
// Usage : node scripts/fetch-open-data.mjs dist/pages | node scripts/fetch-open-data.mjs dist/web cts
// Code de sortie non nul si une archive manque ou est invalide : le déploiement est alors annulé et le site
// précédent reste en ligne.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";

const SOURCES = {
  cts: {
    official: "https://opendata.cts-strasbourg.eu/google_transit.zip",
    dataset: "5ae1715488ee384c8ba0342b",
    name: "CTS / Eurométropole de Strasbourg",
    licence: "Licence Ouverte 2.0",
    page: "https://transport.data.gouv.fr/datasets/donnees-theoriques-gtfs-et-temps-reel-siri-lite-du-reseau-cts"
  },
  ter: {
    dataset: "6853c089b3ed5781f6adfdf7",
    name: "SNCF",
    licence: "ODbL",
    page: "https://transport.data.gouv.fr/datasets/horaires-sncf"
  }
};
const API = "https://transport.data.gouv.fr/api/datasets/";
const REQUIRED = ["stops.txt", "routes.txt", "trips.txt", "stop_times.txt"];
const UA = "Kumm open-data mirror (https://github.com/Qoats/Kumm)";

async function get(url, as) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw Error(`HTTP ${r.status} pour ${url}`);
  return as === "json" ? r.json() : new Uint8Array(await r.arrayBuffer());
}

/** Vérifie qu'une archive est un GTFS exploitable (fichiers obligatoires, calendrier, assez volumineux) */
function validate(bytes) {
  const names = new Set();
  unzipSync(bytes, { filter: f => { names.add(f.name); return false; } });
  for (const n of REQUIRED) if (!names.has(n)) throw Error(`${n} absent de l'archive`);
  if (!names.has("calendar.txt") && !names.has("calendar_dates.txt")) throw Error("calendrier absent de l'archive");
  if (bytes.length < 500_000) throw Error("archive anormalement petite : " + bytes.length + " octets");
}

async function fetchSource(key, src, direct) {
  if (direct) {
    const r = await fetch(src.official, { headers: { "User-Agent": UA }, cache: "no-cache", signal: AbortSignal.timeout(180_000) });
    if (!r.ok) throw Error(`[${key}] HTTP ${r.status} pour ${src.official}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    validate(bytes);
    return { key, bytes, from: src.official, at: r.headers.get("Last-Modified"), etag: r.headers.get("ETag") ?? undefined, title: "Réseau urbain CTS" };
  }
  const d = await get(API + src.dataset, "json");
  const gtfs = d.resources.filter(r => r.format === "GTFS");
  if (!gtfs.length) throw Error(`Aucune ressource GTFS dans « ${d.title} »`);
  const ids = new Set(gtfs.map(r => r.id));
  // copies archivées par le portail, de la plus récente à la plus ancienne ; on prend la première valide
  const copies = (d.history ?? []).filter(h => ids.has(h.resource_id) && h.payload?.format === "GTFS" && h.payload.permanent_url)
    .sort((a, b) => String(b.payload.download_datetime).localeCompare(String(a.payload.download_datetime)));
  const candidates = copies.map(h => ({ url: h.payload.permanent_url, at: h.payload.download_datetime }));
  // dernier recours : adresse permanente de data.gouv.fr, qui redirige vers le producteur
  for (const r of gtfs) candidates.push({ url: r.url, at: r.updated });
  const errors = [];
  for (const c of candidates.slice(0, 4)) {
    try {
      const bytes = await get(c.url, "bytes");
      validate(bytes);
      return { key, bytes, from: c.url, at: c.at, title: d.title };
    } catch (e) { errors.push(`${c.url} : ${e.message}`); console.warn(`[${key}] ${e.message}`); }
  }
  throw Error(`[${key}] aucune archive valide :\n  ` + errors.join("\n  "));
}

const out = path.resolve(process.argv[2] ?? "dist/pages", "data");
const onlyCts = process.argv[3] === "cts";
fs.mkdirSync(out, { recursive: true });
const manifest = { generated: "", sources: {} };
for (const [key, src] of Object.entries(onlyCts ? { cts: SOURCES.cts } : SOURCES)) {
  const r = await fetchSource(key, src, onlyCts);
  fs.writeFileSync(path.join(out, key + ".zip"), r.bytes);
  manifest.sources[key] = {
    revision: crypto.createHash("sha256").update(r.bytes).digest("hex").slice(0, 16),
    bytes: r.bytes.length, publishedAt: r.at, etag: r.etag, retrievedFrom: r.from,
    dataset: r.title, producer: src.name, licence: src.licence, page: src.page
  };
  console.log(`${key} : ${(r.bytes.length / 1e6).toFixed(1)} Mo, ${manifest.sources[key].revision}, ${r.at}`);
}
manifest.generated = new Date().toISOString();
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log("manifeste écrit dans", path.join(out, "manifest.json"));
