# Retirer l’archive contenant le jeton CTS

1. Vérifier la révocation du jeton CTS exposé auprès de la CTS. Fournir un nouveau jeton serveur uniquement après obtention de l’autorisation SIRI. Retirer l’ancien `APP_KEY` du serveur et le secret `KUMM_APP_KEY` de GitHub Actions au moment de la migration. La clé statique publiée ne doit pas être réutilisée pour une API privée.
2. Inventorier les branches, demandes de fusion, forks et téléchargements. Le fichier `kumm-v0.9.1-PRIVE-avec-jeton.zip` est absent de l’arborescence actuelle et reste accessible dans les commits historiques. Vérifier séparément les anciens APK et artefacts CI, notamment les builds contenant l’ancienne clé d’application.
3. Dans un nouveau miroir isolé, répéter le retrait du chemin et le contrôle avant toute décision sur le dépôt partagé.

   ```sh
   git clone --mirror https://github.com/Qoats/Kumm.git Kumm-nettoyage.git
   cd Kumm-nettoyage.git
   git filter-repo --sensitive-data-removal --no-fetch --invert-paths \
     --path 'kumm-v0.9.1-PRIVE-avec-jeton.zip'
   git log --all -- 'kumm-v0.9.1-PRIVE-avec-jeton.zip'
   git rev-list --objects --all | grep -F 'kumm-v0.9.1-PRIVE-avec-jeton.zip'
   ```

   Les deux dernières commandes doivent donner une sortie vide. Contrôler aussi les copies sous d’autres noms et les archives imbriquées avec un scanner de secrets configuré pour masquer les résultats.
4. Organiser avec les mainteneurs l’arrêt temporaire des contributions, une sauvegarde protégée et le traitement des protections de branches. La mise à jour forcée des références exige une autorisation distincte. Les références de pull requests et les vues en cache peuvent nécessiter l’aide de GitHub. Les clones et forks antérieurs sont à traiter avec leurs propriétaires.
5. Retirer les anciens artefacts confirmés sensibles et vérifier ce que distribuent le serveur et la branche `apk`. La rotation neutralise les copies déjà téléchargées. Vérifier ensuite les URLs de commits anciennes, les téléchargements et la recherche de secrets sur le dépôt nettoyé.

[Procédure GitHub pour retirer des données sensibles](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
