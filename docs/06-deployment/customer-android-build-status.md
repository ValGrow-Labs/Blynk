# Customer App Android Build Status

**STATUS: the debug build WORKS. `flutter build apk --debug` succeeds (Task G1b, 2026-09-21). The release build is NOT built or verified, and release signing and the application ID are unresolved (D2).**

Context: [`blynk-live-location-tracking-report.md`](../05-implementation/blynk-live-location-tracking-report.md), [`google-maps-platform-setup.md`](google-maps-platform-setup.md). History: the Live Location phase (Task M7, 2026-09-20) recorded this build as BLOCKED; that section is kept below as history.

**Toolchain floor: Flutter 3.44 / Dart 3.12.** `google_maps_flutter_android` requires it, so `pubspec.yaml` now declares `sdk: ">=3.12.0 <4.0.0"` (it said `>=3.0.5`; `pubspec.lock` already required 3.12 / 3.44). The project builds with Flutter 3.47.2 / Dart 3.13.2.

## Current state (Task G1b)

- **Debug APK: builds.** From `apps/customer/blinkit-clone-Flutter-ecommerce-/` with `JAVA_HOME` set to Android Studio's bundled JBR (JDK 21) and `MAPS_API_KEY` unset: `flutter build apk --debug` finished with exit 0 (`build/app/outputs/flutter-apk/app-debug.apk`, about 224 MB; Gradle `assembleDebug` about 3 minutes on a warm cache). The earlier `flutter_native_splash` failure is fixed by the `compileSdk` override already in the user's `android/build.gradle` (it raises every Android library module to the app's `compileSdk`; see the comment in that file). Only the generic Kotlin-Gradle-plugin deprecation warnings remain.
- **Google Maps and MapLibre plugins coexist** in the same build (`google_maps_flutter` 2.18.1 / Android 2.19.13 and `maplibre_gl` 0.25.0). Only one is ever rendered (`MAP_PROVIDER`, default `google`).
- **Google Maps key mechanism.** The manifest holds `<meta-data android:name="com.google.android.geo.API_KEY" android:value="${MAPS_API_KEY}" />`. `android/app/build.gradle` fills the placeholder from the `MAPS_API_KEY` environment variable, then `android/secrets.properties` (git-ignored; template `android/secrets.properties.example`), then `android/local.properties`, else an empty string. An empty key does not fail the build; Gradle logs one warning (visible when Gradle is run directly, hidden by `flutter build`'s quiet output). The merged debug manifest of the verified build contains the meta-data with an empty value. Details: [`google-maps-platform-setup.md`](google-maps-platform-setup.md).
- The manifest label is now `Blynk` (was `ecom`).
- **Google map RENDERING NOT VERIFIED.** No device, no emulator and no real key were used; a built APK proves compilation and manifest merging only.
- **Unchanged and unresolved:** `applicationId` / `namespace` are still the template value `dev.sarthakag.blinkit.ecom` (D2 undecided) and the release build type is still signed with the debug key. Do not publish such a build. No release AAB was built in G1b.

## History: the failure recorded in Task M7 (fixed)

Recorded at the end of the Live Location phase. Context at that time: the Windows desktop target, `flutter test` and `flutter analyze` were unaffected; only Android builds were blocked.

### The failing command and outcome

Run from `apps/customer/blinkit-clone-Flutter-ecommerce-/`:

```
flutter build apk --debug
```

with `JAVA_HOME` set to Android Studio's bundled JBR (JDK 21; `C:\Program Files\Android\Android Studio\jbr`). It was run twice (the first run took about 8.5 minutes) and failed both times:

```
BUILD FAILED
Execution failed for task ':flutter_native_splash:checkDebugAarMetadata'.
```

The release build was not attempted because the debug build fails first. Gradle stopped at the first failing module, so the native modules of the two packages added by this phase, `maplibre_gl` 0.25.0 and `geolocator` 14.0.2, have **not** been shown to compile.

### Root cause

`flutter_native_splash` 2.4.4 (a `dev_dependency`, listed unpinned in `pubspec.yaml`; `pubspec.lock` resolves 2.4.4) hard-codes `compileSdkVersion 31` in its own `android/build.gradle` (line 29 of the pub-cache copy). The AndroidX libraries on the app's classpath (for example fragment 1.7.1, window 1.2.0, core 1.13.1, lifecycle 2.7.0, over twenty items in all) require `compileSdk` 33 or higher, so the AAR-metadata check fails for that module.

### Fix options (option 2 was later applied by the user in `android/build.gradle`)

1. **Bump the package.** `flutter pub upgrade flutter_native_splash` to a release whose Android module targets a modern `compileSdk`, then re-run the build.
2. **Root-level override.** In the root `android/build.gradle`, add a `subprojects { afterEvaluate { ... compileSdk = 36 } }` block so every plugin module is compiled against a modern SDK. This edits a file the user is already changing (see below).

Whichever is chosen, expect further failures behind this one; nothing past `:flutter_native_splash` was reached.

## The user's uncommitted Gradle files

Five files under `android/` are modified but uncommitted: `app/build.gradle`, `build.gradle`, `gradle.properties`, `gradle/wrapper/gradle-wrapper.properties` and `settings.gradle`. They are a migration to the current Flutter Gradle template (Gradle 9.3.1, plugins DSL, JVM 17, `newDsl` and `builtInKotlin` flags), presumed to be the user's own work. The failing build above was run **with those files present and unmodified**: their sha256 hashes were identical before and after the build. This phase did not edit, stage or commit them.

## Requirements to keep in mind

- **JDK 21.** `maplibre_gl` 0.25.0's Android module needs JDK 21, and the Android Studio JBR is JDK 21. Set `JAVA_HOME` to it for the build. (Earlier phases documented a Gradle 7.5 / Java 21 mismatch under the app's old Gradle setup; the user's uncommitted Gradle migration above appears aimed at that.)
- `maplibre_gl` 0.25.0 also declares Android Gradle Plugin 8.13.2 (so Gradle 8.13 or newer), Kotlin 2.1 or newer for the app, `compileSdk` 36 and NDK 28.1.13356709 (from the package's own `android/build.gradle`, read during Task M4).
- `maplibre_gl` cannot move to 0.26.x or 0.27.x until the existing `lottie ^2.4.0` pin is raised (an `archive` version conflict).

## Release signing warning

The Customer app's release build type is signed with the **debug key**: `android/app/build.gradle` still has the generated `// TODO: Add your own signing config for the release build. Signing with the debug keys for now` and `signingConfig signingConfigs.debug` (this is the committed text; the user's uncommitted working-tree file spells it `signingConfig = signingConfigs.debug`). This is a pre-existing item, not changed by this phase, and a release built this way must not be published. A production keystore and signing config are needed first.

## Build configuration (API address)

The app resolves `API_BASE_URL` and `MAP_TILES_URL` in this order: compile-time `--dart-define` values, then the bundled `.env` (development only), then, in debug builds only, `http://localhost:4000/api/v1`. A release build has no fallback: if the API address is missing, points at `localhost`, `127.0.0.1` or `10.0.2.2`, or is not `https`, the app shows "This build isn't configured" with a short code (`API_URL_MISSING`, `API_URL_INVALID`, `API_URL_LOCAL`, `API_URL_NOT_HTTPS`, `TILES_URL_INVALID`) and does not start.

Production values are supplied by the owner in `env/production.json` (git-ignored). Copy `env/production.example.json` and fill it in; no real address is stored in the repo. Build with:

```
flutter build appbundle --release --dart-define-from-file=env/production.json
```

`flutter_dotenv` and the `.env` asset remain in this pass as the development fallback; removing the `.env` from the release bundle is a later step.
