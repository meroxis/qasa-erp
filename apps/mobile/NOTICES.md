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

The fonts are not changed: the WOFF files are only unpacked back into the TrueType files they were made from, which
the OFL allows; they keep their names and licence.

## Components (runtime)

All under the MIT licence: @noble/ciphers, @noble/curves and @noble/hashes 2.4.0; expo 58.0.23 with expo-camera,
expo-crypto, expo-file-system, expo-font, expo-haptics, expo-image-manipulator, expo-local-authentication,
expo-localization, expo-secure-store and expo-status-bar (SDK 58); react 19.3.0; react-native 0.88.1;
react-native-safe-area-context 5.11.1; react-native-svg 15.16.0.
