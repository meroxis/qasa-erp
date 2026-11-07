# Releasing Qasa ERP

The Windows app updates itself from the GitHub releases of `meroxis/qasa-erp` (electron-updater). Copies from the Microsoft Store update through the Store.

There are two channels:

| | Stable | Beta |
|---|---|---|
| Version and tag | `0.2.0`, tag `v0.2.0` | `0.2.0-beta.1`, tag `v0.2.0-beta.1` |
| GitHub release | normal, marked **Latest** | **prerelease**, never "Latest" |
| Update file | `latest.yml` and `beta.yml` | `beta.yml` only |
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
3. Update the Store "What's new" text in `apps/desktop/store-listing.json`.
4. Commit, then tag and push:

   ```
   git tag v0.2.0 && git push origin v0.2.0
   ```

5. The workflow then:
   - builds and signs;
   - publishes the release as **Latest**;
   - moves the website link;
   - keeps the `microsoft-store-package` artifact.
6. Submit that package in Partner Center.

## Cutting a beta

1. Set the version to the next stable version plus `-beta.N`, for example `0.2.0-beta.1`. A beta must sort **above** the current stable version (`0.2.0-beta.1` > `0.1.8`) or nobody gets it.
2. Write `apps/desktop/release-notes/0.2.0-beta.1.md`. Say what to test and what is known to be broken.
3. Tag and push:

   ```
   git tag v0.2.0-beta.1 && git push origin v0.2.0-beta.1
   ```

4. The release appears as a GitHub prerelease. Only beta testers are offered it.
5. For the next round, use `0.2.0-beta.2`, and so on.

**Database migrations in a beta.** A beta that changes the database format writes books that an older stable version refuses to open (the `database_newer` check). Testers who leave the beta must wait for the stable release that contains the migration. Say so in the notes, and remind testers to back up first.

## Promoting a beta to stable

When the last beta is good, release the **same code** as `0.2.0`:

1. Set the version to `0.2.0` and write `release-notes/0.2.0.md`. This is the full list of changes since the last stable, not only the last beta's.
2. Tag `v0.2.0` and push.

Beta testers get `0.2.0` too, because a stable release also writes `beta.yml`. They stay on the beta channel for the next betas.

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
