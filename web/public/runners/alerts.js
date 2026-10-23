// Alertes trafic en arrière-plan (Android, module Capacitor « Background Runner ») : environ toutes les 15 minutes,
// même application fermée, ce script lit les infos trafic du serveur Kumm et affiche une notification pour chaque
// nouvelle perturbation sur les lignes suivies. Il ne voit ni la page ni le stockage de l'application : ses réglages
// lui sont envoyés par l'application (événement « kummConfig ») et gardés dans CapacitorKV.

function readJson(key, fallback) {
  try {
    const v = CapacitorKV.get(key);
    const raw = v && typeof v === "object" ? v.value : v;
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}

/** Identifiant numérique (32 bits) d'une notification, stable pour un même message */
function notifId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2000000000;
}

function followed(m, cfg) {
  if (m.channel !== "disruption" && !cfg.works) return false;
  const lines = cfg.lines || [];
  return lines.indexOf("*") >= 0 || (m.lines || []).some(function (l) { return lines.indexOf(l) >= 0; });
}

// réglages envoyés par l'application ; « seen » : messages déjà connus quand l'utilisateur active les alertes
addEventListener("kummConfig", function (resolve, reject, args) {
  try {
    const cfg = args || {};
    if (Array.isArray(cfg.seen)) { CapacitorKV.set("seen", JSON.stringify(cfg.seen)); delete cfg.seen; }
    CapacitorKV.set("config", JSON.stringify(cfg));
    resolve();
  } catch (e) { reject(e); }
});

addEventListener("checkAlerts", async function (resolve) {
  try {
    const cfg = readJson("config", null);
    if (!cfg || !cfg.enabled || !cfg.apiBase) { resolve(); return; }
    const r = await fetch(cfg.apiBase + "/api/messages", { headers: cfg.appKey ? { "X-App-Key": cfg.appKey } : {} });
    if (!r.ok) { resolve(); return; }
    const items = (await r.json()).items || [];
    const seen = readJson("seen", []);
    const fresh = items.filter(function (m) { return followed(m, cfg) && seen.indexOf(m.id) < 0; });
    if (fresh.length) {
      CapacitorNotifications.schedule(fresh.slice(0, 4).map(function (m) {
        const lines = (m.lines || []).slice(0, 4).join(", ");
        return {
          id: notifId(m.id),
          title: (m.channel === "disruption" ? "Perturbation · " : "Travaux · ") + m.title,
          body: (lines ? "Lignes " + lines : "") + (m.period ? (lines ? " · " : "") + m.period : ""),
          largeBody: (m.text || "").slice(0, 600),
          smallIcon: "ic_stat_kumm",
          autoCancel: true,
          extra: { msg: m.id }
        };
      }));
    }
    // on garde les messages encore en cours (pour ne pas les annoncer deux fois) et on oublie ceux qui sont terminés
    const current = items.map(function (m) { return m.id; });
    CapacitorKV.set("seen", JSON.stringify(current));
    resolve();
  } catch (e) {
    console.error("Alertes trafic : " + e);
    resolve();
  }
});
