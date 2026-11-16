#!/usr/bin/env bash
# Met Kumm à jour depuis GitHub, lancé toutes les 5 minutes par le minuteur kumm-update.timer (docs/DEPLOIEMENT-VPS.md) :
# 1. APK Android : copie la dernière version publiée (branche « apk ») dans apk/, d'où le serveur la distribue à l'application ;
# 2. serveur : passe à la dernière version de main ; revient à la précédente si la nouvelle ne répond pas.
# Tout le script est dans une fonction : bash la lit en entier avant de commencer, donc « git reset » peut remplacer ce fichier sans risque.
set -uo pipefail

main() {
  cd "$(dirname "$(readlink -f "$0")")/.." || exit 1
  exec 9>/tmp/kumm-update.lock; flock -n 9 || exit 0
  update_apk
  update_caddy
  update_server
}

# Caddyfile modifié depuis le dernier passage : Caddy redémarre pour le relire (git remplace le fichier, et un conteneur
# déjà lancé garderait l'ancien). Lancé avant update_server, qui s'arrête quand main n'a pas bougé.
update_caddy() {
  local h; h=$(sha256sum deploy/Caddyfile | cut -d' ' -f1)
  [ "$h" = "$(cat ~/.kumm-caddy 2>/dev/null)" ] && return 0
  docker compose restart caddy > /dev/null && echo "$h" > ~/.kumm-caddy && echo "Caddy : configuration rechargée"
}

update_apk() {
  git fetch -q origin refs/heads/apk 2>/dev/null || return 0
  local rev; rev=$(git rev-parse --verify 'FETCH_HEAD^{commit}') || return 1
  [ "$rev" = "$(cat apk/.rev 2>/dev/null)" ] && return 0
  mkdir -p apk || return 1
  # Compose peut avoir créé le dossier monté avec root comme propriétaire.
  [ -w apk ] || docker run --rm -v "$PWD/apk:/d" node:22-alpine chown "$(id -u):$(id -g)" /d || return 1
  stage_apk "$rev"
}

stage_apk() (
  local rev=$1 tmp want size
  tmp=$(mktemp -d 'apk/.incoming.XXXXXX') || exit 1
  trap 'rm -f -- "$tmp/kumm.apk" "$tmp/latest.json" "$tmp/rev"; rmdir -- "$tmp"' EXIT
  git show "$rev:kumm.apk" > "$tmp/kumm.apk" &&
    git show "$rev:latest.json" > "$tmp/latest.json" || exit 1
  want=$(sed -nE 's/.*"sha256"[[:space:]]*:[[:space:]]*"([a-f0-9]{64})".*/\1/p' "$tmp/latest.json")
  size=$(sed -nE 's/.*"size"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$tmp/latest.json")
  if [ "$(stat -c%s "$tmp/kumm.apk")" != "$size" ] || [ "$(sha256sum "$tmp/kumm.apk" | cut -d' ' -f1)" != "$want" ]; then
    echo "APK : taille ou empreinte incorrecte, version ignorée"
    exit 1
  fi
  # Le serveur vérifie la paire. Le marqueur n'avance qu'après les deux fichiers.
  printf '%s\n' "$rev" > "$tmp/rev" &&
    chmod 644 "$tmp/kumm.apk" "$tmp/latest.json" &&
    mv "$tmp/kumm.apk" apk/kumm.apk && mv "$tmp/latest.json" apk/latest.json &&
    mv "$tmp/rev" apk/.rev || exit 1
  echo "APK : version $(sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' apk/latest.json) disponible pour l'application"
)

update_server() {
  git fetch -q origin main || exit 1
  local old new; old=$(git rev-parse HEAD); new=$(git rev-parse origin/main)
  [ "$old" = "$new" ] && exit 0
  [ "$new" = "$(cat ~/.kumm-echec 2>/dev/null)" ] && exit 0   # version déjà essayée et en échec : on attend la suivante
  echo "Mise à jour ${old:0:7} -> ${new:0:7}"
  git reset -q --hard "$new"
  if docker compose up -d --build && sleep 60 && curl -fsS -m 10 https://app.kumm.fr/health > /dev/null; then
    echo "OK : version ${new:0:7} en ligne"
    update_caddy
    rm -f ~/.kumm-echec
    docker image prune -f > /dev/null
  else
    echo "ÉCHEC : retour à ${old:0:7}"
    echo "$new" > ~/.kumm-echec
    git reset -q --hard "$old"
    docker compose up -d --build
    exit 1
  fi
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
