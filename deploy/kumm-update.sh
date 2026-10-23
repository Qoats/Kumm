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
  update_server
}

update_apk() {
  git fetch -q origin apk 2>/dev/null || return 0          # pas encore d'APK publié
  local rev; rev=$(git rev-parse origin/apk)
  [ "$rev" = "$(cat apk/.rev 2>/dev/null)" ] && return 0
  mkdir -p apk
  # dossier créé par Docker (propriétaire root) avant le premier passage de ce script : on le reprend
  [ -w apk ] || docker run --rm -v "$PWD/apk:/d" node:22-alpine chown "$(id -u):$(id -g)" /d
  # l'APK d'abord, latest.json ensuite : l'application ne voit la nouvelle version qu'une fois le fichier complet
  git show origin/apk:kumm.apk > apk/kumm.apk.tmp && git show origin/apk:latest.json > apk/latest.json.tmp || { rm -f apk/*.tmp; return 0; }
  local want; want=$(sed -n 's/.*"sha256":"\([0-9a-f]*\)".*/\1/p' apk/latest.json.tmp)
  if [ "$(sha256sum apk/kumm.apk.tmp | cut -d' ' -f1)" != "$want" ]; then echo "APK : empreinte incorrecte, ignoré"; rm -f apk/*.tmp; return 0; fi
  mv apk/kumm.apk.tmp apk/kumm.apk && mv apk/latest.json.tmp apk/latest.json && echo "$rev" > apk/.rev
  echo "APK : version $(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' apk/latest.json) disponible pour l'application"
}

update_server() {
  git fetch -q origin main || exit 1
  local old new; old=$(git rev-parse HEAD); new=$(git rev-parse origin/main)
  [ "$old" = "$new" ] && exit 0
  [ "$new" = "$(cat ~/.kumm-echec 2>/dev/null)" ] && exit 0   # version déjà essayée et en échec : on attend la suivante
  echo "Mise à jour ${old:0:7} -> ${new:0:7}"
  git reset -q --hard "$new"
  if docker compose up -d --build && sleep 60 && curl -fsS -m 10 https://app.kumm.fr/health > /dev/null; then
    echo "OK : version ${new:0:7} en ligne"
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

main "$@"
exit
