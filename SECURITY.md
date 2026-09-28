# Security policy

Qasa ERP keeps a company's books, so we treat security reports as urgent.

## Reporting a vulnerability

Please email **info@qasaerp.com** with "Security" in the subject, and include:

- what you found and where (the Windows app, the office network, the website or the demo);
- the steps to reproduce it, and what an attacker could do with it;
- the version you tested (Help → About in the app).

Please don't open a public issue or discuss it publicly until a fix is released. We will confirm that we received
your report, keep you informed, and credit you in the release notes if you wish.

The same contact is published at [qasaerp.com/.well-known/security.txt](https://qasaerp.com/.well-known/security.txt).

## Supported versions

Security fixes go into the latest release. The Windows app updates itself, so staying on the latest version is the
best protection.

## How Qasa ERP protects a company's data

- **The company file stays on the company's computer.** The Windows app's built-in server listens only on this PC
  (127.0.0.1) and answers only its own window, using a new secret each time it starts.
- **Sign-in:** passwords are stored only as salted scrypt hashes. Sessions use a random token in an HttpOnly,
  SameSite=Strict cookie, and only a hash of the token is kept. After five wrong passwords in a row, the account must
  wait before the next try. Every sign-in is recorded.
- **Roles and permissions** are checked by the server for every change. With "separate duties", whoever prepared a
  voucher can neither check nor approve it.
- **The books can't be rewritten:** the database itself refuses edits to posted vouchers, invoices and stock moves,
  and the audit log is append-only.
- **The Windows app is locked down:** the window has no Node.js access (sandbox and context isolation), and Electron
  fuses stop the program running as a plain Node runtime and make it reject tampered app files.
- **Updates** come only from this repository's releases, which are built by GitHub Actions.
- **The website and demo** send no data anywhere: the demo runs entirely in the browser. The site sets a strict
  Content Security Policy and is served through Cloudflare.
