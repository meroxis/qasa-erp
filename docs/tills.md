# Tills (2.0, supermarkets)

- **Named tills** (`packages/server/src/pos-tills.ts`, table `pos_tills`, migration 17): a name, the safe and warehouse its
  shifts use, whether the cash drawer opens on a cash sale, whether it has a customer screen. Each PC picks its till once
  (localStorage `qasa.pos.till`); `GET /api/pos/current?tillId=` answers that till's shift only. One active till on every
  plan; more need `multiTill` (Starter, Pro, Business). Registers typed by name keep working as before.
- **Held baskets** (`apps/web/src/industry/till.ts`): kept on the PC per shift (up to 20), so they survive a reload and
  work offline; resumed only on the same shift, warned about and cleared when it closes. Prices are re-read from the
  till's item list on resume.
- **How a sale is paid (2.0)**: cash (dinars, and dollar notes on a dinar sale), on the customer's account (credit) and
  gift vouchers, nothing else. Card and wallet payments (card, FIB, ZainCash, Qi) are switched off in the app by one
  flag, `TILL_CARD_PAYMENTS` in `packages/core/src/till-payments.ts` (the owner's decision for 2.0): no screen sets their
  accounts or offers them. The server's code, accounts and tests for them stay, so turning the flag on later needs no
  migration. A sale may still be split (cash with a part on account, a voucher with cash for the rest).
- **Gift vouchers** (`packages/server/src/gift-vouchers.ts`): sold at the till for cash into the shift's drawer (a receipt
  posted at once: Dr the shift's safe / Cr 263 "Gift vouchers sold", a liability, or the account the company chose);
  paid with later, all at once or in parts, as part of the sale. Dinars only; a code without 0/O or 1/I/L. A cancelled
  sale gives the voucher back what it took; an admin may cancel an unused voucher (its receipt is reversed) and writes
  off the ones past their date. The day close and the phone's day close count them apart from cash (a phone app that
  has no word for them gets them under points: `pro/src/phone/owner-routes.ts`).
- **Dinar rounding** (`packages/core/src/cash-rounding.ts`, Settings → Tills and till rules): the cash part of a dinar
  sale to 250, 500 or 1,000 dinars, to the nearest, up or down. Only the cash part; the difference is booked to the
  company's rounding account with the sale (`pos_sales.rounding`) and printed on the receipt. The server works it out;
  the till only previews it.
- **Supervisor approvals** (`packages/server/src/till-rules.ts`, `till-settings.ts`): the rules say which actions need a
  supervisor (deleting a line, voiding the basket, a changed price, a discount beyond the limit, opening the drawer
  with no sale, a refund, a credit sale over the customer's limit, seeing a blind shift's figures). A supervisor has a PIN of their own, 6 to 8
  digits, kept as a password is; an approval is for one action at one shift, used once within two minutes, and written
  to the audit log with every PIN that failed. Five wrong PINs from one cashier lock that cashier's approvals for
  fifteen minutes; twenty from everyone in ten minutes lock every till's for ten. Approvals need the server.
- **Returns at the till**: paid back as the sale was paid (`packages/server/src/returns.ts`): from the drawer at most
  what came into it in cash for that sale, less what earlier returns paid out; the part a gift voucher paid goes back
  onto a voucher, the part put on the customer's account comes back as credit, points as points. Rounding comes back
  in proportion. With separate duties on, voiding a till sale or paying one back takes an approver who did not ring
  it up. A clothes shop's exchange is such a return and a new sale in one step (`clothing.ts`).
- **Dollar notes on a dinar sale** (`usdCash: { amount, rateX100 }`, `pos_sales.usd_cash/usd_rate_x100`): the books keep the
  sale in dinars; the shift expects those dollars in the drawer instead of their dinars (`usdTaken` on the shift, the X/Z
  report and the day close). The rate must be within 15% of the company's; the dollars may pass what is due by less than a
  100-dollar note (change in dinars). The accountant may record the exchange.
- **Cash drawer** (`apps/desktop/src/till-desktop.ts`): ESC p 0 25 250 sent RAW through winspool to the receipt printer
  chosen in Settings → Printers, by a fixed PowerShell script with the printer name in its environment. The script's C#
  is compiled once for each run of the app into a helper file in a folder made for that run (loaded only while its
  SHA-256 is the one taken when it was compiled; removed on quit); if the helper cannot be made or run, the kick
  compiles in memory, as before. A PC whose Windows policy blocks PowerShell answers `blocked`, and the till says so.
  Opened after a cash sale when the till says so, and by "Open drawer", which is written to the audit log first
  (`POST /api/pos/shifts/:id/drawer`, counted as "opened with no sale" by till).
- **Customer screen** (`#/customer-display`, `pages/CustomerDisplay.tsx`): a second window of the app's page fed by a
  BroadcastChannel; in the Windows app full screen on the second display, without a bridge. It can be closed from the
  till and from Settings; when its screen is unplugged the window is hidden (never moved over the till) and comes back
  when a second screen is there again (`customerScreenPlan`). A screen on another device (a tablet, a second PC) is
  paired to a till with a code from Settings and reads that till only (`till-rules.ts`, `pos_display_keys`).
- **Weighing scale** (`apps/web/src/pos/scale.ts`, `apps/desktop/src/serial-scale.ts`): an admin chooses the scale's
  serial port for this PC in Settings → Tills and till rules (kept per PC, `scale-port.json`); the app opens that port
  only and never writes to a device nobody chose. A weight is taken from whole lines only, when two readings in a row
  are stable and equal; a frame the scale marks unstable is not a weight, and a scale that does not settle in time
  says so.
- **Scale labels with the price**: prefixes (two digits starting with 2) set in Settings; such a label's five digits are
  dinars and the quantity is the price over the item's dinar price per kg (or g).
- **By till**: `GET /api/pos/tills/summary?from&to` (books keepers all, cashiers their own shifts); the till's opening
  screen shows today's.
