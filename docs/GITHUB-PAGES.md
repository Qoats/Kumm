# Héberger Kumm sur GitHub Pages (kumm.fr et app.kumm.fr)

Le site n'a plus besoin de serveur : l'application web fait ses calculs dans le navigateur, comme l'application Android, et lit des horaires ouverts qui sont publiés avec elle.

GitHub Pages n'accepte **qu'un seul domaine par dépôt**. Il y a donc deux dépôts, un par adresse :

| Adresse | Contenu | Dépôt | Workflow |
|---|---|---|---|
| `kumm.fr` | le site de présentation (`vitrine/`) | `Qoats/Kumm` (ce dépôt) | `Site de présentation (GitHub Pages)` |
| `app.kumm.fr` | l'application web | [`Qoats/kumm-app`](https://github.com/Qoats/kumm-app) | `Application web (GitHub Pages)` |

`Qoats/kumm-app` ne contient pas de code : son workflow récupère le code public de `Qoats/Kumm`, construit l'application (`npm run build:pages`), y ajoute les horaires et publie le tout. Il n'a besoin d'**aucun secret ni jeton**.

## D'où viennent les données

Uniquement des **données ouvertes** du portail officiel [transport.data.gouv.fr](https://transport.data.gouv.fr) :

- réseau urbain CTS (trams et bus) : horaires théoriques GTFS, [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) ;
- TER : horaires théoriques GTFS de la SNCF, ODbL.

Aucune API de la CTS n'est utilisée (ni SIRI Lite, ni jeton), aucun temps réel. Le script `scripts/fetch-open-data.mjs` interroge l'API du portail, télécharge la copie archivée la plus récente de chaque jeu (adresse permanente hébergée par le portail), vérifie que l'archive est un GTFS valide, puis écrit `data/cts.zip`, `data/ter.zip` et `data/manifest.json` à côté de l'application. Le site les sert lui-même : les navigateurs ne peuvent pas lire directement les serveurs des producteurs (pas d'en-tête CORS), d'où cette copie.

Le workflow de `kumm-app` se relance **chaque jour à 05 h 37 UTC** (nouveaux horaires et dernier code de `Qoats/Kumm`) et à la demande (*Actions → Run workflow*, le champ `ref` permet de construire une autre branche de `Qoats/Kumm`). Si une archive est absente ou invalide, la construction échoue et la version en ligne reste inchangée. L'application relit le manifeste une fois par heure et ne retélécharge une archive que si sa révision a changé.

> Le code fusionné dans `Qoats/Kumm` n'arrive donc sur `app.kumm.fr` qu'au prochain passage du workflow (au plus 24 h), ou tout de suite en le lançant à la main.

L'attribution exigée par les licences figure dans l'application (Réglages → À propos) et dans les mentions légales.

## Mise en route (une seule fois)

### app.kumm.fr (dépôt `Qoats/kumm-app`)
1. Fusionner la pull request de `Qoats/Kumm` qui ajoute le mode statique (`npm run build:pages`).
2. Dans `Qoats/kumm-app` : **Settings → Pages → Build and deployment → Source : GitHub Actions**, puis *Actions → Application web (GitHub Pages) → Run workflow*.
3. **Settings → Pages → Custom domain** : `app.kumm.fr`, puis cocher **Enforce HTTPS** quand GitHub a validé le domaine (quelques minutes à une heure après la mise à jour du DNS).

### kumm.fr (dépôt `Qoats/Kumm`)
1. **Settings → Pages → Source : GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables** : créer `PAGES_ENABLED` = `true`, puis lancer *Actions → Site de présentation (GitHub Pages) → Run workflow*.
3. **Settings → Pages → Custom domain** : `kumm.fr` (le fichier `vitrine/CNAME` le contient déjà), puis **Enforce HTTPS**.

> Tant que le DNS pointe vers l'ancien serveur (VPS), `kumm.fr` et `app.kumm.fr` continuent de fonctionner comme avant. Le changement ne se fait qu'à l'étape DNS ci-dessous.

## DNS

À modifier chez le registrar du domaine `kumm.fr` (la zone actuelle pointe vers le VPS) :

| Nom | Type | Valeur |
|---|---|---|
| `app.kumm.fr` | CNAME | `qoats.github.io` |
| `kumm.fr` (racine) | A | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |
| `kumm.fr` (racine) | AAAA (facultatif) | `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153` |
| `www.kumm.fr` | CNAME | `qoats.github.io` |

À **ne pas toucher** : `relais.kumm.fr` (messagerie Relais, qui reste sur le VPS) et les enregistrements de messagerie (MX, SPF, DKIM) éventuels.

GitHub recommande de [vérifier le domaine](https://docs.github.com/fr/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages) (Settings de l'organisation → Pages) pour éviter qu'un tiers le réclame.

## Revenir au serveur (VPS)

Remettre les enregistrements DNS d'origine (adresse du VPS pour `kumm.fr`, `www.kumm.fr` et `app.kumm.fr`). Le serveur et son `deploy/Caddyfile` n'ont pas été modifiés.

## Limites connues

- **Hors connexion** : les horaires sont gardés dans le navigateur, mais l'application elle-même n'est pas encore mise en cache (pas de service worker) : sans réseau, la page ne se charge pas si elle n'est pas déjà ouverte.
- **Fonds de carte** : les tuiles viennent du serveur public d'OpenStreetMap, prévu pour un usage modéré ([règles d'utilisation](https://operations.osmfoundation.org/policies/tiles/)). Si le site est très fréquenté, prévoir un fournisseur de tuiles dédié.
- Les fonctions qui exigent le temps réel (infos trafic, ponctualité, signalements, disponibilité des vélos) affichent « Bientôt disponible », comme sur Android.

## Essayer en local

```sh
npm run build:pages                       # application + horaires dans dist/pages
node scripts/serve-static.mjs dist/pages  # http://127.0.0.1:4173
node scripts/check-static-site.mjs        # parcours de l'interface dans un navigateur
```
