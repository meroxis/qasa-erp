# Tills (2.0, supermarkets)

- **Named tills** (`packages/server/src/pos-tills.ts`, table `pos_tills`, migration 17): a name, the safe and warehouse its
  shifts use, whether the cash drawer opens on a cash sale, whether it has a customer screen. Each PC picks its till once
  (localStorage `qasa.pos.till`); `GET /api/pos/current?tillId=` answers that till's shift only. One active till on every
  plan; more need `multiTill` (Starter, Pro, Business). Registers typed by name keep working as before.
- **Held baskets** (`apps/web/src/industry/till.ts`): kept on the PC per shift (up to 20), so they survive a reload and
  work offline; resumed only on the same shift, warned about and cleared when it closes. Prices are re-read from the
  till's item list on resume.
- **Card and wallets**: the accounts in Settings → Sales and point of sale bring them back to the till as parts of a sale
  paid now (`payments`, cash pays the rest, at most four parts). Offline they work as before (doc: offline-till.md).
- **Dollar notes on a dinar sale** (`usdCash: { amount, rateX100 }`, `pos_sales.usd_cash/usd_rate_x100`): the books keep the
  sale in dinars; the shift expects those dollars in the drawer instead of their dinars (`usdTaken` on the shift, the X/Z
  report and the day close). The rate must be within 15% of the company's; the dollars may pass what is due by less than a
  100-dollar note (change in dinars). The accountant may record the exchange.
- **Cash drawer** (`apps/desktop/src/till-desktop.ts`): ESC p 0 25 250 sent RAW through winspool to the receipt printer
  chosen in Settings → Printers, by a fixed PowerShell script with the printer name in its environment. Opened after a
  cash sale when the till says so, and by "Open drawer", which is written to the audit log first
  (`POST /api/pos/shifts/:id/drawer`, counted as "opened with no sale" by till).
- **Customer screen** (`#/customer-display`, `pages/CustomerDisplay.tsx`): a second window of the app's page fed by a
  BroadcastChannel; in the Windows app full screen on the second display, without a bridge.
- **Scale labels with the price**: prefixes (two digits starting with 2) set in Settings; such a label's five digits are
  dinars and the quantity is the price over the item's dinar price per kg (or g).
- **By till**: `GET /api/pos/tills/summary?from&to` (books keepers all, cashiers their own shifts); the till's opening
  screen shows today's.
