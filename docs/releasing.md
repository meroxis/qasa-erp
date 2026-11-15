# Releasing Qasa ERP

The Windows app updates itself from the GitHub releases of `meroxis/qasa-erp` (electron-updater). Copies from the Microsoft Store update through the Store.

There are two channels:

| | Stable | Beta |
|---|---|---|
| Version and tag | `0.2.0`, tag `v0.2.0` | `0.2.0-beta.1`, tag `v0.2.0-beta.1` |
| GitHub release | normal, marked **Latest** | **prerelease**, never "Latest" |
| Update file | `latest.yml` only (beta copies read it too) | `beta.yml` |
| Who gets it | everyone, including beta testers | only copies that joined the beta |
| Microsoft Store package | yes (workflow artifact) | no |
| Website download link (`releases/latest/download/Qasa-ERP-Setup.exe`) | moves to this version | unchanged |

`.github/workflows/release.yml` accepts only the two tag forms `vX.Y.Z` and `vX.Y.Z-beta.N`. Other forms such as `-rc.1` or `-alpha` are refused.

## What the user sees

- **Download.** Updates download in the background. A calm bar at the top of the window shows "Qasa ERP X.Y is available — downloading…" with a progress bar.
- **Ready to install.** The bar offers three buttons:
  - **Restart to update.** Qasa closes the company file cleanly, installs and reopens.
  - **What's new.** Shows the release notes in the user's language.
  - **Later.** Hides the bar until the next start. The update still installs when the app is closed.
- **No forced restarts.** Qasa never restarts by itself.
- **Settings → Updates.** Shows:
  - the version;
  - the last check;
  - **Check now**;
  - **Join the beta**.
  - In the Store copy, the card says that updates come from the Microsoft Store and has a Store button.
- **Timing.** Checks run 15 seconds after start and then every 6 hours.
- **Saved choice.** The channel choice is kept in `%APPDATA%\Qasa ERP\updates.json`.

## Cutting a stable release

1. Set `"version"` in `apps/desktop/package.json`, for example `0.2.0`.
2. Write `apps/desktop/release-notes/0.2.0.md` in the format below.
3. Update the Store "What's new" text in `apps/desktop/store-listing.json`. It may already hold a draft for this version: write the version's items in place of its `{{0.2.0}}` line and keep the rest (such as a line for a version the Store skipped). If the release takes another number than the draft names, change the draft's number too. `release-config.test.ts` fails while a placeholder is left in the text of the version the app is on, and while the text names a version older than the app's. The one exception is a release that goes to GitHub and the website only (as 1.5.1 did): leave the Store text as it is, and write in that version's "Release day" section below that the Store stays on the version the text names (for example "the Store stays on 1.5.0"); skip step 7 for it.
4. **Tag the Pro module first.** Merge the Pro feature branch into Pro `main`, then push the tag `v0.2.0` on `meroxis/qasa-erp-pro` at that merge commit. `release.yml` checks out Pro at the tag of the same name as the app tag (never Pro's default branch), so a missing Pro tag stops the release run at the Pro checkout, and an unmerged Pro branch is never shipped by accident:

   ```
   cd pro
   git checkout main && git merge --no-ff feature/<branch> && git push origin main
   git tag v0.2.0 && git push origin v0.2.0
   ```

5. Commit the app, then tag and push it (after the Pro tag):

   ```
   git tag v0.2.0 && git push origin v0.2.0
   ```

6. The workflow then:
   - builds and tests in a job that can only read the repository (no token that writes releases): the app's and the
     Pro module's type checks and tests (with the phone app's packages, for the phone-through-the-relay test, and PHP
     with openssl and sodium, for the PHP client and WooCommerce plugin tests), and the audit of the packages the app
     and Pro ship;
   - goes on at once, with no approval step: the `release` environment has no required reviewer (the owner's choice),
     so pushing the app tag is the decision to release. A second job that runs no project code checks the files
     against the build's checksums and uploads them;
   - publishes the release as **Latest**;
   - moves the website link;
   - keeps the `microsoft-store-package` artifact.
7. Submit that package in Partner Center.

## Cutting a beta

1. Set the version to the next stable version plus `-beta.N`, for example `0.2.0-beta.1`. A beta must sort **above** the current stable version (`0.2.0-beta.1` > `0.1.8`) or nobody gets it.
2. Write `apps/desktop/release-notes/0.2.0-beta.1.md`. Say what to test and what is known to be broken.
3. Push the same tag `v0.2.0-beta.1` on `meroxis/qasa-erp-pro` first, at the Pro commit the beta should carry (the release run checks out Pro at that tag). Then tag the app and push:

   ```
   git tag v0.2.0-beta.1 && git push origin v0.2.0-beta.1
   ```

4. The release appears as a GitHub prerelease. Only beta testers are offered it.
5. For the next round, use `0.2.0-beta.2`, and so on.

**Database migrations in a beta.** A beta that changes the database format writes books that an older stable version refuses to open (the `database_newer` check). Testers who leave the beta must wait for the stable release that contains the migration. Say so in the notes, and remind testers to back up first.

## Promoting a beta to stable

When the last beta is good, release the **same code** as `0.2.0`:

1. Set the version to `0.2.0` and write `release-notes/0.2.0.md`. This is the full list of changes since the last stable, not only the last beta's.
2. Push the tag `v0.2.0` on `meroxis/qasa-erp-pro` (Pro `main`, merged), then tag `v0.2.0` here and push.

Beta testers get `0.2.0` too. With GitHub releases each release has one update file, so a stable release writes only `latest.yml`; a copy on the beta channel also reads `latest.yml` (electron-updater falls back to it when prereleases are allowed). They stay on the beta channel for the next betas.

Do not edit a beta release into a stable one on GitHub. Its files only carry the beta channel, and its version has the `-beta` suffix.

## How testers join and leave

- **Join.** Settings → Updates → Beta → **On**, read the warning, then **Join the beta**. The warning says:
  - bugs are possible;
  - back up the company first (Settings → Backup);
  - you can leave any time.
- **Check.** Qasa checks for a beta at once after joining.
- **Leave.** Set Beta to **Off**. Qasa never downgrades:
  - The tester stays on the beta they have.
  - The next **stable** version newer than it replaces it. For example, `0.2.0-beta.3` waits for `0.2.0`.
  - To go back sooner, take a backup and reinstall the stable installer from the website.
- **Store copies.** These can't join the beta, because the Store has its own updates.
- **Beta builds.** A copy installed from a beta installer starts on the beta channel.

## Release day for 1.0 (the first release with online activation and the relay behind Cloudflare)

Do these in this order, before and after the stable steps above.

1. **Qasa Relay first** (`pro/relay/README.md` has every command). The new relay takes both the WebSocket connections of 1.0 and the old `qasa-relay` ones of 0.1.8/0.1.9, so deploy it before the app.
   - **DNS.** `relay.qasaerp.com` is the name for PCs and offices (WebSocket through Cloudflare and Caddy on 443; phones too, once the phone app ships). It stays grey (DNS only) at first and turns orange (proxied) only once the offices and PCs on 0.1.8/0.1.9 have updated, because Cloudflare carries only WebSocket upgrades. There is no second, DNS-only name (it would publish the VPS's address): websites (the PHP client and the WooCommerce plugin 1.1.0) send each call as an ordinary HTTPS request sealed for the office key, through Cloudflare like everything else.
   - **systemd.** `RELAY_HOST=127.0.0.1` (only Caddy on the VPS reaches the relay; port 8790 is never public) and `TRUST_PROXY=1`. Set `RELAY_REQUIRE_ACTIVATION=1` only after the offices are on 1.0: 0.1.8/0.1.9 offices send no activation token and would be refused. Until then a revoked licence or a released seat keeps relay access while the licence key itself is valid.
   - **Firewall (ufw).** SSH; 80 and 443 from Cloudflare's IP ranges only, once the name is orange (from everywhere while it is still grey). Nothing else: 8790 stays closed.
   - **Cloudflare.** WebSockets on; SSL/TLS Full (strict). **Bot Fight Mode off** for the zone (the Free plan can't skip it per host; on a paid plan a WAF skip rule for `relay.qasaerp.com` will do), no **Under Attack** mode and no **Browser Integrity Check** for the relay host. Otherwise Cloudflare answers the apps' WebSocket upgrades with a challenge page, and offices and PCs can't connect.
   - **Check:** `curl https://relay.qasaerp.com/health` answers `{"ok":true,"app":"qasa-relay"}`.
2. **Licences from 0.1.8.** They were entered before activation existed and hold no activation token. After the update such a licence keeps counting for 30 days from the company's first start in 1.0 (sealed in the company file as `activation_grace_from`, and per PC in the app's own folder), while the app activates it online by itself (at most one try an hour). After those days it asks for activation; the data always stays open.
   - **Before tagging 1.0, import every licence issued offline** (`licensing/issue.mjs`) on the portal. The portal answers `unknown_licence` for a key it does not know, so such a customer cannot be activated by the app and drops to Free when the 30 days end.
3. **Release notes** (`apps/desktop/release-notes/1.0.0.md` and the Store "What's new", ar/en/ku): tell the 0.1.8 licence holders to connect the PC to the internet once in the first month so the licence is activated.
4. **The phone app is not in 1.0** (owner decision). Don't name it in the release notes, the Store text or the website as available; the app shows it as coming soon, and the Google Play listing waits for a later release.
5. **Dates.** There is no release-date constant to set: trials from 0.1.x carry over when they started on or before the company's first start in 1.0, whatever the calendar date of the release.

## Release day for 1.4.2 (the hardened Qasa Relay and the phone app)

Do these in this order. The 1.4.2 notes and the Store "What's new" promise things that only hold once each step is done.

1. **Deploy the 1.4.2 Qasa Relay first** (`pro/relay/relay.ts`, steps in `pro/relay/README.md`), before the GitHub
   release and before the Store submission. It takes offices from 1.0 to 1.4.1 as before. Only this relay gives the
   staff's proven connections their place when strangers crowd an office's connection, and carries its half of the
   small-frames fix. If the relay can't be deployed first, take the "keep their place" sentence out of the 1.4.2 notes
   and the Store "What's new" (all three languages) before tagging.
   **Check:** `curl https://relay.qasaerp.com/health` answers `{"ok":true,"app":"qasa-relay"}` from the new build.
2. **The phone app 1.0.1** (`apps/mobile`, built from the release branch as the phone app's README says). It is the
   first build with the PIN that can't be turned off; 1.0.0 is never offered. Its SHA-256 is in `PHONE_APP`
   (`apps/web/src/pages/Settings.tsx`) and on the website's /phone/ pages, and they must match the file uploaded.
3. **Tag Pro, then the app** (the stable steps above), and submit the Store package.
4. **The website** (the phone app pages, `softwareVersion` 1.4.2) goes live only once the 1.4.2 GitHub release is out
   and the Store submission is live: a 1.4.1 office can't pair a phone, so the download page must not come first.
5. **WooCommerce plugin 1.1.2** goes to shops on request from then on (it takes only the 32-character certificate code
   or the full fingerprint).

## Release day for 1.5.0 (1.4.3 and the phone app 1.1)

1.4.3 was never released on its own: 1.5.0 carries it, and its notes (`release-notes/1.4.3.md`) stay, so What's new
shows them after 1.4.2. No new Qasa Relay this time (no relay code changed since 1.4.2). 1.5.0 **upgrades the company
file to schema 15** (the receipt photos): 1.4.3 and earlier, and a Store copy still on 1.4.2, can't open it afterwards,
as the notes say first.

1. **The phone app 1.1.0** is already built and signed (versionCode 5, 97,501,572 bytes;
   `scripts/check-release-apk.mjs` says OK). Its SHA-256 and size are in `PHONE_APP` (`apps/web/src/pages/Settings.tsx`),
   and the website's `PHONE_APK` must carry the same file. Try it once on a real phone before the release: a receipt
   photo with the camera, a PDF sent with WhatsApp through the share sheet, and the "Open the customer's chat" link.
2. **Tag Pro, then the app** (the stable steps above): Pro's `v1.5.0` goes on Pro `main` after its `release/1.5.0` is
   merged, since Pro's phone link is what offers 1.1's features. Submit the Store package with the 1.5.0 "What's new" (it names 1.4.3 and 1.4.1
   too).
3. **The website** (the phone pages with 1.1.0, its SHA-256 and its features; the privacy page on receipt photos, sent
   only to the customer's own office, and PDFs, shared only by the user) goes live only once the 1.5.0 GitHub release
   is out: phone app 1.1 with an office on 1.4.x shows only 1.0.2's features and asks for an office update, so that
   update must exist first. Set its `APP_VERSION` (`build.mjs`, the `softwareVersion` the pages give search engines)
   to 1.5.0 in the same deploy.

## Release day for 1.5.1 (the menu: GitHub and the website only)

1.5.1 carries one change: the menu at the side keeps one group open at a time, slides the group you open into view and
highlights it for a moment, and a page opened from search or Home opens its own group. No schema change (the company
file stays on 15) and no Pro change. **The Microsoft Store is not updated in this release: the Store stays on 1.5.0**
(its "What's new" in `store-listing.json` still names 1.5.0) until the next Store submission, which then carries 1.5.1's
change with its own version and "What's new".

1. **Tag Pro, then the app** (the stable steps above, without step 7): no Pro code changed, but `release.yml` checks out
   Pro at the tag named like the app's, so push `v1.5.1` on Pro `main` (at the commit of Pro's `v1.5.0`, or later if
   Pro `main` has moved on and passed its checks), then tag the app `v1.5.1` on `main` after the release PR is merged.
2. **Don't submit the `microsoft-store-package` artifact** in Partner Center. The release workflow still builds it; leave it.
3. **The website:** set its `APP_VERSION` (`build.mjs`, the `softwareVersion` the pages give search engines) to 1.5.1
   and deploy once the 1.5.1 GitHub release is out (the release workflow moves the website's download link, as for every
   release).

## Release notes format

The notes are the GitHub release body (taken from `apps/desktop/release-notes/<version>.md`). The app shows them under **What's new**, as plain text with a little formatting and never as HTML.

Write a section per language between fence lines:

```
::: en
### New
- **Real estate:** units, leases and rent invoices.
- Faster start on large books.

### Fixed
- The VAT report total now matches the ledger.
:::

::: ar
### جديد
- **العقارات:** الوحدات والعقود وفواتير الإيجار.
:::

::: ku
### نوێ
- **خانووبەرە:** یەکەکان، گرێبەستەکان و پسوولەی کرێ.
:::
```

- **Which section is shown.** The reader's language. If that section is missing, English. If English is missing too, the first section.
- **Formatting the app understands:**
  - `#`/`##`/`###` headings;
  - `- ` or `* ` list items;
  - `**bold**`;
  - blank lines between paragraphs;
  - `---` as a break.
  - Links show their text only. Code ticks are dropped.
- **Text outside the fences.** The app ignores it. Use it for notes meant only for GitHub readers.
- **Older notes** (`0.1.0`–`0.1.8`) are written as English, then `---`, then paragraphs starting `**بالعربية:**` and `**بە کوردی:**`. The app splits those the same way.
- **Length.** Keep the notes short. The app shows them in a small window.
