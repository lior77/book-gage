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
        versionCode = 1
        versionName = "1.0.0"
        // arm64-v8a is the Galaxy A56's ABI; keep armeabi-v7a for wider install.
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
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

    // On-device language identification (to detect an embedded track's real language).
    implementation("com.google.mlkit:language-id:17.0.6")

    // --- Native media + ASR ---------------------------------------------------
    // FFmpeg for probing streams, extracting audio, and remuxing the Hebrew
    // subtitle track into a new MKV without re-encoding. The official ffmpeg-kit
    // was retired (Jan 2025) and its binaries removed from Maven; use a 16KB
    // page-size-compatible community build. Confirm the coordinates before
    // building — see README "Native dependencies".
    // implementation("com.github.<fork>:ffmpeg-kit-android-16KB:<version>")

    // whisper.cpp for on-device speech-to-text (only when no subtitles are found).
    // Ships a native .so + a small GGML model bundled in assets. Optional for v1.
    // implementation("com.github.<fork>:whispercpp-android:<version>")

    testImplementation("junit:junit:4.13.2")
}
