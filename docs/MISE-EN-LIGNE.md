# Mettre Kumm en ligne pour le grand public

Ce guide dit **quoi décider, quoi configurer et quoi vérifier** avant d'ouvrir Kumm à tout le monde. Ce qui est déjà fait dans le code est indiqué ; le reste dépend de vos choix (hébergeur, services, textes juridiques).

## 1. Ce que le serveur fait déjà pour tenir la charge
- **Cache et regroupement** : mille personnes qui demandent le même arrêt provoquent un seul appel à la CTS (réponses gardées jusqu'à l'heure `ValidUntil` indiquée par la CTS).
- **Panne de la CTS** : les passages « en direct » sont resservis au plus `STALE_REALTIME_S` secondes (jamais d'horaires périmés) ; la liste des arrêts et des lignes jusqu'à 24 h. Après une coupure réseau, le serveur fait une pause de 2 minutes avant de rappeler (disjoncteur).
- **Protection du jeton et de votre quota CTS** : seules les adresses prévues sont relayées, avec leurs seuls paramètres ; limite de requêtes par visiteur ; **plafond global d'appels vers la CTS** (`CTS_BUDGET_PER_MIN`, 1500 par défaut) ; file d'attente bornée (« serveur saturé » plutôt que de tout bloquer) ; cache borné en mémoire.
- **Anti-énumération** : la liste officielle des arrêts est chargée au démarrage. Un code d'arrêt absent de cette liste est toléré (au cas où elle serait incomplète) mais limité (`UNKNOWN_REF_PER_MIN`, 60 par minute pour tous) et jamais gardé en mémoire : on ne peut ni parcourir des milliers de codes inventés pour faire partir des appels vers la CTS, ni vider le cache des vraies données.
- **Préchargement** : la liste des arrêts et des lignes est chargée à l'avance et renouvelée avant son expiration : le premier visiteur n'attend pas.
- **Légèreté** : compression gzip (la liste des arrêts passe de ~500 Ko à ~40 Ko) ; fichiers de l'application gardés un an par le téléphone.
- **Robustesse** : adresses malformées sans plantage, arrêt propre, délais de connexion, en-têtes de sécurité, `/health` pour la supervision.
- **Vie privée** : le journal ne contient ni adresse IP, ni positions, ni adresses saisies.

## 1 bis. Ce qui a été mesuré, et ce qui ne l'a pas été
**Mesuré** (machine de test, un seul processus Node, serveur CTS simulé) : environ 5 000 réponses par seconde pour les données gardées en mémoire (passages, listes, tuiles de carte), 60 Mo de mémoire au repos et environ 150 Mo après 30 000 demandes différentes, aucune erreur. L'application se charge compressée (≈ 60 Ko pour le script, ≈ 40 Ko pour la liste des arrêts). 71 vérifications automatiques couvrent les pannes de la CTS, la saturation, les adresses piégées, le plafond d'appels et le filtrage des arrêts.
**Non mesuré, à vérifier chez vous** : le comportement avec la vraie API de la CTS sous un vrai trafic (ses délais, ses quotas, ses erreurs), la construction de l'image Docker et la délivrance du certificat HTTPS sur votre VPS, la qualité des services partagés sous charge (cartes, marche à pied, trajets), et le comportement des téléphones sur réseau mobile faible.
**Limites connues** : un seul serveur (en cas de panne de la machine, le service s'arrête ; un plantage du programme, lui, redémarre seul) ; Docker signale un conteneur « unhealthy » mais ne le redémarre pas : une supervision externe est donc nécessaire (§4) ; le cache est en mémoire, donc vide après un redémarrage (rempli en quelques secondes par les premières demandes) ; le serveur n'utilise qu'un cœur de processeur, ce qui suffit largement ici (les autres cœurs restent libres pour héberger d'autres services, §5).

## 2. Choisir un hébergeur
Critères : **toujours allumé** (les offres gratuites qui s'endorment ne conviennent pas : le premier visiteur attendrait 30 secondes), HTTPS automatique avec votre nom de domaine, variables d'environnement secrètes, serveur en Europe, redémarrage automatique. Le `Dockerfile` fourni convient à la plupart (Fly.io, Render, Railway, Scaleway, OVHcloud, Hetzner…). Les prix et offres changent : comparez au moment du choix.
Un seul petit serveur suffit pour démarrer : l'essentiel du trafic est servi depuis la mémoire.
Organisation des noms : `kumm.fr` = site vitrine et pages légales, `app.kumm.fr` = application et serveur Kumm (l'adresse de l'APK). Voir `DEPLOIEMENT-VPS.md`.

## 3. Variables d'environnement à définir chez l'hébergeur
| Variable | Valeur |
|---|---|
| `CTS_TOKEN` | votre jeton CTS (**secret**, jamais dans le dépôt) |
| `TRUST_PROXY` | `1` **seulement si un proxy est devant le serveur** (hébergeur, Caddy…) ; déjà mis par `docker-compose.yml`. Sans proxy, laissez-le vide : sinon chacun pourrait choisir son adresse et contourner la limite de requêtes |
| `GEO_USER_AGENT` | `Kumm/1.0 (contact@votre-domaine.fr)` : **un vrai contact**, exigé par OpenStreetMap et courtois envers les autres services |
| `CORS_ORIGINS` | `https://localhost,capacitor://localhost` (l'application Android) |
| `RATE_LIMIT_PER_MIN` | 240 par défaut ; baissez si besoin |
| `CTS_BUDGET_PER_MIN` | 1500 par défaut : **à régler avec les quotas donnés par la CTS** |
| `UNKNOWN_REF_PER_MIN` | 60 par défaut ; `VALIDATE_STOP_REFS=0` désactive ce filtrage si des arrêts valables étaient refusés |
| `MIN_APP_VERSION` | `0.0.0` ; à relever seulement après une évolution incompatible |
| `ENABLE_DIAG` | **ne pas définir** sur un serveur public |

## 4. Supervision
- Créez une surveillance (UptimeRobot, Better Stack… offres gratuites existent) sur `https://app.kumm.fr/health` : alerte par e-mail si le serveur ne répond plus.
- Lisez le contenu de `/health` : `cts.en_pause` (la CTS ne répond plus), `cts.appels_derniere_minute` face à `cts.plafond_par_minute` (si vous approchez du plafond en permanence, relevez-le avec l'accord de la CTS), `cts.refuses_plafond`, `cts.arrets_connus` (nombre de codes d'arrêt chargés : `null` veut dire que la liste n'a pas pu être chargée), `cts.arrets_inconnus_refuses`, `requetes.erreurs_5xx`, `requetes.refusees_429`, `cache.secours` (réponses servies en secours).

## 5. Services partagés à remplacer avant un lancement large
Plusieurs services utilisés par Kumm sont **gratuits, communautaires et à usage modéré**. Pour un grand public, remplacez-les par des services dédiés ; le serveur le prévoit (variables d'environnement) et l'application n'a rien à changer.
| Service | Aujourd'hui | Pour un usage large |
|---|---|---|
| Fonds de carte | tuiles du serveur public d'OpenStreetMap | fournisseur dédié (`TILE_BASE`, `TILE_QUERY`) ou tuiles auto-hébergées |
| Marche à pied | `routing.openstreetmap.de` (public, sans garantie) | OSRM, Valhalla ou OpenRouteService auto-hébergé ou payant (`GEO_WALK_BASE`) |
| Trajets en transports | Transitous (communautaire, sans garantie) | MOTIS auto-hébergé avec les horaires GTFS de la CTS (`TRANSIT_BASE`), si votre accord le permet |
| Adresses | Base Adresse Nationale (service public) | convient, en vous identifiant (`GEO_USER_AGENT`) |
| Vélhop | flux GBFS nextbike (public) | convient |
| Parkings relais | open data de l'Eurométropole | convient (réponses gardées 2 minutes) |
| CTS | votre jeton | **demandez à la CTS vos quotas** et les conditions de mise en cache |

## 6. Avant d'ouvrir au public (liste de contrôle)
- [ ] **Accord CTS** : relire les conditions (quotas, mise en cache, attribution, usage du nom « CTS », obligation de mention).
- [ ] **Politique de confidentialité** publiée sur une adresse web (modèle : `POLITIQUE-CONFIDENTIALITE.md`, à adapter) et lien dans l'application et sur la fiche du magasin.
- [ ] **Mentions légales** : éditeur, contact, hébergeur.
- [ ] `GEO_USER_AGENT` avec une vraie adresse de contact.
- [ ] `npm run check:secrets` propre ; jeton uniquement chez l'hébergeur.
- [ ] Supervision `/health` active, avec alerte.
- [ ] Service gratuit remplacé là où vous attendez beaucoup de visiteurs (§5).
- [ ] Test sur plusieurs téléphones (Android récent et ancien, petit écran, hors ligne, localisation refusée).

## 7. Faire évoluer sans casser les anciennes applications
Des téléphones garderont longtemps une ancienne version : **ne supprimez et ne changez jamais** le comportement des adresses `/api`, `/geo`, `/poi`, `/tiles`, `/health` ; ajoutez-en de nouvelles. Si une évolution devient vraiment incompatible, relevez `MIN_APP_VERSION` : les anciennes versions affichent alors « mise à jour nécessaire ».

## 8. Publier sur le Play Store (plus tard)
Compte développeur Google Play (frais d'inscription à vérifier), une **clé de signature à sauvegarder à plusieurs endroits** (la perdre empêche toute mise à jour), un fichier `.aab` signé, la fiche (description, captures, icône), l'adresse de la politique de confidentialité et le formulaire « sécurité des données » (la localisation est utilisée et transmise au serveur pour les itinéraires). L'APK de test de GitHub est signé « debug » : il ne peut pas être publié tel quel.
