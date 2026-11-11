# Qasa ERP phone app

The Qasa phone app for companies on Pro or Business, for sales reps (mandoob) and owners. Arabic, English and Kurdish
(Sorani), right to left in Arabic and Kurdish, light and dark.

Expo (SDK 58) and React Native, TypeScript. Android first; iOS builds from the same code.

## What it does

Each phone works as the Qasa user it was paired for, and offers what that user's role allows (the office checks every
request again with the user's own permissions):

| Feature | Who sees it |
| --- | --- |
| Home: today's sales, the month, cash in the safes, what customers owe, late customers, items running low | the owner (no sign-in at the office), admin, the accountants (preparer, checker, approver) and viewer |
| Items: by barcode (camera, with the torch) or by name; price, wholesale and shelf (car parts), stock per warehouse | everyone |
| New item with its photo | stock permission |
| Sell: a quick sale sent as a draft invoice (cash or on credit), or an order sent as a quote | sales permission |
| Customers: balance, statement (this month, 3 months, this year) | sales, the accountants, admin, viewer |
| Collect: money received from a customer, sent as a draft receipt voucher the accountant checks and approves | the preparer's permission (give a rep both roles: sales and preparer) |
| Count stock: straight into the warehouse's open count on the PC (stock permission), else a list for the admin in Settings → Phones | everyone |

Nothing the phone sends is posted by itself: sales, receipts and counts reach the office as drafts and are checked
on the PC as the office already works.

## How it reaches the office

The phone is paired once: on the Qasa PC, **Settings → Phones → Add a phone** shows a QR code. It holds the office's
addresses on the Wi-Fi, the port of the phone link (47421), the office's Qasa Relay ID (when the office is on the
relay), the office's public key and a one-time pairing secret (valid 10 minutes). The app checks the code before using
anything in it (`src/pairing.ts`). The phone makes its own key (kept in the Android Keystore / iOS Keychain through
expo-secure-store) and connects over a WebSocket: each Wi-Fi address first, then `wss://relay.qasaerp.com/v1/phone`.

Everything on the wire is encrypted and authenticated by `src/protocol.ts`: X25519, HKDF-SHA256 and
ChaCha20-Poly1305 from @noble (audited, pure JavaScript), with forward secrecy and a counter on every message (a replayed
or altered message ends the session). The office's key from the QR code is pinned, as the desktop pins the office
server's certificate: a PC or a relay that can't prove that key gets nothing, on the Wi-Fi and through the relay alike.
The relay only carries bytes it can't read. Plain `ws://` on the office network is fine for that reason.

A link that drops (the Wi-Fi went, the PC slept, the relay restarted) connects again by itself, after 1, 2, 5, 10, 30
and then every 60 seconds, and at once when the app comes back to the screen. Through the relay the app sends a small
message every 45 s so Cloudflare does not close the connection.

### The outbox

Sales, orders, receipts and counts are written to the phone first — encrypted with ChaCha20-Poly1305 under a key kept
in secure storage, replaced whole on each write so a crash leaves one good copy — and then sent. Each one carries its
own UUID v4 key from the moment it is made, sent with it every time; the office passes it to its API as the
`x-qasa-idempotency` header and remembers the answer, so a change whose answer was lost and which the phone sends again
is made once. Without the office (no Wi-Fi, PC off) it waits and goes by itself; a refusal (no permission, a closed
period) is kept with its reason under More → Waiting to send, to be sent again or deleted.

`src/protocol.ts` is a copy of `pro/src/phone/protocol.ts` (the office side, in the private Pro module). Change it
there, then run `npm run sync-protocol`; `test/link.test.ts` fails when the two differ. The Pro module's
`src/phone/phone-relay.test.ts` runs this app's own link and outbox against the office through a real relay.

## Security

- The phone's key, the office (and its pinned key), who the phone acts as, the app lock and the outbox's key are in
  secure storage, readable only on this phone while it is unlocked; Android backups are off.
- Optional app lock: a PIN of 4 to 8 digits (easy ones refused), kept only as a scrypt hash; fingerprint or face on
  top when the phone has one. It locks after the time chosen in the background (at once, 1 or 5 minutes). Wrong PINs
  make the next try wait longer (30 s, doubling, up to 15 minutes); "Forgot the PIN?" unpairs and wipes the phone.
- The app writes nothing to the log (a test checks), stores nothing in plain storage, and talks only to the office and
  the relay.
- Unpairing tells the office (it removes the phone from Settings → Phones) and wipes the office, the outbox, the lock
  and the phone's key; pairing again makes a new key.

## Design

The desktop app's look (`src/theme.ts`): its navy, blue and orange, its greys, light and dark, every text at WCAG AA
contrast (tested); the desktop's fonts — Noto Sans Arabic for Arabic and Kurdish, IBM Plex Sans for English and
numbers (`assets/fonts`, see NOTICES.md); amounts as on the desktop (Western digits, `1,250,000 د.ع`, `$1,500.00`).
Five tabs (Home, Items, Sell, Customers, More) with their own back stacks and Android's back gesture; loading
skeletons, empty and error states with a retry; 48 dp touch targets; every control labelled for TalkBack and
VoiceOver. Icons are drawn in `src/icons.tsx` and the app icon by `scripts/icons.mjs` from the Qasa mark.

## Develop

This folder is a project of its own (its own `package.json` and lock file), not one of the monorepo's workspaces.

```
cd apps/mobile
npm ci
npm run typecheck
npm test                     # the link, outbox, roles, lock, texts, colours, fonts and settings, against a fake office
npm run lint
npx expo export --platform android   # the JavaScript bundle, as a build makes it
npx expo start               # with a development build on a phone (the camera needs native code: not Expo Go)
npx expo run:android         # a local development build (Android Studio and a phone or emulator)
```

`node scripts/fonts.mjs` remakes the fonts from the monorepo's @fontsource packages; `node scripts/icons.mjs` remakes
the icons.

## Build and publish (Android) — done by the owner

1. Install EAS CLI: `npm i -g eas-cli`, then `eas login` with the Meroxis Expo account (free).
2. In `apps/mobile`: `eas init` once (it adds the project ID to app.json under `extra.eas.projectId`), then commit it.
3. A test APK for phones in the office: `eas build -p android --profile preview`, then install the link it gives.
4. The Play Store build: `eas build -p android --profile production` (an .aab, signed by EAS; let Google Play App
   Signing hold the app signing key, and keep the upload key EAS makes — `eas credentials` shows and downloads it).
5. Google Play Console (a one-time USD 25 developer account, with identity verification): create the app **Qasa ERP**,
   package `iq.qasaerp.mobile`, upload the .aab to Internal testing first, then Production.
6. When the app is in the store, switch the desktop's Settings → Phones from "coming soon" to pairing
   (`PHONE_APP_READY` in apps/web/src/pages/Settings.tsx) in a release of the Windows app.

Play Store listing notes:
- Category: Business. Languages: Arabic (default for Iraq), English, Kurdish.
- Data safety: the app sends data only to the customer's own Qasa PC, on their network or through Qasa Relay,
  encrypted end to end (the relay can't read it); nothing to Meroxis or third parties; no ads, no analytics. The camera
  is used for scanning and item photos only; fingerprint or face only to unlock, handled by the phone.
- Privacy policy URL: https://qasaerp.com/privacy/
- Screenshots: pairing, home with the day's figures, scanning, an item card, the sale, a statement (phone, 1080×1920).

iOS: `eas build -p ios --profile production` needs an Apple Developer account (paid yearly) — not planned for now.
