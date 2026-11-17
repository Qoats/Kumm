# Héberger Kumm sur GitHub Pages (kumm.fr et app.kumm.fr)

Le site n'a plus besoin de serveur : l'application web fait ses calculs dans le navigateur, comme l'application Android, et lit des horaires ouverts qui sont publiés avec le site.

| Adresse | Contenu | Dépôt GitHub Pages |
|---|---|---|
| `app.kumm.fr` | l'application web | ce dépôt (`Qoats/Kumm`), workflow `Site web (GitHub Pages)` |
| `kumm.fr` | le site de présentation (`vitrine/`) | un second dépôt, car GitHub Pages n'accepte **qu'un seul domaine par dépôt** (voir plus bas) |

## D'où viennent les données

Uniquement des **données ouvertes** du portail officiel [transport.data.gouv.fr](https://transport.data.gouv.fr) :

- réseau urbain CTS (trams et bus) : horaires théoriques GTFS, [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) ;
- TER : horaires théoriques GTFS de la SNCF, ODbL.

Aucune API de la CTS n'est utilisée (ni SIRI Lite, ni jeton), aucun temps réel. Le script `scripts/fetch-open-data.mjs` interroge l'API du portail, télécharge la copie archivée la plus récente de chaque jeu (adresse permanente hébergée par le portail), vérifie que l'archive est un GTFS valide, puis écrit `data/cts.zip`, `data/ter.zip` et `data/manifest.json` à côté de l'application. Le site les sert lui-même : les navigateurs ne peuvent pas lire directement les serveurs des producteurs (pas d'en-tête CORS), d'où cette copie.

Le workflow se relance **chaque jour à 05 h 37 UTC** et à chaque modification de l'application. Si une archive est absente ou invalide, le déploiement est annulé et la version précédente reste en ligne. L'application relit le manifeste une fois par heure et ne retélécharge une archive que si sa révision a changé.

L'attribution exigée par les licences figure dans l'application (Réglages → À propos) et dans les mentions légales.

## Mise en route (une seule fois)

1. **Fusionner** la pull request qui ajoute ce mode (le workflow ne déploie rien tant que l'étape 3 n'est pas faite).
2. Sur GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables → New repository variable** : `PAGES_ENABLED` = `true`. Lancer ensuite le workflow « Site web (GitHub Pages) » (Actions → Run workflow).
4. **Settings → Pages → Custom domain** : `app.kumm.fr`, puis cocher **Enforce HTTPS** quand GitHub a validé le domaine (quelques minutes à une heure après la mise à jour du DNS).

> Tant que le DNS pointe vers l'ancien serveur (VPS), `app.kumm.fr` continue de fonctionner comme avant. Le changement ne se fait qu'à l'étape DNS ci-dessous.

## DNS

À modifier chez le registrar du domaine `kumm.fr` (la zone actuelle pointe vers le VPS) :

| Nom | Type | Valeur |
|---|---|---|
| `app.kumm.fr` | CNAME | `qoats.github.io` |
| `kumm.fr` (racine) | A | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |
| `kumm.fr` (racine) | AAAA (facultatif) | `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153` |
| `www.kumm.fr` | CNAME | `qoats.github.io` |

À **ne pas toucher** : `relais.kumm.fr` (messagerie Relais, qui reste sur le VPS) et les enregistrements de messagerie (MX, SPF, DKIM) éventuels.

GitHub recommande de [vérifier le domaine](https://docs.github.com/fr/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages) (Settings du compte → Pages) pour éviter qu'un tiers le réclame.

## Le site de présentation (kumm.fr)

Les fichiers sont dans `vitrine/` (avec `vitrine/CNAME` = `kumm.fr`). Comme un dépôt ne publie qu'un domaine, ils doivent vivre dans un second dépôt GitHub (par exemple `Qoats/kumm-site`) qui contient ces fichiers à la racine et ce workflow dans `.github/workflows/pages.yml` :

```yaml
name: Site de présentation
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  deploiement:
    runs-on: ubuntu-24.04
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v6
      - uses: actions/upload-pages-artifact@v4
        with:
          path: .
      - id: deployment
        uses: actions/deploy-pages@v4
```

Puis, dans ce second dépôt : Settings → Pages → Source : GitHub Actions, Custom domain : `kumm.fr`.

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
