# Préparer Kumm pour Google Play

## Constructions de revue

- Le profil `play` garde l’identifiant `fr.kumm.app`, cible Android 16 (API 36), retire le programme de mise à jour autonome et sa permission d’installation. Le profil `sideload` conserve la distribution autonome.
- Avec Node 22.12+, Java 21 et le SDK Android 36, lancer `npm ci`, `npx cap add android` une seule fois, `node scripts/android/prepare-android.mjs play VERSION_CODE`, puis `npm run build:android`. Dans `android`, lancer `./gradlew assembleDebug bundleRelease` (ou `gradlew.bat` sous Windows).
- L’APK de test est signé avec une clé de débogage. L’AAB est non signé. Aucune URL de serveur Kumm n’est nécessaire. Les données GTFS officielles sont téléchargées directement sur le téléphone. Voir [Android autonome](ANDROID-AUTONOME.md) pour les capacités et limites du calcul local.
- Le workflow Actions produit des fichiers de revue. Il ne diffuse un APK autonome que si le profil `sideload` et l’option de publication sont choisis manuellement sur `main`. Le certificat de l’APK sideload doit correspondre à celui déjà distribué et son code de version doit augmenter. La préparation crée une GitHub Release en brouillon et ne modifie pas la branche `apk`, conservée comme référence de première migration. L’envoi d’un AAB à Play Console reste une action distincte.

## Avant une soumission

1. Vérifier si `fr.kumm.app` a déjà une fiche et choisir un `versionCode` supérieur à tous les codes déjà envoyés. Si des utilisateurs doivent migrer depuis les APK distribués hors Play, vérifier la compatibilité des clés de signature avant la première soumission. Configurer Play App Signing et signer le bundle avec la clé d’importation. [Signature des applications](https://developer.android.com/studio/publish/app-signing)
2. Tester l’installation et le parcours sur Android. Vérifier les prochains départs théoriques CTS, les horaires à une date choisie, les TER, les widgets, le refus de localisation, le guidage au premier plan et la rubrique Perturbations. L’APK de revue est construit sans configuration de notifications Firebase par défaut.
3. Renseigner la fiche et la section **Sécurité des données** à partir des parcours réels. Vérifier la politique de confidentialité publique et les déclarations de localisation, de notifications et du service de suivi au premier plan. Les itinéraires, le partage de trajet, les signalements et les abonnements ont des traitements distincts.
4. Vérifier les exigences du compte dans Play Console. Pour certains comptes personnels récents, le test fermé doit conserver au moins 12 testeurs inscrits en continu pendant 14 jours avant la demande d’accès à la production. [Exigences de test](https://support.google.com/googleplay/android-developer/answer/14151465)

[Exigences de niveau d’API](https://support.google.com/googleplay/android-developer/answer/11926878) · [Règles relatives aux permissions Android](https://support.google.com/googleplay/android-developer/answer/18265346)
