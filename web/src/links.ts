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
/** Site officiel */
export const CTS_SITE = "https://www.cts-strasbourg.eu/";

export const isIOS = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent);
