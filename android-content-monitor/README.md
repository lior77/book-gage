# Content Guard — self-content leak monitor (Android)

An Android app that lets **you** monitor the public web for leaked **video** copies
of **your own** content. You type your account handle (e.g. `@YourHandle`), confirm
the content is yours, and the app returns a list of candidate leaked videos — with
each clip's **duration** and **date** where the hosting page exposes them.

> This tool is for monitoring content you own or are explicitly authorized to
> monitor. It is not a way to search for other people's private content.

## How it actually works (no magic)

An app on a phone cannot "scan the whole internet" by itself. It queries a search
service that has **already indexed** the public web. This app uses **Google
Programmable Search (Custom Search JSON API)** — the closest thing to searching the
whole public web.

- **Findings** are candidate matches for human review, not confirmed leaks.
- **Duration** is read from each page's video metadata (`schema.org VideoObject` /
  `og:video:duration`) when present. Many piracy sites expose no metadata, so
  duration is often shown as unknown. **The app never invents a duration.**
- **Dates** are best-effort from page metadata; missing dates are marked unknown.

## Enabling real monitoring (free tier: 100 queries/day)

Open `app/src/main/java/com/contentguard/monitor/Config.kt` and fill in:

```kotlin
const val GOOGLE_API_KEY: String = "your-api-key"
const val GOOGLE_SEARCH_ENGINE_ID: String = "your-cx-id"
```

1. Create a Programmable Search Engine at
   https://programmablesearchengine.google.com — set it to **search the entire web**,
   and copy its **Search engine ID (cx)**.
2. Enable the **Custom Search API** in Google Cloud and create an **API key**:
   https://developers.google.com/custom-search/v1/overview

Leave either value blank to run in **demo mode**, which performs no search and
clearly says no data source is configured (it does not fabricate results).

## Build

Open `android-content-monitor/` in Android Studio (Giraffe+), let it sync, and run.
Or from the command line once a Gradle wrapper is present:

```bash
gradle wrapper            # generates the wrapper jar (one-time)
./gradlew assembleDebug
```

- Language: Kotlin · UI: Jetpack Compose · minSdk 26 · targetSdk 34
- No third-party networking libs — plain `HttpURLConnection` + `org.json`.

## Project layout

```
app/src/main/java/com/contentguard/monitor/
  Config.kt                     data-source configuration (API key / engine id)
  MainActivity.kt               Compose entry point + screen routing
  MainViewModel.kt              UI state machine (Home → Search → Loading → Results)
  model/MonitorModels.kt        VideoFinding, MonitorReport
  data/MonitorService.kt        service interface
  data/GoogleCustomSearchService.kt   real source: Google Programmable Search
  data/DemoMonitorService.kt    honest no-op source (no fabricated data)
  data/MonitorRepository.kt     picks a source, computes the summary
  ui/Screens.kt                 Home / Search / Loading / Results composables
  ui/theme/Theme.kt             Material 3 theme
```

## For leaked intimate images

This app monitors by **account name (text)**. If you need to find or block a
specific **intimate image**, do **not** upload it to a generic image-search API —
that spreads it further. Use a hash-based service designed for this, where the image
never leaves your device:

- **StopNCII.org** (free) — partner platforms block matching hashes.
- **Take It Down** (NCMEC) — especially if the content was made when under 18.
