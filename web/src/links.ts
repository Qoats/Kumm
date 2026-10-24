/**
 * Liens officiels de la CTS : Kumm ne vend aucun titre de transport, il renvoie vers la CTS.
 * Sources : conditions générales de vente (CGVU) de la CTS, qui citent ces adresses, et fiche de l'application dans l'App Store.
 */
/** Application officielle « CTS Transports Strasbourg » sur Android (Google Play) */
export const CTS_APP_ANDROID = "https://play.google.com/store/apps/details?id=fr.cts.strasbourg.ugo";
/** … et sur iPhone (App Store) */
export const CTS_APP_IOS = "https://apps.apple.com/fr/app/cts-transports-strasbourg/id1241895758";
/** Page officielle des points de vente */
export const CTS_POINTS_DE_VENTE = "https://www.cts-strasbourg.eu/fr/Titres-de-transport/points-de-vente/";
/** Objets trouvés : service Troov, cité par la CTS (« Retrouver vos objets ») */
export const CTS_OBJETS_TROUVES = "https://troov.com/compagnie-des-transports-strasbourgeois-c-t-s";
/** Aide et contact de la CTS (abonnements, carte Badgéo, réclamations…) */
export const CTS_FAQ = "https://www.cts-strasbourg.eu/fr/faq/generalites/";
export const CTS_CONTACT = "https://www.cts-strasbourg.eu/fr/contact/nous-contacter/";
/** Contact de Kumm (mentions légales) */
export const KUMM_CONTACT = "support@axim.ch";
/** Site officiel */
export const CTS_SITE = "https://www.cts-strasbourg.eu/";

export const isIOS = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent);
