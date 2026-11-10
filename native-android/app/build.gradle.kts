import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

fun javaString(value: String): String =
    "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", "\\r").replace("\n", "\\n") + "\""

val apiBase = providers.environmentVariable("KUMM_API_BASE").orElse("https://app.kumm.fr").get()
val apiKey = providers.environmentVariable("KUMM_APP_KEY").orElse("").get()
val liveData = providers.environmentVariable("KUMM_LIVE").map { it == "1" }.orElse(apiKey.isNotBlank())

android {
    namespace = "fr.kumm.nativeapp"
    compileSdk = 36
    ndkVersion = "27.2.12479018"

    defaultConfig {
        applicationId = "fr.kumm.app.nativepreview"
        minSdk = 26
        targetSdk = 36
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
        versionCode = 1
        versionName = "0.1.0-preview"
        buildConfigField("String", "API_BASE", javaString(apiBase))
        buildConfigField("String", "API_KEY", javaString(apiKey))
        buildConfigField("boolean", "LIVE_DATA", liveData.get().toString())
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

val motion = rootProject.layout.projectDirectory.dir("motion")
val motionLibraries = layout.buildDirectory.dir("generated/kummMotion/jniLibs")
val ndk = androidComponents.sdkComponents.ndkDirectory
val buildRustMotion by tasks.registering(Exec::class) {
    inputs.files(motion.file("Cargo.toml"), motion.file("Cargo.lock"), motion.file("build-android.sh"))
    inputs.dir(motion.dir("src"))
    inputs.property("ndk", android.ndkVersion)
    outputs.dir(motionLibraries)
    doFirst {
        commandLine("bash", motion.file("build-android.sh").asFile, ndk.get().asFile,
            motionLibraries.get().asFile, layout.buildDirectory.dir("cargo").get().asFile)
    }
}
android.sourceSets.getByName("main").jniLibs.srcDir(motionLibraries)
tasks.named("preBuild").configure { dependsOn(buildRustMotion) }

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.10.01"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("org.maplibre.gl:android-sdk:12.0.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
