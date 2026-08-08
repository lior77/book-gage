pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Community 16KB-compatible FFmpegKit / whisper.cpp forks are published here.
        maven { url = uri("https://jitpack.io") }
    }
}

rootProject.name = "HebSub"
include(":app")

// The pure-Kotlin subtitle/translation logic is a standalone build so it can be
// built and unit-tested without the Android SDK. Gradle substitutes it for the
// `com.hebsub:core` dependency the app declares.
includeBuild("core")
