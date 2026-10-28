/** Lecture des horaires ouverts au format GTFS (zip), sans dépendance : TER (ter.ts) et réseau CTS (schedule.ts). */
import readline from "node:readline";
import { Readable } from "node:stream";
import zlib from "node:zlib";

/* ---------- dates (heure de Strasbourg) ---------- */
const paris = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function parisParts(t: number): Record<string, number> {
  return Object.fromEntries(paris.formatToParts(new Date(t)).filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
}
export const ymd = (t: number): string => { const p = parisParts(t); return `${p["year"]}${String(p["month"]).padStart(2, "0")}${String(p["day"]).padStart(2, "0")}`; };
/** Début de la journée de service GTFS (midi moins 12 h, heure de Strasbourg) : juste même les jours de changement d'heure */
export function dayBase(date: string): number {
  const noon = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)), 12);
  const p = parisParts(noon), offset = Date.UTC(p["year"], p["month"] - 1, p["day"], p["hour"], p["minute"]) - noon;
  return noon - offset - 12 * 3600_000;
}
export const DAY = 86_400_000;
/** Hier, aujourd'hui et demain (un train parti hier soir peut rouler après minuit) */
export const daysAround = (now: number): string[] => [ymd(now - DAY), ymd(now), ymd(now + DAY)];

/* ---------- lecture du fichier GTFS (zip) sans dépendance ---------- */
export function zipEntries(buf: Buffer): Map<string, { method: number; size: number; offset: number }> {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("fichier zip illisible");
  const out = new Map<string, { method: number; size: number; offset: number }>();
  let p = buf.readUInt32LE(end + 16);
  for (let n = buf.readUInt16LE(end + 10); n > 0; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("répertoire zip illisible");
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const data = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.set(name, { method, size, offset: data });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

/** Une ligne CSV (guillemets gérés) */
export function csv(line: string): string[] {
  if (!line.includes('"')) return line.split(",");
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Parcourt un fichier du zip ligne par ligne (en-tête → index des colonnes) */
export async function eachRow(buf: Buffer, entries: ReturnType<typeof zipEntries>, file: string, fn: (row: string[], col: Record<string, number>) => void): Promise<void> {
  const e = entries.get(file);
  if (!e) throw new Error(`${file} absent du GTFS`);
  const raw = buf.subarray(e.offset, e.offset + e.size);
  const input = e.method === 8 ? Readable.from([raw]).pipe(zlib.createInflateRaw()) : Readable.from([raw]);
  let col: Record<string, number> | null = null;
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (!line) continue;
    if (!col) { col = Object.fromEntries(csv(line.replace(/^﻿/, "")).map((h, i) => [h.trim(), i])); continue; }
    fn(csv(line), col);
  }
}

