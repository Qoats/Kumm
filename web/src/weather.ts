/**
 * Météo du centre de Strasbourg (Open-Meteo, relayée par notre serveur : aucune position n'est transmise) : température,
 * pluie maintenant et dans les 2 prochaines heures. Sert à conseiller le tram plutôt que le vélo quand il pleut.
 */
import { appHeaders, url } from "./config";

export interface Weather { temp: number; code: number; rainNow: boolean; snow: boolean; /** début de la pluie prévue (ms), si elle n'a pas déjà commencé */ rainAt?: number }
let W: Weather | null = null, at = 0, loading = false;

const RAIN = (c: number): boolean => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
const SNOW = (c: number): boolean => (c >= 71 && c <= 77) || c === 85 || c === 86;

/** Dernière météo connue (null au début) ; la recharge si elle date de plus de 10 min, puis rappelle done */
export function weather(done: () => void): Weather | null {
  if (!loading && Date.now() - at > 600_000) {
    loading = true;
    fetch(url("/geo/weather"), { headers: appHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((j: { current?: { temperature_2m?: number; precipitation?: number; weather_code?: number }; minutely_15?: { time?: string[]; precipitation?: number[]; precipitation_probability?: (number | null)[] } }) => {
        const c = j.current ?? {}, code = c.weather_code ?? 0, m = j.minutely_15 ?? {};
        const rainNow = (c.precipitation ?? 0) >= 0.1 || RAIN(code) || SNOW(code);
        // première tranche de 15 min avec de la pluie, probable (heures locales de Strasbourg, données par le service)
        const i = (m.precipitation ?? []).findIndex((mm, k) => mm >= 0.2 && (m.precipitation_probability?.[k] ?? 60) >= 50);
        const t = i >= 0 && m.time?.[i] ? parisTime(m.time[i]) : undefined;
        W = { temp: Math.round(c.temperature_2m ?? 0), code, rainNow, snow: SNOW(code), ...(!rainNow && t && t > Date.now() - 15 * 60_000 ? { rainAt: Math.max(t, Date.now()) } : {}) };
        done();
      })
      .catch(() => { /* météo indisponible : rien n'est affiché */ })
      .finally(() => { loading = false; at = Date.now(); });
  }
  return W;
}

/** « 2026-10-30T15:30 » (heure de Strasbourg) → ms */
function parisTime(s: string): number {
  const guess = Date.parse(s + "Z");
  const off = new Date(guess).toLocaleString("en-US", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" }).match(/GMT([+-]\d+)/)?.[1];
  return guess - Number(off ?? 1) * 3600_000;
}

/** Phrase courte : « Il pleut », « Pluie vers 15:30 », ou null s'il fait sec */
export function rainText(w: Weather | null): string | null {
  if (!w) return null;
  if (w.rainNow) return w.snow ? "Il neige" : "Il pleut";
  if (w.rainAt) return `Pluie vers ${new Date(w.rainAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  return null;
}
