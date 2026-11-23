# Qasa phone app: assets and components

The register of what the phone app ships that Meroxis did not write, with its licence and the credit it needs. The
credits the fonts ask for are shown in the app (More → About).

## Assets

| Asset | Files | Source | Licence | Credit |
| --- | --- | --- | --- | --- |
| Noto Sans Arabic (400, 600, 700; Arabic letters) | `assets/fonts/NotoSansArabic-*.ttf` | @fontsource/noto-sans-arabic 5.3.0, as the desktop app ships it; unpacked to TrueType by `scripts/fonts.mjs` | SIL Open Font License 1.1 (`assets/fonts/NotoSansArabic-OFL.txt`) | Copyright 2022 The Noto Project Authors (github.com/notofonts/arabic) |
| IBM Plex Sans (400, 600, 700; Latin letters and numbers) | `assets/fonts/IBMPlexSans-*.ttf` | @fontsource/ibm-plex-sans 5.3.0, as the desktop app ships it; unpacked to TrueType by `scripts/fonts.mjs` | SIL Open Font License 1.1 (`assets/fonts/IBMPlexSans-OFL.txt`) | Copyright 2019 IBM Corp. |
| App icon, adaptive and monochrome icons, splash mark | `assets/*.png` | Meroxis: the Qasa mark (apps/web/public/favicon.svg), drawn by `scripts/icons.mjs` | Meroxis' own | none |
| Interface icons | `src/icons.tsx` | Meroxis: drawn for the app on a 24-unit grid | Meroxis' own | none |
| Barcode models | `assets/mlkit_barcode_models/*.tflite` in the APK (3 models: barcode_ssd_mobilenet_v1_dmp25_quant, oned_auto_regressor_mobile, oned_feature_extractor_mobile) | Google, inside com.google.mlkit:barcode-scanning 17.3.0 | ML Kit Terms (developers.google.com/ml-kit/terms) | none asked; listed here |

The fonts are not changed: the WOFF files are only unpacked back into the TrueType files they were made from, which
the OFL allows; they keep their names and licence. From 1.1 the regular and bold weights of both are also embedded in
the PDFs the app makes of an invoice or a statement (src/staff/pdf.ts), which the OFL allows too (the PDF engine keeps
only the letters used).

## Components (runtime, JavaScript)

All under the MIT licence: @noble/ciphers, @noble/curves and @noble/hashes 2.4.0; expo 58.0.23 with expo-asset,
expo-camera, expo-crypto, expo-file-system, expo-font, expo-haptics, expo-image-manipulator, expo-local-authentication,
expo-localization, expo-print, expo-secure-store, expo-sharing and expo-status-bar (SDK 58); react 19.3.0;
react-native 0.88.1; react-native-safe-area-context 5.11.1; react-native-svg 15.16.0. (1.1: expo-print 58.0.9 makes the
PDF of an invoice or a statement on the phone, expo-sharing 58.0.23 hands it to Android's share sheet; expo-asset
58.0.20, which Expo already ships with expo-font, reads the bundled fonts for those PDFs. All three: MIT, copyright
650 Industries, Inc. (Expo), as their LICENSE files say. For the website's list of the phone app's components.)

## Components (runtime, native: in the Android APK)

(1.2.0, not built yet, adds `expo-image-picker` ~58.0.10 — MIT, copyright 650 Industries, Inc. (Expo) — for choosing
an item's picture from the gallery; add its native libraries to the table below from the release build's dependency
tree when the APK exists. Pictures and names a new item gets by its barcode come through the office from Open Food
Facts and its sister projects: data under the Open Database License, pictures under Creative Commons
Attribution-ShareAlike; nothing of them ships with the app.)

What the APK holds besides the app's own code, as of 1.1.0 (the same libraries as 1.0.2: 1.1 adds only Expo's print
and sharing modules, compiled into the app's code, and sharing's file provider in the manifest, not exported; no new
permission). Taken from the release build's dependency tree
(`./gradlew :app:dependencies --configuration releaseRuntimeClasspath` after `npx expo prebuild`) and checked against
the APK itself (its `META-INF/*.version` files, the `*.properties` files the Google libraries leave at its root, its
`assets/` and `lib/`). Licences are as each library's own POM, licence file or project says; "POM" or a file name
below says where.

| Component | Version | Licence | Where it shows |
| --- | --- | --- | --- |
| **Google ML Kit barcode scanning**, bundled (runs on the phone; the models above and `lib/*/libbarhopper_v3.so`): barcode-scanning, barcode-scanning-common, common, vision-common, vision-interfaces | 17.3.0, 17.0.0, 18.11.0, 17.3.0, 16.3.0 | ML Kit Terms (developers.google.com/ml-kit/terms). Each library's `third_party_licenses.txt` names the open-source parts built into it (Abseil, TensorFlow Lite, XNNPACK, Protocol Buffers, Eigen, RE2, zlib, Zstandard and others) | `barcode-scanning.properties`, `common.properties`, `vision-common.properties`, `vision-interfaces.properties`, `barcode-scanning-common.properties` |
| **Google Play services** client parts ML Kit needs: play-services-base, play-services-basement, play-services-tasks, play-services-mlkit-barcode-scanning; and com.google.android.odml:image | 18.5.0, 18.10.0, 18.2.1, 18.3.1; 1.0.0-beta1 | Android Software Development Kit License (developer.android.com/studio/terms); each with its own `third_party_licenses.txt` | `play-services-*.properties`, `image.properties` |
| Google data transport API and runtime; Firebase components and encoders (asked for by ML Kit; with no backend in the app they send nothing, see below) | transport-api 2.2.1, transport-runtime 2.2.6; firebase-components 16.1.0, firebase-encoders 16.1.0, firebase-encoders-json 17.1.0, firebase-annotations 16.0.0 | Apache-2.0 (firebase-android-sdk) | `transport-*.properties`, `firebase-*.properties` |
| AndroidX: activity, annotation, appcompat, arch core, autofill, biometric, collection, concurrent, core, cursoradapter, customview, documentfile, drawerlayout, emoji2, exifinterface, fragment, interpolator, lifecycle, loader, media3 (common, container, muxer: CameraX video), profileinstaller, resourceinspection, savedstate, startup, swiperefreshlayout, tracing, vectordrawable, versionedparcelable, viewpager, window | as in `META-INF` | Apache-2.0 | `META-INF/androidx.*.version` |
| CameraX: camera-core, camera-camera2, camera-camera2-pipe, camera-lifecycle, camera-video, camera-view, camera-extensions, camera-mlkit-vision, viewfinder-core, featurecombinationquery | 1.6.0 | Apache-2.0 | `META-INF/androidx.camera_*.version` |
| Kotlin standard library and reflection, kotlinx.coroutines, atomicfu; JetBrains annotations | 2.2.x; 1.10.2; 0.28.0; 23.0.0 | Apache-2.0 | `META-INF/*.kotlin_module`, `META-INF/kotlinx_coroutines_*.version` |
| OkHttp (with okhttp-urlconnection), Okio | 4.9.2; 3.16.0 | Apache-2.0; the Public Suffix List inside OkHttp (`okhttp3/internal/publicsuffix/publicsuffixes.gz`) is under MPL-2.0, as its `NOTICE` says | `okhttp3/internal/publicsuffix/NOTICE` |
| zstd-kmp (Square; Zstandard inside it is BSD-licensed) | 0.4.0 | Apache-2.0 | `META-INF/zstd-kmp_release.kotlin_module` |
| Guava (failureaccess, listenablefuture), Gson, Dagger, javax.inject and Jakarta Inject, JSR 305 annotations, AutoValue annotations, JSpecify | 33.3.1-android, 2.8.6, 2.59, 1 / 2.0.1, 3.0.2, 1.6.3, 1.0.0 | Apache-2.0 | `META-INF/com.google.dagger_dagger.version`, `META-INF/NOTICE.md` (Jakarta Inject's notice); the dependency tree |
| Apache Commons Codec, Apache Commons IO | 1.10; 1.4 | Apache-2.0 | their jars' `META-INF/LICENSE.txt` and `NOTICE.txt` |
| SoLoader, fbjni (Meta) | 0.12.1; 0.7.0 | Apache-2.0 | fbjni POM: Apache-2 |
| React Native (react-android), Hermes, Yoga annotations, Fresco (image pipeline, Vito, animated GIF and WebP), Infer annotations (Meta) | 0.88.1; as React Native 0.88.1; 1.19.0; 3.7.0; 0.18.0 | MIT | react-android, hermes-android and fresco POMs: MIT |
| Expo modules: modules core, asset, camera, crypto, file-system, font, haptics, image-loader, image-manipulator, keep-awake, local-authentication, localization, print (1.1), secure-store, sharing (1.1, with its FileProvider for the PDF shared from the app's cache), status-bar; expo-modules-v2-react, kolibri, pika | SDK 58 | MIT | kolibri, pika and expo-modules-v2-react POMs: MIT |
| Glide (with gifdecoder, disklrucache; used by Expo's image loader) | 5.0.5 | BSD-2-Clause, with parts under Apache-2.0 (disklrucache) and MIT (gifdecoder) | the dependency tree; the project's licence file |
| Bolts Tasks | 1.4.0 | BSD | the dependency tree; the project's licence file |
| Brotli decoder | 0.1.2 | MIT | the dependency tree; the project's licence file |

### Left out on purpose (1.0.2)

`plugins/with-no-usage-metrics.js` keeps these out of the APK, and `scripts/check-release-apk.mjs` checks each build:

- **com.google.android.datatransport:transport-backend-cct**, the part of Google's data transport that sends ML Kit's
  usage reports to Google (firebaselogging.googleapis.com). Its place is taken by the app's own
  `plugins/no-usage-metrics/CCTDestination.java` (Meroxis' own code), which names no backend and holds no address, so
  the reports are dropped on the phone; the transport's scheduler service and alarm receiver are taken out of the
  manifest too.
- **play-services-code-scanner** and **play-services-mlkit-document-scanner**, Google's ready-made scanner screens
  (and the "barcode_ui" module Google Play services would download for them): the app scans with its own camera view.
