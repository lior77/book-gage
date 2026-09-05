// Standalone Gradle build for the pure-Kotlin :core module.
// It has NO Android or Google-Maven dependencies, so it builds and tests with
// Maven Central alone. The Android app at the repo root pulls it in via
// `includeBuild("core")` (see root settings.gradle.kts).
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}

rootProject.name = "core"
