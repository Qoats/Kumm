import { AUTONOMOUS, STATIC_SITE } from "./local";
/**
 * Présentation au premier lancement : ce que fait Kumm, les symboles de la carte, où trouver les options,
 * puis les autorisations (position, notifications) expliquées avant d'être demandées, et l'acceptation des conditions.
 * Si les conditions changent (TERMS_VERSION), seule l'étape des conditions est reproposée.
 */
import { NATIVE, PUSH_READY } from "./alerts";
import { ic } from "./icons";
import { KINDS } from "./kinds";
import type { Layer } from "./kinds";
import { markerIcon } from "./markers";

export const TERMS_VERSION = "2026-10-23";
const KEY = "onboarding";

export type StepId = "welcome" | "features" | "map" | "where" | "location" | "alerts" | "terms";

interface Saved { done?: boolean; terms?: string }
function load(): Saved {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Saved; } catch { return {}; }
}

/** Étapes à montrer : toutes au premier lancement, seulement les conditions si elles ont changé, aucune sinon */
export function onboardingSteps(): StepId[] {
  const s = load();
  if (s.done && s.terms === TERMS_VERSION) return [];
  if (s.done) return ["terms"];
  return allSteps();
}

/** Toutes les étapes (premier lancement, ou « Revoir la présentation » dans les réglages) */
export function allSteps(): StepId[] {
  const all: StepId[] = ["welcome", "features", "map", "where", "location", "alerts", "terms"];
  return all.filter(id => id !== "alerts" || (!AUTONOMOUS && NATIVE && PUSH_READY));   // alertes push : application Android avec serveur seulement
}

export function acceptTerms(): void {
  try { localStorage.setItem(KEY, JSON.stringify({ done: true, terms: TERMS_VERSION, at: new Date().toISOString() })); } catch { /* stockage indisponible */ }
}

/** Le premier lancement est-il terminé ? (sinon la position n'est demandée qu'à l'étape prévue) */
export const onboardingDone = (): boolean => load().done === true;

const ALL_LEGEND: [Layer, string][] = [
  ["tram", "Station de tram"], ["bus", "Arrêt de bus"], ["ter", "Gare (trams, bus et trains)"],
  ["velhop", "Station Vélhop"], ["velopark", "Vélopark"], ["pr", "Parking relais"], ["flexhop", "Arrêt Flex’hop (sur réservation)"]
];

const LEGEND: [Layer, string][] = STATIC_SITE ? ALL_LEGEND.filter(([k]) => k !== "velhop") : ALL_LEGEND;

const dots = (i: number, n: number): string =>
  `<div class="onb-dots" aria-hidden="true">${Array.from({ length: n }, (_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>`;

const row = (icon: string, title: string, text: string): string =>
  `<div class="onb-row"><span class="onb-ri">${icon}</span><span><b>${title}</b><small>${text}</small></span></div>`;

/** Écran d'une étape ; refused : l'utilisateur a refusé les conditions (version web, l'application ne peut pas se fermer) */
export function onboardingView(steps: StepId[], i: number, refused = false): string {
  const id = steps[i], n = steps.length;
  const back = i > 0 ? `<button class="onb-back" data-onb="back" aria-label="Étape précédente">${ic("back")}</button>` : "";
  const next = (label = "Continuer") => `<button class="onb-main" data-onb="next">${label}</button>`;
  let body = "", actions = "";
  switch (id) {
    case "welcome":
      body = `<img class="onb-applogo" src="/favicon.svg" alt="" width="76" height="76"><h1>Bienvenue dans Kumm</h1>
        <p>${AUTONOMOUS ? "Les horaires officiels CTS et TER, la carte du réseau avec ses véhicules, les itinéraires et vos favoris : sans serveur Kumm, et même hors connexion." : "Les prochains trams et bus de Strasbourg, la carte du réseau et les perturbations en cours, au même endroit."}</p>
        <p class="onb-note">Kumm est une application indépendante : elle utilise les données ouvertes de la CTS, mais n’est pas éditée par la CTS.</p>`;
      actions = next("Découvrir");
      break;
    case "features":
      body = `<h1>Ce que vous pouvez faire</h1>
        ${AUTONOMOUS ? row(ic("clock"), "Horaires théoriques", "Les prochains départs officiels, conservés sur le téléphone et recalculés toutes les 30 secondes.") : row(ic("clock"), "Passages en direct", "Les prochains départs à chaque arrêt, en temps réel.")}
        ${row(ic("pin"), "Carte", "Les arrêts autour de vous et les trams et bus en circulation, positions estimées d’après les horaires.")}
        ${row(ic("route"), "Itinéraires", "Cherchez un arrêt, une adresse ou un lieu, touchez « Naviguer » : en transports, à pied ou à vélo, avec le guidage.")}
        ${AUTONOMOUS ? "" : row(ic("mail"), "Infos trafic", "Les perturbations et travaux en cours sur le réseau.")}
        ${row(ic("bike"), AUTONOMOUS ? (STATIC_SITE ? "Parkings relais" : "Parkings relais et stations Vélhop") : "Vélhop et parkings relais", AUTONOMOUS ? "Leurs emplacements sur la carte." : "Les vélos et les places disponibles.")}
        ${AUTONOMOUS ? `<p class="onb-note">Retards, infos trafic et disponibilités en direct : Bientôt disponible.</p>` : ""}`;
      actions = next();
      break;
    case "map":
      body = `<h1>Les symboles de la carte</h1>
        <div class="onb-legend">${LEGEND.map(([k, t]) => `<div>${markerIcon(k, 30)}<span>${t}</span></div>`).join("")}</div>
        ${AUTONOMOUS ? "" : `        <div class="onb-legend onb-legend2">
          <div><span class="ln sm" style="background:#009EE0;color:#fff">B<span class="al">!</span></span><span>Ligne perturbée : touchez-la pour voir l’info trafic</span></div>
          <div><span class="onb-live"><span class="live"></span></span><span>Horaire en temps réel (sinon, horaire prévu)</span></div>
          <div><b class="onb-quai">À quai</b><span>Le tram ou le bus est à l’arrêt</span></div>
        </div>`}
        <p class="onb-note">Les catégories en haut de la carte (${KINDS.tram.label}, ${KINDS.bus.label}${STATIC_SITE ? "" : `, ${KINDS.velhop.label}`}…) servent à afficher ou masquer chaque type de point.</p>`;
      actions = next();
      break;
    case "where":
      body = `<h1>Où trouver quoi</h1>
        ${row(ic("sliders"), "Réglages", AUTONOMOUS ? "En haut de l’accueil : thème, mises à jour, version de l’application, mentions légales." : "En haut de l’accueil : thème, alertes trafic, version de l’application, mentions légales.")}
        ${row(ic("heart"), "Favoris", "Touchez le cœur sur la fiche d’un arrêt pour voir ses passages dès l’accueil.")}
        ${AUTONOMOUS ? "" : row(ic("mail"), "Infos trafic", "En haut de l’accueil, toutes les perturbations en cours.")}
        ${row(ic("pin"), "Carte", "En bas de l’écran : la carte, les arrêts et les départs autour de vous.")}
        ${row(ic("search"), "Recherche et « Naviguer »", "En bas de l’écran : un arrêt, une adresse ou un lieu, puis « Naviguer » pour choisir l’itinéraire et l’heure.")}`;
      actions = next();
      break;
    case "location":
      body = `<div class="onb-big">${ic("target")}</div><h1>Votre position</h1>
        <p>Elle sert à afficher les arrêts autour de vous, à partir de « Ma position » dans les itinéraires et à vous guider à pied.</p>
        <div class="onb-box"><b>Ce qui est partagé</b>
          <small>${AUTONOMOUS ? "Votre position reste sur votre téléphone et n’est jamais envoyée à un serveur Kumm. La carte et les itinéraires à pied et à vélo de l’Eurométropole sont calculés sur votre téléphone, sans connexion." : "Votre position reste sur votre téléphone. Elle n’est envoyée au serveur Kumm que quand vous demandez un itinéraire, ou si vous acceptez de partager un trajet en bus, en tram ou en train (sans nom ni identifiant, jusqu’à votre descente). Elle n’est pas conservée."}</small></div>
        <p class="onb-note">Sans la position, Kumm fonctionne aussi : la carte s’ouvre sur le centre de Strasbourg.</p>`;
      actions = `<button class="onb-main" data-onb="loc">Autoriser la position</button><button class="onb-sec" data-onb="next">Plus tard</button>`;
      break;
    case "alerts":
      if (AUTONOMOUS) { body = `<div class="onb-big">${ic("mail")}</div><h1>Alertes trafic</h1><p>Bientôt disponible</p>`; actions = next(); break; }
      body = `<div class="onb-big">${ic("mail")}</div><h1>Alertes trafic</h1>
        <p>Recevez une notification quand une perturbation touche les lignes que vous suivez, même quand Kumm est fermée.</p>
        <div class="onb-box"><b>Ce que garde le serveur</b>
          <small>Uniquement un identifiant de notification (fourni par Google pour acheminer les notifications) et la liste de vos lignes. Pas de nom, pas de position. Tout est supprimé dès que vous désactivez les alertes dans les Réglages.</small></div>`;
      actions = `<button class="onb-main" data-onb="alerts">Activer les alertes</button><button class="onb-sec" data-onb="next">Plus tard</button>`;
      break;
    case "terms":
      body = `<div class="onb-big">${ic("help")}</div><h1>Conditions d’utilisation</h1>
        <ul class="onb-terms">
          <li>Les horaires, positions et infos trafic sont donnés à titre indicatif : en cas de doute, fiez-vous à l’affichage en station et aux informations officielles de la CTS.</li>
          <li>Kumm est un projet personnel et gratuit, sans garantie : il n’est pas responsable d’un retard ou d’une correspondance manquée.</li>
          <li>L’application doit être utilisée normalement : pas de robots, pas de tentative de surcharge.</li>
        </ul>
        <p class="onb-note">Le détail : <a href="https://kumm.fr/mentions-legales.html" target="_blank" rel="noopener">mentions légales et conditions</a> · <a href="https://kumm.fr/confidentialite.html" target="_blank" rel="noopener">confidentialité</a>.</p>
        ${refused ? `<p class="onb-refused" role="alert">Pour utiliser Kumm, vous devez accepter les conditions d’utilisation.${NATIVE ? "" : " Vous pouvez fermer cette page."}</p>` : ""}`;
      actions = `<button class="onb-main" data-onb="accept">J’accepte</button><button class="onb-sec" data-onb="refuse">${NATIVE ? "Refuser et quitter" : "Refuser"}</button>`;
      break;
  }
  return `<div class="onb" role="dialog" aria-modal="true" aria-label="Présentation de Kumm">
    <div class="onb-top">${back}${n > 1 ? dots(i, n) : ""}</div>
    <div class="onb-body">${body}</div>
    <div class="onb-actions">${actions}</div></div>`;
}
