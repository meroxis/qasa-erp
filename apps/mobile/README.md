# Qasa ERP phone app

The Qasa phone app for companies on Starter, Pro or Business (and the free trial), for sales reps (mandoob) and owners.
Arabic, English and Kurdish (Sorani), right to left in Arabic and Kurdish, light and dark.

Plans (`packages/core/src/plans.ts` and the Pro module's own table, `pro/src/entitlement.ts`, both list `phoneApp`
for Starter, Pro and Business; the office checks it on every message, `pro/src/phone/phone.ts`): up to 3 phones on
Starter, Pro and the trial, no limit on a Business licence. Starter has no Qasa Relay, so its phones reach the office
on the office Wi-Fi only; on Pro and Business they also reach it from anywhere through the relay.

Expo (SDK 58) and React Native, TypeScript. Android first; iOS builds from the same code. It works with the office
PC on Qasa ERP 1.4.2 or later with the Pro module (the first release whose Settings → Office network → Phones (Qasa
app) pairs a phone; the routes it calls and the rules below are those of 1.4.1). Version 1.0.2 is offered as a signed
APK on https://qasaerp.com/phone/ (Google Play later), and the desktop from 1.4.3 offers it too (`PHONE_APP` in
apps/web/src/pages/Settings.tsx). 1.0.2 no longer sends ML Kit's own usage reports to Google (the codes scanned never
go to Google; see "Scanning and Google") and tells the office its version; 1.0.1 keeps working (the PC lists it as
"1.0.1 or older", with a note that a newer one is out); 1.0.0 was built before the required PIN and is not offered.

Version 1.1.0 (versionCode 5) adds seven features for the owner, the managers and the staff (the last eight rows
below). Each shows only when the office PC offers it: the office release that comes with it says in the phone's "who
am I" what its phone link offers (`phoneLink`: its version, the features, the largest photo it takes). An office on
1.4.x says nothing of the kind: the phone then offers what 1.0.2 does, and tells the owner and admins on Home that
Qasa ERP on the office PC needs the latest version for the rest. Phone 1.0.x keeps working with the newer office (its
routes and answers are unchanged; the new fields are read past). 1.1.0 goes on qasaerp.com/phone/ only with or after
that office release, so the update the phone asks for exists.

Version 1.2.0 (versionCode 6, not built or released yet) adds one thing to "New item": the item's picture and name
suggestions looked up by its barcode, and a picture chosen from the phone's gallery. The phone asks only its office
(`POST /api/items/lookup` with the barcode, through the phone link); the office looks the barcode up in the open
product databases (Open Food Facts and its sister projects) when its admin has switched that on (Qasa ERP 2.1,
docs/product-lookup.md). It shows only when the office offers it (`phoneLink.offers` has `itemLookup`) and the user
may add items; with any other office the screen is as in 1.1.0. Phone 1.1.0 keeps working with the newer office: it
never calls the new route, and the picture it saves is sent as before (the new `lookupBarcode` field is optional).

What a 1.2.0 build needs before it goes to phones (nothing here was built: the steps of "Build" below, plus):
- `npx expo prebuild` after `npm install`: 1.2.0 adds one native module, `expo-image-picker` (the gallery, through
  the system's own picker). Check the manifest the build prints (scripts/check-release-apk.mjs lists the APK's
  permissions): still only CAMERA, VIBRATE and USE_BIOMETRIC; no storage, media or microphone permission (app.json
  blocks them, and the plugin is set with `microphonePermission: false`).
- Add the module to NOTICES.md ("Components", from the release build's dependency tree) once the APK exists.
- Try on a phone: scan a new product with an office that has the lookup on (picture ticked, names as chips, save,
  the credit on the office's price checker), with the lookup off, with an office on 2.0 (no lookup shown), without
  internet at the office ("No picture found"), a photo, a picture from the gallery, removing it.
- Offer it from the office release that comes with it: `PHONE_APP` in apps/web/src/pages/Settings.tsx (version,
  size, SHA-256) and qasaerp.com/phone/, as for 1.1.0.

## What it does

Each phone works as the Qasa user it was paired for, and offers what that user's role allows (the office checks every
request again with the user's own permissions):

| Feature | Who sees it |
| --- | --- |
| Home: today's sales, the month, cash in the safes, what customers owe, late customers, items running low | the owner (no sign-in at the office), admin, the accountants (preparer, checker, approver) and viewer |
| Items: by barcode (camera, with the torch) or by name; price, wholesale and shelf (car parts), stock per warehouse | everyone |
| New item with its photo | stock permission |
| 1.2 — New item: its picture and name suggestions found by the barcode (the office asks the open product databases, when its admin has switched that on; a name is filled only when tapped, the picture can be unticked), or a picture from the gallery | stock permission, with an office that offers it |
| Sell: a quick sale sent as a draft invoice, or an order sent as a quote. A sale is Cash or Credit as a whole, one way per sale, as on the desktop's till and invoice (1.4): cash from a walk-in or a named customer, credit only to a chosen customer | sales permission |
| Customers: balance, statement (this month, 3 months, this year) | sales, the accountants, admin, viewer |
| Collect: money received from a customer, as a receipt voucher (see below) | the preparer's permission (give a rep both roles: sales and preparer) |
| Count stock: straight into the warehouse's open count on the PC (stock permission), else a list for the admin in Settings → Office network → Phones | everyone |
| 1.1 — Approvals: what waits for approval or to be checked; approve, reject with a reason, check, approve a checked entry or return it, with the office's own actions and rules (separate duties, the period lock); online only; a voucher changed after the phone showed it is refused and shown again; an expense's receipt photo | the owner, and users who approve or check vouchers (`entries.approve`, `entries.check`) |
| 1.1 — Home's figures: also the customers who owe the most (from an office of 1.4.x: the late customers, as before) | as Home above |
| 1.1 — Dollar rate: today's rate and the last 7 days; setting today's rate, with the office's range and log as on the desktop's rates, asked first when it is over 5 % from the last | read: everyone; set: the owner and admin only (stricter than on the PC) |
| 1.1 — End of day: sales by payment method, each register's expected and counted cash, debts collected and added, by day; read only | the owner and the roles that see the figures: the whole day; a user with the sales permission: only the registers they opened, with their shifts' sales and debts (the phone asks with `mine=1` and the office enforces it) |
| 1.1 — Expense with the photo of its paper receipt: a payment voucher on the company's expense account for its kind, by the office's approval rules (posted, waiting for approval, or a draft); a dollar expense at the office's rate of its day; works without the office (the photo waits sealed in the outbox) | the preparer's permission |
| 1.1 — An invoice or a statement as a PDF: a customer's posted sale invoices (3 months) and the statement, made on the phone from the office's data in the company's print look as far as practical, handed to Android's share sheet (WhatsApp or any app the user picks); "Open the customer's chat" with the desktop's message | sales, the preparer, the accountants, admin, viewer |
| 1.1 — Move stock between warehouses by scanning: a transfer draft, posted at once from the phone when the office is there (a draft that waited in the outbox is posted on the PC) | stock permission |
| 1.1 — Receive goods by scanning against an open purchase order: a draft purchase invoice at the order's prices (the phone never sees them), checked and posted on the PC | stock or purchases permission |

Sales, orders and counts reach the office as drafts and are checked on the PC as the office already works. A receipt
follows the office's 1.4.1 rule for vouchers: with **Vouchers need approval** on, it waits for approval unless the
phone's user may approve vouchers (then it is posted at once, as on the PC; never under "Separate duties"); with the
setting off it is a draft, checked and approved on the PC. The phone says which: posted, or counted once approved.

Cost stays with those who may see it, by the office's own rule (`packages/server/src/cost-view.ts`, 1.4): every
request from a phone runs through the office's API as the phone's user, so a user who neither keeps nor reads the
books gets no purchase price, cost, stock value, profit or safe balances, and the day's figures (which hold the safes)
are not opened to such a user's phone at all (`FIGURES_ROLES` in `pro/src/phone/phone.ts`). From office 1.4.3 a phone
gets cost only when it keeps a PIN (the owner's, and those of `FIGURES_ROLES`: the same rule as the figures and
`lockRequired`): a storekeeper's or a buyer's phone gets each answer as a user without the books does on a PC, though
that user sees cost on a PC (`phoneView` in `pro/src/phone/phone.ts`, tested for every route a phone may call). The app
shows no cost or profit anywhere, and leaves out the safes when an office does not send them.

## How it reaches the office

The phone is paired once: on the Qasa PC, **Settings → Office network → Phones (Qasa app) → Add a phone** shows a QR
code. It holds the office's addresses on the Wi-Fi, the port of the phone link (47421), the office's Qasa Relay ID (when the office is on the
relay), the office's public key and a one-time pairing secret (valid 2 minutes, for one phone). The app checks the code before using
anything in it (`src/pairing.ts`). The phone makes its own key (kept in the Android Keystore / iOS Keychain through
expo-secure-store) and connects over a WebSocket: each Wi-Fi address first, then `wss://relay.qasaerp.com/v1/phone`.

Everything on the wire is encrypted and authenticated by `src/protocol.ts`: X25519, HKDF-SHA256 and
ChaCha20-Poly1305 from @noble (audited, pure JavaScript), with forward secrecy and a counter on every message (a replayed
or altered message ends the session). The office's key from the QR code is pinned, as the desktop pins the office
server's certificate: a PC or a relay that can't prove that key gets nothing, on the Wi-Fi and through the relay alike.
The relay only carries bytes it can't read. Plain `ws://` on the office network is fine for that reason. From 1.0.2
the first message also says the app's version and build (`app.json`'s `version` and `android.versionCode`); both are
optional both ways (an office before 1.4.3 does not read them, an app before 1.0.2 does not send them), and the office
only shows them in its list of phones: it never refuses a phone for its version.

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

From 1.1 expenses, stock transfers and goods that arrived wait there too. An expense's receipt photo waits beside it
as a file of its own, sealed the same way and bound to its item (a photo moved to another item does not open), and
goes with it; at most 10 photos wait at once. One arrival per purchase order may wait, dated the day it was scanned.
Approvals and the dollar rate never wait: they need the office, and each action keeps one key for every try of it,
so an answer lost on the way never turns into a second action.

`src/protocol.ts` is a copy of `pro/src/phone/protocol.ts` (the office side, in the private Pro module). Change it
there, then run `npm run sync-protocol`; `test/link.test.ts` fails when the two differ. The Pro module's
`src/phone/phone-relay.test.ts` runs this app's own link and outbox against the office through a real relay.

## Security

- The phone's key, the office (and its pinned key), who the phone acts as, the app lock and the outbox's key are in
  secure storage, readable only on this phone while it is unlocked; Android backups are off.
- App lock: a PIN of 4 to 8 digits (easy ones refused), kept only as a scrypt hash; fingerprint or face on top when
  the phone has one. It is required (asked for before anything shows, and it can't be turned off) when the phone
  works as an admin, as the owner (an office without sign-in) or as a user who sees the figures (`lockRequired` in
  `src/roles.ts`, from 1.0.1); for other users it is optional. It locks after the time chosen in the background (at once, 1 or 5 minutes). Wrong PINs
  make the next try wait longer (30 s, doubling, up to 15 minutes); "Forgot the PIN?" unpairs and wipes the phone.
  From 1.1, approving, setting the rate, recording an expense and seeing the whole day's close are for those users
  only (the office's phone link allows them only to a phone of the same roles), so every phone that can do them keeps a
  PIN; tests on both sides hold it for every mix of roles.
- The app writes nothing to the log (a test checks), stores nothing in plain storage, and connects only to the office
  and the relay (the scanner's brief usage statistics go to Google Play services on the phone: see "Scanning and
  Google").
- Receipt photos (1.1) are taken with the app's own camera view (no gallery or storage permission), made again on the
  phone at most 1600 px a side without the photo's EXIF data (so without the location), and sent only to the office.
  The office takes a JPEG of at most 400 KB and 2048 px a side only, removes any metadata again, and keeps the photo
  with its voucher in the company's books (and so in the company's backups); a posted voucher's photo can't be changed
  or deleted.
- PDFs (1.1) are made on the phone from what the office sends and handed only to the app the user picks in Android's
  share sheet. The last one stays in the app's own cache until the next share, the next start, or 10 minutes after
  (deleting it at once could leave WhatsApp without the file, which it reads when the user sends). The app itself
  still connects only to the office and the relay: "Open the customer's chat" hands a wa.me link to WhatsApp or the
  browser when the user taps it.
- From 1.1 every change a phone makes is in the office's audit log (which phone, as whom, which route; never what it
  sent).
- Unpairing tells the office (it removes the phone from Settings → Office network → Phones) and wipes the office, the
  outbox, the lock and the phone's key; pairing again makes a new key.

### Scanning and Google (1.0.2)

Scanning uses Google ML Kit's barcode scanner, bundled in the app (its models and native library are in the APK and
run on the phone; nothing is needed from Google to read a code). **The codes scanned never go to Google:** ML Kit reads
them on the phone, and the app sends them only to the office.

- **ML Kit's own usage reports are removed from 1.0.2.** ML Kit also reports how it is used straight to Google
  (firebaselogging.googleapis.com) through Google's data transport library; 1.0.1 shipped that sender.
  `plugins/with-no-usage-metrics.js` keeps it out of every build since 1.0.2: Google's sender (`transport-backend-cct`)
  is left out and the app's own `plugins/no-usage-metrics/CCTDestination.java` takes its place (no backend, no
  address: the reports are dropped on the phone before they are stored), the transport's scheduler service, alarm
  receiver and backend list are taken out of the manifest, and Google's ready-made code scanner and document scanner
  (which the app never opens) are left out with the "barcode_ui" module Play services would download for them.
  `scripts/check-release-apk.mjs` checks each APK for all of it (see "Build an APK on this PC").
- **Google Play services may still receive brief scanner usage statistics.** After each detection, ML Kit's barcode
  client also logs brief usage statistics through Google Play services' own client telemetry (the API "mlkit:vision"):
  which API ran, its result, and when it started and ended; never the scanned code. Google Play services, outside the
  app, may send them on to Google. 1.0.2 does not remove them: the app has no analytics of its own, but these brief
  statistics about scanning may still reach Google.

## Design

The desktop app's look (`src/theme.ts`): its navy, blue and orange, its greys, light and dark, every text at WCAG AA
contrast (tested); the desktop's fonts — Noto Sans Arabic for Arabic and Kurdish, IBM Plex Sans for English and
numbers (`assets/fonts`, see NOTICES.md); amounts as on the desktop (Western digits, `1,250,000 د.ع`, `$1,500.00`).
Five tabs (Home, Items, Sell, Customers, More) with their own back stacks and Android's back gesture; loading
skeletons, empty and error states with a retry; 48 dp touch targets; every control labelled for TalkBack and
VoiceOver. Icons are drawn in `src/icons.tsx` and the app icon by `scripts/icons.mjs` from the Qasa mark.

## Develop

This folder is a project of its own (its own `package.json` and lock file), not one of the monorepo's workspaces:
the root `npm ci` does not install its packages. Run `npm ci` here first in every checkout or worktree; without it,
`tsc` or an editor reports the app's own packages (@noble, expo) as missing.

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

## The release key

Every build of the app that phones install is signed with one key: the **Qasa release key** (RSA 4096, valid 30
years, alias `qasa-mobile`). It is kept on the owner's PC, outside every repository, in `%USERPROFILE%\.qasa-keys\`
(`qasa-mobile-release.jks`, and its password in `qasa-mobile-release.password` beside it; only the owner's Windows
account may read the folder). **Keep this key and its password for as long as the app exists, with a copy offline
(an encrypted USB stick in a safe place).** Android installs an update only when it is signed with the same key as
the app on the phone: without it no phone can be updated, and every phone would have to uninstall the app (losing its
pairing and anything not yet sent) to take a build signed with another key. Never commit it, mail it or put it in a
chat; nothing in this folder holds it or its password (`plugins/with-release-signing.js` reads both from the
environment at build time).

## Build an APK on this PC (no Expo account, no Google Play)

Needs Node 24, JDK 17 and an Android SDK with platform `android-37.0`, build-tools `37.0.0` and NDK `27.1.12297006`
(what React Native 0.88 asks for). Windows stops paths at 260 characters (unless long paths are switched on for the
PC), and the native part of the build writes long ones: build from a copy of this folder at a short path (for example
`E:\qm`, made with `robocopy apps\mobile E:\qm /E /XD node_modules android .expo dist`; a `subst` drive does not work,
Node resolves it back to the long path) and run `node scripts/short-native-paths.mjs` there after `npm ci`. In Git Bash:

```
cd /e/qm                                              # the short copy (on Linux or macOS: apps/mobile itself)
npm ci
node scripts/short-native-paths.mjs                   # Windows only: see above
npx expo prebuild -p android --clean --no-install     # writes android/ (not in git: it is made again each time)
                                                      # (prebuild rewrites the android/ios scripts of package.json: never commit that)
export JAVA_HOME=<JDK 17>  ANDROID_HOME=<the SDK>  ANDROID_SDK_ROOT=<the SDK>  NODE_ENV=production
export QASA_ANDROID_KEYSTORE=$USERPROFILE/.qasa-keys/qasa-mobile-release.jks
export QASA_ANDROID_KEYSTORE_PASSWORD_FILE=$USERPROFILE/.qasa-keys/qasa-mobile-release.password
(cd android && ./gradlew assembleRelease)
# → android/app/build/outputs/apk/release/app-release.apk
node scripts/check-release-apk.mjs android/app/build/outputs/apk/release/app-release.apk
```

Without `QASA_ANDROID_KEYSTORE` a release build stops at its first step with a message (from 1.0.2: before, it was
signed with React Native's public debug key without a word, and phones could never update from such an APK). Only an
EAS build (`EAS_BUILD=true`, set by EAS, which signs with the credentials it keeps) or a local test build asked for by
name (`QASA_ANDROID_DEBUG_SIGNED=1`, signed with the debug key; never hand it out) goes on without it.

`scripts/check-release-apk.mjs` must say OK before an APK goes anywhere. It runs apksigner and aapt2 from the SDK's
newest build-tools (it needs `JAVA_HOME` and `ANDROID_HOME`) and refuses the APK when the signature does not verify,
when it is not signed by exactly one certificate, the Qasa release key's (`RELEASE_CERT_SHA256` in the script, the same
as `PHONE_APP.certSha256` in apps/web/src/pages/Settings.tsx: a test keeps them equal), when its version is not
app.json's, or when anything of ML Kit's own usage reports (the sender 1.0.1 had) or the two unused scanners is in its
manifest, its code or its files (the scanner statistics ML Kit gives Google Play services stay, and are not checked:
see "Scanning and Google"). It prints the APK's SHA-256 and size (for `PHONE_APP` and the download page), its SDK
levels and permissions. It reads only the APK: never the key or its password.

Raise `version` in app.json (and `versionCode` with it: Android refuses an update with the same or a lower
versionCode; prebuild writes it from `android.versionCode` in app.json, 1 when it is not set) for each build that goes
to phones already running the app.

Installing on a phone (side-loading, for the office's own phones while the app is not in the store): copy the .apk to
the phone (USB, or a link the owner sends), open it, allow "Install unknown apps" for the app that opens it (Files or
the browser) when Android asks, then Install. Play Protect may say it does not know the developer: "Install anyway".
Or with a USB cable and USB debugging on: `adb install -r qasa-erp-mobile-<version>.apk`.

## Publish on Google Play — done by the owner

1. Install EAS CLI: `npm i -g eas-cli`, then `eas login` with the Meroxis Expo account (free).
2. In `apps/mobile`: `eas init` once (it adds the project ID to app.json under `extra.eas.projectId`), then commit it.
3. Give EAS the Qasa release key, so its builds are signed like the APKs already on phones: `eas credentials` →
   Android → production → Keystore → "Set up a new keystore" → upload `qasa-mobile-release.jks` (alias `qasa-mobile`,
   the password from the file beside it). Do not let EAS make a new key.
4. A test APK for phones in the office: `eas build -p android --profile preview`, then install the link it gives.
5. The Play Store build: `eas build -p android --profile production` (an .aab, `versionCode` counted up by EAS).
6. Google Play Console (a one-time USD 25 developer account, with identity verification): create the app **Qasa ERP**,
   package `iq.qasaerp.mobile`. Under Play App Signing choose to use your own key and upload the Qasa release key the
   way the Console shows (its encryption tool), so phones that took a side-loaded APK update from Google Play; if
   Google's own key is chosen instead, those phones must uninstall the side-loaded app first. Then upload the .aab to
   Internal testing first (see the checklist below), then Production.
7. Done in 1.4.2 for the direct download: the desktop's Settings → Office network → Phones (Qasa app) offers the app
   (`PHONE_APP` and `PHONE_APP_READY` in apps/web/src/pages/Settings.tsx, tested by
   apps/web/src/pages/phones-app.test.tsx); 1.4.3 offers 1.0.2. When the app is in the store, add the Google Play link
   there and on qasaerp.com/phone/.

### Checklist: the first internal-testing build

- [ ] The release key and its password are copied offline (see "The release key").
- [ ] Expo: `eas login`, `eas init` committed, the release key uploaded with `eas credentials` (step 3).
- [ ] `npm ci`, `npm run typecheck`, `npm test`, `npm run lint` and `npx expo export --platform android` pass here.
- [ ] `eas build -p android --profile production` finished; the .aab downloaded.
- [ ] Play Console: developer account verified; app **Qasa ERP** created (default language Arabic, free, Business).
- [ ] App content filled in: privacy policy URL, Data safety (notes below), ads: none, target audience: adults
      (18+), content rating questionnaire, app access: "pairing with a Qasa PC is needed" with how a reviewer
      can test (a Qasa ERP trial on a PC and its Settings → Office network → Phones (Qasa app)).
- [ ] Testing → Internal testing → a tester list (the owner's and the office's Google accounts) → new release →
      upload the .aab → release name 1.0.2 (versionCode 3 or higher: EAS counts it up) → roll out.
- [ ] On a phone: open the opt-in link from the tester list, install from Google Play, and pair it with the released
      Qasa ERP (1.4.2 or later, no test build needed) with the Pro module, then try: scan, a cash sale, a credit sale
      (with and without a customer), a receipt with "Vouchers need approval" on and off, a count, the app lock,
      unpairing — in Arabic, English and Kurdish. On a 1.4.3 PC the phone's line in the list of phones shows 1.0.2.
- [ ] Then Production (or a closed test first), and step 7.

Play Store listing notes:
- Category: Business. Languages: Arabic (default for Iraq), English, Kurdish.
- Data safety: the app sends the user's data only to the customer's own Qasa PC, on their network or through Qasa
  Relay, encrypted end to end (the relay can't read it); nothing to Meroxis; no ads and no analytics of our own. The
  codes scanned never go to Google. ML Kit's own usage reports to Google are removed from 1.0.2 (1.0.1 had them), but
  Google Play services may still receive brief scanner usage statistics from ML Kit (which API ran, its result and
  timings, never the code; see "Scanning and Google"): declare those as Google's guidance for ML Kit says when the
  form is filled in (docs/store-compliance.md). The camera is used for scanning, item photos and (1.1) receipt photos
  only; fingerprint or face only to unlock, handled by the phone. 1.1: receipt photos go only to the customer's own
  office, with the expense (collected for the app's function, not shared); invoices and statements are shared as PDFs
  only by the user's own action, to the app the user picks.
- Privacy policy URL: https://qasaerp.com/privacy/
- Screenshots: pairing, home with the day's figures, scanning, an item card, the sale, a statement (phone, 1080×1920).

iOS: `eas build -p ios --profile production` needs an Apple Developer account (paid yearly) — not planned for now.
