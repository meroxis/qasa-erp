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

- **Tickets.** Sending gives the unsent lines the order's next ticket number (1, 2, 3 …), each line goes to its
  category's **station** (the kitchen, the grill or the drinks bar: **Kitchen settings** on the room page; a category
  not set goes to the kitchen), and each station's part prints on the printer chosen for that station's tickets in
  Settings → Printers (an 80 mm roll; it prints without the print window, as receipts do; the three rows show for a
  restaurant only). A ticket can be printed again. The station is kept on the line when it is sent.
- **Paper or the screen only.** Kitchen settings: printed tickets (and the kitchen screen), or the kitchen screen only.
- **The kitchen screen** (Restaurant → Kitchen screen, `GET /api/restaurant/kitchen?station=`): a station's tickets (or
  all), the oldest first, read every 5 seconds, amber after 15 minutes and red after 25, a beep for a new one. **Ready**
  marks a station's part of a ticket ready; it moves to "made ready in the last half hour", where **Not yet** takes it
  back while nobody has taken it. A dish cancelled while it cooks stays on its ticket, crossed out. Only the last 12
  hours are read (`rs_order_lines(sent_at)`): a kitchen that works on paper never marks anything ready.
- **Ready and served.** A table with dishes ready shows a bell; **Served what is ready** on the order (or the waiter's
  phone) takes the bell away.
- **A sent line is cooking**: it can't be changed or taken off. A supervisor (`posSupervise`, or an admin) cancels it,
  in part or whole, with a reason: the line is crossed out, counts for nothing, and the kitchen gets a cancel ticket.

## Recipes

- **What a dish takes** (Restaurant → Recipes, `recipes.ts`): a dish is an item that keeps no stock of its own; its
  ingredients are items kept in stock, without batches, each in its own unit (250 g of lamb is 0.25 of a kg).
- **Selling a dish** (any sale: the till, an invoice, a restaurant order) takes its ingredients out of the sale's
  warehouse at their average cost, and that cost is the line's cost, so every profit report shows the plate's profit.
  A sale never waits for stock: what there is comes out, never below none; a count puts it right.
- **A cancelled sale** gives each ingredient back at what it took (`invoice_recipe_moves`). A return of a dish gives
  nothing back: food that went out is not stock again.
- Whoever keeps the items (`stock`, or an admin) writes recipes; the cost columns show to those who see cost only.

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
| The kitchen screen: Ready, Not yet; Served on an order | `pos` or `sales` (the screen is read by everyone signed in) |
| Kitchen settings (paper or screen, stations) | admin |
| Recipes | `stock` (or admin) |
| Set up the room | admin |

Moving to a free table and joining two tables (the lines move to the other order) are for open orders with nothing
paid yet. An order with nothing paid can be cancelled with a reason.

## Waiters' phones (phone app 1.3)

An office of 2.1 offers `waiter` on the phone link to a restaurant or café only (Settings → Business type), to whoever
has `pos` or `sales`. The phone shows the tables (read every 10 seconds), opens a table's order (or a takeaway), adds
dishes with notes and sends them to the kitchen, changes or takes off what is not sent yet, and marks what is ready as
served. Paying, cancelling what the kitchen has, moving and joining tables, and delivery orders stay at the till. The
phone link lets through only those routes and those keys (`pro/src/phone/staff-routes.ts`); creating an order and
adding dishes carry a key, so an answer lost and sent again is made once.

## Not in 2.1 (ideas for later)

A table plan drawn to the room's shape, waste recorded for a dish cancelled after it was cooked, and recipes inside
recipes (a sauce made in the kitchen and used in several dishes).
