# Kumm

Application web et Android pour le réseau de transports de Strasbourg : horaires en direct, carte, parkings relais, Vélhop, trajets avec correspondances et guidage à pied.

> **Projet indépendant, non officiel.** Kumm n'est ni édité, ni approuvé, ni affilié à la CTS ni à l'Eurométropole de Strasbourg. Le logo et le nom sont propres au projet.

## Mettre en ligne pour le grand public
Sur un VPS : **`docs/DEPLOIEMENT-VPS.md`** (Docker + Caddy, HTTPS automatique, site vitrine sur `kumm.fr`, application sur `app.kumm.fr`). Voir aussi **`docs/MISE-EN-LIGNE.md`** (hébergement, variables, supervision, services à remplacer, liste de contrôle, Play Store) et le modèle **`docs/POLITIQUE-CONFIDENTIALITE.md`**. Le serveur expose `/health` pour la supervision ; son fonctionnement en charge (cache, secours, limites, compression) y est décrit.

## Utiliser ce projet avec votre propre jeton
Le code est publié **sans aucun jeton**. Chaque personne qui fait tourner son propre serveur Kumm doit :
1. créer son compte sur le portail Open Data de la CTS (contact : open-data [at] cts-strasbourg.fr) et générer **son** jeton ;
2. le mettre dans un fichier `.env` (modèle : `.env.example`). Ce fichier n'est jamais publié (`.gitignore`).
Les adresses des API (CTS, OpenStreetMap, Transitous…) ne sont pas des secrets : seul le jeton l'est.

## Publier ou contribuer sans rien divulguer
- Ne mettez **jamais** de jeton dans le code, un fichier d'exemple, une capture d'écran ou un message de commit. Le jeton vit dans `.env` (poste local) ou dans les variables d'environnement de l'hébergeur.
- Avant chaque publication : `npm run check:secrets` (cherche jetons, clés privées et fichiers sensibles ; code de sortie 1 si quelque chose est trouvé).
- Si un jeton a été publié, même quelques minutes : **supprimez-le sur le portail CTS et générez-en un nouveau**. Effacer le fichier ou le commit ne suffit pas, l'historique reste lisible.
- Sur GitHub : Settings → Code security → activez *Secret scanning* et *Push protection*.
- Un serveur public est protégé par une **limite de requêtes par adresse** (`RATE_LIMIT_PER_MIN`, 240 par défaut) et ne relaie qu'une liste fixe de services. La page `/diag` n'existe que si `ENABLE_DIAG=1` : ne l'activez pas sur un serveur public.
- Un APK contient l'adresse de votre serveur (jamais le jeton) : n'importe qui peut la lire. Publiez votre APK seulement si votre serveur est prêt à être utilisé par d'autres, ou laissez chacun compiler le sien avec sa propre adresse.

## Licences et données
Le code est sous licence MIT (fichier `LICENSE`). Les données gardent leurs conditions : horaires et arrêts CTS (conditions du portail Open Data CTS), parkings et Vélhop (Licence Ouverte), cartes et marche à pied © contributeurs OpenStreetMap (ODbL, attribution obligatoire), trajets Transitous. Les tuiles du serveur public d'OpenStreetMap sont réservées à un usage modéré : pour une large diffusion, utilisez un fournisseur de tuiles dédié.

## Structure

```
shared/   types communs (arrêt, passage, réponses de l'API CTS)
server/   relais vers l'API CTS : token caché, cache, nouvelles tentatives
web/      l'application (écrans, carte, API) — compilée par Vite
```

## Installer et lancer (une seule fois, puis à chaque session)
Node 20.6 ou plus récent. Dans PowerShell, utilisez `npm.cmd` si `npm` est bloqué.

1. `npm.cmd install`
2. `copy .env.example .env`, puis ouvrez `.env` et collez votre token CTS (un nouveau, de préférence)
3. **Mode développement** : `npm.cmd run dev` puis ouvrez http://localhost:5173 (la page se recharge à chaque modification)
4. **Mode "production"** : `npm.cmd run build` puis `npm.cmd start`, et ouvrez http://localhost:3000

Mode démo sans API : ajoutez `?mock` à l'adresse.

## Application Android (APK)
L'APK est l'application Kumm dans un habillage Android (Capacitor). Elle ne contient **pas** le jeton CTS : elle parle à *votre serveur Kumm* (celui de ce projet), qui garde le jeton. Il faut donc un serveur joignable depuis le téléphone.

### 1. Dire à l'APK où est le serveur
Éditez `web/.env.android` (une seule ligne) :
- **Test chez vous** (PC et téléphone sur le même Wi-Fi) : `VITE_API_BASE=http://192.168.1.25:3000` avec l'adresse de votre PC (commande `ipconfig`, ligne « Adresse IPv4 »). Lancez le serveur avec `npm.cmd run build` puis `npm.cmd start`, et autorisez le port 3000 dans le pare-feu Windows si demandé.
- **Partout** : hébergez le serveur en ligne (le `Dockerfile` fourni convient à la plupart des hébergeurs ; donnez le jeton dans la variable `CTS_TOKEN` chez l'hébergeur), puis `VITE_API_BASE=https://kumm.mondomaine.fr`. Avec un serveur en https, mettez `allowMixedContent: false` dans `capacitor.config.ts` et `usesCleartextTraffic="false"` dans `android/app/src/main/AndroidManifest.xml`.

### 2. Compiler l'APK
**Avec Android Studio** (gratuit, développeur.android.com/studio ; il contient le JDK 21 nécessaire) :
1. `npm.cmd install`
2. `npm.cmd run build:android` (compile la page et la copie dans le projet Android)
3. `npm.cmd run android:open` (ouvre le projet dans Android Studio ; premier chargement : plusieurs minutes)
4. Menu **Build → Build Bundle(s) / APK(s) → Build APK(s)**. Le fichier est `android/app/build/outputs/apk/debug/app-debug.apk`.

**Sans rien installer, avec GitHub** : mettez le projet (sans `.env`) dans un dépôt GitHub, créez la variable `KUMM_API_BASE` (Settings → Secrets and variables → Actions → Variables), puis onglet Actions → « APK Android » → Run workflow. L'APK est dans les fichiers produits (« kumm-apk »).

### 3. Installer sur le téléphone
Copiez `app-debug.apk` sur le téléphone, ouvrez-le et autorisez « installer des applications inconnues » quand Android le demande. Au premier lancement, acceptez la localisation.

### Alertes trafic (notifications)
Réglages → « Alertes trafic » : une notification pour chaque nouvelle perturbation sur les lignes choisies (option : travaux et changements prévus). Sur Android, `web/public/runners/alerts.js` (module Capacitor Background Runner) vérifie `/api/messages` environ toutes les 15 minutes, même application fermée, sans service de notifications push (pas de Firebase). Certains téléphones bloquent les tâches en arrière-plan : voir dontkillmyapp.com. Le workflow retire la permission de localisation en arrière-plan que ce module demande par défaut. Version web : notifications du navigateur, seulement tant que la page est ouverte.

### Icône et écran de démarrage
Les icônes Android (toutes tailles, icône adaptative Android 8+) et l'écran de démarrage sont dans `android-res/`, dessinés d'après le logo par `python3 scripts/build-android-icons.py` (Pillow). Le workflow les copie dans le projet Android ; en local, après `npx cap add android` : `cp -r android-res/. android/app/src/main/res/`.

### Signature : installer chaque version par-dessus la précédente
Android n'accepte une mise à jour que si elle est signée avec **la même clé** que la version installée. Le workflow « APK Android » signe l'APK avec la clé de l'application si ces deux secrets existent (Settings → Secrets and variables → Actions → **Secrets** → New repository secret) :
- `KUMM_KEYSTORE_B64` : le fichier de clé `kumm-release.jks` encodé en base64 (sur Linux : `base64 -w0 kumm-release.jks`) ;
- `KUMM_KEYSTORE_PASSWORD` : son mot de passe (alias de la clé : `kumm`).
Le numéro de version Android augmente à chaque compilation. Sans ces secrets, l'APK est signé « debug » et il faut désinstaller l'ancienne version avant d'installer la nouvelle.
**Gardez une copie de la clé et du mot de passe hors de GitHub** (gestionnaire de mots de passe) : une clé perdue oblige tous les utilisateurs à désinstaller l'application, et ne se remplace pas. Ne la mettez jamais dans le dépôt (`*.jks` est exclu par `.gitignore`).

Notes : pour le Play Store il faudra un fichier `.aab` (même clé). À chaque modification du code : `npm.cmd run build:android`, puis recompiler. Le bouton « retour » d'Android ferme le guidage, une fiche, puis revient à l'accueil.

## Logo et installation sur téléphone
Le logo est un « K » dessiné comme une ligne de plan de transport (barre blanche, branches jaune et bleue), avec un rond d'arrêt à chaque extrémité (« Kumm » = « viens » en alsacien). Fichiers dans `web/public/` : `favicon.svg` (logo vectoriel, modifiable), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `manifest.webmanifest`. Une variante rouge / bleu / violet est fournie à part. Dans l'en-tête, le logo est l'icône `kumm` de `web/src/icons.ts` (il prend la couleur du thème).
Pour installer l'app sur un téléphone : ouvrez-la dans le navigateur, puis « Ajouter à l'écran d'accueil » (l'icône Kumm apparaît).

## Personnalisation
Réglages (bouton à curseurs en haut de l'accueil, ou la roue de la carte) : 4 thèmes (Automatique, Menthe clair, Forêt sombre, Contraste élevé), 5 couleurs principales (vert par défaut, turquoise, bleu, violet, rouge) et la carte sombre avec les thèmes sombres. Le choix est gardé sur l'appareil.
Pour ajouter une couleur ou un thème : tout est dans `web/src/style.css` (variables en haut du fichier) et `web/src/themes.ts` (listes proposées dans les réglages).

## Comment un arrêt est classé tram / bus / TER
Par son **nom**, d'après des listes trouvées sur internet (fichier `web/src/network.ts`) :
- stations de tram : index des stations du plan du tramway de Strasbourg (version du 19 janvier 2026) + les stations de la ligne F prolongée vers Wolfisheim citées par la CTS ;
- gares TER : les 13 gares de l'Eurométropole de la FAQ officielle de la CTS.
Un arrêt absent des listes est un arrêt de bus. L'écriture n'a pas d'importance (accents, majuscules, tirets, « / » sont ignorés).
Si une station de tram s'affiche comme un bus, ajoutez son nom dans `TRAM_STATIONS`. Pour trouver les oublis, dans la console du navigateur (F12) :

    __kumm.STOPS.filter(s => __kumm.kindOfStop(s)==="bus" && s.lines.some(l => /^[A-F]$/.test(l))).map(s => s.name)

## La carte « À proximité »
Avec les vraies données, c'est une vraie carte OpenStreetMap (zoom et déplacement au doigt ou à la souris) : chaque arrêt est placé à ses coordonnées réelles. Seuls les repères visibles à l'écran sont dessinés (300 arrêts au plus). Le bouton cible recentre sur votre position. En mode démo (`?mock`), un dessin schématique est conservé.
Si la zone reste grise avec un message « Fond de carte indisponible », votre réseau n'atteint pas `tile.openstreetmap.org` : les arrêts restent affichés mais sans fond.
Les fonds de carte viennent des serveurs publics d'OpenStreetMap, faits pour un usage modéré : pour une vraie mise en ligne, il faudra un fournisseur de tuiles dédié.

## Sources des données (tout est référencé ici)
| Donnée | Source |
|---|---|
| Arrêts, lignes, passages en direct | API CTS (`api.cts-strasbourg.eu`, SIRI Lite) |
| Parkings relais (12) : positions, capacités | Eurométropole de Strasbourg, open data (data.strasbourg.eu : « parkings » et « occupation en temps réel des parkings », Licence Ouverte) ; liste des 12 sites confirmée par la page « Park-and-Ride » de cts-strasbourg.eu |
| Places libres des P+R | jeu « occupation-parkings-temps-reel » (mise à jour toutes les 3 minutes) |
| Stations Vélhop + vélos disponibles | flux GBFS `gbfs.nextbike.net/maps/gbfs/v2/nextbike_ae/fr/` (jeu « VLS Vélhop Strasbourg » sur transport.data.gouv.fr, Licence Ouverte 2.0) |
| Véloparks | page « Véloparcs CTS (P+V) » de cts-strasbourg.eu (sites, placés sur les arrêts du même nom) ; VéloParcs Gare et Sainte-Aurélie : strasbourg.eu « Où garer son vélo à Strasbourg ? » |
| Stations de tram | index du plan du tramway de Strasbourg v2.12 (cartometro.com) + avis CTS (ligne F prolongée) |
| Gares TER | FAQ de la CTS : les 13 gares de l'Eurométropole |
| Fonds de carte, marche à pied | © contributeurs OpenStreetMap (tuiles relayées par le serveur ; routage `routing.openstreetmap.de`) |
| Adresses | Base Adresse Nationale (`api-adresse.data.gouv.fr`) |
| Trajets avec correspondances | Transitous / MOTIS (`api.transitous.org`) |
| Tracés des lignes (véhicules sur la carte) | © contributeurs OpenStreetMap (ODbL) : itinéraires CTS extraits par `npm run build:shapes` dans `data/shapes.json` (à relancer quand le réseau change) |
| Carte 3D du guidage | OpenFreeMap (`tiles.openfreemap.org`, tuiles vectorielles OpenMapTiles, © contributeurs OpenStreetMap), affichée avec MapLibre GL ; repli sur la carte 2D si le téléphone ne sait pas l'afficher |
Pas encore branchés : Flex'hop (zones de transport à la demande) ; les gares TER n'ont pas de position dans cette version.

## Carte : catégories de points
Chaque catégorie a sa couleur, sa forme et son symbole : Tram (cercle bleu), Bus (carré turquoise), Vélhop (cercle vert), Vélopark (losange vert foncé, « P »), P+R (hexagone bleu), Flex'hop (écusson rose) et Gare TER (octogone violet). Les boutons en haut de la carte affichent ou masquent chaque catégorie.

Sources de données réelles :
- **Tram / bus / gares TER** : liste d'arrêts de la CTS. Un arrêt est classé « TER » si sa ligne commence par `TER` ou `RER`.
- **P+R et Vélopark** : endpoints `park-and-ride` et `veloparc` de l'API CTS.
- **Vélhop et Flex'hop** : pas encore branchés (le bouton est grisé et l'indique).
Si une catégorie reste vide, ouvrez `http://localhost:3000/api/veloparc` (ou `park-and-ride`) et regardez ce que renvoie la CTS.

## Itinéraires avec correspondances
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

## Sécurité
- Le token reste dans `.env`, côté serveur. Ne le publiez jamais (`.gitignore` l'exclut).
- Les textes venant de l'API sont échappés avant affichage.
