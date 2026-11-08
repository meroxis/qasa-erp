# Handoff: Qasa ERP 1.0 work (November 2026)

This branch and its sister branches carry the 1.0 work. Pick up from here.

## Branches

| Repo | Branch | Holds |
|---|---|---|
| meroxis/qasa-erp | `feature/real-estate` | the app (all 1.0 features below) |
| meroxis/qasa-erp-pro | `feature/industries` | the private Pro module; check it out at `qasa-erp/pro` (git-ignored) |
| meroxis/qasa-erp-portal | `feature/activation` | online activation, licence manager, usage stats |
| meroxis/qasa-erp-website | `feature/v1-site` | 1.0 site, "first month free" wording |
| meroxis/qasa-erp-website | `feature/verify`, `feature/legal` | invoice QR verify page; legal pages |

Setup: `git clone qasa-erp`, then `git clone qasa-erp-pro pro` inside it, `npm install`, `npm test`, `npm run typecheck`.
In `pro/`: `npx tsc --noEmit -p .` and `npx vitest run`.

## What 1.0 has

- Industries: real estate (Business, with reservation deposits), mobile shop, car parts, engineering works,
  electrical and solar, generator owners (Pro). Business type chosen on first run.
- Payroll, POS with shifts, quotations, sales pipeline, expenses, Daily Brief, item images, Excel import,
  WhatsApp share, dollar rate board with prefill, QR verify on invoices.
- Banking (accounts, transfers, cheques, statement reconciliation in Pro), fixed assets and depreciation,
  stock adjustments and stock count, purchase orders, wholesale and customer price lists.
- Print designer, logo and letterhead, barcode labels.
- Branches, several companies per PC (Free 1, Pro 3, Business unlimited).
- Google Drive / OneDrive backup, Qasa Relay (office network without a public IP), website API + WooCommerce.
- The phone app is not in 1.0 (owner decision): the app shows it as coming soon and its code paths stay for a later release.
- Security: online activation (Ed25519, machine-bound), Rust licence addon (proprietary, `native/licence/LICENSE`),
  Electron fuses and asar integrity. The app.asar self-check of the addon is off in 1.0 (`INTEGRITY_CHECK` in
  `apps/desktop/after-pack.cjs`); turning it on later needs the `QASA_INTEGRITY_KEY` secret and `INTEGRITY_KEYS`.
- Free first month once per PC, with every feature except Qasa Relay; it starts by itself on the first-run business
  type screen.
- The server runs in an Electron utilityProcess (the laptop freeze fix). Launcher home, welcome tour, update notices and beta channel.

## Rules worth knowing

- All new tables are in the unreleased migration 7 (`db.ts`), mirrored in `schema-mysql.ts` with `since: 7`.
  `schema.test` checks parity: no `ON CONFLICT`, no two-argument `MAX`/`MIN` in server SQL.
- Public features go in `BUILT_IN_FEATURES` (`packages/server/src/features.ts`); their tests use plain `buildApp(db)`.
  Pro features go in `proApi` (`pro/src/api.ts`).
- Entries follow preparer → checker → approver. Never bypass it. Document-made entries that belong to a feature
  are guarded in `deleteEntry` (`journal.ts`).
- Every text in Arabic, English and Kurdish; module texts in `apps/web/src/i18n/*.ts`, spread into `D` in `i18n.ts`.
- Commits by meroxis <333022010+meroxis@users.noreply.github.com>. Work on branches, never main.

## Left to do

1. Full bug and security review, then PRs to main for the GitHub review bot.
2. Relay deploy on the VPS, before the app (`pro/relay/README.md`; Node 24, systemd, Caddy). The DNS plan:
   - `relay.qasaerp.com`: orange (proxied) for the WebSocket connections of PCs and offices (and phones later). It
     stays grey until the offices and PCs on 0.1.8/0.1.9 have updated, because Cloudflare carries only WebSocket
     upgrades.
   - No DNS-only name for the relay (it would publish the VPS's address). Websites (PHP client, WooCommerce plugin
     1.1.0) send sealed requests (`POST /v1/sealed`, sealed for the office key) through Cloudflare like everyone else.
   - systemd: `RELAY_HOST=127.0.0.1` (only Caddy reaches the relay; port 8790 is never public).
     `RELAY_REQUIRE_ACTIVATION=1` only after the offices are on 1.0 (older offices send no activation token).
   - ufw: SSH; 80 and 443 from Cloudflare only (from everywhere while the name is grey); nothing else.
   - Cloudflare: WebSockets on, SSL Full (strict), Bot Fight Mode off (or a WAF skip rule on a paid plan), no Under
     Attack mode and no Browser Integrity Check for the relay host, or the apps' WebSocket upgrades get a challenge page.
3. Release day for 1.0 (`docs/releasing.md`, "Release day for 1.0"): import every licence issued offline
   (`licensing/issue.mjs`) on the portal before tagging; the release notes (ar/en/ku) tell 0.1.8 licence holders to
   connect once in the first month so the licence activates; the Store "What's new" for 1.0. The phone app is not in
   1.0, so nothing names it as available. There is no release-date constant to set (trials carry over by each
   company's first start in 1.0).
4. Website screenshots: done. The home gallery and the share images (`assets/og-<lang>.png`, `node tools/render.mjs
   og-share`) use the user guide's 1.0 pictures (`assets/guide/shots`, `tools/guide-motion/shots.mjs`), so retaking those
   for a new version updates the home page too; `tools/home.test.mjs` checks their version and the sample names. The
   Microsoft Store and README screenshots (`docs/screenshots`) were retaken from 1.0.0 on 8 November, with Mer, Las, Raz and Meroxis Company. The Google Play listing waits for the
   phone app's release.
5. Portal: update-channel column and beta tester count; the privacy sentence on the site.
6. More import sources (the builder was stopped; nothing of it was merged).
7. Known gaps: invoice lines have no per-line discount (the print designer's discount column prints empty);
   cancelling a cash real-estate sale paid partly by deposit leaves the receipt for the rest (refund by payment voucher).
8. One-time items for the owner: Google and Microsoft OAuth apps (`pro/docs/cloud-backup-setup.md`), a lawyer's
   review of the legal pages (provider: Meroxis, a brand of RapidNet for Internet Services and Communications/Ltd),
   and the Windows test checklist
   (installer, server process, secrets migration, GPU toggle, updates/beta, MySQL, relay, several companies).
