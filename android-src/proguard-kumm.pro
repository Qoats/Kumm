# Les composants Android sont conservés via le manifeste. Les plugins Kumm
# passent par les règles du pont Capacitor ci-dessous.

# Capacitor : plugins et méthodes appelées depuis la page web
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { @com.getcapacitor.annotation.PermissionCallback <methods>; @com.getcapacitor.annotation.ActivityCallback <methods>; @com.getcapacitor.PluginMethod public <methods>; }
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep class com.getcapacitor.** { *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }

# Firebase / notifications push
-keep class com.google.firebase.** { *; }
# Extensions Kotlin facultatives de Firebase, absentes de l'application : sans cela R8 s'arrête ("Missing class com.google.firebase.ktx.Firebase")
-dontwarn com.google.firebase.ktx.**
-dontwarn com.google.firebase.**.ktx.**
-dontwarn kotlin.**
-dontwarn kotlinx.**

# Traces d'erreur lisibles par numéro de ligne, sans révéler les noms d'origine
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile
