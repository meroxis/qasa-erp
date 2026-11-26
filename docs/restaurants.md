# Restaurants and cafés (2.1)

Business type `restaurant`, plan feature `restaurant` (Starter, Pro and Business; never Free; the free month has it).
Server: `packages/server/src/restaurant.ts` (schema 22: `rs_areas`, `rs_tables`, `rs_orders`, `rs_order_lines`,
`rs_paid`, mirrored for MariaDB/MySQL). Pages: `apps/web/src/pages/Restaurant.tsx` (menu: Industry → Restaurant).

## The room

- **Areas and tables.** An admin makes the room once: a hall with its tables (1, 2, 3 …) and a family section (F1,
  F2 …) in one step, then renames, adds or switches off areas and tables in **Set up the room**. A table's name is
  unique in its area. An area or a table with an open order can't be switched off.
- **The floor** shows each area's tables: free, or with their order (what is left to pay, guests, minutes since it
  opened, dishes not sent to the kitchen yet, and a dashed border once the bill is printed). The side list has the open
  takeaway and delivery orders. Every PC reads it again every 10 seconds.

## Orders

- **One open order a table.** Opening a table that someone opened a moment ago goes to their order
  (`409 rs_table_busy` with its id). Takeaway and delivery orders have no table; a delivery has a phone and an address.
- **Dishes** are the company's items (real items: sold, counted and reported on as any item). Their price is the item's
  price in dinars when the dish is added (a dollar price at the company's rate, as the till reckons it). Each line may
  carry a note for the kitchen ("no onion").
- On the order screen, tapping the menu builds the new dishes on this PC; **Send to the kitchen** saves them and sends
  everything not sent yet (others' too). Leaving the screen saves them without sending.

## The kitchen

- **Tickets.** Sending gives the unsent lines the order's next ticket number (1, 2, 3 …) and prints that ticket on the
  printer chosen for **Kitchen tickets** in Settings → Printers (an 80 mm roll; it prints without the print window, as
  receipts do). A ticket can be printed again.
- **A sent line is cooking**: it can't be changed or taken off. A supervisor (`posSupervise`, or an admin) cancels it,
  in part or whole, with a reason: the line is crossed out, counts for nothing, and the kitchen gets a cancel ticket.

## The bill and paying

- **The bill** prints what is left to pay on the receipt roll, shared evenly by the guests if asked (to the dinar:
  `rsEvenShares`). It is not a receipt. The table shows the bill was printed.
- **Paying is the till's own sale** (`pos.ts sell`) on the cashier's open shift, in the same transaction as the order
  noting what it paid (`rs_paid`): the drawer, the receipt, discounts (with a supervisor's approval where the till
  rules ask for one), the shift's expected cash and the books are the till's. Cash or on the customer's account.
- **Split by items:** "Pay a part" takes some lines and quantities (each guest what they had); the order stays open
  until nothing is left, then closes and frees the table. Lines not sent yet that are paid (a café's counter) go to the
  kitchen with the payment.
- **Safe to retry:** creating an order, adding dishes and paying are sent with an idempotency key; a payment whose answer
  was lost and is sent again is the same sale.
- **A cancelled sale** leaves its lines unpaid again; a supervisor reopens the closed order to take the money again.

## Who does what

| Action | Who |
|---|---|
| See the room and orders | everyone signed in (a user limited to branches: their warehouses' orders) |
| Open orders, add dishes, send to the kitchen, bill, move, join tables | `pos` or `sales` |
| Cancel a sent line, cancel an order the kitchen has something of, reopen | `posSupervise` (or admin) |
| Pay | `pos`, on their own open shift |
| Set up the room | admin |

Moving to a free table and joining two tables (the lines move to the other order) are for open orders with nothing
paid yet. An order with nothing paid can be cancelled with a reason.

## Not in 2.1 (ideas for later)

Waiters' phones (orders taken at the table on the phone app), a kitchen screen instead of paper, separate printers per
station (grill, bar), recipes that take ingredients out of stock, and a table plan drawn to the room's shape.
