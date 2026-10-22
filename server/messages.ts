/** Infos trafic de la CTS (SIRI « general-message ») : messages en cours, simplifiés et en texte brut pour l'application. */

export interface TrafficMessage {
  id: string;
  /** « disruption » : incident ; « works » : travaux et changements prévus */
  channel: "disruption" | "works";
  /** lignes concernées (LineRef de la CTS) */
  lines: string[];
  title: string;
  /** période telle que rédigée par la CTS (« Du 05/10/2026 au 23/10/2026 ») */
  period: string;
  text: string;
  start?: string;
  end?: string;
  /** dernière publication ou mise à jour du message par la CTS */
  updated?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", laquo: "«", raquo: "»", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç" };

/** Le détail des messages est en HTML : on n'en garde que le texte (paragraphes et puces), jamais une balise */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*\/\s*(p|li|ul|ol|div|h\d)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[<>]/g, "")
    .replace(/[ \t ]+/g, " ")
    .split("\n").map(l => l.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Messages en vigueur maintenant : incidents d'abord, puis du plus récent au plus ancien */
export function parseGeneralMessages(body: string, now = Date.now()): TrafficMessage[] {
  const j = JSON.parse(body) as { ServiceDelivery?: { GeneralMessageDelivery?: unknown[] } };
  const out: TrafficMessage[] = [];
  const seen = new Set<string>();
  for (const del of j.ServiceDelivery?.GeneralMessageDelivery ?? []) {
    if (!isObj(del) || !Array.isArray(del["InfoMessage"])) continue;
    for (const m of del["InfoMessage"]) {
      if (!isObj(m) || !isObj(m["Content"])) continue;
      const c = m["Content"];
      const start = str(c["ImpactStartDateTime"]), end = str(c["ImpactEndDateTime"]) || str(m["ValidUntilTime"]);
      if ((start && Date.parse(start) > now) || (end && Date.parse(end) < now)) continue;
      const zones: Record<string, string> = {};
      for (const z of Array.isArray(c["Message"]) ? c["Message"] : []) {
        if (!isObj(z) || !Array.isArray(z["MessageText"])) continue;
        const texts = z["MessageText"].filter(isObj);
        const t = texts.find(x => str(x["Lang"]).toUpperCase() === "FR") ?? texts[0];
        if (t) zones[str(z["MessageZoneRef"])] = str(t["Value"]);
      }
      const title = htmlToText(zones["title"] ?? "");
      const id = str(m["InfoMessageIdentifier"]) || str(m["ItemIdentifier"]) || title;
      if (!title || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        channel: /disrupt|incident|perturb/i.test(str(m["InfoChannelRef"])) ? "disruption" : "works",
        lines: (Array.isArray(c["ImpactedLineRef"]) ? c["ImpactedLineRef"] : []).map(str).filter(Boolean),
        title, period: htmlToText(zones["period"] ?? ""), text: htmlToText(zones["details"] ?? ""),
        start: start || undefined, end: end || undefined, updated: str(m["RecordedAtTime"]) || undefined
      });
    }
  }
  return out.sort((a, b) => (a.channel === b.channel ? Date.parse(b.start ?? "") - Date.parse(a.start ?? "") || 0 : a.channel === "disruption" ? -1 : 1));
}
