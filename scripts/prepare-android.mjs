// Après « cap add android » et avant « cap sync android ».
import fs from "node:fs";

const profile = process.argv[2] ?? "play";
const code = process.argv[3] ?? "1";
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
if (!["play", "sideload"].includes(profile) || !/^[1-9][0-9]{0,9}$/.test(code) || Number(code) > 2_100_000_000) {
  throw new Error("Usage : node scripts/prepare-android.mjs play|sideload VERSION_CODE");
}
const sideload = profile === "sideload";
const app = "android/app";
const java = app + "/src/main/java/fr/kumm/app";
const read = path => fs.readFileSync(path, "utf8");
const write = (path, update) => fs.writeFileSync(path, update(read(path)));

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
    "ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "FOREGROUND_SERVICE",
    "FOREGROUND_SERVICE_LOCATION", "FOREGROUND_SERVICE_DATA_SYNC", "POST_NOTIFICATIONS", "VIBRATE",
    ...(sideload ? ["REQUEST_INSTALL_PACKAGES"] : [])
  ];
  for (const permission of permissions) {
    if (!text.includes(`android.permission.${permission}"`)) {
      text = text.replace("</manifest>", `    <uses-permission android:name="android.permission.${permission}" />\n</manifest>`);
    }
  }
  if (!sideload) text = text.replace(/^[\t ]*<uses-permission android:name="android\.permission\.REQUEST_INSTALL_PACKAGES"\s*\/>\r?\n/gm, "");
  if (!text.includes("StopWidget")) text = text.replace("</application>", read("android-src/widgets-manifest.xml") + "    </application>");
  if (!text.includes("default_notification_icon")) {
    text = text.replace("</application>", '    <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_kumm" />\n        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="alertes" />\n    </application>');
  }
  return text.replace('android:allowBackup="true"', 'android:allowBackup="false"');
});

write(app + "/build.gradle", text => {
  text = text.replace(/versionCode \d+/, "versionCode " + code)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`);
  if (!text.includes("shrinkResources true")) {
    text = text.replace(/minifyEnabled (?:false|true)/, "minifyEnabled true\n            shrinkResources true");
  }
  return text;
});
const proguard = read("android-src/proguard-kumm.pro");
write(app + "/proguard-rules.pro", text => text.includes(proguard.trim()) ? text : text + "\n" + proguard);
