# Mettre Kumm en ligne sur votre VPS (kumm.fr)

Résultat : `https://kumm.fr` affiche le site vitrine (dossier `site/`) et **`https://app.kumm.fr` sert l'application et le serveur** (l'adresse que l'APK Android utilisera), avec certificats HTTPS automatiques, redémarrage automatique et mises à jour en une commande. Pourquoi deux adresses : le nom principal reste libre pour un site de présentation, la politique de confidentialité, les mentions légales ou tout autre site (voir « Héberger d'autres sites » plus bas).
Le jeton CTS reste dans un fichier `.env` **sur le serveur** (jamais dans GitHub ni dans l'application).

Ce qu'il vous faut : l'adresse IP du VPS, un accès SSH (utilisateur et mot de passe ou clé) et l'accès au DNS de kumm.fr chez votre bureau d'enregistrement.
Système recommandé : **Ubuntu Server 26.04 LTS** (supportée jusqu'en 2031) ou **24.04 LTS** (jusqu'en 2029) ; Debian stable convient aussi. Les commandes sont écrites pour **Debian ou Ubuntu**. « PC » = votre ordinateur Windows (PowerShell), « VPS » = le serveur.

## 1. Pointer kumm.fr vers le VPS (chez le bureau d'enregistrement)
Dans la zone DNS de kumm.fr, créez :
| Type | Nom | Valeur |
|---|---|---|
| A | `@` (ou kumm.fr) | l'adresse IPv4 du VPS |
| A | `www` | la même adresse IPv4 |
| A | `app` | la même adresse IPv4 |
| AAAA | `@` et `www` | l'adresse IPv6 du VPS, **seulement si** le VPS en a une et qu'elle fonctionne |
Supprimez les anciens enregistrements A/AAAA « de parking » du registrar. Comptez de quelques minutes à quelques heures. Test depuis le PC : `nslookup kumm.fr` et `nslookup app.kumm.fr` doivent afficher l'adresse du VPS.

## 2. Préparer le VPS (une seule fois)
Sur le PC : `ssh root@ADRESSE_IP` (ou l'utilisateur donné par l'hébergeur). Puis sur le VPS :
```
apt update && apt -y upgrade
apt -y install sudo ufw unzip curl unattended-upgrades
adduser kumm                      # choisissez un mot de passe solide
usermod -aG sudo kumm
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
dpkg-reconfigure -plow unattended-upgrades   # mises à jour de sécurité automatiques (répondre Oui)
```
Ouvrez ensuite une **deuxième** fenêtre et vérifiez que `ssh kumm@ADRESSE_IP` fonctionne avant de fermer la première. Recommandé ensuite : connexion par clé SSH et mot de passe désactivé (documentation de votre hébergeur).

## 3. Installer Docker (sur le VPS, en tant que `kumm`)
On utilise le dépôt officiel de Docker (la méthode recommandée pour un serveur ; le script « get.docker.com » est réservé aux essais). Les mêmes commandes valent pour Ubuntu 22.04, 24.04 et 26.04 et pour Debian :
```
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
. /etc/os-release
sudo curl -fsSL https://download.docker.com/linux/$ID/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker kumm
```
Déconnectez-vous puis reconnectez-vous (`exit`, puis `ssh kumm@ADRESSE_IP`). Test : `docker --version`, `docker compose version`, puis `docker run --rm hello-world`.
Si `apt update` signale une erreur sur le dépôt Docker, vérifiez `cat /etc/apt/sources.list.d/docker.sources` : la ligne `Suites:` doit afficher le nom de votre version (par exemple `noble` ou `resolute`).

## 4. Envoyer le projet
Sur le PC, dans le dossier où se trouve l'archive :
```
scp kumm-serveur-v0.10.4.zip kumm@ADRESSE_IP:~/
```
Sur le VPS :
```
mkdir -p ~/kumm && cd ~/kumm
unzip -o ../kumm-serveur-v0.10.4.zip
rm ../kumm-serveur-v0.10.4.zip
```
L'archive « serveur » ne contient **aucun secret** : le jeton sera saisi sur le VPS (étape suivante).

## 5. Créer le fichier de réglages de production
```
cd ~/kumm
cp .env.production.example .env
nano .env
```
Remplacez `colle-ton-token-ici` par votre jeton CTS et vérifiez `GEO_USER_AGENT` (mettez une vraie adresse de contact). Enregistrez avec Ctrl+O, Entrée, puis quittez avec Ctrl+X. `chmod 600 .env` limite la lecture du fichier à votre utilisateur. Vous ne refaites cette étape qu'une fois : les mises à jour ne touchent pas à ce fichier.

## 6. Lancer
```
docker compose up -d --build
```
La première fois : 3 à 6 minutes (compilation). Ensuite :
```
docker compose ps                 # les deux services doivent être « running » (kumm : « healthy »)
docker compose logs -f kumm       # journal de Kumm (Ctrl+C pour quitter)
docker compose logs caddy         # certificat HTTPS
```

## 7. Vérifier
- `https://app.kumm.fr/health` affiche `"ok": true` et la version. Dans la rubrique `cts`, `arrets_connus` doit être un nombre (la liste des arrêts a bien été chargée au démarrage) ; s'il vaut `null`, regardez `docker compose logs kumm` : la CTS n'a pas répondu au démarrage (le service fonctionne quand même, sans filtrage, et se corrige seul à la prochaine actualisation).
- `https://app.kumm.fr` affiche l'application ; ouvrez-la sur le téléphone. `https://kumm.fr` affiche le site vitrine.
- Cadenas HTTPS présent ; `http://kumm.fr` et `http://app.kumm.fr` redirigent vers `https://` ; `https://www.kumm.fr` redirige vers `https://kumm.fr`.
Si le certificat n'arrive pas : le DNS n'est pas encore propagé, ou les ports 80 et 443 sont fermés (chez l'hébergeur ou dans `ufw`). Relancez ensuite `docker compose restart caddy`.

## 8. Supervision et sauvegarde
- Créez une surveillance gratuite (UptimeRobot, Better Stack…) sur `https://app.kumm.fr/health`, avec alerte par e-mail.
- Seul le fichier `.env` est irremplaçable : gardez-en une copie ailleurs (gestionnaire de mots de passe). Les certificats se régénèrent seuls.

## 9. Mettre à jour (à chaque nouvelle version)
Envoyez la nouvelle archive « serveur » comme à l'étape 4 (`unzip -o` par-dessus `~/kumm` : votre `.env` est conservé, car l'archive n'en contient pas), puis :
```
cd ~/kumm && docker compose up -d --build
```
Retour en arrière : redéployez l'archive précédente.

## 10. L'APK Android
Dans le dépôt GitHub, fichier `web/.env.android` : `VITE_API_BASE=https://app.kumm.fr`. Relancez la compilation de l'APK (Actions). Avec une adresse en https, l'APK de production n'accepte que le HTTPS.

## 11. Héberger d'autres sites sur kumm.fr
Oui, c'est possible, et le VPS (6 vCPU, 12 Go) a largement la place. Le principe : **un nom par site**, tous traités par le même Caddy.
1. **DNS** : un enregistrement A par nom (`blog`, `docs`…), vers l'adresse du VPS.
2. **Un bloc dans `deploy/Caddyfile`** :
   - site de fichiers fixes (HTML, CSS, images) : `blog.kumm.fr { root * /srv/blog` puis `file_server }` et un volume `./blog:/srv/blog:ro` dans `docker-compose.yml` ;
   - application tournant dans un autre conteneur : `blog.kumm.fr { reverse_proxy autre-service:PORT }`, avec ce service ajouté dans `docker-compose.yml`.
3. `docker compose up -d` : Caddy obtient seul le certificat du nouveau nom.
À savoir : un site de fichiers fixes ne demande presque aucun entretien. Un site « dynamique » (WordPress, base de données…) demande des mises à jour de sécurité régulières ; chaque site public augmente la surface d'attaque du serveur qui porte aussi Kumm. Pour une adresse e-mail en `@kumm.fr`, prenez plutôt un service de messagerie dédié que d'installer un serveur de mail sur ce VPS (la délivrabilité des messages y est difficile).
Le site vitrine fourni (`site/index.html`) est une page unique, sans service externe ; ajoutez-y vos pages (mentions légales, politique de confidentialité, contact) en copiant des fichiers dans `site/` : ils sont servis immédiatement, sans redémarrage.

## 12. Ensuite : se passer des services partagés
Votre VPS (6 vCPU, 12 Go) peut héberger les services gratuits dont dépend Kumm, pour ne plus dépendre d'infrastructures communautaires : **calcul de marche à pied** (OSRM ou Valhalla avec les données OpenStreetMap d'Alsace), **calcul des trajets** (MOTIS avec les horaires GTFS de la CTS, si votre accord le permet) et **tuiles de carte**. Le serveur est déjà prêt à les utiliser (variables `GEO_WALK_BASE`, `TRANSIT_BASE`, `TILE_BASE`) ; voir `MISE-EN-LIGNE.md`.

## 13. Alertes trafic (notifications push, Firebase)
1. **Projet Firebase** (gratuit) : https://console.firebase.google.com → « Créer un projet » (Google Analytics inutile).
2. **Application Android** : dans le projet, « Ajouter une application » → Android → nom du package `fr.kumm.app` → télécharger **`google-services.json`**. Sur GitHub : Settings → Secrets and variables → Actions → **Secrets** → `GOOGLE_SERVICES_JSON` = tout le contenu du fichier. Recompiler l'APK.
3. **Clé du serveur** : Paramètres du projet (roue dentée) → **Comptes de service** → « Générer une nouvelle clé privée » (fichier JSON). Sur le VPS :
```
mkdir -p ~/kumm/secrets && nano ~/kumm/secrets/firebase.json      # coller tout le contenu du fichier, Ctrl+O, Entrée, Ctrl+X
chmod 600 ~/kumm/secrets/firebase.json
cd ~/kumm && docker compose up -d --force-recreate kumm
docker compose logs kumm | grep "Alertes push"                   # « actives (projet …) »
```
Cette clé permet d'envoyer des notifications à vos utilisateurs : ne la publiez jamais (le dossier `secrets/` est exclu du dépôt et de l'image).

## Mises à jour automatiques (serveur et application Android)
Le script `deploy/kumm-update.sh` du dépôt, lancé toutes les 5 minutes par le minuteur `kumm-update.timer` :
- met le serveur à jour depuis `main` (retour à l'ancienne version si la nouvelle ne répond pas) ;
- copie dans `~/kumm/apk/` le dernier APK signé publié par GitHub (branche `apk`) : l'application le propose au lancement et l'installe elle-même.

Une seule fois, pour que le minuteur utilise le script du dépôt (il suivra ensuite tout seul ses évolutions) :
```
printf '#!/usr/bin/env bash\nexec bash /home/kumm/kumm/deploy/kumm-update.sh\n' > ~/kumm-update.sh
sudo systemctl start kumm-update.service && journalctl -u kumm-update -n 20     # « APK : version … disponible »
```
Publier une version pour les téléphones : Actions → « APK Android » → Run workflow (case « Proposer cette version aux téléphones » cochée).
Vérification : `https://app.kumm.fr/app/latest.json`, ou la partie `apk` de `/health`.

## Dépannage rapide
| Symptôme | Piste |
|---|---|
| `docker: permission denied` | reconnectez-vous après `usermod -aG docker` |
| Pas de certificat | `nslookup kumm.fr` ; ports 80/443 ouverts ; `docker compose logs caddy` |
| 502 / page blanche | `docker compose logs kumm` ; le jeton est-il bien dans `.env` ? |
| `"cts": {"en_pause": true}` dans /health | la CTS ne répond pas depuis ce serveur (pare-feu, blocage de l'adresse) : prévenez la CTS avec l'adresse du VPS |
| Application lente | `docker stats` ; `/health` (compteurs, cache) |
