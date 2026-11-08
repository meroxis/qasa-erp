# Qasa ERP phone app

The Qasa phone app for companies on Pro or Business: scan barcodes with the phone camera, check a price and the stock
per warehouse (and the shelf, for car parts), add a new item with its photo, count stock, and send a sale to the office
PC as a draft invoice. Arabic, English and Kurdish (Sorani), right to left where it should be.

Expo (SDK 58) and React Native, TypeScript. Android first; iOS builds from the same code.

## How it reaches the office

The phone is paired once: on the Qasa PC, **Settings → Phones → Add a phone** shows a QR code. It holds the office's
addresses on the Wi-Fi, the port of the phone link (47421), the office's public key and a one-time pairing secret
(valid 10 minutes). The phone makes its own key (kept in the Android Keystore / iOS Keychain through
expo-secure-store) and connects over a WebSocket.

Everything on the wire is encrypted and authenticated by `src/protocol.ts`: X25519, HKDF-SHA256 and
ChaCha20-Poly1305 from @noble (audited, pure JavaScript), with forward secrecy and a counter on every message (a replayed
or altered message ends the session). No TLS certificates are involved, so there is nothing to pin or to trust on the
phone, and plain `ws://` on the office network is fine. The phone acts as the Qasa user it was paired for: every
request goes through the office's own API and its permission checks, and only the routes the app needs are open.

`src/protocol.ts` is a copy of `pro/src/phone/protocol.ts` (the office side, in the private Pro module). Change it
there, then run `npm run sync-protocol`; `test/link.test.ts` fails when the two differ.

Not done yet: reaching the office over the internet through Qasa Relay (the relay forwards to the office's network
port, not to the phone link; it needs a WebSocket path for phones — see the Pro module's notes).

## Develop

This folder is a project of its own (its own `package.json` and lock file), not one of the monorepo's workspaces.

```
cd apps/mobile
npm install
npm run typecheck
npm test                     # the protocol client against a fake office
npx expo start               # with a development build on a phone (the camera needs native code: not Expo Go)
npx expo run:android         # a local development build (Android Studio and a phone or emulator)
```

## Build and publish (Android)

1. Install EAS CLI: `npm i -g eas-cli`, then `eas login` with the Meroxis Expo account (free).
2. `eas build:configure` once (it fills in the project ID in app.json).
3. A test APK for phones in the office: `eas build -p android --profile preview`, then install the link it gives.
4. The Play Store build: `eas build -p android --profile production` (an .aab, signed by EAS; keep the upload key EAS
   makes, or let Google Play App Signing hold it).
5. Google Play Console (a one-time USD 25 developer account): create the app **Qasa ERP**, package
   `iq.qasaerp.mobile`, upload the .aab to Internal testing first, then Production.

Play Store listing notes:
- Category: Business. Languages: Arabic (default for Iraq), English, Kurdish.
- Data safety: the app sends data only to the customer's own Qasa PC on their network, encrypted; nothing to Meroxis
  or third parties; no ads, no analytics. The camera is used for scanning and item photos only.
- Privacy policy URL: https://qasaerp.com/privacy/
- Screenshots: pairing, scanning, an item card, the sale cart (phone, 1080×1920 or similar).

iOS: `eas build -p ios --profile production` needs an Apple Developer account (paid yearly) — not planned for now.
