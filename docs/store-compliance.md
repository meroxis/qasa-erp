# Store compliance answers

> Note for Meroxis: these answers match what the software does as of 7 November 2026. Re-check them whenever a release
> changes what the app sends, and have a lawyer licensed in Iraq review the public policies before publishing. The
> public texts are on qasaerp.com: `/privacy/`, `/terms/`, `/eula/`, `/refunds/`, `/acceptable-use/`, `/data/`,
> `/third-party/` (and the same under `/en/` and `/ku/`).

## Microsoft Store (Windows app, Partner Center)

**Privacy policy URL:** https://qasaerp.com/en/privacy/ (Arabic: https://qasaerp.com/privacy/, Kurdish: https://qasaerp.com/ku/privacy/)

**Does the app collect, store or transmit personal information?** Yes, limited (the Store requires a privacy policy
when an app sends anything over the network):

| What | When | Where it goes | Personal? |
|---|---|---|---|
| Anonymous usage ping: random installation number, version, OS, language, plan, business types, number of companies and users, update channel, first report or not, a one-time nonce (not stored; never the licence number) | Daily; switchable off in Settings | my.qasaerp.com | No; never linked to a licence or a portal account |
| Licence activation: licence key, hashed PC ID, PC name, app version, invoice public key | Once per PC, then about monthly | my.qasaerp.com (IP and country kept with the activation) | Yes (PC name, IP) |
| Cloud backup (optional): encrypted backup files | Daily when connected | The customer's own Google Drive / OneDrive | Encrypted; Meroxis never receives it |
| Qasa Relay (optional): encrypted office-network traffic | When switched on | Meroxis relay server (cannot read it) | IP addresses and times |
| Website API (optional): data the customer allows | When the customer creates keys | The customer's own website | Customer's choice |

The company's books stay on the PC (or the company's own database server) and are never sent to Meroxis.

**Store listing — data collection declaration (suggested text):**
"Qasa ERP keeps your company's books on your own computer. It sends an anonymous daily usage statistic (which you can
switch off), and, for paid plans, activates the licence online. Optional features (cloud backup, office network over
the internet, website API) send data only when you turn them on. See qasaerp.com/privacy."

**Capabilities declared** (apps/desktop/build/appxmanifest.xml): `runFullTrust` (a desktop Electron app) and
`unvirtualizedResources` (the company file stays in %APPDATA%\Qasa ERP, shared with the installer version). Both are
restricted capabilities; the justification for certification: "Qasa ERP is a full-trust desktop accounting app; the
company's books are kept in the user's AppData folder so the Store and installer versions open the same company file."
As a full-trust app it uses the network without separate capability declarations: activation, usage ping, relay,
office network and phone link. Windows asks the user to allow the app on the network the first time the office server
or phone link starts.

**Age rating (IARC questionnaire):** business software; no violence, no user-to-user communication with strangers, no
purchases inside the app (licences are bought on the website), no location sharing → expected rating: 3+ / Everyone.

**In-app purchases:** none in the Store. Licences are sold on my.qasaerp.com; the Store listing should say "Free; Pro
and Business licences are available from qasaerp.com" (licences are not sold through the Store, so Store purchase
policies don't apply).

## Google Play (Qasa phone app, package `iq.qasaerp.mobile`)

The phone app is not in 1.0 (owner decision): nothing is submitted to Google Play for 1.0. Keep this section for its
later release.

**Privacy policy URL:** https://qasaerp.com/en/privacy/ (section "The Qasa phone app").

**Data safety form:**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No data collected by the developer.** The app sends data only to the user's own office PC (their own Qasa ERP), end-to-end encrypted, directly or through the Qasa Relay which can't read it. Google's definition of "collection" covers data sent off the device to the developer or third parties; data sent to the user's own server under their control is not collected by Meroxis. If Google's reviewer disagrees, declare: Photos (item photos), App activity (scans) — "collected, not shared, processed ephemerally: No, required: No, purpose: App functionality". |
| Is all data encrypted in transit? | Yes (own end-to-end encryption: X25519 + ChaCha20-Poly1305) |
| Can users request that data be deleted? | Yes — data lives in the user's own Qasa ERP; unpairing deletes the keys on the phone, and queued items are deleted with the app |
| Ads | None |
| Analytics / crash SDKs | None |
| Account creation | None in the app (pairing with the office by QR code) |

**Permissions and why:**

| Permission | Why | When requested |
|---|---|---|
| `CAMERA` | Scan barcodes and the pairing QR code; take item photos when the user chooses "Add photo" | When the user opens the scanner or the photo step |
| `INTERNET` | Connect to the office PC (Wi-Fi or the relay) | Install time (normal permission) |
| `VIBRATE` | Short vibration when a code is scanned | Install time (normal permission) |

No location, contacts, microphone, storage or background permissions.

**Content rating questionnaire:** Utility / productivity; no violence, sexual content, gambling, or user-generated
content shared with others; no purchases in the app → expected rating: Everyone / PEGI 3.

**Target audience:** adults (18+), businesses. Not designed for children.

**App access for review:** Google's reviewers need a working office to pair with. Provide in "App access": a short
video of pairing and scanning, and, if requested, a demo office (a Qasa ERP install with the trial, reachable through
the relay) with its office ID and a pairing QR code generated on request.

**Store listing:** Arabic, English and Kurdish (Sorani; Play supports `ckb` only as a custom listing language — use
Arabic as default for Iraq if `ckb` isn't offered). Screenshots: phone 1080×1920 or larger, in each language.
