# Règles R8 de Kumm (ajoutées à android/app/proguard-rules.pro par .github/workflows/android.yml).
# Le code du projet est conservé tel quel : il est appelé par le manifeste, par le pont JavaScript de Capacitor
# et par réflexion, ce que R8 ne voit pas. Le reste (bibliothèques) est réduit et obscurci.

-keep class fr.kumm.app.** { *; }

# Capacitor : plugins et méthodes appelées depuis la page web
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { @com.getcapacitor.annotation.PermissionCallback <methods>; @com.getcapacitor.annotation.ActivityCallback <methods>; @com.getcapacitor.PluginMethod public <methods>; }
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep class com.getcapacitor.** { *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }

# Firebase / notifications push
-keep class com.google.firebase.** { *; }

# Traces d'erreur lisibles par numéro de ligne, sans révéler les noms d'origine
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile
