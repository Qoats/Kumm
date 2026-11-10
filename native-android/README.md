# Kumm natif pour Android

Premier client Android de Kumm sans WebView. Jetpack Compose affiche l’accueil, la recherche CTS/TER et les départs. MapLibre Native affiche la carte interactive, les filtres par mode et les positions estimées. Le calcul de l’avancement des TER est en Rust.

Le paquet `fr.kumm.app.nativepreview` s’installe à côté de Kumm. La version web et la publication de l’APK existant sont indépendantes de ce projet. L’accueil reprend le thème Alsace, ses dessins, sa police et ses icônes. Les raccourcis Maison et Boulot pointent vers des arrêts enregistrés sur l’appareil. Le guidage, les notifications et les widgets restent à porter.

## Compiler et tester

Prévoir un JDK 21, Gradle 8.13, le SDK Android 36, le NDK 27.2.12479018, Bash 4+ et Rust 1.88 ou plus récent. Cette préversion cible les appareils Android 8 et suivants avec une ABI ARM64 ou x86-64.

```sh
rustup target add aarch64-linux-android x86_64-linux-android
cd native-android
cargo test --locked --manifest-path motion/Cargo.toml
gradle :app:testDebugUnitTest :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Sans configuration, la version affiche des données de démonstration identifiées comme telles. Le fond de carte OpenFreeMap nécessite une connexion. Pour utiliser le serveur privé, fournir la clé applicative autorisée via la variable d’environnement `KUMM_APP_KEY` au moment de la compilation. Limiter la distribution de cet APK aux testeurs habilités. `KUMM_API_BASE` permet d’utiliser un autre serveur HTTPS. `KUMM_LIVE=1` active les données réelles pour un serveur de développement qui accepte les clients sans clé.

Sur téléphone, vérifier le recouvrement des barres système en navigation gestuelle et à trois boutons, la recherche avec le clavier ouvert, l’accueil Alsace en clair et sombre, la carte et les filtres, le retour au premier plan et la fiche d’une gare avec les départs CTS et TER.
