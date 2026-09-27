<h1 align="center">Qasa ERP · قاصة ERP · قاسە ERP</h1>

<p align="center">
  <strong>Accounting software for Iraqi companies, built on the Iraqi Unified Accounting System.<br>Arabic, English and Kurdish. Dinars and dollars. Open source.</strong>
</p>

<p align="center">
  <a href="https://github.com/meroxis/qasa-erp/actions/workflows/tests.yml"><img src="https://github.com/meroxis/qasa-erp/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-1D5FD1" alt="License: AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/Node.js-24-1D5FD1" alt="Node.js 24">
  <a href="https://github.com/sponsors/meroxis"><img src="https://img.shields.io/badge/sponsor-meroxis-1D5FD1" alt="Sponsor"></a>
</p>

<p align="center">
  <a href="https://qasaerp.com">Website</a> ·
  <a href="https://qasaerp.com/demo/">Live demo</a> ·
  <a href="#run-it">Run it</a> ·
  <a href="#accounting-rules-the-code-enforces">Accounting rules</a> ·
  <a href="#plans">Plans</a> ·
  <a href="#license">License</a>
</p>

Qasa ERP keeps the books of an Iraqi company the way its finance department already works: the unified chart of accounts
(النظام المحاسبي الموحد), receipt and payment vouchers that go from preparer to checker to approver, sales and purchase
invoices, stock at average cost, customers and suppliers with statements, and reports — in Arabic, English and
Kurdish (Sorani), in dinars and dollars. PC, office network and online editions share one codebase.

> **Status: Release 1 in progress.** Accounting, vouchers, reports, invoices and stock work today. See the [progress list](#release-1-progress).
>
> **Try it:** the [live demo](https://qasaerp.com/demo/) runs entirely in your browser with a sample company. Nothing is sent to a server, and a reload starts it afresh.

## Run it

Needs Node.js 24 or newer.

```bash
npm install
npm run seed:demo   # optional: sample company with customers, items, invoices and vouchers
npm run dev         # API on :4417 + app on http://localhost:5173
npm test            # core + API tests
npm run typecheck
```

The database is `data/qasa.sqlite` (set `QASA_DATA_DIR` to move it). Delete the `data` folder to start fresh.

## Windows app

`apps/desktop` wraps the same server and screens in Electron:

```bash
npm run desktop     # run the Windows app from source
npm run dist:win    # build apps/desktop/release/Qasa-ERP-Setup-<version>.exe
```

- The company file is `%APPDATA%Qasa ERPdataqasa.sqlite`; the support log is `%APPDATA%Qasa ERPlogsmain.log`.
- The built-in server listens on 127.0.0.1 only and answers only the app's own window (a new secret each launch).
- The window has no Node access (sandbox, context isolation) and loads nothing but the app. Electron fuses stop the
  program being used as a plain Node runtime and make it reject tampered app files.
- Updates: the app checks GitHub releases of this repository at start and every six hours, downloads in the background
  and asks before restarting.

## Project layout

| Folder | What it is |
|---|---|
| `packages/core` | Accounting rules with no UI or database: money in minor units, IQD/USD, amount in words (ar/en/ku), the unified chart of accounts, journal validation, vouchers, trial balance, account statement |
| `packages/server` | Node.js API (Fastify) + SQLite (`node:sqlite`). Posted entries are protected by database triggers; the audit log is append-only. The routes (`routes.ts`) don't depend on Fastify, so the website demo runs them in the browser |
| `apps/web` | React screens, right-to-left and left-to-right, fonts bundled for offline use. `npm run build:demo -w @qasa/web` builds the browser-only demo (SQLite in WebAssembly) into `apps/web/dist-demo` |
| `scripts/dev.mjs` | Starts server and app together |

## Accounting rules the code enforces

- Money is stored as whole numbers (IQD dinars, USD cents) — never floating point. USD entries store the day's rate and their IQD value.
- Every entry must balance; only sub-accounts (no children) take entries.
- Vouchers follow the Iraqi approval chain: **draft (المنظم) → checked (المدقق) → approved (المصادق)**. Only approved entries reach the reports.
- Voucher numbers (RV-, PV-, JV-, RJ-) are given at approval, so posted numbers have no gaps.
- Approved entries can never be edited or deleted — even by raw SQL — only reversed with a reversal entry (قيد عكسي).
- Locked months take no new vouchers or approvals. Every change goes to the audit log.
- Invoices are numbered when posted (INV-, PI-) and post their own entry: a sale debits the safe or the customer and credits sales (42),
  and moves its cost at weighted average from the warehouse account (137x) to cost of sales (35). Posting accounts are editable in Settings.
- Stock moves are permanent. A posted invoice is never edited or deleted — cancelling it reverses its entry and puts the stock back;
  a purchase whose goods were already sold can't be cancelled.
- A sale can't take more than the warehouse holds, and a credit sale can't pass the customer's credit limit.
- Each warehouse has its own inventory account, so its stock value always equals its ledger balance.

## Release 1 progress

- [x] Project setup, database, migrations
- [x] Iraqi unified chart of accounts in 3 languages (to be reviewed by a licensed accountant)
- [x] Receipt / payment vouchers, journal entries, approvals, reversals, period locking, audit log
- [x] Trial balance and account statement (print + Excel export)
- [x] Sales & purchase invoices, customers & suppliers (with statements), items, warehouses, weighted-average stock
- [x] Opening stock, sales and purchase returns, stock transfers between warehouses
- [ ] Installment sales and sales pipeline
- [ ] HR, salaries and employee advances
- [x] Final accounts: trading, current operations and profit and loss accounts, and the balance sheet (unified-system layout, to be reviewed by a licensed accountant)
- [ ] Year-end closing
- [x] Users, roles and sign-in (Free: one password-protected user; Pro: up to 5 users with roles and separate duties)
- [ ] Office-network (server) mode
- [x] Windows app and installer with automatic updates
- [x] Plans (Free, Pro, Business) with offline license keys and a 30-day Pro trial
- [ ] Code signing, backups

## Plans

Free is the complete accounting product for one company on one PC, with no time limit. Pro and Business add what a
growing company needs, and the app shows the full comparison under **Plan & license**.

| | Free | Pro | Business |
|---|---|---|---|
| Accounting, vouchers, invoices, stock, trial balance | ✓ | ✓ | ✓ |
| Warehouses | 1 | unlimited | unlimited |
| "Made with Qasa ERP" on invoices | shown | removed | removed |
| Users | 1 on one PC | up to 5 on the office network | unlimited, online too |
| Companies | 1 | 3 | unlimited |
| Installments, payroll, cloud backup, final-account exports | | ✓ | ✓ |

Some Pro features are still being built; the app marks them as coming soon. A plan never locks anyone out of their
data: when a license ends, the company keeps everything and continues on the Free features. Pro can be tried
free for 30 days. Licenses are offline keys signed by Meroxis (Ed25519) and are available from
[info@qasaerp.com](mailto:info@qasaerp.com).

## License

Qasa ERP is a product of Meroxis. It is free software under the [GNU Affero General Public License v3.0 or later](LICENSE),
with the additional terms in [NOTICE](NOTICE): copies must keep the "Made with Qasa ERP" credit printed on invoices,
unless you have a Pro or Business license from [qasaerp.com](https://qasaerp.com). The name and logo belong to Meroxis.

© 2026 Meroxis
