# Security policy

Qasa ERP keeps a company's books, so we treat security reports as urgent.

## Reporting a vulnerability

Please email **info@qasaerp.com** with "Security" in the subject, and include:

- what you found and where (the Windows app, the office network, the website or the demo);
- the steps to reproduce it, and what an attacker could do with it;
- the version you tested (Help → About in the app), and whether it came from the Microsoft Store or the installer.

Please don't open a public issue or discuss it publicly until a fix is released. We will confirm that we received
your report, keep you informed, and credit you in the release notes if you wish.

The same contact is published at [qasaerp.com/.well-known/security.txt](https://qasaerp.com/.well-known/security.txt).

## Supported versions

Security fixes go into the latest release. The installer version updates itself from this repository's releases; the
Microsoft Store version gets the same release through the Store once Microsoft has certified it. Staying on the
latest version is the best protection.

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
- **A company database on a MariaDB or MySQL server** (Business) is reached only over TLS (only a server on the same
  PC may go without), and nothing — not even the user name — is sent before the server's certificate passes: a public
  certificate for its name, one signed by the certificate authority the admin gives, or exactly the self-signed
  certificate the admin confirmed by its SHA-256 fingerprint. The database password is kept on one PC only, protected
  for its Windows user (DPAPI). Every statement is parameterized, one statement per call, and the driver never sends
  local files to the server. The app asks for a user with rights on its own database only and warns about one with
  rights on the whole server.
- **The Windows app is locked down:** the window has no Node.js access (sandbox and context isolation), and Electron
  fuses stop the program running as a plain Node runtime and make it reject tampered app files.
- **Updates:** the installer version updates only from this repository's releases, which are built by GitHub Actions,
  and checks each download against the SHA-512 in the release's `latest.yml`. The Microsoft Store version is updated
  only by the Store, with packages built by the same workflow and signed by Microsoft.
- **Signatures:** the Microsoft Store version is signed by Microsoft. The installer (`Qasa-ERP-Setup.exe`) isn't
  code-signed yet: download it only from this repository's releases or from qasaerp.com, which links there. GitHub shows
  each release file's SHA-256 next to it.
- **The website and demo** send no data anywhere: the demo runs entirely in the browser. The site sets a strict
  Content Security Policy and is served through Cloudflare.
