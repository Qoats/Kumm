// Après « cap add android » et avant « cap sync android ».
import fs from "node:fs";

const profile = process.argv[2] ?? "play";
const code = process.argv[3] ?? "1";
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
if (!["play", "sideload"].includes(profile) || !/^[1-9][0-9]{0,9}$/.test(code) || Number(code) > 2_100_000_000) {
  throw new Error("Usage : node scripts/android/prepare-android.mjs play|sideload VERSION_CODE");
}
const sideload = profile === "sideload";
const app = "android/app";
const java = app + "/src/main/java/fr/kumm/app";
const read = path => fs.readFileSync(path, "utf8");
const write = (path, update) => fs.writeFileSync(path, update(read(path)));

fs.mkdirSync(app + "/src/test/java/fr/kumm/app", { recursive: true });
fs.cpSync("android-tests", app + "/src/test/java/fr/kumm/app", { recursive: true });
fs.cpSync("android-res", app + "/src/main/res", { recursive: true });
for (const file of fs.readdirSync("android-src").filter(name => name.endsWith(".java"))) {
  const target = java + "/" + file;
  if (file === "KummUpdater.java" && !sideload) fs.rmSync(target, { force: true });
  else fs.copyFileSync("android-src/" + file, target);
}
if (!sideload) write(java + "/MainActivity.java", text => text.replace(/^\s*registerPlugin\(KummUpdater\.class\);\r?\n/m, "\n"));

write(app + "/src/main/res/values/styles.xml", text => text.includes("windowSplashScreenBackground") ? text :
  text.replace('<item name="android:background">@drawable/splash</item>', '<item name="android:background">@drawable/splash</item>\n        <item name="windowSplashScreenBackground">#136342</item>\n        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>'));

write(app + "/src/main/AndroidManifest.xml", text => {
  const permissions = [
    "RECEIVE_BOOT_COMPLETED", "ACCESS_NETWORK_STATE", "ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "VIBRATE",
    ...(sideload ? ["FOREGROUND_SERVICE", "FOREGROUND_SERVICE_LOCATION", "FOREGROUND_SERVICE_DATA_SYNC", "POST_NOTIFICATIONS", "REQUEST_INSTALL_PACKAGES"] : [])
  ];
  for (const permission of permissions) {
    if (!text.includes(`android.permission.${permission}"`)) {
      text = text.replace("</manifest>", `    <uses-permission android:name="android.permission.${permission}" />\n</manifest>`);
    }
  }
  if (!sideload) text = text.replace(/^[\t ]*<uses-permission android:name="android\.permission\.REQUEST_INSTALL_PACKAGES"\s*\/>\r?\n/gm, "");
  if (!text.includes(".GtfsJob")) text = text.replace("</application>", '<service android:name=".GtfsJob" android:permission="android.permission.BIND_JOB_SERVICE" android:exported="true" />\n    </application>');
  if (!text.includes("StopWidget")) {
    let widgets = read("android-src/widgets-manifest.xml");
    if (!sideload) {
      // Play : pas de widgets « trafic » ni « Vélhop » (données temps réel indisponibles) ni de service de suivi
      widgets = widgets.replace(/<receiver android:name="\.(?:TrafficWidget|BikeWidget)"[\s\S]*?<\/receiver>\s*/g, "")
        .replace(/<!-- alertes de descente[^>]*-->\s*<service android:name="\.TripService"[^>]*\/>\s*/, "");
      if (/TripService|TrafficWidget|BikeWidget/.test(widgets.replace(/<!--[\s\S]*?-->/g, ""))) throw new Error("Profil play : composants à retirer encore présents");
    }
    text = text.replace("</application>", widgets + "    </application>");
  }
  if (!text.includes("default_notification_icon")) {
    text = text.replace("</application>", '    <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_kumm" />\n        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="alertes" />\n    </application>');
  }
  return text.replace('android:allowBackup="true"', 'android:allowBackup="false"');
});

write(app + "/build.gradle", text => {
  text = text.replace(/versionCode \d+/, "versionCode " + code)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`)
    .replace("proguard-android.txt", "proguard-android-optimize.txt")
    .replace(/minifyEnabled false/, "minifyEnabled true");
  if (!text.includes("shrinkResources true")) {
    text = text.replace("minifyEnabled true", "minifyEnabled true\n            shrinkResources true");
  }
  if (!text.includes("coreLibraryDesugaringEnabled")) text = text.replace("    buildTypes {", "    compileOptions {\n        coreLibraryDesugaringEnabled true\n        sourceCompatibility JavaVersion.VERSION_21\n        targetCompatibility JavaVersion.VERSION_21\n    }\n    buildTypes {");
  if (!text.includes("desugar_jdk_libs")) text = text.replace("dependencies {", "dependencies {\n    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5'");
  if (!text.includes("robolectric")) text = text.replace("dependencies {", "dependencies {\n    testImplementation 'org.robolectric:robolectric:4.16.1'");
  if (!text.includes("mockwebserver")) text = text.replace("dependencies {", "dependencies {\n    testImplementation 'com.squareup.okhttp3:mockwebserver:4.12.0'");
  if (!text.includes("includeAndroidResources")) text = text.replace("    buildTypes {", "    testOptions { unitTests.includeAndroidResources = true }\n    buildTypes {");
  return text;
});
write("android/build.gradle", text => text.replace("com.android.tools.build:gradle:8.13.0", "com.android.tools.build:gradle:8.13.2"));
write("android/gradle.properties", text => {
  const optimized = "android.r8.optimizedResourceShrinking=true";
  text = text.replace(/^android\.enableR8\.fullMode\s*=\s*false\b[^\r\n]*(?:\r?\n|$)/m, "");
  const setting = /^android\.r8\.optimizedResourceShrinking\s*=.*$/m;
  return setting.test(text) ? text.replace(setting, optimized) : `${text.trimEnd()}\n${optimized}\n`;
});
const proguard = read("android-src/proguard-kumm.pro");
write(app + "/proguard-rules.pro", text => {
  // Remplace aussi les règles générées avant l'activation de l'optimisation.
  text = text.replace(/^# Règles R8 de Kumm \(ajoutées à android\/app\/proguard-rules\.pro[^\r\n]*\r?\n[\s\S]*?^-renamesourcefileattribute SourceFile[ \t]*\r?\n?/m, "");
  return text.includes(proguard.trim()) ? text : text.trimEnd() + "\n\n" + proguard;
});
