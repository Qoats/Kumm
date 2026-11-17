# Kumm

Application web et Android pour le réseau de transports de Strasbourg : horaires théoriques CTS, carte, parkings relais, Vélhop, trajets avec correspondances et guidage à pied.

> **Projet indépendant, non officiel.** Kumm n'est ni édité, ni approuvé, ni affilié à la CTS ni à l'Eurométropole de Strasbourg. Le logo et le nom sont propres au projet.

## Mettre en ligne pour le grand public
Sur un VPS : **`docs/DEPLOIEMENT-VPS.md`** (Docker + Caddy, HTTPS automatique, site vitrine sur `kumm.fr`, application sur `app.kumm.fr`). Voir aussi **`docs/MISE-EN-LIGNE.md`** (hébergement, variables, supervision, services à remplacer, liste de contrôle, Play Store) et le modèle **`docs/POLITIQUE-CONFIDENTIALITE.md`**. Le serveur expose `/health` pour la supervision ; son fonctionnement en charge (cache, secours, limites, compression) y est décrit.

## Horaires CTS et autorisation SIRI Lite

Le serveur utilise par défaut le GTFS officiel publié par la CTS sous la responsabilité de l’Eurométropole de Strasbourg, sous [Licence Ouverte 2.0](https://transport.data.gouv.fr/datasets/donnees-theoriques-gtfs-et-temps-reel-siri-lite-du-reseau-cts). Il vérifie le cache toutes les heures, télécharge une mise à jour après 20 h et garde la dernière copie valide si le téléchargement échoue. Les heures respectent le calendrier GTFS et le fuseau Europe/Paris.

Le temps réel est désactivé par défaut. Après autorisation, définir `CTS_MODE=live` et fournir un **nouveau jeton** CTS dans l’environnement du serveur. `CTS_TRAFFIC=1` réactive aussi les perturbations CTS. Le GTFS reste utilisé pour les horaires planifiés. Le serveur ne demande aucun jeton CTS en mode théorique.

## Publier ou contribuer sans rien divulguer
- Ne mettez **jamais** de jeton dans le code, un fichier d'exemple, une capture d'écran ou un message de commit. Le jeton vit dans `.env` (poste local) ou dans les variables d'environnement de l'hébergeur.
- Avant chaque publication : `npm run check:secrets` (cherche jetons, clés privées et fichiers sensibles ; code de sortie 1 si quelque chose est trouvé).
- Si un jeton a été publié, même quelques minutes : **supprimez-le sur le portail CTS et générez-en un nouveau**. Effacer le fichier ou le commit ne suffit pas, l'historique reste lisible.
- Sur GitHub : Settings → Code security → activez *Secret scanning* et *Push protection*.
- Un serveur public est protégé par une **limite de requêtes par adresse** (`RATE_LIMIT_PER_MIN`, 600 par défaut) et ne relaie qu'une liste fixe de services. La page `/diag` n'existe que si `ENABLE_DIAG=1` : ne l'activez pas sur un serveur public.
- Android ne contient plus d’adresse de serveur Kumm ni de jeton CTS : les horaires sont lus dans les GTFS officiels enregistrés sur le téléphone.

## Licences et données
Le code est sous licence MIT (fichier `LICENSE`). Les données gardent leurs conditions : horaires et arrêts CTS / Eurométropole de Strasbourg (Licence Ouverte 2.0), parkings et Vélhop (Licence Ouverte), cartes et marche à pied © contributeurs OpenStreetMap (ODbL, attribution obligatoire), trajets Transitous. Les tuiles du serveur public d'OpenStreetMap sont réservées à un usage modéré : pour une large diffusion, utilisez un fournisseur de tuiles dédié.

## Structure

```
web/             application et ressources Vite
server/          serveur HTTP, GTFS CTS, services ouverts et SIRI facultatif
shared/          types communs au client et au serveur
android-src/     classes Java et manifeste complémentaire
android-res/     ressources Android
android/         projet Capacitor généré localement
data/            géométrie versionnée utilisée par le serveur
scripts/android/ préparation, vérification et publication Android
scripts/         génération des données et contrôles manuels
tests/           tests serveur et distribution Android
deploy/          Caddy et mise à jour du VPS
vitrine/         site public indépendant de l’application
docs/            procédures de maintenance et de diffusion
```

## Installer et lancer (une seule fois, puis à chaque session)
Node 22.12 ou plus récent. Dans PowerShell, utilisez `npm.cmd` si `npm` est bloqué.

1. `npm.cmd install`
2. `copy .env.example .env`
3. **Mode développement** : `npm.cmd run dev` puis ouvrez http://localhost:5173 (la page se recharge à chaque modification)
4. **Mode "production"** : `npm.cmd run build` puis `npm.cmd start`, et ouvrez http://localhost:3000

## Application Android autonome

L’application conserve l’interface Capacitor, ses thèmes, son identifiant `fr.kumm.app` et ses données utilisateur. Elle télécharge directement les GTFS officiels CTS / SNCF, conserve les horaires théoriques sur le téléphone et les recalcule toutes les 30 secondes au premier plan. Aucune instance Kumm n’est nécessaire. Les fonctions temps réel affichent « Bientôt disponible ».

La synchronisation utilise ETag / Last-Modified, un bouton manuel et une tâche Android quotidienne. Les dernières données valides restent disponibles hors connexion. Les fonds de carte, adresses et itinéraires piétons/vélo détaillés utilisent directement leurs services publics avec Internet. Le calcul local des correspondances utilise des cheminements à pied estimés ; la garantie d’accessibilité hors ligne reste à compléter.

Avec Node 22.12+, JDK 21 et SDK Android 36 :

```sh
npm ci
npx cap add android
node scripts/android/prepare-android.mjs play VERSION_CODE
npm run build:android
(cd android && ./gradlew testDebugUnitTest assembleDebug bundleRelease)
```

`VERSION_CODE` doit être supérieur à celui de l’installation existante. Les fichiers debug servent aux tests ; ils ne remplacent pas une version de diffusion signée avec une autre clé. Pour une compilation sideload, choisir `sideload` et définir `VITE_SIDELOAD_UPDATES=1` pendant `npm run build:android`.

Le workflow « APK Android » produit APK de revue et AAB Play non signé. La préparation manuelle d’une diffusion sideload sur `main` réutilise les secrets de signature existants et crée une **GitHub Release en brouillon**. Les mises à jour sont facultatives : accepter, reporter ou ignorer. Les installations Play utilisent Google Play. La branche `apk` est conservée comme référence de première migration.

Architecture, sources, tests et recette avant diffusion : [Android autonome](docs/ANDROID-AUTONOME.md). Préparation Play : [Google Play](docs/GOOGLE-PLAY.md).

## Widgets de l’écran d’accueil Android

Les sept widgets et leurs ressources restent présents : arrêt favori, trajet grand/petit, arrêt proche, trafic, Vélhop / P+R et raccourcis. Les horaires sont lus dans une base SQLite locale, même application fermée. Les fonctions nécessitant du temps réel indiquent « Bientôt disponible ». Les couleurs, réglages et choix d’arrêt sont conservés. Android actualise les widgets selon ses contraintes ; le bouton ↻ recalcule les passages localement.

## Logo et installation sur téléphone
Le logo est un « K » dessiné comme une ligne de plan de transport (barre blanche, branches jaune et bleue), avec un rond d'arrêt à chaque extrémité (« Kumm » = « viens » en alsacien). Fichiers dans `web/public/` : `favicon.svg` (logo vectoriel, modifiable), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `manifest.webmanifest`. Une variante rouge / bleu / violet est fournie à part. Dans l'en-tête, le logo est l'icône `kumm` de `web/src/icons.ts` (il prend la couleur du thème).
Pour installer l'app sur un téléphone : ouvrez-la dans le navigateur, puis « Ajouter à l'écran d'accueil » (l'icône Kumm apparaît).

## Personnalisation
Réglages (bouton à curseurs en haut de l'accueil, ou la roue de la carte) : 4 thèmes (Automatique, Menthe clair, Forêt sombre, Contraste élevé), 5 couleurs principales (vert par défaut, turquoise, bleu, violet, rouge) et la carte sombre avec les thèmes sombres. Le choix est gardé sur l'appareil.
Pour ajouter une couleur ou un thème : tout est dans `web/src/style.css` (variables en haut du fichier) et `web/src/themes.ts` (listes proposées dans les réglages).

## Comment un arrêt est classé tram / bus / TER
Par son **nom**, d'après des listes trouvées sur internet (fichier `web/src/network.ts`) :
- stations de tram : index des stations du plan du tramway de Strasbourg (version du 19 janvier 2026) + les stations de la ligne F prolongée vers Wolfisheim citées par la CTS.
Un arrêt CTS absent de la liste est un arrêt de bus.
Les **gares TER** sont les 13 gares SNCF de l'Eurométropole (`shared/ter.ts`, code UIC et position) : elles ont leur propre
repère et leur tableau des départs. Strasbourg-Ville est rattachée à « Gare Centrale » (onglets Tous / Tram / Bus / Train). L'écriture n'a pas d'importance (accents, majuscules, tirets, « / » sont ignorés).
Si une station de tram s'affiche comme un bus, ajoutez son nom dans `TRAM_STATIONS`. Pour trouver les oublis, dans la console du navigateur (F12) :

    __kumm.STOPS.filter(s => __kumm.kindOfStop(s)==="bus" && s.lines.some(l => /^[A-F]$/.test(l))).map(s => s.name)

## La carte « À proximité »
Avec les vraies données, c'est une vraie carte OpenStreetMap (zoom et déplacement au doigt ou à la souris) : chaque arrêt est placé à ses coordonnées réelles. Seuls les repères visibles à l'écran sont dessinés (300 arrêts au plus). Le bouton cible recentre sur votre position.
Si la zone reste grise avec un message « Fond de carte indisponible », votre réseau n'atteint pas `tile.openstreetmap.org` : les arrêts restent affichés mais sans fond.
Les fonds de carte viennent des serveurs publics d'OpenStreetMap, faits pour un usage modéré : pour une vraie mise en ligne, il faudra un fournisseur de tuiles dédié.

## Sources des données (tout est référencé ici)
| Donnée | Source |
|---|---|
| Arrêts, lignes et horaires théoriques | GTFS officiel CTS / Eurométropole de Strasbourg, Licence Ouverte 2.0 |
| Temps réel CTS, si autorisé et activé | API CTS SIRI Lite |
| Parkings relais (12) : positions, capacités | Eurométropole de Strasbourg, open data (data.strasbourg.eu : « parkings » et « occupation en temps réel des parkings », Licence Ouverte) ; liste des 12 sites confirmée par la page « Park-and-Ride » de cts-strasbourg.eu |
| Places libres des P+R | jeu « occupation-parkings-temps-reel » (mise à jour toutes les 3 minutes) |
| Stations Vélhop + vélos disponibles | flux GBFS `gbfs.nextbike.net/maps/gbfs/v2/nextbike_ae/fr/` (jeu « VLS Vélhop Strasbourg » sur transport.data.gouv.fr, Licence Ouverte 2.0) |
| Véloparks | page « Véloparcs CTS (P+V) » de cts-strasbourg.eu (sites, placés sur les arrêts du même nom) ; VéloParcs Gare et Sainte-Aurélie : strasbourg.eu « Où garer son vélo à Strasbourg ? » |
| Stations de tram | index du plan du tramway de Strasbourg v2.12 (cartometro.com) + avis CTS (ligne F prolongée) |
| Gares TER, horaires et temps réel des trains | SNCF, données ouvertes (transport.data.gouv.fr) : horaires GTFS `Export_OpenData_SNCF_GTFS_NewTripId.zip` (téléchargés une fois par jour, gardés dans `state/ter-gtfs.zip`) et temps réel GTFS-RT `sncf-gtfs-rt-trip-updates` (toutes les `TER_POLL_S` secondes) ; voir `server/ter.ts` |
| Voies ferrées (trains sur la carte) | © contributeurs OpenStreetMap (ODbL) : voies principales autour de Strasbourg extraites par `node scripts/build-rail.mjs` dans `data/rail.json` (relancé chaque nuit avec les tracés) |
| Fonds de carte, marche à pied | © contributeurs OpenStreetMap (tuiles relayées par le serveur ; routage `routing.openstreetmap.de`) |
| Adresses | Base Adresse Nationale, via la Géoplateforme de l'IGN (`data.geopf.fr/geocodage`) |
| Trajets avec correspondances | Transitous / MOTIS (`api.transitous.org`) |
| Tracés des lignes (véhicules sur la carte) | © contributeurs OpenStreetMap (ODbL) : itinéraires CTS extraits par `npm run build:shapes` dans `data/shapes.json` (à relancer quand le réseau change) |
| Contrôle des tracés | plan détaillé officiel de la CTS (non inclus dans le dépôt) : `python3 scripts/check-shapes-plan.py Plan-Detaille-reseau-CTS.pdf http://localhost:3000` écrit `data/shape-cuts.json`, les morceaux de tracé OpenStreetMap absents du plan, que le serveur retire (le bus y suit la route) ; à relancer à chaque nouveau plan |
| Carte 3D du guidage | OpenFreeMap (`tiles.openfreemap.org`, tuiles vectorielles OpenMapTiles, © contributeurs OpenStreetMap), affichée avec MapLibre GL ; repli sur la carte 2D si le téléphone ne sait pas l'afficher |
Pas encore branchés : Flex'hop (zones de transport à la demande) ; les TGV et Intercités (seuls les TER sont affichés).

## Trains TER
- Seuls les trains qui desservent une gare de l'Eurométropole sont gardés en mémoire (environ 1 000 par semaine).
- Un train absent du temps réel SNCF roule à l'heure ; un retard annoncé à une gare est reporté sur les gares suivantes.
- Sur la carte, la position d'un train est estimée d'après ses horaires (comme les trams et bus), le long des voies de `data/rail.json`
  (en ligne droite si ce fichier manque). Son code de trajet est `terelsass` + numéro du train (« Elsàss » : l'Alsace en alsacien).
- `/health` → `trains_ter` : nombre de trains, âge du temps réel, dernière erreur. `TER_POLL_S=0` désactive les trains.

## Carte : catégories de points
Chaque catégorie a sa couleur, sa forme et son symbole : Tram (cercle bleu), Bus (carré turquoise), Vélhop (cercle vert), Vélopark (losange vert foncé, « P »), P+R (hexagone bleu), Flex'hop (écusson rose) et Gare TER (octogone violet). Les boutons en haut de la carte affichent ou masquent chaque catégorie.

Sources de données réelles :
- **Tram / bus** : liste d'arrêts de la CTS. **Gares TER** : gares SNCF de l'Eurométropole (`shared/ter.ts`).
- **P+R et Vélopark** : endpoints `park-and-ride` et `veloparc` de l'API CTS.
- **Vélhop et Flex'hop** : pas encore branchés (le bouton est grisé et l'indique).
Si une catégorie reste vide, ouvrez `http://localhost:3000/api/veloparc` (ou `park-and-ride`) et regardez ce que renvoie la CTS.

## Itinéraires avec correspondances
Il n'y a pas d'onglet Itinéraires : on cherche un arrêt, une adresse ou un lieu dans **Recherche**, puis **Naviguer** (sur la fiche de l'arrêt ou au bout de la ligne de résultat) ouvre l'écran de choix (transports, à pied, vélo) ; son bouton retour ramène à l'écran d'origine.
L'écran Itinéraires calcule de vrais trajets en transports (avec correspondances) grâce à **Transitous**, un service public et gratuit basé sur MOTIS (`api.transitous.org`), qui utilise les horaires ouverts du réseau. Chaque trajet montre les étapes, les horaires et les arrêts ; « Guider à pied jusqu'à l'arrêt » lance la navigation, puis propose la marche finale jusqu'à la destination.
- Si le service est injoignable, l'app se replie sur les lignes directes et affiche la cause.
- Usage raisonnable seulement (service communautaire). Les réponses sont gardées 60 secondes par le serveur.
- Vérification : http://localhost:3000/diag, rubrique `transitous` (nombre de trajets trouvés pour Hoenheim → Gare Centrale).

## Itinéraires et guidage à pied
- Le départ peut être « Ma position », une adresse de Strasbourg ou un arrêt.
- Le guidage affiche une vraie carte (OpenStreetMap), les virages, votre position, et recalcule si vous sortez du tracé. Le bouton « Simuler » fait avancer un point sur le trajet pour tester sans marcher.
- Services utilisés (gratuits, usage raisonnable) : la Base Adresse Nationale (adresses), `routing.openstreetmap.de` (marche à pied) et les tuiles OpenStreetMap (fond de carte). Pour une vraie mise en ligne avec beaucoup d'utilisateurs, il faudra un fournisseur dédié (variables `GEO_ADDRESS_BASE` et `GEO_WALK_BASE` dans `.env`).

## Diagnostic en un clic
Ajoutez `ENABLE_DIAG=1` dans votre `.env` (en local seulement), relancez le serveur, puis ouvrez http://localhost:3000/diag : la page teste la connexion à www / opendata / api, le token (masqué), les services SIRI, les chemins de P+R et de Vélopark, et cherche la description officielle de l'API (swagger) pour en lister les vrais chemins. Copiez ce qu'elle affiche en cas de problème.

## Si la CTS est injoignable (« fetch failed », ECONNRESET)
Le serveur ne réessaie pas une connexion coupée et fait une pause de 2 minutes avant de rappeler la CTS (pour ne pas aggraver un blocage éventuel). Le message d'erreur dans « Détails techniques » donne la cause réseau.
Test en une ligne : `curl.exe -sS -o NUL -w "code=%{http_code}" https://api.cts-strasbourg.eu` — un code 401 ou 404 est bon signe (le site répond) ; « Connection was reset » veut dire que la connexion est coupée avant d'arriver à l'API.

## Si un arrêt affiche une erreur ou « aucun passage »
Ouvrez la fiche de l'arrêt et le bouton « Détails techniques » : il montre les codes essayés (code de l'arrêt, puis codes des quais) et la réponse exacte de la CTS.
Pour voir les données brutes depuis PowerShell (serveur lancé) :

    (Invoke-WebRequest http://localhost:3000/api/lines-discovery).Content.Substring(0,1500)
    (Invoke-WebRequest http://localhost:3000/api/stoppoints-discovery).Content.Substring(0,1500)

Dans la console du navigateur (F12), `__kumm.STOPS` et `__kumm.LINE_MODES` montrent ce que l'app a compris.

## Vérifier l'API
Ouvrez http://localhost:3000/api/stoppoints-discovery (ou :5173/api/...) : vous devez voir du JSON.
Si un arrêt reste vide, ouvrez sa fiche et le bouton « Détails techniques » : copiez ce qu'il affiche.

## Vérifier le code
`npm.cmd run typecheck` contrôle les types de tout le projet.

## Règle d'interface : un menu ne doit jamais revenir en haut tout seul
L'interface est redessinée en entier à chaque changement (`render()` → `draw()` remplace le contenu de la page). Sans précaution,
chaque liste revient en haut dès qu'on touche un bouton : c'est arrivé plusieurs fois (réglages, catégories de la carte,
choix de la direction dans « À proximité »…). Désormais :
- **`web/src/scroll.ts` garde la position de toutes les zones qui défilent**, automatiquement, à chaque redessin : rien à faire
  pour un nouveau menu qui utilise une zone défilante normale (`overflow: auto` ou `scroll`).
- Une zone est reconnue par son **`id`**, son attribut **`data-scroll="nom"`**, ou à défaut par sa place dans la page. Si un menu
  change de structure d'un redessin à l'autre (un bloc qui apparaît au-dessus de la liste, par exemple), donnez à sa zone
  défilante un `id` ou un `data-scroll` stable.
- Les positions sont gardées **par écran** : un onglet retrouve sa position quand on y revient ; une fiche (arrêt, ligne,
  réglages…) repart du haut à chaque nouvelle ouverture.
- Ne remettez jamais `scrollTop = 0` à la main dans `draw()`, et n'ajoutez pas de liste de zones « à surveiller » : c'est ce qui
  faisait oublier les nouveaux menus.
- **Après toute modification de l'interface**, lancez `node scripts/check-scroll.mjs` (serveur démarré) : il passe dans chaque
  menu, fait défiler toutes ses zones, redessine l'écran et signale toute zone qui a bougé. Ajoutez-y chaque nouveau menu.

## Règle de carte : un véhicule reste toujours sur sa voie, sans cacher les stations
- La position d'un tram ou d'un bus vient de son tracé réel (`web/src/vehicles.ts`). **Tout déplacement d'affichage se fait le
  long de ce tracé** (`vehiclePosAlong`), jamais en ligne droite ni sur le côté : sinon le véhicule sort de sa voie dans les virages.
- Près d'une station, le véhicule attend juste avant l'icône (ou se place juste après en repartant), sur sa voie (`besideStops`
  dans `web/src/livemap.ts`). Un véhicule qui ne touche pas de station n'est jamais déplacé.
- **Après toute modification de la carte**, lancez `node scripts/check-map.mjs` (serveur démarré) : pendant 30 s, à plusieurs
  endroits du réseau, il vérifie que chaque véhicule est à moins de 3 px de son tracé et qu'aucun ne recouvre une station.

## Sécurité
- Le token reste dans `.env`, côté serveur. Ne le publiez jamais (`.gitignore` l'exclut).
- Les textes venant de l'API sont échappés avant affichage.
