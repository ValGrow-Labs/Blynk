# Customer App Android Build Status

**STATUS: BLOCKED. `flutter build apk --debug` fails for the Customer app. No fix has been applied.**

Recorded at the end of the Live Location & Delivery Tracking phase (Task M7, 2026-09-20). Context: [`blynk-live-location-tracking-report.md`](../05-implementation/blynk-live-location-tracking-report.md). The Windows desktop target and `flutter test` / `flutter analyze` are unaffected; only Android builds are blocked.

## The failing command and outcome

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

## Root cause

`flutter_native_splash` 2.4.4 (a `dev_dependency`, listed unpinned in `pubspec.yaml`; `pubspec.lock` resolves 2.4.4) hard-codes `compileSdkVersion 31` in its own `android/build.gradle` (line 29 of the pub-cache copy). The AndroidX libraries on the app's classpath (for example fragment 1.7.1, window 1.2.0, core 1.13.1, lifecycle 2.7.0, over twenty items in all) require `compileSdk` 33 or higher, so the AAR-metadata check fails for that module.

## Fix options (neither applied)

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

The Customer app's release build type is signed with the **debug key**: `android/app/build.gradle` still has the generated `// TODO: Add your own signing config for the release build. Signing with the debug keys for now` and `signingConfig signingConfigs.debug`. This is a pre-existing item, not changed by this phase, and a release built this way must not be published. A production keystore and signing config are needed first.
