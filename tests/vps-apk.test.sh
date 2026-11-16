#!/usr/bin/env bash
set -euo pipefail

# Test d'intégration local avec un dépôt de publication isolé. Aucun accès au VPS.
root=$(cd "$(dirname "$0")/.." && pwd -P)
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
git init -q -b main "$tmp/publication"
commit() {
  git -c user.name=Kumm-test -c user.email=kumm-test@example.invalid commit -qm "$1"
}
cd "$tmp/publication"
git -c user.name=Kumm-test -c user.email=kumm-test@example.invalid commit -q --allow-empty -m "base"
git switch -qc apk
printf 'version-valide\n' > kumm.apk
sha=$(sha256sum kumm.apk | cut -d' ' -f1)
size=$(stat -c%s kumm.apk)
printf '{ "version": "0.52.2", "code": 131, "size": %s, "sha256": "%s" }\n' "$size" "$sha" > latest.json
git add kumm.apk latest.json
commit "Publication valide"
good=$(git rev-parse HEAD)
git clone -q --single-branch --branch main "$tmp/publication" "$tmp/vps"
cd "$tmp/vps"
source "$root/deploy/kumm-update.sh"
update_apk
test "$(cat apk/.rev)" = "$good"
cmp apk/kumm.apk "$tmp/publication/kumm.apk"

cd "$tmp/publication"
printf 'version-altere\n' > kumm.apk
test "$(stat -c%s kumm.apk)" = "$size"
git add kumm.apk
commit "APK corrompu de même taille"
cd "$tmp/vps"
if update_apk; then
  echo "L'APK corrompu aurait dû être refusé" >&2
  exit 1
fi
test "$(cat apk/.rev)" = "$good"
test "$(sha256sum apk/kumm.apk | cut -d' ' -f1)" = "$sha"
test -z "$(find apk -maxdepth 1 -name '.incoming.*' -print)"
echo "La mise à jour VPS conserve l’APK valide après un téléchargement corrompu."
