import { CONFIG } from "./config";
import { COLORS } from "./data";
import { stopById } from "./store";

export const MAPPATHS = `
 <rect width="360" height="440" fill="var(--map)"/>
 <path d="M-10 255 C60 215 100 120 160 140 C210 156 230 120 300 95 L370 70 L370 100 L300 125 C240 150 220 190 160 170 C115 156 80 250 -10 285z" fill="var(--water)"/>
 <path d="M60 300 C120 330 150 250 220 262 C270 270 300 330 370 310 L370 340 C300 360 260 300 220 290 C160 280 130 360 60 330z" fill="var(--water)"/>
 <ellipse cx="300" cy="190" rx="38" ry="26" fill="var(--park)"/><ellipse cx="40" cy="60" rx="46" ry="30" fill="var(--park)"/>
 <g stroke="var(--street)" stroke-width="7" fill="none" stroke-linecap="round">
  <path d="M0 200 L360 230"/><path d="M110 0 L150 440"/><path d="M0 120 L360 90"/><path d="M250 0 L290 440"/><path d="M0 380 L360 350"/><path d="M60 40 L230 300"/>
 </g>
 <g stroke="var(--street)" stroke-width="3" fill="none"><path d="M0 60 L360 80"/><path d="M0 310 L360 280"/><path d="M200 0 L180 440"/><path d="M20 0 L60 440"/><path d="M330 0 L320 440"/></g>`;

/* Tracés façon plan de réseau : segments horizontaux/verticaux/diagonaux (45°),
   les lignes qui partagent un tronçon sont dessinées côte à côte. */
const MAPROUTES: Record<string, string[]> = {
  A:["GCE","HDF","ETO"], D:["GCE","LGS","HDF","ETO"],
  B:["BOU","HDF","BRO"], C:["GCE","HDF","KRU"],
  E:["REP","BRO","FAU","GCE"], F:["HDF","KRU"]
};

interface Pt { x: number; y: number }

function octo(p: Pt, q: Pt): Pt[] {
  const dx = q.x - p.x, dy = q.y - p.y, ax = Math.abs(dx), ay = Math.abs(dy), d = Math.min(ax, ay);
  const m = ax > ay ? { x: p.x + Math.sign(dx) * (ax - d), y: p.y } : { x: p.x, y: p.y + Math.sign(dy) * (ay - d) };
  return [p, m, q];
}

function pos(id: string): Pt {
  const s = stopById(id);
  if (!s) throw new Error("Arrêt inconnu : " + id);
  return s;
}

export function mapRoutes(): string {
  if (!CONFIG.USE_MOCK) return "";
  const key = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const edges: Record<string, string[]> = {};
  const used = new Set<string>();
  for (const [l, seq] of Object.entries(MAPROUTES)) {
    for (let i = 0; i < seq.length - 1; i++) (edges[key(seq[i], seq[i + 1])] ??= []).push(l);
    seq.forEach(s => used.add(s));
  }
  const paths = Object.entries(MAPROUTES).map(([l, seq]) => {
    const pts: Pt[] = [];
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i], b = seq[i + 1], fwd = a < b;
      const users = edges[key(a, b)].slice().sort();
      const off = (users.indexOf(l) - (users.length - 1) / 2) * 5;
      const seg = octo(pos(fwd ? a : b), pos(fwd ? b : a));
      const out: Pt[] = [];
      for (let j = 0; j < seg.length - 1; j++) {
        const dx = seg[j + 1].x - seg[j].x, dy = seg[j + 1].y - seg[j].y, len = Math.hypot(dx, dy);
        if (len < 0.01) continue;
        const nx = (-dy / len) * off, ny = (dx / len) * off;
        out.push({ x: seg[j].x + nx, y: seg[j].y + ny }, { x: seg[j + 1].x + nx, y: seg[j + 1].y + ny });
      }
      if (!fwd) out.reverse();
      pts.push(...out);
    }
    return { l, p: pts.map(q => q.x.toFixed(1) + "," + q.y.toFixed(1)).join(" ") };
  });
  const attr = 'fill="none" stroke-linecap="round" stroke-linejoin="round"';
  return (
    paths.map(o => `<polyline points="${o.p}" ${attr} stroke="#fff" stroke-width="7.5"/>`).join("") +
    paths.map(o => `<polyline points="${o.p}" ${attr} stroke="${COLORS[o.l]}" stroke-width="4"/>`).join("") +
    [...used].map(id => { const s = pos(id); return `<circle cx="${s.x}" cy="${s.y}" r="4.5" fill="#fff" stroke="#2B3036" stroke-width="1.8"/>`; }).join("")
  );
}
