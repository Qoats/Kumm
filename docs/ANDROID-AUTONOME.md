# Kumm Android autonome — architecture et validation

Version proposée : 0.54.0. Même application Capacitor, identifiant `fr.kumm.app`, origine WebView `https://localhost`, composants, thèmes, ressources et préférences existants. Aucun nouveau site, aucune WebView distante.

## Dépendances recensées et remplacement Android

| Ancienne dépendance au serveur | Chemin Android |
| --- | --- |
| `/api/kumm-mode`, `/health` | Aucun appel ; capacités locales, aucune version minimale imposée |
| `/api/gtfs/stops`, `/gtfs/lines`, `/gtfs/departures` | Moteur GTFS dans un worker, archive validée dans IndexedDB |
| `/api/trains`, `/ter-stations` | Flux SNCF officiel, uniquement points `StopPoint:OCETrain TER-…` ; destination et numéro distincts, aucun retard inventé |
| `/api/line-route`, `/quay-lines`, `/quay-modes` | Parcours et modes calculés sur le GTFS |
| `/geo/transit`, `/geo/stoptimes` | Calcul local des services actifs et correspondances ; horaires théoriques uniquement |
| `/tiles/*` | Tuiles OSM directement, attribution conservée, pas de téléchargement massif |
| `/geo/address`, `/geo/walk`, `/geo/bike` | IGN / routage OSM directement ; nécessitent Internet |
| `/poi/pr`, `/poi/velhop` | P+R de référence existants ; informations statiques GBFS en direct puis conservées sur le téléphone |
| `/api/vehicles` | Calculé sur le téléphone (`web/src/local-vehicles.ts`, dans le worker GTFS) : positions théoriques d’après les courses GTFS CTS et TER, tracés `data/shapes.json` et `data/rail.json`, attente aux terminus ; l’interface anime ensuite chaque véhicule (accélération, croisière, freinage). Aucun horaire ajouté, aucun appel réseau |
| `/trip`, `/ride`, `/messages`, `/stats`, `/reports`, alertes et prévisions de disponibilité | Écrans, commandes et ressources conservés ; « Bientôt disponible », pas d’appel au serveur ou à SIRI |
| `/geo/weather` | Aucune donnée météo en direct en mode autonome |
| `/api/widget/*` | SQLite native, utilisable quand l’application est fermée ; fonctions temps réel indisponibles |
| `/app/latest.json`, `/app/kumm.apk`, contrôle de version obligatoire | GitHub Releases stables, manifeste et APK de la même release ; report et refus possibles |

Le serveur web existant reste disponible pour les installations web. Ses protections et tests de sécurité sont conservés. Il ne pilote pas Android. Les anciens exemples de données et les itinéraires de démonstration ont été retirés du client.

## Sources et conservation

- CTS : <https://opendata.cts-strasbourg.eu/google_transit.zip>, référencé par le [catalogue national CTS](https://transport.data.gouv.fr/datasets/donnees-theoriques-gtfs-et-temps-reel-siri-lite-du-reseau-cts), Licence Ouverte 2.0.
- SNCF : <https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip>, source ouverte déjà utilisée par Kumm ; sélection des trains TER par les identifiants officiels des points d’arrêt. Les TGV et cars ne sont pas présentés comme des TER.

`KummGtfs` télécharge séquentiellement les deux sources dans le stockage privé Android, avec ETag / Last-Modified. Un verrou natif commun aux appels de l’application et à la tâche Android empêche les téléchargements concurrents. Les archives sont limitées à 64 Mio. Une erreur conserve la génération publiée ; HTTP 429/503 respecte Retry-After et applique une pause. Les fichiers sont préparés avant la commutation des métadonnées de génération ; la base SQLite du widget est préparée séparément et publiée avec ces métadonnées.

`GtfsJob` utilise JobScheduler, période 24 heures, réseau requis, persistance après redémarrage. Android décide du moment effectif selon ses contraintes. Une consultation à l’ouverture et chaque heure en premier plan récupère les générations natives, avec téléchargement seulement si le contrôle date de plus de 24 heures. Le bouton « Actualiser les données horaires » et celui de l’écran d’itinéraires demandent une vérification conditionnelle immédiate.

`local-worker.ts` conserve une copie validée dans IndexedDB : lecture locale au démarrage, parsing hors du fil d’interface, transaction de remplacement seulement après validation. Une archive corrompue ne remplace pas les horaires exploitables. La période de validité est calculée sur les calendriers et les exceptions ; l’interface affiche la dernière synchronisation et un avertissement si les données sont périmées. Il n’existe aucun retour vers des horaires fictifs ou vers le VPS.

Les jours GTFS utilisent Europe/Paris et « midi moins douze heures », y compris aux changements d’heure. `calendar_dates` prévaut sur `calendar`. Les horaires au-delà de 24 h sont recherchés dans les journées de service précédentes. Les montées et descentes interdites sont prises en compte par le moteur local.

Le compteur de premier plan s’arrête sur `visibilitychange` et sur `appStateChange`. Il recalcule les zones d’horaires existantes toutes les 30 secondes, sans remplacement de la page entière, et immédiatement au retour. Il ne synchronise pas le GTFS. Les préférences et lieux gardent leurs clés de stockage ; les favoris sont rapprochés par identifiant, références ou nom/position. Les identifiants non retrouvés sont conservés et une copie précède toute migration effective.

## Itinéraires : portée du calcul local

Le calcul recherche les services GTFS actifs, les accès à pied, les correspondances et les trajets « partir à » / « arriver avant ». Les horaires des étapes en transport sont officiels et théoriques. Les cheminements à pied locaux sont estimés à partir des positions des arrêts (accès jusqu’à 1 200 m, correspondances jusqu’à 350 m, marge de 2 minutes, au plus 4 correspondances). Leur tracé ne constitue pas un réseau piéton vérifié : l’écran le précise. Les consignes piétonnes et vélo détaillées gardent le routage OSM direct avec Internet.

Le réglage d’accessibilité reste présent. Le calcul local refuse explicitement une garantie d’accessibilité qu’il ne peut pas établir avec les seuls GTFS : il faut un graphe piéton accessible et les restrictions correspondantes pour retrouver cette capacité hors ligne. Cette limite doit être résolue ou acceptée avant de considérer la parité fonctionnelle complète avec l’ancien calculateur.

La réactivation future du temps réel exige les autorisations fournisseur, une intégration distincte et des tests. `KummFeatures.REALTIME` bloque aussi les anciens services Android ; le mode distant du serveur ne peut pas la réactiver.

## Distribution

Le profil `play` retire le module d’installation APK et `REQUEST_INSTALL_PACKAGES` ; il renvoie vers Google Play. Le profil `sideload` vérifie périodiquement les releases stables officielles, sans téléchargement d’APK avant l’accord de l’utilisateur. Le refus mémorise le code de version ; la recherche manuelle permet de revoir une version ignorée. Une installation reconnue comme provenant de Google Play utilise ce canal.

Le manifeste `latest.json` accompagne `kumm.apk` dans la même GitHub Release. L’installateur natif impose une URL de release du dépôt Qoats/Kumm, SHA-256, nom de paquet, code croissant et certificat identique à l’application installée. Android demande encore confirmation de l’installation. Une annulation ou un retour ferme la proposition et laisse l’application utilisable.

Le workflow conserve les contrôles de secrets, du paquet, de signature et de version. Les PR produisent APK de revue et AAB Play non signé. La préparation d’un APK de diffusion exige une action manuelle sur `main` et les secrets de signature existants. Elle compare le candidat à la release stable précédente ; pour la première migration seulement, à la branche `apk`. Elle crée uniquement une release **en brouillon**. Ni fusion, ni publication stable, ni envoi Play, ni suppression de branche n’est automatique.

## Validation reproductible

```sh
npm ci
npm run typecheck
npm test
npm run check:secrets
npx cap add android # une fois
node scripts/android/prepare-android.mjs sideload VERSION_CODE
VITE_SIDELOAD_UPDATES=1 npm run build:android
(cd android && ./gradlew testDebugUnitTest assembleDebug)
python3 scripts/android/check-android-package.py android/app/build/outputs/apk/debug/app-debug.apk
```

Les tests Node couvrent calendriers/exceptions, après minuit, changements d’heure, refus de montée, correspondance impossible, recherche par arrivée, transaction IndexedDB en échec, favoris et suspension/reprise du compteur. Les tests Robolectric couvrent les widgets hors ligne, les calendriers, l’import SQLite annulé, ETag/304, l’archive corrompue et Retry-After. Les jeux synthétiques de test ne sont jamais inclus dans l’application.

Essai de l’interface avec des archives officielles téléchargées séparément :

```sh
npx playwright install chromium
VITE_SIDELOAD_UPDATES=1 npm run dev:web -- --host 127.0.0.1
TEST_UPDATES=1 node scripts/check-android-local.mjs /chemin/cts.zip /chemin/sncf.zip
```

Le script remplace uniquement le pont natif par un adaptateur de test, fournit les vraies archives, bloque tout endpoint du serveur Kumm et vérifie l’interface, le worker, IndexedDB, le rafraîchissement manuel, le compteur 30 s, l’arrière-plan et le redémarrage sans réseau. Le scénario de mise à jour utilise une release de test en mémoire, sans publication ou téléchargement d’un APK réel.

Avant une diffusion : recette sur un appareil Android avec l’APK réellement signé, mise à jour depuis l’APK historique sans désinstallation, contrôle des favoris/lieux/thèmes/widgets, tâche quotidienne sous Doze, refus réseau, espace disque plein et installation Android annulée. La compatibilité du certificat de production et la conservation des données lors d’une véritable installation signée ne sont pas démontrées par un APK debug ou un test de navigateur.

## Résultats de cette proposition (17 novembre 2026)

- `npm run typecheck`, `npm test` : réussis, 10 tests Node.
- Tests applicatifs Android Robolectric : 4 réussis, dont import des deux archives officielles réelles et lecture des TER de Strasbourg dans SQLite, sans VPS. Les tests déterministes ne dépendent pas du réseau.
- Archives officielles : 1 347 points CTS ; 2 491 points ferroviaires TER retenus sur les 5 257 points SNCF du flux complet. Les 3 061 arrêts/gares regroupés chargés dans l’interface proviennent de ces données.
- Scénario navigateur avec pont natif de test : réussi pour horaires hors ligne après rechargement, favoris, recherche, lignes, itinéraires locaux, rafraîchissement manuel, compteur de 30 secondes sans téléchargement et sans remplacement de l’écran, suspension en arrière-plan, mentions théoriques / « Bientôt disponible », source et attribution cartographiques.
- Mises à jour dans ce scénario : aucune installation au contrôle automatique ; report, refus mémorisé, recherche manuelle et téléchargement seulement après accord ; refus de permission Android sans boucle d’ouverture des réglages.
- APK de revue Play et sideload, AAB Play non signé : compilés ; contrôles du contenu des paquets réussis. Signature debug vérifiée. Identifiant, version 0.54.0, code de test 10000, cible API 36 et retrait de `REQUEST_INSTALL_PACKAGES` sur le profil Play vérifiés.
- Contrôle des secrets, syntaxe YAML du workflow, `git diff --check` et test de sécurité de l’ancien canal VPS : réussis.

Aucune release n’a été créée ou publiée pendant ces essais. Aucun VPS n’a été utilisé ni déployé. La branche distante `apk` est conservée. Les validations de production sur téléphone et la parité d’accessibilité décrites ci-dessus restent à terminer ; ces résultats ne les remplacent pas.

## Correctif des régressions (restauration de l’interface)

- Carte : les trams, bus et trains théoriques circulent à nouveau sur leur tracé, sont suivis au toucher et rafraîchis toutes les 30 secondes ; les tracés et rails sont partagés avec le serveur (`shared/shapes-core.ts`, `shared/rail-core.ts`).
- Accueil Android : seules les tuiles « Info trafic » et « Vélhop » sont masquées (API indisponibles). Les autres fonctions réellement temps réel (ponctualité, signalements, alertes, disponibilités, suivi de trajet) restent « Bientôt disponible ».
- Premier lancement : la synchronisation native publie les archives dès qu’elles sont téléchargées et validées ; la copie SQLite des widgets (import lent de tous les horaires) est reconstruite ensuite en arrière-plan. Tant que les horaires ne sont pas chargés, un bandeau indique la progression ou l’erreur exacte, avec « Réessayer » (sans lui, l’application retombait silencieusement sur 66 gares TER).
- Itinéraires sans escaliers : « Bientôt disponible » (accessibilité des correspondances non vérifiable sans données), lignes directes proposées.
- Vérification : `node scripts/check-android-ui.mjs cts.zip sncf.zip` (avec `npx vite`) parcourt l’interface avec les archives officielles : accueil, ligne et sens, arrêt, favori après rechargement, recherche, carte et véhicules animés, suivi, itinéraire, « Bientôt disponible ».
