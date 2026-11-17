import type { MotisLeg, MotisPlace, MotisPlan } from "../../shared/geo-api";
interface Call { code: string; name: string; arr: number; dep: number; board?: boolean; alight?: boolean }
interface Course { id: string; line: string; dest: string; mode: string; calls: Call[] }
interface Point { lat: number; lon: number }
const distance = (a: Point, b: Point) => Math.hypot((a.lat - b.lat) * 110540, (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));
const iso = (t: number) => new Date(t).toISOString();
/** Earliest arrival label scan, with walking access, transfers and egress. All times are scheduled. */
export function planLocal(courses: Course[], positions: Map<string, Point>, from: Point, to: Point, at: number, arrive = false): MotisPlan {
  // An arrival query is the same search with time and trip direction reversed.
  const sign = arrive ? -1 : 1, start = arrive ? to : from, end = arrive ? from : to;
  const trips = courses.map(c => ({ ...c, calls: arrive ? [...c.calls].reverse().map(s => ({ ...s, arr: -s.dep, dep: -s.arr, board: s.alight, alight: s.board })) : c.calls }));
  interface Label { time: number; legs: MotisLeg[] }
  const grid = new Map<string, [string, Point][]>();
  const cell = (p: Point) => [Math.floor(p.lat / .005), Math.floor(p.lon / .008)];
  for (const item of positions) { const key = cell(item[1]).join(","); const bucket = grid.get(key) ?? []; bucket.push(item); grid.set(key, bucket); }
  function neighbours(p: Point): [string, Point][] { const [a, b] = cell(p); const out: [string, Point][] = []; for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) out.push(...(grid.get([a+x,b+y].join(",")) ?? [])); return out; }
  const labels = new Map<string, Label>();
  const place = (code: string, name: string): MotisPlace => ({ ...positions.get(code)!, name, stopId: code });
  function leg(mode: string, a: MotisPlace, b: MotisPlace, dep: number, arr: number, extra = {}): MotisLeg {
    return { mode, from: a, to: b, startTime: iso(dep), endTime: iso(arr), duration: (arr - dep) / 1000, realTime: false, ...extra };
  }
  const initial = sign * at;
  for (const [code, p] of positions) {
    const m = distance(start, p); if (m > 1200) continue;
    const time = initial + Math.ceil(m / 1.2) * 1000;
    labels.set(code, { time, legs: [leg("WALK", start, place(code, ""), initial, time, { distance: Math.round(m) })] });
  }
  const results: Label[] = [];
  for (let round = 0; round < 5; round++) {
    const next = new Map(labels);
    for (const c of trips) {
      let boarded: { label: Label; i: number } | undefined;
      for (let i = 0; i < c.calls.length; i++) {
        const s = c.calls[i], p = positions.get(s.code); if (!p) continue;
        if (boarded && s.alight !== false) {
          const a = c.calls[boarded.i];
          const legs = [...boarded.label.legs, leg(c.mode.toUpperCase(), place(a.code, a.name), place(s.code, s.name), a.dep, s.arr, {
            routeShortName: c.line, headsign: c.dest,
            intermediateStops: c.calls.slice(boarded.i + 1, i).filter(x => positions.has(x.code)).map(x => place(x.code, x.name))
          })];
          if (s.arr < (next.get(s.code)?.time ?? Infinity)) next.set(s.code, { time: s.arr, legs });
          const walk = distance(p, end);
          if (walk <= 1200) results.push({ time: s.arr + Math.ceil(walk / 1.2) * 1000, legs: [...legs, leg("WALK", place(s.code, s.name), end, s.arr, s.arr + Math.ceil(walk / 1.2) * 1000, { distance: Math.round(walk) })] });
        }
        const label = labels.get(s.code);
        if (s.board !== false && label && label.time + (round ? 120000 : 0) <= s.dep && (!boarded || label.time < boarded.label.time)) boarded = { label, i };
      }
    }
    // Walking transfers between neighbouring platforms, including between CTS and SNCF.
    const changed = [...next].filter(([code, v]) => v.time < (labels.get(code)?.time ?? Infinity));
    for (const [code, v] of changed) for (const [other, p] of neighbours(positions.get(code)!)) {
      if (code === other) continue;
      const m = distance(positions.get(code)!, p); if (m > 350) continue;
      const time = v.time + Math.ceil(m / 1.2) * 1000;
      if (time < (next.get(other)?.time ?? Infinity)) next.set(other, { time, legs: [...v.legs, leg("WALK", place(code, ""), place(other, ""), v.time, time, { distance: Math.round(m) })] });
    }
    labels.clear(); for (const [k, v] of next) labels.set(k, v);
  }
  const unique = new Set<string>();
  return { itineraries: results.sort((a, b) => a.time - b.time).filter(r => {
    const k = r.legs.filter(l => l.mode !== "WALK").map(l => l.routeShortName + l.startTime + l.to.stopId).join("|");
    if (unique.has(k)) return false; unique.add(k); return true;
  }).slice(0, 6).map(r => {
    const legs = arrive ? [...r.legs].reverse().map(l => ({ ...l, from: l.to, to: l.from, startTime: iso(-Date.parse(l.endTime)), endTime: iso(-Date.parse(l.startTime)), intermediateStops: l.intermediateStops?.reverse() })) : r.legs;
    return { startTime: legs[0].startTime, endTime: legs.at(-1)!.endTime, duration: (r.time - initial) / 1000, transfers: legs.filter(l => l.mode !== "WALK").length - 1, legs };
  }) };
}
