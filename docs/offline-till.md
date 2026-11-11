# Offline outbox and offline till (1.2)

PCs connected to an office server (over the office network or through Qasa Relay) used to be online only: a save that
could not reach the server failed. From 1.2 they keep what the counter can't lose and send it when the link is back.
The office server PC itself is unchanged: it keeps its own books.

## How a document is never booked twice

Every posting route a client may send again takes an idempotency key in the header `x-qasa-idempotency` (a UUID v4,
the same format the phone app uses): `POST /api/pos/shifts/:id/sales`, `POST /api/invoices`,
`POST /api/invoices/:id/post`, `POST /api/invoices/:id/returns`, `POST /api/vouchers`, `POST /api/stock-docs`,
`POST /api/stock-docs/:id/post`, `POST /api/adjustments` and `POST /api/adjustments/:id/post`
(`packages/server/src/idempotency.ts`).

- The key is written in the same transaction as the document, so a power cut keeps both or neither.
- The same key again answers with the document made the first time (header `x-qasa-idempotent-replay: 1`) and makes
  nothing, also when two requests with it arrive at once.
- A key belongs to the company books it was used in and to the user who sent it. The same key from another user, for
  another route or with another body is refused (`idempotency_key_reused`, 409). A malformed key is refused before
  anything is made.
- A request that was refused (a rule, stock) keeps no key: once the cause is fixed, the same key books it, once.
- Keys are kept 90 days (at least 30 were asked for), then cleared a few at a time.
- What a PC keeps also names the company books it was made for (`x-qasa-books`, from `GET /api/outbox/books`); other
  books (the server PC opened another company, or started over) refuse it with `other_books`.

Schema 12 adds `idempotency_keys` and `pos_offline_sales` in the block `V12_OUTBOX` (`packages/server/src/db.ts`).

## The outbox on the PC

`apps/desktop/src/outbox.ts`, kept by the Windows app's main process, one list per office server (by its pinned
certificate):

- encrypted at rest with the app's own secret key (AES-256-GCM, the key protected by Windows for this user, as
  `secrets.ts` does for other secrets);
- written durably: a new file is written and flushed to the disk, then renamed over the old one. A cut while writing
  leaves the last complete list; a newer complete copy not yet renamed is taken at the next start. A file that can't be
  read is kept aside, never written over, and the app says so;
- at most 5000 entries; each sale or receipt at most 256 KB.

The app window (`apps/web/src/industry/outbox.ts`) sends what waits, oldest first, with the same key, as the person who
made it (another person's entries wait until they sign in on that PC). While the server can't be reached it tries
again after 2 s, 5 s, 10 s, 30 s, 1 min, 2 min, then every 5 minutes. A refusal that isn't about the link (validation,
stock, a closed shift, other books) stays in the list marked for a person, and the next ones go on. A server error
(5xx) is tried again, and after 8 tries waits for a person. Nothing is dropped silently.

The bar at the top says "Offline — N waiting to send" while the server can't be reached, "Sending…" while what waited
goes, and how many the server refused. **Waiting to send** (`#/outbox`) lists them: everyone sees their own and can
send again; an admin sees everyone's on that PC and can discard one after a confirmation. The discard is written to
the company's audit log on the office server first (`POST /api/outbox/discarded`, admins only), with what it held and
why, and only then removed from the PC, so discarding needs the server.

## The offline till: the rules

- **Cash, card and wallet sales go on.** The till sells from what it last had from the server in this window's memory
  (never on disk): items, prices, units, barcodes, categories, the stock last known, customers, payment methods and the
  open shift.
- **On a customer's account (credit) is online only**: it needs the live credit-limit check. The method is hidden
  while offline, and the server refuses an offline sale on account (`pos_offline_on_account`).
- **Stock** is checked against the stock last known, less what was sold offline since. A sale beyond it is not
  blocked; the till says which items are short, and the office server checks it when the sale arrives. If it refuses,
  the sale stays in the list for a person (fix the stock, then Send now; or discard it and record it by hand).
- **The receipt** carries a temporary reference per register, `OFF-<register>-0001` (letters and digits of the
  register's name, any script; the count is kept on the PC and never reused). The sale gets its invoice number when it
  is booked; the invoice keeps the reference, and the invoice search finds it by either.
- **The date** is the till's date when it was sold, never before the shift was opened and never after the server's
  today.
- **Online only**: opening and closing a shift, returns, batch picking by hand (the server picks by expiry when the
  sale arrives), the controlled-medicine prompt (afterwards from the pharmacy log). A shift can't be closed while sales
  of it still wait on that PC, so the expected cash is right.
- Receipt vouchers (new ones) are kept the same way; payment vouchers and other documents stay online only.
- While this person has sales waiting, new sales go behind them, so they reach the books in the order they were made.

## Limits

- The window's page comes from the office server. The till keeps working while the app stays open; a PC restarted
  while the server can't be reached shows the existing "office server doesn't answer" dialog (now with the number of
  sales and receipts kept safe on the PC) and sends them once it connects.
- A sale sent after its shift was closed on the server (an admin closed it from another PC) is refused and waits for a
  person.
