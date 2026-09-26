# Qasa ERP · قاصة ERP · قاسە ERP

Accounting software for Iraqi companies — built on the Iraqi Unified Accounting System
(النظام المحاسبي الموحد), in Arabic, English and Kurdish (Sorani).
PC, office network and online editions share one codebase.


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

## Project layout

| Folder | What it is |
|---|---|
| `packages/core` | Accounting rules with no UI or database: money in minor units, IQD/USD, amount in words (ar/en/ku), the unified chart of accounts, journal validation, vouchers, trial balance, account statement |
| `packages/server` | Node.js API (Fastify) + SQLite (`node:sqlite`). Posted entries are protected by database triggers; the audit log is append-only |
| `apps/web` | React screens, right-to-left and left-to-right, fonts bundled for offline use |
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
- [ ] Opening stock, purchase/sales returns, stock transfers between warehouses
- [ ] Installment sales and sales pipeline
- [ ] HR, salaries and employee advances
- [ ] More reports (balance sheet, profit and loss, final accounts)
- [ ] Users, roles and sign-in; office-network (server) mode
- [ ] Windows app (Tauri) and installer, licensing, backups
