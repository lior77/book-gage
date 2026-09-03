plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.hebsub.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.hebsub.app"
        minSdk = 26          // SAF + MediaMuxer + scoped storage
        targetSdk = 35       // Android 15 (One UI 7 on the Galaxy A56)
        versionCode = 20
        versionName = "2.9"
        // The Galaxy A56 is arm64-v8a. The 16KB FFmpeg build ships arm64-v8a only,
        // so we target that single ABI (also keeps the APK smaller).
        ndk { abiFilters += "arm64-v8a" }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures { compose = true }

    // The FFmpeg integration is an opt-in source set + dependency. The default
    // build (no `-PwithFfmpeg`) compiles with Maven-only dependencies and uses
    // NoOpMediaTool, so a working APK builds anywhere. Pass -PwithFfmpeg and drop
    // a 16KB-compatible FFmpegKit AAR into app/libs/ to enable probing + MKV mux.
    if (project.hasProperty("withFfmpeg")) {
        sourceSets["main"].java.srcDir("src/ffmpeg/java")
    }

    // Android 15 requires 16 KB page-size alignment. useLegacyPackaging=false keeps
    // the .so files page-aligned in the APK; the native AARs must also be 16KB-built.
    packaging {
        jniLibs { useLegacyPackaging = false }
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

dependencies {
    // Pure-Kotlin subtitle/translation logic (substituted from includeBuild("core")).
    implementation("com.hebsub:core")

    // Compose UI
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")

    // Encrypted local storage for the user's API keys (never leaves the device).
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Privacy-hardened HTTP for downloads, OpenSubtitles, and Claude.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // On-device translation (offline, private). Hebrew supported.
    implementation("com.google.mlkit:translate:17.0.3")

    // --- Optional native media (FFmpeg) --------------------------------------
    // Enabled with -PwithFfmpeg. Uses a Maven Central 16KB-page-size-compatible
    // community fork of FFmpegKit (the official one was retired Jan 2025). The
    // package stays com.arthenica.ffmpegkit, so FfmpegMediaTool is drop-in.
    if (project.hasProperty("withFfmpeg")) {
        implementation("com.moizhassan.ffmpeg:ffmpeg-kit-16kb:6.1.1")
    }

    testImplementation("junit:junit:4.13.2")
}
