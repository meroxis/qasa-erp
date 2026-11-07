# Handoff: Qasa ERP 1.0 work (November 2026)

This branch and its sister branches carry the 1.0 work. Pick up from here in Claude Code.

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
- Google Drive / OneDrive backup, Qasa Relay (office network without a public IP), phone app link, website API + WooCommerce.
- Security: online activation (Ed25519, machine-bound), Rust licence addon, Electron fuses and asar integrity.
- Free first month for every new company with every feature; starts on the first-run business type screen.
- The server runs in an Electron utilityProcess (the laptop freeze fix). Launcher home, welcome tour, update notices and beta channel.

## Rules worth knowing

- All new tables are in the unreleased migration 7 (`db.ts`), mirrored in `schema-mysql.ts` with `since: 7`.
  `schema.test` checks parity: no `ON CONFLICT`, no two-argument `MAX`/`MIN` in server SQL.
- Public features go in `BUILT_IN_FEATURES` (`packages/server/src/features.ts`); their tests use plain `buildApp(db)`.
  Pro features go in `proApi` (`pro/src/api.ts`).
- Entries follow preparer → checker → approver. Never bypass it. Document-made entries that belong to a feature
  are guarded in `deleteEntry` (`journal.ts`).
- Every text in Arabic, English and Kurdish; module texts in `apps/web/src/i18n/*.ts`, spread into `D` in `i18n.ts`.
- Commits by meroxis <host4kurd@gmail.com>. Work on branches, never main.

## Left to do

1. Full bug and security review, then PRs to main for the GitHub review bot.
2. Relay deploy on the VPS: `pro/relay/README.md` (DNS relay.qasaerp.com DNS-only, Node 24, systemd, Caddy, ufw 22/80/443, 8790 for PHP clients).
3. Website screenshots: brief, pos, real-estate, car-parts, mobile-shop, works, solar, generators, payroll, rates,
   business-type × ar/en/ku at 1440×900 into `qasa-erp-website/assets/shots/<name>-<lang>.png`; Google Play listing.
4. Portal: update-channel column and beta tester count; the privacy sentence on the site.
5. More import sources (the builder was stopped; nothing of it was merged).
6. Known gaps: invoice lines have no per-line discount (the print designer's discount column prints empty);
   cancelling a cash real-estate sale paid partly by deposit leaves the receipt for the rest (refund by payment voucher).
7. One-time items for the owner: Google and Microsoft OAuth apps (`pro/docs/cloud-backup-setup.md`), the
   `QASA_INTEGRITY_KEY` build secret with its public key in `INTEGRITY_KEYS` (`native/licence/src/lib.rs`),
   legal placeholders and a lawyer's review, and the Windows test checklist (installer, server process, secrets
   migration, GPU toggle, updates/beta, MySQL, phone, relay, several companies).
