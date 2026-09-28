# Contributing to Qasa ERP

Thank you for helping. Qasa ERP is accounting software, so correctness comes first: a change that moves money
between accounts must be right in every case, and the tests should prove it.

## Ways to help

- **Report a problem** with the [bug form](https://github.com/meroxis/qasa-erp/issues/new?template=bug_report.yml).
  Arabic, Kurdish and English are all welcome.
- **Suggest a feature** with the [feature form](https://github.com/meroxis/qasa-erp/issues/new?template=feature_request.yml).
  Tell us how your office works today; that helps more than a finished design.
- **Accountants:** if a report, a voucher or a posting does not match Iraqi practice or the Unified Accounting
  System, please open an issue. This is one of the most useful things you can do.
- **Translators:** every screen is in Arabic, English and Kurdish (Sorani). Better wording is always welcome.
- **Code:** fixes and features, following the rules below.

Found a security problem? Please don't open an issue; see [SECURITY.md](SECURITY.md).

## Working on the code

```bash
npm install
npm run seed:demo   # the sample company
npm run dev         # API on :4417 and the app on http://localhost:5173
npm test
npm run typecheck
```

The usual order for a change:

1. **Rules and tests first** in `packages/core` (pure functions, no database).
2. **Then the service and API** in `packages/server`, with tests that go through the API.
3. **Then the screens** in `apps/web`, with every text in Arabic, English and Kurdish (`apps/web/src/i18n.ts`).

Accounting rules the code must keep:

- Money is stored in whole minor units, never as floating-point numbers.
- Posted vouchers, invoices and stock moves are never edited or deleted; they are corrected by reversal or
  cancellation. The database enforces this, and changes must keep it that way.
- A change to the database adds a migration in `packages/server/src/db.ts` and a test that upgrades an older file.
- Examples, tests and screenshots use the sample company (`npm run seed:demo`), never real people's or companies' data.

Before you open a pull request, run `npm test` and `npm run typecheck`, and describe what you changed and why.

## Licence of contributions

Qasa ERP is published under the [GNU AGPL v3.0 or later](LICENSE), with the additional terms in [NOTICE](NOTICE).
Meroxis also offers commercial licences and builds. By submitting a contribution you confirm that you have the right
to submit it, and you agree that Meroxis may distribute it under the AGPL and under Meroxis's commercial licences.
